/// EnvoyDev for the phone.
///
/// The app opens on the **project list for the active host**. That is a change of shape from what it
/// was — a list of hosts, then the work on the selected one — and the owner asked for it: a phone
/// paired to one desktop should not pay a whole screen's worth of taps on every launch to reach the
/// work it was paired for. The host list is not gone; it is what the top bar's **connection name**
/// opens when tapped, where it still answers "which machines can I reach, and how are they doing?".
/// The cell tower beside the name is the *other* half: its colour is the active connection's health,
/// and tapping it opens the network-status ladder.
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
///   * a stored "last used" id wins. It is written when the user switches host, when a fresh pairing
///     lands, and when the host already on screen **connects** — so "last used" means the last
///     machine actually reached, while a failed dial leaves the id alone. None of those writes moves
///     the current screen; they only decide what the next launch opens;
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

import 'l10n/l10n.dart';
import 'l10n/locale_controller.dart';
import 'screens/connections_sheet.dart';
import 'screens/network_status_screen.dart';
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

class EnvoyDevApp extends StatefulWidget {
  const EnvoyDevApp({super.key, this.store, this.localeController});

  /// Injected by tests; production builds the store themselves.
  final HostStore? store;

  /// The phone's language preference. Injected by tests so a locale can be pinned without touching
  /// `SharedPreferences`; production builds one and loads what was stored.
  final LocaleController? localeController;

  @override
  State<EnvoyDevApp> createState() => _EnvoyDevAppState();
}

class _EnvoyDevAppState extends State<EnvoyDevApp> {
  late final LocaleController _locales = widget.localeController ?? LocaleController();

  @override
  void initState() {
    super.initState();
    unawaited(_locales.load());
  }

  @override
  void dispose() {
    // An injected controller belongs to whoever injected it (a test that asserts on it afterwards),
    // so only the one this state created is disposed here.
    if (widget.localeController == null) _locales.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Rebuilds the whole app when the language changes, which is the one setting that must take
    // effect without a restart.
    return AnimatedBuilder(
      animation: _locales,
      builder: (context, _) => MaterialApp(
        // Not `title:` — that is fixed at construction and would keep the English brand string in
        // the task switcher after a language change. `onGenerateTitle` asks the live catalogue.
        onGenerateTitle: (context) => context.l10n.appName,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        // `null` = follow the phone; a code = the language Settings picked.
        locale: _locales.locale,
        // The explicit English fallback for a system language we do not ship (see `l10n.dart`).
        localeResolutionCallback: resolveAppLocale,
        theme: const CoderTheme(CoderColors.light).toThemeData(),
        darkTheme: const CoderTheme(CoderColors.dark).toThemeData(),
        themeMode: ThemeMode.system,
        home: AppShell(store: widget.store, localeController: _locales),
      ),
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
  const AppShell({super.key, this.store, required this.localeController});

  final HostStore? store;

  /// Handed to [SettingsScreen], which is the only surface that changes the language.
  final LocaleController localeController;

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
        builder: (_) => SettingsScreen(
          client: client,
          harnesses: harnesses,
          localeController: widget.localeController,
        ),
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
      // The ladder for the host the app is on. It is the *active* client's panel because the top
      // bar's icon reports the active host's state — a diagnostics surface for a machine the user is
      // not on would be about a different fact than the colour they just tapped.
      onOpenNetworkStatus: () => unawaited(showNetworkStatus(context, client)),
      // `onAddHost` no longer travels to this screen: the top bar's Add-host shortcut is gone, and
      // pairing is reached from the Connections sheet the name opens. `_addHost` itself stays — the
      // zero-host screen still needs it.
      onShowSettings: _openSettings,
    );
  }
}
