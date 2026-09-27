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
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: _TeamJobSheet(client: client, project: project),
    ),
  );
}

enum _Phase { pick, create, startGate }

class _TeamJobSheet extends StatefulWidget {
  const _TeamJobSheet({required this.client, required this.project});

  final HostClient client;
  final ProjectInfo project;

  @override
  State<_TeamJobSheet> createState() => _TeamJobSheetState();
}

class _TeamJobSheetState extends State<_TeamJobSheet> {
  final _title = TextEditingController();
  final _goal = TextEditingController();

  _Phase _phase = _Phase.pick;
  List<TeamInfo> _teams = const [];
  List<JobInfo> _jobs = const [];
  String? _teamId;
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
      if (!mounted) return;
      final active = jobs
          .where((j) => j.status == 'drafting' || j.status == 'running' || j.status == 'paused')
          .toList(growable: false);
      setState(() {
        _teams = teams;
        _jobs = active;
        _teamId = teams.isNotEmpty ? teams.first.id : null;
        _gitPolicy = git.ok ? 'ok' : git.policy;
        _loading = false;
        // Skip the picker when there is nothing to resume.
        _phase = active.isEmpty && teams.isNotEmpty ? _Phase.create : _Phase.pick;
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

  Future<void> _openExisting(JobInfo job) async {
    if (job.status == 'drafting') {
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
    if (!mounted) return;
    Navigator.of(context).pop();
    await showTeamJobWatchSheet(
      context: context,
      client: widget.client,
      jobId: job.id,
    );
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
    try {
      final job = await widget.client.createJob(
        teamId: teamId,
        title: title,
        goal: goal,
        projectId: widget.project.id,
        steps: [
          {
            'role': 'developer',
            'brief': goal.length > 500 ? goal.substring(0, 500) : goal,
            'worktreeKey': '${widget.project.id}:main',
            'cwdHint': widget.project.path,
          },
        ],
      );
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
      Navigator.of(context).pop();
      await showTeamJobWatchSheet(
        context: context,
        client: widget.client,
        jobId: started.id,
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = daemonErrorText(context.l10n, error.toString());
      });
      await _refreshReadiness();
    }
  }

  String _jobStatusLabel(AppLocalizations l10n, String status) => switch (status) {
        'drafting' => l10n.teamJobStatusDrafting,
        'running' => l10n.statusWorking,
        'paused' => l10n.teamJobStatusPaused,
        _ => status,
      };

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
                      subtitle: Text(_jobStatusLabel(l10n, job.status)),
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
