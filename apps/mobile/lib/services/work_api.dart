/// HostClient wrappers for Work Engine attention RPCs.
library;

import '../models/work_ticket.dart';
import 'host_client.dart';

extension WorkHostClient on HostClient {
  Future<List<WorkTicketInfo>> listWorkAttention({String? projectId}) async {
    final result = await call('work.listAttention', {
      if (projectId != null) 'projectId': projectId,
    });
    final tickets = result['tickets'];
    if (tickets is! List) return const [];
    return tickets
        .whereType<Map>()
        .map((t) => WorkTicketInfo.fromJson(Map<String, dynamic>.from(t)))
        .toList(growable: false);
  }

  Future<WorkTicketInfo> answerWorkAttention({
    required String id,
    required String text,
  }) async {
    final result = await call('work.answerAttention', {'id': id, 'text': text});
    final ticket = result['ticket'];
    if (ticket is! Map) throw StateError('answerAttention returned no ticket');
    return WorkTicketInfo.fromJson(Map<String, dynamic>.from(ticket));
  }

  Future<WorkTicketInfo> retryWorkTicket(String id) async {
    final result = await call('work.retryTicket', {'id': id});
    final ticket = result['ticket'];
    if (ticket is! Map) throw StateError('retryTicket returned no ticket');
    return WorkTicketInfo.fromJson(Map<String, dynamic>.from(ticket));
  }

  Future<WorkTicketInfo> stopWorkTicket(String id, {String? reason}) async {
    final result = await call('work.stopTicket', {
      'id': id,
      if (reason != null) 'reason': reason,
    });
    final ticket = result['ticket'];
    if (ticket is! Map) throw StateError('stopTicket returned no ticket');
    return WorkTicketInfo.fromJson(Map<String, dynamic>.from(ticket));
  }
}
