/// The networking status panel: why this phone is, or is not, reaching one desktop.
///
/// ## Where it lives, and why here
///
/// The **Connections sheet** is where the app already answers "which machine am I on, and how is it
/// doing?" — it carries the status dot and the `· via <route>` suffix. This is the answer to the next
/// question that sheet raises: *which route did it try, and where did it stop?* So it hangs off each
/// host row there, as its own full screen rather than a section in the sheet. The sheet is a
/// bottom sheet capped at half the screen with `mainAxisSize.min`, which is right for a list of three
/// computers and wrong for a ladder, four error strings and a peer id: the report needs to scroll and
/// needs a copy button, and a sheet that has to grow an inner scroll view to hold them stops being a
/// detour and becomes a bad page.
///
/// EnvoyGo's shape was the model (a status control that opens a sheet whose last line is the
/// developer detail); its widgets are not reused, and its screens are not copied. What was taken is
/// the *idea*: put the transport's own state on the device, where the person holding the phone can
/// read it, instead of inferring it from a spinner.
///
/// ## Two rules this screen holds to
///
///   1. **It never dials on open.** A diagnostics surface that changes the state it reports is worse
///      than none: the walk would start because the user looked, and the report would then describe
///      the screen's own activity. It renders what the client already knows; *Check again* is the
///      explicit action, and it is the only thing here that touches the radio.
///   2. **Unknown is said, not faked.** Where the app cannot read a value — the phone node's
///      connected-peer count is the one that matters — the row says `unavailable` and why. A `0`
///      there would be a claim about the radio that nothing observed (AGENTS.md #4).
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/l10n.dart';
import '../services/host_client.dart';
import '../services/libp2p_transport.dart';
import '../services/net_diagnostics.dart';
import '../theme/tokens.dart';

/// Open the panel for [client]'s host.
Future<void> showNetworkStatus(BuildContext context, HostClient client) {
  return Navigator.of(context).push(
    MaterialPageRoute<void>(builder: (_) => NetworkStatusScreen(client: client)),
  );
}

class NetworkStatusScreen extends StatefulWidget {
  const NetworkStatusScreen({super.key, required this.client, this.nodeSnapshot});

  final HostClient client;

  /// Where the phone-node section's values come from.
  ///
  /// Overridable for a widget test, which cannot construct the process-wide libp2p host this reads
  /// in production — and must not start one to render a report about it. The production path is the
  /// default and passes nothing.
  final NodeDiagnostics Function()? nodeSnapshot;

  @override
  State<NetworkStatusScreen> createState() => _NetworkStatusScreenState();
}

class _NetworkStatusScreenState extends State<NetworkStatusScreen> {
  StreamSubscription<HostConnectionState>? _states;
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    // The ladder fills in *while* a walk runs, so the panel redraws on every state change instead of
    // only when the user pulls to refresh. `states` is a broadcast stream and re-publishes the
    // current state when a route is upgraded, which is exactly the event that changes this screen.
    _states = widget.client.states.listen((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    unawaited(_states?.cancel());
    super.dispose();
  }

  /// Ask the desktop what it sees. The one action here that uses the radio.
  Future<void> _check() async {
    if (_checking) return;
    setState(() => _checking = true);
    try {
      await widget.client.probeHomeMesh();
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  Future<void> _copy() async {
    final report = _diagnostics().toReport();
    await Clipboard.setData(ClipboardData(text: report));
    if (!mounted) return;
    // Says what was copied and where it goes, because "Copied" alone leaves the user wondering
    // whether it was the address, the token, or the report.
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.l10n.networkCopied)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final diagnostics = _diagnostics();

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.networkTitle),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: CoderSpace.sm),
            child: Center(
              child: _checking
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : TextButton(
                      onPressed: _check,
                      child: Text(l10n.networkCheckAgain),
                    ),
            ),
          ),
          // Icon-only, so it carries a tooltip **and** a Semantics label — the repo's rule for a
          // control whose whole meaning is a glyph.
          Semantics(
            label: l10n.networkCopyReport,
            button: true,
            child: IconButton(
              tooltip: l10n.networkCopyReport,
              onPressed: _copy,
              icon: const Icon(Icons.copy_all_outlined),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _check,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(CoderSpace.lg, CoderSpace.md, CoderSpace.lg, CoderSpace.xl),
          children: [
            _headline(diagnostics, colors),
            const SizedBox(height: CoderSpace.lg),
            ..._pairingFields(diagnostics, colors),
            const SizedBox(height: CoderSpace.lg),
            ..._ladder(diagnostics, colors),
            const SizedBox(height: CoderSpace.lg),
            ..._lastRequest(diagnostics, colors),
            const SizedBox(height: CoderSpace.lg),
            ..._phoneNode(diagnostics, colors),
            const SizedBox(height: CoderSpace.lg),
            ..._desktopMesh(diagnostics, colors),
            const SizedBox(height: CoderSpace.lg),
            Text(
              l10n.networkTokenNote,
              style: TextStyle(color: colors.foregroundExtraMuted, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }

  /// The snapshot this screen renders, with the node section read from [widget.nodeSnapshot] when a
  /// test supplied one.
  NetDiagnostics _diagnostics() =>
      widget.client.diagnostics(node: (widget.nodeSnapshot ?? libp2pNodeDiagnostics)());

  // -- Sections -----------------------------------------------------------------

  Widget _headline(NetDiagnostics d, CoderColors colors) {
    final l10n = context.l10n;
    return _Panel(
      colors: colors,
      children: [
        Row(
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: _stateColor(widget.client.state, colors),
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: CoderSpace.md),
            Expanded(
              child: Text(
                // The live state in the user's language; `d.stateLabel` is the English the copyable
                // diagnostics report carries, not what a screen shows.
                widget.client.state.labelFor(l10n),
                style: TextStyle(color: colors.foreground, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
        const SizedBox(height: CoderSpace.sm),
        _line(l10n.networkComputer, '${d.host.label} (${d.host.endpoint})', colors),
        // "none" rather than a dash: no rung is in play, and naming the last one would be a guess.
        _line(l10n.networkActiveRoute, d.activeRoute ?? l10n.commonNone, colors),
        _line(l10n.networkApp, d.host.app, colors),
      ],
    );
  }

  List<Widget> _pairingFields(NetDiagnostics d, CoderColors colors) {
    final l10n = context.l10n;
    return [
      _SectionTitle(l10n.networkPairingHeading, colors),
      _Panel(
        colors: colors,
        children: [
          // Both fields or neither: `route_plan.dart` gates the peer-to-peer rung on the pair, so a
          // host that has one and not the other has no peer route either way.
          _line(l10n.networkDesktopPeerId, d.homePeerId.isEmpty ? l10n.commonNone : d.homePeerId, colors),
          _line(
            l10n.networkDialablePeers,
            '${d.bootstrapPeers.length}',
            colors,
          ),
          if (!d.hasP2pRoute) ...[
            const SizedBox(height: CoderSpace.sm),
            Text(
              l10n.networkPairingMissing,
              style: TextStyle(color: colors.statusWarning, fontSize: 12, height: 1.4),
            ),
          ],
        ],
      ),
    ];
  }

  List<Widget> _ladder(NetDiagnostics d, CoderColors colors) {
    final l10n = context.l10n;
    return [
      _SectionTitle(l10n.networkLadderHeading, colors),
      if (d.ladder.isEmpty)
        _Panel(
          colors: colors,
          children: [
            Text(
              d.planLimit == 0
                  ? l10n.networkLadderNoCandidatesYet
                  : l10n.networkLadderNoCandidates,
              style: TextStyle(color: colors.foregroundMuted, fontSize: 13, height: 1.4),
            ),
          ],
        )
      else
        _Panel(
          colors: colors,
          children: [
            for (var i = 0; i < d.ladder.length; i++) ...[
              if (i > 0) const SizedBox(height: CoderSpace.md2),
              _attemptRow(i + 1, d.ladder[i], colors),
            ],
            if (d.attemptedRungs < d.ladder.length) ...[
              const SizedBox(height: CoderSpace.md2),
              Text(
                l10n.networkLadderLimit(d.planLimit, d.ladder.length - d.attemptedRungs, d.ladder.length),
                style: TextStyle(color: colors.foregroundExtraMuted, fontSize: 12, height: 1.4),
              ),
            ],
          ],
        ),
    ];
  }

  Widget _attemptRow(int index, RouteAttempt attempt, CoderColors colors) {
    final l10n = context.l10n;
    final (label, color) = switch (attempt.status) {
      RouteAttemptStatus.connected => (l10n.networkAttemptConnected, colors.statusDotSuccess),
      RouteAttemptStatus.failed => (l10n.networkAttemptFailed, colors.statusDotDanger),
      RouteAttemptStatus.opened => (l10n.networkAttemptNoAnswer, colors.statusDotWarning),
      RouteAttemptStatus.trying => (l10n.networkAttemptDialling, colors.statusDotRunning),
      RouteAttemptStatus.skipped => (l10n.networkAttemptNotTried, colors.foregroundExtraMuted),
      RouteAttemptStatus.planned => (l10n.networkAttemptPlanned, colors.foregroundExtraMuted),
    };
    final ms = attempt.elapsedMs == null ? '' : ' · ${attempt.elapsedMs} ms';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$index. ', style: TextStyle(color: colors.foregroundMuted, fontSize: 13)),
            Expanded(
              child: Text(
                attempt.name,
                style: TextStyle(color: colors.foreground, fontSize: 13, fontWeight: FontWeight.w600),
              ),
            ),
            Text('$label$ms', style: TextStyle(color: color, fontSize: 12)),
          ],
        ),
        const SizedBox(height: CoderSpace.xs),
        Text(
          attempt.redactedUrl,
          style: TextStyle(
            color: colors.foregroundMuted,
            fontSize: 12,
            fontFamily: 'monospace',
            height: 1.3,
          ),
        ),
        // The reason only when there is one: an absent reason is not a reason.
        if (attempt.error != null) ...[
          const SizedBox(height: CoderSpace.xs),
          Text(
            attempt.error!,
            style: TextStyle(color: colors.statusDanger, fontSize: 12, height: 1.3),
          ),
        ],
      ],
    );
  }

  List<Widget> _lastRequest(NetDiagnostics d, CoderColors colors) {
    final l10n = context.l10n;
    final rpc = d.lastRpc;
    return [
      _SectionTitle(l10n.networkLastRequestHeading, colors),
      _Panel(
        colors: colors,
        children: [
          if (rpc == null)
            Text(
              l10n.networkNothingAsked,
              style: TextStyle(color: colors.foregroundMuted, fontSize: 13),
            )
          else ...[
            _line(l10n.networkMethod, rpc.method, colors),
            _line(l10n.networkOutcome, rpc.ok ? l10n.networkAnswered : l10n.networkAttemptFailed, colors,
                valueColor: rpc.ok ? colors.statusSuccess : colors.statusDanger),
            _line(l10n.networkTook, '${rpc.elapsedMs} ms', colors),
            if (rpc.error != null) ...[
              const SizedBox(height: CoderSpace.sm),
              SelectableText(
                rpc.error!,
                style: TextStyle(color: colors.statusDanger, fontSize: 12, height: 1.3),
              ),
            ],
          ],
          if (d.lastWalkError != null) ...[
            const SizedBox(height: CoderSpace.md2),
            Text(l10n.networkLastWalk, style: TextStyle(color: colors.foregroundMuted, fontSize: 12)),
            const SizedBox(height: CoderSpace.xs),
            SelectableText(
              d.lastWalkError!,
              style: TextStyle(color: colors.statusDanger, fontSize: 12, height: 1.3),
            ),
          ],
        ],
      ),
    ];
  }

  List<Widget> _phoneNode(NetDiagnostics d, CoderColors colors) {
    final l10n = context.l10n;
    final node = d.node;
    return [
      _SectionTitle(l10n.networkPhoneNodeHeading, colors),
      _Panel(
        colors: colors,
        children: [
          if (!node.started)
            Text(
              l10n.networkNodeNotStarted,
              style: TextStyle(color: colors.foregroundMuted, fontSize: 13, height: 1.4),
            )
          else ...[
            _line(l10n.networkPeerId, node.peerId ?? l10n.networkStarting, colors),
            _line(l10n.networkRelayDialling, node.relayEnabled ? l10n.networkEnabled : l10n.networkDisabled, colors),
            _line(l10n.networkRelayReservation, node.reservationLine, colors),
            // The honest one. See the library comment in `net_diagnostics.dart`.
            _line(l10n.networkConnectedPeers, l10n.networkConnectedPeersUnavailable, colors),
            _line(l10n.networkLanPeers, '${node.lanPeerCount}', colors),
            _line(l10n.networkMdns, node.mdnsActive ? l10n.networkActive : l10n.networkInactive, colors),
            _line(l10n.networkRegisteredProtocols, '${node.protocolCount}', colors),
            _line(l10n.networkHostGeneration, '${node.hostEpoch}', colors),
          ],
        ],
      ),
    ];
  }

  List<Widget> _desktopMesh(NetDiagnostics d, CoderColors colors) {
    final l10n = context.l10n;
    final mesh = d.homeMesh;
    return [
      _SectionTitle(l10n.networkDesktopMeshHeading, colors),
      _Panel(
        colors: colors,
        children: [
          if (d.homeMeshAt == null)
            Text(
              l10n.networkNotAsked,
              style: TextStyle(color: colors.foregroundMuted, fontSize: 13, height: 1.4),
            )
          else if (mesh == null)
            Text(
              l10n.networkNoUsableAnswer(d.homeMeshError ?? l10n.networkUnreadable),
              style: TextStyle(color: colors.statusDanger, fontSize: 13, height: 1.4),
            )
          else ...[
            _line(l10n.networkState, mesh.kind, colors),
            if (mesh.peerId != null) _line(l10n.networkItsPeerId, mesh.peerId!, colors),
            if (mesh.multiaddrCount != null)
              _line(l10n.networkItsDialable, '${mesh.multiaddrCount}', colors),
            if (mesh.relayHintCount != null)
              _line(l10n.networkItsRelayHints, '${mesh.relayHintCount}', colors),
            // Labelled with whose count it is: "peers" alone would read as this phone's, which this
            // app cannot read at all.
            if (mesh.peerCount != null)
              _line(l10n.networkPeersConnected, '${mesh.peerCount}', colors),
            if (mesh.reason != null) _line(l10n.networkItsReason, mesh.reason!, colors),
          ],
        ],
      ),
    ];
  }

  // -- Small pieces -------------------------------------------------------------

  Widget _line(String label, String value, CoderColors colors, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: CoderSpace.sm2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 132,
            child: Text(label, style: TextStyle(color: colors.foregroundMuted, fontSize: 12)),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: TextStyle(
                color: valueColor ?? colors.foreground,
                fontSize: 12,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _stateColor(HostConnectionState state, CoderColors colors) => switch (state) {
        HostConnectionState.connected => colors.statusDotSuccess,
        HostConnectionState.connecting => colors.statusDotRunning,
        HostConnectionState.reconnecting => colors.statusDotWarning,
        HostConnectionState.failed => colors.statusDotDanger,
        HostConnectionState.idle => colors.foregroundExtraMuted,
      };
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title, this.colors);

  final String title;
  final CoderColors colors;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: CoderSpace.sm2),
        child: Text(
          title,
          style: TextStyle(
            color: colors.foreground,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
}

class _Panel extends StatelessWidget {
  const _Panel({required this.colors, required this.children});

  final CoderColors colors;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(CoderSpace.md2),
        decoration: BoxDecoration(
          color: colors.surface1,
          border: Border.all(color: colors.border),
          borderRadius: BorderRadius.circular(CoderRadius.lg),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
      );
}
