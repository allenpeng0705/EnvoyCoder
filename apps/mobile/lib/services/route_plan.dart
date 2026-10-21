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
import 'lan_reachability.dart';

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
/// [isOnWifi] only caps how many expensive libp2p candidates the family keeps (3 on Wi‑Fi, 2
/// otherwise). It does **not** decide whether LAN is dialled.
///
/// [sameLan] gates **private** LAN addresses only. When false (5G, cafe Wi‑Fi, subnet mismatch):
///
///   * private `lan` WebSocket and private/loopback `p2p-direct` are dropped — not tried;
///   * a **public** address in the `lan` slot is kept (typed `host:port` over the internet);
///   * an **SSH** host keeps its `lan` rung even when private — the tunnel is what makes that
///     address reachable from off-LAN (`HostClient` opens the hop before the socket).
///
/// Trying unreachable private addresses is what black-holes the SYN and lets the upgrade sweep
/// retire a working circuit (green → orange).
///
/// [token] is the credential every candidate must carry, and it is a parameter rather than
/// `host.token` on purpose: the token this daemon issued (`PairingStore`) is the one that proves the
/// phone is already paired, and a caller that forgot to pass it would silently re-pair. Defaults to
/// the host's own token for the callers that have only a host record.
///
/// `setCommunityHomePeerId` is process-wide state on the resolver (the family's own design). Setting
/// it here, on every resolve, is what stops one host's peer id being used to build another host's
/// relay candidate.
List<thin.HomeRemoteCandidate> candidatesFor(
  CoderHost host, {
  bool isOnWifi = false,
  bool sameLan = false,
  String? token,
}) {
  final node = storedNodeFor(host);
  final peerId = node.homePeerId.trim();
  thin.CandidateResolver.setCommunityHomePeerId(peerId.isEmpty ? null : peerId);
  // `communityRelayRequiresPeerId: true`: the community relay routes by peer id, so for this app a
  // candidate without one is a dial at shared infrastructure with nothing to route to. The default
  // (a token-only fallback) is EnvoyGo's and is left alone.
  const resolver = thin.CandidateResolver(communityRelayRequiresPeerId: true);
  final resolved = resolver.resolve(node, sessionToken: token ?? host.token, isOnWifi: isOnWifi);
  if (sameLan) return resolved;
  final keepPrivateLanForSsh = host.ssh != null;
  return resolved.where((c) => _usableOffLan(c, keepPrivateLanForSsh: keepPrivateLanForSsh)).toList();
}

/// Rungs that can answer when the phone is not on the desktop's private LAN.
bool _usableOffLan(
  thin.HomeRemoteCandidate candidate, {
  required bool keepPrivateLanForSsh,
}) {
  if (candidate.name == 'lan') {
    if (keepPrivateLanForSsh) return true;
    // Drop only private/loopback targets; a public IP in this slot is a real off-LAN path.
    return !_wsUrlIsPrivateOrLoopback(candidate.url);
  }
  if (candidate.name.startsWith('p2p-direct') && _multiaddrIsLanOnly(candidate.url)) {
    return false;
  }
  return true;
}

bool _wsUrlIsPrivateOrLoopback(String url) {
  final host = ipv4HostOf(url);
  if (host == null) {
    // Hostname (e.g. `desk.local`): not provably public — treat as LAN-only off-site.
    return true;
  }
  if (host.startsWith('127.')) return true;
  final parts = host.split('.').map(int.parse).toList();
  final a = parts[0];
  final b = parts[1];
  if (a == 0 || a == 10) return true;
  if (a == 169 && b == 254) return true;
  if (a == 192 && b == 168) return true;
  if (a == 172 && b >= 16 && b <= 31) return true;
  if (a == 100 && b >= 64 && b <= 127) return true;
  return false;
}

bool _multiaddrIsLanOnly(String multiaddr) {
  if (multiaddr.startsWith('/ip4/127.') || multiaddr.startsWith('/ip6/::1/')) return true;
  final match =
      RegExp(r'^/ip4/(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}/').firstMatch(multiaddr);
  if (match == null) return false;
  final a = int.parse(match.group(1)!);
  final b = int.parse(match.group(2)!);
  if (a == 0 || a == 10 || a == 127) return true;
  if (a == 169 && b == 254) return true;
  if (a == 192 && b == 168) return true;
  if (a == 172 && b >= 16 && b <= 31) return true;
  if (a == 100 && b >= 64 && b <= 127) return true;
  return false;
}
