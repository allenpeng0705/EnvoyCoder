/// The connect cycle: present the pairing the phone holds, and retire it if the daemon refuses.
///
/// The storage half is in `pairing_store_test.dart`. This file is about the one thing a store cannot
/// prove on its own — that a **dial** actually carries the stored token, that a daemon which accepts it
/// is recorded against its own identity, and that a refusal is acted on exactly once rather than on
/// every reconnect.
library;

import 'dart:async';
import 'dart:convert';

import 'package:envoy_thin_client/envoy_thin_client.dart';
import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/pairing_store.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/memory_secure_storage.dart';

/// A daemon that answers the handshake, with whatever identity and refusal the test asks for.
///
/// It buffers its output until handlers are attached, like a real socket: `HomeRemoteClient` installs
/// `onOpen`/`onMessage` after the transport factory returns.
class _PairingDaemon implements WebSocketLike {
  _PairingDaemon({this.instanceId, this.refuseToken = false});

  /// What `coder.hello` reports as this process's identity. Null models the older daemon that did not
  /// answer one.
  final String? instanceId;

  /// Whether this daemon rejects the credential it was handed, the way a revoked token is refused.
  final bool refuseToken;

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

  void open() {
    readyState = wsOpen;
    _openRequested = true;
    final handler = _onOpen;
    if (handler != null) {
      _openRequested = false;
      handler();
    }
    _deliver(jsonEncode({'event': 'connected', 'data': <String, dynamic>{}}));
  }

  void _deliver(String text) {
    final handler = _onMessage;
    if (handler != null) {
      handler(WsMessageEvent(text));
      return;
    }
    _early.add(text);
  }

  void _reply(Object? id, Object? result) {
    Timer.run(() => _deliver(jsonEncode({'id': id, 'result': result})));
  }

  @override
  void send(String data) {
    sent.add(data);
    final frame = jsonDecode(data) as Map<String, dynamic>;
    final id = frame['id'];
    switch (frame['method']) {
      case 'coder.hello':
        if (refuseToken) {
          // The refusal a product handler raises, in the protocol's own wire form: the `envoydev.*`
          // code rides inside the message, which is how this app tells a rejected credential from an
          // unreachable machine (`packages/protocol/src/rpc.ts`).
          Timer.run(() => _deliver(jsonEncode({
                'id': id,
                'error': {
                  'code': 'ERROR',
                  'message': '$kUnauthorizedErrorCode: this pairing is no longer valid',
                },
              })));
          return;
        }
        _reply(id, {
          'product': 'EnvoyDev',
          if (instanceId != null) 'instanceId': instanceId,
        });
      case 'coder.subscribe':
        _reply(id, {'subscribed': <String>[]});
      default:
        _reply(id, <String, dynamic>{});
    }
  }

  @override
  void close() {
    if (readyState == wsClosed) return;
    readyState = wsClosed;
    Timer.run(() => onClose?.call());
  }
}

CoderHost hostFor({
  String endpoint = '192.168.1.9:4770',
  String owner = 'owner-a',
  String token = 'old-host-token',
}) =>
    CoderHost(
      id: '$owner::$endpoint',
      label: 'Studio',
      endpoint: endpoint,
      ownerId: owner,
      app: 'EnvoyDev',
      token: token,
      lanWsUrl: 'ws://$endpoint/ws',
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a stored token is offered on the next connect, and the hello is recorded', () async {
    final secure = MemorySecureStorage();
    final pairings = PairingStore(secure: secure);
    final host = hostFor();
    final key = daemonKeyFor(endpoint: host.endpoint, owner: host.ownerId);
    await pairings.record(key, 'grant-from-this-desktop');

    final dialed = <String>[];
    final daemon = _PairingDaemon(instanceId: 'process-7');
    final client = HostClient(
      host,
      pairingStore: pairings,
      dialer: (url) async {
        dialed.add(url);
        Timer.run(daemon.open);
        return daemon;
      },
      minDelay: const Duration(seconds: 5),
      maxDelay: const Duration(seconds: 5),
    );
    addTearDown(client.dispose);

    await client.connectBest();

    expect(client.state, HostConnectionState.connected);
    expect(dialed, isNotEmpty);
    // The daemon-issued token went on the wire, not the host row's older one: presenting the grant is
    // what stops this connect from being a fresh pairing.
    expect(dialed.single, contains('token=grant-from-this-desktop'));
    expect(dialed.single, isNot(contains('old-host-token')));

    // And the daemon that accepted it is recorded, with the identity it reported.
    final record = (await pairings.pairingFor(key))!;
    expect(record.token, 'grant-from-this-desktop');
    expect(record.instanceId, 'process-7');
    expect(record.lastSeenAt, isNotNull);
    expect(client.pairingRefused, isFalse);
  });

  test('a hello without an instanceId is still a pairing, with no identity claimed', () async {
    final secure = MemorySecureStorage();
    final pairings = PairingStore(secure: secure);
    final host = hostFor();
    final key = daemonKeyFor(endpoint: host.endpoint, owner: host.ownerId);
    final daemon = _PairingDaemon();
    final client = HostClient(
      host,
      pairingStore: pairings,
      dialer: (url) async {
        Timer.run(daemon.open);
        return daemon;
      },
      minDelay: const Duration(seconds: 5),
      maxDelay: const Duration(seconds: 5),
    );
    addTearDown(client.dispose);

    await client.connectBest();

    final record = (await pairings.pairingFor(key))!;
    expect(record.token, 'old-host-token');
    expect(record.instanceId, isNull);
  });

  test('a refused token is cleared, and the refusal is acted on once', () async {
    final secure = MemorySecureStorage();
    final pairings = PairingStore(secure: secure);
    final host = hostFor();
    final key = daemonKeyFor(endpoint: host.endpoint, owner: host.ownerId);
    await pairings.record(key, 'revoked-token', instanceId: 'process-6');

    final daemon = _PairingDaemon(refuseToken: true);
    final client = HostClient(
      host,
      pairingStore: pairings,
      dialer: (url) async {
        Timer.run(daemon.open);
        return daemon;
      },
      minDelay: const Duration(seconds: 5),
      maxDelay: const Duration(seconds: 5),
    );
    addTearDown(client.dispose);

    await client.connectBest();

    // The daemon refused the credential, so the phone no longer holds it: the next connect offers the
    // host row's token instead, and a second refusal clears nothing a second time.
    expect(client.pairingRefused, isTrue);
    expect(await pairings.tokenFor(key), isNull);
    expect(await secure.read(key: 'envoydev.pairing.v1.$key'), isNull);

    await client.connectBest();
    expect(client.pairingRefused, isTrue);
    expect(await pairings.tokenFor(key), isNull);
  });

  test('a token for one daemon is never offered to a different daemon', () async {
    final secure = MemorySecureStorage();
    final pairings = PairingStore(secure: secure);
    final other = hostFor(endpoint: '10.0.0.5:4770', owner: 'owner-a');
    await pairings.record(
      daemonKeyFor(endpoint: other.endpoint, owner: other.ownerId),
      'grant-for-the-other-machine',
    );

    final host = hostFor();
    final dialed = <String>[];
    final daemon = _PairingDaemon(instanceId: 'process-7');
    final client = HostClient(
      host,
      pairingStore: pairings,
      dialer: (url) async {
        dialed.add(url);
        Timer.run(daemon.open);
        return daemon;
      },
      minDelay: const Duration(seconds: 5),
      maxDelay: const Duration(seconds: 5),
    );
    addTearDown(client.dispose);

    await client.connectBest();

    // The other machine's credential is not on any frame this client sent, in any encoding.
    expect(dialed, isNotEmpty);
    for (final url in dialed) {
      expect(url, isNot(contains('grant-for-the-other-machine')));
      expect(url, contains('token=old-host-token'));
    }
    expect(daemon.sent.join(), isNot(contains('grant-for-the-other-machine')));
  });
}
