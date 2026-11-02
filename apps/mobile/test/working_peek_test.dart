import 'package:envoydev_mobile/models/transcript.dart';
import 'package:envoydev_mobile/models/transcript_steps.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('workingPeekText returns empty when there is no stream', () {
    expect(workingPeekText(const []), '');
  });

  test('workingPeekText keeps short streams intact', () {
    expect(
      workingPeekText([
        TranscriptEntry(kind: 'thought', id: 't1', text: 'short plan'),
      ]),
      'short plan',
    );
  });

  test('workingPeekText truncates long streams from the end', () {
    final long = 'x' * 400;
    final peek = workingPeekText([
      TranscriptEntry(kind: 'thought', id: 't1', text: long),
    ], maxChars: 50);
    expect(peek.startsWith('…'), isTrue);
    expect(peek.length, lessThanOrEqualTo(52));
  });

  test('latestSummaryLine uses the most recent usable line', () {
    expect(
      latestSummaryLine('Earlier.\n\n## Wiring presets\n\nMore detail.'),
      'More detail.',
    );
    expect(latestSummaryLine('## Wiring presets'), 'Wiring presets');
  });

  test('workingPeekParts drops a tail that only repeats the summary', () {
    final parts = workingPeekParts('thinking about the parser');
    expect(parts.summary, 'thinking about the parser');
    expect(parts.tail, '');
  });
}
