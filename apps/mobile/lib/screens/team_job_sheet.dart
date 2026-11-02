/// Draft + Start a Team job from a project — thin client of the origin daemon.
///
/// Opens with existing jobs for this project (resume draft / watch), or create.
/// No team create / invite / rotate on the phone. Start is gated by
/// `coder.assessTeamJobReadiness` so the daemon owns the blocked reason.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/daemon_text.dart';
import '../l10n/l10n.dart';
import '../l10n/team_job_text.dart';
import '../models/project_rail.dart';
import '../models/team_job.dart';
import '../services/host_client.dart';
import '../services/team_job_api.dart';
import '../theme/tokens.dart';
import 'team_job_watch_sheet.dart';

Future<void> showTeamJobSheet({
  required BuildContext context,
  required HostClient client,
  required ProjectInfo project,
}) {
  // Keep the caller's context — after this sheet pops we still need a mounted host for the watch sheet.
  final hostContext = context;
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheetContext).bottom),
      child: _TeamJobSheet(client: client, project: project, hostContext: hostContext),
    ),
  );
}

enum _Phase { pick, create, startGate }

class _TeamJobSheet extends StatefulWidget {
  const _TeamJobSheet({
    required this.client,
    required this.project,
    required this.hostContext,
  });

  final HostClient client;
  final ProjectInfo project;
  final BuildContext hostContext;

  @override
  State<_TeamJobSheet> createState() => _TeamJobSheetState();
}

class _TeamJobSheetState extends State<_TeamJobSheet> {
  final _title = TextEditingController();
  final _goal = TextEditingController();

  _Phase _phase = _Phase.pick;
  List<TeamInfo> _teams = const [];
  List<JobInfo> _jobs = const [];
  List<JobStepTemplateInfo> _templates = const [];
  String? _teamId;
  String? _templateId;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  String? _gitPolicy;
  JobInfo? _draft;
  TeamJobReadiness? _readiness;

  @override
  void initState() {
    super.initState();
    _title.addListener(() => setState(() {}));
    _goal.addListener(() => setState(() {}));
    unawaited(_load());
  }

  @override
  void dispose() {
    _title.dispose();
    _goal.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final teams = await widget.client.listTeams();
      final jobs = await widget.client.listJobs(projectId: widget.project.id);
      final git = await widget.client.assessGitContentBus(widget.project.path);
      List<JobStepTemplateInfo> templates = const [];
      try {
        templates = await widget.client.listJobStepTemplates();
      } catch (_) {}
      if (!mounted) return;
      // Active first, then recent terminal — so finished jobs stay reopenable.
      const activeStatuses = {'drafting', 'running', 'paused', 'merging'};
      int recency(JobInfo j) {
        final stamp = j.updatedAt ?? j.createdAt ?? '';
        return stamp.isEmpty ? 0 : DateTime.tryParse(stamp)?.millisecondsSinceEpoch ?? 0;
      }
      final sorted = [...jobs]..sort((a, b) {
          final aActive = activeStatuses.contains(a.status) || a.looksPaused;
          final bActive = activeStatuses.contains(b.status) || b.looksPaused;
          if (aActive != bActive) return aActive ? -1 : 1;
          return recency(b).compareTo(recency(a));
        });
      setState(() {
        _teams = teams;
        _jobs = sorted;
        _templates = templates;
        _templateId = templates.isNotEmpty
            ? (templates.any((t) => t.id == 'solo') ? 'solo' : templates.first.id)
            : 'solo';
        _teamId = teams.isNotEmpty ? teams.first.id : null;
        _gitPolicy = git.ok ? 'ok' : git.policy;
        _loading = false;
        // Skip the picker when there is nothing to resume.
        _phase = sorted.isEmpty && teams.isNotEmpty ? _Phase.create : _Phase.pick;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = daemonErrorText(context.l10n, error.toString());
      });
    }
  }

  TeamInfo? get _selected {
    final id = _teamId;
    if (id == null) return null;
    for (final t in _teams) {
      if (t.id == id) return t;
    }
    return null;
  }

  Future<void> _openWatch(String jobId) async {
    if (!mounted) return;
    final host = widget.hostContext;
    Navigator.of(context).pop();
    if (!host.mounted) return;
    await showTeamJobWatchSheet(
      context: host,
      client: widget.client,
      jobId: jobId,
    );
  }

  Future<void> _openExisting(JobInfo job) async {
    // Never-started drafts go to the Start gate; paused (drafting + pause ledger) go to watch.
    if (job.status == 'drafting' && !job.looksPaused) {
      setState(() {
        _busy = true;
        _error = null;
        _draft = job;
        _title.text = job.title;
        _goal.text = job.goal;
        _teamId = job.teamId;
      });
      try {
        final readiness = await widget.client.assessTeamJobReadiness(job.id);
        if (!mounted) return;
        setState(() {
          _readiness = readiness;
          _phase = _Phase.startGate;
          _busy = false;
        });
      } catch (error) {
        if (!mounted) return;
        setState(() {
          _busy = false;
          _error = daemonErrorText(context.l10n, error.toString());
        });
      }
      return;
    }
    await _openWatch(job.id);
  }

  Future<void> _createDraft() async {
    final teamId = _teamId;
    final title = _title.text.trim();
    final goal = _goal.text.trim();
    if (teamId == null || title.isEmpty || goal.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    JobInfo? created;
    try {
      // Create empty draft, then apply a named template (same path as desktop Job pane Suggest).
      created = await widget.client.createJob(
        teamId: teamId,
        title: title,
        goal: goal,
        projectId: widget.project.id,
      );
      var job = created;
      final suggested = await widget.client.suggestJobSteps(
        jobId: job.id,
        templateId: _templateId,
        hint: goal.length > 500 ? goal.substring(0, 500) : goal,
      );
      final cwd = widget.project.path;
      final steps = suggested.steps
          .map((raw) {
            final step = Map<String, dynamic>.from(raw);
            final hint = (step['cwdHint'] as String?)?.trim();
            if (hint == null || hint.isEmpty || hint == '.') {
              step['cwdHint'] = cwd;
            }
            return step;
          })
          .toList(growable: false);
      if (steps.isNotEmpty) {
        job = await widget.client.updateJobSteps(jobId: job.id, steps: steps);
      }
      final readiness = await widget.client.assessTeamJobReadiness(job.id);
      if (!mounted) return;
      setState(() {
        _draft = job;
        _readiness = readiness;
        _phase = _Phase.startGate;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      // A persisted draft must not stay invisible — recover into Start gate so Create is not double-tapped.
      if (created != null) {
        try {
          final readiness = await widget.client.assessTeamJobReadiness(created.id);
          if (!mounted) return;
          setState(() {
            _draft = created;
            _readiness = readiness;
            _phase = _Phase.startGate;
            _busy = false;
            _error = daemonErrorText(context.l10n, error.toString());
          });
          return;
        } catch (_) {
          /* fall through */
        }
      }
      setState(() {
        _busy = false;
        _error = daemonErrorText(context.l10n, error.toString());
      });
    }
  }

  Future<void> _refreshReadiness() async {
    final job = _draft;
    if (job == null || _busy) return;
    setState(() => _busy = true);
    try {
      final readiness = await widget.client.assessTeamJobReadiness(job.id);
      if (!mounted) return;
      setState(() {
        _readiness = readiness;
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

  Future<void> _start() async {
    final job = _draft;
    if (job == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final readiness = await widget.client.assessTeamJobReadiness(job.id);
      if (!readiness.canStart) {
        if (!mounted) return;
        setState(() {
          _readiness = readiness;
          _busy = false;
        });
        return;
      }
      final started = await widget.client.startJob(job.id);
      if (!mounted) return;
      await _openWatch(started.id);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = daemonErrorText(context.l10n, error.toString());
      });
      await _refreshReadiness();
    }
  }

  String _jobStatusLabel(AppLocalizations l10n, JobInfo job) {
    if (job.looksPaused) return l10n.teamJobStatusPaused;
    return switch (job.status) {
      'drafting' => l10n.teamJobStatusDrafting,
      'running' => l10n.statusWorking,
      'paused' => l10n.teamJobStatusPaused,
      'done' => l10n.statusDone,
      'failed' => l10n.statusFailed,
      'cancelled' => l10n.statusStopped,
      'stopped' => l10n.statusStopped,
      'merging' => l10n.statusWorking,
      _ => job.status,
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final selected = _selected;
    final joiners = selected?.members.where((m) => m.id != 'local').toList() ?? const [];
    final onlineJoiners = joiners.where((m) => m.isOnline).toList();
    final readiness = _readiness;
    final canStart = readiness?.canStart == true;

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(CoderSpace.lg, CoderSpace.md, CoderSpace.lg, CoderSpace.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.teamJobCreateTitle, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: CoderSpace.xs),
            Text(
              l10n.teamJobCreateBlurb(widget.project.label),
              style: TextStyle(color: colors.foregroundMuted, fontSize: 13),
            ),
            const SizedBox(height: CoderSpace.md),
            Text(
              teamJobGitPolicyText(l10n, _gitPolicy),
              style: TextStyle(
                color: _gitPolicy == 'ok' || _gitPolicy == null
                    ? colors.foregroundMuted
                    : colors.statusWarning,
                fontSize: 13,
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: CoderSpace.sm),
              Text(_error!, style: TextStyle(color: colors.destructive, fontSize: 13)),
            ],
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: CoderSpace.lg),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_phase == _Phase.pick) ...[
              if (_teams.isEmpty) ...[
                const SizedBox(height: CoderSpace.md),
                Text(l10n.teamJobCrewNoTeamDesktop, style: TextStyle(color: colors.foregroundMuted)),
                const SizedBox(height: CoderSpace.md),
                OutlinedButton(
                  onPressed: _busy ? null : () => unawaited(_load()),
                  child: Text(l10n.commonRefresh),
                ),
              ] else ...[
                if (_jobs.isNotEmpty) ...[
                  const SizedBox(height: CoderSpace.md),
                  Text(l10n.teamJobExistingHeading, style: Theme.of(context).textTheme.titleSmall),
                  for (final job in _jobs)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(job.title),
                      subtitle: Text(_jobStatusLabel(l10n, job)),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: _busy ? null : () => unawaited(_openExisting(job)),
                    ),
                ],
                const SizedBox(height: CoderSpace.md),
                FilledButton(
                  onPressed: _busy
                      ? null
                      : () => setState(() {
                            _phase = _Phase.create;
                            _draft = null;
                            _readiness = null;
                          }),
                  child: Text(l10n.teamJobNewCta),
                ),
              ],
            ] else if (_phase == _Phase.create) ...[
              const SizedBox(height: CoderSpace.md),
              if (_jobs.isNotEmpty)
                TextButton(
                  onPressed: () => setState(() => _phase = _Phase.pick),
                  child: Text(l10n.teamJobBackToList),
                ),
              Text(l10n.teamJobCreateTeam, style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: CoderSpace.xs),
              DropdownButtonFormField<String>(
                // ignore: deprecated_member_use — controlled field; initialValue is not enough.
                value: _teamId,
                items: [
                  for (final t in _teams)
                    DropdownMenuItem(value: t.id, child: Text(t.label)),
                ],
                onChanged: _busy ? null : (v) => setState(() => _teamId = v),
              ),
              if (joiners.isEmpty) ...[
                const SizedBox(height: CoderSpace.sm),
                Text(l10n.teamJobCrewNoJoiners, style: TextStyle(color: colors.foregroundMuted, fontSize: 13)),
              ] else if (onlineJoiners.isEmpty) ...[
                const SizedBox(height: CoderSpace.sm),
                Text(
                  l10n.teamJobCrewAllOffline(joiners.map((m) => m.label).join(', ')),
                  style: TextStyle(color: colors.statusWarning, fontSize: 13),
                ),
              ],
              const SizedBox(height: CoderSpace.md),
              TextField(
                controller: _title,
                decoration: InputDecoration(labelText: l10n.teamJobCreateJobTitle),
                textInputAction: TextInputAction.next,
                enabled: !_busy,
              ),
              const SizedBox(height: CoderSpace.sm),
              TextField(
                controller: _goal,
                decoration: InputDecoration(labelText: l10n.teamJobCreateJobGoal),
                minLines: 2,
                maxLines: 4,
                enabled: !_busy,
              ),
              if (_templates.isNotEmpty) ...[
                const SizedBox(height: CoderSpace.md),
                Text(l10n.teamJobTemplate, style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: CoderSpace.xs),
                DropdownButtonFormField<String>(
                  // ignore: deprecated_member_use — controlled field; initialValue is not enough.
                  value: _templateId,
                  items: [
                    for (final t in _templates)
                      DropdownMenuItem(
                        value: t.id,
                        child: Text(t.title, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: _busy ? null : (v) => setState(() => _templateId = v),
                ),
                if (_templateId != null)
                  Padding(
                    padding: const EdgeInsets.only(top: CoderSpace.xs),
                    child: Text(
                      _templates
                          .firstWhere(
                            (t) => t.id == _templateId,
                            orElse: () => _templates.first,
                          )
                          .detail,
                      style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
                    ),
                  ),
              ],
              const SizedBox(height: CoderSpace.sm),
              Text(l10n.teamJobCreateDraftHint, style: TextStyle(color: colors.foregroundMuted, fontSize: 12)),
              const SizedBox(height: CoderSpace.md),
              FilledButton(
                onPressed: _busy ||
                        _teamId == null ||
                        _title.text.trim().isEmpty ||
                        _goal.text.trim().isEmpty
                    ? null
                    : () => unawaited(_createDraft()),
                child: Text(_busy ? l10n.commonSaving : l10n.teamJobCreateSubmit),
              ),
            ] else ...[
              const SizedBox(height: CoderSpace.md),
              TextButton(
                onPressed: _busy
                    ? null
                    : () => setState(() {
                          _phase = _Phase.create;
                          _readiness = null;
                        }),
                child: Text(l10n.teamJobBackToEdit),
              ),
              Text(_draft!.title, style: Theme.of(context).textTheme.titleMedium),
              Text(_draft!.goal, style: TextStyle(color: colors.foregroundMuted, fontSize: 13)),
              if (_draft!.steps.isNotEmpty) ...[
                const SizedBox(height: CoderSpace.sm),
                Text(l10n.teamJobStepsHeading, style: Theme.of(context).textTheme.titleSmall),
                for (final step in _draft!.steps)
                  Padding(
                    padding: const EdgeInsets.only(top: CoderSpace.xs),
                    child: Text(
                      '${step.role}: ${step.brief}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
                    ),
                  ),
              ],
              const SizedBox(height: CoderSpace.md),
              if (readiness != null && !readiness.canStart)
                Text(
                  teamJobReadinessText(l10n, readiness),
                  style: TextStyle(color: colors.statusWarning, fontSize: 13),
                )
              else if (canStart)
                Text(l10n.teamJobReadyToStart, style: TextStyle(color: colors.foregroundMuted, fontSize: 13)),
              if (readiness != null && readiness.board.isNotEmpty) ...[
                const SizedBox(height: CoderSpace.sm),
                for (final m in readiness.board)
                  Text(
                    '${m.label}: ${m.connectionStatus}',
                    style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
                  ),
              ],
              const SizedBox(height: CoderSpace.sm),
              Text(l10n.teamJobNeedsDesktopHint, style: TextStyle(color: colors.foregroundMuted, fontSize: 12)),
              const SizedBox(height: CoderSpace.md),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _busy ? null : () => unawaited(_refreshReadiness()),
                      child: Text(l10n.commonRefresh),
                    ),
                  ),
                  const SizedBox(width: CoderSpace.sm),
                  Expanded(
                    child: FilledButton(
                      onPressed: _busy || !canStart ? null : () => unawaited(_start()),
                      child: Text(l10n.jobPaneStart),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
