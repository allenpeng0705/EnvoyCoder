/// Resolve `coder.assessTeamJobReadiness` messageKey into the phone's catalogue.
///
/// Prefer [TeamJobReadiness.messageKey] (+ values); fall back to the daemon's
/// English [TeamJobReadiness.message] when this build has no matching ARB.
library;

import '../l10n/l10n.dart';
import '../models/team_job.dart';

String teamJobReadinessText(AppLocalizations l10n, TeamJobReadiness readiness) {
  final key = readiness.messageKey;
  if (key == null || key.isEmpty) {
    return readiness.message.isNotEmpty ? readiness.message : l10n.teamJobStartBlocked;
  }
  final v = readiness.messageValues;
  switch (key) {
    case 'job.pane.crew.noSteps':
      return l10n.jobPaneCrewNoSteps;
    case 'job.pane.crew.noMembers':
      return l10n.jobPaneCrewNoMembers;
    case 'job.pane.crew.allOffline':
      return l10n.jobPaneCrewAllOffline(v['machines'] ?? readiness.offlineLabels.join(', '));
    case 'job.pane.crew.missingRoles':
      return l10n.jobPaneCrewMissingRoles(v['roles'] ?? readiness.missingRoles.join(', '));
    case 'teamJob.git.pathMissing':
      return l10n.teamJobGitPathMissing;
    case 'teamJob.git.notARepo':
      return l10n.teamJobGitNotARepo;
    case 'teamJob.git.noRemote':
      return l10n.teamJobGitNoRemote;
    case 'teamJob.git.missing':
      return l10n.teamJobGitMissing;
    case 'error.job.notDrafting':
      return l10n.errorJobNotDrafting;
    default:
      return readiness.message.isNotEmpty ? readiness.message : l10n.teamJobStartBlocked;
  }
}

String teamJobGitPolicyText(AppLocalizations l10n, String? policy) {
  switch (policy) {
    case 'path-missing':
      return l10n.teamJobGitPathMissing;
    case 'not-a-git-repo':
      return l10n.teamJobGitNotARepo;
    case 'no-git-remote':
      return l10n.teamJobGitNoRemote;
    case 'git-missing':
      return l10n.teamJobGitMissing;
    case null:
    case 'ok':
      return l10n.teamJobGitOk;
    default:
      return l10n.teamJobGitChecking;
  }
}

/// Step status for the watch sheet — prefer blocked reason over raw status when waiting on a peer.
String teamJobStepStatusText(AppLocalizations l10n, JobStepInfo step) {
  if (step.blocked == 'peer-offline') return l10n.teamJobStepWaitingPeer;
  switch (step.status) {
    case 'pending':
      return l10n.teamJobStepPending;
    case 'offered':
      return l10n.teamJobStepOffered;
    case 'running':
      return l10n.statusWorking;
    case 'succeeded':
    case 'done':
      return l10n.statusDone;
    case 'failed':
      return l10n.statusFailed;
    case 'stopped':
    case 'cancelled':
      return l10n.statusStopped;
    default:
      return step.status;
  }
}

/// Optional second line when a step is deferred until its assignee is online.
String? teamJobStepWaitingDetail(
  AppLocalizations l10n,
  JobStepInfo step, {
  required List<TeamMemberInfo> board,
}) {
  if (step.blocked != 'peer-offline') return null;
  final id = step.assigneeMemberId;
  if (id == null || id.isEmpty) return null;
  for (final m in board) {
    if (m.id == id) return l10n.teamJobStepWaitingPeerDetail(m.label);
  }
  return l10n.teamJobStepWaitingPeerDetail(id);
}

/// Extra lines under a step (gap / run phase) for the watch sheet.
List<String> teamJobStepExtraLines(AppLocalizations l10n, JobStepInfo step) {
  final lines = <String>[];
  if (step.hasGap) lines.add(l10n.jobPaneHasGap);
  final phase = step.runPhase?.trim();
  if (phase != null &&
      phase.isNotEmpty &&
      phase != 'idle' &&
      phase != 'starting' &&
      !step.needsApproval) {
    lines.add(l10n.teamJobStepPhase(phase));
  }
  return lines;
}
