/// Work on the active machine: projects → tasks, stable order, searchable.
///
/// This is the app's first screen. It is a *host* screen only in that it happens to show one host at
/// a time — the top bar names which one, and the Connections button changes it. The former host-list
/// page did the naming by being the page before this one; a phone paired to a single desktop paid a
/// whole screen's worth of taps on every launch for that, and the owner's ask is that the work be
/// the first thing on screen.
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
import '../theme/project_mark.dart';
import '../theme/tokens.dart';
import '../widgets/confirm_dialog.dart';
import '../widgets/name_dialog.dart';
import 'new_task_sheet.dart';
import 'add_project_sheet.dart';
import 'run_screen.dart';

class ProjectListScreen extends StatefulWidget {
  const ProjectListScreen({
    super.key,
    required this.host,
    required this.client,
    required this.onOpenConnections,
    required this.onAddHost,
    required this.onShowSettings,
  });

  final CoderHost host;
  final HostClient client;

  /// Opens the Connections view: switch host, add one, forget one.
  final VoidCallback onOpenConnections;

  /// The top bar's **Add host** button. The shell owns it because pairing writes to the store and
  /// spawns a client, neither of which belongs to a screen that is only showing one host's work.
  final VoidCallback onAddHost;

  /// Settings for *this* host's daemon. A callback rather than a push from here, so the screen needs
  /// no `SettingsScreen` import and the shell keeps owning where a route comes from.
  final void Function(HostClient client, List<HarnessInfo> harnesses) onShowSettings;

  @override
  State<ProjectListScreen> createState() => _ProjectListScreenState();
}

class _ProjectListScreenState extends State<ProjectListScreen> {
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

  /// The create-task sheet for one project — the only way a task starts now.
  ///
  /// The old floating "New task" button had to be answered with *which project*, so it opened the
  /// same sheet showing a project dropdown. A row that carries its own button already knows the
  /// answer, and the sheet opens with that project preselected and no dropdown to get wrong.
  Future<void> _newTaskFor(ProjectInfo project) async {
    await showNewTaskSheet(
      context: context,
      client: widget.client,
      projects: _projects,
      harnesses: _harnesses,
      initialProjectId: project.id,
    );
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    final state = widget.client.state;
    final badge = attentionBadge(_tasks);
    final groups = _visibleGroups;

    return Scaffold(
      appBar: AppBar(
        // The machine the work belongs to, with its health as a dot beside it. The old "Connected
        // <address>" tile took a whole row under the bar to say the same thing; the dot keeps the
        // fact and gives the row back to the list.
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _StatusDot(state: state, colors: colors),
            const SizedBox(width: CoderSpace.md),
            Flexible(child: Text(widget.host.label, overflow: TextOverflow.ellipsis)),
          ],
        ),
        actions: [
          if (badge > 0)
            Padding(
              padding: const EdgeInsets.only(right: CoderSpace.sm),
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
          // A labelled button rather than a bare icon: "Connections" is the answer to "which machine
          // am I on?", and an icon alone does not say that.
          TextButton(
            onPressed: widget.onOpenConnections,
            child: const Text('Connections'),
          ),
          IconButton(
            tooltip: 'Add host',
            onPressed: widget.onAddHost,
            icon: const Icon(Icons.add_link),
          ),
          PopupMenuButton<_HostMenuAction>(
            tooltip: 'More',
            onSelected: (action) => switch (action) {
              _HostMenuAction.addProject => unawaited(_addProject()),
              _HostMenuAction.settings => widget.onShowSettings(widget.client, _harnesses),
            },
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: _HostMenuAction.addProject,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.create_new_folder_outlined),
                  title: Text('Add project'),
                ),
              ),
              const PopupMenuItem(
                value: _HostMenuAction.settings,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.settings),
                  title: Text('Settings'),
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              CoderSpace.md2,
              CoderSpace.md,
              CoderSpace.md2,
              CoderSpace.sm,
            ),
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
              padding: const EdgeInsets.all(CoderSpace.lg),
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
                                      const SizedBox(height: CoderSpace.lg),
                                      FilledButton.tonalIcon(
                                        onPressed: () => unawaited(_addProject()),
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
                              return Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  // A project is a place, and two places need a line between them:
                                  // without one the tasks of the second read as children of the first.
                                  // The desktop draws the same line as a `border-top` on every group
                                  // but the first (`styles.css:522-526`); this `Divider` carries no
                                  // colour, thickness or space of its own, so all three come from the
                                  // theme's `dividerTheme` (`tokens.dart`: `colors.border`,
                                  // thickness 1, space 1). That is the app's existing divider token,
                                  // not a value invented for this row.
                                  if (index > 0) const Divider(),
                                  _ProjectSection(
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
                                    onOpenTask: (task) => unawaited(_openTask(task)),
                                    onNewTask: () => unawaited(_newTaskFor(group.project)),
                                    onRemove: () => unawaited(_removeProject(group.project)),
                                    onArchiveTask: (task) => unawaited(_archiveTask(task)),
                                    onRenameTask: (task) => unawaited(_renameTask(task)),
                                    onPickAgent: (project, harnessId) =>
                                        unawaited(_setProjectAgent(project, harnessId)),
                                  ),
                                ],
                              );
                            },
                          ),
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _addProject() async {
    final id = await showAddProjectSheet(
      context: context,
      client: widget.client,
      harnesses: _harnesses,
    );
    if (id != null) await _refresh();
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

  /// Take a project out of the list, after a confirmation that names its tasks' fate.
  ///
  /// **Why "Remove" and not "Delete".** `coder.removeProject` (`packages/protocol/src/rpc.ts:1899`)
  /// drops EnvoyDev's project row for good and archives that project's tasks rather than deleting
  /// them (`apps/desktop/src/daemon/store.ts:487-504`). Nothing in the user's folder is touched, so
  /// "Delete" would be a lie about their files, and "Archive project" would be a lie about the row,
  /// which has no un-remove. This is the destructive one of the pair: the project cannot be brought
  /// back, only added again as a fresh registration.
  ///
  /// **No optimistic removal.** The row is only allowed to leave when the daemon has answered, so a
  /// refusal (an older daemon without the method, a connection that drops mid-call) leaves the list
  /// showing the project that still exists server-side instead of a screen that lied and will
  /// silently disagree with the next refresh.
  Future<void> _removeProject(ProjectInfo project) async {
    final confirmed = await showConfirmDialog(
      context,
      title: 'Remove ${project.label}?',
      message: 'The project leaves EnvoyDev and its tasks leave the list — they are archived, not '
          'deleted, and nothing in that folder is touched. Removing the project cannot be undone.',
      confirmLabel: 'Remove project',
    );
    if (!confirmed || !mounted) return;

    int archived = 0;
    try {
      final result = await widget.client.call('coder.removeProject', {'id': project.id});
      final list = result['archived'];
      if (list is List) archived = list.length;
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not remove ${project.label}. It is still in the list.')),
      );
      return;
    }
    // The row is gone, so an id left in the collapsed set is only stale bookkeeping.
    _collapsed.remove(project.id);
    await _refresh();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          archived == 0
              ? 'Removed ${project.label}.'
              : 'Removed ${project.label}. ${archived == 1 ? '1 task was' : '$archived tasks were'} '
                  'archived.',
        ),
      ),
    );
  }

  /// Archive one task out of the list.
  ///
  /// **Why "Archive" and not "Remove"/"Delete".** There is no task delete in the protocol: the only
  /// operation is `coder.archiveTask` (`packages/protocol/src/rpc.ts:2086`), which stamps
  /// `archivedAt` (`apps/desktop/src/daemon/store.ts:582-594`) and can be reversed with
  /// `archived: false`. It is not destructive — the folder, its files and the transcript stay on the
  /// computer — so the menu item says Archive and the confirm is not coloured as danger. (The desktop
  /// sidebar labels the same RPC "Remove task"; the confirmation there says "it leaves the rail and
  /// is archived". This app says Archive outright, because that is the verb the protocol implements —
  /// AGENTS.md non-negotiable #4. The desktop's own "Remove task" is the inaccurate label; it is
  /// flagged for a follow-up rather than edited from here.)
  ///
  /// Deliberately **not** promised in the dialog: an in-app undo. The daemon can un-archive, but no
  /// screen in either app offers it yet, and "you can bring it back" would be a capability this UI
  /// does not provide.
  Future<void> _archiveTask(TaskInfo task) async {
    final confirmed = await showConfirmDialog(
      context,
      title: 'Archive ${task.title}?',
      message: 'It leaves the task list. The folder, its files and the transcript stay on this '
          'computer — archiving is not deletion.',
      confirmLabel: 'Archive',
      destructive: false,
    );
    if (!confirmed || !mounted) return;

    try {
      await widget.client.call('coder.archiveTask', {'id': task.id, 'archived': true});
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not archive ${task.title}. It is still in the list.')),
      );
      return;
    }
    await _refresh();
  }

  /// Rename one task, through the daemon and only after it has answered.
  ///
  /// **This one is a real RPC.** Unlike a connection's name, which is the phone's own fact and is
  /// written locally, a task's title belongs to the daemon: `coder.updateTask` carries `title`
  /// (`packages/protocol/src/rpc.ts:2050`) and the store persists it
  /// (`apps/desktop/src/daemon/store.ts:545`). The row is therefore **not** edited optimistically —
  /// the list is refetched after the call so what is on screen is what the daemon holds. A refusal
  /// (an older daemon, a link that drops mid-call) leaves the old title visible and says so.
  ///
  /// The dialog refuses a blank name itself (a task always has a title; clearing it is not a rename),
  /// and Enter submits, so the common case is: open, edit, Enter.
  Future<void> _renameTask(TaskInfo task) async {
    final next = await showNameDialog(
      context,
      title: 'Rename task',
      fieldLabel: 'Task name',
      initialValue: task.title,
      confirmLabel: 'Rename',
      emptyError: 'Enter a name for this task.',
    );
    if (next == null || !mounted) return;
    // The daemon answers with the task it stored; writing the same name back is a no-op, not an
    // error, and refreshing on it would only make the list flicker.
    if (next == task.title) return;

    try {
      await widget.client.call('coder.updateTask', {'id': task.id, 'title': next});
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not rename ${task.title}. The name is unchanged.')),
      );
      return;
    }
    await _refresh();
  }

  Future<void> _openTask(TaskInfo task) async {
    final runId = task.runId;
    if (runId == null || runId.isEmpty) {
      await showNewTaskSheet(
        context: context,
        client: widget.client,
        projects: _projects,
        harnesses: _harnesses,
        initialProjectId: task.projectId,
      );
      await _refresh();
      return;
    }
    // The run screen can archive the task it is showing, and it pops `true` when it does. Refreshing
    // on that answer is what keeps the list under it from still offering a task that is now archived;
    // any other way back (back button, a plain close) pops nothing and skips the refetch.
    final archived = await Navigator.of(context).push<bool>(
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
    if (archived == true) await _refresh();
  }
}

enum _HostMenuAction { addProject, settings }

/// The connection's health, as a dot beside the host's name.
///
/// A dot and not a sentence: the address and the route live one tap away in the Connections sheet,
/// and the project list is not the place to read a status page. What it must do is make "unreachable"
/// visible without opening anything — a list of tasks that is silently stale is worse than no list.
class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.state, required this.colors});

  final HostConnectionState state;
  final CoderColors colors;

  @override
  Widget build(BuildContext context) {
    final color = switch (state) {
      HostConnectionState.connected => colors.statusDotSuccess,
      HostConnectionState.reconnecting => colors.statusDotWarning,
      HostConnectionState.failed => colors.statusDotDanger,
      HostConnectionState.connecting => colors.statusDotRunning,
      HostConnectionState.idle => colors.foregroundExtraMuted,
    };
    final label = switch (state) {
      HostConnectionState.connected => 'Connected',
      HostConnectionState.connecting => 'Connecting',
      HostConnectionState.reconnecting => 'Reconnecting — your tasks are still running',
      HostConnectionState.failed => 'Unreachable',
      HostConnectionState.idle => 'Not connected',
    };
    // Semantics + tooltip, the repo's rule for anything whose whole meaning is a colour.
    return Tooltip(
      message: label,
      child: Semantics(
        label: label,
        child: Icon(Icons.circle, size: 10, color: color),
      ),
    );
  }
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
    required this.onNewTask,
    required this.onRemove,
    required this.onArchiveTask,
    required this.onRenameTask,
    required this.onPickAgent,
  });

  final ProjectGroup group;
  final CoderColors colors;
  final bool collapsed;
  final List<HarnessInfo> harnesses;
  final String? appHarness;
  final VoidCallback onToggle;
  final void Function(TaskInfo task) onOpenTask;
  final VoidCallback onNewTask;
  final VoidCallback onRemove;
  final void Function(TaskInfo task) onArchiveTask;
  final void Function(TaskInfo task) onRenameTask;
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
          leading: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                collapsed ? Icons.chevron_right : Icons.expand_more,
                color: colors.foregroundMuted,
              ),
              const SizedBox(width: CoderSpace.sm),
              // The letter tile the desktop rail leads with, so the same repository is recognisable
              // by the same mark on both surfaces. The letter rule and the ten tones are the
              // desktop's, not a mobile invention — see `theme/project_mark.dart`.
              ProjectMark(projectId: group.project.id, label: group.project.label),
            ],
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
              if (group.needsAttention > 0)
                Padding(
                  padding: const EdgeInsets.only(right: CoderSpace.sm),
                  child: Icon(Icons.circle, size: 8, color: colors.statusDotWarning),
                ),
              // Where a task starts now, and the row's only *verb*: a `+`, where the agent chip, the
              // add-task glyph and Remove used to share this space three ways. It sits on the project
              // row because the project is the thing that gives the task its folder and its default
              // agent — the answer to "which project?" is the row itself, so the sheet opens already
              // knowing it.
              Semantics(
                label: 'New task in ${group.project.label}',
                button: true,
                child: IconButton(
                  tooltip: 'New task in ${group.project.label}',
                  onPressed: onNewTask,
                  icon: const Icon(Icons.add),
                ),
              ),
              // Everything the row can *do* besides start work now lives behind the `…`. That is the
              // desktop's split too (`CoderSidebar.tsx:339-370`): the row keeps the one control that
              // creates work, the menu carries the agent and the destructive action.
              _ProjectOverflowMenu(
                projectLabel: group.project.label,
                agentBadge: current?.badge,
                canPickAgent: harnesses.isNotEmpty,
                onPickAgent: () => unawaited(_pickAgent(context)),
                onRemove: onRemove,
                destructive: colors.destructive,
              ),
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
              // What the row can *do* besides open, behind the `…`: Rename and Archive — the same two
              // actions the desktop task row offers (`CoderSidebar.tsx:557-583`), reached the same way
              // the project row reaches its own secondary actions. The chevron stays beside it, so the
              // row still reads as "tap me to open" without a word of explanation.
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _TaskOverflowMenu(
                    taskTitle: task.title,
                    onRename: () => onRenameTask(task),
                    onArchive: () => onArchiveTask(task),
                  ),
                  const Icon(Icons.chevron_right),
                ],
              ),
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

/// Which item of a project row's `…` was chosen.
enum _ProjectMenuAction { agent, remove }

/// The project row's `…`: the agent new tasks inherit, and Remove project.
///
/// **Why these two, and not two more buttons on the row.** A row has room for one verb — starting
/// work — and the desktop rail makes the same split (`CoderSidebar.tsx:339-370`): the agent and the
/// destructive action are menu items, and the trigger's label names the row it acts on. Three
/// controls squeezed into a 320pt row is what made this row overflow; two is what fits.
///
/// **Why the agent item is still tappable.** The badge it replaces was not decoration: it opened the
/// picker that writes `project.defaults.harness`. Folding it into the menu while dropping the write
/// would have silenced a capability, so the item reads the agent *and* opens the same picker, one tap
/// deeper. When `coder.listHarnesses` has not answered there is nothing to pick and the item is
/// disabled exactly as the old chip was — but the name, when there is one, still shows.
///
/// The trigger is icon-only, so it carries a tooltip **and** a `Semantics` label, and the label names
/// its row ("More actions for Repo A") so a screen reader facing two of these can tell them apart.
class _ProjectOverflowMenu extends StatelessWidget {
  const _ProjectOverflowMenu({
    required this.projectLabel,
    required this.agentBadge,
    required this.canPickAgent,
    required this.onPickAgent,
    required this.onRemove,
    required this.destructive,
  });

  final String projectLabel;

  /// The resolved agent's short name (`HarnessInfo.badge`), or null before the harness list arrives.
  final String? agentBadge;

  final bool canPickAgent;
  final VoidCallback onPickAgent;
  final VoidCallback onRemove;
  final Color destructive;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'More actions for $projectLabel',
      button: true,
      child: PopupMenuButton<_ProjectMenuAction>(
        tooltip: 'More actions for $projectLabel',
        onSelected: (action) => switch (action) {
          _ProjectMenuAction.agent => onPickAgent(),
          _ProjectMenuAction.remove => onRemove(),
        },
        itemBuilder: (context) => [
          PopupMenuItem(
            value: _ProjectMenuAction.agent,
            enabled: canPickAgent,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              enabled: canPickAgent,
              leading: const Icon(Icons.smart_toy_outlined),
              // The name the old chip carried. Note for the report: the row has always shown the
              // *agent* badge (`HarnessInfo.badge`), not `project.defaults.model` — this app never
              // parsed a per-project model at all.
              title: Text(agentBadge ?? 'Agent'),
              subtitle: canPickAgent ? const Text('Change agent') : null,
            ),
          ),
          // The destructive one is last and wears the danger colour, and the confirmation behind it is
          // the screen's own `_removeProject` — the wording and the no-optimistic-removal rule are
          // unchanged, only the control they hang off moved.
          const PopupMenuDivider(),
          PopupMenuItem(
            value: _ProjectMenuAction.remove,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.remove_circle_outline, color: destructive),
              title: const Text('Remove project'),
            ),
          ),
        ],
      ),
    );
  }
}

/// Which item of a task row's `…` was chosen.
enum _TaskMenuAction { rename, archive }

/// The task row's `…`: Rename, and the archive that takes the task out of the list.
///
/// **Why `…` and not a second button on the row.** This is the shape the project row above already
/// settled on (`_ProjectOverflowMenu`), and the desktop's task row uses it too
/// (`CoderSidebar.tsx:557-583`): a row has room for the gesture that opens it, and everything else
/// hangs off one menu trigger. Replacing the standalone Archive `IconButton` with this trigger is also
/// what keeps the 320pt layout honest — a `PopupMenuButton` is narrower than the 48pt `IconButton` it
/// replaced, so the change spends no width, it gives some back.
///
/// **Why the removal item still says "Archive".** The owner's ask is parity with the desktop, and the
/// desktop does offer two actions here — Rename and a removal. But the *word* the desktop prints,
/// "Remove task", is the one thing not worth copying: the RPC behind it is `coder.archiveTask`
/// (`packages/protocol/src/rpc.ts:2086`), which stamps `archivedAt` and can be reversed with
/// `archived: false`. The desktop's own confirmation admits as much ("it leaves the rail and is
/// archived"). There is no task delete anywhere in the protocol, so "Remove task" is the inaccurate
/// label, and this app keeps saying Archive — AGENTS.md non-negotiable #4. Desktop is flagged for a
/// follow-up; nothing under `apps/desktop/**` was touched here.
///
/// Icon-only, so it carries a tooltip **and** a `Semantics` label, and the label names the row it acts
/// on so a screen reader facing many of these can tell them apart.
class _TaskOverflowMenu extends StatelessWidget {
  const _TaskOverflowMenu({
    required this.taskTitle,
    required this.onRename,
    required this.onArchive,
  });

  final String taskTitle;
  final VoidCallback onRename;
  final VoidCallback onArchive;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'More actions for $taskTitle',
      button: true,
      child: PopupMenuButton<_TaskMenuAction>(
        tooltip: 'More actions for $taskTitle',
        onSelected: (action) => switch (action) {
          _TaskMenuAction.rename => onRename(),
          _TaskMenuAction.archive => onArchive(),
        },
        itemBuilder: (context) => const [
          PopupMenuItem(
            value: _TaskMenuAction.rename,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.edit_outlined),
              title: Text('Rename task'),
            ),
          ),
          PopupMenuDivider(),
          // Same order as the project row: the thing that changes the row first, the thing that
          // takes it away last. Archive is deliberately not painted in the danger colour — it is
          // reversible and leaves every file on disk, and red here would teach a user to fear a safe
          // action (`confirm_dialog.dart` makes the same call for the same reason).
          PopupMenuItem(
            value: _TaskMenuAction.archive,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.archive_outlined),
              title: Text('Archive task'),
            ),
          ),
        ],
      ),
    );
  }
}
