// The transcript's folding rules.
//
// Every case here is one that rendered visibly wrong in the first version of the run screen: a
// streaming answer became a column of one-word rows, a tool call lost its label when it finished,
// an answered question kept asking, and a reconnect duplicated the tail.
//
// The events are hand-built rather than produced by a run, on purpose: this is a test of the
// *folding*, and driving a real agent to produce a particular sequence would make it a test about the
// agent.

import 'package:envoydev_mobile/models/transcript.dart';
import 'package:flutter_test/flutter_test.dart';

/// One event, numbered in the order it is applied.
Map<String, dynamic> at(int seq, Map<String, dynamic> event) => {
      'runId': 'r1',
      'taskId': 't1',
      'seq': seq,
      ...event,
    };

Transcript folded(List<Map<String, dynamic>> events) {
  final transcript = Transcript();
  for (final event in events) {
    transcript.apply(event);
  }
  return transcript;
}

void main() {
  group('what an agent streams', () {
    test('joins chunks of one message into a single row', () {
      final transcript = folded([
        at(1, {'kind': 'run.output', 'stream': 'assistant', 'text': 'Hello', 'messageId': 'm1'}),
        at(2, {'kind': 'run.output', 'stream': 'assistant', 'text': ', ', 'messageId': 'm1'}),
        at(3, {'kind': 'run.output', 'stream': 'assistant', 'text': 'world', 'messageId': 'm1'}),
      ]);

      expect(transcript.entries, hasLength(1));
      expect(transcript.entries.single.kind, 'assistant');
      expect(transcript.entries.single.text, 'Hello, world');
    });

    test('keeps two concurrent messages apart when they are interleaved', () {
      // The reason the id exists: two replies streaming at once must not merge into one bubble.
      final transcript = folded([
        at(1, {'kind': 'run.output', 'text': 'first ', 'messageId': 'a'}),
        at(2, {'kind': 'run.output', 'text': 'second ', 'messageId': 'b'}),
        at(3, {'kind': 'run.output', 'text': 'reply', 'messageId': 'a'}),
        at(4, {'kind': 'run.output', 'text': 'reply', 'messageId': 'b'}),
      ]);

      expect(transcript.entries.map((e) => e.text), ['first reply', 'second reply']);
    });

    test('falls back to joining when an agent sends no message id at all', () {
      final transcript = folded([
        at(1, {'kind': 'run.output', 'text': 'one '}),
        at(2, {'kind': 'run.output', 'text': 'two'}),
      ]);

      expect(transcript.entries, hasLength(1));
      expect(transcript.entries.single.text, 'one two');
    });

    test('starts a new anonymous row when another kind of row interrupts', () {
      // Two sequential answers from an agent that never sends an id are two answers, not one long
      // one — the tool call between them is what says so.
      final transcript = folded([
        at(1, {'kind': 'run.output', 'text': 'first answer'}),
        at(2, {'kind': 'run.tool', 'callId': 'c1', 'name': 'shell', 'status': 'running'}),
        at(3, {'kind': 'run.output', 'text': 'second answer'}),
      ]);

      final answers = transcript.entries.where((e) => e.kind == 'assistant').map((e) => e.text);
      expect(answers, ['first answer', 'second answer']);
    });

    test('keeps reasoning out of the answer', () {
      final transcript = folded([
        at(1, {'kind': 'run.thought', 'text': 'maybe the parser', 'messageId': 'm1'}),
        at(2, {'kind': 'run.output', 'text': 'the answer', 'messageId': 'm1'}),
      ]);

      // Same message id, different rows: joining on the id alone would splice the thinking into the
      // reply.
      expect(transcript.entries.map((e) => e.kind), ['thought', 'assistant']);
    });

    test('says nothing about the furniture', () {
      final transcript = folded([
        at(1, {'kind': 'run.started', 'harness': 'deepseek-harness', 'hostId': 'local'}),
        at(2, {'kind': 'run.session', 'sessionId': 's1', 'resumable': true, 'resumed': false}),
      ]);

      expect(transcript.entries, isEmpty);
    });

    test('renders a user message as their own words', () {
      final transcript = folded([
        at(1, {'kind': 'run.message', 'text': 'and then?', 'mode': 'queue', 'delivered': 'queued'}),
      ]);

      expect(transcript.entries.single.kind, 'user');
      expect(transcript.entries.single.text, 'and then?');
      expect(transcript.entries.single.delivered, 'queued');
    });
  });

  group('tool calls', () {
    test('is one row from two events, keyed by the agent call id', () {
      final transcript = folded([
        at(1, {'kind': 'run.tool', 'callId': 'c1', 'name': 'shell', 'status': 'running'}),
        at(2, {'kind': 'run.tool', 'callId': 'c1', 'name': '', 'status': 'completed'}),
      ]);

      expect(transcript.entries, hasLength(1));
      expect(transcript.entries.single.text, 'shell');
      expect(transcript.entries.single.status, 'completed');
    });

    test('does not erase the name when the result event carries none', () {
      // A real `tool_call_update` has no title, so overwriting with '' loses the label exactly when
      // the row finishes.
      final transcript = folded([
        at(1, {'kind': 'run.tool', 'callId': 'c1', 'name': 'read-file', 'status': 'running'}),
        at(2, {'kind': 'run.tool', 'callId': 'c1', 'name': '', 'status': 'completed'}),
      ]);

      expect(transcript.entries.single.text, 'read-file');
    });

    test('keeps a call that never finished visible as running', () {
      final transcript = folded([
        at(1, {'kind': 'run.tool', 'callId': 'c1', 'name': 'shell', 'status': 'running'}),
      ]);

      expect(transcript.entries.single.status, 'running');
    });
  });

  group('approvals', () {
    final requested = at(1, {
      'kind': 'run.approval-requested',
      'requestId': 'req-1',
      'question': 'Allow the agent to run “shell”?',
      'detail': 'It has stopped before this step.',
      'options': [
        {'id': 'allow-once', 'label': 'Allow once'},
        {'id': 'reject-once', 'label': 'Reject', 'destructive': true},
      ],
    });

    test('is open until it is answered, and carries the agent’s own options', () {
      final transcript = folded([requested]);

      final pending = transcript.pendingApproval;
      expect(pending, isNotNull);
      expect(pending!.requestId, 'req-1');
      expect(pending.question, 'Allow the agent to run “shell”?');
      expect(pending.options.map((o) => o.label), ['Allow once', 'Reject']);
      // Which option refuses is the protocol's own flag, never a guess from the label.
      expect(pending.options.last.destructive, isTrue);
    });

    test('stops being a question once it is answered, in place', () {
      final transcript = folded([
        requested,
        at(2, {
          'kind': 'run.approval-resolved',
          'requestId': 'req-1',
          'optionId': 'allow-once',
          'by': 'you',
        }),
      ]);

      expect(transcript.pendingApproval, isNull);
      // One row, still where it was: an approval that moved or duplicated would take the reader's
      // place in a long transcript with it.
      expect(transcript.entries, hasLength(1));
      expect(transcript.entries.single.approval!.resolvedWith, 'allow-once');
    });

    test('closes an open question when the run ends without an answer', () {
      final transcript = folded([
        requested,
        at(2, {'kind': 'run.ended', 'exitCode': null, 'status': 'cancelled'}),
      ]);

      expect(transcript.pendingApproval, isNull);
      // Two rows: the question, and the line saying the run stopped. The question is the first.
      expect(transcript.entries.map((e) => e.kind), ['approval', 'note']);
      // Closed, and *not* answered: "Stopped" and "you allowed it" are different sentences, and a
      // card that confused them would claim a decision nobody made.
      expect(transcript.entries.first.approval!.resolvedWith, isNull);
      expect(transcript.entries.first.approval!.closed, isTrue);
    });

    test('closes the question when the run stops waiting on a human', () {
      final transcript = folded([
        requested,
        at(2, {'kind': 'run.status', 'status': 'running'}),
      ]);

      expect(transcript.pendingApproval, isNull);
    });
  });

  group('what arrives twice, and what never arrives', () {
    test('drops a repeated event, so a reconnect cannot duplicate the tail', () {
      final transcript = Transcript();
      final event = at(3, {'kind': 'run.output', 'text': 'once', 'messageId': 'm1'});
      transcript.apply(event);
      transcript.apply(event);

      // `tailRun` answers from `sinceSeq` and the live subscription can hand over the same event, so
      // folding twice would render the same sentence twice — the bug that makes a reconnect look like
      // the agent repeating itself.
      expect(transcript.entries, hasLength(1));
      expect(transcript.entries.single.text, 'once');
    });

    test('reports a gap rather than skipping it in silence', () {
      final transcript = folded([
        at(1, {'kind': 'run.output', 'text': 'one', 'messageId': 'm1'}),
        at(5, {'kind': 'run.output', 'text': 'five', 'messageId': 'm2'}),
      ]);

      expect(transcript.hasGap, isTrue);
      expect(transcript.lastSeq, 5);
    });

    test('does not call a mid-run attach a gap', () {
      // A phone that opens onto work already in flight starts at whatever number the daemon is on.
      final transcript = folded([
        at(7, {'kind': 'run.output', 'text': 'mid-run', 'messageId': 'm1'}),
      ]);

      expect(transcript.hasGap, isFalse);
    });

    test('ignores an event kind this build does not know', () {
      final transcript = folded([
        at(1, {'kind': 'run.something-new', 'payload': {'a': 1}}),
      ]);

      // A newer daemon must not make an older app render a blank row or crash.
      expect(transcript.entries, isEmpty);
    });
  });
}
