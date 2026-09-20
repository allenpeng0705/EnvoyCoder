/// Work on the active machine: projects → tasks, stable order, searchable.
///
/// This is the app's first screen. It is a *host* screen only in that it happens to show one host at
/// a time — the top bar is the host control now, split in two: the **name** (tappable) is "which
/// machine am I on?" and opens the Connections sheet to switch or manage, and the **cell tower**
/// beside it is "what state is it in?" and opens that host's network-status ladder. The former
/// host-list page did the naming by being the page before this one; a phone paired to a single
/// desktop paid a whole screen's worth of taps on every launch for that, and the owner's ask is that
/// the work be the first thing on screen.
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
    required this.onOpenNetworkStatus,
    required this.onShowSettings,
  });

  final CoderHost host;
  final HostClient client;

  /// Opens the Connections view: switch host, add one, forget one.
  ///
  /// Reached by tapping the **name** in the top bar. The name is the door because the control it
  /// replaced was the only way to a two-desktop setup; a status glyph is read as an indicator, not as
  /// a picker, so the *name* keeps that job and the glyph is free to mean diagnostics. **Add host now
  /// lives in that sheet too**, at the top of its list — the owner's call: one surface for
  /// connections, not a shortcut in the bar as well.
  final VoidCallback onOpenConnections;

  /// Opens the network-status ladder for [client]'s host — the top bar's cell tower.
  ///
  /// A callback rather than a push from here, for the same reason as [onShowSettings]: the screen
  /// names no route, and the shell keeps owning where one comes from.
  final VoidCallback onOpenNetworkStatus;

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
        // The status **icon** on the left, the connection **name** in the middle, the two facts the
        // old labelled button and dot carried between them — split so neither is hidden. The name is
        // the switcher (tapping it opens the Connections sheet) and the icon is the diagnostic (its
        // colour is the state, and tapping it opens the ladder). See `_ConnectionStatusButton` and
        // `_ConnectionTitle` for why each control is the shape it is.
        leading: _ConnectionStatusButton(
          hostLabel: widget.host.label,
          state: state,
          colors: colors,
          onPressed: widget.onOpenNetworkStatus,
        ),
        title: _ConnectionTitle(
          hostLabel: widget.host.label,
          onTap: widget.onOpenConnections,
        ),
        // **Two direct controls, no overflow menu.** The owner asked for Add project and Settings to
        // be visible rather than hidden behind a `…`, and for Add host to leave the bar entirely (it
        // is the first row of the Connections sheet now). The overflow held exactly those two items
        // and nothing else — checked against the file before it was deleted, so no action lost its
        // home. Removing the trigger also means an icon-only control no longer needs a second tap to
        // say what it does: each `+` and gear carries its own tooltip and Semantics label.
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
          Semantics(
            label: 'Add project',
            button: true,
            child: IconButton(
              tooltip: 'Add project',
              onPressed: () => unawaited(_addProject()),
              icon: const Icon(Icons.add),
            ),
          ),
          Semantics(
            label: 'Settings',
            button: true,
            child: IconButton(
              tooltip: 'Settings',
              onPressed: () => widget.onShowSettings(widget.client, _harnesses),
              icon: const Icon(Icons.settings),
            ),
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

/// The active connection's health, as the top bar's leading cell tower.
///
/// **One indicator, where there used to be two controls.** The labelled `Connections` button said
/// what the surface *was*; the dot beside the name said how the link was doing; the host rows each
/// carried their own cell-tower button for the ladder. The owner asked for the cell tower itself on
/// the top bar and out of the popup, and this is it: the status is on the edge a user scans first,
/// and it is the *only* place a glyph reports it, so the host rows are back to their dot and
/// `· via <route>` line.
///
/// **The convention is EnvoyGo's**, not an invention: `EnvoyGo/lib/widgets/phone_mesh_indicator.dart`
/// renders `Icons.cell_tower` as an `IconButton` whose colour is the state, whose tooltip is the
/// state, and whose tap opens a status sheet (`:40-64`). Same glyph, same colour-as-status, same
/// tap-for-detail — this app's own host-row cell tower already followed it.
///
/// **The intermediate states are the reason it exists.** The owner reported that 5G works but
/// "takes some time" — the LAN rung fails, the relay is dialled, the circuit handshake completes —
/// and nothing on screen explains the gap. So `connecting` and `reconnecting` each get their own
/// colour and their own written status rather than one grey "not connected": a status that cannot
/// say "still trying" hides exactly the seconds the owner noticed.
///
/// **Colour mapping.** EnvoyGo maps connected→green, connecting→orange, error→red, offline→grey.
/// This app has one state EnvoyGo does not (`reconnecting`) and already paints all five from the
/// status *indicator* band (`statusDot*`) in three surfaces — the host row's dot, the Connections
/// sheet's dot, and the network panel's headline. The icon is that same indicator, so it reuses the
/// same mapping rather than becoming a fourth opinion: connected / failed / idle agree with EnvoyGo,
/// and `connecting` is the blue `statusDotRunning` instead of EnvoyGo's orange **because orange
/// already means `reconnecting` here** — collapsing the two would erase the distinction this change
/// is about. (The band-1 `status*` tokens are the documented "icons" band, but they carry no running
/// colour at all; the only way to use them would be to give connecting and reconnecting one hue.)
class _ConnectionStatusButton extends StatelessWidget {
  const _ConnectionStatusButton({
    required this.hostLabel,
    required this.state,
    required this.colors,
    required this.onPressed,
  });

  final String hostLabel;
  final HostConnectionState state;
  final CoderColors colors;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final color = switch (state) {
      HostConnectionState.connected => colors.statusDotSuccess,
      HostConnectionState.reconnecting => colors.statusDotWarning,
      HostConnectionState.failed => colors.statusDotDanger,
      HostConnectionState.connecting => colors.statusDotRunning,
      HostConnectionState.idle => colors.foregroundExtraMuted,
    };
    // The tooltip and the accessibility label are the same sentence, and both name the status: a
    // bare glyph is not a status. It leads with "Network status for <host>" so it cannot be mistaken
    // for the name's "switch" control an inch to its right, and it names the computer because that
    // is what a screen reader lands on first.
    final label = 'Network status for $hostLabel — ${state.label}';
    return Semantics(
      label: label,
      button: true,
      child: IconButton(
        tooltip: label,
        onPressed: onPressed,
        icon: Icon(Icons.cell_tower, color: color),
      ),
    );
  }
}

/// The active connection's name, and the door to switching it.
///
/// The name answers "which machine am I on?" and the tap answers "how do I reach the other one?",
/// which keeps the door the removed `Connections` button used to be. The owner's refinement is the
/// reason the two facts are split: a status glyph is read as an indicator, not a picker, so the
/// *name* opens the Connections sheet (all machines, their dots, the current one marked) and the
/// glyph is free to mean diagnostics. With the overflow menu gone this is the **only** door to
/// switching, so the caret is load-bearing: a bare title does not read as a menu trigger, and the
/// owner accepted the trade deliberately.
///
/// **Single line, ellipsized, full name in the tooltip and the Semantics label.** The name is
/// user-set — "Shileipeng's MacBook Pro (work)" is a realistic value — so it must be able to shrink
/// without ever pushing Add project or Settings off the bar.
class _ConnectionTitle extends StatelessWidget {
  const _ConnectionTitle({required this.hostLabel, required this.onTap});

  final String hostLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    return Tooltip(
      message: hostLabel,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(CoderRadius.md),
        child: Semantics(
          label: 'Switch connection — current: $hostLabel',
          button: true,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  hostLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: CoderSpace.xs),
              // The affordance: a bare title does not read as a menu trigger. It is the dropdown
              // caret, not the project rows' expand chevron, so the two are not confused.
              Icon(
                Icons.arrow_drop_down,
                size: 20,
                color: colors.foregroundMuted,
              ),
            ],
          ),
        ),
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
