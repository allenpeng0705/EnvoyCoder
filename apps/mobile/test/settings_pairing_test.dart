/// Settings says which desktop this phone is paired with, and when it last reached it.
///
/// The screen reads that from the client it was opened for, so this is also the test that the pairing
/// a dial recorded is the pairing the user is shown — not a second copy kept somewhere else.
library;

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/settings_screen.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/pairing_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/l10n.dart';

class _StubClient extends HostClient {
  _StubClient(super.host, {this.pairing, this.refused = false, this.failing = false});

  final PairingRecord? pairing;
  final bool refused;
  final bool failing;

  @override
  Future<PairingState> pairingState() async {
    if (failing) throw Exception('keychain unavailable');
    return (record: pairing, daemonKey: daemonKey, refused: refused);
  }

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
      case 'coder.listHarnesses':
        return {'harnesses': <Map<String, dynamic>>[]};
      case 'coder.getSettings':
        return {
          'settings': <String, dynamic>{},
        };
      case 'coder.getEnvoyLlm':
        return <String, dynamic>{};
      default:
        return <String, dynamic>{};
    }
  }
}

CoderHost hostWithLabel(String label) => CoderHost(
      id: 'owner-a::10.0.0.4:4770',
      label: label,
      endpoint: '10.0.0.4:4770',
      ownerId: 'owner-a',
      app: 'EnvoyDev',
      token: 'tok',
    );

/// Pump the screen for [client] and settle.
///
/// `dispose` is deliberately **not** left to `addTearDown`: the client owns the family client's
/// heartbeat timer, and a `testWidgets` body fails for leaving a pending timer before teardown runs.
/// Each test disposes inside its own body.
Future<void> _pumpSettings(WidgetTester tester, _StubClient client, {Key? key}) async {
  await pumpLocalized(
    tester,
    SettingsScreen(key: key, client: client, harnesses: const []),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('names the paired desktop with the connection\'s own label', (tester) async {
    final client = _StubClient(
      hostWithLabel('Studio'),
      // A minute-scale timestamp keeps this deterministic: the screen buckets time, so a record made
      // now is "just now" whenever the suite runs.
      pairing: PairingRecord(
        token: 'grant-1',
        instanceId: 'process-7',
        lastSeenAt: DateTime.now().subtract(const Duration(seconds: 5)),
      ),
    );
    await _pumpSettings(tester, client);

    expect(find.text('This phone is paired with Studio.'), findsOneWidget);
    expect(find.text('Last connected just now'), findsOneWidget);
    // The record's own id is provenance, never something the user reads here.
    expect(find.textContaining('process-7'), findsNothing);
    // And the token itself is a credential: it must not be on the screen.
    expect(find.textContaining('grant-1'), findsNothing);
    await client.dispose();
  });

  testWidgets('a paired desktop this phone has not reached says so', (tester) async {
    final client = _StubClient(
      hostWithLabel('Studio'),
      pairing: const PairingRecord(token: 'grant-1'),
    );
    await _pumpSettings(tester, client);

    expect(find.text('This phone is paired with Studio.'), findsOneWidget);
    // The protocol has no client-facing last-seen field, so the phone says what it knows and no more.
    expect(find.text('Not connected on this phone yet.'), findsOneWidget);
    await client.dispose();
  });

  testWidgets('no pairing at all and a refused pairing are different sentences', (tester) async {
    // Two separate widget trees rather than two pumps of one: `_SettingsScreenState` caches the
    // pairing future at `initState`, and re-pumping the same type reuses that State — so a second
    // pump would assert against the first client's read. (Found by this test failing exactly that
    // way when it was written.)
    final none = _StubClient(hostWithLabel('Studio'));
    await _pumpSettings(tester, none, key: const ValueKey('no-pairing'));
    expect(find.text('Not connected on this phone yet.'), findsOneWidget);
    await none.dispose();

    final refused = _StubClient(hostWithLabel('Studio'), refused: true);
    await _pumpSettings(tester, refused, key: const ValueKey('refused'));
    expect(
      find.text(
        'This phone holds no pairing for that computer. Scan the code on the computer to pair again.',
      ),
      findsOneWidget,
    );
    await refused.dispose();
  });

  testWidgets('a store that cannot be read says so rather than claiming there is none', (tester) async {
    final client = _StubClient(hostWithLabel('Studio'), failing: true);
    await _pumpSettings(tester, client);
    expect(find.text('This phone could not read its stored pairing.'), findsOneWidget);
    await client.dispose();
  });

  testWidgets('the paired line is in the phone\'s language, not English', (tester) async {
    final client = _StubClient(
      hostWithLabel('Studio'),
      pairing: PairingRecord(
        token: 'grant-1',
        lastSeenAt: DateTime.now().subtract(const Duration(seconds: 5)),
      ),
    );
    await pumpLocalized(
      tester,
      SettingsScreen(client: client, harnesses: const []),
      locale: const Locale('de'),
    );

    expect(find.text('Dieses Telefon ist mit Studio gekoppelt.'), findsOneWidget);
    expect(find.text('Gerade eben verbunden'), findsOneWidget);
    await client.dispose();
  });
}
