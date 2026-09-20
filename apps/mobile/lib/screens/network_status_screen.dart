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
      const SnackBar(content: Text('Network report copied — paste it into the bug report.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    final diagnostics = _diagnostics();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Network status'),
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
                      child: const Text('Check again'),
                    ),
            ),
          ),
          // Icon-only, so it carries a tooltip **and** a Semantics label — the repo's rule for a
          // control whose whole meaning is a glyph.
          Semantics(
            label: 'Copy report',
            button: true,
            child: IconButton(
              tooltip: 'Copy report',
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
              'The pairing token is never shown here — it is a credential.',
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
                d.stateLabel,
                style: TextStyle(color: colors.foreground, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
        const SizedBox(height: CoderSpace.sm),
        _line('Computer', '${d.host.label} (${d.host.endpoint})', colors),
        // "none" rather than a dash: no rung is in play, and naming the last one would be a guess.
        _line('Active route', d.activeRoute ?? 'none', colors),
        _line('App', d.host.app, colors),
      ],
    );
  }

  List<Widget> _pairingFields(NetDiagnostics d, CoderColors colors) {
    return [
      _SectionTitle('What the pairing gave us', colors),
      _Panel(
        colors: colors,
        children: [
          // Both fields or neither: `route_plan.dart` gates the peer-to-peer rung on the pair, so a
          // host that has one and not the other has no peer route either way.
          _line('Desktop peer id', d.homePeerId.isEmpty ? 'none' : d.homePeerId, colors),
          _line(
            'Dialable peer addresses',
            '${d.bootstrapPeers.length}',
            colors,
          ),
          if (!d.hasP2pRoute) ...[
            const SizedBox(height: CoderSpace.sm),
            Text(
              'Both are needed for the peer-to-peer route, so this host has none. A pairing made '
              'before the desktop carried these fields has neither — the phone is left with the '
              'direct address and the relay.',
              style: TextStyle(color: colors.statusWarning, fontSize: 12, height: 1.4),
            ),
          ],
        ],
      ),
    ];
  }

  List<Widget> _ladder(NetDiagnostics d, CoderColors colors) {
    return [
      _SectionTitle('How this computer was tried', colors),
      if (d.ladder.isEmpty)
        _Panel(
          colors: colors,
          children: [
            Text(
              d.planLimit == 0
                  ? 'No candidates yet — nothing has been dialled for this computer.'
                  : 'This pass produced no candidates: the walk is held back under dial pressure, '
                      'or the pairing names no address at all.',
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
                'This pass dials at most ${d.planLimit}: '
                '${d.ladder.length - d.attemptedRungs} of ${d.ladder.length} wait for the next pass.',
                style: TextStyle(color: colors.foregroundExtraMuted, fontSize: 12, height: 1.4),
              ),
            ],
          ],
        ),
    ];
  }

  Widget _attemptRow(int index, RouteAttempt attempt, CoderColors colors) {
    final (label, color) = switch (attempt.status) {
      RouteAttemptStatus.connected => ('connected', colors.statusDotSuccess),
      RouteAttemptStatus.failed => ('failed', colors.statusDotDanger),
      RouteAttemptStatus.opened => ('no answer', colors.statusDotWarning),
      RouteAttemptStatus.trying => ('dialling', colors.statusDotRunning),
      RouteAttemptStatus.skipped => ('not tried', colors.foregroundExtraMuted),
      RouteAttemptStatus.planned => ('planned', colors.foregroundExtraMuted),
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
    final rpc = d.lastRpc;
    return [
      _SectionTitle('Last request to the desktop', colors),
      _Panel(
        colors: colors,
        children: [
          if (rpc == null)
            Text(
              'Nothing has been asked yet since the app started.',
              style: TextStyle(color: colors.foregroundMuted, fontSize: 13),
            )
          else ...[
            _line('Method', rpc.method, colors),
            _line('Outcome', rpc.ok ? 'answered' : 'failed', colors,
                valueColor: rpc.ok ? colors.statusSuccess : colors.statusDanger),
            _line('Took', '${rpc.elapsedMs} ms', colors),
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
            Text('Last walk', style: TextStyle(color: colors.foregroundMuted, fontSize: 12)),
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
    final node = d.node;
    return [
      _SectionTitle('This phone\'s libp2p node', colors),
      _Panel(
        colors: colors,
        children: [
          if (!node.started)
            Text(
              'Not started — no peer-to-peer route has been dialled in this launch. It starts on '
              'the first such dial, and looking at this screen does not start it.',
              style: TextStyle(color: colors.foregroundMuted, fontSize: 13, height: 1.4),
            )
          else ...[
            _line('Peer id', node.peerId ?? 'starting', colors),
            _line('Relay dialling', node.relayEnabled ? 'enabled' : 'disabled', colors),
            _line('Relay reservation', node.reservationLine, colors),
            // The honest one. See the library comment in `net_diagnostics.dart`.
            _line('Connected peers', 'unavailable — the shared node exposes no connection view',
                colors),
            _line('LAN peers seen', '${node.lanPeerCount}', colors),
            _line('mDNS', node.mdnsActive ? 'active' : 'inactive', colors),
            _line('Registered protocols', '${node.protocolCount}', colors),
            _line('Host generation', '${node.hostEpoch}', colors),
          ],
        ],
      ),
    ];
  }

  List<Widget> _desktopMesh(NetDiagnostics d, CoderColors colors) {
    final mesh = d.homeMesh;
    return [
      _SectionTitle('What the desktop says about itself', colors),
      _Panel(
        colors: colors,
        children: [
          if (d.homeMeshAt == null)
            Text(
              'Not asked yet. "Check again" asks the desktop for its own mesh status — the '
              'difference between "this phone cannot reach it" and "it has nothing to reach".',
              style: TextStyle(color: colors.foregroundMuted, fontSize: 13, height: 1.4),
            )
          else if (mesh == null)
            Text(
              'No usable answer: ${d.homeMeshError ?? 'unreadable'}',
              style: TextStyle(color: colors.statusDanger, fontSize: 13, height: 1.4),
            )
          else ...[
            _line('State', mesh.kind, colors),
            if (mesh.peerId != null) _line('Its peer id', mesh.peerId!, colors),
            if (mesh.multiaddrCount != null)
              _line('Its dialable addresses', '${mesh.multiaddrCount}', colors),
            if (mesh.relayHintCount != null)
              _line('Its relay hints', '${mesh.relayHintCount}', colors),
            // Labelled with whose count it is: "peers" alone would read as this phone's, which this
            // app cannot read at all.
            if (mesh.peerCount != null)
              _line('Peers it is connected to', '${mesh.peerCount}', colors),
            if (mesh.reason != null) _line('Its reason', mesh.reason!, colors),
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
