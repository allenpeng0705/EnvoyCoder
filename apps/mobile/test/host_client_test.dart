// The phone's client, tested against a daemon that is not there.
//
// The point of these tests is the ladder the app *no longer owns*: the walk must happen in the
// family's order, the libp2p rung must actually hand the peer id and addresses to a dialer (the
// capability the old client merely ordered and then skipped), the budget must be able to stop a walk,
// and the route label must name the rung that won and stop naming one when nothing is in play.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:envoy_thin_client/envoy_thin_client.dart';
import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/libp2p_transport.dart';
import 'package:envoydev_mobile/services/ssh_tunnel.dart';
import 'package:flutter_test/flutter_test.dart';

const home = '12D3KooWhome';
const directAddr = '/ip4/192.168.1.9/tcp/4001/p2p/$home';

/// A daemon on the other end of any transport: opens, says `connected`, answers `coder.*` frames.
///
/// It buffers its own output until handlers are attached, like a real socket: `HomeRemoteClient`
/// installs `onOpen`/`onMessage` after the transport factory returns, so a test transport that fired
/// immediately would test the test rather than the client.
class _FakeDaemon implements WebSocketLike {
  _FakeDaemon({this.hang = false});

  /// A candidate that never answers — the per-candidate timeout has to give up on it.
  final bool hang;

  final List<String> sent = [];
  final List<String> _early = [];

  @override
  int readyState = wsConnecting;

  void Function()? _onOpen;
  bool _openRequested = false;

  @override
  void Function()? get onOpen => _onOpen;

  @override
  set onOpen(void Function()? handler) {
    _onOpen = handler;
    if (handler != null && _openRequested) {
      _openRequested = false;
      handler();
    }
  }

  @override
  void Function()? onClose;
  @override
  void Function()? onError;

  void Function(WsMessageEvent event)? _onMessage;

  @override
  void Function(WsMessageEvent event)? get onMessage => _onMessage;

  @override
  set onMessage(void Function(WsMessageEvent event)? handler) {
    _onMessage = handler;
    if (handler == null) return;
    final pending = List<String>.from(_early);
    _early.clear();
    for (final text in pending) {
      handler(WsMessageEvent(text));
    }
  }

  /// Open and announce, the way the family's ws-server does for an authenticated socket.
  void open() {
    if (hang) return;
    readyState = wsOpen;
    _openRequested = true;
    final handler = _onOpen;
    if (handler != null) {
      _openRequested = false;
      handler();
    }
    _deliver(jsonEncode({'event': 'connected', 'data': <String, dynamic>{}}));
  }

  /// A push event, after the connection is up.
  void emit(String event, Object? data) =>
      _deliver(jsonEncode({'event': event, 'data': data}));

  /// The daemon going away.
  void drop() {
    if (readyState == wsClosed) return;
    readyState = wsClosed;
    onClose?.call();
  }

  void _deliver(String text) {
    final handler = _onMessage;
    if (handler != null) {
      handler(WsMessageEvent(text));
      return;
    }
    _early.add(text);
  }

  @override
  void send(String data) {
    sent.add(data);
    final frame = jsonDecode(data) as Map<String, dynamic>;
    // The family wire shape, asserted on every frame this client puts on the wire.
    expect(frame.containsKey('jsonrpc'), isFalse);
    final id = frame['id'];
    switch (frame['method']) {
      case 'coder.hello':
        _reply(id, {'product': 'EnvoyDev'});
      case 'coder.subscribe':
        _reply(id, {'subscribed': <String>[]});
      default:
        _reply(id, <String, dynamic>{});
    }
  }

  void _reply(Object? id, Object? result) {
    // A reply on a later turn, not synchronously: answering inside `send` would land before the
    // caller stored its pending completer, which is a test artefact rather than socket behaviour.
    Timer.run(() => _deliver(jsonEncode({'id': id, 'result': result})));
  }

  @override
  void close() {
    if (readyState == wsClosed) return;
    readyState = wsClosed;
    // `onClose` on a later turn, like `PlatformWebSocket` (whose close is a socket close and a
    // stream event, not a synchronous callback). A transport that fired it inline would make
    // `HomeRemoteClient`'s failure path re-enter itself.
    Timer.run(() => onClose?.call());
  }
}

CoderHost host({
  String endpoint = '192.168.1.9:4770',
  String token = 'tok',
  String? lanWsUrl,
  String? homePeerId,
  List<String>? bootstrapPeers,
  String? relayWsUrl,
  SshHop? ssh,
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
      ssh: ssh,
    );

/// A client whose retries are far enough away that a test never races them.
HostClient clientFor(
  CoderHost h, {
  required WsDialer dialer,
  Libp2pDialer? libp2pDialer,
  SshTunnelOpener? sshTunnelOpener,
  DialBudget budget = const DialBudget(
    perCandidateTimeout: Duration(milliseconds: 300),
    maxAttemptsPerWalk: 4,
  ),
}) =>
    HostClient(
      h,
      dialer: dialer,
      libp2pDialer: libp2pDialer,
      sshTunnelOpener: sshTunnelOpener,
      budget: budget,
      minDelay: const Duration(seconds: 5),
      maxDelay: const Duration(seconds: 5),
    );

void main() {
  test('the walk follows the family order until a rung answers, and names it', () async {
    final dialed = <String>[];
    final client = clientFor(
      host(lanWsUrl: 'ws://192.168.1.9:4770/ws', relayWsUrl: 'wss://relay.example/ws'),
      dialer: (url) async {
        dialed.add(url);
        if (url.contains('192.168.1.9')) throw const SocketException('unreachable');
        final daemon = _FakeDaemon();
        Timer.run(daemon.open);
        return daemon;
      },
    );
    addTearDown(client.dispose);

    await client.connectBest();

    expect(dialed, hasLength(2));
    expect(dialed.first, contains('192.168.1.9'));
    expect(dialed[1], contains('relay.example'));
    expect(client.state, HostConnectionState.connected);
    expect(client.activeRoute, 'relay');
  });

  test('the direct libp2p rung is dialled with the peer id and its addresses', () async {
    final libp2pCalls = <HomeRemoteCandidate>[];
    final client = clientFor(
      host(
        lanWsUrl: 'ws://192.168.1.9:4770/ws',
        homePeerId: home,
        bootstrapPeers: [directAddr],
      ),
      dialer: (url) async => throw const SocketException('unreachable'),
      libp2pDialer: (candidate) async {
        libp2pCalls.add(candidate);
        final daemon = _FakeDaemon();
        Timer.run(daemon.open);
        return daemon;
      },
      // The walk reaches the direct candidate second; the tail is not needed.
      budget: const DialBudget(
        perCandidateTimeout: Duration(milliseconds: 300),
        maxAttemptsPerWalk: 2,
      ),
    );
    addTearDown(client.dispose);

    await client.connectBest();

    expect(libp2pCalls, hasLength(1));
    expect(libp2pCalls.single.url, directAddr);
    expect(libp2pCalls.single.homePeerId, home);
    expect(libp2pCalls.single.sessionToken, 'tok');
    expect(client.state, HostConnectionState.connected);
    expect(client.activeRoute, 'p2p-direct');
  });

  test('no peer id means the libp2p dialer is never asked', () async {
    var libp2pCalls = 0;
    final client = clientFor(
      host(lanWsUrl: 'ws://192.168.1.9:4770/ws', bootstrapPeers: [directAddr]),
      dialer: (url) async => throw const SocketException('unreachable'),
      libp2pDialer: (candidate) async {
        libp2pCalls += 1;
        return _FakeDaemon();
      },
    );
    addTearDown(client.dispose);

    await client.connectBest();
    expect(libp2pCalls, 0);
    expect(client.activeRoute, isNull);
  });

  test('a peer id with no address means the libp2p dialer is never asked', () async {
    var libp2pCalls = 0;
    final client = clientFor(
      host(lanWsUrl: 'ws://192.168.1.9:4770/ws', homePeerId: home),
      dialer: (url) async => throw const SocketException('unreachable'),
      libp2pDialer: (candidate) async {
        libp2pCalls += 1;
        return _FakeDaemon();
      },
    );
    addTearDown(client.dispose);

    await client.connectBest();
    expect(libp2pCalls, 0);
  });

  test('a candidate that never answers is abandoned on the per-candidate timeout', () async {
    final dialed = <String>[];
    final client = clientFor(
      host(lanWsUrl: 'ws://192.168.1.9:4770/ws', relayWsUrl: 'wss://relay.example/ws'),
      dialer: (url) async {
        dialed.add(url);
        // The LAN address accepts the socket and then says nothing forever.
        if (url.contains('192.168.1.9')) return _FakeDaemon(hang: true);
        final daemon = _FakeDaemon();
        Timer.run(daemon.open);
        return daemon;
      },
      budget: const DialBudget(
        perCandidateTimeout: Duration(milliseconds: 150),
        maxAttemptsPerWalk: 4,
      ),
    );
    addTearDown(client.dispose);

    // Without the timeout this future never completes: the walk would sit on the silent candidate
    // for as long as a real TCP connect can hang.
    await client.connectBest();

    expect(dialed, hasLength(2));
    expect(client.activeRoute, 'relay');
  });

  test('the budget defers the walk once the pressure threshold is reached', () async {
    var dials = 0;
    final client = clientFor(
      host(lanWsUrl: 'ws://192.168.1.9:4770/ws'),
      dialer: (url) async {
        dials += 1;
        throw const SocketException('unreachable');
      },
      budget: const DialBudget(
        perCandidateTimeout: Duration(milliseconds: 50),
        maxAttemptsPerWalk: 1,
        pressureWindow: Duration(seconds: 30),
        pressureThreshold: 2,
        deferFor: Duration(seconds: 10),
      ),
    );
    addTearDown(client.dispose);

    await client.connectBest();
    expect(dials, 1, reason: 'one candidate, one dial');

    await client.connectBest();
    expect(dials, 2, reason: 'still below the threshold');

    await client.connectBest();
    // Deferred: the walk is *not attempted*. Not even the cheapest rung, and the client says so
    // rather than pretending it tried.
    expect(dials, 2);
    expect(client.state, HostConnectionState.reconnecting);
    expect(client.activeRoute, isNull);
  });

  test('the active route stops being named when the connection drops', () async {
    late _FakeDaemon daemon;
    final client = clientFor(
      host(endpoint: '192.168.1.9:4770'),
      dialer: (url) async {
        daemon = _FakeDaemon();
        Timer.run(daemon.open);
        return daemon;
      },
    );
    addTearDown(client.dispose);

    await client.connectBest();
    expect(client.activeRoute, 'lan');

    daemon.drop();
    expect(client.activeRoute, isNull);
    expect(client.state, HostConnectionState.reconnecting);
  });

  test('an SSH hop is the transport for the host’s own address, and the route says so', () async {
    final tunneled = <String>[];
    final dialed = <String>[];
    final client = clientFor(
      host(
        endpoint: '127.0.0.1:4770',
        ssh: const SshHop(host: 'bastion', user: 'dev'),
      ),
      sshTunnelOpener: (h, hop) async {
        tunneled.add('${hop.user}@${hop.host}');
        return 'ws://127.0.0.1:54321/ws?token=${h.token}';
      },
      dialer: (url) async {
        dialed.add(url);
        final daemon = _FakeDaemon();
        Timer.run(daemon.open);
        return daemon;
      },
    );
    addTearDown(client.dispose);

    await client.connectBest();

    expect(tunneled, ['dev@bastion']);
    expect(dialed, hasLength(1));
    expect(dialed.single, contains('127.0.0.1:54321'));
    expect(client.activeRoute, 'ssh');
  });

  test('events arrive as {event, data}, whatever the daemon calls them', () async {
    late _FakeDaemon daemon;
    final client = clientFor(
      host(),
      dialer: (url) async {
        daemon = _FakeDaemon();
        Timer.run(daemon.open);
        return daemon;
      },
    );
    addTearDown(client.dispose);

    await client.connectBest();
    final frames = <Map<String, dynamic>>[];
    final sub = client.events.listen(frames.add);

    daemon.emit('coder:run-event', {'runId': 'r1'});
    daemon.emit('coder:an-event-from-a-later-desktop', {'x': 1});
    await Future<void>.delayed(Duration.zero);

    expect(frames.map((f) => f['event']), [
      'coder:run-event',
      'coder:an-event-from-a-later-desktop',
    ]);
    expect(frames.first['data'], {'runId': 'r1'});
    await sub.cancel();
  });

  test('an RPC round-trips in the family wire shape', () async {
    late _FakeDaemon daemon;
    final client = clientFor(
      host(),
      dialer: (url) async {
        daemon = _FakeDaemon();
        Timer.run(daemon.open);
        return daemon;
      },
    );
    addTearDown(client.dispose);

    await client.connectBest();
    final result = await client.call('coder.listTasks', {});

    expect(result, isEmpty);
    final first = jsonDecode(daemon.sent.first) as Map<String, dynamic>;
    expect(first.keys.toSet(), containsAll({'id', 'method', 'params'}));
    expect(first['method'], 'coder.hello');
    expect(daemon.sent.map((s) => jsonDecode(s)['method']), contains('coder.subscribe'));
  });
}
