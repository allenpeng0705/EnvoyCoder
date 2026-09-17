/// The direct libp2p dial: the family's `Libp2pNode`, adapted to the transport the walk expects.
///
/// The candidate walk can *order* a P2P rung, but ordering is not dialling. This is the half the app
/// was missing — the old client skipped the rung outright because it had no dialer, which meant a
/// pairing payload could carry the desktop's peer id and dialable addresses and the phone would
/// ignore both.
///
/// The flow is EnvoyGo's, minus its DHT lookup: the payload already carries the addresses, so there
/// is nothing to discover.
///
///   1. start the shared libp2p host (one per phone, not one per paired desktop: a peer id, a relay
///      reservation and a DHT are shared resources);
///   2. for a **circuit** candidate (`/p2p/<relay>/p2p-circuit/p2p/<home>`) let `dial` connect to the
///      relay and open the stream through it;
///   3. for a **direct** candidate connect to the peer first — `dial` opens a stream *by peer id* and
///      reads the address from the peerstore, which `start(bootstrapAddrs:)` fills from a background
///      task, so without an awaited connect the dial races it and fails as if the peer were down;
///   4. speak the client-proxy handshake, which is what turns a raw stream into the authenticated,
///      framed transport `HomeRemoteClient` can multiplex JSON-RPC over.
library;

import 'dart:async';

import 'package:envoy_mesh_libp2p/envoy_mesh_libp2p.dart';
import 'package:envoy_thin_client/envoy_thin_client.dart';

/// Dials one libp2p candidate and returns a transport `HomeRemoteClient` can speak JSON-RPC over.
typedef Libp2pDialer = Future<WebSocketLike> Function(HomeRemoteCandidate candidate);

/// The process-wide node. See the library doc for why it is shared rather than per host.
///
/// Seeded in memory: the client-proxy handshake authenticates with the session token, not with this
/// peer id, so a fresh identity per launch costs nothing but a relay that has seen one more peer.
/// Persisting it in secure storage is an optimisation to make later, not a correctness requirement.
Libp2pNode? _sharedNode;

Future<Libp2pNode> _sharedLibp2pNode() async {
  final node = _sharedNode ??= Libp2pNode(seedStore: MemoryLibp2pSeedStore());
  if (!node.isStarted) {
    // `enableRelay: true` is what makes the `/p2p-circuit/` candidates dialable at all. No TCP
    // listen: the phone only dials out.
    await node.start(enableRelay: true);
  }
  return node;
}

/// Stops the shared node. For tests and for a deliberate teardown; the app has no reason to call it.
Future<void> stopSharedLibp2pNode() async {
  final node = _sharedNode;
  _sharedNode = null;
  await node?.stop();
}

class Libp2pTransport {
  Libp2pTransport({
    this.connectTimeout = const Duration(seconds: 8),
    Future<Libp2pNode> Function()? node,
  }) : _node = node ?? _sharedLibp2pNode;

  /// Bound on step 3's connect. A private LAN address that nothing answers must not hold the walk
  /// past its own per-candidate timeout.
  final Duration connectTimeout;

  final Future<Libp2pNode> Function() _node;

  Future<WebSocketLike> dial(HomeRemoteCandidate candidate) async {
    final address = candidate.url;
    final token = candidate.sessionToken ?? '';
    final node = await _node();

    if (!address.contains('/p2p-circuit/')) {
      final reached = await node.connectPeer(address, timeout: connectTimeout);
      if (!reached) {
        // The same sentence shape the walk's own failures use, so a log or a test reads the same
        // whether the transport or the walk gave up.
        throw StateError('libp2p: no connection to $address');
      }
    }

    final transport = await node.dial(
      peerMultiaddr: address,
      protocolId: kClientProxyProtocol,
    );
    // Throws on `proxy-reject`, which is the home refusing the token — a real answer, and the walk
    // must move on rather than treat the socket as connected.
    await transport.performHandshake(token);
    return transport;
  }
}
