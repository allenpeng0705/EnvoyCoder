/// Start a new task on an existing project — createTask + startRun on the home daemon.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../models/composer_attachment.dart';
import '../models/harness.dart';
import '../models/project_rail.dart';
import '../services/attachment_pickers.dart';
import '../services/host_client.dart';
import '../theme/tokens.dart';
import '../widgets/composer_attach.dart';
import '../widgets/composer_controls.dart';
import 'run_screen.dart';

Future<void> showNewTaskSheet({
  required BuildContext context,
  required HostClient client,
  required List<ProjectInfo> projects,
  required List<HarnessInfo> harnesses,
  String? initialProjectId,
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
  });

  final HostClient client;
  final List<ProjectInfo> projects;
  final List<HarnessInfo> harnesses;
  final String? initialProjectId;

  @override
  State<_NewTaskSheet> createState() => _NewTaskSheetState();
}

class _NewTaskSheetState extends State<_NewTaskSheet> {
  late String? _projectId;
  late ComposerSelection _selection;
  final _prompt = TextEditingController();
  List<ComposerAttachment> _attachments = [];
  String? _attachNotice;
  bool _busy = false;
  String? _error;

  ProjectInfo? _projectFor(String? id) {
    for (final p in widget.projects) {
      if (p.id == id) return p;
    }
    return widget.projects.isNotEmpty ? widget.projects.first : null;
  }

  @override
  void initState() {
    super.initState();
    _projectId = widget.initialProjectId ??
        (widget.projects.isNotEmpty ? widget.projects.first.id : null);
    final project = _projectFor(_projectId);
    final offered = offeredHarnesses(widget.harnesses);
    _selection = ComposerSelection(
      harnessId: project?.defaultHarness ??
          (offered.isNotEmpty ? offered.first.id : null),
    );
  }

  @override
  void dispose() {
    _prompt.dispose();
    super.dispose();
  }

  Future<void> _attach(Future<List<IncomingFile>?> Function() pick) {
    return takeAttachments(
      current: _attachments,
      pick: pick,
      stillMounted: () => mounted,
      apply: (attachments, notice) {
        setState(() {
          _attachments = attachments;
          _attachNotice = notice;
        });
      },
    );
  }

  Future<void> _start() async {
    final turn = composeTurn(_prompt.text, _attachments);
    final projectId = _projectId;
    if (turn.prompt.isEmpty || projectId == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final title = turn.prompt.split('\n').first.trim();
      final created = await widget.client.call('coder.createTask', {
        'projectId': projectId,
        'title': title.length > 80 ? '${title.substring(0, 80)}…' : title,
        if (_selection.harnessId != null) 'harness': _selection.harnessId,
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
      final started = await widget.client.call(
        'coder.startRun',
        {
          'taskId': taskId,
          'prompt': turn.prompt,
          if (_selection.agentModeId != null) 'agentModeId': _selection.agentModeId,
          if (_selection.model != null && _selection.model!.isNotEmpty) 'model': _selection.model,
          if (_selection.thinkingLevel != null && _selection.thinkingLevel!.isNotEmpty)
            'thinkingLevel': _selection.thinkingLevel,
          if (turn.images.isNotEmpty) 'images': turn.images,
        },
        turn.images.isEmpty ? const Duration(seconds: 15) : const Duration(seconds: 60),
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
        _error = 'Could not start that task. ${_short("$error")}';
      });
    }
  }

  static String _short(String raw) {
    if (raw.contains('token=')) return 'The connection failed.';
    return raw.length > 160 ? '${raw.substring(0, 160)}…' : raw;
  }

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('New task', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            if (widget.projects.isEmpty)
              Text(
                'Add a project on the computer first, then try again.',
                style: TextStyle(color: colors.foregroundMuted),
              )
            else ...[
              DropdownButtonFormField<String>(
                initialValue: _projectId,
                decoration: const InputDecoration(
                  labelText: 'Project',
                  border: OutlineInputBorder(),
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
                          if (project?.defaultHarness != null) {
                            _selection = ComposerSelection(harnessId: project!.defaultHarness);
                          }
                        });
                      },
              ),
              const SizedBox(height: 12),
              ComposerControls(
                harnesses: widget.harnesses,
                selection: _selection,
                enabled: !_busy,
                onChanged: (next) => setState(() => _selection = next),
              ),
              const SizedBox(height: 12),
              AttachmentTray(
                attachments: _attachments,
                notice: _attachNotice,
                onRemove: (id) => setState(() {
                  _attachments = [
                    for (final attachment in _attachments)
                      if (attachment.id != id) attachment,
                  ];
                  _attachNotice = null;
                }),
              ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  AttachMenuButton(
                    enabled: !_busy,
                    onImage: () => unawaited(_attach(pickGalleryImages)),
                    onPaste: () => unawaited(_attach(pasteClipboardImage)),
                    onFile: () => unawaited(_attach(pickDocuments)),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _prompt,
                      minLines: 3,
                      maxLines: 8,
                      enabled: !_busy,
                      decoration: const InputDecoration(
                        hintText: 'Describe the task',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: TextStyle(color: colors.statusDanger, fontSize: 13)),
              ],
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _busy || _projectId == null ? null : () => unawaited(_start()),
                child: Text(_busy ? 'Starting…' : 'Start'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
