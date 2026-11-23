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

  test('Copilot catalogue modes are not Settings Off delivery', () {
    expect(unattendedModeId('copilot'), 'allow-all');
    expect(askingControl('copilot'), AskingControl.none);
    expect(modeForAskingOff('copilot'), isNull);
    expect(agentCanControlAsking('copilot'), isFalse);
  });

  test('OpenCode Asking Off is session-auto', () {
    expect(askingControl('opencode'), AskingControl.sessionAuto);
    expect(agentCanControlAsking('opencode'), isTrue);
    expect(modeForAskingOff('opencode'), isNull);
  });

  test('OMP Asking Off is launch-approval', () {
    expect(unattendedModeId('omp'), 'full');
    expect(askingControl('omp'), AskingControl.launchApproval);
    expect(agentCanControlAsking('omp'), isTrue);
    expect(modeForAskingOff('omp'), isNull);
    expect(modeLabelForAskingOff('omp'), 'Full access');
  });

  test('Pi Asking Off stays none', () {
    expect(askingControl('pi'), AskingControl.none);
    expect(agentCanControlAsking('pi'), isFalse);
  });

  test('Cursor Asking Off is launch-force', () {
    expect(askingControl('cursor'), AskingControl.launchForce);
    expect(agentCanControlAsking('cursor'), isTrue);
    expect(modeForAskingOff('cursor'), isNull);
    expect(
      canStopAskingApprovals(harnessId: 'cursor', requireApproval: true),
      isTrue,
    );
  });

  test('only Envoy / DeepSeek may steer live follow-ups', () {
    expect(canSteerFollowUp('envoy-harness'), isTrue);
    expect(canSteerFollowUp('deepseek-harness'), isTrue);
    expect(followUpMustQueue('cursor'), isTrue);
    expect(followUpMustQueue('claudecode'), isTrue);
    expect(followUpMustQueue(null), isTrue);
  });

  test('custom providers have no wire unless catalogue YOLO', () {
    expect(askingControl('my-custom-agent'), AskingControl.none);
    expect(agentCanControlAsking('my-custom-agent'), isFalse);
    expect(isShippedAskingAgent('my-custom-agent'), isFalse);
    expect(cataloguedUnattendedModeId('my-custom-agent'), isNull);
  });

  test('catalogue YOLO modes are Settings Off delivery', () {
    expect(cataloguedUnattendedModeId('gemini'), 'yolo');
    expect(cataloguedUnattendedModeId('qwen-code'), 'yolo');
    expect(cataloguedUnattendedModeLabel('gemini'), 'YOLO');
    expect(
      agentOrCatalogueCanControlAsking(harnessId: 'gemini'),
      isTrue,
    );
    expect(
      agentOrCatalogueCanControlAsking(
        harnessId: 'my-gemini',
        catalogEntryId: 'gemini',
      ),
      isTrue,
    );
  });

  test('canStopAskingApprovals matches desktop deliverable wires', () {
    expect(
      canStopAskingApprovals(harnessId: 'envoy-harness', requireApproval: true),
      isTrue,
    );
    expect(
      canStopAskingApprovals(harnessId: 'claudecode', requireApproval: true),
      isTrue,
    );
    expect(
      canStopAskingApprovals(
        harnessId: 'gemini-cli',
        requireApproval: true,
        catalogEntryId: 'gemini',
      ),
      isTrue,
    );
    expect(
      canStopAskingApprovals(harnessId: 'copilot', requireApproval: true),
      isFalse,
    );
    expect(
      canStopAskingApprovals(harnessId: 'envoy-harness', requireApproval: false),
      isFalse,
    );
  });

  test('stopAskingAllowId prefers allow-* over a generic proceed', () {
    expect(
      stopAskingAllowId([
        (id: 'proceed', destructive: false),
        (id: 'allow-once', destructive: false),
        (id: 'reject', destructive: true),
      ]),
      'allow-once',
    );
    expect(
      stopAskingAllowId([
        (id: 'proceed', destructive: false),
        (id: 'reject', destructive: true),
      ]),
      'proceed',
    );
  });
}
