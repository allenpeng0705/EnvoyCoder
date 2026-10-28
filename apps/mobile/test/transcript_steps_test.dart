import 'package:envoydev_mobile/l10n/l10n.dart';
import 'package:envoydev_mobile/models/transcript.dart';
import 'package:envoydev_mobile/models/transcript_steps.dart';
import 'package:envoydev_mobile/theme/tokens.dart';
import 'package:envoydev_mobile/widgets/transcript_row.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/l10n.dart';

void main() {
  test('segments thoughts and tools; leaves final assistant outside', () {
    final entries = [
      TranscriptEntry(kind: 'user', id: 'u1', text: 'hi'),
      TranscriptEntry(kind: 'thought', id: 'th1', text: 'thinking'),
      TranscriptEntry(kind: 'tool', id: 't1', text: 'Read', status: 'completed'),
      TranscriptEntry(kind: 'assistant', id: 'a1', text: 'done'),
    ];
    final items = segmentTranscriptSteps(entries);
    expect(items.map((i) => i.runtimeType).toList(), [
      TranscriptEntryItem,
      TranscriptStepsItem,
      TranscriptEntryItem,
    ]);
    final steps = items[1] as TranscriptStepsItem;
    expect(steps.segment.live, isFalse);
    expect(steps.segment.entries, hasLength(2));
  });

  test('folds interim assistant into Steps before the final answer', () {
    final entries = [
      TranscriptEntry(kind: 'user', id: 'u1', text: 'hi'),
      TranscriptEntry(kind: 'tool', id: 't1', text: 'Read', status: 'completed'),
      TranscriptEntry(kind: 'assistant', id: 'a-interim', text: 'looking'),
      TranscriptEntry(kind: 'tool', id: 't2', text: 'Edit', status: 'completed'),
      TranscriptEntry(kind: 'assistant', id: 'a-final', text: 'fixed'),
    ];
    final items = segmentTranscriptSteps(entries);
    expect(items.map((i) => i.runtimeType).toList(), [
      TranscriptEntryItem,
      TranscriptStepsItem,
      TranscriptEntryItem,
    ]);
    final steps = (items[1] as TranscriptStepsItem).segment;
    expect(steps.entries.map((e) => e.id).toList(), ['t1', 'a-interim', 't2']);
    expect((items[2] as TranscriptEntryItem).entry.id, 'a-final');
  });

  test('keeps mid-turn narration in Steps when tools still follow', () {
    final entries = [
      TranscriptEntry(kind: 'user', id: 'u1', text: 'hi'),
      TranscriptEntry(kind: 'assistant', id: 'a-early', text: 'looking'),
      TranscriptEntry(kind: 'tool', id: 't1', text: 'Read', status: 'running'),
    ];
    final items = segmentTranscriptSteps(entries);
    expect(items.map((i) => i.runtimeType).toList(), [
      TranscriptEntryItem,
      TranscriptStepsItem,
    ]);
    final steps = (items[1] as TranscriptStepsItem).segment;
    expect(steps.entries.map((e) => e.id).toList(), ['a-early', 't1']);
    expect(steps.live, isTrue);
  });

  test('marks live while a tool is running', () {
    final items = segmentTranscriptSteps([
      TranscriptEntry(kind: 'tool', id: 't1', text: 'Bash', status: 'running'),
    ]);
    expect((items.single as TranscriptStepsItem).segment.live, isTrue);
  });

  test('folds quiet notes into Steps; warn notes stay outside', () {
    final entries = [
      TranscriptEntry(kind: 'tool', id: 't1', text: 'Read', status: 'completed'),
      TranscriptEntry(kind: 'note', id: 'n-quiet', text: 'queued', tone: 'quiet'),
      TranscriptEntry(kind: 'tool', id: 't2', text: 'Edit', status: 'completed'),
      TranscriptEntry(kind: 'note', id: 'n-warn', text: 'denied', tone: 'warn'),
      TranscriptEntry(kind: 'tool', id: 't3', text: 'Read', status: 'completed'),
    ];
    final kinds = segmentTranscriptSteps(entries).map((i) => i.runtimeType).toList();
    expect(kinds, [TranscriptStepsItem, TranscriptEntryItem, TranscriptStepsItem]);
    final first = (segmentTranscriptSteps(entries)[0] as TranscriptStepsItem).segment;
    expect(first.entries.map((e) => e.id).toList(), ['t1', 'n-quiet', 't2']);
  });

  test('holds chat-only streaming answer in open Steps while the run is live', () {
    final entries = [
      TranscriptEntry(kind: 'user', id: 'u1', text: 'hi'),
      TranscriptEntry(kind: 'assistant', id: 'a1', text: 'working on it'),
    ];
    final settled = segmentTranscriptSteps(entries);
    expect(settled.map((i) => i.runtimeType).toList(), [
      TranscriptEntryItem,
      TranscriptEntryItem,
    ]);

    final live = segmentTranscriptSteps(entries, runLive: true);
    expect(live.map((i) => i.runtimeType).toList(), [
      TranscriptEntryItem,
      TranscriptStepsItem,
    ]);
    final steps = (live[1] as TranscriptStepsItem).segment;
    expect(steps.live, isTrue);
    expect(steps.entries.map((e) => e.id).toList(), ['a1']);
  });

  testWidgets('tool card hides I/O until Details is expanded', (tester) async {
    await pumpLocalized(
      tester,
      Scaffold(
        body: TranscriptRow(
          entry: TranscriptEntry(
            kind: 'tool',
            id: 't1',
            text: 'Read',
            status: 'completed',
            toolInput: '{"path":"a.ts"}',
            toolOutput: 'file contents here',
          ),
          colors: CoderColors.light,
        ),
      ),
    );

    final en = lookupAppLocalizations(const Locale('en'));
    expect(find.text('Read'), findsOneWidget);
    expect(find.text(en.runToolDetails), findsOneWidget);
    expect(find.text('file contents here'), findsNothing);

    await tester.tap(find.text(en.runToolDetails));
    await tester.pumpAndSettle();
    expect(find.text('file contents here'), findsOneWidget);
  });

  testWidgets('Steps block wraps thought and tool', (tester) async {
    await pumpLocalized(
      tester,
      Scaffold(
        body: TranscriptStepsBlock(
          storageId: 'steps-test',
          live: false,
          colors: CoderColors.light,
          entries: [
            TranscriptEntry(kind: 'thought', id: 'th1', text: 'hmm'),
            TranscriptEntry(kind: 'tool', id: 't1', text: 'Bash', status: 'completed'),
          ],
        ),
      ),
    );
    final en = lookupAppLocalizations(const Locale('en'));
    expect(find.text(en.runStepsSummary), findsOneWidget);

    await tester.tap(find.text(en.runStepsSummary));
    await tester.pumpAndSettle();
    // Flat thought — body visible without a nested expand control.
    expect(find.text(en.runThoughtTitle), findsOneWidget);
    expect(find.text('hmm'), findsOneWidget);
    expect(find.text('Bash'), findsOneWidget);
  });
}
