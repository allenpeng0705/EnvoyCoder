/// The first screen: which machines this phone can reach, and how each one is doing.
///
/// "How is it doing" is the point. Before any task list, the user needs to know whether the thing
/// they are about to look at is live, reconnecting, or unreachable — so the connection state is a
/// first-class column, not a spinner that disappears.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../models/host.dart';
import '../services/host_client.dart';
import '../services/host_store.dart';
import '../services/pairing_service.dart';
import '../theme/tokens.dart';
import 'add_host_sheet.dart';
import 'host_home_screen.dart';

/// Shown when a scanned code is refused — wording from `pairingAppMismatch`.
void showPairingRefusal(BuildContext context, String message) {
  showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('That code is for another app'),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK')),
      ],
    ),
  );
}

class HostListScreen extends StatefulWidget {
  const HostListScreen({super.key, this.store});

  final HostStore? store;

  @override
  State<HostListScreen> createState() => _HostListScreenState();
}

class _HostListScreenState extends State<HostListScreen> {
  late final HostStore _store = widget.store ?? HostStore();
  final List<CoderHost> _hosts = [];
  final Map<String, HostClient> _clients = {};
  final Map<String, HostConnectionState> _states = {};
  final Map<String, StreamSubscription<HostConnectionState>> _subs = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final hosts = await _store.load();
    if (!mounted) return;
    setState(() {
      _hosts
        ..clear()
        ..addAll(hosts);
      _loading = false;
    });
    for (final host in hosts) {
      _ensureClient(host);
    }
  }

  void _ensureClient(CoderHost host) {
    if (_clients.containsKey(host.id)) return;
    final client = HostClient(host);
    _clients[host.id] = client;
    _subs[host.id] = client.states.listen((state) {
      if (!mounted) return;
      setState(() => _states[host.id] = state);
    });
    setState(() => _states[host.id] = HostConnectionState.connecting);
    unawaited(client.connectBest());
  }

  Future<void> _openAddHost() async {
    final result = await showAddHostSheet(context);
    if (result == null || !mounted) return;
    if (result.code != null) {
      await _acceptCode(result.code!);
      return;
    }
    if (result.host != null) {
      await _saveAndConnect(result.host!);
    }
  }

  Future<void> _acceptCode(String code) async {
    final parsed = parsePairingCode(code);
    if (!parsed.ok) {
      if (!mounted) return;
      showPairingRefusal(context, parsed.refusal!);
      return;
    }
    await _saveAndConnect(parsed.host!);
  }

  Future<void> _saveAndConnect(CoderHost host) async {
    await _store.upsert(host);
    if (!mounted) return;
    setState(() {
      final idx = _hosts.indexWhere((h) => h.id == host.id);
      if (idx >= 0) {
        _hosts[idx] = host;
        _clients[host.id]?.dispose();
        _subs[host.id]?.cancel();
        _clients.remove(host.id);
        _subs.remove(host.id);
      } else {
        _hosts.add(host);
      }
    });
    _ensureClient(host);
  }

  Future<void> _openHost(CoderHost host) async {
    final client = _clients[host.id];
    if (client == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => HostHomeScreen(host: host, client: client),
      ),
    );
  }

  @override
  void dispose() {
    for (final sub in _subs.values) {
      unawaited(sub.cancel());
    }
    for (final client in _clients.values) {
      unawaited(client.dispose());
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('EnvoyDev')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openAddHost,
        icon: const Icon(Icons.add),
        label: const Text('Add host'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _hosts.isEmpty
              ? const _EmptyState()
              : ListView.builder(
                  itemCount: _hosts.length,
                  itemBuilder: (context, index) {
                    final host = _hosts[index];
                    final state = _states[host.id] ?? HostConnectionState.idle;
                    return ListTile(
                      leading: _stateDot(state, colors),
                      title: Text(host.label),
                      subtitle: Text('${host.endpoint} · ${_stateLabel(state)}${_routeSuffix(host)}'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _openHost(host),
                    );
                  },
                ),
    );
  }

  Widget _stateDot(HostConnectionState state, CoderColors colors) {
    final color = switch (state) {
      HostConnectionState.connected => colors.statusDotSuccess,
      HostConnectionState.connecting => colors.statusDotRunning,
      HostConnectionState.reconnecting => colors.statusDotWarning,
      HostConnectionState.failed => colors.statusDotDanger,
      HostConnectionState.idle => colors.foregroundExtraMuted,
    };
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }

  /// The route in use, appended to the row's detail.
  ///
  /// Naming the active connection rather than only its health is the one idea worth taking from
  /// Paseo's host page (a badge that says `Relay` / `Local` / `Remote SSH`) — a user who can see *how*
  /// they are connected can act on a slow link; "Connected" alone tells them nothing they can use.
  ///
  /// Empty until a dial has won, and empty again after a reconnect that went through `connect(url:)`
  /// outside the ladder: at that point no rung is in use, and naming one would be a guess. The label
  /// rebuilds with the state stream, which is what publishes the connect that set the route.
  String _routeSuffix(CoderHost host) {
    final route = _clients[host.id]?.activeRoute;
    return route == null ? '' : ' · via $route';
  }

  String _stateLabel(HostConnectionState state) => switch (state) {
        HostConnectionState.connected => 'Connected',
        HostConnectionState.connecting => 'Connecting',
        HostConnectionState.reconnecting => 'Reconnecting — your tasks are still running',
        HostConnectionState.failed => 'Unreachable',
        HostConnectionState.idle => 'Not connected yet',
      };
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.computer, size: 48),
            const SizedBox(height: 12),
            Text('No desktop paired yet', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            const Text(
              'On your computer, open EnvoyDev → Pair a phone, then scan the code. '
              'Your agents keep running whether or not the phone is connected.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
