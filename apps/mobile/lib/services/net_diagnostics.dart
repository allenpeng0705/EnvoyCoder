/// The link's vocabulary, and the plain-text report the network-status screen copies out.
///
/// ## What this file is
///
/// `host_client.dart` records *what happened to each candidate* the family's walk dialled; those
/// records are [RouteAttempt]s. This file holds them, the last RPC's outcome, the family node's
/// snapshot and the desktop's own `coder.meshStatus` answer, and turns the lot into the text the
/// owner pastes into a bug report.
///
/// It answers the four questions a failed connection raises, in the order a reader asks them:
///
///   1. **What did the pairing give us?** — `homePeerId` and `bootstrapPeers`, the two fields the
///      peer-to-peer rung is gated on. A host paired before the desktop carried them has neither,
///      and that alone removes every off-LAN route but the relay.
///   2. **Which routes were produced, in which order, and what happened to each?** — the whole
///      ladder, not just the `· via <route>` suffix the Connections sheet already shows.
///   3. **What is the phone's own libp2p node doing?** — peer id, relay state, and an honest
///      `unavailable` where the family host exposes nothing to read.
///   4. **What was the last request, and how did it end?** — method, success, elapsed time, error.
///      This is the field that would have answered the "connecting, but no projects" report
///      instantly: a walk that never reached the daemon and a walk that reached it and was refused
///      look identical from the outside until one of them is written down.
///
/// ## Why it does not import `host_client.dart`
///
/// `host_client.dart` imports *this* file, so importing it back would make an import cycle. The
/// connection state therefore arrives as an already-rendered [stateLabel] rather than as a
/// `HostConnectionState`; `host_client.dart` owns that enum and `HostConnectionStateText.label` is
/// the one place it becomes end-user language (AGENTS.md #5 — headline first, developer fields
/// last).
///
/// ## Never invent a number
///
/// Whatever this surface cannot read, it says it cannot read. The case that matters today: the
/// family's `Libp2pNode` exposes no view of its swarm's connection set, so *connected peers* (the
/// phone's own) is `unavailable` here, while the desktop's count — a different number, from a
/// different machine — is shown separately and labelled as the desktop's. A plausible-looking `0`
/// would be a claim about the radio that nothing in this app observed (AGENTS.md #4).
library;

import 'package:envoy_thin_client/envoy_thin_client.dart';

import '../models/host.dart';
import 'libp2p_transport.dart';

/// How one rung of the walk ended.
///
/// [opened] is deliberately distinct from [connected]: a transport that was created but never saw
/// the home's `connected` event is precisely the failure that used to be invisible, and collapsing
/// it into [failed] would lose the distinction between "nothing answered" and "something answered
/// but was not the home".
enum RouteAttemptStatus { planned, trying, opened, connected, failed, skipped }

/// One rung of the family's ladder, and what this app observed of it.
class RouteAttempt {
  const RouteAttempt({
    required this.name,
    required this.redactedUrl,
    this.status = RouteAttemptStatus.planned,
    this.error,
    this.elapsedMs,
  });

  /// The family's own name for the rung (`lan`, `public`, `p2p-direct`, `p2p-circuit`, `relay`, …).
  ///
  /// Not renamed for the user: the ladder's names are `CandidateResolver`'s, and a second set of
  /// names here would mean a rung's report and its code disagreed.
  final String name;

  /// The candidate's address, with every secret query value already replaced by `<redacted>`.
  ///
  /// Redacted at capture time rather than at render time: a token that is never put into an object
  /// cannot be leaked by a later `toString()`, a log, or a crash dump.
  final String redactedUrl;

  final RouteAttemptStatus status;

  /// The exact failure text when one was observed. Null when nothing was.
  final String? error;

  /// How long the attempt took, when it was measured.
  final int? elapsedMs;

  /// True when this walk actually dialled it (a rung beyond the budget was never tried).
  bool get attempted =>
      status != RouteAttemptStatus.planned && status != RouteAttemptStatus.skipped;

  RouteAttempt copyWith({
    RouteAttemptStatus? status,
    String? error,
    bool clearError = false,
    int? elapsedMs,
  }) =>
      RouteAttempt(
        name: name,
        redactedUrl: redactedUrl,
        status: status ?? this.status,
        error: clearError ? null : (error ?? this.error),
        elapsedMs: elapsedMs ?? this.elapsedMs,
      );
}

/// The last JSON-RPC this app sent to the daemon, and how it ended.
class RpcOutcome {
  const RpcOutcome({
    required this.method,
    required this.ok,
    required this.elapsedMs,
    this.error,
  });

  final String method;
  final bool ok;
  final int elapsedMs;

  /// The daemon's refusal or the transport's error, redacted. Null when [ok].
  final String? error;
}

/// The desktop's answer to `coder.meshStatus` — its own view of the mesh, not this phone's.
///
/// Kept as an untyped [kind] plus optional fields rather than an enum, because the wire shape is a
/// discriminated union the daemon may grow a variant of (`packages/protocol/src/rpc.ts`,
/// `CoderMeshStatusSchema`), and a client that refused to render an unknown `kind` would report an
/// outage where there is only a newer desktop.
class HomeMeshSnapshot {
  const HomeMeshSnapshot({
    required this.kind,
    this.peerId,
    this.multiaddrCount,
    this.relayHintCount,
    this.peerCount,
    this.reason,
  });

  /// `hosting` | `attached` | `no-node` | `refused` today; treated as data, not as a closed set.
  final String kind;
  final String? peerId;
  final int? multiaddrCount;
  final int? relayHintCount;

  /// How many peers **the desktop** reports connected. Not this phone's count — those are not
  /// obtainable on this side (see the library comment).
  final int? peerCount;
  final String? reason;

  /// Parse the `mesh` field, or null when the answer is not a shape this surface can render.
  ///
  /// Null is the honest result of "the daemon answered something else": the caller turns it into a
  /// sentence rather than into zeroes.
  static HomeMeshSnapshot? fromRpc(Object? mesh) {
    if (mesh is! Map) return null;
    final kind = mesh['kind'];
    if (kind is! String || kind.isEmpty) return null;
    int? count(Object? value) => value is num ? value.toInt() : null;
    final multiaddrs = mesh['multiaddrs'];
    final relayHints = mesh['relayHints'];
    return HomeMeshSnapshot(
      kind: kind,
      peerId: mesh['peerId'] is String ? mesh['peerId'] as String : null,
      multiaddrCount: multiaddrs is List ? multiaddrs.length : null,
      relayHintCount: relayHints is List ? relayHints.length : null,
      peerCount: count(mesh['peerCount']),
      reason: mesh['reason'] is String ? mesh['reason'] as String : null,
    );
  }
}

/// Everything the network-status surface knows about one host's link, at one moment.
///
/// Assembled by [HostClient.diagnostics] from that client's own records plus a read-only peek at the
/// process-wide libp2p node. Immutable: a screen keeps one of these while it renders, so a walk
/// finishing mid-frame cannot make the report disagree with itself.
class NetDiagnostics {
  const NetDiagnostics({
    required this.host,
    required this.stateLabel,
    required this.activeRoute,
    required this.ladder,
    required this.planLimit,
    this.lastWalkError,
    this.lastWalkAt,
    this.lastRpc,
    required this.node,
    this.homeMesh,
    this.homeMeshError,
    this.homeMeshAt,
    this.reportedAt,
  });

  final CoderHost host;

  /// The connection state in end-user language (`HostConnectionStateText.label`).
  final String stateLabel;

  /// The rung currently carrying the connection, or null when none is.
  final String? activeRoute;

  /// Every candidate the family produced for this host, in the family's priority order.
  final List<RouteAttempt> ladder;

  /// How many rungs one pass may dial (`DialBudget.maxAttemptsPerWalk`). Rungs past it are [skipped].
  final int planLimit;

  final String? lastWalkError;
  final DateTime? lastWalkAt;
  final RpcOutcome? lastRpc;

  /// This phone's shared libp2p node, as it is right now.
  final NodeDiagnostics node;

  final HomeMeshSnapshot? homeMesh;
  final String? homeMeshError;
  final DateTime? homeMeshAt;
  final DateTime? reportedAt;

  /// The home's own peer id from the pairing code, or empty when the code did not carry one.
  String get homePeerId => (host.homePeerId ?? '').trim();

  List<String> get bootstrapPeers =>
      (host.bootstrapPeers ?? const <String>[]).where((p) => p.trim().isNotEmpty).toList();

  /// Whether the peer-to-peer rung can be built at all.
  ///
  /// Both fields or neither: `route_plan.dart` gates the rung on the pair, matching what the family's
  /// resolver needs to dial a *named* address rather than guess one.
  bool get hasP2pRoute => homePeerId.isNotEmpty && bootstrapPeers.isNotEmpty;

  int get attemptedRungs => ladder.where((a) => a.attempted).length;

  /// The report the owner pastes. Plain text, no markdown, no ANSI.
  ///
  /// The whole thing goes through [redactSecretQueryValues] on the way out as a second line of
  /// defence: every URL and error string that reaches here was already redacted at capture time,
  /// and a single funnel means a future field that carries a URL by accident still cannot carry a
  /// token out of the app.
  String toReport() {
    final at = reportedAt ?? DateTime.now();
    final b = StringBuffer()
      ..writeln('EnvoyDev network status')
      ..writeln('Reported: ${at.toIso8601String()}')
      ..writeln('Computer: ${host.label} (${host.endpoint})')
      ..writeln('State: $stateLabel')
      ..writeln('Active route: ${activeRoute ?? 'none'}')
      ..writeln();

    _pairingFields(b);
    _ladder(b);
    _lastRequest(b);
    _phoneNode(b);
    _desktopMesh(b);

    b.writeln('Pairing token: not shown — it is a credential.');
    return redactSecretQueryValues(b.toString());
  }

  void _pairingFields(StringBuffer b) {
    b.writeln('Pairing fields the peer-to-peer route needs');
    b.writeln('  homePeerId: ${homePeerId.isEmpty ? 'none' : homePeerId}');
    b.writeln('  bootstrapPeers: ${bootstrapPeers.length} '
        '${bootstrapPeers.length == 1 ? 'address' : 'addresses'}');
    if (!hasP2pRoute) {
      b
        ..writeln('  ! Both are required, so no peer-to-peer route can be built for this host.')
        ..writeln('    A pairing made before the desktop carried these fields has neither, and')
        ..writeln('    the phone is left with the direct address and the relay.');
    }
    b.writeln();
  }

  void _ladder(StringBuffer b) {
    b.writeln('How this computer was tried (the family\'s own priority order)');
    if (ladder.isEmpty) {
      b.writeln('  no candidates — this walk produced none (held back under dial pressure, or the');
      b.writeln('  pairing names no address at all)');
      b.writeln();
      return;
    }
    if (attemptedRungs < ladder.length) {
      b.writeln('  this pass may dial $planLimit '
          '${planLimit == 1 ? 'rung' : 'rungs'}; '
          '${ladder.length - attemptedRungs} of ${ladder.length} were left for the next pass');
    }
    var index = 1;
    for (final attempt in ladder) {
      b.writeln('  $index. ${attempt.name} — ${attempt.redactedUrl}');
      b.writeln('       ${_attemptLine(attempt)}');
      index += 1;
    }
    b.writeln();
  }

  /// One rung's outcome in a sentence, with no cause this app did not observe.
  String _attemptLine(RouteAttempt attempt) {
    final ms = attempt.elapsedMs == null ? '' : ' after ${attempt.elapsedMs} ms';
    return switch (attempt.status) {
      RouteAttemptStatus.connected => 'connected — this is the rung in use$ms',
      RouteAttemptStatus.failed =>
        'failed$ms${attempt.error == null ? '' : ' — ${attempt.error}'}',
      RouteAttemptStatus.opened =>
        'a transport opened$ms, but the home never reported connected',
      RouteAttemptStatus.trying => 'still being dialled',
      RouteAttemptStatus.skipped => 'not tried — past this walk\'s limit',
      RouteAttemptStatus.planned => 'not tried yet',
    };
  }

  void _lastRequest(StringBuffer b) {
    b.writeln('Last request to the desktop');
    final rpc = lastRpc;
    if (rpc == null) {
      b.writeln('  none yet since the app started');
    } else if (rpc.ok) {
      b.writeln('  ${rpc.method} — answered in ${rpc.elapsedMs} ms');
    } else {
      b.writeln('  ${rpc.method} — failed after ${rpc.elapsedMs} ms');
      if (rpc.error != null) b.writeln('  ${rpc.error}');
    }
    if (lastWalkError != null) {
      final when = lastWalkAt == null ? '' : ' at ${lastWalkAt!.toIso8601String()}';
      b.writeln('  last walk: failed$when — $lastWalkError');
    }
    b.writeln();
  }

  void _phoneNode(StringBuffer b) {
    b.writeln('This phone\'s libp2p node (the family\'s shared Libp2pNode)');
    if (!node.started) {
      b.writeln('  not started — no peer-to-peer rung has been dialled yet');
      b.writeln();
      return;
    }
    b
      ..writeln('  peer id: ${node.peerId ?? 'starting'}')
      ..writeln('  relay client (circuit dialling): '
          '${node.relayEnabled ? 'enabled' : 'disabled'}')
      ..writeln('  relay reservation: ${node.reservationLine}')
      // The one value this app cannot read, said plainly rather than shown as 0.
      ..writeln('  connected peers: unavailable — the shared node exposes no view of its '
          'connection set')
      ..writeln('  LAN peers seen: ${node.lanPeerCount} · mDNS: '
          '${node.mdnsActive ? 'active' : 'inactive'}')
      ..writeln('  registered protocols: ${node.protocolCount} · host generation: '
          '${node.hostEpoch} · TCP listen: ${node.hasTcpListen ? 'yes' : 'no'}');
    b.writeln();
  }

  void _desktopMesh(StringBuffer b) {
    b.writeln('The desktop\'s own view of the mesh (coder.meshStatus)');
    if (homeMeshAt == null) {
      b.writeln('  not asked yet — "Check again" asks the desktop what it sees');
      b.writeln();
      return;
    }
    final mesh = homeMesh;
    if (mesh == null) {
      b.writeln('  answered: no — ${homeMeshError ?? 'an unreadable answer'}');
      b.writeln();
      return;
    }
    final detail = <String>[
      'kind: ${mesh.kind}',
      if (mesh.peerId != null) 'peer id: ${mesh.peerId}',
      if (mesh.multiaddrCount != null) 'dialable addresses: ${mesh.multiaddrCount}',
      if (mesh.relayHintCount != null) 'relay hints: ${mesh.relayHintCount}',
      if (mesh.peerCount != null) 'peers the desktop sees: ${mesh.peerCount}',
      if (mesh.reason != null) 'reason: ${mesh.reason}',
    ];
    b
      ..writeln('  ${detail.join(' · ')}')
      ..writeln('  asked at ${homeMeshAt!.toIso8601String()}');
    b.writeln();
  }
}
