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
/// Every path that changes which host is active goes through here, and each one persists. The screen
/// therefore never changes under the user because a connect finished, a list reordered, or a run
/// event arrived — only because the user chose, or because the chosen host was forgotten.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/host.dart';
import 'host_client.dart';
import 'host_store.dart';

class ConnectionsController extends ChangeNotifier {
  ConnectionsController(this.store);

  final HostStore store;

  final List<CoderHost> _hosts = [];
  final Map<String, HostClient> _clients = {};
  final Map<String, HostConnectionState> _states = {};
  final Map<String, StreamSubscription<HostConnectionState>> _subs = {};

  String? _activeId;
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
    _loading = false;
    notifyListeners();
    for (final host in hosts) {
      _ensureClient(host);
    }
    notifyListeners();
  }

  void _ensureClient(CoderHost host) {
    if (_disposed || _clients.containsKey(host.id)) return;
    final client = clientFactory?.call(host) ?? HostClient(host);
    _clients[host.id] = client;
    _subs[host.id] = client.states.listen((state) {
      if (_disposed) return;
      _states[host.id] = state;
      notifyListeners();
    });
    _states[host.id] = HostConnectionState.connecting;
    unawaited(client.connectBest());
  }

  /// Make [host] the active host, and remember it. Called only from an explicit user choice.
  Future<void> setActive(CoderHost host) async {
    _activeId = host.id;
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
