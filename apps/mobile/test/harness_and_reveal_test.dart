import 'package:envoydev_mobile/models/harness.dart';
import 'package:envoydev_mobile/models/text_reveal.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('HarnessInfo', () {
    test('parses listed models and modes from listHarnesses JSON', () {
      final harness = HarnessInfo.fromJson({
        'id': 'envoy-harness',
        'label': 'Envoy Harness',
        'modes': [
          {'id': 'default', 'label': 'Default'},
        ],
        'models': {
          'kind': 'listed',
          'options': [
            {'id': 'anthropic/claude', 'label': 'Claude'},
          ],
        },
        'thinking': {'kind': 'none', 'options': []},
        'capabilities': {
          'agentMode': true,
          'model': true,
          'thinking': false,
        },
        'availability': {'state': 'ready'},
      });
      expect(harness.ready, isTrue);
      expect(harness.modes.single.id, 'default');
      expect(harness.modelsKind, 'listed');
      expect(harness.modelOptions.single.id, 'anthropic/claude');
      expect(harness.agentModeApplicable, isTrue);
    });
  });

  group('text reveal', () {
    test('first paint is complete; growth is paced', () {
      final started = beginTextReveal('hi');
      expect(visibleRevealedText(started), 'hi');
      final grown = retargetTextReveal(started, 'hi there');
      expect(visibleRevealedText(grown), 'hi');
      final advanced = advanceTextReveal(grown, 150);
      expect(visibleRevealedText(advanced), 'hi there');
    });
  });
}
