/// Team job models + readiness copy — no socket.
library;

import 'package:envoydev_mobile/l10n/l10n.dart';
import 'package:envoydev_mobile/l10n/team_job_text.dart';
import 'package:envoydev_mobile/models/team_job.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final l10n = lookupAppLocalizations(kFallbackLocale);

  test('TeamJobReadiness.fromJson keeps blockKind and messageKey for the phone', () {
    final r = TeamJobReadiness.fromJson({
      'canStart': false,
      'jobStatus': 'drafting',
      'blockKind': 'missing-roles',
      'message': 'No online machine offers: tester.',
      'messageKey': 'job.pane.crew.missingRoles',
      'messageValues': {'roles': 'tester'},
      'missingRoles': ['tester'],
      'offlineLabels': <String>[],
      'git': {'ok': true},
      'board': [
        {
          'memberId': 'local',
          'label': 'desk',
          'rolesOffered': ['developer'],
          'connection': {'status': 'online'},
        },
      ],
    });
    expect(r.canStart, isFalse);
    expect(r.blockKind, 'missing-roles');
    expect(r.messageKey, 'job.pane.crew.missingRoles');
    expect(r.board.single.label, 'desk');
    expect(teamJobReadinessText(l10n, r), contains('tester'));
  });

  test('ready readiness has empty message and canStart', () {
    final r = TeamJobReadiness.fromJson({
      'canStart': true,
      'jobStatus': 'drafting',
      'message': '',
      'missingRoles': <String>[],
      'offlineLabels': <String>[],
      'git': {'ok': true},
      'board': <Object>[],
    });
    expect(r.canStart, isTrue);
    expect(r.message, isEmpty);
  });

  test('git policy copy covers content-bus refusals', () {
    expect(teamJobGitPolicyText(l10n, 'no-git-remote'), isNotEmpty);
    expect(teamJobGitPolicyText(l10n, 'ok'), l10n.teamJobGitOk);
  });

  test('JobInfo parses steps for the watch sheet', () {
    final job = JobInfo.fromJson({
      'id': 'j1',
      'teamId': 't1',
      'title': 'Ship',
      'goal': 'done',
      'status': 'running',
      'steps': [
        {'id': 's1', 'role': 'developer', 'status': 'offered', 'brief': 'code'},
      ],
      'ledger': [
        {'at': '2026-01-01T00:00:00Z', 'kind': 'info', 'message': 'Job started'},
      ],
    });
    expect(job.steps.single.role, 'developer');
    expect(job.ledger.single.message, 'Job started');
  });

  test('peer-offline blocked steps read as waiting for a machine', () {
    final step = JobStepInfo.fromJson({
      'id': 's1',
      'role': 'developer',
      'status': 'pending',
      'brief': 'implement',
      'assigneeMemberId': 'm-peer',
      'blocked': 'peer-offline',
    });
    expect(step.waitingForPeer, isTrue);
    expect(teamJobStepStatusText(l10n, step), l10n.teamJobStepWaitingPeer);
    final board = [
      TeamMemberInfo(id: 'm-peer', label: 'Laptop B', connectionStatus: 'offline'),
    ];
    expect(
      teamJobStepWaitingDetail(l10n, step, board: board),
      l10n.teamJobStepWaitingPeerDetail('Laptop B'),
    );
  });

  test('hasGap surfaces the desktop gap sentence', () {
    final step = JobStepInfo.fromJson({
      'id': 's1',
      'role': 'developer',
      'status': 'running',
      'hasGap': true,
      'runPhase': 'streaming',
    });
    expect(step.hasGap, isTrue);
    final lines = teamJobStepExtraLines(l10n, step);
    expect(lines, contains(l10n.jobPaneHasGap));
    expect(lines, contains(l10n.teamJobStepPhase('streaming')));
  });

  test('looksPaused follows the daemon pause ledger note on drafting status', () {
    final paused = JobInfo.fromJson({
      'id': 'j1',
      'teamId': 't1',
      'title': 'Ship',
      'goal': 'done',
      'status': 'drafting',
      'updatedAt': '2026-01-02T00:00:00Z',
      'ledger': [
        {'at': '2026-01-02T00:00:00Z', 'kind': 'info', 'message': 'Job paused — no new offers'},
      ],
    });
    expect(paused.looksPaused, isTrue);
    final fresh = JobInfo.fromJson({
      'id': 'j2',
      'teamId': 't1',
      'title': 'New',
      'goal': 'x',
      'status': 'drafting',
      'updatedAt': '2026-01-01T00:00:00Z',
      'ledger': [
        {'at': '2026-01-01T00:00:00Z', 'kind': 'info', 'message': 'Job created: New'},
      ],
    });
    expect(fresh.looksPaused, isFalse);
  });
}
