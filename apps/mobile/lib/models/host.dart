/// A paired EnvoyCoder host, as the phone knows it.
///
/// Deliberately mirrors the desktop's `CoderHostDescriptor` (`@envoycoder/protocol`), including the
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
    this.relayPeerId,
    this.relayWsUrl,
    this.lastSeenAt,
  });

  /// Stable id for the host list: owner + endpoint, so re-pairing updates rather than duplicates.
  final String id;
  final String label;
  final String endpoint;
  final String ownerId;

  /// Which app this host runs — always `EnvoyCoder` for a code this app accepted.
  final String app;
  final String token;
  final bool secure;

  /// Set when the machine is reachable only through a hop.
  final SshHop? ssh;

  /// The family's shared relay, carried from the pairing code. Not a per-product relay: a phone
  /// that is off-LAN reaches this machine the same way it reaches every other app in the group.
  final String? relayPeerId;
  final String? relayWsUrl;
  final DateTime? lastSeenAt;

  Uri get wsUri => Uri.parse(
        '${secure ? 'wss' : 'ws'}://$endpoint/ws?token=${Uri.encodeComponent(token)}',
      );

  CoderHost copyWith({String? label, DateTime? lastSeenAt}) => CoderHost(
        id: id,
        label: label ?? this.label,
        endpoint: endpoint,
        ownerId: ownerId,
        app: app,
        token: token,
        secure: secure,
        ssh: ssh,
        relayPeerId: relayPeerId,
        relayWsUrl: relayWsUrl,
        lastSeenAt: lastSeenAt ?? this.lastSeenAt,
      );
}

/// An SSH hop to a machine that is not directly reachable.
class SshHop {
  const SshHop({required this.host, this.port = 22, this.user});

  final String host;
  final int port;
  final String? user;

  /// The argv a desktop would run to open the tunnel. Kept here so the *plan* is testable on the
  /// phone even though the phone cannot spawn it — the mobile app asks the desktop to forward, and
  /// the desktop uses exactly these arguments (`@envoycoder/platform` builds them for real).
  List<String> tunnelArgs({required int localPort, required int remotePort}) => [
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=15',
        '-p', '$port',
        '-N',
        '-L', '$localPort:127.0.0.1:$remotePort',
        user == null ? host : '$user@$host',
      ];
}
