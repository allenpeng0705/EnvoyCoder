import 'package:envoydev_mobile/models/plan_gate.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('looksLikeBigTask', () {
    test('ignores ordinary short asks', () {
      expect(looksLikeBigTask('Fix the typo in README', 0), isFalse);
      expect(looksLikeBigTask('Add a unit test for parseDate', 0), isFalse);
    });

    test('does not fire on bare architecture questions', () {
      expect(looksLikeBigTask("What's the architecture of this module?", 0), isFalse);
      expect(looksLikeBigTask('Is this end-to-end tested?', 0), isFalse);
    });

    test('fires on strong whole-system wording', () {
      expect(looksLikeBigTask('Refactor the entire architecture of this codebase', 0), isTrue);
      expect(looksLikeBigTask('Investigate this repo end to end', 0), isTrue);
    });

    test('fires on length and attachments conservatively', () {
      expect(looksLikeBigTask('x' * 400, 0), isFalse);
      expect(looksLikeBigTask('x' * 800, 0), isTrue);
      expect(looksLikeBigTask('short', 3), isTrue);
    });
  });

  group('shouldAutoPlanFirst', () {
    test('only when idle, capable, not planning', () {
      const prompt = 'Refactor the entire architecture of this codebase';
      expect(
        shouldAutoPlanFirst(
          prompt: prompt,
          attachmentCount: 0,
          planMode: false,
          planCapable: true,
          running: false,
        ),
        isTrue,
      );
      expect(
        shouldAutoPlanFirst(
          prompt: prompt,
          attachmentCount: 0,
          planMode: false,
          planCapable: true,
          running: true,
        ),
        isFalse,
      );
      expect(
        shouldAutoPlanFirst(
          prompt: 'fix a typo',
          attachmentCount: 0,
          planMode: false,
          planCapable: true,
          running: false,
        ),
        isFalse,
      );
    });
  });

  group('stripPlanFirstFraming', () {
    test('round-trips framing', () {
      final framed = withPlanFirstFraming('Do the big thing');
      expect(stripPlanFirstFraming(framed), 'Do the big thing');
    });
  });

  group('isPlanReviewAsk', () {
    test('detects plan approval prompts', () {
      expect(isPlanReviewAsk('Approve this plan and leave plan mode?'), isTrue);
      expect(isPlanReviewAsk('Which file?', 'a or b'), isFalse);
    });
  });
}
