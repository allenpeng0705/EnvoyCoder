/// How a paired host becomes the **family's** candidate walk.
///
/// This file is the whole of the app's routing knowledge, and it deliberately contains no ordering:
/// which rung comes first is `CandidateResolver`'s decision (`envoy_thin_client`), shared with every
/// other app in the group. What lives here is the one thing the family cannot know — how *this*
/// product's pairing payload maps onto `StoredNode`.
///
/// The app used to keep its own ladder (`RouteResolver`, deleted). Two ladders meant two answers to
/// "how is this host reached", and the one the phone actually walked was the one the desktop's code
/// never saw: a new rung added on the family side, or a fix to the relay/circuit ordering, reached
/// EnvoyGo and not this app. The decision was to keep one ladder; this is the mapping that lets the
/// app use it.
///
/// ## What the mapping is, and the alternative rejected
///
/// The pairing payload's `wsUrl` is the daemon's **own** address (the desktop rewrites it to its LAN
/// address, or `127.0.0.1`), unlike EnvoyMesh's, where `wsUrl` is the relay. So the direct address
/// goes in the family's LAN slot (`lanIp`), which is the slot that resolves to a plain WebSocket
/// `ws://…/ws` with the token attached. Putting it in `publicHost` was rejected: that builder
/// hardcodes `ws://`, so a `wss://` direct address would be silently downgraded — a security change
/// disguised as a mapping.
library;

import 'package:envoy_thin_client/envoy_thin_client.dart' as thin;

import '../models/host.dart';

/// Turn the phone's host record into the family's [thin.StoredNode].
///
/// Field choices, all of them forced by the family's own semantics:
///
///   * `lanIp` — the direct address. `lanWsUrl` when the code carried one (the desktop's own idea of
///     its LAN address), else the primary address built from [CoderHost.directWsUrl]. Both are "the
///     address that reaches the daemon directly", and the family's LAN slot holds one, not two.
///   * `relayWsUrl` — the primary relay. [parsePairingCode] already drops it when it is the same
///     address as the primary, so a code without a real relay does not pay for a dial at its own
///     direct address with a `?target=` on it.
///   * `bootstrapPeers` — **both** lists the payload can carry: the home's dialable libp2p
///     multiaddrs and any extra relay WebSocket bases. The family reads the multiaddrs as P2P hops
///     or a direct dial and the WebSocket entries as extra relays, which is exactly what they are.
///   * `publicHost` — left unset. The app has no way to learn a public address that the direct one is
///     not already; inventing one would be a rung nobody dialled.
thin.StoredNode storedNodeFor(CoderHost host) {
  return thin.StoredNode(
    id: host.id,
    name: host.label,
    ownerId: host.ownerId,
    // Both the identity and an address, or neither — see [_dialablePeerId].
    homePeerId: _dialablePeerId(host),
    lanIp: host.lanWsUrl ?? host.directWsUrl,
    relayWsUrl: host.relayWsUrl,
    pairedAt: host.lastSeenAt ?? DateTime.now(),
    bootstrapPeers: _peerListFor(host),
  );
}

/// The home's dialable addresses and the extra relay bases, in one list, without duplicates.
///
/// `StoredNode` has one list for both and the family splits it by shape (a leading `/` is a
/// multiaddr), so the union is the honest representation rather than a lossy pick.
List<String> _peerListFor(CoderHost host) {
  final seen = <String>{};
  final peers = <String>[];
  for (final entry in <String>[...?host.bootstrapPeers, ...?host.relayWsUrls]) {
    final trimmed = entry.trim();
    if (trimmed.isEmpty || !seen.add(trimmed)) continue;
    peers.add(trimmed);
  }
  return peers;
}

/// The home peer id, but only when the payload also named an address to reach it at.
///
/// The family's resolver will reach a known peer id through the built-in community relay with no
/// addresses at all, and for a daemon holding a reservation there that is a real route. EnvoyDev's
/// pairing payload is nevertheless the authority on where its desktop is: a code that named a peer
/// id and no address named a route the phone cannot walk, and dialling shared infrastructure on the
/// desktop's behalf would put a rung in the ladder that fails like a network fault. Both fields, or
/// neither — the rule the app's own ladder used, kept after the ladder itself was retired.
String _dialablePeerId(CoderHost host) {
  final id = host.homePeerId?.trim() ?? '';
  if (id.isEmpty) return '';
  final addrs = host.bootstrapPeers ?? const <String>[];
  if (addrs.isEmpty) return '';
  return id;
}

/// The ordered candidates for [host], in the family's priority, with the family's names.
///
/// `isOnWifi` only caps how many expensive libp2p candidates are kept (3 on Wi‑Fi, 2 otherwise); the
/// app has no connectivity observer yet, so it takes the off-LAN cap. That cap still keeps the
/// circuit: a private direct address must not be the only peer-to-peer rung, or a phone that paired
/// on the LAN cannot reach the desktop from cellular. [DialBudget] at the call site is what bounds
/// the walk further.
///
/// `setCommunityHomePeerId` is process-wide state on the resolver (the family's own design). Setting
/// it here, on every resolve, is what stops one host's peer id being used to build another host's
/// relay candidate.
List<thin.HomeRemoteCandidate> candidatesFor(CoderHost host, {bool isOnWifi = false}) {
  final node = storedNodeFor(host);
  final peerId = node.homePeerId.trim();
  thin.CandidateResolver.setCommunityHomePeerId(peerId.isEmpty ? null : peerId);
  // `communityRelayRequiresPeerId: true`: the community relay routes by peer id, so for this app a
  // candidate without one is a dial at shared infrastructure with nothing to route to. The default
  // (a token-only fallback) is EnvoyGo's and is left alone.
  const resolver = thin.CandidateResolver(communityRelayRequiresPeerId: true);
  return resolver.resolve(node, sessionToken: host.token, isOnWifi: isOnWifi);
}
