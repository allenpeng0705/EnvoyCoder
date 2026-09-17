/// A paired EnvoyDev host, as the phone knows it.
///
/// Deliberately mirrors the desktop's `CoderHostDescriptor` (`@envoydev/protocol`), including the
/// **app** field: the phone can talk to several apps in the family, and a token minted for one must
/// not be presented to another.
library;

class CoderHost {
  const CoderHost({
    required this.id,
    required this.label,
    required this.endpoint,
    required this.ownerId,
    required this.app,
    required this.token,
    this.secure = false,
    this.ssh,
    this.lanWsUrl,
    this.homePeerId,
    this.relayPeerId,
    this.relayWsUrl,
    this.relayWsUrls,
    this.bootstrapPeers,
    this.lastSeenAt,
  });

  /// Stable id for the host list: owner + endpoint, so re-pairing updates rather than duplicates.
  final String id;
  final String label;
  final String endpoint;
  final String ownerId;

  /// Which app this host runs — always `EnvoyDev` for a code this app accepted.
  final String app;
  final String token;
  final bool secure;

  /// Set when the machine is reachable only through a hop.
  final SshHop? ssh;

  /// Preferable LAN WebSocket URL from the pairing code (`lanWsUrl`), when the desktop offered one.
  final String? lanWsUrl;

  /// **The desktop's own** libp2p peer id (`homeNodePeerId` in the shared pairing contract).
  ///
  /// This is not [relayPeerId], which names the relay: a direct/libp2p dial needs the far end's
  /// identity, and without it the direct-libp2p rung cannot be built at all. Null on every code
  /// minted before the desktop carried the field — which is why the rung is inert today.
  final String? homePeerId;

  /// The family's shared relay, carried from the pairing code. Not a per-product relay: a phone
  /// that is off-LAN reaches this machine the same way it reaches every other app in the group.
  final String? relayPeerId;
  final String? relayWsUrl;
  final List<String>? relayWsUrls;

  /// The desktop's dialable libp2p multiaddrs (`bootstrapPeers` in the shared pairing contract),
  /// relay-circuit addresses included when it holds a reservation. Paired with [homePeerId]: the id
  /// names the machine, these are what reach it. Empty or null keeps the libp2p rung out of the
  /// ladder entirely, rather than in it and failing.
  final List<String>? bootstrapPeers;
  final DateTime? lastSeenAt;

  Uri get wsUri => Uri.parse(
        '${secure ? 'wss' : 'ws'}://$endpoint/ws?token=${Uri.encodeComponent(token)}',
      );

  /// The daemon's own `/ws` address, **without** the token.
  ///
  /// What the family's resolver turns into its first rung: it appends the session token itself, so
  /// handing it a URL that already carries one produces a second `token=` parameter. The token is
  /// still in [wsUri] for callers that want a ready-to-dial URL.
  String get directWsUrl => '${secure ? 'wss' : 'ws'}://$endpoint/ws';

  CoderHost copyWith({
    String? label,
    SshHop? ssh,
    String? lanWsUrl,
    String? homePeerId,
    String? relayPeerId,
    String? relayWsUrl,
    List<String>? relayWsUrls,
    List<String>? bootstrapPeers,
    DateTime? lastSeenAt,
    String? token,
  }) =>
      CoderHost(
        id: id,
        label: label ?? this.label,
        endpoint: endpoint,
        ownerId: ownerId,
        app: app,
        token: token ?? this.token,
        secure: secure,
        ssh: ssh ?? this.ssh,
        lanWsUrl: lanWsUrl ?? this.lanWsUrl,
        homePeerId: homePeerId ?? this.homePeerId,
        relayPeerId: relayPeerId ?? this.relayPeerId,
        relayWsUrl: relayWsUrl ?? this.relayWsUrl,
        relayWsUrls: relayWsUrls ?? this.relayWsUrls,
        bootstrapPeers: bootstrapPeers ?? this.bootstrapPeers,
        lastSeenAt: lastSeenAt ?? this.lastSeenAt,
      );
}

/// An SSH hop to a machine that is not directly reachable.
class SshHop {
  const SshHop({
    required this.host,
    this.port = 22,
    this.user,
    this.password,
  });

  final String host;
  final int port;
  final String? user;

  /// Kept in memory / secure storage only — never written to shared preferences or logs.
  final String? password;

  /// The argv a desktop would run to open the tunnel. Kept here so the *plan* is testable on the
  /// phone even though the phone opens the tunnel in-process with dartssh2.
  List<String> tunnelArgs({required int localPort, required int remotePort}) => [
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'ServerAliveInterval=15',
        '-p',
        '$port',
        '-N',
        '-L',
        '$localPort:127.0.0.1:$remotePort',
        user == null ? host : '$user@$host',
      ];
}
