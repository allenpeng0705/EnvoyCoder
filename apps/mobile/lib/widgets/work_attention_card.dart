/// Work Engine items that need a person — compact attention block for the project list.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/daemon_text.dart';
import '../l10n/l10n.dart';
import '../models/work_ticket.dart';
import '../services/host_client.dart';
import '../services/work_api.dart';
import '../theme/tokens.dart';
import '../screens/run_screen.dart';

class WorkAttentionCard extends StatefulWidget {
  const WorkAttentionCard({
    super.key,
    required this.client,
  });

  final HostClient client;

  @override
  State<WorkAttentionCard> createState() => _WorkAttentionCardState();
}

class _WorkAttentionCardState extends State<WorkAttentionCard> {
  List<WorkTicketInfo> _tickets = const [];
  final Map<String, TextEditingController> _answers = {};
  bool _busy = false;
  String? _error;
  Timer? _poll;
  StreamSubscription<Map<String, dynamic>>? _eventSub;

  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => unawaited(_refresh()));
    _eventSub = widget.client.events.listen((frame) {
      if (frame['event'] != 'coder:state-changed') return;
      final data = frame['data'];
      if (data is Map && (data['kind'] == 'work' || data['kind'] == 'tasks')) {
        unawaited(_refresh());
      }
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    unawaited(_eventSub?.cancel() ?? Future<void>.value());
    for (final c in _answers.values) {
      c.dispose();
    }
    super.dispose();
  }

  TextEditingController _controllerFor(String id) {
    return _answers.putIfAbsent(id, TextEditingController.new);
  }

  Future<void> _refresh() async {
    try {
      final tickets = await widget.client.listWorkAttention();
      if (!mounted) return;
      final next = tickets.where((t) => t.needsPerson).toList(growable: false);
      final keep = next.map((t) => t.id).toSet();
      final stale = _answers.keys.where((id) => !keep.contains(id)).toList(growable: false);
      for (final id in stale) {
        _answers.remove(id)?.dispose();
      }
      setState(() {
        _tickets = next;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      // Work Engine may be disabled / unavailable — stay quiet unless we already show tickets.
      if (_tickets.isNotEmpty) {
        setState(() => _error = daemonErrorText(context.l10n, error.toString()));
      }
    }
  }

  Future<void> _answer(WorkTicketInfo ticket) async {
    final text = _controllerFor(ticket.id).text.trim();
    if (text.isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      await widget.client.answerWorkAttention(id: ticket.id, text: text);
      _controllerFor(ticket.id).clear();
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = daemonErrorText(context.l10n, error.toString()));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _retry(WorkTicketInfo ticket) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.client.retryWorkTicket(ticket.id);
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = daemonErrorText(context.l10n, error.toString()));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _stop(WorkTicketInfo ticket) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.client.stopWorkTicket(ticket.id);
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = daemonErrorText(context.l10n, error.toString()));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openTask(WorkTicketInfo ticket) async {
    final taskId = ticket.taskId;
    if (taskId == null || taskId.isEmpty) return;
    try {
      final listed = await widget.client.call('coder.listRuns', {'taskId': taskId});
      final runs = listed['runs'];
      String? runId;
      // listRuns is oldest-first; prefer a live run, else the newest (last).
      if (runs is List && runs.isNotEmpty) {
        for (final raw in runs.reversed) {
          if (raw is! Map) continue;
          if (raw['live'] == true) {
            runId = raw['id'] as String?;
            break;
          }
        }
        if (runId == null || runId.isEmpty) {
          final last = runs.last;
          if (last is Map) runId = last['id'] as String?;
        }
      }
      if (!mounted) return;
      if (runId == null || runId.isEmpty) {
        // Fall back: open an empty run screen bound to the task so the user can send.
        await Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) => RunScreen(
              client: widget.client,
              runId: '',
              taskId: taskId,
              title: ticket.title,
            ),
          ),
        );
      } else {
        await Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) => RunScreen(
              client: widget.client,
              runId: runId!,
              taskId: taskId,
              title: ticket.title,
            ),
          ),
        );
      }
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = daemonErrorText(context.l10n, error.toString()));
    }
  }

  String _stageLabel(AppLocalizations l10n, String stage) => switch (stage) {
        'person/delivery' => l10n.workAttentionStageDelivery,
        'person/answer' => l10n.workAttentionStageAnswer,
        'person/review' => l10n.workAttentionStageReview,
        'person/blocked' => l10n.workAttentionStageBlocked,
        _ => stage,
      };

  @override
  Widget build(BuildContext context) {
    if (_tickets.isEmpty) return const SizedBox.shrink();
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);

    return Semantics(
      label: l10n.workAttentionAria,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(CoderSpace.md, CoderSpace.sm, CoderSpace.md, 0),
        child: Material(
          color: colors.statusWarning.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.all(CoderSpace.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(l10n.workAttentionHeading, style: Theme.of(context).textTheme.titleSmall),
                if (_error != null) ...[
                  const SizedBox(height: CoderSpace.xs),
                  Text(_error!, style: TextStyle(color: colors.destructive, fontSize: 12)),
                ],
                for (final ticket in _tickets) ...[
                  const SizedBox(height: CoderSpace.sm),
                  Text(ticket.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(
                    _stageLabel(l10n, ticket.effectiveStage),
                    style: TextStyle(color: colors.statusWarning, fontSize: 12),
                  ),
                  if ((ticket.attentionQuestion ?? ticket.latestReportNote)?.isNotEmpty == true)
                    Padding(
                      padding: const EdgeInsets.only(top: CoderSpace.xs),
                      child: Text(
                        ticket.attentionQuestion ?? ticket.latestReportNote!,
                        style: TextStyle(color: colors.foregroundMuted, fontSize: 13),
                      ),
                    ),
                  if (ticket.effectiveStage == 'person/answer') ...[
                    const SizedBox(height: CoderSpace.xs),
                    TextField(
                      controller: _controllerFor(ticket.id),
                      decoration: InputDecoration(
                        hintText: l10n.workAttentionAnswerPlaceholder,
                        isDense: true,
                      ),
                      enabled: !_busy,
                      onSubmitted: (_) => unawaited(_answer(ticket)),
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: _busy ? null : () => unawaited(_answer(ticket)),
                        child: Text(l10n.workAttentionAnswerSend),
                      ),
                    ),
                  ],
                  Wrap(
                    spacing: CoderSpace.sm,
                    children: [
                      if (ticket.taskId != null)
                        TextButton(
                          onPressed: _busy ? null : () => unawaited(_openTask(ticket)),
                          child: Text(l10n.workAttentionOpenTask),
                        ),
                      if (ticket.effectiveStage == 'person/blocked' ||
                          ticket.effectiveStage == 'person/delivery')
                        TextButton(
                          onPressed: _busy ? null : () => unawaited(_retry(ticket)),
                          child: Text(l10n.workAttentionRetry),
                        ),
                      TextButton(
                        onPressed: _busy ? null : () => unawaited(_stop(ticket)),
                        child: Text(l10n.workAttentionStop),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
