/// EnvoyDev for the phone.
///
/// The app opens on the **project list for the active host**. That is a change of shape from what it
/// was — a list of hosts, then the work on the selected one — and the owner asked for it: a phone
/// paired to one desktop should not pay a whole screen's worth of taps on every launch to reach the
/// work it was paired for. The host list is not gone; it is the **Connections** button in the top
/// bar, where it still answers "which machines can I reach, and how are they doing?".
///
/// What is *not* Paseo's is the transport: this app pairs with an EnvoyDev desktop the same way every
/// app in the EnvoyMesh family does (a shared pairing code, with the `app` claim keeping the family
/// apart), and reaches it over the mesh, a direct address, or an SSH hop.
///
/// ## Which host is active, and what happens when there are none
///
/// The rule is in `ConnectionsController.activeHost` and it is deliberately explicit, because a
/// silent default that moves between launches is worse than one the user chose:
///
///   * a stored "last used" id wins, and is only written when the user switches host or pairs a new
///     one — never as a side effect of reconnecting or of list order;
///   * otherwise the first host in the order it was paired;
///   * if the stored id names a host that has been forgotten, the first-host fallback applies and the
///     stale id is not trusted.
///
/// With **zero** hosts the shell renders [NoHostsScreen], not an empty project list: the empty state
/// names what is missing and leads to Add host, so there is no state in which the app shows nothing
/// and offers nothing.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import 'screens/connections_sheet.dart';
import 'screens/no_hosts_screen.dart';
import 'screens/project_list_screen.dart';
import 'screens/settings_screen.dart';
import 'models/harness.dart';
import 'services/connections_controller.dart';
import 'services/host_client.dart';
import 'services/host_pairing_flow.dart';
import 'services/host_store.dart';
import 'theme/tokens.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const EnvoyDevApp());
}

class EnvoyDevApp extends StatelessWidget {
  const EnvoyDevApp({super.key, this.store});

  /// Injected by tests; production builds the store themselves.
  final HostStore? store;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EnvoyDev',
      theme: const CoderTheme(CoderColors.light).toThemeData(),
      darkTheme: const CoderTheme(CoderColors.dark).toThemeData(),
      themeMode: ThemeMode.system,
      home: AppShell(store: store),
    );
  }
}

/// Owns the paired hosts and their clients, and decides what the app is showing.
///
/// The clients live here rather than in a screen for the same reason they used to live in the list:
/// every host has to keep reporting its health, including the ones that are not on screen, or the
/// Connections view would be a set of spinners. What changed is who reads them — now it is the shell
/// handing one of them to the project list.
class AppShell extends StatefulWidget {
  const AppShell({super.key, this.store});

  final HostStore? store;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  late final ConnectionsController _connections =
      ConnectionsController(widget.store ?? HostStore());

  /// What the last build put on screen — the loading flag, the active host, and its name — so
  /// [_onConnectionsChanged] can tell a real change from a connection heartbeat.
  ///
  /// The label is part of the comparison because a **rename is a visible change with no other
  /// signal**: the id does not move, no client reconnects, and without this the top bar would keep
  /// showing the old name until something unrelated rebuilt the shell.
  ({bool loading, String? hostId, String? label}) _shown =
      (loading: true, hostId: null, label: null);

  @override
  void initState() {
    super.initState();
    _connections.addListener(_onConnectionsChanged);
    unawaited(_connections.load());
  }

  /// Rebuild only when what the shell is showing changes.
  ///
  /// The controller also notifies on every connection-state change, and a project list already
  /// listens to its own client — rebuilding the whole shell (and re-running `ProjectListScreen`'s
  /// build) on every heartbeat would be work for no visible difference, and would throw away the
  /// search field's focus for nothing.
  ///
  /// The loading flag is part of the comparison, not an afterthought: with **zero hosts** the active
  /// host is null before the store is read and null after, so a gate on the host id alone would leave
  /// a phone with nothing on it staring at the spinner forever.
  void _onConnectionsChanged() {
    if (!mounted) return;
    final next = (
      loading: _connections.loading,
      hostId: _connections.activeHost?.id,
      label: _connections.activeHost?.label,
    );
    if (next == _shown) return;
    setState(() => _shown = next);
  }

  @override
  void dispose() {
    _connections.removeListener(_onConnectionsChanged);
    _connections.dispose();
    super.dispose();
  }

  Future<void> _addHost() async {
    final added = await addHostFlow(context, _connections.store);
    if (added == null) return;
    // `upsertHost` reconnects the client for a replaced host and makes the new one active, which is
    // what makes a just-paired desktop the one the user lands on.
    await _connections.upsertHost(added);
  }

  void _openSettings(HostClient client, List<HarnessInfo> harnesses) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SettingsScreen(client: client, harnesses: harnesses),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_connections.loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final host = _connections.activeHost;
    final client = _connections.activeClient;
    // Written here rather than in the listener's `setState`, so it stays the truth about what was
    // actually rendered even on the first build.
    _shown = (loading: false, hostId: host?.id, label: host?.label);
    if (host == null || client == null) {
      return NoHostsScreen(onAddHost: () => unawaited(_addHost()));
    }

    return ProjectListScreen(
      // A new key per host: switching machines starts a fresh screen with that host's own collapse
      // state and search, rather than reusing the old one's and briefly showing the wrong machine's
      // grouping.
      key: ValueKey(host.id),
      host: host,
      client: client,
      onOpenConnections: () => unawaited(showConnectionsSheet(context, _connections)),
      onAddHost: () => unawaited(_addHost()),
      onShowSettings: _openSettings,
    );
  }
}
