/// Thin Dart view of a Work Engine ticket (attention surface).
library;

class WorkTicketInfo {
  const WorkTicketInfo({
    required this.id,
    required this.title,
    required this.status,
    this.taskId,
    this.projectId,
    this.externalRef,
    this.attentionQuestion,
    this.latestReportNote,
    this.latestReportKind,
    this.deliveryFailed = false,
    this.stage,
  });

  final String id;
  final String title;
  final String status;
  final String? taskId;
  final String? projectId;
  final String? externalRef;
  final String? attentionQuestion;
  final String? latestReportNote;
  final String? latestReportKind;
  final bool deliveryFailed;
  /// Wire stage when the daemon includes it; else derived in [effectiveStage].
  final String? stage;

  String get effectiveStage {
    if (stage != null && stage!.isNotEmpty) return stage!;
    if (status == 'ended') return 'idle';
    if (deliveryFailed) return 'person/delivery';
    final q = attentionQuestion?.trim() ?? '';
    if (q.isNotEmpty) return 'person/answer';
    final report = latestReportKind;
    if (report == 'ready') return 'person/review';
    if (report == 'blocked' || report == 'failed') return 'person/blocked';
    return 'working';
  }

  bool get needsPerson => status == 'open' && effectiveStage.startsWith('person/');

  factory WorkTicketInfo.fromJson(Map<String, dynamic> json) {
    final attention = json['attention'];
    final report = json['latestReport'];
    return WorkTicketInfo(
      id: (json['id'] as String?) ?? '',
      title: (json['title'] as String?) ?? '',
      status: (json['status'] as String?) ?? 'open',
      taskId: json['taskId'] as String?,
      projectId: json['projectId'] as String?,
      externalRef: json['externalRef'] as String?,
      attentionQuestion: attention is Map ? attention['question'] as String? : null,
      latestReportNote: report is Map ? report['note'] as String? : null,
      latestReportKind: report is Map ? report['kind'] as String? : null,
      deliveryFailed: json['deliveryFailed'] == true,
      stage: json['stage'] as String?,
    );
  }
}
