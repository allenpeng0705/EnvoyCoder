// Naming a connection *while pairing*: the phone asks once, after the code is read, and the name it
// gets is the phone's own label — not a fact from the desktop.
//
// The default matters more than the field. EnvoyDev's pairing code carries no host or app name
// (`packages/host-bridge/src/index.ts:594-631`), so `pairing_service.dart` names the host by the
// address in the URL. The dialog is therefore prefilled with that address, and clearing the field is
// not an error: it means "keep the address", which keeps the common case at one tap. What this file
// pins is both halves of that promise — a name can be set here, and *not* setting one is not a
// refusal.

import 'dart:async';

import 'package:envoydev_mobile/services/host_pairing_flow.dart';
import 'package:envoydev_mobile/services/host_store.dart';
import 'package:envoydev_mobile/services/pairing_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/memory_secure_storage.dart';

/// A code this app accepts, minted with the shared field names (see `pairing_test.dart`).
String _code() => buildPairingCode(
      wsUrl: 'ws://192.168.1.20:4770/ws',
      token: 't0ken-secret',
      ownerId: 'envoy:owner:abc',
      lanWsUrl: 'ws://192.168.1.20:4770/ws',
    );

Future<HostStore> _emptyStore() async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  return HostStore(prefs: prefs, secure: MemorySecureStorage());
}

Future<void> _pumpFlow(WidgetTester tester, HostStore store) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => unawaited(addHostFlow(context, store)),
            child: const Text('pair'),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Drive the shared add-host sheet down the paste route with [code], leaving the naming dialog up.
Future<void> _pairByPasting(WidgetTester tester, String code) async {
  await tester.tap(find.text('pair'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Paste link'));
  await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField), code);
  await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a name set while pairing is what the connection is saved as', (tester) async {
    final store = await _emptyStore();
    await _pumpFlow(tester, store);
    await _pairByPasting(tester, _code());

    // The dialog is prefilled with the address the code named, so the common case is one tap.
    expect(find.text('Name this connection'), findsOneWidget);
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, '192.168.1.20');

    await tester.enterText(find.byType(TextField), 'Studio');
    await tester.tap(find.widgetWithText(FilledButton, 'Add'));
    await tester.pumpAndSettle();

    final saved = await store.load();
    expect(saved, hasLength(1));
    expect(saved.single.label, 'Studio');
    // The address is still the host's identity — the name only changed what the phone calls it.
    expect(saved.single.endpoint, '192.168.1.20:4770');
    // And the just-paired machine is the one the app opens on.
    expect(await store.loadActiveHostId(), saved.single.id);
  });

  testWidgets('naming is not mandatory: a cleared field keeps the address', (tester) async {
    final store = await _emptyStore();
    await _pumpFlow(tester, store);
    await _pairByPasting(tester, _code());

    await tester.enterText(find.byType(TextField), '   ');
    await tester.tap(find.widgetWithText(FilledButton, 'Add'));
    await tester.pumpAndSettle();

    final saved = await store.load();
    expect(saved, hasLength(1));
    expect(saved.single.label, '192.168.1.20');
  });

  testWidgets('cancelling the naming step aborts the pairing, saving nothing', (tester) async {
    final store = await _emptyStore();
    await _pumpFlow(tester, store);
    await _pairByPasting(tester, _code());

    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(await store.load(), isEmpty);
    expect(await store.loadActiveHostId(), isNull);
  });
}
