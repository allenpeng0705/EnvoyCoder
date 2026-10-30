/// Safety → Ask before risky steps: switch enabled only for a deliverable wire.
library;

import 'package:envoydev_mobile/models/harness.dart';
import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/settings_screen.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/pairing_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/l10n.dart';

class _StubClient extends HostClient {
  _StubClient(super.host, {required this.defaultHarness});

  final String defaultHarness;

  @override
  Future<PairingState> pairingState() async => (record: null, refused: false);

  @override
  HostConnectionState get state => HostConnectionState.connected;

  @override
  Stream<HostConnectionState> get states => const Stream<HostConnectionState>.empty();

  @override
  Stream<Map<String, dynamic>> get events => const Stream<Map<String, dynamic>>.empty();

  @override
  Future<void> connectBest() async {}

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic> params = const {},
    Duration timeout = const Duration(seconds: 15),
  ]) async {
    switch (method) {
      case 'coder.getSettings':
        return {
          'settings': {
            'requireApprovalForDestructive': true,
            'keepTranscripts': true,
            'language': 'en',
            'defaults': {'harness': defaultHarness},
          },
        };
      case 'coder.getEnvoyLlm':
        return {
          'provider': 'openai',
          'model': 'gpt-4.1',
          'baseUrl': '',
          'apiKeySet': false,
        };
      default:
        return <String, dynamic>{};
    }
  }
}

HarnessInfo harness({
  required String id,
  required String label,
  bool approvalPolicy = false,
  bool agentMode = false,
  List<AgentModeOption> modes = const [],
}) {
  return HarnessInfo(
    id: id,
    label: label,
    modes: modes,
    modelsKind: 'none',
    modelOptions: const [],
    thinkingKind: 'none',
    thinkingOptions: const [],
    agentModeApplicable: agentMode,
    modelApplicable: false,
    thinkingApplicable: false,
    approvalPolicy: approvalPolicy,
    approvals: true,
    approvalsKnown: true,
    ready: true,
  );
}

CoderHost get _host => const CoderHost(
      id: 'owner::10.0.0.4:4770',
      label: 'Studio',
      endpoint: '10.0.0.4:4770',
      ownerId: 'owner',
      app: 'EnvoyDev',
      token: 'tok',
    );

Future<_StubClient> pumpSettings(
  WidgetTester tester, {
  required String defaultHarness,
  required List<HarnessInfo> harnesses,
}) async {
  final client = _StubClient(_host, defaultHarness: defaultHarness);
  await pumpLocalized(
    tester,
    SettingsScreen(client: client, harnesses: harnesses),
  );
  await tester.pumpAndSettle();
  return client;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('enables the switch for Envoy Harness (policy wire)', (tester) async {
    final client = await pumpSettings(
      tester,
      defaultHarness: 'envoy-harness',
      harnesses: [
        harness(id: 'envoy-harness', label: 'Envoy Harness', approvalPolicy: true),
      ],
    );
    final tile = tester.widget<SwitchListTile>(find.byType(SwitchListTile).first);
    expect(tile.onChanged, isNotNull);
    expect(find.textContaining('Handed to Envoy Harness'), findsOneWidget);
    await client.dispose();
  });

  testWidgets('enables the switch for Claude (unattended mode)', (tester) async {
    final client = await pumpSettings(
      tester,
      defaultHarness: 'claudecode',
      harnesses: [
        harness(
          id: 'claudecode',
          label: 'Claude Code',
          agentMode: true,
          modes: const [
            AgentModeOption(id: 'bypassPermissions', label: 'Bypass permissions'),
          ],
        ),
      ],
    );
    final tile = tester.widget<SwitchListTile>(find.byType(SwitchListTile).first);
    expect(tile.onChanged, isNotNull);
    expect(find.textContaining('Bypass permissions'), findsOneWidget);
    await client.dispose();
  });

  testWidgets('disables the switch for Copilot even with an unattended mode listed', (tester) async {
    final client = await pumpSettings(
      tester,
      defaultHarness: 'copilot',
      harnesses: [
        harness(
          id: 'copilot',
          label: 'GitHub Copilot',
          modes: const [AgentModeOption(id: 'allow-all', label: 'Allow all')],
        ),
      ],
    );
    final tile = tester.widget<SwitchListTile>(find.byType(SwitchListTile).first);
    expect(tile.onChanged, isNull);
    expect(find.textContaining('cannot change this for GitHub Copilot'), findsOneWidget);
    await client.dispose();
  });
}
