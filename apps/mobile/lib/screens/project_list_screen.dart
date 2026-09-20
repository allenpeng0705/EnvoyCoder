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

import '../l10n/daemon_text.dart';
import '../l10n/l10n.dart';
import '../models/git.dart';
import '../models/harness.dart';
import '../models/host.dart';
import '../models/project_rail.dart';
import '../services/host_client.dart';
import '../theme/project_mark.dart';
import '../theme/tokens.dart';
import '../widgets/confirm_dialog.dart';
import '../widgets/name_dialog.dart';
import '../widgets/project_branches_sheet.dart';
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

  /// What the desktop last answered about each project's repository, and its branches.
  ///
  /// Measured **once per project, when its section is opened**, and never on a list refresh: a refresh
  /// happens on every run event, and a `git status` per project per event is a spawn storm on the desk for
  /// a fact nobody is looking at.
  final Map<String, GitStatusInfo> _git = {};
  final Map<String, List<GitBranchInfo>> _gitBranches = {};
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
      // `context.l10n` only after an await: this runs from `initState`, and an inherited lookup
      // before the first build would assert.
      if (!mounted) return;
      final l10n = context.l10n;
      final projects = _asMapList(projectsResult['projects']).map(ProjectInfo.fromJson).toList();
      final tasks = _asMapList(tasksResult['tasks']).map((e) => TaskInfo.fromJson(e, l10n: l10n)).toList();
      final groups = groupByProject(projects: projects, tasks: tasks, l10n: l10n);
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
      final l10n = context.l10n;
      setState(() {
        _loading = false;
        // The daemon prefixes its code and appends its catalogue key; neither belongs on screen.
        _error = l10n.projectListCouldNotLoad(_friendly(l10n, daemonErrorText(l10n, "$error")));
      });
    }
  }

  static String _friendly(AppLocalizations l10n, String raw) {
    if (raw.contains('token=')) return l10n.commonConnectionFailed;
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
      // The app's own default agent, so the sheet resolves the same agent the daemon will use when the
      // project has not set one. It is only context for the model / mode / thinking chips: the sheet
      // never sends a task-level harness (see `showNewTaskSheet`).
      appHarness: _appHarness,
    );
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
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
                    l10n.projectListAttention(badge),
                    style: TextStyle(color: colors.statusWarning, fontSize: 12),
                  ),
                ),
              ),
            ),
          Semantics(
            label: l10n.addProjectTitle,
            button: true,
            child: IconButton(
              tooltip: l10n.addProjectTitle,
              onPressed: () => unawaited(_addProject()),
              icon: const Icon(Icons.add),
            ),
          ),
          Semantics(
            label: l10n.settingsTitle,
            button: true,
            child: IconButton(
              tooltip: l10n.settingsTitle,
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
              decoration: InputDecoration(
                hintText: l10n.projectListSearchHint,
                prefixIcon: const Icon(Icons.search, size: 20),
                border: const OutlineInputBorder(),
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
                                          ? l10n.projectListNoProjects
                                          : l10n.projectListNoMatch,
                                      style: TextStyle(color: colors.foregroundMuted),
                                      textAlign: TextAlign.center,
                                    ),
                                    if (_query.trim().isEmpty &&
                                        state == HostConnectionState.connected) ...[
                                      const SizedBox(height: CoderSpace.lg),
                                      FilledButton.tonalIcon(
                                        onPressed: () => unawaited(_addProject()),
                                        icon: const Icon(Icons.create_new_folder_outlined),
                                        label: Text(l10n.addProjectTitle),
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
                                    gitStatus: _git[group.project.id],
                                    onBranches: () => unawaited(_openBranches(group.project)),
                                    onToggle: () {
                                      if (collapsed) unawaited(_ensureGit(group.project));
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

  /// Measure a project's repository, and remember it until something writes.
  ///
  /// [again] is what the **branch sheet** passes: the branch and the merge state move under this phone — the
  /// agent, the desktop, another window — and the sheet is where a user acts on those facts, so it is handed a
  /// fresh measurement every time it opens. The chip on the row keeps the cached reading, because measuring
  /// every project on every rebuild is the spawn storm the cache exists to prevent, and a write made from here
  /// reports its own answer. A failed *forced* read drops what was cached rather than handing the sheet a
  /// reading the daemon has just failed to confirm.
  Future<void> _ensureGit(ProjectInfo project, {bool again = false}) async {
    if (!again && _git.containsKey(project.id)) return;
    if (project.vcsKind != 'git') return;
    try {
      final result = await widget.client.call('coder.gitStatus', {'projectId': project.id});
      final status = GitStatusInfo.fromJson(result);
      if (!status.isRepository) return;
      final listed = await widget.client.call('coder.gitBranches', {'projectId': project.id});
      final raw = listed['branches'];
      final branches = raw is List
          ? [
              for (final item in raw)
                if (item is Map) GitBranchInfo.fromJson(Map<String, dynamic>.from(item)),
            ]
          : <GitBranchInfo>[];
      if (mounted) {
        setState(() {
          _git[project.id] = status;
          _gitBranches[project.id] = branches;
        });
      }
    } catch (_) {
      // A folder git cannot answer about is a project without a branch chip, not an error on the list: the
      // branch sheet is where the daemon's own sentence belongs, and a project that is not a repository is
      // the normal case this whole surface is optional for.
      if (again && mounted) {
        setState(() {
          _git.remove(project.id);
          _gitBranches.remove(project.id);
        });
      }
    }
  }

  Future<void> _openBranches(ProjectInfo project) async {
    // **Measured on every open, not once per project.** The desktop does the same (`ProjectBranches.tsx`), for
    // the same reason: a merge recorded, a branch switched or a conflict resolved somewhere else must not be
    // invisible in — or worse, actable from — a sheet showing an earlier visit's reading.
    await _ensureGit(project, again: true);
    final status = _git[project.id];
    if (status == null) {
      // Worth saying rather than doing nothing: the sheet is behind a menu item that was enabled because
      // this project *is* a repository.
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.commonConnectionFailed)),
      );
      return;
    }
    if (!mounted) return;
    await showProjectBranchesSheet(
      context: context,
      client: widget.client,
      project: project,
      status: status,
      branches: _gitBranches[project.id] ?? const [],
      onChanged: (next, branches) {
        if (!mounted) return;
        setState(() {
          _git[project.id] = next;
          _gitBranches[project.id] = branches;
        });
      },
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
        SnackBar(content: Text(context.l10n.projectListCouldNotChangeAgent)),
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
    final l10n = context.l10n;
    final confirmed = await showConfirmDialog(
      context,
      title: l10n.projectListRemoveTitle(project.label),
      message: l10n.projectListRemoveMessage,
      confirmLabel: l10n.projectListRemoveConfirm,
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
        SnackBar(content: Text(l10n.projectListRemoveFailed(project.label))),
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
              ? l10n.projectListRemoved(project.label)
              : l10n.projectListRemovedArchived(project.label, archived),
        ),
      ),
    );
  }

  /// Take one task out of the list.
  ///
  /// **The operation is archive; the menu item says "Remove".** There is no task delete in the
  /// protocol: the only operation is `coder.archiveTask` (`packages/protocol/src/rpc.ts:2086`), which
  /// stamps `archivedAt` (`apps/desktop/src/daemon/store.ts:582-594`) and can be reversed with
  /// `archived: false`. It is not destructive — the folder, its files and the transcript stay on the
  /// computer. The owner asked for the short verb here, and the desktop already labels the same RPC
  /// "Remove" (`apps/desktop/src/i18n/messages/en.ts:169`, `task.remove`), so the window and the phone
  /// now say the same word for the same call. **The sentence behind it is what stays honest**: the
  /// confirm names what leaves (the list) and what does not (the folder, files, transcript), so
  /// "Remove" is never read as "Delete". Nothing here claims a capability the protocol lacks
  /// (AGENTS.md non-negotiable #4) — the button is a list verb, the dialog is the daemon's truth.
  ///
  /// Deliberately **not** promised in the dialog: an in-app undo. The daemon can un-archive, but no
  /// screen in either app offers it yet, and "you can bring it back" would be a capability this UI
  /// does not provide.
  Future<void> _archiveTask(TaskInfo task) async {
    final l10n = context.l10n;
    final confirmed = await showConfirmDialog(
      context,
      title: l10n.taskRemoveTitle(task.title),
      message: l10n.taskRemoveMessage,
      confirmLabel: l10n.commonRemove,
      destructive: false,
    );
    if (!confirmed || !mounted) return;

    try {
      await widget.client.call('coder.archiveTask', {'id': task.id, 'archived': true});
    } catch (_) {
      if (!mounted) return;
      // "Remove", not "archive": the error names the action the user took, and the second sentence
      // still says where the task ended up (still listed), so it cannot be read as a lost delete.
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.projectListRemoveTaskFailed(task.title))),
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
    final l10n = context.l10n;
    final next = await showNameDialog(
      context,
      title: l10n.projectListRenameTaskTitle,
      fieldLabel: l10n.projectListRenameTaskField,
      initialValue: task.title,
      confirmLabel: l10n.commonRename,
      emptyError: l10n.projectListRenameTaskEmpty,
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
        SnackBar(content: Text(l10n.projectListRenameTaskFailed(task.title))),
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
        // Same resolution as `_newTaskFor`: the project's agent, else the app default.
        appHarness: _appHarness,
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
class _ConnectionStatusButton extends StatefulWidget {
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
  State<_ConnectionStatusButton> createState() => _ConnectionStatusButtonState();
}

/// Test seam: the pulse, by key, so a widget test can read the painted opacity directly instead of
/// inferring "is it animating?" from wall-clock timing. Public because the test imports this screen.
const Key connectionStatusPulseKey = ValueKey<String>('connectionStatusPulse');

class _ConnectionStatusButtonState extends State<_ConnectionStatusButton>
    with SingleTickerProviderStateMixin {
  /// One full bright → dim → bright breath.
  ///
  /// ~1.2s is the calm end of the brief: fast enough that a two- or three-second relay handshake
  /// shows visible motion, slow enough that it reads as "working" rather than as an alarm. A blink
  /// was rejected — this is a status glyph, and a blink is what a failure looks like.
  static const Duration _pulsePeriod = Duration(milliseconds: 1200);

  /// The dim end of the breath: the state's **own** token at reduced opacity, never a second hue.
  /// 0.35 keeps the hue legible at the dim end, so "which state is it?" is still readable mid-pulse.
  static const double _dimOpacity = 0.35;

  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: _pulsePeriod,
  );

  /// Full token → dimmed token → full token, eased so the turnarounds are not abrupt. `repeat()`
  /// (not `reverse: true`) makes this sequence the whole period, so `_pulsePeriod` is the period.
  late final Animation<double> _opacity = TweenSequence<double>([
    TweenSequenceItem(
      tween: Tween<double>(begin: 1.0, end: _dimOpacity)
          .chain(CurveTween(curve: Curves.easeInOut)),
      weight: 1,
    ),
    TweenSequenceItem(
      tween: Tween<double>(begin: _dimOpacity, end: 1.0)
          .chain(CurveTween(curve: Curves.easeInOut)),
      weight: 1,
    ),
  ]).animate(_controller);

  bool _reduceMotion = false;

  /// The two states the app is still *working toward* — the only ones that may animate.
  ///
  /// `connected`, `failed` and `idle` are settled facts. A pulse on a completed connection says
  /// "still working" about something that is done, which is a worse lie than a still icon; on
  /// `failed`/`idle` it would promise progress that is not happening. `connecting` and
  /// `reconnecting` are exactly the owner's "5G takes some time" window, where nothing moving made
  /// a working connection indistinguishable from a hung one.
  static bool _isInProgress(HostConnectionState state) =>
      state == HostConnectionState.connecting ||
      state == HostConnectionState.reconnecting;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // `disableAnimations` is the platform/accessibility "reduce motion" flag, and it is read here
    // rather than in `initState` because it comes from an inherited widget. A continuous pulse is
    // exactly the decoration that flag exists to suppress, so honour it: stop the ticker and paint
    // the full-strength token. This runs before the first build, so the static branch is the first
    // frame — a reduced-motion user never sees a single pulse.
    _reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    _syncPulse();
  }

  @override
  void didUpdateWidget(covariant _ConnectionStatusButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) _syncPulse();
  }

  /// Run the breath only for a transitional state when motion is allowed; stop it otherwise.
  ///
  /// Leaving a settled state also resets `value` to 0, which is the full-strength token: a pulse
  /// caught mid-dim must not linger on a `connected`/`failed`/`idle` glyph, or the still icon would
  /// depend on *when* the state changed.
  void _syncPulse() {
    if (!_reduceMotion && _isInProgress(widget.state)) {
      if (!_controller.isAnimating) _controller.repeat();
    } else {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    // The ticker is owned here and must not outlive the widget: a repeating controller left running
    // is both a leak and the thing that makes a `pumpAndSettle` on this screen never settle.
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = switch (widget.state) {
      HostConnectionState.connected => widget.colors.statusDotSuccess,
      HostConnectionState.reconnecting => widget.colors.statusDotWarning,
      HostConnectionState.failed => widget.colors.statusDotDanger,
      HostConnectionState.connecting => widget.colors.statusDotRunning,
      HostConnectionState.idle => widget.colors.foregroundExtraMuted,
    };
    // The tooltip and the accessibility label are the same sentence, and both name the status: a
    // bare glyph is not a status. It leads with "Network status for <host>" so it cannot be mistaken
    // for the name's "switch" control an inch to its right, and it names the computer because that
    // is what a screen reader lands on first. Motion never carries the meaning on its own: the
    // label keeps saying "Connecting" whether or not the pulse is running.
    final l10n = context.l10n;
    final label = l10n.projectListNetworkStatusFor(widget.hostLabel, widget.state.labelFor(l10n));
    return Semantics(
      label: label,
      button: true,
      child: IconButton(
        tooltip: label,
        onPressed: widget.onPressed,
        // The fade wraps only the glyph, so neither the tap target nor the icon's 24pt size moves.
        // With reduced motion, `AlwaysStoppedAnimation(1)` pins the token at full strength.
        icon: FadeTransition(
          key: connectionStatusPulseKey,
          opacity: _reduceMotion ? const AlwaysStoppedAnimation<double>(1) : _opacity,
          child: Icon(Icons.cell_tower, color: color),
        ),
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
          label: context.l10n.projectListSwitchConnection(hostLabel),
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
    required this.gitStatus,
    required this.onBranches,
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

  /// What the desktop answered about this project's repository, if it has been asked.
  final GitStatusInfo? gitStatus;
  final VoidCallback onBranches;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
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
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                group.project.path,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
              ),
              // **The branch, once the desktop has been asked.** Measured when the section is opened rather
              // than with the project list, so a rail of ten projects does not spawn twenty gits on every
              // refresh — and it is where a user looks after a checkout: the same row, one line down.
              if (gitStatus != null)
                InkWell(
                  onTap: onBranches,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.account_tree_outlined, size: 13, color: colors.foregroundMuted),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            // **A conflict outranks the branch name here**, because it is the one state on this
                            // row a user has to act on; the sheet it opens names the branch and the files.
                            gitStatus!.merge != null && gitStatus!.conflicted
                                ? l10n.gitBranchesConflictsChip
                                : gitStatus!.branch ?? l10n.gitBranchesDetachedChip,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: gitStatus!.detached || (gitStatus!.merge != null && gitStatus!.conflicted)
                                  ? colors.statusWarning
                                  : colors.foreground,
                              fontSize: 12,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
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
                label: l10n.projectListNewTaskIn(group.project.label),
                button: true,
                child: IconButton(
                  tooltip: l10n.projectListNewTaskIn(group.project.label),
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
                // Branches are only offered for a folder the desktop measured as a git repository: the menu
                // item is the one place a user can reach them before the branch line exists.
                canPickBranch: group.project.vcsKind == 'git',
                onPickBranches: onBranches,
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
              subtitle: Text(statusLabelFor(l10n, task.status)),
              leading: Icon(
                Icons.circle,
                size: 8,
                color: _dotFor(task.status, colors),
              ),
              // What the row can *do* besides open, behind the `…`: Rename and Remove — the same two
              // actions the desktop task row offers (`CoderSidebar.tsx:557-583`), reached the same way
              // the project row reaches its own secondary actions.
              //
              // **No trailing `>`.** The owner asked for it gone, and the row does not need it: the
              // subtitle already says the status in words, and the `…` announces itself as the row's
              // actions. The glyph was never a tap target of its own — the whole `ListTile`'s `onTap`
              // below is — so removing it strands nothing. The tap is the one control that reaches the
              // run screen; the `…` deliberately does not open it, so a mis-tap on a destructive item
              // can never swallow a transcript. (A previous consolidation already cut this trailing
              // area from three controls to two for 320pt; two is what fits, and this makes it one.)
              trailing: _TaskOverflowMenu(
                taskTitle: task.title,
                onRename: () => onRenameTask(task),
                onArchive: () => onArchiveTask(task),
              ),
              onTap: () => onOpenTask(task),
            );
          }),
        if (!collapsed && group.tasks.isEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(48, 0, 16, 8),
            child: Text(
              l10n.projectListNoTasks,
              style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
            ),
          ),
      ],
    );
  }

  Future<void> _pickAgent(BuildContext context) async {
    final offered = offeredHarnesses(harnesses);
    final l10n = context.l10n;
    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(l10n.projectListAgentFor(group.project.label))),
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
enum _ProjectMenuAction { agent, branches, remove }

/// The project row's `…`: the agent new tasks inherit, and Remove.
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
    required this.canPickBranch,
    required this.onPickBranches,
    required this.onRemove,
    required this.destructive,
  });

  final String projectLabel;

  /// The resolved agent's short name (`HarnessInfo.badge`), or null before the harness list arrives.
  final String? agentBadge;

  final bool canPickAgent;
  final VoidCallback onPickAgent;
  final bool canPickBranch;
  final VoidCallback onPickBranches;
  final VoidCallback onRemove;
  final Color destructive;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Semantics(
      label: l10n.connectionsMenuAria(projectLabel),
      button: true,
      child: PopupMenuButton<_ProjectMenuAction>(
        tooltip: l10n.connectionsMenuAria(projectLabel),
        onSelected: (action) => switch (action) {
          _ProjectMenuAction.agent => onPickAgent(),
          _ProjectMenuAction.branches => onPickBranches(),
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
              title: Text(agentBadge ?? l10n.composerAgentBare),
              subtitle: canPickAgent ? Text(l10n.projectListChangeAgent) : null,
            ),
          ),
          // **Branches, immediately after the agent.** The two are the project's own settings — which agent
          // new tasks inherit, and which branch its folder is on — and a repository that is not a git folder
          // gets no item at all rather than one that cannot work.
          if (canPickBranch)
            PopupMenuItem(
              value: _ProjectMenuAction.branches,
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.account_tree_outlined),
                title: Text(l10n.gitBranchesTitle),
              ),
            ),
          // The destructive one is last and wears the danger colour, and the confirmation behind it is
          // the screen's own `_removeProject` — the wording and the no-optimistic-removal rule are
          // unchanged, only the control they hang off moved. The label is the short "Remove": the row
          // is already the project, and the dialog repeats the name anyway, so "project" here was said
          // twice. The confirmation keeps the full consequence (row gone for good, tasks archived).
          const PopupMenuDivider(),
          PopupMenuItem(
            value: _ProjectMenuAction.remove,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.remove_circle_outline, color: destructive),
              title: Text(l10n.commonRemove),
            ),
          ),
        ],
      ),
    );
  }
}

/// Which item of a task row's `…` was chosen.
enum _TaskMenuAction { rename, archive }

/// The task row's `…`: Rename, and the removal that takes the task out of the list.
///
/// **Why `…` and not a second button on the row.** This is the shape the project row above already
/// settled on (`_ProjectOverflowMenu`), and the desktop's task row uses it too
/// (`CoderSidebar.tsx:557-583`): a row has room for the gesture that opens it, and everything else
/// hangs off one menu trigger. Replacing the standalone Archive `IconButton` with this trigger is also
/// what keeps the 320pt layout honest — a `PopupMenuButton` is narrower than the 48pt `IconButton` it
/// replaced, so the change spends no width, it gives some back.
///
/// **Short labels, no repeated object.** The owner's ask: the row is already the task, so "Rename
/// task" and "Archive task" twice say a noun the menu already sits on. They read "Rename" and
/// "Remove" now — the same two words the desktop's menu uses. "Remove" is the *list* verb; the call
/// behind it and the dialog in front of it both still say what actually happens (archive, files
/// untouched — see `_archiveTask`), so the short label costs no truth. The `archive` enum member and
/// the `onArchive` callback keep the operation's name in code, where the accurate word belongs.
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
    final l10n = context.l10n;
    return Semantics(
      label: l10n.connectionsMenuAria(taskTitle),
      button: true,
      child: PopupMenuButton<_TaskMenuAction>(
        tooltip: l10n.connectionsMenuAria(taskTitle),
        onSelected: (action) => switch (action) {
          _TaskMenuAction.rename => onRename(),
          _TaskMenuAction.archive => onArchive(),
        },
        itemBuilder: (context) => [
          PopupMenuItem(
            value: _TaskMenuAction.rename,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.edit_outlined),
              title: Text(l10n.commonRename),
            ),
          ),
          const PopupMenuDivider(),
          // Same order as the project row: the thing that changes the row first, the thing that
          // takes it away last. The removal is deliberately not painted in the danger colour — it is
          // reversible and leaves every file on disk, and red here would teach a user to fear a safe
          // action (`confirm_dialog.dart` makes the same call for the same reason).
          PopupMenuItem(
            value: _TaskMenuAction.archive,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.archive_outlined),
              title: Text(l10n.commonRemove),
            ),
          ),
        ],
      ),
    );
  }
}
