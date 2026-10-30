import 'package:envoydev_mobile/l10n/l10n.dart';
import 'package:envoydev_mobile/models/tool_buckets.dart';
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

  test('keeps the streaming answer outside Steps so the reader does not hunt for it', () {
    final entries = [
      TranscriptEntry(kind: 'user', id: 'u1', text: 'hi'),
      TranscriptEntry(kind: 'assistant', id: 'a1', text: 'working on it'),
    ];
    final settled = segmentTranscriptSteps(entries);
    expect(settled.map((i) => i.runtimeType).toList(), [
      TranscriptEntryItem,
      TranscriptEntryItem,
    ]);

    // Match desktop: chat-only reply stays a hero while it streams.
    final live = segmentTranscriptSteps(entries, runLive: true);
    expect(live.map((i) => i.runtimeType).toList(), [
      TranscriptEntryItem,
      TranscriptEntryItem,
    ]);
  });

  test('marks thought-only Steps live while the run is open', () {
    final entries = [
      TranscriptEntry(kind: 'user', id: 'u1', text: 'hi'),
      TranscriptEntry(kind: 'thought', id: 'th1', text: 'planning…'),
    ];
    final idle = segmentTranscriptSteps(entries);
    expect((idle[1] as TranscriptStepsItem).segment.live, isFalse);

    final live = segmentTranscriptSteps(entries, runLive: true);
    expect((live[1] as TranscriptStepsItem).segment.live, isTrue);
  });

  test('does not mark prior-turn Steps live when a later turn is running', () {
    final entries = [
      TranscriptEntry(kind: 'user', id: 'u1', text: 'first'),
      TranscriptEntry(kind: 'tool', id: 't1', text: 'Read', status: 'completed'),
      TranscriptEntry(kind: 'assistant', id: 'a1', text: 'done'),
      TranscriptEntry(kind: 'user', id: 'u2', text: 'second'),
      TranscriptEntry(kind: 'thought', id: 'th2', text: 'next…'),
    ];
    final items = segmentTranscriptSteps(entries, runLive: true);
    expect((items[1] as TranscriptStepsItem).segment.live, isFalse);
    expect((items[4] as TranscriptStepsItem).segment.live, isTrue);
  });

  test('stepsLiveStreamText joins thought and interim assistant', () {
    expect(
      stepsLiveStreamText([
        TranscriptEntry(kind: 'thought', id: 'th1', text: 'planning'),
        TranscriptEntry(kind: 'tool', id: 't1', text: 'Read', status: 'running'),
        TranscriptEntry(kind: 'assistant', id: 'a1', text: 'looking'),
      ]),
      'planning\n\nlooking',
    );
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
          counts: const ToolCounts(ran: 1),
          thoughtCount: 1,
          entries: [
            TranscriptEntry(kind: 'thought', id: 'th1', text: 'hmm'),
            TranscriptEntry(kind: 'tool', id: 't1', text: 'Bash', status: 'completed'),
          ],
        ),
      ),
    );
    final en = lookupAppLocalizations(const Locale('en'));
    expect(find.text(en.runToolsRanOne), findsOneWidget);

    await tester.tap(find.text(en.runToolsRanOne));
    await tester.pumpAndSettle();
    // Nested Thought disclosure — title only until expanded.
    expect(find.text(en.runThoughtTitle), findsOneWidget);
    expect(find.text('hmm'), findsNothing);
    expect(find.text('Bash'), findsOneWidget);
    await tester.tap(find.text(en.runThoughtTitle));
    await tester.pumpAndSettle();
    expect(find.text('hmm'), findsOneWidget);
  });

  testWidgets('live Steps stays collapsed; expand shows Working stream', (tester) async {
    final en = lookupAppLocalizations(const Locale('en'));
    var live = true;
    final liveEntries = [
      TranscriptEntry(kind: 'thought', id: 'th1', text: 'planning the fix'),
      TranscriptEntry(kind: 'tool', id: 't1', text: 'Read', status: 'running'),
    ];
    final settledEntries = [
      TranscriptEntry(kind: 'thought', id: 'th1', text: 'planning the fix'),
      TranscriptEntry(kind: 'tool', id: 't1', text: 'Read', status: 'completed'),
    ];

    late StateSetter setOuter;
    await pumpLocalized(
      tester,
      Scaffold(
        body: StatefulBuilder(
          builder: (context, setState) {
            setOuter = setState;
            return TranscriptStepsBlock(
              storageId: 'steps-live',
              live: live,
              colors: CoderColors.light,
              counts: const ToolCounts(searched: 1),
              thoughtCount: 1,
              entries: live ? liveEntries : settledEntries,
            );
          },
        ),
      ),
    );
    await tester.pump();
    expect(find.text(en.runStepsWorking), findsOneWidget);
    // Collapsed by default — chat history stays the focus.
    expect(find.text('planning the fix'), findsNothing);
    expect(find.text('Read'), findsNothing);

    await tester.tap(find.text(en.runStepsWorking));
    await tester.pumpAndSettle();
    expect(find.text('planning the fix'), findsOneWidget);
    expect(find.text('Read'), findsOneWidget);

    setOuter(() => live = false);
    await tester.pump();
    await tester.pump(); // remount closed on settle
    expect(find.text(en.runToolsSearchedOne), findsOneWidget);
    expect(find.text('planning the fix'), findsNothing);
  });

  test('folds a tools group into Steps like a single tool', () {
    final entries = [
      TranscriptEntry(kind: 'user', id: 'u1', text: 'hi'),
      TranscriptEntry(
        kind: 'tools',
        id: 'tools-t1',
        tools: [
          TranscriptEntry(kind: 'tool', id: 't1', text: 'Read', status: 'completed'),
          TranscriptEntry(kind: 'tool', id: 't2', text: 'Edit', status: 'completed'),
        ],
      ),
      TranscriptEntry(kind: 'assistant', id: 'a1', text: 'done'),
    ];
    final items = segmentTranscriptSteps(entries);
    expect(items.map((i) => i.runtimeType).toList(), [
      TranscriptEntryItem,
      TranscriptStepsItem,
      TranscriptEntryItem,
    ]);
    final steps = (items[1] as TranscriptStepsItem).segment;
    expect(steps.toolCount, 2);
    expect(steps.counts.searched, 1);
    expect(steps.counts.edited, 1);
  });
}
