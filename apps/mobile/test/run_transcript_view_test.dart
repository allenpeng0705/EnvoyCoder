import 'package:envoydev_mobile/models/run_transcript_view.dart';
import 'package:envoydev_mobile/models/transcript.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('isStreamingAssistant', () {
    test('uses the display list so tool grouping does not break streaming', () {
      final raw = [
        TranscriptEntry(kind: 'user', id: 'u1', text: 'hi'),
        TranscriptEntry(kind: 'tool', id: 't1', text: 'Read', status: 'completed'),
        TranscriptEntry(kind: 'tool', id: 't2', text: 'Edit', status: 'completed'),
        TranscriptEntry(kind: 'assistant', id: 'a1', text: 'done'),
      ];
      final display = groupConsecutiveTools(raw);
      // Raw last-assistant index is 3; after grouping the assistant is at 2.
      expect(display.map((e) => e.kind).toList(), ['user', 'tools', 'assistant']);
      final assistant = display[2];
      expect(
        isStreamingAssistant(
          runLive: true,
          displayEntries: display,
          entry: assistant,
          entryIndex: 2,
        ),
        isTrue,
      );
      // The bug: comparing entryIndex 2 to raw lastIndexWhere (== 3) would be false.
      expect(raw.lastIndexWhere((e) => e.kind == 'assistant'), 3);
    });

    test('is false when a later assistant exists', () {
      final display = [
        TranscriptEntry(kind: 'assistant', id: 'a1', text: 'first'),
        TranscriptEntry(kind: 'assistant', id: 'a2', text: 'second'),
      ];
      expect(
        isStreamingAssistant(
          runLive: true,
          displayEntries: display,
          entry: display[0],
          entryIndex: 0,
        ),
        isFalse,
      );
      expect(
        isStreamingAssistant(
          runLive: true,
          displayEntries: display,
          entry: display[1],
          entryIndex: 1,
        ),
        isTrue,
      );
    });
  });

  group('emptyTranscriptChrome', () {
    test('hero only when there is no run yet', () {
      expect(
        emptyTranscriptChrome(bootstrapLoading: false, transcriptEmpty: true, runId: ''),
        (showHero: true, showLoading: false),
      );
    });

    test('loading when a run exists but events have not arrived', () {
      expect(
        emptyTranscriptChrome(bootstrapLoading: false, transcriptEmpty: true, runId: 'r-1'),
        (showHero: false, showLoading: true),
      );
    });

    test('neither while bootstrap is loading or the transcript has rows', () {
      expect(
        emptyTranscriptChrome(bootstrapLoading: true, transcriptEmpty: true, runId: ''),
        (showHero: false, showLoading: false),
      );
      expect(
        emptyTranscriptChrome(bootstrapLoading: false, transcriptEmpty: false, runId: ''),
        (showHero: false, showLoading: false),
      );
    });
  });

  group('composerSendable', () {
    test('blocks send for any open approval, including without takeover', () {
      expect(
        composerSendable(approvalOpen: true, live: true, hasTask: true),
        isFalse,
      );
      expect(
        composerSendable(approvalOpen: false, live: true, hasTask: false),
        isTrue,
      );
      expect(
        composerSendable(approvalOpen: false, live: false, hasTask: true),
        isTrue,
      );
      expect(
        composerSendable(approvalOpen: false, live: false, hasTask: false),
        isFalse,
      );
    });
  });
}
