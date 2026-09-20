/// Start a new task on an existing project — createTask + startRun on the home daemon.
///
/// ## What this sheet asks for, and what it deliberately does not
///
/// The sheet is opened **from a project** — the row's `+`, or a task row that has no run yet — so the
/// project is already known and the picker is not shown. It is only shown on the latent path where the
/// sheet is opened with no project at all (`initialProjectId == null`), which today has no caller in
/// the app but is kept so the widget stays honest about the state it accepts.
///
/// **The agent is the project's, not the task's.** The sheet resolves the project's agent (else the
/// app default) only to know which model / mode / thinking options to offer, and it never sends a
/// task-level `harness`: `coder.createTask` resolves the agent from the project, and the daemon moves
/// the task when the project's agent changes. There is no Agent control here by design — the project
/// row's own menu is where a project's agent is chosen and changed.
///
/// The field is **one line**: a task's first message becomes its title, and a 3–8 line box spent the
/// sheet's height on text nobody had typed yet (owner's ask). Attachments are **not offered here any
/// more** — the owner asked for the paperclip to go, and without it this flow cannot add one, so the
/// sheet's attachment state went with it. Nothing was removed from the app: the run screen's composer
/// still carries the tray and the three attach actions (`run_screen.dart`), and `composer_attach.dart`
/// is still theirs. The primary button says **Add** — the verb for what this sheet does to the list —
/// where it used to say Start, which described the run underneath instead.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import '../models/harness.dart';
import '../models/project_rail.dart';
import '../services/host_client.dart';
import '../theme/tokens.dart';
import '../widgets/composer_controls.dart';
import 'run_screen.dart';

Future<void> showNewTaskSheet({
  required BuildContext context,
  required HostClient client,
  required List<ProjectInfo> projects,
  required List<HarnessInfo> harnesses,
  String? initialProjectId,
  String? appHarness,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: _NewTaskSheet(
        client: client,
        projects: projects,
        harnesses: harnesses,
        initialProjectId: initialProjectId,
        appHarness: appHarness,
      ),
    ),
  );
}

class _NewTaskSheet extends StatefulWidget {
  const _NewTaskSheet({
    required this.client,
    required this.projects,
    required this.harnesses,
    this.initialProjectId,
    this.appHarness,
  });

  final HostClient client;
  final List<ProjectInfo> projects;
  final List<HarnessInfo> harnesses;

  /// The project this sheet was opened for. Non-null is the normal path (a project row's `+`, or a
  /// task row): the picker is hidden, because asking again would be asking the row's own question.
  final String? initialProjectId;

  /// The app-wide default agent, used only when the project has not set one of its own.
  ///
  /// The sheet needs the *resolved* agent to offer the right model / mode / thinking options, because
  /// the agent is what publishes those. It is never a task-level choice — see [_projectAgent].
  final String? appHarness;

  @override
  State<_NewTaskSheet> createState() => _NewTaskSheetState();
}

class _NewTaskSheetState extends State<_NewTaskSheet> {
  late String? _projectId;
  late ComposerSelection _selection;
  final _prompt = TextEditingController();
  bool _busy = false;
  String? _error;

  ProjectInfo? _projectFor(String? id) {
    for (final p in widget.projects) {
      if (p.id == id) return p;
    }
    return widget.projects.isNotEmpty ? widget.projects.first : null;
  }

  /// The agent the daemon will run this new task on — **the project's, never the task's**.
  ///
  /// Mirrors the daemon's own resolution (`resolveTaskDefaults`: project default, else the app
  /// default, else the built-in `envoy-harness`) so the model / mode / thinking chips offer the
  /// options of the agent the task will actually start on. The built-in last resort is spelled out for
  /// the same reason the window spells it out (`CoderApp.tsx`: `defaults.harness ?? "envoy-harness"`),
  /// and an id the harness list does not have simply offers no chips rather than inventing options.
  ///
  /// It is deliberately **not** written into `coder.createTask`: the agent is a property of the
  /// project, so the daemon resolves it from the project there, and `updateProject` moves the task
  /// when the project's agent changes.
  String? _projectAgent(ProjectInfo? project) =>
      project?.defaultHarness ?? widget.appHarness ?? 'envoy-harness';

  @override
  void initState() {
    super.initState();
    _projectId = widget.initialProjectId ??
        (widget.projects.isNotEmpty ? widget.projects.first.id : null);
    final project = _projectFor(_projectId);
    _selection = ComposerSelection(harnessId: _projectAgent(project));
  }

  @override
  void dispose() {
    _prompt.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final prompt = _prompt.text.trim();
    final projectId = _projectId;
    if (prompt.isEmpty || projectId == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final title = prompt;
      // **No `harness`.** A task has no agent of its own: `coder.createTask` resolves it from the
      // project's own setting (else the app default), which is what "the new task follows the
      // project's agent" means on the wire. Sending the project's value here would store it on the
      // task as if the task had chosen it.
      final created = await widget.client.call('coder.createTask', {
        'projectId': projectId,
        'title': title.length > 80 ? '${title.substring(0, 80)}…' : title,
        if (_selection.model != null && _selection.model!.isNotEmpty) 'model': _selection.model,
      });
      final task = created['task'];
      if (task is! Map || task['id'] is! String) {
        throw StateError('createTask returned no task');
      }
      final taskId = task['id'] as String;
      if (_selection.agentModeId != null ||
          (_selection.thinkingLevel != null && _selection.thinkingLevel!.isNotEmpty) ||
          (_selection.model != null && _selection.model!.isNotEmpty)) {
        await widget.client.call('coder.updateTask', {
          'id': taskId,
          if (_selection.model != null) 'model': _selection.model,
          if (_selection.agentModeId != null) 'agentModeId': _selection.agentModeId,
          if (_selection.thinkingLevel != null) 'thinkingLevel': _selection.thinkingLevel,
        });
      }
      // No attachment branch: this sheet cannot attach (the owner removed the paperclip), so a run
      // started from here is always prompt-only and the 15s timeout is the only one it needs.
      final started = await widget.client.call(
        'coder.startRun',
        {
          'taskId': taskId,
          'prompt': prompt,
          if (_selection.agentModeId != null) 'agentModeId': _selection.agentModeId,
          if (_selection.model != null && _selection.model!.isNotEmpty) 'model': _selection.model,
          if (_selection.thinkingLevel != null && _selection.thinkingLevel!.isNotEmpty)
            'thinkingLevel': _selection.thinkingLevel,
        },
        const Duration(seconds: 15),
      );
      final run = started['run'];
      final runId = run is Map ? run['id'] as String? : null;
      if (!mounted) return;
      final nav = Navigator.of(context);
      Navigator.pop(context);
      if (runId != null && runId.isNotEmpty) {
        await nav.push(
          MaterialPageRoute(
            builder: (_) => RunScreen(
              client: widget.client,
              runId: runId,
              title: title,
              harnesses: widget.harnesses,
              taskId: taskId,
              cwd: task['cwd'] as String? ?? _projectFor(projectId)?.path,
            ),
          ),
        );
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = context.l10n.newTaskCouldNotStart(_short(context.l10n, "$error"));
      });
    }
  }

  static String _short(AppLocalizations l10n, String raw) {
    if (raw.contains('token=')) return l10n.commonConnectionFailed;
    return raw.length > 160 ? '${raw.substring(0, 160)}…' : raw;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          CoderSpace.lg,
          CoderSpace.md2,
          CoderSpace.lg,
          CoderSpace.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.newTaskTitle, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: CoderSpace.md2),
            if (widget.projects.isEmpty)
              Text(
                l10n.newTaskNoProjects,
                style: TextStyle(color: colors.foregroundMuted),
              )
            else ...[
              // **The picker is only for the no-project path.** Opened from a project row — the only
              // path the app has today — the answer is the row itself, so the dropdown was a control
              // that could only be left alone or got wrong, and it was a third of the sheet's height
              // on a 320pt phone. It stays for the latent `initialProjectId == null` caller, where the
              // sheet really does not know which project the task belongs to.
              if (widget.initialProjectId == null) ...[
                DropdownButtonFormField<String>(
                  initialValue: _projectId,
                  decoration: InputDecoration(
                    labelText: l10n.newTaskProjectLabel,
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    for (final p in widget.projects)
                      DropdownMenuItem(value: p.id, child: Text(p.label)),
                  ],
                  onChanged: _busy
                      ? null
                      : (value) {
                          final project = _projectFor(value);
                          setState(() {
                            _projectId = value;
                            // The agent follows the project, so the chips must re-render against the
                            // new project's agent (see `_projectAgent`).
                            _selection = ComposerSelection(harnessId: _projectAgent(project));
                          });
                        },
                ),
                const SizedBox(height: CoderSpace.md2),
              ],
              ComposerControls(
                harnesses: widget.harnesses,
                selection: _selection,
                enabled: !_busy,
                onChanged: (next) => setState(() => _selection = next),
              ),
              const SizedBox(height: CoderSpace.md2),
              TextField(
                controller: _prompt,
                enabled: !_busy,
                // **One line.** A task's first message becomes its title (see `_start`), so a field
                // that grew to eight lines invited a paragraph it would only truncate to 80 characters.
                maxLines: 1,
                textInputAction: TextInputAction.done,
                // Enter is the commit path as well as the button — the same rule the rename dialog
                // uses, so the common case is: type, Enter.
                onSubmitted: (_) => unawaited(_start()),
                decoration: InputDecoration(
                  hintText: l10n.newTaskPromptHint,
                  border: const OutlineInputBorder(),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: CoderSpace.md),
                Text(_error!, style: TextStyle(color: colors.statusDanger, fontSize: 13)),
              ],
              const SizedBox(height: CoderSpace.md2),
              FilledButton(
                onPressed: _busy || _projectId == null ? null : () => unawaited(_start()),
                child: Text(_busy ? l10n.newTaskSubmitting : l10n.commonAdd),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
