/// The re-pairing step, offered where the refusal is read.
///
/// A refused pairing leaves a host unreachable, and unreachable is a dead end for the person reading
/// it: the state is recoverable by exactly one action, so the sheet that already reports the failure
/// has to name it. This file pins both halves — that the notice appears **only** for the host whose
/// pairing was refused, and that its button runs the ordinary pairing flow rather than anything that
/// mints a credential on its own.
library;

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/connections_sheet.dart';
import 'package:envoydev_mobile/services/connections_controller.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/host_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/memory_secure_storage.dart';

CoderHost _host(String id, String label) => CoderHost(
      id: id,
      label: label,
      endpoint: '$label:4770',
      ownerId: 'owner',
      app: 'EnvoyDev',
      token: 'tok-$label',
    );

/// Never dialled, and able to say its pairing was refused — the one fact the notice keys off.
class _RefusingClient extends HostClient {
  _RefusingClient(super.host, this.refused);

  final bool refused;

  @override
  bool get pairingRefused => refused;

  @override
  Future<void> connectBest() async {}
}

/// Take the sheet down first, then the controller: a live sheet still listens to the clients'
/// broadcast streams, and disposing the controller underneath it would wait forever (the same rule
/// `connections_sheet_test.dart` records).
Future<void> _finish(WidgetTester tester, ConnectionsController controller) async {
  await tester.pumpWidget(const SizedBox());
  controller.dispose();
}

Future<ConnectionsController> _controllerWith(
  List<CoderHost> hosts, {
  required Set<String> refused,
}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final store = HostStore(prefs: prefs, secure: MemorySecureStorage());
  for (final host in hosts) {
    await store.upsert(host);
  }
  final controller = ConnectionsController(store)
    ..clientFactory = (host) => _RefusingClient(host, refused.contains(host.id));
  await controller.load();
  return controller;
}

Future<void> _pumpSheet(WidgetTester tester, ConnectionsController controller) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => showConnectionsSheet(context, controller),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a refused pairing is named, with the step that fixes it', (tester) async {
    final controller = await _controllerWith(
      [_host('a', 'alpha')],
      refused: {'a'},
    );
    await _pumpSheet(tester, controller);

    // The headline says what the daemon did — refused, which is what the phone observed — and no more:
    // it cannot see *why* a token stopped working.
    expect(find.text("This computer refused this phone's pairing"), findsOneWidget);
    expect(find.textContaining('Pair again with alpha.'), findsOneWidget);
    expect(find.text('Pair again'), findsOneWidget);
    await _finish(tester, controller);
  });

  testWidgets('a healthy pairing is not nagged about', (tester) async {
    final controller = await _controllerWith(
      [_host('a', 'alpha')],
      refused: <String>{},
    );
    await _pumpSheet(tester, controller);

    expect(find.text("This computer refused this phone's pairing"), findsNothing);
    expect(find.text('Pair again'), findsNothing);
    await _finish(tester, controller);
  });

  testWidgets('the notice follows the host whose pairing was refused', (tester) async {
    // Two hosts, only the non-active one refused: the notice is about the machine the app is on, so
    // it must not appear for another machine's refusal — and it must appear once that machine is the
    // active one. The sheet is opened twice because tapping a row *closes* it (switching host is
    // meant to return the user to the work), which is what the app does too.
    final controller = await _controllerWith(
      [_host('a', 'alpha'), _host('b', 'beta')],
      refused: {'b'},
    );
    await _pumpSheet(tester, controller);
    expect(controller.activeHost?.id, 'a');
    expect(find.text("This computer refused this phone's pairing"), findsNothing);

    await tester.tap(find.text('beta'));
    await tester.pumpAndSettle();
    expect(controller.activeHost?.id, 'b');

    await _pumpSheet(tester, controller);
    expect(find.text("This computer refused this phone's pairing"), findsOneWidget);
    expect(find.textContaining('Pair again with beta.'), findsOneWidget);
    await _finish(tester, controller);
  });

  testWidgets('the button opens the ordinary pairing flow, which mints nothing by itself', (tester) async {
    final controller = await _controllerWith(
      [_host('a', 'alpha')],
      refused: {'a'},
    );
    await _pumpSheet(tester, controller);

    await tester.tap(find.text('Pair again'));
    await tester.pumpAndSettle();

    // `addHostFlow`'s sheet, not a fresh credential: the person still has to bring a code. Scan QR
    // and Paste link are the two routes it offers, and neither exists until the user acts. (The sheet
    // itself is private to `add_host_sheet.dart`, so its own routes are what proves it opened.)
    expect(find.text('Scan QR'), findsOneWidget);
    expect(find.text('Paste link'), findsOneWidget);

    await tester.tap(find.text('Direct TCP'));
    await tester.pumpAndSettle();
    expect(controller.hosts, hasLength(1));
    await _finish(tester, controller);
  });
}
