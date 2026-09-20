/// Which machine the app is on, and how each of them is doing.
///
/// This is `HostListScreen`'s state — one `HostClient` per paired host, kept alive so every host's
/// status is live — lifted out of a screen and into a controller the app shell owns. It moved
/// because the project list for the *active* host is now the entry point, and a project list needs
/// the client before it can exist; the connection list is no longer a page you navigate to, so it
/// can no longer be the thing that owns the clients.
///
/// ## The active-host rule, stated once
///
///   1. If the user has switched host before, the stored id wins (`HostStore.saveActiveHostId`).
///   2. Otherwise the first host in stored order — the order the user paired them in.
///   3. If the stored id names a host that is gone, the same fallback applies, and the stale id is
///      not trusted: an id that matches nothing is treated exactly like no id at all.
///
/// ## Selected vs used — two reasons to write one field
///
/// The stored id answers exactly one question: *which machine does the next launch open on?* It is
/// written for two reasons, and keeping them apart is the whole point:
///
///   * **Selected.** [setActive] (the Connections sheet) and [upsertHost] (a fresh pairing) write it
///     when the user makes the host on screen change. Nothing may write it as a side effect of a
///     reconnect, a list reorder or a run event — the screen must not move under the user, and an id
///     that moved on its own would move it between launches instead.
///   * **Used.** [_persistUsed] writes it when the host **already on screen** reaches
///     [HostConnectionState.connected]. "Last used" is a fact about a successful link, not about a
///     tap: a pairing that is never reached, or one flaky attempt that fails, must not become the
///     machine the app opens with. This write is about the *next* launch only — it never notifies,
///     never reorders [_hosts] and never touches [_activeId] — so it cannot move the current screen.
///
/// The two share one field deliberately: the app opens on the machine the user last chose or last
/// actually reached, and there is no tension to resolve at launch. A background host is not
/// remembered by [_persistUsed] even when it connects, so an unreachable active host is still what
/// the next launch selects — its status icon shows it failing rather than the app silently opening a
/// different desktop.
///
/// Every path that changes which host is active goes through here, and each one persists *that*
/// change. The screen therefore never changes under the user because a connect finished, a list
/// reordered, or a run event arrived — only because the user chose, or because the chosen host was
/// forgotten.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/host.dart';
import 'host_client.dart';
import 'host_store.dart';
import 'pairing_store.dart';

class ConnectionsController extends ChangeNotifier {
  ConnectionsController(this.store, {PairingStore? pairings})
      : pairings = pairings ?? PairingStore();

  final HostStore store;

  /// The pairings this phone holds, keyed by daemon identity.
  ///
  /// Owned here so one store serves every client: the pairing a Settings screen reads is the record
  /// the dial offered, which is the property that makes "already paired" mean something. A second
  /// instance would still work — the store is stateless apart from a per-launch memo — but the two
  /// would disagree about a record cleared a moment ago.
  final PairingStore pairings;

  final List<CoderHost> _hosts = [];
  final Map<String, HostClient> _clients = {};
  final Map<String, HostConnectionState> _states = {};
  final Map<String, StreamSubscription<HostConnectionState>> _subs = {};

  String? _activeId;

  /// What this controller last read or wrote as the stored id, so a host that reconnects on every
  /// heartbeat does not rewrite the same string to disk. Mirrors `HostStore.loadActiveHostId` at
  /// [load], and every writer below keeps it in step.
  String? _persistedUsedId;
  bool _loading = true;
  bool _disposed = false;

  List<CoderHost> get hosts => List.unmodifiable(_hosts);
  bool get loading => _loading;

  /// Let a test supply a client whose dialer is a fake, so screens can be pumped without a radio.
  @visibleForTesting
  HostClient Function(CoderHost host)? clientFactory;

  HostConnectionState stateOf(String hostId) =>
      _states[hostId] ?? HostConnectionState.idle;

  /// The rung a host's client is actually using, for the row's detail. Null until a dial wins.
  String? routeOf(String hostId) => _clients[hostId]?.activeRoute;

  /// Whether [hostId]'s daemon has refused the pairing this phone holds for it.
  ///
  /// Read live from the client rather than mirrored into a map: the client publishes a state change
  /// the moment it retires a refused grant (`_onPairingRefused` calls `_publishState`), so a listener
  /// that rebuilds — this controller's own state listener, and every screen behind it — sees the
  /// refusal in the same turn it happened. A cached copy would need its own invalidation rule, and
  /// that is one more fact that can disagree with the client.
  bool pairingRefusedFor(String hostId) => _clients[hostId]?.pairingRefused ?? false;

  /// The host the app is showing, by the rule in the library comment above.
  CoderHost? get activeHost {
    for (final host in _hosts) {
      if (host.id == _activeId) return host;
    }
    return _hosts.isEmpty ? null : _hosts.first;
  }

  HostClient? get activeClient {
    final host = activeHost;
    return host == null ? null : _clients[host.id];
  }

  /// The client for [hostId], for a surface that has to read one host's link rather than the app's.
  ///
  /// The network-status panel needs the client itself — the ladder, the last RPC, its own state
  /// stream — and not just the two facts (`stateOf`, `routeOf`) the host row renders.
  HostClient? clientOf(String hostId) => _clients[hostId];

  bool isActive(String hostId) => activeHost?.id == hostId;

  /// Load the paired hosts, start a client for each, and resolve the active one.
  ///
  /// Every host gets a client, not only the active one: the Connections view's whole value is that
  /// it says how the *others* are doing before you switch to them, and a status that only appears
  /// after the switch would be a spinner where a fact should be.
  Future<void> load() async {
    final hosts = await store.load();
    final stored = await store.loadActiveHostId();
    if (_disposed) return;
    _hosts
      ..clear()
      ..addAll(hosts);
    _activeId = stored;
    // The store is the truth this controller starts from; `_persistUsed` only writes when a connect
    // makes the *used* host differ from what is already stored (the stale-id and no-id fallbacks).
    _persistedUsedId = stored;
    _loading = false;
    notifyListeners();
    for (final host in hosts) {
      _ensureClient(host);
    }
    notifyListeners();
  }

  void _ensureClient(CoderHost host) {
    if (_disposed || _clients.containsKey(host.id)) return;
    final client = clientFactory?.call(host) ?? HostClient(host, pairingStore: pairings);
    _clients[host.id] = client;
    _subs[host.id] = client.states.listen((state) {
      if (_disposed) return;
      _states[host.id] = state;
      // A link that is up is the "used" half of the stored choice. Persisting here is safe for the
      // screen precisely because `_persistUsed` writes only the *next* launch's host: it does not
      // notify, reorder or reassign `_activeId`, so the machine on screen cannot move.
      if (state == HostConnectionState.connected) _persistUsed(host.id);
      notifyListeners();
    });
    _states[host.id] = HostConnectionState.connecting;
    unawaited(client.connectBest());
  }

  /// Remember [hostId] as the machine the app actually reached — the *used* half of "last used".
  ///
  /// Called only for [HostConnectionState.connected], so a refused dial, a walk still reconnecting or
  /// an unanswered handshake leaves the stored id exactly as it was: one flaky attempt must not change
  /// what the app opens with. Called only for the **active** host, so the background dials [load]
  /// starts for every paired host cannot steal the choice from the machine on screen — if the active
  /// host is unreachable and a background one answers, the unreachable host stays the stored one and
  /// its status icon shows it failing, rather than the app silently jumping desktops next launch.
  ///
  /// The write is about the *next* launch, never this frame: no `notifyListeners`, no change to
  /// [_activeId] and no reordering of [_hosts]. Persisting a fact the screen already shows must not
  /// cost a rebuild (the project list's search field would lose focus on every heartbeat) and must
  /// never be able to move the user to a different machine.
  void _persistUsed(String hostId) {
    if (_disposed || !isActive(hostId)) return;
    if (_persistedUsedId == hostId) return;
    _persistedUsedId = hostId;
    unawaited(store.saveActiveHostId(hostId));
  }

  /// Make [host] the active host, and remember it. Called only from an explicit user choice.
  Future<void> setActive(CoderHost host) async {
    _activeId = host.id;
    _persistedUsedId = host.id;
    notifyListeners();
    await store.saveActiveHostId(host.id);
  }

  /// Add or replace a host, then make it active — the rule a fresh pairing follows too.
  Future<void> upsertHost(CoderHost host) async {
    final index = _hosts.indexWhere((h) => h.id == host.id);
    if (index >= 0) {
      _hosts[index] = host;
      // The host changed under a live client (a re-pairing, a new token): the old socket was dialled
      // with the old credential, so it is replaced rather than kept.
      await _dropClient(host.id);
    } else {
      _hosts.add(host);
    }
    _activeId = host.id;
    _persistedUsedId = host.id;
    notifyListeners();
    await store.saveActiveHostId(host.id);
    _ensureClient(host);
    notifyListeners();
  }

  /// Give a paired host a name of the user's choosing, and persist it.
  ///
  /// **Local only — there is no RPC here, and there must not be one.** A connection's name is the
  /// *phone's* word for a machine, not a fact the daemon owns: the label is written by
  /// `pairing_service.dart` out of the code's own address and read back from this phone's
  /// `HostStore`, so the desktop has no name to change and no method to change it with. Calling
  /// `coder.updateTask`-style RPC for this would be inventing a protocol.
  ///
  /// The live client is deliberately **not** dropped, unlike [upsertHost]. Nothing the client dialled
  /// changed — same host, same token, same socket — so tearing it down would drop a working connection
  /// to fix a label.
  Future<void> renameHost(String hostId, String label) async {
    final index = _hosts.indexWhere((host) => host.id == hostId);
    if (index < 0) return;
    final renamed = _hosts[index].copyWith(label: label);
    // Persist first: the store is the truth a restart reads, and the row is only updated once it has
    // been written. The copy carries the token it was loaded with, so `upsert` can write it back.
    await store.upsert(renamed);
    _hosts[index] = renamed;
    notifyListeners();
  }

  /// Forget a host: its credential, its row, and its client.
  ///
  /// If it was the active one the app moves to the next host in stored order, or to the zero-host
  /// empty state when it was the last — it never keeps showing a machine the user just forgot.
  ///
  /// Only the *persistence* is awaited. Tearing the client down is deliberately not: it closes a
  /// socket and awaits a subscription cancel, and a caller that awaited all of that would hold the
  /// row on screen until the radio was done. The row leaves as soon as the store has, and the client
  /// goes in the background — the same split `dispose` uses for its stream controllers.
  Future<void> forget(CoderHost host) async {
    await store.remove(host.id);
    _hosts.removeWhere((h) => h.id == host.id);
    unawaited(_dropClient(host.id));
    if (_activeId == host.id) {
      _activeId = _hosts.isEmpty ? null : _hosts.first.id;
      _persistedUsedId = _activeId;
      if (_activeId != null) await store.saveActiveHostId(_activeId!);
    }
    notifyListeners();
  }

  Future<void> _dropClient(String hostId) async {
    final sub = _subs.remove(hostId);
    if (sub != null) await sub.cancel();
    final client = _clients.remove(hostId);
    _states.remove(hostId);
    if (client != null) await client.dispose();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final sub in _subs.values) {
      unawaited(sub.cancel());
    }
    for (final client in _clients.values) {
      unawaited(client.dispose());
    }
    super.dispose();
  }
}
