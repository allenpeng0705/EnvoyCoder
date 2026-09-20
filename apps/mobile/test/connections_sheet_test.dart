// The Connections sheet: today's host list, reachable from the top bar instead of being the app.
//
// Two things here are new rather than moved. Switching host from inside the sheet has to *persist*
// (that is the active-host rule, and the controller test holds the rule itself); and the sheet is the
// first UI `HostStore.remove` has ever had, so "forget" is pinned from the button press through to
// the row leaving the list — a confirmation that is read and then ignored would be worse than none.

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

/// Never dialled: this file is about the sheet's behaviour, not about reaching a daemon.
class _SilentClient extends HostClient {
  _SilentClient(super.host);

  @override
  Future<void> connectBest() async {}

  // `dispose` is inherited on purpose — it cancels the family client's heartbeat timer, which a
  // `testWidgets` body fails for leaving pending. Tests dispose inside the body (see `_finish`).
}

/// Take the sheet down first, then the controller.
///
/// The order is not cosmetic. `ConnectionsController.dispose` disposes each `HostClient`, and
/// `HostClient.dispose` awaits its broadcast state/event controllers closing — which only resolves
/// once *every* listener has cancelled. A sheet still in the tree is still listening, so disposing the
/// controller underneath it would hang. In the app the shell owns both and goes away in the same
/// frame; in a test the tree has to be removed explicitly.
Future<void> _finish(WidgetTester tester, ConnectionsController controller) async {
  await tester.pumpWidget(const SizedBox());
  controller.dispose();
}

Future<ConnectionsController> _controllerWith(List<CoderHost> hosts, {String? active}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final store = HostStore(prefs: prefs, secure: MemorySecureStorage());
  for (final host in hosts) {
    await store.upsert(host);
  }
  if (active != null) await store.saveActiveHostId(active);
  final controller = ConnectionsController(store)
    ..clientFactory = (host) => _SilentClient(host);
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

/// Open one host row's `…`, then press the item with this label.
///
/// Rename and Forget moved in here when the row's third icon button overflowed it at 320pt; the
/// confirmation behind Forget is the row's own `_forget`, unchanged — only the control it hangs off
/// moved, exactly as Remove did on the project row.
Future<void> _pressHostMenuItem(WidgetTester tester, String hostLabel, String item) async {
  await tester.tap(find.byTooltip('More actions for $hostLabel'));
  await tester.pumpAndSettle();
  await tester.tap(find.text(item));
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('switching host from the sheet persists the choice and closes it', (tester) async {
    final controller = await _controllerWith([_host('a', 'alpha'), _host('b', 'beta')]);
    await _pumpSheet(tester, controller);

    // Both hosts are listed, with the active one marked so "which am I on?" is answered here.
    expect(find.text('alpha · current'), findsOneWidget);
    expect(find.text('beta'), findsOneWidget);
    expect(find.text('2 computers'), findsOneWidget);

    await tester.tap(find.text('beta'));
    await tester.pumpAndSettle();

    expect(controller.activeHost?.id, 'b');
    expect(await controller.store.loadActiveHostId(), 'b');
    // The sheet is a detour: it gets out of the way once the choice is made.
    expect(find.text('Connections'), findsNothing);
    await _finish(tester, controller);
  });

  testWidgets('forgetting a host asks first, then removes it', (tester) async {
    final controller = await _controllerWith([_host('a', 'alpha'), _host('b', 'beta')]);
    await _pumpSheet(tester, controller);

    await _pressHostMenuItem(tester, 'beta', 'Forget host');

    // The dialog says what is lost and what is not; the loss is the pairing, not the work.
    expect(find.text('Forget beta?'), findsOneWidget);
    expect(find.textContaining('Tasks already running there keep running'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Forget'));
    await tester.pumpAndSettle();

    expect(controller.hosts.map((h) => h.id), ['a']);
    expect(find.text('beta'), findsNothing);
    expect(find.text('1 computer'), findsOneWidget);
    // Forgetting the active host moves the app rather than leaving it on a machine it just dropped.
    expect(controller.activeHost?.id, 'a');
    await _finish(tester, controller);
  });

  testWidgets('cancelling the forget dialog changes nothing', (tester) async {
    final controller = await _controllerWith([_host('a', 'alpha')]);
    await _pumpSheet(tester, controller);

    await _pressHostMenuItem(tester, 'alpha', 'Forget host');
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(controller.hosts, hasLength(1));
    await _finish(tester, controller);
  });

  testWidgets('zero hosts says so, and offers Add host instead of an empty list', (tester) async {
    final controller = await _controllerWith([]);
    await _pumpSheet(tester, controller);

    expect(find.text('No desktop paired yet.'), findsOneWidget);
    expect(find.text('0 computers'), findsOneWidget);
    // Reuses the one add-host flow, so the sheet is not a second, parallel way to pair.
    expect(find.widgetWithText(ListTile, 'Add host'), findsOneWidget);
    await _finish(tester, controller);
  });

  testWidgets('the row leads with the name and keeps the address as secondary detail',
      (tester) async {
    // A name is set while pairing now (`host_pairing_flow.dart`), so the row can no longer assume
    // the label *is* the address. Two machines called Studio and Laptop must be distinguishable
    // without reading two IPs.
    const studio = CoderHost(
      id: 's',
      label: 'Studio',
      endpoint: '192.168.1.5:4770',
      ownerId: 'owner',
      app: 'EnvoyDev',
      token: 'tok-s',
    );
    final controller = await _controllerWith([studio]);
    await _pumpSheet(tester, controller);

    final tile = tester.widget<ListTile>(find.byType(ListTile).first);
    expect((tile.title! as Text).data, 'Studio · current');
    // The address is still on the row — it is the diagnostic fact the network panel keys off — but
    // it is on the detail line, not the title.
    final detail = tester.widget<Text>(find.textContaining('192.168.1.5:4770'));
    expect(detail.data, contains('192.168.1.5:4770'));
    expect(find.text('192.168.1.5:4770 · current'), findsNothing);
    await _finish(tester, controller);
  });

  testWidgets('renaming a connection from the sheet persists it, with no RPC', (tester) async {
    final controller = await _controllerWith([_host('a', 'alpha')]);
    await _pumpSheet(tester, controller);

    await _pressHostMenuItem(tester, 'alpha', 'Rename connection');

    // Prefilled with the name it has now.
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, 'alpha');

    await tester.enterText(find.byType(TextField), 'Laptop');
    await tester.tap(find.widgetWithText(FilledButton, 'Rename'));
    await tester.pumpAndSettle();

    expect(controller.hosts.single.label, 'Laptop');
    expect(find.text('Laptop · current'), findsOneWidget);
    expect(find.text('alpha · current'), findsNothing);
    // Persisted on the phone: the renamed row is what a restart loads.
    expect((await controller.store.load()).single.label, 'Laptop');
    await _finish(tester, controller);
  });

  testWidgets('an emptied rename is refused in the dialog and changes nothing', (tester) async {
    final controller = await _controllerWith([_host('a', 'alpha')]);
    await _pumpSheet(tester, controller);

    await _pressHostMenuItem(tester, 'alpha', 'Rename connection');
    await tester.enterText(find.byType(TextField), '   ');
    await tester.tap(find.widgetWithText(FilledButton, 'Rename'));
    await tester.pumpAndSettle();

    expect(find.text('Enter a name for this connection.'), findsOneWidget);
    expect(controller.hosts.single.label, 'alpha');
    await _finish(tester, controller);
  });

  testWidgets('cancelling the rename changes nothing', (tester) async {
    final controller = await _controllerWith([_host('a', 'alpha')]);
    await _pumpSheet(tester, controller);

    await _pressHostMenuItem(tester, 'alpha', 'Rename connection');
    await tester.enterText(find.byType(TextField), 'Not this');
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(controller.hosts.single.label, 'alpha');
    expect(find.text('alpha · current'), findsOneWidget);
    await _finish(tester, controller);
  });

  testWidgets('the host row lays out at 320pt with its two controls', (tester) async {
    // 320pt is the narrowest width this app claims to support. The host row carries two trailing
    // controls now — the read-only status button and the `…` that holds Rename and Forget — where
    // three icon buttons overflowed it by 16pt.
    //
    // It cannot simply assert "no exception": the **sheet header** (`Connections` + `N computers`)
    // overflows at this width under the test's square glyphs, a pre-existing line this change does
    // not touch. So the test captures every rendering error and attributes it by `debugCreator`,
    // exactly as the project row's 320pt test does, failing only if a *row* (`ListTile`) overflowed.
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final reported = <FlutterErrorDetails>[];
    final original = FlutterError.onError;
    FlutterError.onError = reported.add;
    addTearDown(() => FlutterError.onError = original);

    final controller = await _controllerWith([_host('a', 'alpha'), _host('b', 'beta')]);
    await _pumpSheet(tester, controller);

    // Two trailing controls only: the read-only status button, and the `…` that now carries
    // Rename and Forget.
    expect(find.byTooltip('Network status for alpha'), findsOneWidget);
    expect(find.byTooltip('More actions for alpha'), findsOneWidget);

    final creators = [
      for (final details in reported)
        if (details.exceptionAsString().contains('overflowed')) _creatorOf(details),
    ];
    expect(
      creators.where((creator) => creator.contains('ListTile')),
      isEmpty,
      reason: creators.join('\n'),
    );
    // At most the header's own Row; nothing else in the sheet may overflow.
    expect(creators.length, lessThanOrEqualTo(1), reason: creators.join('\n'));
    await _finish(tester, controller);
  });
}

/// The `debugCreator` line out of a rendering error's information, which names the widget that
/// overflowed (`Row ← Padding ← … ConnectionsSheet`). Same helper the project row's 320pt test uses.
String _creatorOf(FlutterErrorDetails details) {
  final nodes = details.informationCollector?.call();
  if (nodes == null) return '<no details>';
  for (final node in nodes) {
    final text = node.toString();
    if (text.startsWith('debugCreator:')) return text;
  }
  return '<no creator>';
}
