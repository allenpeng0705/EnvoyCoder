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
