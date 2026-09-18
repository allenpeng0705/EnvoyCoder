/// One run: transcript, approvals, composer with full agent controls.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../models/harness.dart';
import '../models/text_reveal.dart';
import '../models/transcript.dart';
import '../services/host_client.dart';
import '../theme/tokens.dart';
import '../widgets/composer_controls.dart';
import '../widgets/transcript_row.dart';

class RunScreen extends StatefulWidget {
  const RunScreen({
    super.key,
    required this.client,
    required this.runId,
    required this.title,
    this.harnesses = const [],
    this.taskId,
  });

  final HostClient client;
  final String runId;
  final String title;
  final List<HarnessInfo> harnesses;
  final String? taskId;

  @override
  State<RunScreen> createState() => _RunScreenState();
}

class _RunScreenState extends State<RunScreen> with SingleTickerProviderStateMixin {
  final _composer = TextEditingController();
  final _transcript = Transcript();
  final _scroll = ScrollController();

  bool _live = false;
  bool _loading = true;
  bool _cancelling = false;
  String _sendMode = 'queue';
  String? _error;
  String? _taskId;
  List<HarnessInfo> _harnesses = [];
  ComposerSelection _selection = const ComposerSelection();
  StreamSubscription<Map<String, dynamic>>? _eventSub;

  TextRevealState _reveal = beginTextReveal('');
  String? _revealMessageId;
  Ticker? _ticker;
  Duration? _lastTick;

  @override
  void initState() {
    super.initState();
    _taskId = widget.taskId;
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
            _selection = ComposerSelection(
              harnessId: raw['harness'] as String?,
              model: raw['model'] as String?,
              agentModeId: raw['agentModeId'] as String?,
              thinkingLevel: raw['thinkingLevel'] as String?,
            );
            break;
          }
        }
      } catch (_) {}
    }
    await _loadTail();
  }

  Future<void> _loadTail() async {
    try {
      final snap = await widget.client.call('coder.tailRun', {
        'runId': widget.runId,
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
        _error = 'Could not open this run.';
      });
    }
  }

  void _onEventFrame(Map<String, dynamic> frame) {
    if (frame['event'] != 'coder:run-event') return;
    final data = frame['data'];
    if (data is! Map) return;
    final event = Map<String, dynamic>.from(data);
    if (event['runId'] != widget.runId) return;
    _applyEvent(event);
    if (mounted) {
      setState(() {});
      _syncReveal();
      _scrollToEnd();
    }
  }

  void _applyEvent(Map<String, dynamic> event) {
    _transcript.apply(event);
    if (event['kind'] == 'run.ended') {
      _live = false;
      _stopTicker();
    }
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
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _answer(String requestId, String optionId) async {
    try {
      await widget.client.call('coder.answerApproval', {
        'runId': widget.runId,
        'requestId': requestId,
        'optionId': optionId,
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not send that answer. Try again.')),
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
        if (next.harnessId != null) 'harness': next.harnessId,
        if (next.model != null) 'model': next.model,
        if (next.agentModeId != null) 'agentModeId': next.agentModeId,
        if (next.thinkingLevel != null) 'thinkingLevel': next.thinkingLevel ?? '',
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not update the task on the computer.')),
      );
    }
  }

  Future<void> _send() async {
    final text = _composer.text.trim();
    if (text.isEmpty || !_live) return;
    _composer.clear();
    try {
      await widget.client.call('coder.sendToRun', {
        'runId': widget.runId,
        'text': text,
        'mode': _sendMode,
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not send. Is the run still live?')),
      );
    }
  }

  Future<void> _cancel() async {
    if (!_live || _cancelling) return;
    setState(() => _cancelling = true);
    try {
      await widget.client.call('coder.cancelRun', {'runId': widget.runId});
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not stop the run. Try again.')),
      );
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
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
              child: Text(_cancelling ? 'Stopping…' : 'Stop'),
            ),
          if (_live)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(
                child: Text('Live', style: TextStyle(color: colors.statusDotRunning, fontSize: 12)),
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
                'Some of this task\u2019s history did not arrive. What is here is in order.',
                style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
              ),
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                    itemCount: _transcript.entries.length,
                    itemBuilder: (context, index) {
                      final entry = _transcript.entries[index];
                      final streaming = _live && index == lastAssistantIndex && entry.kind == 'assistant';
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
                            label: const Text('Queue'),
                            selected: _sendMode == 'queue',
                            onSelected: approvalOpen ? null : (_) => setState(() => _sendMode = 'queue'),
                          ),
                          const SizedBox(width: 8),
                          ChoiceChip(
                            label: const Text('Steer'),
                            selected: _sendMode == 'steer',
                            onSelected: approvalOpen ? null : (_) => setState(() => _sendMode = 'steer'),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _sendMode == 'steer'
                                  ? 'Joins the turn now'
                                  : 'Waits for this turn to finish',
                              style: TextStyle(color: colors.foregroundMuted, fontSize: 11),
                            ),
                          ),
                        ],
                      ),
                    const SizedBox(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _composer,
                            enabled: _live && !approvalOpen,
                            minLines: 1,
                            maxLines: 4,
                            decoration: InputDecoration(
                              hintText: approvalOpen
                                  ? 'Answer the request above first'
                                  : _live
                                      ? 'Send a follow-up…'
                                      : 'Run is not live',
                              border: const OutlineInputBorder(),
                              isDense: true,
                            ),
                            onSubmitted: (_) => unawaited(_send()),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          onPressed: _live && !approvalOpen ? () => unawaited(_send()) : null,
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
