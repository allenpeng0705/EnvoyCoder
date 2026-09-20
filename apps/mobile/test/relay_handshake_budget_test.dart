// The relay WebSocket rung, and the budget that has to end it.
//
// The failure this pins is a phone stuck on "Connecting": a relay socket that *opens* (so this is
// not a connect timeout) but never completes the client-proxy handshake, because the relay is
// waiting on a home that never answers. A connect timeout and a handshake timeout are different
// things, and the walk's per-candidate budget must cover the second.
//
// Two levels are tested, because both are claims the walk makes:
//   1. `HostClient` — the real `ClientProxyTransport` against a live-but-silent relay, through the
//      real `DialBudget`; the walk must finish (and report a failure), not hang.
//   2. `HomeRemoteClient` — a silent relay candidate ahead of a working one; the walk must fail the
//      first within the budget and *continue* to the second, which wins.
//
// The relay here is an in-process `HttpServer`: it upgrades, records the `proxy-connect` frame, and
// never replies. No network, no phone, no live relay.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:envoy_thin_client/envoy_thin_client.dart';
import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/net_diagnostics.dart';
import 'package:flutter_test/flutter_test.dart';

const _homePeerId = '12D3KooWhome';

/// A relay that takes the socket, reads the handshake, and answers nothing.
class _SilentRelay {
  _SilentRelay(this._server) {
    _server.listen((request) async {
      if (!WebSocketTransformer.isUpgradeRequest(request)) return;
      final socket = await WebSocketTransformer.upgrade(request);
      _sockets.add(socket);
      socket.listen(
        (data) {
          // `ClientProxyTransport` sends this only after the socket is open — proof the rung ran
          // the proxy handshake path and not a plain `ws://…/ws` dial.
          if (data is String && data.contains('proxy-connect')) {
            receivedProxyConnect = true;
          }
        },
        onError: (_) {},
      );
    });
  }

  static Future<_SilentRelay> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    return _SilentRelay(server);
  }

  final HttpServer _server;
  final List<WebSocket> _sockets = <WebSocket>[];

  bool receivedProxyConnect = false;

  String get base => 'ws://127.0.0.1:${_server.port}';

  Future<void> dispose() async {
    for (final socket in _sockets) {
      await socket.close();
    }
    await _server.close(force: true);
  }
}

/// A transport that opens and immediately announces `connected`, like a healthy home.
class _HealthyDaemon implements WebSocketLike {
  @override
  int readyState = wsConnecting;

  @override
  void Function()? onOpen;
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
    // Announce on a later turn, like a socket: `HomeRemoteClient` installs its handlers after the
    // factory returns.
    Timer.run(() {
      readyState = wsOpen;
      onOpen?.call();
      handler(WsMessageEvent(jsonEncode({'event': 'connected', 'data': <String, dynamic>{}})));
    });
  }

  @override
  void send(String data) {}

  @override
  void close() {
    if (readyState == wsClosed) return;
    readyState = wsClosed;
    Timer.run(() => onClose?.call());
  }
}

CoderHost _hostFor(String relayBase) => CoderHost(
      id: 'h',
      label: 'desk',
      endpoint: '10.0.0.1:4770',
      ownerId: 'o',
      app: 'EnvoyDev',
      token: 'tok',
      lanWsUrl: '$relayBase/ws',
      relayWsUrl: '$relayBase/relay',
      // Both are needed: the peer id makes the relay candidate carry `?target=`, which is what
      // routes it through `ClientProxyTransport` instead of a plain WebSocket.
      homePeerId: _homePeerId,
      bootstrapPeers: ['/ip4/10.0.0.1/tcp/4001/p2p/$_homePeerId'],
    );

void main() {
  test(
    'a relay that opens but never completes the handshake fails the walk within the budget',
    () async {
      final relay = await _SilentRelay.start();
      addTearDown(relay.dispose);
      final host = _hostFor(relay.base);
      final client = HostClient(
        host,
        // The libp2p rungs are not the subject; fail them cheaply.
        libp2pDialer: (candidate) async => throw StateError('libp2p not under test'),
        budget: const DialBudget(
          perCandidateTimeout: Duration(milliseconds: 300),
          maxAttemptsPerWalk: 4,
        ),
        minDelay: const Duration(seconds: 5),
        maxDelay: const Duration(seconds: 5),
      );
      addTearDown(client.dispose);

      final stopwatch = Stopwatch()..start();
      // The outer timeout is the fail-without-fix signal: if the budget did not cover the
      // handshake, this future would never complete and the test would fail here.
      await client.connectBest().timeout(const Duration(seconds: 5));
      stopwatch.stop();

      expect(relay.receivedProxyConnect, isTrue,
          reason: 'the relay rung must have run the client-proxy handshake');
      expect(client.state, HostConnectionState.reconnecting,
          reason: 'a rung that cannot complete must fail, not read as still connecting');

      final relayAttempt = client.routeLadder
          .where((attempt) => attempt.name == 'relay')
          .toList();
      expect(relayAttempt, hasLength(1));
      expect(relayAttempt.single.status, RouteAttemptStatus.failed);
      // Four rungs at 300 ms, plus one already-failed dial, is well inside this.
      expect(stopwatch.elapsed, lessThan(const Duration(seconds: 3)));
    },
    // A real Windows/CI timer can be slow; the assertion above is the budget, this is the guard.
    timeout: const Timeout(Duration(seconds: 15)),
  );

  test('a silent relay rung fails within the budget and the walk continues to the next rung',
      () async {
    final relay = await _SilentRelay.start();
    addTearDown(relay.dispose);

    final relayCandidate = HomeRemoteCandidate(
      name: 'community-relay',
      url: '${relay.base}/ws?target=$_homePeerId&token=tok',
      homePeerId: _homePeerId,
      sessionToken: 'tok',
    );
    const workingCandidate = HomeRemoteCandidate(
      name: 'lan',
      url: 'ws://127.0.0.1:1/ws',
      homePeerId: null,
      sessionToken: 'tok',
    );

    final client = HomeRemoteClient(
      HomeRemoteClientOptions(
        resolveCandidates: () async => <HomeRemoteCandidate>[relayCandidate, workingCandidate],
        createTransport: (candidate) async {
          if (candidate.name == 'community-relay') {
            // The real transport under test: it accepts the socket, sends the handshake, and waits.
            return ClientProxyTransport.connect(
              relayWsUrl: '${relay.base}/ws',
              homePeerId: _homePeerId,
              sessionToken: 'tok',
              // The transport owns the same bound the mobile passes in production, so its socket
              // close lands with the walk's, not 20 s later.
              handshakeTimeout: const Duration(milliseconds: 300),
            );
          }
          return _HealthyDaemon();
        },
        perCandidateTimeoutMs: 300,
        upgradeSweepMs: 0,
      ),
    );
    addTearDown(client.dispose);

    final stopwatch = Stopwatch()..start();
    await client.ensureConnected().timeout(const Duration(seconds: 5));
    stopwatch.stop();

    expect(relay.receivedProxyConnect, isTrue);
    expect(client.activeCandidate?.name, 'lan',
        reason: 'the walk must move past the silent relay rung to the next one');
    expect(stopwatch.elapsed, lessThan(const Duration(seconds: 3)));
  }, timeout: const Timeout(Duration(seconds: 15)));
}
