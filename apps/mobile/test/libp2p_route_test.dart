// The direct libp2p rung, dialled for real.
//
// A fake dialer proves the client *hands over* the peer id and addresses; it cannot prove the
// transport opens. This test starts an actual `Libp2pNode` as the home, registers the client-proxy
// protocol on it, points a `HostClient` at it with a dead LAN address, and requires the walk to win
// on `p2p-direct` and carry a `coder.*` round trip over the resulting stream.
//
// It is also the app's guard on `pubspec.yaml`'s `pointycastle` override: this is the one test that
// compiles and runs `dart_libp2p` against the version the phone actually resolves.

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:envoy_mesh_libp2p/envoy_mesh_libp2p.dart';
import 'package:envoy_mesh_libp2p/src/mesh_framing.dart';
import 'package:envoy_thin_client/envoy_thin_client.dart';
import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/libp2p_transport.dart';
import 'package:flutter_test/flutter_test.dart';

Future<int> _freePort() async {
  final socket = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  final port = socket.port;
  await socket.close();
  return port;
}

Uint8List _frame(String text) =>
    Uint8List.fromList(utf8.encode(frameMessage(text)));

/// The smallest home that is still honest: accept the client-proxy handshake, then answer every RPC.
Future<void> _serveHome(P2PStream<dynamic> stream, String token) async {
  final buffer = MeshFrameBuffer();

  Future<String?> nextFrame() async {
    while (true) {
      final bytes = await stream.read();
      if (bytes.isEmpty) return null;
      final frames = buffer.add(bytes);
      if (frames.isNotEmpty) return frames.first;
    }
  }

  final connect = jsonDecode((await nextFrame())!) as Map<String, dynamic>;
  if (connect['type'] != 'proxy-connect' || connect['token'] != token) {
    stream.write(_frame(jsonEncode({'type': 'proxy-reject', 'reason': 'bad token'})));
    await stream.close();
    return;
  }
  stream.write(_frame(jsonEncode({'type': 'proxy-accept'})));

  while (true) {
    final raw = await nextFrame();
    if (raw == null) break;
    final rpc = jsonDecode(raw) as Map<String, dynamic>;
    stream.write(_frame(jsonEncode({
      'id': rpc['id'],
      'result': {'product': 'EnvoyDev', 'method': rpc['method']},
    })));
  }
  await stream.close();
}

void main() {
  test('the walk wins on the direct libp2p rung and carries RPCs over it', () async {
    final port = await _freePort();
    final home = Libp2pNode(seedStore: MemoryLibp2pSeedStore());
    await home.start(
      listenAddrs: ['/ip4/127.0.0.1/tcp/$port'],
      enableRelay: false,
    );
    addTearDown(home.stop);
    final homeAddr = '/ip4/127.0.0.1/tcp/$port/p2p/${home.peerId}';
    home.registerStreamHandler(
      kClientProxyProtocol,
      (stream, remote) => _serveHome(stream, 'tok'),
    );

    final phone = Libp2pNode(seedStore: MemoryLibp2pSeedStore());
    await phone.start(enableRelay: false);
    addTearDown(phone.stop);

    final client = HostClient(
      CoderHost(
        id: 'h',
        label: 'desk',
        // Nothing is listening here: the direct WebSocket rung must fail so the P2P rung is the one
        // that wins — otherwise this test would pass without ever dialling libp2p.
        endpoint: '127.0.0.1:1',
        ownerId: 'o',
        app: 'EnvoyDev',
        token: 'tok',
        homePeerId: '${home.peerId}',
        bootstrapPeers: [homeAddr],
      ),
      dialer: (url) async => throw const SocketException('nothing at the direct address'),
      libp2pDialer: Libp2pTransport(node: () async => phone).dial,
      budget: const DialBudget(
        perCandidateTimeout: Duration(seconds: 5),
        maxAttemptsPerWalk: 2,
      ),
      minDelay: const Duration(seconds: 5),
      maxDelay: const Duration(seconds: 5),
    );
    addTearDown(client.dispose);

    await client.connectBest();

    expect(client.state, HostConnectionState.connected);
    expect(client.activeRoute, 'p2p-direct');

    final hello = await client.call('coder.hello', {});
    expect(hello['product'], 'EnvoyDev');
    expect(hello['method'], 'coder.hello');
    // `ensureConnected` is a no-op now, so this is the same transport, still open.
    expect(await client.call('coder.listTasks', {}), isA<Map<String, dynamic>>());
  }, timeout: const Timeout(Duration(seconds: 120)));
}
