/// Watch a Team job after Start — steps, approvals, recent ledger.
///
/// Kick / rotate / reassign stay on desktop. Approvals for origin (and remote
/// via origin) use `coder.answerJobStepApproval` so the phone can unblock a step.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/daemon_text.dart';
import '../l10n/l10n.dart';
import '../l10n/team_job_text.dart';
import '../models/team_job.dart';
import '../services/host_client.dart';
import '../services/team_job_api.dart';
import '../theme/tokens.dart';
import 'run_screen.dart';

Future<void> showTeamJobWatchSheet({
  required BuildContext context,
  required HostClient client,
  required String jobId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => _TeamJobWatchSheet(client: client, jobId: jobId),
  );
}

class _TeamJobWatchSheet extends StatefulWidget {
  const _TeamJobWatchSheet({required this.client, required this.jobId});

  final HostClient client;
  final String jobId;

  @override
  State<_TeamJobWatchSheet> createState() => _TeamJobWatchSheetState();
}

class _TeamJobWatchSheetState extends State<_TeamJobWatchSheet> {
  JobInfo? _job;
  List<TeamMemberInfo> _board = const [];
  bool _busy = false;
  String? _error;
  Timer? _poll;
  StreamSubscription<Map<String, dynamic>>? _eventSub;

  @override
  void initState() {
    super.initState();
    unawaited(_reload());
    _poll = Timer.periodic(const Duration(seconds: 4), (_) => unawaited(_reload(quiet: true)));
    _eventSub = widget.client.events.listen((frame) {
      if (frame['event'] != 'coder:state-changed') return;
      final data = frame['data'];
      if (data is Map && data['kind'] == 'jobs') {
        unawaited(_reload(quiet: true));
      }
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    unawaited(_eventSub?.cancel() ?? Future<void>.value());
    super.dispose();
  }

  Future<void> _reload({bool quiet = false}) async {
    if (!quiet) {
      setState(() {
        _busy = true;
        _error = null;
      });
    }
    try {
      final job = await widget.client.getJob(widget.jobId);
      // Readiness still returns the member board for a non-draft job (canStart false / not-drafting).
      final readiness = await widget.client.assessTeamJobReadiness(widget.jobId);
      if (!mounted) return;
      setState(() {
        _job = job;
        _board = readiness.board;
        // Quiet polls must not clear an in-flight pause/stop/answer busy lock.
        if (!quiet) _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        if (!quiet) {
          _busy = false;
          _error = daemonErrorText(context.l10n, error.toString());
        }
      });
    }
  }

  Future<void> _answer(JobStepInfo step, String optionId) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final requestId = step.approvalRequestId ?? step.id;
      await widget.client.answerJobStepApproval(
        jobId: widget.jobId,
        stepId: step.id,
        requestId: requestId,
        optionId: optionId,
      );
      await _reload();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = daemonErrorText(context.l10n, error.toString());
      });
    }
  }

  Future<void> _pause() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final job = await widget.client.pauseJob(widget.jobId);
      if (!mounted) return;
      setState(() {
        _job = job;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = daemonErrorText(context.l10n, error.toString());
      });
    }
  }

  Future<void> _stop() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final job = await widget.client.stopJob(widget.jobId);
      if (!mounted) return;
      setState(() {
        _job = job;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = daemonErrorText(context.l10n, error.toString());
      });
    }
  }

  Future<void> _resume() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final readiness = await widget.client.assessTeamJobReadiness(widget.jobId);
      if (!readiness.canStart) {
        if (!mounted) return;
        setState(() {
          _busy = false;
          _error = teamJobReadinessText(context.l10n, readiness);
        });
        return;
      }
      final job = await widget.client.startJob(widget.jobId);
      if (!mounted) return;
      setState(() {
        _job = job;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = daemonErrorText(context.l10n, error.toString());
      });
    }
  }

  Future<void> _openRun(JobStepInfo step) async {
    final runId = step.runId;
    if (runId == null || runId.isEmpty) return;
    final job = _job;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => RunScreen(
          client: widget.client,
          runId: runId,
          title: job == null ? step.role : '${step.role} — ${job.title}',
        ),
      ),
    );
    if (mounted) unawaited(_reload(quiet: true));
  }

  String _statusLabel(AppLocalizations l10n, JobInfo job) {
    if (job.looksPaused) return l10n.teamJobStatusPaused;
    return switch (job.status) {
      'drafting' => l10n.teamJobStatusDrafting,
      'running' => l10n.statusWorking,
      'paused' => l10n.teamJobStatusPaused,
      'done' => l10n.statusDone,
      'failed' => l10n.statusFailed,
      'stopped' => l10n.statusStopped,
      'succeeded' => l10n.statusDone,
      'cancelled' => l10n.statusStopped,
      'merging' => l10n.statusWorking,
      _ => job.status,
    };
  }

  String _connectionLabel(AppLocalizations l10n, String status) => switch (status) {
        'online' => l10n.teamJobPeerOnline,
        'degraded' => l10n.teamJobPeerDegraded,
        'offline' => l10n.teamJobPeerOffline,
        _ => status,
      };

  String? _stepSubtitle(AppLocalizations l10n, JobStepInfo step) {
    final parts = <String>[];
    final waiting = teamJobStepWaitingDetail(l10n, step, board: _board);
    if (waiting != null) parts.add(waiting);
    parts.addAll(teamJobStepExtraLines(l10n, step));
    final brief = step.brief.trim();
    if (brief.isNotEmpty) parts.add(brief);
    if (parts.isEmpty) return null;
    return parts.join('\n');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final job = _job;
    final ledgerTail = job == null
        ? const <JobLedgerNoteInfo>[]
        : job.ledger.length <= 8
            ? job.ledger
            : job.ledger.sublist(job.ledger.length - 8);
    final paused = job?.looksPaused == true;
    final canPause = job?.status == 'running';
    final canResume = paused;
    final canStop = job?.status == 'running' || paused;

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(CoderSpace.lg, CoderSpace.md, CoderSpace.lg, CoderSpace.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    job?.title ?? l10n.teamJobWatchTitle,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  tooltip: l10n.commonRefresh,
                  onPressed: _busy ? null : () => unawaited(_reload()),
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            if (job != null)
              Text(
                _statusLabel(l10n, job),
                style: TextStyle(color: colors.foregroundMuted, fontSize: 13),
              ),
            if (job != null && (canPause || canResume || canStop)) ...[
              const SizedBox(height: CoderSpace.sm),
              Row(
                children: [
                  if (canPause)
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _busy ? null : () => unawaited(_pause()),
                        child: Text(l10n.teamJobPause),
                      ),
                    ),
                  if (canResume)
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _busy ? null : () => unawaited(_resume()),
                        child: Text(l10n.teamJobResume),
                      ),
                    ),
                  if ((canPause || canResume) && canStop) const SizedBox(width: CoderSpace.sm),
                  if (canStop)
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _busy ? null : () => unawaited(_stop()),
                        child: Text(l10n.teamJobStop),
                      ),
                    ),
                ],
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: CoderSpace.sm),
              Text(_error!, style: TextStyle(color: colors.destructive, fontSize: 13)),
            ],
            if (job == null && _busy)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: CoderSpace.lg),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (job != null) ...[
              if (_board.isNotEmpty) ...[
                const SizedBox(height: CoderSpace.md),
                Text(l10n.teamJobPeersHeading, style: Theme.of(context).textTheme.titleSmall),
                for (final m in _board)
                  Padding(
                    padding: const EdgeInsets.only(top: CoderSpace.xs),
                    child: Text(
                      '${m.label} — ${_connectionLabel(l10n, m.connectionStatus)}'
                      '${m.rolesOffered.isEmpty ? '' : ' · ${m.rolesOffered.join(', ')}'}',
                      style: TextStyle(
                        color: m.isOnline ? colors.foregroundMuted : colors.statusWarning,
                        fontSize: 12,
                      ),
                    ),
                  ),
              ],
              const SizedBox(height: CoderSpace.md),
              Text(l10n.teamJobStepsHeading, style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: CoderSpace.xs),
              for (final step in job.steps) ...[
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  onTap: step.runId != null && step.runId!.isNotEmpty
                      ? () => unawaited(_openRun(step))
                      : null,
                  title: Text(
                    '${step.role} — ${teamJobStepStatusText(l10n, step)}',
                    style: TextStyle(
                      color: step.waitingForPeer || step.hasGap ? colors.statusWarning : null,
                    ),
                  ),
                  subtitle: () {
                    final text = _stepSubtitle(l10n, step);
                    if (text == null) return null;
                    return Text(
                      text,
                      maxLines: 4,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: step.waitingForPeer || step.hasGap
                            ? colors.statusWarning
                            : colors.foregroundMuted,
                        fontSize: 12,
                      ),
                    );
                  }(),
                  trailing: step.runId != null && step.runId!.isNotEmpty
                      ? IconButton(
                          tooltip: l10n.teamJobOpenRun,
                          onPressed: () => unawaited(_openRun(step)),
                          icon: const Icon(Icons.open_in_new, size: 20),
                        )
                      : null,
                ),
                if (step.needsApproval)
                  Padding(
                    padding: const EdgeInsets.only(bottom: CoderSpace.sm),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          l10n.jobPaneNeedsApproval,
                          style: TextStyle(color: colors.statusWarning, fontSize: 13),
                        ),
                        const SizedBox(height: CoderSpace.xs),
                        Row(
                          children: [
                            Expanded(
                              child: FilledButton(
                                onPressed: _busy ? null : () => unawaited(_answer(step, 'allow')),
                                child: Text(l10n.jobPaneApprove),
                              ),
                            ),
                            const SizedBox(width: CoderSpace.sm),
                            Expanded(
                              child: OutlinedButton(
                                onPressed: _busy ? null : () => unawaited(_answer(step, 'deny')),
                                child: Text(l10n.jobPaneDeny),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
              ],
              const SizedBox(height: CoderSpace.sm),
              Text(l10n.teamJobNeedsDesktopHint, style: TextStyle(color: colors.foregroundMuted, fontSize: 12)),
              if (ledgerTail.isNotEmpty) ...[
                const SizedBox(height: CoderSpace.md),
                Text(l10n.teamJobLedgerHeading, style: Theme.of(context).textTheme.titleSmall),
                for (final note in ledgerTail.reversed)
                  Padding(
                    padding: const EdgeInsets.only(top: CoderSpace.xs),
                    child: Text(
                      note.message,
                      style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
                    ),
                  ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}
