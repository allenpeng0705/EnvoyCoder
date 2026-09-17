/// Work on one paired machine: tasks and runs, attention first.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../models/host.dart';
import '../services/host_client.dart';
import '../theme/tokens.dart';
import 'run_screen.dart';

class HostHomeScreen extends StatefulWidget {
  const HostHomeScreen({super.key, required this.host, required this.client});

  final CoderHost host;
  final HostClient client;

  @override
  State<HostHomeScreen> createState() => _HostHomeScreenState();
}

class _HostHomeScreenState extends State<HostHomeScreen> {
  List<Map<String, dynamic>> _tasks = [];
  List<Map<String, dynamic>> _runs = [];
  String? _error;
  bool _loading = true;
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
      final tasksResult = await widget.client.call('coder.listTasks', {});
      final runsResult = await widget.client.call('coder.listRuns', {'limit': 50});
      final tasks = _asMapList(tasksResult['tasks']);
      final runs = _asMapList(runsResult['runs']);
      tasks.sort(_attentionFirst);
      runs.sort(_runAttentionFirst);
      if (!mounted) return;
      setState(() {
        _tasks = tasks;
        _runs = runs;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load work from this computer. $_friendly("$error")';
      });
    }
  }

  static String _friendly(String raw) {
    // Never echo tokens; keep the sentence short.
    if (raw.contains('token=')) return 'The connection failed.';
    return raw.length > 160 ? '${raw.substring(0, 160)}…' : raw;
  }

  static List<Map<String, dynamic>> _asMapList(Object? value) {
    if (value is! List) return const [];
    return value
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  static int _attentionFirst(Map<String, dynamic> a, Map<String, dynamic> b) {
    return _rank(a['status'] as String?) - _rank(b['status'] as String?);
  }

  static int _runAttentionFirst(Map<String, dynamic> a, Map<String, dynamic> b) {
    return _rank(a['status'] as String?) - _rank(b['status'] as String?);
  }

  static int _rank(String? status) => switch (status) {
        'needs-attention' => 0,
        'failed' => 1,
        'running' => 2,
        'queued' => 3,
        _ => 4,
      };

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
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.host.label),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: () => unawaited(_refresh()),
            icon: const Icon(Icons.refresh),
          ),
        ],
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
                    child: ListView(
                      children: [
                        const _SectionHeader('Needs attention'),
                        ..._tasks
                            .where((t) => t['status'] == 'needs-attention' || t['status'] == 'failed')
                            .map(_taskTile),
                        if (_tasks.every((t) =>
                            t['status'] != 'needs-attention' && t['status'] != 'failed'))
                          const ListTile(
                            dense: true,
                            title: Text('Nothing waiting on you'),
                          ),
                        const _SectionHeader('Tasks'),
                        if (_tasks.isEmpty)
                          const ListTile(dense: true, title: Text('No tasks yet'))
                        else
                          ..._tasks.map(_taskTile),
                        const _SectionHeader('Runs'),
                        if (_runs.isEmpty)
                          const ListTile(dense: true, title: Text('No runs yet'))
                        else
                          ..._runs.map(_runTile),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _taskTile(Map<String, dynamic> task) {
    final title = (task['title'] as String?)?.trim();
    final status = task['status'] as String? ?? '';
    final runId = task['runId'] as String?;
    return ListTile(
      title: Text((title == null || title.isEmpty) ? 'Untitled task' : title),
      subtitle: Text(status),
      trailing: const Icon(Icons.chevron_right),
      onTap: () {
        if (runId == null || runId.isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('This task has no live run yet.')),
          );
          return;
        }
        _openRun(runId, title ?? 'Run');
      },
    );
  }

  Widget _runTile(Map<String, dynamic> run) {
    final id = run['id'] as String? ?? '';
    final status = run['status'] as String? ?? '';
    final harness = run['harness'] as String? ?? 'agent';
    return ListTile(
      title: Text(harness),
      subtitle: Text(status),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => _openRun(id, harness),
    );
  }

  void _openRun(String runId, String title) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RunScreen(
          client: widget.client,
          runId: runId,
          title: title,
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

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(label, style: Theme.of(context).textTheme.titleMedium),
    );
  }
}
