/// Team job models — thin Dart views of the origin daemon's M5 types.
///
/// The phone never invents Start policy: [TeamJobReadiness] is whatever
/// `coder.assessTeamJobReadiness` returned (crew + Git + drafting).
library;

class TeamMemberInfo {
  const TeamMemberInfo({
    required this.id,
    required this.label,
    required this.connectionStatus,
    this.rolesOffered = const [],
  });

  final String id;
  final String label;
  final String connectionStatus;
  final List<String> rolesOffered;

  bool get isOnline => connectionStatus == 'online' || connectionStatus == 'degraded';

  factory TeamMemberInfo.fromJson(Map<String, dynamic> json) {
    final connection = json['connection'];
    final roles = json['rolesOffered'];
    return TeamMemberInfo(
      id: (json['id'] as String?) ?? '',
      label: (json['label'] as String?) ?? '',
      connectionStatus: connection is Map
          ? (connection['status'] as String?) ?? 'offline'
          : 'offline',
      rolesOffered: roles is List
          ? roles.whereType<String>().toList(growable: false)
          : const [],
    );
  }
}

class TeamInfo {
  const TeamInfo({
    required this.id,
    required this.label,
    this.members = const [],
  });

  final String id;
  final String label;
  final List<TeamMemberInfo> members;

  factory TeamInfo.fromJson(Map<String, dynamic> json) {
    final members = json['members'];
    return TeamInfo(
      id: (json['id'] as String?) ?? '',
      label: (json['label'] as String?) ?? '',
      members: members is List
          ? members
              .whereType<Map>()
              .map((m) => TeamMemberInfo.fromJson(Map<String, dynamic>.from(m)))
              .toList(growable: false)
          : const [],
    );
  }
}

class JobStepInfo {
  const JobStepInfo({
    required this.id,
    required this.role,
    required this.status,
    this.brief = '',
    this.assigneeMemberId,
    this.runId,
    this.resultRef,
    this.approvalRequestId,
    this.runPhase,
    this.blocked,
  });

  final String id;
  final String role;
  final String status;
  final String brief;
  final String? assigneeMemberId;
  final String? runId;
  final String? resultRef;
  final String? approvalRequestId;
  final String? runPhase;
  final String? blocked;

  bool get needsApproval =>
      runPhase == 'needs-attention' || blocked == 'needs-attention';

  factory JobStepInfo.fromJson(Map<String, dynamic> json) => JobStepInfo(
        id: (json['id'] as String?) ?? '',
        role: (json['role'] as String?) ?? '',
        status: (json['status'] as String?) ?? 'pending',
        brief: (json['brief'] as String?) ?? '',
        assigneeMemberId: json['assigneeMemberId'] as String?,
        runId: json['runId'] as String? ?? json['resultRef'] as String?,
        resultRef: json['resultRef'] as String?,
        approvalRequestId: json['approvalRequestId'] as String?,
        runPhase: json['runPhase'] as String?,
        blocked: json['blocked'] as String?,
      );
}

class JobLedgerNoteInfo {
  const JobLedgerNoteInfo({
    required this.at,
    required this.kind,
    required this.message,
  });

  final String at;
  final String kind;
  final String message;

  factory JobLedgerNoteInfo.fromJson(Map<String, dynamic> json) => JobLedgerNoteInfo(
        at: (json['at'] as String?) ?? '',
        kind: (json['kind'] as String?) ?? 'info',
        message: (json['message'] as String?) ?? '',
      );
}

class JobInfo {
  const JobInfo({
    required this.id,
    required this.teamId,
    required this.title,
    required this.goal,
    required this.status,
    this.projectId,
    this.steps = const [],
    this.ledger = const [],
  });

  final String id;
  final String teamId;
  final String title;
  final String goal;
  final String status;
  final String? projectId;
  final List<JobStepInfo> steps;
  final List<JobLedgerNoteInfo> ledger;

  factory JobInfo.fromJson(Map<String, dynamic> json) {
    final steps = json['steps'];
    final ledger = json['ledger'];
    return JobInfo(
      id: (json['id'] as String?) ?? '',
      teamId: (json['teamId'] as String?) ?? '',
      title: (json['title'] as String?) ?? '',
      goal: (json['goal'] as String?) ?? '',
      status: (json['status'] as String?) ?? 'drafting',
      projectId: json['projectId'] as String?,
      steps: steps is List
          ? steps
              .whereType<Map>()
              .map((s) => JobStepInfo.fromJson(Map<String, dynamic>.from(s)))
              .toList(growable: false)
          : const [],
      ledger: ledger is List
          ? ledger
              .whereType<Map>()
              .map((n) => JobLedgerNoteInfo.fromJson(Map<String, dynamic>.from(n)))
              .toList(growable: false)
          : const [],
    );
  }
}

/// Structured Start gate from the origin daemon — never invent a second policy on the phone.
class TeamJobReadiness {
  const TeamJobReadiness({
    required this.canStart,
    required this.jobStatus,
    required this.message,
    this.blockKind,
    this.messageKey,
    this.messageValues = const {},
    this.missingRoles = const [],
    this.offlineLabels = const [],
    this.gitOk = true,
    this.gitPolicy,
    this.board = const [],
  });

  final bool canStart;
  final String jobStatus;
  final String message;
  final String? blockKind;
  final String? messageKey;
  final Map<String, String> messageValues;
  final List<String> missingRoles;
  final List<String> offlineLabels;
  final bool gitOk;
  final String? gitPolicy;
  final List<TeamMemberInfo> board;

  factory TeamJobReadiness.fromJson(Map<String, dynamic> json) {
    final git = json['git'];
    final values = json['messageValues'];
    final missing = json['missingRoles'];
    final offline = json['offlineLabels'];
    final board = json['board'];
    return TeamJobReadiness(
      canStart: json['canStart'] == true,
      jobStatus: (json['jobStatus'] as String?) ?? '',
      message: (json['message'] as String?) ?? '',
      blockKind: json['blockKind'] as String?,
      messageKey: json['messageKey'] as String?,
      messageValues: values is Map
          ? {
              for (final e in values.entries)
                if (e.key is String && e.value is String) e.key as String: e.value as String,
            }
          : const {},
      missingRoles: missing is List
          ? missing.whereType<String>().toList(growable: false)
          : const [],
      offlineLabels: offline is List
          ? offline.whereType<String>().toList(growable: false)
          : const [],
      gitOk: git is Map ? git['ok'] == true : true,
      gitPolicy: git is Map && git['ok'] != true ? git['policy'] as String? : null,
      board: board is List
          ? board
              .whereType<Map>()
              .map((m) {
                final map = Map<String, dynamic>.from(m);
                // MemberStatus uses memberId; TeamMemberInfo uses id.
                return TeamMemberInfo.fromJson({
                  'id': map['memberId'] ?? map['id'] ?? '',
                  'label': map['label'] ?? '',
                  'connection': map['connection'],
                  'rolesOffered': map['rolesOffered'],
                });
              })
              .toList(growable: false)
          : const [],
    );
  }
}

class JobStepTemplateInfo {
  const JobStepTemplateInfo({
    required this.id,
    required this.title,
    this.detail = '',
  });

  final String id;
  final String title;
  final String detail;

  factory JobStepTemplateInfo.fromJson(Map<String, dynamic> json) => JobStepTemplateInfo(
        id: (json['id'] as String?) ?? '',
        title: (json['title'] as String?) ?? '',
        detail: (json['detail'] as String?) ?? '',
      );
}
