// The network-status report: what it says, and what it refuses to say.
//
// Two halves, because there are two things to prove. The first builds a `NetDiagnostics` by hand and
// pins the text — the ladder in the family's order, each rung's reason, the last request, and the two
// pairing fields the peer-to-peer route is gated on. The second runs a **real** `HostClient` walk
// against transports that refuse, because the record the panel shows has to come out of the client's
// own walk and not out of a builder a test handed it.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:envoy_thin_client/envoy_thin_client.dart';
import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/libp2p_transport.dart';
import 'package:envoydev_mobile/services/net_diagnostics.dart';
import 'package:flutter_test/flutter_test.dart';

const home = '12D3KooWhome';
const directAddr = '/ip4/192.168.1.9/tcp/4001/p2p/$home';

/// A token distinctive enough that finding it anywhere in a report is unambiguous.
const _token = 'sekrit-token-123';

CoderHost host({
  String endpoint = '192.168.1.9:4770',
  String? lanWsUrl,
  String? homePeerId,
  List<String>? bootstrapPeers,
  String? relayWsUrl,
  String token = _token,
}) =>
    CoderHost(
      id: 'h',
      label: 'desk',
      endpoint: endpoint,
      ownerId: 'o',
      app: 'EnvoyDev',
      token: token,
      lanWsUrl: lanWsUrl,
      homePeerId: homePeerId,
      bootstrapPeers: bootstrapPeers,
      relayWsUrl: relayWsUrl,
    );

/// A client whose retries are far enough away that a test never races them, and whose dials all fail.
HostClient refusedClient(
  CoderHost h, {
  int maxAttemptsPerWalk = 4,
}) =>
    HostClient(
      h,
      dialer: (url) async => throw const SocketException('Connection refused'),
      // Never the default dialer: that one would boot a real libp2p host inside a unit test.
      libp2pDialer: (candidate) async =>
          throw StateError('libp2p: no connection to ${candidate.url}'),
      budget: DialBudget(
        perCandidateTimeout: const Duration(milliseconds: 200),
        maxAttemptsPerWalk: maxAttemptsPerWalk,
      ),
      minDelay: const Duration(seconds: 60),
      maxDelay: const Duration(seconds: 60),
    );


/// The smallest daemon that is still honest: it opens, announces `connected`, and answers every
/// JSON-RPC frame — optionally refusing `coder.hello`, which is the contradiction the panel exists
/// to make visible (a live transport, a handshake the desktop would not serve).
class _FakeDaemon implements WebSocketLike {
  _FakeDaemon({this.refuseHello = false});

  final bool refuseHello;

  @override
  int readyState = wsConnecting;

  @override
  void Function()? onOpen;
  @override
  void Function()? onClose;
  @override
  void Function()? onError;
  @override
  void Function(WsMessageEvent event)? onMessage;

  /// Open on a later turn, like `PlatformWebSocket`: `HomeRemoteClient` installs its handlers after
  /// the transport factory returns, so a transport that fired inline would test the test.
  void open() {
    readyState = wsOpen;
    onOpen?.call();
    _deliver(jsonEncode({'event': 'connected', 'data': <String, dynamic>{}}));
  }

  @override
  void send(String data) {
    final frame = jsonDecode(data) as Map<String, dynamic>;
    final id = frame['id'];
    if (refuseHello && frame['method'] == 'coder.hello') {
      // The family's error shape: a **string** code, not JSON-RPC's numeric one. A number here is
      // swallowed by the client's malformed-message guard and the call hangs — which is how this
      // line was found.
      _reply(jsonEncode({
        'id': id,
        'error': {'code': 'ERROR', 'message': 'hello refused'},
      }));
      return;
    }
    _reply(jsonEncode({'id': id, 'result': <String, dynamic>{}}));
  }

  void _reply(String text) => Timer.run(() => _deliver(text));

  void _deliver(String text) => onMessage?.call(WsMessageEvent(text));

  @override
  void close() {
    if (readyState == wsClosed) return;
    readyState = wsClosed;
    Timer.run(() => onClose?.call());
  }
}

/// A client whose one rung is a daemon that answers, so the handshake path is exercised.
HostClient answeringClient(CoderHost h, {bool refuseHello = false}) => HostClient(
      h,
      dialer: (url) async {
        final daemon = _FakeDaemon(refuseHello: refuseHello);
        Timer.run(daemon.open);
        return daemon;
      },
      libp2pDialer: (candidate) async => throw StateError('not a peer candidate'),
      budget: const DialBudget(
        perCandidateTimeout: Duration(milliseconds: 500),
        maxAttemptsPerWalk: 4,
      ),
      minDelay: const Duration(seconds: 60),
      maxDelay: const Duration(seconds: 60),
    );

void main() {
  group('the copied report', () {
    test('names every rung in order, with the reason each one failed', () {
      final diagnostics = NetDiagnostics(
        host: host(
          lanWsUrl: 'ws://192.168.1.9:4770/ws',
          homePeerId: home,
          bootstrapPeers: const [directAddr],
          relayWsUrl: 'wss://relay.example/ws',
        ),
        stateLabel: 'Reconnecting — your tasks are still running',
        activeRoute: 'relay',
        ladder: [
          const RouteAttempt(
            name: 'lan',
            redactedUrl: 'ws://192.168.1.9:4770/ws?token=<redacted>',
            status: RouteAttemptStatus.failed,
            error: 'SocketException: Connection refused',
            elapsedMs: 512,
          ),
          const RouteAttempt(
            name: 'p2p-direct',
            redactedUrl: directAddr,
            status: RouteAttemptStatus.failed,
            error: 'libp2p: no connection to $directAddr',
            elapsedMs: 8001,
          ),
          const RouteAttempt(
            name: 'relay',
            redactedUrl: 'wss://relay.example/ws',
            status: RouteAttemptStatus.connected,
            elapsedMs: 240,
          ),
        ],
        planLimit: 4,
        lastWalkError: 'homeRemote.connectFailed — tried: [lan, p2p-direct] — last error: refused',
        lastRpc: const RpcOutcome(
          method: 'coder.listProjects',
          ok: false,
          elapsedMs: 15000,
          error: 'homeRemote.listProjectsTimeout',
        ),
        node: NodeDiagnostics.notStarted,
      );

      final report = diagnostics.toReport();

      // The ladder, in the order the family produced it, each with its own line.
      expect(report, contains('1. lan — ws://192.168.1.9:4770/ws?token=<redacted>'));
      expect(report, contains('2. p2p-direct — $directAddr'));
      expect(report, contains('3. relay — wss://relay.example/ws'));
      expect(
        report.indexOf('1. lan'),
        lessThan(report.indexOf('2. p2p-direct')),
      );
      expect(report.indexOf('2. p2p-direct'), lessThan(report.indexOf('3. relay')));

      // The reason, per rung — the field that was missing.
      expect(report, contains('failed after 512 ms — SocketException: Connection refused'));
      expect(report, contains('libp2p: no connection to $directAddr'));
      expect(report, contains('connected — this is the rung in use after 240 ms'));

      // Which one is active, and the headline state.
      expect(report, contains('Active route: relay'));
      expect(report, contains('State: Reconnecting — your tasks are still running'));

      // The last request: method, outcome, timing, text.
      expect(report, contains('coder.listProjects — failed after 15000 ms'));
      expect(report, contains('homeRemote.listProjectsTimeout'));

      // The walk's own summary is kept, because it is the family's only account of all of them.
      expect(report, contains('last walk: failed'));
    });

    test('never carries the pairing token, even when an error string did', () {
      final diagnostics = NetDiagnostics(
        host: host(lanWsUrl: 'ws://192.168.1.9:4770/ws'),
        stateLabel: 'Connecting',
        activeRoute: null,
        ladder: const [
          RouteAttempt(
            name: 'lan',
            // Deliberately unredacted: the funnel has to catch what capture-time redaction missed.
            redactedUrl: 'ws://192.168.1.9:4770/ws?token=$_token',
            status: RouteAttemptStatus.failed,
            error: 'handshake rejected for ws://192.168.1.9:4770/ws?token=$_token',
          ),
        ],
        planLimit: 4,
        node: NodeDiagnostics.notStarted,
      );

      final report = diagnostics.toReport();

      expect(report, isNot(contains(_token)));
      expect(report, contains('token=<redacted>'));
      expect(report, contains('Pairing token: not shown'));
    });

    test('a host with no homePeerId and no bootstrapPeers is reported as such', () {
      final bare = host(lanWsUrl: 'ws://192.168.1.9:4770/ws');
      final diagnostics = NetDiagnostics(
        host: bare,
        stateLabel: 'Reconnecting — your tasks are still running',
        activeRoute: null,
        // What the family produces for such a host: the direct address and nothing peer-to-peer.
        ladder: const [
          RouteAttempt(
            name: 'lan',
            redactedUrl: 'ws://192.168.1.9:4770/ws',
            status: RouteAttemptStatus.failed,
            error: 'SocketException: Connection refused',
          ),
        ],
        planLimit: 4,
        node: NodeDiagnostics.notStarted,
      );

      expect(diagnostics.hasP2pRoute, isFalse);
      expect(diagnostics.homePeerId, isEmpty);
      expect(diagnostics.bootstrapPeers, isEmpty);

      final report = diagnostics.toReport();
      expect(report, contains('homePeerId: none'));
      expect(report, contains('bootstrapPeers: 0 addresses'));
      expect(report, contains('! Both are required'));
      expect(report, contains('the phone is left with the direct address and the relay'));
      // And the report does not claim a peer-to-peer rung that was never built.
      expect(report, isNot(contains('p2p-')));
    });

    test('a started node reports what it holds, and says the peer count is unreadable', () {
      final diagnostics = NetDiagnostics(
        host: host(),
        stateLabel: 'Connected',
        activeRoute: 'p2p-cn',
        ladder: const [],
        planLimit: 4,
        node: const NodeDiagnostics(
          started: true,
          peerId: home,
          relayEnabled: true,
          mdnsActive: false,
          lanPeerCount: 2,
          protocolCount: 1,
          hostEpoch: 3,
          hasTcpListen: false,
        ),
      );

      final report = diagnostics.toReport();
      expect(report, contains('peer id: $home'));
      expect(report, contains('circuit dialling): enabled'));
      expect(report, contains('relay reservation: none'));
      expect(report, contains('connected peers: unavailable'));
      expect(report, contains('LAN peers seen: 2'));
      expect(report, contains('host generation: 3'));

      // The unstarted case is a different sentence, not a node with zeroes.
      final cold = NetDiagnostics(
        host: host(),
        stateLabel: 'Connecting',
        activeRoute: null,
        ladder: const [],
        planLimit: 4,
        node: NodeDiagnostics.notStarted,
      );
      expect(cold.toReport(), contains('not started'));
      expect(cold.toReport(), isNot(contains('connected peers: unavailable')));
    });
  });

  group('the desktop\'s own mesh answer', () {
    test('parses a hosting answer and refuses anything it cannot read', () {
      final hosting = HomeMeshSnapshot.fromRpc(<String, dynamic>{
        'kind': 'hosting',
        'peerId': home,
        'multiaddrs': ['/ip4/1.2.3.4/tcp/4001/p2p/$home'],
        'relayHints': ['cn'],
        'peerCount': 2,
      });
      expect(hosting, isNotNull);
      expect(hosting!.kind, 'hosting');
      expect(hosting.peerId, home);
      expect(hosting.multiaddrCount, 1);
      expect(hosting.relayHintCount, 1);
      expect(hosting.peerCount, 2);

      expect(HomeMeshSnapshot.fromRpc(null), isNull);
      expect(HomeMeshSnapshot.fromRpc('hosting'), isNull);
      expect(HomeMeshSnapshot.fromRpc(<String, dynamic>{'nope': 1}), isNull);
      // A newer desktop's unknown variant still renders: its `kind` is data, not a closed set.
      expect(HomeMeshSnapshot.fromRpc(<String, dynamic>{'kind': 'future-thing'})!.kind,
          'future-thing');
    });

    test('a failed ask is recorded as a failure, not as an empty mesh', () async {
      final client = refusedClient(host(lanWsUrl: 'ws://192.168.1.9:4770/ws'));
      addTearDown(client.dispose);

      await client.probeHomeMesh(timeout: const Duration(milliseconds: 400));

      expect(client.homeMesh, isNull);
      expect(client.homeMeshError, isNotNull);
      expect(client.homeMeshAt, isNotNull);
      expect(client.lastRpc!.method, 'coder.meshStatus');
      expect(client.lastRpc!.ok, isFalse);
      expect(client.diagnostics().toReport(), contains('answered: no'));
    });
  });

  group('the record comes out of the client\'s own walk', () {
    test('every refused rung is recorded with the transport\'s own words', () async {
      final client = refusedClient(
        host(
          lanWsUrl: 'ws://192.168.1.9:4770/ws',
          homePeerId: home,
          bootstrapPeers: const [directAddr],
          relayWsUrl: 'wss://relay.example/ws',
        ),
      );
      addTearDown(client.dispose);

      await client.connectBest();
      final diagnostics = client.diagnostics();

      expect(client.state, HostConnectionState.reconnecting);
      expect(client.activeRoute, isNull);

      // The ladder is the family's order, and it is not empty.
      expect(diagnostics.ladder, isNotEmpty);
      expect(diagnostics.ladder.first.name, 'lan');
      expect(diagnostics.ladder.map((a) => a.name), contains('relay'));

      // Every rung that was dialled carries a reason, and none of them is invented.
      for (final attempt in diagnostics.ladder.where((a) => a.attempted)) {
        expect(attempt.status, RouteAttemptStatus.failed, reason: attempt.name);
        expect(attempt.error, isNotNull, reason: attempt.name);
        expect(attempt.elapsedMs, isNotNull, reason: attempt.name);
      }

      // The walk's own summary, with the token that was in its URLs redacted on the way in.
      expect(diagnostics.lastWalkError, contains('connectFailed'));
      expect(diagnostics.lastWalkError, isNot(contains(_token)));
      expect(diagnostics.lastWalkError, contains('token=<redacted>'));

      // And it is all in the report the owner pastes.
      final report = diagnostics.toReport();
      expect(report, contains('1. lan'));
      expect(report, contains('Connection refused'));
      expect(report, isNot(contains(_token)));
    });

    test('a walk past the budget marks the tail as not tried, not as failed', () async {
      final client = refusedClient(
        host(
          lanWsUrl: 'ws://192.168.1.9:4770/ws',
          homePeerId: home,
          bootstrapPeers: const [directAddr],
          relayWsUrl: 'wss://relay.example/ws',
        ),
        maxAttemptsPerWalk: 1,
      );
      addTearDown(client.dispose);

      await client.connectBest();
      final diagnostics = client.diagnostics();

      expect(diagnostics.planLimit, 1);
      expect(diagnostics.attemptedRungs, 1);
      expect(
        diagnostics.ladder.where((a) => a.status == RouteAttemptStatus.skipped),
        isNotEmpty,
        reason: 'the family produced more rungs than one pass may dial',
      );
      expect(diagnostics.toReport(), contains('not tried — past this walk\'s limit'));
    });

    test('a failed RPC is recorded with its method and its error', () async {
      // No token at all here: this client is about the RPC record, not about redaction.
      final client = refusedClient(host(lanWsUrl: 'ws://192.168.1.9:4770/ws'));
      addTearDown(client.dispose);

      await expectLater(client.call('coder.listProjects'), throwsA(anything));

      expect(client.lastRpc!.method, 'coder.listProjects');
      expect(client.lastRpc!.ok, isFalse);
      expect(client.lastRpc!.error, isNotNull);
      expect(client.diagnostics().toReport(), contains('coder.listProjects — failed'));
    });

    test('before anything is dialled, the node is reported as not started', () async {
      // Belie the ordering: the shared node is process-wide, so make the claim explicit.
      await stopSharedLibp2pNode();

      final client = refusedClient(host(lanWsUrl: 'ws://192.168.1.9:4770/ws'));
      addTearDown(client.dispose);

      final node = client.diagnostics().node;
      expect(node.started, isFalse);
      expect(node.peerId, isNull);
      expect(node.reservationLine, contains('none'));
      expect(client.diagnostics().toReport(), contains('not started'));
    });
  });

  group('the last request', () {
    test('the handshake is recorded, so a reached desktop is on the record', () async {
      final client = answeringClient(host(lanWsUrl: 'ws://192.168.1.9:4770/ws'));
      addTearDown(client.dispose);

      await client.connectBest();

      expect(client.state, HostConnectionState.connected);
      expect(client.activeRoute, 'lan');
      expect(client.lastRpc!.ok, isTrue);
      // `coder.subscribe` is the handshake's second half; anything the screens sent would be later.
      expect(client.lastRpc!.method, 'coder.subscribe');
      expect(client.diagnostics().toReport(), contains('coder.subscribe — answered in'));
    });

    test('a refused handshake is recorded while the transport still reports connected', () async {
      final client = answeringClient(
        host(lanWsUrl: 'ws://192.168.1.9:4770/ws'),
        refuseHello: true,
      );
      addTearDown(client.dispose);

      await client.connectBest();

      // The family reports the transport, deliberately, even when the daemon did not answer: this is
      // the pair of facts the panel has to show together or the report reads as "fine".
      expect(client.state, HostConnectionState.connected);
      expect(client.lastRpc!.method, 'coder.hello');
      expect(client.lastRpc!.ok, isFalse);
      expect(client.lastRpc!.error, contains('hello refused'));

      final report = client.diagnostics().toReport();
      expect(report, contains('State: Connected'));
      expect(report, contains('coder.hello — failed after'));
      expect(report, contains('hello refused'));
    });
  });
}
