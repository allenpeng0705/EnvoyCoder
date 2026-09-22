/// One run: transcript, approvals, composer with full agent controls.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../l10n/l10n.dart';
import '../models/composer_attachment.dart';
import '../models/harness.dart';
import '../models/text_reveal.dart';
import '../models/transcript.dart';
import '../services/attachment_pickers.dart';
import '../services/host_client.dart';
import '../theme/tokens.dart';
import '../widgets/composer_attach.dart';
import '../widgets/composer_controls.dart';
import '../widgets/confirm_dialog.dart';
import '../widgets/transcript_row.dart';
import 'explorer_screen.dart';

class RunScreen extends StatefulWidget {
  const RunScreen({
    super.key,
    required this.client,
    required this.runId,
    required this.title,
    this.harnesses = const [],
    this.taskId,
    this.cwd,
  });

  final HostClient client;
  final String runId;
  final String title;
  final List<HarnessInfo> harnesses;
  final String? taskId;
  final String? cwd;

  @override
  State<RunScreen> createState() => _RunScreenState();
}

class _RunScreenState extends State<RunScreen> with SingleTickerProviderStateMixin {
  final _composer = TextEditingController();

  /// The project this task belongs to — what the git writes act on.
  String? _projectId;
  final _transcript = Transcript();
  final _scroll = ScrollController();
  List<ComposerAttachment> _attachments = [];
  String? _attachNotice;

  bool _live = false;
  bool _loading = true;
  bool _cancelling = false;
  bool _archiving = false;
  String _runId = '';
  String _sendMode = 'queue';
  String? _error;
  String? _taskId;
  String? _cwd;
  List<HarnessInfo> _harnesses = [];
  ComposerSelection _selection = const ComposerSelection();
  List<_SlashCommand> _commands = const [];
  StreamSubscription<Map<String, dynamic>>? _eventSub;

  TextRevealState _reveal = beginTextReveal('');
  String? _revealMessageId;
  Ticker? _ticker;
  Duration? _lastTick;

  @override
  void initState() {
    super.initState();
    _taskId = widget.taskId;
    _cwd = widget.cwd;
    _runId = widget.runId;
    _harnesses = List.of(widget.harnesses);
    _eventSub = widget.client.events.listen(_onEventFrame);
    unawaited(_bootstrap());
  }

  Future<void> _bootstrap() async {
    if (_harnesses.isEmpty) {
      try {
        final result = await widget.client.call('coder.listHarnesses', {});
        final list = result['harnesses'];
        if (list is List) {
          _harnesses = list
              .whereType<Map>()
              .map((e) => HarnessInfo.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        }
        try {
          final providers = await widget.client.call('coder.listProviders', {});
          final added = providers['providers'];
          if (added is List) {
            final taken = _harnesses.map((h) => h.id).toSet();
            final extra = <HarnessInfo>[];
            for (final raw in added.whereType<Map>()) {
              final h = HarnessInfo.fromJson(Map<String, dynamic>.from(raw));
              if (!h.ready || !taken.add(h.id)) continue;
              extra.add(h);
            }
            _harnesses = [..._harnesses, ...extra];
          }
        } catch (_) {}
        try {
          final catalog = await widget.client.call('coder.listCatalog', {});
          final entries = catalog['entries'];
          if (entries is List) {
            final taken = _harnesses.map((h) => h.id).toSet();
            final extra = <HarnessInfo>[];
            for (final raw in entries.whereType<Map>()) {
              if (raw['builtIn'] == true) continue;
              final id = raw['id'] as String?;
              if (id == null || id.isEmpty || taken.contains(id)) continue;
              final mapped = Map<String, dynamic>.from(raw);
              mapped['label'] = raw['title'] ?? id;
              final h = HarnessInfo.fromJson(mapped);
              if (!h.ready) continue;
              taken.add(id);
              extra.add(h);
            }
            _harnesses = [..._harnesses, ...extra];
          }
        } catch (_) {}
      } catch (_) {}
    }
    if (_taskId != null) {
      try {
        final tasks = await widget.client.call('coder.listTasks', {});
        final list = tasks['tasks'];
        if (list is List) {
          for (final raw in list) {
            if (raw is! Map) continue;
            if (raw['id'] != _taskId) continue;
            _projectId = raw['projectId'] as String?;
            _selection = ComposerSelection(
              harnessId: raw['harness'] as String?,
              model: raw['model'] as String?,
              agentModeId: raw['agentModeId'] as String?,
              thinkingLevel: raw['thinkingLevel'] as String?,
            );
            final cwd = raw['cwd'];
            if (cwd is String && cwd.isNotEmpty) _cwd = cwd;
            break;
          }
        }
      } catch (_) {}
    }
    await _loadHistory();
  }

  /// Every run of this task, oldest first, so a restart does not hide the earlier ones.
  Future<void> _loadHistory() async {
    final taskId = _taskId;
    if (taskId != null) {
      try {
        final listed = await widget.client.call('coder.listRuns', {'taskId': taskId});
        final runs = listed['runs'];
        if (runs is List && runs.isNotEmpty) {
          String? lastId;
          var lastLive = false;
          for (final raw in runs) {
            if (raw is! Map) continue;
            final id = raw['id'];
            if (id is! String || id.isEmpty) continue;
            _transcript.beginRun();
            final snap = await widget.client.call('coder.tailRun', {'runId': id});
            final events = snap['events'];
            if (events is List) {
              for (final event in events) {
                if (event is Map) _applyEvent(Map<String, dynamic>.from(event));
              }
            }
            lastId = id;
            lastLive = snap['live'] == true;
          }
          if (!mounted) return;
          if (lastId != null) {
            final id = lastId;
            setState(() {
              _runId = id;
              _live = lastLive;
              _loading = false;
              _error = null;
            });
            _syncReveal();
            _scrollToEnd();
            return;
          }
        }
      } catch (_) {
        // Fall through: one run is still worth opening, and a missing history must not lock the composer.
      }
    }
    await _loadTail();
  }

  Future<void> _loadTail() async {
    try {
      final snap = await widget.client.call('coder.tailRun', {
        'runId': _runId,
        if (_transcript.lastSeq > 0) 'sinceSeq': _transcript.lastSeq,
      });
      final events = snap['events'];
      if (events is List) {
        for (final raw in events) {
          if (raw is Map) _applyEvent(Map<String, dynamic>.from(raw));
        }
      }
      if (!mounted) return;
      setState(() {
        _live = snap['live'] == true;
        _loading = false;
        _error = null;
        if (_taskId == null && snap['taskId'] is String) {
          _taskId = snap['taskId'] as String;
        }
      });
      _syncReveal();
      _scrollToEnd();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _taskId == null
            ? context.l10n.runCouldNotOpen
            : context.l10n.runEarlierNotHere;
      });
    }
  }

  void _onEventFrame(Map<String, dynamic> frame) {
    if (frame['event'] != 'coder:run-event') return;
    final data = frame['data'];
    if (data is! Map) return;
    final event = Map<String, dynamic>.from(data);
    if (event['runId'] != _runId) return;
    _applyEvent(event);
    if (mounted) {
      setState(() {});
      _syncReveal();
      _scrollToEnd();
    }
  }

  void _applyEvent(Map<String, dynamic> event) {
    if (event['kind'] == 'run.commands') {
      final raw = event['commands'];
      _commands = raw is List
          ? [
              for (final item in raw)
                if (item is Map && item['name'] is String)
                  _SlashCommand(
                    name: item['name'] as String,
                    description: (item['description'] as String?) ?? '',
                    argumentHint: item['argumentHint'] as String?,
                  ),
            ]
          : const [];
    }
    _transcript.apply(event);
    if (event['kind'] == 'run.ended') {
      _live = false;
      _stopTicker();
    }
  }

  List<_SlashCommand> get _commandMatches {
    final text = _composer.text;
    if (!text.startsWith('/') || text.contains(' ')) return const [];
    final query = text.substring(1).toLowerCase();
    return [
      for (final command in _commands)
        if (query.isEmpty || command.name.toLowerCase().startsWith(query)) command,
    ];
  }

  void _syncReveal() {
    TranscriptEntry? lastAssistant;
    for (var i = _transcript.entries.length - 1; i >= 0; i--) {
      if (_transcript.entries[i].kind == 'assistant') {
        lastAssistant = _transcript.entries[i];
        break;
      }
    }
    if (lastAssistant == null || !_live) {
      _stopTicker();
      if (lastAssistant != null) {
        _reveal = beginTextReveal(lastAssistant.text);
        _revealMessageId = lastAssistant.id;
      }
      return;
    }
    if (_revealMessageId != lastAssistant.id) {
      _reveal = beginTextReveal(lastAssistant.text);
      _revealMessageId = lastAssistant.id;
    } else {
      _reveal = retargetTextReveal(_reveal, lastAssistant.text);
    }
    if (!isTextRevealSettled(_reveal)) {
      _startTicker();
    } else {
      _stopTicker();
    }
  }

  void _startTicker() {
    _ticker ??= createTicker((elapsed) {
      final previous = _lastTick;
      _lastTick = elapsed;
      final delta = previous == null
          ? textRevealFrameIntervalMs
          : (elapsed - previous).inMilliseconds.toDouble();
      if (delta < textRevealFrameIntervalMs) return;
      final next = advanceTextReveal(_reveal, delta);
      if (next.revealed != _reveal.revealed || next.target != _reveal.target) {
        setState(() => _reveal = next);
      }
      if (isTextRevealSettled(_reveal)) _stopTicker();
    })
      ..start();
  }

  void _stopTicker() {
    _ticker?.stop();
    _ticker?.dispose();
    _ticker = null;
    _lastTick = null;
    _reveal = completeTextReveal(_reveal);
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      // The list is reversed, so the latest row is offset 0. Follow only when the reader is
      // already there — a jump to maxScrollExtent would land on the oldest message.
      if (_scroll.offset > 80) return;
      _scroll.jumpTo(0);
    });
  }

  Future<void> _answer(
    String requestId, {
    String? optionId,
    List<String>? optionIds,
    String? text,
  }) async {
    final params = <String, Object>{
      'runId': _runId,
      'requestId': requestId,
    };
    if (optionIds != null && optionIds.isNotEmpty) {
      params['optionId'] = optionIds.first;
      params['optionIds'] = optionIds;
    } else if (text != null && text.trim().isNotEmpty) {
      params['text'] = text.trim();
    } else if (optionId != null && optionId.isNotEmpty) {
      params['optionId'] = optionId;
    } else {
      return;
    }
    try {
      await widget.client.call('coder.answerApproval', params);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.runCouldNotAnswer)),
      );
    }
  }

  Future<void> _persistSelection(ComposerSelection next) async {
    setState(() => _selection = next);
    final taskId = _taskId;
    if (taskId == null) return;
    try {
      await widget.client.call('coder.updateTask', {
        'id': taskId,
        if (next.harnessId != null && next.harnessId!.isNotEmpty) 'harness': next.harnessId,
        if (next.model != null) 'model': next.model,
        if (next.agentModeId != null) 'agentModeId': next.agentModeId,
        if (next.thinkingLevel != null) 'thinkingLevel': next.thinkingLevel ?? '',
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.runCouldNotUpdateTask)),
      );
    }
  }

  bool get _canSend {
    if (_transcript.pendingApproval != null && _live) return false;
    return _live || _taskId != null;
  }

  Future<void> _send() async {
    final turn = composeTurn(_composer.text, _attachments, context.l10n);
    if (turn.prompt.isEmpty || !_canSend) return;
    final previousText = _composer.text;
    final previousAttachments = List<ComposerAttachment>.of(_attachments);
    _composer.clear();
    setState(() {
      _attachments = [];
      _attachNotice = null;
    });
    try {
      if (_live) {
        await widget.client.call(
          'coder.sendToRun',
          {
            'runId': _runId,
            'text': turn.prompt,
            'mode': _sendMode,
            if (turn.images.isNotEmpty) 'images': turn.images,
          },
          turn.images.isEmpty ? const Duration(seconds: 15) : const Duration(seconds: 60),
        );
        return;
      }
      final taskId = _taskId;
      if (taskId == null) return;
      final started = await widget.client.call(
        'coder.startRun',
        {
          'taskId': taskId,
          'prompt': turn.prompt,
          'resume': true,
          if (_selection.agentModeId != null) 'agentModeId': _selection.agentModeId,
          if (_selection.model != null && _selection.model!.isNotEmpty) 'model': _selection.model,
          if (_selection.thinkingLevel != null && _selection.thinkingLevel!.isNotEmpty)
            'thinkingLevel': _selection.thinkingLevel,
          if (turn.images.isNotEmpty) 'images': turn.images,
        },
        turn.images.isEmpty ? const Duration(seconds: 15) : const Duration(seconds: 60),
      );
      final run = started['run'];
      final id = run is Map ? run['id'] as String? : null;
      if (id == null || id.isEmpty) {
        throw StateError('The computer did not start a run.');
      }
      _transcript.beginRun();
      if (!mounted) return;
      setState(() {
        _runId = id;
        _live = true;
        _error = null;
      });
      await _loadTail();
    } catch (_) {
      if (!mounted) return;
      _composer.text = previousText;
      setState(() => _attachments = previousAttachments);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.runCouldNotSend)),
      );
    }
  }

  Future<void> _attach(Future<List<IncomingFile>?> Function() pick) {
    return takeAttachments(
      current: _attachments,
      pick: pick,
      stillMounted: () => mounted,
      l10n: context.l10n,
      apply: (attachments, notice) {
        setState(() {
          _attachments = attachments;
          _attachNotice = notice;
        });
      },
    );
  }

  Future<void> _openExplorer() async {
    final cwd = _cwd;
    if (cwd == null || cwd.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.runNoFolder)),
      );
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ExplorerScreen(
          rpc: (method, [params = const {}]) => widget.client.call(method, params),
          root: cwd,
          // The git writes act on the **project**, never on a path: the daemon resolves the folder itself, so
          // a client cannot name a directory for it to mutate. The id comes from the task the screen is showing.
          projectId: _projectId,
        ),
      ),
    );
  }

  Future<void> _cancel() async {
    if (!_live || _cancelling) return;
    setState(() => _cancelling = true);
    try {
      await widget.client.call('coder.cancelRun', {'runId': _runId});
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.runCouldNotStop)),
      );
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  /// Archive the task this screen is showing, then leave it.
  ///
  /// The screen has to own this rather than the list behind it: a task open here is still in the
  /// list, and taking it out from under the user's own screen is the "removing the task you are
  /// currently viewing" case. Archiving from here pops `true`, which is what tells the project list
  /// to drop the row — the user is never left reading a transcript for a task that is no longer
  /// listed. On a refusal the screen stays put with the reason, because navigating away from work
  /// that still exists would be the lie.
  ///
  /// "Archive", not "Remove"/"Delete": the only task operation the protocol has is
  /// `coder.archiveTask` (`packages/protocol/src/rpc.ts:2086`), which leaves the folder, the files
  /// and the transcript on the computer (`apps/desktop/src/daemon/store.ts:582-594`). See
  /// `project_list_screen.dart` for the full archive-vs-delete note.
  Future<void> _archiveTask() async {
    final taskId = _taskId;
    if (taskId == null || taskId.isEmpty || _archiving) return;

    final l10n = context.l10n;
    final confirmed = await showConfirmDialog(
      context,
      title: l10n.taskRemoveTitle(widget.title),
      message: l10n.taskRemoveMessage,
      confirmLabel: l10n.commonRemove,
      destructive: false,
    );
    if (!confirmed || !mounted) return;

    setState(() => _archiving = true);
    try {
      await widget.client.call('coder.archiveTask', {'id': taskId, 'archived': true});
    } catch (_) {
      if (!mounted) return;
      setState(() => _archiving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.runCouldNotRemove)),
      );
      return;
    }
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  @override
  void dispose() {
    unawaited(_eventSub?.cancel() ?? Future<void>.value());
    _stopTicker();
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final approvalOpen = _transcript.pendingApproval != null;
    final lastAssistantIndex = _transcript.entries.lastIndexWhere((e) => e.kind == 'assistant');

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          if (_live)
            TextButton(
              onPressed: _cancelling ? null : () => unawaited(_cancel()),
              child: Text(_cancelling ? l10n.runStopping : l10n.runStop),
            ),
          if (_live)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(
                child: Text(l10n.runLive, style: TextStyle(color: colors.statusDotRunning, fontSize: 12)),
              ),
            ),
          IconButton(
            tooltip: l10n.runToggleExplorer,
            onPressed: () => unawaited(_openExplorer()),
            icon: const Icon(Icons.view_sidebar_outlined),
          ),
          // Only when this run belongs to a task that exists in the list. A run opened without a
          // task id (an older daemon's snapshot) has nothing to archive, and showing the button
          // would offer an action that cannot be carried out.
          if (_taskId != null && _taskId!.isNotEmpty)
            Semantics(
              label: l10n.runRemoveTask,
              button: true,
              child: IconButton(
                tooltip: l10n.runRemoveTask,
                onPressed: _archiving ? null : () => unawaited(_archiveTask()),
                icon: const Icon(Icons.archive_outlined),
              ),
            ),
        ],
      ),
      body: Column(
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_error!, style: TextStyle(color: colors.statusDanger)),
            ),
          if (_transcript.hasGap)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
              child: Text(
                l10n.runHistoryGap,
                style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
              ),
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    controller: _scroll,
                    reverse: true,
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                    itemCount: _transcript.entries.length,
                    itemBuilder: (context, index) {
                      final realIndex = _transcript.entries.length - 1 - index;
                      final entry = _transcript.entries[realIndex];
                      final streaming = _live && realIndex == lastAssistantIndex && entry.kind == 'assistant';
                      final display = streaming
                          ? TranscriptEntry(
                              kind: entry.kind,
                              id: entry.id,
                              text: visibleRevealedText(_reveal),
                              tone: entry.tone,
                              callId: entry.callId,
                              status: entry.status,
                              delivered: entry.delivered,
                              toolInput: entry.toolInput,
                              toolOutput: entry.toolOutput,
                              approval: entry.approval,
                            )
                          : entry;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: TranscriptRow(
                          entry: display,
                          colors: colors,
                          onAnswer: _answer,
                          streaming: streaming,
                        ),
                      );
                    },
                  ),
          ),
          SafeArea(
            top: false,
            child: Material(
              color: colors.surface0,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_harnesses.isNotEmpty) ...[
                      ComposerControls(
                        harnesses: _harnesses,
                        selection: _selection,
                        enabled: !approvalOpen,
                        onChanged: (next) => unawaited(_persistSelection(next)),
                      ),
                      const SizedBox(height: 8),
                    ],
                    if (_live)
                      Row(
                        children: [
                          ChoiceChip(
                            label: Text(l10n.runQueue),
                            selected: _sendMode == 'queue',
                            onSelected: approvalOpen ? null : (_) => setState(() => _sendMode = 'queue'),
                          ),
                          const SizedBox(width: 8),
                          ChoiceChip(
                            label: Text(l10n.runSteer),
                            selected: _sendMode == 'steer',
                            onSelected: approvalOpen ? null : (_) => setState(() => _sendMode = 'steer'),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _sendMode == 'steer'
                                  ? l10n.runJoinsTurn
                                  : l10n.runWaitsTurn,
                              style: TextStyle(color: colors.foregroundMuted, fontSize: 11),
                            ),
                          ),
                        ],
                      ),
                    const SizedBox(height: 8),
                    if (_commandMatches.isNotEmpty)
                      ..._commandMatches.map(
                        (command) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text('/${command.name}${command.argumentHint == null ? '' : ' ${command.argumentHint}'}'),
                          subtitle: command.description.isEmpty ? null : Text(command.description),
                          onTap: () {
                            final next = '/${command.name} ';
                            _composer.value = TextEditingValue(
                              text: next,
                              selection: TextSelection.collapsed(offset: next.length),
                            );
                            setState(() {});
                          },
                        ),
                      ),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        AttachMenuButton(
                          enabled: _canSend,
                          onImage: () => unawaited(_attach(pickGalleryImages)),
                          onPaste: () => unawaited(_attach(pasteClipboardImage)),
                          onFile: () => unawaited(_attach(pickDocuments)),
                        ),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
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
                              TextField(
                                controller: _composer,
                                enabled: _canSend,
                                minLines: 1,
                                maxLines: 4,
                                decoration: InputDecoration(
                                  hintText: approvalOpen && _live
                                      ? l10n.runPlaceholderAnswer
                                      : _live
                                          ? l10n.runPlaceholderFollowUp
                                          : l10n.runPlaceholderContinue,
                                  border: const OutlineInputBorder(),
                                  isDense: true,
                                ),
                                onChanged: (_) => setState(() {}),
                                onSubmitted: (_) => unawaited(_send()),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          onPressed: _canSend && canSendComposer(_composer.text, _attachments)
                              ? () => unawaited(_send())
                              : null,
                          icon: const Icon(Icons.send),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SlashCommand {
  const _SlashCommand({required this.name, required this.description, this.argumentHint});

  final String name;
  final String description;
  final String? argumentHint;
}
