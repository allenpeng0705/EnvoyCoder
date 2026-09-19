/// Work on one paired machine: projects → tasks, stable order, searchable.
///
/// Mirrors the desktop sidebar: `coder.listProjects` + `coder.listTasks`, grouped by
/// `addedAt` (newest first), with a search field that hits title / path / label.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../models/harness.dart';
import '../models/host.dart';
import '../models/project_rail.dart';
import '../services/host_client.dart';
import '../theme/tokens.dart';
import 'new_task_sheet.dart';
import 'add_project_sheet.dart';
import 'run_screen.dart';
import 'settings_screen.dart';

class HostHomeScreen extends StatefulWidget {
  const HostHomeScreen({super.key, required this.host, required this.client});

  final CoderHost host;
  final HostClient client;

  @override
  State<HostHomeScreen> createState() => _HostHomeScreenState();
}

class _HostHomeScreenState extends State<HostHomeScreen> {
  List<ProjectGroup> _groups = [];
  List<ProjectInfo> _projects = [];
  List<TaskInfo> _tasks = [];
  List<HarnessInfo> _harnesses = [];
  String? _appHarness;
  String _query = '';
  String? _error;
  bool _loading = true;
  final Set<String> _collapsed = {};
  StreamSubscription<HostConnectionState>? _stateSub;
  StreamSubscription<Map<String, dynamic>>? _eventSub;

  @override
  void initState() {
    super.initState();
    _stateSub = widget.client.states.listen((state) {
      if (state == HostConnectionState.connected) unawaited(_refresh());
      if (mounted) setState(() {});
    });
    _eventSub = widget.client.events.listen((frame) {
      final event = frame['event'];
      if (event == 'coder:state-changed' || event == 'coder:run-event') {
        unawaited(_refresh());
      }
    });
    unawaited(_refresh());
  }

  Future<void> _refresh() async {
    if (widget.client.state != HostConnectionState.connected) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = null;
        });
      }
      return;
    }
    try {
      final projectsResult = await widget.client.call('coder.listProjects', {});
      final tasksResult = await widget.client.call('coder.listTasks', {});
      Map<String, dynamic>? harnessesResult;
      Map<String, dynamic>? settingsResult;
      try {
        harnessesResult = await widget.client.call('coder.listHarnesses', {});
      } catch (_) {}
      try {
        settingsResult = await widget.client.call('coder.getSettings', {});
      } catch (_) {}
      final projects = _asMapList(projectsResult['projects']).map(ProjectInfo.fromJson).toList();
      final tasks = _asMapList(tasksResult['tasks']).map(TaskInfo.fromJson).toList();
      final groups = groupByProject(projects: projects, tasks: tasks);
      final harnesses = _asMapList(harnessesResult?['harnesses']).map(HarnessInfo.fromJson).toList();
      String? appHarness;
      final settings = settingsResult?['settings'];
      if (settings is Map) {
        final defaults = settings['defaults'];
        if (defaults is Map) appHarness = defaults['harness'] as String?;
      }
      if (!mounted) return;
      setState(() {
        _projects = projects;
        _tasks = tasks;
        _groups = groups;
        _harnesses = harnesses;
        _appHarness = appHarness;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load work from this computer. ${_friendly("$error")}';
      });
    }
  }

  static String _friendly(String raw) {
    if (raw.contains('token=')) return 'The connection failed.';
    return raw.length > 160 ? '${raw.substring(0, 160)}…' : raw;
  }

  static List<Map<String, dynamic>> _asMapList(Object? value) {
    if (value is! List) return const [];
    return value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  List<ProjectGroup> get _visibleGroups => filterProjectGroups(_groups, _query);

  @override
  void dispose() {
    unawaited(_stateSub?.cancel() ?? Future<void>.value());
    unawaited(_eventSub?.cancel() ?? Future<void>.value());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    final state = widget.client.state;
    final badge = attentionBadge(_tasks);
    final groups = _visibleGroups;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.host.label),
        actions: [
          if (badge > 0)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: colors.statusWarning.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$badge need${badge == 1 ? 's' : ''} you',
                    style: TextStyle(color: colors.statusWarning, fontSize: 12),
                  ),
                ),
              ),
            ),
          IconButton(
            tooltip: 'Add project',
            onPressed: state != HostConnectionState.connected
                ? null
                : () => unawaited(
                      showAddProjectSheet(
                        context: context,
                        client: widget.client,
                        harnesses: _harnesses,
                      ).then((id) {
                        if (id != null) return _refresh();
                      }),
                    ),
            icon: const Icon(Icons.create_new_folder_outlined),
          ),
          IconButton(
            tooltip: 'Settings',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => SettingsScreen(
                    client: widget.client,
                    harnesses: _harnesses,
                  ),
                ),
              );
            },
            icon: const Icon(Icons.settings),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: () => unawaited(_refresh()),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => unawaited(
          showNewTaskSheet(
            context: context,
            client: widget.client,
            projects: _projects,
            harnesses: _harnesses,
          ).then((_) => _refresh()),
        ),
        icon: const Icon(Icons.add),
        label: const Text('New task'),
      ),
      body: Column(
        children: [
          Material(
            color: colors.surface1,
            child: ListTile(
              dense: true,
              leading: Icon(
                Icons.circle,
                size: 10,
                color: switch (state) {
                  HostConnectionState.connected => colors.statusDotSuccess,
                  HostConnectionState.reconnecting => colors.statusDotWarning,
                  HostConnectionState.failed => colors.statusDotDanger,
                  _ => colors.statusDotRunning,
                },
              ),
              title: Text(_stateLabel(state)),
              subtitle: Text(widget.host.endpoint),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: TextField(
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                hintText: 'Search tasks, repos, paths',
                prefixIcon: Icon(Icons.search, size: 20),
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_error!, style: TextStyle(color: colors.statusDanger)),
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : RefreshIndicator(
                    onRefresh: _refresh,
                    child: groups.isEmpty
                        ? ListView(
                            children: [
                              const SizedBox(height: 48),
                              Center(
                                child: Column(
                                  children: [
                                    Text(
                                      _query.trim().isEmpty
                                          ? 'No projects yet — add a folder on this computer.'
                                          : 'Nothing matches that search.',
                                      style: TextStyle(color: colors.foregroundMuted),
                                      textAlign: TextAlign.center,
                                    ),
                                    if (_query.trim().isEmpty &&
                                        state == HostConnectionState.connected) ...[
                                      const SizedBox(height: 16),
                                      FilledButton.tonalIcon(
                                        onPressed: () => unawaited(
                                          showAddProjectSheet(
                                            context: context,
                                            client: widget.client,
                                            harnesses: _harnesses,
                                          ).then((id) {
                                            if (id != null) return _refresh();
                                          }),
                                        ),
                                        icon: const Icon(Icons.create_new_folder_outlined),
                                        label: const Text('Add project'),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ],
                          )
                        : ListView.builder(
                            itemCount: groups.length,
                            itemBuilder: (context, index) {
                              final group = groups[index];
                              final collapsed = _collapsed.contains(group.project.id);
                              return _ProjectSection(
                                group: group,
                                colors: colors,
                                collapsed: collapsed,
                                harnesses: _harnesses,
                                appHarness: _appHarness,
                                onToggle: () {
                                  setState(() {
                                    if (collapsed) {
                                      _collapsed.remove(group.project.id);
                                    } else {
                                      _collapsed.add(group.project.id);
                                    }
                                  });
                                },
                                onOpenTask: _openTask,
                                onPickAgent: (project, harnessId) =>
                                    unawaited(_setProjectAgent(project, harnessId)),
                              );
                            },
                          ),
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _setProjectAgent(ProjectInfo project, String harnessId) async {
    try {
      await widget.client.call('coder.updateProject', {
        'id': project.id,
        'defaults': {'harness': harnessId},
      });
      await _refresh();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not change the project agent.')),
      );
    }
  }

  void _openTask(TaskInfo task) {
    final runId = task.runId;
    if (runId == null || runId.isEmpty) {
      unawaited(
        showNewTaskSheet(
          context: context,
          client: widget.client,
          projects: _projects,
          harnesses: _harnesses,
          initialProjectId: task.projectId,
        ).then((_) => _refresh()),
      );
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RunScreen(
          client: widget.client,
          runId: runId,
          title: task.title,
          harnesses: _harnesses,
          taskId: task.id,
          cwd: task.cwd,
        ),
      ),
    );
  }

  String _stateLabel(HostConnectionState state) => switch (state) {
        HostConnectionState.connected => 'Connected',
        HostConnectionState.connecting => 'Connecting…',
        HostConnectionState.reconnecting => 'Reconnecting — your tasks are still running',
        HostConnectionState.failed => 'Unreachable',
        HostConnectionState.idle => 'Not connected',
      };
}

class _ProjectSection extends StatelessWidget {
  const _ProjectSection({
    required this.group,
    required this.colors,
    required this.collapsed,
    required this.harnesses,
    required this.appHarness,
    required this.onToggle,
    required this.onOpenTask,
    required this.onPickAgent,
  });

  final ProjectGroup group;
  final CoderColors colors;
  final bool collapsed;
  final List<HarnessInfo> harnesses;
  final String? appHarness;
  final VoidCallback onToggle;
  final void Function(TaskInfo task) onOpenTask;
  final void Function(ProjectInfo project, String harnessId) onPickAgent;

  @override
  Widget build(BuildContext context) {
    final currentId = group.project.defaultHarness ?? appHarness;
    final current = harnessById(harnesses, currentId);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          dense: true,
          onTap: onToggle,
          leading: Icon(
            collapsed ? Icons.chevron_right : Icons.expand_more,
            color: colors.foregroundMuted,
          ),
          title: Text(
            group.project.label,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          subtitle: Text(
            group.project.path,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextButton(
                onPressed: harnesses.isEmpty
                    ? null
                    : () => _pickAgent(context),
                child: Text(
                  current?.badge ?? 'Agent',
                  style: TextStyle(fontSize: 11, color: colors.foregroundMuted),
                ),
              ),
              if (group.needsAttention > 0)
                Icon(Icons.circle, size: 8, color: colors.statusDotWarning),
            ],
          ),
        ),
        if (!collapsed)
          ...group.tasks.map((task) {
            return ListTile(
              contentPadding: const EdgeInsets.only(left: 48, right: 16),
              title: Text(task.title),
              subtitle: Text(statusLabel(task.status)),
              leading: Icon(
                Icons.circle,
                size: 8,
                color: _dotFor(task.status, colors),
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => onOpenTask(task),
            );
          }),
        if (!collapsed && group.tasks.isEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(48, 0, 16, 8),
            child: Text(
              'No tasks in this project yet',
              style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
            ),
          ),
      ],
    );
  }

  Future<void> _pickAgent(BuildContext context) async {
    final offered = offeredHarnesses(harnesses);
    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text('Agent for ${group.project.label}')),
            for (final h in offered)
              ListTile(
                title: Text(h.label),
                subtitle: Text(h.id),
                onTap: () => Navigator.pop(context, h.id),
              ),
          ],
        ),
      ),
    );
    if (chosen != null) onPickAgent(group.project, chosen);
  }

  Color _dotFor(String status, CoderColors colors) => switch (status) {
        'needs-attention' => colors.statusDotWarning,
        'failed' => colors.statusDotDanger,
        'running' => colors.statusDotRunning,
        'done' => colors.statusDotSuccess,
        _ => colors.foregroundMuted,
      };
}
