// The network-status panel, rendered from a stubbed client.
//
// The fields *are* the specification: the ladder in order with each rung's own reason, the last
// request's method and outcome, the two pairing fields the peer-to-peer route is gated on, and the
// one value this app cannot read said as `unavailable` rather than as a zero. The stub supplies the
// records a real walk would have made, so the assertions are about what the screen renders and not
// about how a walk happens to order itself (that is `net_diagnostics_test.dart`'s job).

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/connections_sheet.dart';
import 'package:envoydev_mobile/screens/network_status_screen.dart';
import 'package:envoydev_mobile/services/connections_controller.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/host_store.dart';
import 'package:envoydev_mobile/services/libp2p_transport.dart';
import 'package:envoydev_mobile/services/net_diagnostics.dart';
import 'package:envoydev_mobile/theme/tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/memory_secure_storage.dart';

const home = '12D3KooWhome';
const directAddr = '/ip4/192.168.1.9/tcp/4001/p2p/$home';
const _token = 'sekrit-token-123';

CoderHost host({String? homePeerId, List<String>? bootstrapPeers}) => CoderHost(
      id: 'h',
      label: 'desk',
      endpoint: '192.168.1.9:4770',
      ownerId: 'o',
      app: 'EnvoyDev',
      token: _token,
      lanWsUrl: 'ws://192.168.1.9:4770/ws',
      homePeerId: homePeerId,
      bootstrapPeers: bootstrapPeers,
    );

/// A client that answers from records a test set, and dials nothing.
class _StubClient extends HostClient {
  _StubClient(super.host);

  List<RouteAttempt> ladder = const [];
  RpcOutcome? rpc;
  String? route;
  HomeMeshSnapshot? mesh;
  String? meshError;
  DateTime? meshAt;
  HostConnectionState connectionState = HostConnectionState.reconnecting;
  bool probeCalled = false;

  @override
  Future<void> connectBest() async {} // the tests are about rendering, not dialling

  @override
  Future<void> probeHomeMesh({Duration timeout = const Duration(seconds: 25)}) async {
    probeCalled = true;
  }

  @override
  List<RouteAttempt> get routeLadder => ladder;

  @override
  int get ladderPlanLimit => 4;

  @override
  String? get activeRoute => route;

  @override
  RpcOutcome? get lastRpc => rpc;

  @override
  HomeMeshSnapshot? get homeMesh => mesh;

  @override
  String? get homeMeshError => meshError;

  @override
  DateTime? get homeMeshAt => meshAt;

  @override
  HostConnectionState get state => connectionState;
}

/// A started node, so the panel's one honest gap is on screen. A widget test cannot build the
/// process-wide libp2p host — and must not start one in order to render a report about it.
const _startedNode = NodeDiagnostics(
  started: true,
  peerId: home,
  relayEnabled: true,
  protocolCount: 1,
  hostEpoch: 3,
);

/// A viewport tall enough to lay the whole report out, so the assertions can be about content rather
/// than about scrolling. A `ListView` only builds the children its viewport needs, so a phone-sized
/// viewport would leave the last two sections unbuilt. The narrow-phone case is its own test below.
Future<void> _pumpPanel(
  WidgetTester tester,
  _StubClient client, {
  Size size = const Size(420, 2200),
  NodeDiagnostics Function()? node,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: const CoderTheme(CoderColors.light).toThemeData(),
      home: NetworkStatusScreen(client: client, nodeSnapshot: node ?? () => _startedNode),
    ),
  );
  await tester.pump();
}

/// Dispose inside the body: `HostClient.dispose` releases the family client's periodic upgrade-sweep
/// timer, and a pending timer at teardown fails a `testWidgets` body.
Future<void> _finish(_StubClient client) async {
  await client.dispose();
}

/// The value cell of the row labelled [label].
///
/// Scoped to its own row on purpose: the same string legitimately appears twice on this screen (the
/// desktop's peer id is also this phone's *paired* peer id, `0` is both a candidate count and a LAN
/// peer count), and `find.text('0')` would pass for the wrong reason.
String rowValue(WidgetTester tester, String label) => tester
    .widget<SelectableText>(
      find.descendant(
        of: find.ancestor(of: find.text(label), matching: find.byType(Row)).first,
        matching: find.byType(SelectableText),
      ),
    )
    .data!;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('renders the ladder and the last request from a stubbed client', (tester) async {
    final client = _StubClient(
      host(homePeerId: home, bootstrapPeers: const [directAddr]),
    )
      ..route = 'relay'
      ..ladder = const [
        RouteAttempt(
          name: 'lan',
          redactedUrl: 'ws://192.168.1.9:4770/ws?token=<redacted>',
          status: RouteAttemptStatus.failed,
          error: 'SocketException: Connection refused',
          elapsedMs: 512,
        ),
        RouteAttempt(
          name: 'p2p-direct',
          redactedUrl: directAddr,
          status: RouteAttemptStatus.failed,
          error: 'libp2p: no connection to $directAddr',
          elapsedMs: 8001,
        ),
        RouteAttempt(
          name: 'relay',
          redactedUrl: 'wss://relay.example/ws',
          status: RouteAttemptStatus.connected,
          elapsedMs: 240,
        ),
      ]
      ..rpc = const RpcOutcome(
        method: 'coder.listProjects',
        ok: false,
        elapsedMs: 15000,
        error: 'homeRemote.listProjectsTimeout',
      );

    await _pumpPanel(tester, client);

    // The headline: the state in end-user words and the rung actually in use.
    expect(find.text('Reconnecting — your tasks are still running'), findsOneWidget);
    expect(find.text('relay'), findsWidgets);

    // The ladder: every rung, in the family's order, rather than only the winner.
    expect(find.text('lan'), findsOneWidget);
    expect(find.text('p2p-direct'), findsOneWidget);
    expect(find.text('SocketException: Connection refused'), findsOneWidget);
    expect(find.text('libp2p: no connection to $directAddr'), findsOneWidget);
    expect(find.textContaining('failed · 512 ms'), findsOneWidget);
    expect(find.textContaining('connected · 240 ms'), findsOneWidget);

    // The last request: the field that answers "connecting, but no projects".
    expect(find.text('coder.listProjects'), findsOneWidget);
    expect(find.text('failed'), findsOneWidget);
    expect(find.text('15000 ms'), findsOneWidget);
    expect(find.text('homeRemote.listProjectsTimeout'), findsOneWidget);

    // The pairing fields the peer-to-peer route is gated on, both present here.
    expect(find.text('Desktop peer id'), findsOneWidget);
    expect(rowValue(tester, 'Desktop peer id'), home);
    expect(rowValue(tester, 'Dialable peer addresses'), '1');

    // The phone's node: what it holds, and the one value it cannot report, said plainly.
    expect(rowValue(tester, 'Relay dialling'), 'enabled');
    expect(rowValue(tester, 'Relay reservation'), contains('none'));
    expect(find.text('Connected peers'), findsOneWidget);
    expect(
      find.textContaining('unavailable — the shared node exposes no connection view'),
      findsOneWidget,
    );

    // The desktop has not been asked yet, and the panel says so instead of showing a blank.
    expect(find.textContaining('Not asked yet'), findsOneWidget);

    // The token is nowhere on the screen.
    expect(find.textContaining(_token), findsNothing);

    await _finish(client);
  });

  testWidgets('a host with no homePeerId and no bootstrapPeers is reported as such',
      (tester) async {
    final client = _StubClient(host())
      ..ladder = const [
        RouteAttempt(
          name: 'lan',
          redactedUrl: 'ws://192.168.1.9:4770/ws?token=<redacted>',
          status: RouteAttemptStatus.failed,
          error: 'SocketException: Connection refused',
        ),
      ];

    await _pumpPanel(tester, client);

    expect(find.text('Desktop peer id'), findsOneWidget);
    expect(rowValue(tester, 'Desktop peer id'), 'none');
    expect(rowValue(tester, 'Dialable peer addresses'), '0');
    expect(find.textContaining('Both are needed for the peer-to-peer route'), findsOneWidget);
    // No peer rung was built, so none is claimed.
    expect(find.text('p2p-direct'), findsNothing);
    expect(find.textContaining('p2p-'), findsNothing);

    await _finish(client);
  });

  testWidgets('opening the panel does not dial; Check again asks the desktop', (tester) async {
    final client = _StubClient(host());
    await _pumpPanel(tester, client);

    // A diagnostics surface that dials by being looked at reports its own activity.
    expect(client.probeCalled, isFalse);

    await tester.tap(find.text('Check again'));
    await tester.pump();

    expect(client.probeCalled, isTrue);

    // Pull-to-refresh is the same action, wired to the same call.
    expect(find.byType(RefreshIndicator), findsOneWidget);

    await _finish(client);
  });

  testWidgets('copy puts the whole report on the clipboard, without the token', (tester) async {
    final copied = <String>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied.add((call.arguments as Map)['text'] as String);
        }
        return null;
      },
    );
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));

    final client = _StubClient(host(homePeerId: home, bootstrapPeers: const [directAddr]))
      ..ladder = const [
        RouteAttempt(
          name: 'lan',
          redactedUrl: 'ws://192.168.1.9:4770/ws?token=<redacted>',
          status: RouteAttemptStatus.failed,
          error: 'SocketException: Connection refused',
          elapsedMs: 512,
        ),
      ]
      ..rpc = const RpcOutcome(method: 'coder.listProjects', ok: false, elapsedMs: 15000);

    await _pumpPanel(tester, client);

    // Icon-only, so it carries both a tooltip and a Semantics label.
    expect(find.byTooltip('Copy report'), findsOneWidget);
    expect(find.bySemanticsLabel('Copy report'), findsOneWidget);

    await tester.tap(find.byTooltip('Copy report'));
    await tester.pumpAndSettle();

    expect(copied, hasLength(1));
    expect(copied.single, contains('EnvoyDev network status'));
    expect(copied.single, contains('1. lan'));
    expect(copied.single, contains('Connection refused'));
    expect(copied.single, contains('coder.listProjects — failed after 15000 ms'));
    expect(copied.single, contains('homePeerId: $home'));
    expect(copied.single, contains('connected peers: unavailable'));
    expect(copied.single, isNot(contains(_token)));
    // The confirmation says where it went, not just that something was copied.
    expect(find.textContaining('paste it into the bug report'), findsOneWidget);

    await _finish(client);
  });

  testWidgets('lays out on the narrowest phone without overflowing', (tester) async {
    final client = _StubClient(host(homePeerId: home, bootstrapPeers: const [directAddr]))
      ..ladder = const [
        RouteAttempt(
          name: 'p2p-12D3KooWLNR4WYWHBswe8ux5zWsy6cuGywnYPJbdbaAbbpmJMjbo',
          redactedUrl: '/p2p/12D3KooWLNR4WYWHBswe8ux5zWsy6cuGywnYPJbdbaAbbpmJMjbo'
              '/p2p-circuit/p2p/$home',
          status: RouteAttemptStatus.failed,
          error: 'libp2p: no connection to the relay after 8001 ms of trying',
          elapsedMs: 8001,
        ),
      ]
      ..rpc = const RpcOutcome(method: 'coder.listProjects', ok: false, elapsedMs: 15000)
      ..mesh = const HomeMeshSnapshot(
        kind: 'hosting',
        peerId: home,
        multiaddrCount: 4,
        relayHintCount: 1,
        peerCount: 2,
      )
      ..meshAt = DateTime(2026, 9, 20);

    await _pumpPanel(tester, client, size: const Size(320, 640));

    // A RenderFlex overflow is an exception in a widget test, so reaching this line is the assertion.
    expect(tester.takeException(), isNull);
    expect(find.text('Network status'), findsOneWidget);
    expect(find.text('Check again'), findsOneWidget);

    await _finish(client);
  });

  testWidgets('the Connections sheet reaches it, from the row of the computer it is about',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final store = HostStore(prefs: prefs, secure: MemorySecureStorage());
    await store.upsert(host(homePeerId: home, bootstrapPeers: const [directAddr]));
    final controller = ConnectionsController(store);
    controller.clientFactory = (h) => _StubClient(h)..ladder = const [
          RouteAttempt(
            name: 'lan',
            redactedUrl: 'ws://192.168.1.9:4770/ws?token=<redacted>',
            status: RouteAttemptStatus.failed,
            error: 'SocketException: Connection refused',
          ),
        ];
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(
        theme: const CoderTheme(CoderColors.light).toThemeData(),
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

    // Icon-only, so both a tooltip and a Semantics label, and both name the computer: two rows sit
    // inches apart and "Network status" alone would not say whose.
    expect(find.byTooltip('Network status for desk'), findsOneWidget);
    expect(find.bySemanticsLabel('Network status for desk'), findsOneWidget);

    await tester.tap(find.byTooltip('Network status for desk'));
    await tester.pumpAndSettle();

    // The panel is up, and it is about the host the row was about.
    expect(find.text('Network status'), findsOneWidget);
    expect(find.text('Desktop peer id'), findsOneWidget);
    expect(rowValue(tester, 'Desktop peer id'), home);
    expect(find.text('SocketException: Connection refused'), findsOneWidget);

    // The panel stacks above the sheet, so backing out of it returns to the list of computers
    // rather than dropping the user out of the detour entirely.
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Connections'), findsOneWidget);
    expect(find.text('1 computer'), findsOneWidget);

    // Take the sheet and the panel down before the controller, or its client disposal waits on a
    // listener that is still in the tree (`HostClient.dispose` closes broadcast controllers).
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
  });
}
