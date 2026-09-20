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
    //
    // **No `bootstrapAddrs`, deliberately.** EnvoyGo starts its node with the stored node's
    // `bootstrapPeers`, and the obvious move here is to copy that so a short-form circuit resolves
    // from the peerstore. Measured, it makes this app *worse*: the seeded relay is dialled by the
    // node's background bootstrap task at the same time as the circuit's HOP dial, and the relay
    // resets the duplicate —
    // `FormatException: Multistream operation failed: SocketException: Connection reset by peer`
    // on `/ip4/47.93.11.212/tcp/4001/p2p/<relay>` — so an off-LAN connect that succeeded in 0.9 s
    // without the seeding failed after 0.2 s with it (reproduced 1-of-2 runs; the race is
    // intermittent, which is worse for a user than a deterministic failure).
    //
    // The capability the seeding was meant to buy already exists one layer up: `libp2pDialTarget`
    // puts the relay's real address into the multiaddr handed to `Libp2pNode.dial`, so the dial's own
    // circuit branch seeds the relay peerstore entry synchronously, on the connection it is about to
    // use. That is the load-bearing fix for the owner's hint-only QR, and the second mechanism is
    // rejected rather than left in place.
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

/// What the network-status surface can read off the shared node, and nothing it cannot.
///
/// A flat snapshot rather than a live reference to the node: the screen reads it, and a value object
/// cannot be mutated by a dial finishing between the read and the render.
class NodeDiagnostics {
  const NodeDiagnostics({
    required this.started,
    this.peerId,
    this.relayEnabled = false,
    this.reservedRelayPeerIds = const <String>[],
    this.circuitAddrs = const <String>[],
    this.protocolCount = 0,
    this.mdnsActive = false,
    this.lanPeerCount = 0,
    this.hostEpoch = 0,
    this.hasTcpListen = false,
  });

  /// The node has never been started: no peer-to-peer rung has been dialled in this launch.
  static const NodeDiagnostics notStarted = NodeDiagnostics(started: false);

  final bool started;

  /// The local peer id, once the host is up.
  final String? peerId;

  /// Whether circuit-relay *dialling* was enabled at start. This is the client half only.
  final bool relayEnabled;

  /// Relay peer ids this node holds a circuit reservation on.
  ///
  /// Empty for EnvoyDev, and correctly so: only the **home** has to hold a reservation for the phone
  /// to reach it through the relay — the phone is the circuit's client. The family tracks the whole
  /// set (`PhoneMeshSession.reservedRelayPeerIds`); EnvoyDev never calls `reserveRelay`, so reading
  /// the host's single "most recent" value is the same fact.
  final List<String> reservedRelayPeerIds;

  /// The `/p2p-circuit/` multiaddrs this node could advertise. Empty without a reservation.
  final List<String> circuitAddrs;

  /// How many stream handlers are registered — the mesh's inbound side.
  final int protocolCount;

  final bool mdnsActive;
  final int lanPeerCount;
  final int hostEpoch;
  final bool hasTcpListen;

  /// The reservation in one sentence, for the report.
  String get reservationLine {
    if (reservedRelayPeerIds.isEmpty) {
      return 'none — this app dials circuits, it does not reserve one '
          '(${circuitAddrs.length} circuit addresses)';
    }
    return 'reserved on ${reservedRelayPeerIds.join(', ')} '
        '(${circuitAddrs.length} circuit addresses)';
  }
}

/// A read-only peek at the process-wide node, for the network-status surface.
///
/// Reads only, and never starts anything: a surface that booted a libp2p host in order to look at it
/// would change the state it is reporting — the phone would show a peer id it acquired *because* the
/// user asked for a report. When nothing has dialled a peer rung yet the answer is
/// [NodeDiagnostics.notStarted], which is itself the finding.
///
/// Synchronous on purpose: every getter it reads is synchronous, so a screen rebuilds from it with no
/// await and no loading state.
NodeDiagnostics libp2pNodeDiagnostics() {
  final node = _sharedNode;
  if (node == null || !node.isStarted) return NodeDiagnostics.notStarted;
  final reserved = node.reservedRelayPeerId;
  return NodeDiagnostics(
    started: true,
    peerId: node.peerId?.toString(),
    relayEnabled: node.relayEnabled,
    reservedRelayPeerIds: <String>[if (reserved != null) reserved],
    circuitAddrs: node.relayAdvertisedMultiaddrs(),
    protocolCount: node.registeredProtocols.length,
    mdnsActive: node.mdnsActive,
    lanPeerCount: node.lanDiscoveredPeers().length,
    hostEpoch: node.hostEpoch,
    hasTcpListen: node.hasTcpListenAddrs,
  );
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
    final address = libp2pDialTarget(candidate);
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

/// The multiaddr `Libp2pNode.dial` is actually asked to dial for [candidate].
///
/// The family hands a **built** circuit route in two pieces: `url` is the path
/// (`/p2p/<relay>/p2p-circuit/p2p/<home>`) and [HomeRemoteCandidate.libp2pRelayAddr] is the relay's
/// own dialable address (`/ip4/47.93.11.212/tcp/4001/p2p/<relay>`). `Libp2pNode.dial` seeds the
/// relay's peerstore entry from the *transport prefix of the address it is given*, so a bare-path
/// dial leaves the relay unresolved and dies in `newStream(relayId)` with
/// `No addresses found for peer: <relay>` — a rung the walk reports as failed after a dial that
/// could never have reached anyone. Prefixing the relay address with the route's `/p2p-circuit/…`
/// suffix is what makes the candidate the route the family said it was. An **advertised** circuit
/// already carries its hop address in `url`; prefixing there would duplicate the hop, so it is
/// dialled as it stands.
///
/// Public so the mapping is testable without a relay: the failure it fixes is a string the dialer
/// hands to the node, and a unit test can pin it without the network.
String libp2pDialTarget(HomeRemoteCandidate candidate) {
  final url = candidate.url;
  final circuitAt = url.indexOf('/p2p-circuit/');
  if (circuitAt < 0) return url;

  final relay = candidate.libp2pRelayAddr?.trim() ?? '';
  // Nothing to add, or the relay field already names the whole route (the advertised shape).
  if (relay.isEmpty || relay.contains('/p2p-circuit/')) return url;

  // Everything before the first `/p2p/` is the hop's transport address. When it is empty the route
  // is the family's short form and only [relay] can supply one.
  final firstP2p = url.indexOf('/p2p/');
  if (firstP2p > 0) return url;
  return '$relay${url.substring(circuitAt)}';
}
