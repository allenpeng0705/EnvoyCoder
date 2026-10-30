import 'package:envoydev_mobile/models/asking_control.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('policy wire is Envoy Harness only', () {
    expect(askingControl('envoy-harness'), AskingControl.policy);
    expect(agentCanControlAsking('envoy-harness'), isTrue);
    expect(modeForAskingOff('envoy-harness'), isNull);
  });

  test('unattended-mode agents map Settings Off to a mode', () {
    expect(askingControl('claudecode'), AskingControl.unattendedMode);
    expect(modeForAskingOff('claudecode'), 'bypassPermissions');
    expect(modeLabelForAskingOff('claudecode'), 'Bypass permissions');
    expect(modeForAskingOff('codex'), 'agent-full-access');
    expect(modeForAskingOff('deepseek-harness'), 'danger-full-access');
  });

  test('Copilot/OMP catalogue modes are not Settings Off delivery', () {
    expect(unattendedModeId('copilot'), 'allow-all');
    expect(unattendedModeId('omp'), 'full');
    expect(askingControl('copilot'), AskingControl.none);
    expect(askingControl('omp'), AskingControl.none);
    expect(modeForAskingOff('copilot'), isNull);
    expect(agentCanControlAsking('copilot'), isFalse);
  });

  test('custom providers have no wire', () {
    expect(askingControl('my-custom-agent'), AskingControl.none);
    expect(agentCanControlAsking('my-custom-agent'), isFalse);
    expect(isShippedAskingAgent('my-custom-agent'), isFalse);
  });
}
