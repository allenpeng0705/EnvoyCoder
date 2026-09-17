/// One run: transcript tail, approval card, and a minimal composer.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../models/transcript.dart';
import '../services/host_client.dart';
import '../theme/tokens.dart';

class RunScreen extends StatefulWidget {
  const RunScreen({
    super.key,
    required this.client,
    required this.runId,
    required this.title,
  });

  final HostClient client;
  final String runId;
  final String title;

  @override
  State<RunScreen> createState() => _RunScreenState();
}

class _RunScreenState extends State<RunScreen> {
  final _composer = TextEditingController();

  /// **The transcript, folded** — not a list of lines. `models/transcript.dart` owns the four folding
  /// rules (join chunks by message, drop a repeated `seq`, pair a tool call with its result, report a
  /// gap), because rendering one row per event is what made a streaming answer a column of one-word
  /// lines and made a reconnect duplicate the tail.
  final _transcript = Transcript();

  bool _live = false;
  bool _loading = true;
  String? _error;
  StreamSubscription<Map<String, dynamic>>? _eventSub;

  @override
  void initState() {
    super.initState();
    _eventSub = widget.client.events.listen(_onEventFrame);
    unawaited(_loadTail());
  }

  Future<void> _loadTail() async {
    try {
      final snap = await widget.client.call('coder.tailRun', {
        'runId': widget.runId,
        // From the watermark the transcript itself keeps, so a retry after a dropped frame asks only
        // for what is missing instead of re-reading the tail.
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
      });
    } catch (error) {
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
    if (mounted) setState(() {});
  }

  /// **The whole of the folding, in one call.** Everything this used to do — appending a row per
  /// event, guessing at a tool's label, keeping a second copy of the open approval — is the model's
  /// job now, and it is tested there (`test/transcript_test.dart`) rather than through the widget.
  void _applyEvent(Map<String, dynamic> event) {
    _transcript.apply(event);
    if (event['kind'] == 'run.ended') _live = false;
  }

  Future<void> _answer(String requestId, String optionId) async {
    try {
      await widget.client.call('coder.answerApproval', {
        'runId': widget.runId,
        'requestId': requestId,
        'optionId': optionId,
      });
      // The card is not cleared here. The transcript holds the question and its answer, so the next
      // `run.approval-resolved` — which the daemon emits to every window, not only to the one that
      // answered — is what closes it. Clearing locally would make the phone disagree with the desk
      // whenever a second device answers first.
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not send that answer. Try again.')),
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
        'mode': 'queue',
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not send. Is the run still live?')),
      );
    }
  }

  @override
  void dispose() {
    unawaited(_eventSub?.cancel() ?? Future<void>.value());
    _composer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
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
                    padding: const EdgeInsets.all(12),
                    itemCount: _transcript.entries.length,
                    itemBuilder: (context, index) {
                      final entry = _transcript.entries[index];
                      // **The approval is a row, not a banner above the list.** It belongs where the
                      // agent paused — the same rule the desktop follows (docs/envoydev-ui.md §6),
                      // and on a phone it also keeps the question next to the tool call that raised it
                      // instead of pushing the transcript down the screen.
                      if (entry.kind == 'approval' && entry.approval != null) {
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: _ApprovalCard(
                            approval: entry.approval!,
                            onAnswer: _answer,
                            colors: colors,
                          ),
                        );
                      }
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          _displayText(entry),
                          style: TextStyle(
                            color: entry.kind == 'thought' || entry.kind == 'note'
                                ? colors.foregroundMuted
                                : colors.foreground,
                            fontStyle: entry.kind == 'thought' ? FontStyle.italic : FontStyle.normal,
                            fontSize: entry.kind == 'note' ? 12 : null,
                          ),
                        ),
                      );
                    },
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _composer,
                      enabled: _live && _transcript.pendingApproval == null,
                      minLines: 1,
                      maxLines: 4,
                      decoration: InputDecoration(
                        hintText: _transcript.pendingApproval != null
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
                    // Refused while the agent is waiting on an answer: a message sent then would sit
                    // behind a question nobody has answered, which is how a user concludes the agent
                    // ignored them.
                    onPressed: _live && _transcript.pendingApproval == null ? () => unawaited(_send()) : null,
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// How one folded row reads on a small screen.
///
/// The daemon's events describe *what happened*; this is the phone's rendering of it, and it is the
/// only place that decides a tool row shows its state as a word after a dot rather than as a chip.
String _displayText(TranscriptEntry entry) {
  switch (entry.kind) {
    case 'user':
      // The user's own words, as they typed them. The transcript also records *how* the message was
      // delivered (`entry.delivered`), and the phone only ever queues — so there is nothing here for
      // a reader to act on, and annotating every message would be noise on a small screen.
      return entry.text;
    case 'tool':
      final status = entry.status ?? '';
      return status.isEmpty ? entry.text : '${entry.text} · $status';
    default:
      return entry.text;
  }
}

class _ApprovalCard extends StatelessWidget {
  const _ApprovalCard({
    required this.approval,
    required this.onAnswer,
    required this.colors,
  });

  final TranscriptApproval approval;
  final Future<void> Function(String requestId, String optionId) onAnswer;
  final CoderColors colors;

  @override
  Widget build(BuildContext context) {
    final question = approval.question;
    final detail = approval.detail;
    final optionList = approval.options;
    final answered = approval.resolvedWith;
    final closed = approval.closed;

    return Card(
      margin: const EdgeInsets.all(12),
      color: colors.surface2,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Needs your approval', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(question),
            if (detail != null && detail.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(detail, style: TextStyle(color: colors.foregroundMuted)),
            ],
            const SizedBox(height: 12),
            // An answered or closed question stops being a question: the row stays where it was, so
            // the reader does not lose their place in a long transcript, and it stops asking.
            if (answered != null)
              Text(
                'Answered: ${_labelFor(optionList, answered)}',
                style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
              )
            else if (closed)
              Text(
                'No longer waiting.',
                style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final option in optionList)
                    FilledButton(
                      // The destructive colour appears only inside a decision, never on a row
                      // (docs/envoydev-ui.md §7), and which option that is comes from the protocol's
                      // own flag rather than from the label.
                      style: option.destructive
                          ? FilledButton.styleFrom(backgroundColor: colors.destructive)
                          : null,
                      onPressed: () => unawaited(onAnswer(approval.requestId, option.id)),
                      child: Text(option.label),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

/// The label a user chose, for the line that replaces the buttons.
String _labelFor(List<TranscriptOption> options, String optionId) {
  for (final option in options) {
    if (option.id == optionId) return option.label;
  }
  // An id we do not have a label for is still shown: "Answered: allow-once" tells a user the question
  // was answered, and inventing a friendlier word for an option we cannot name would be worse.
  return optionId;
}
