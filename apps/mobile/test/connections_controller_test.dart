// The active-host rule, and the zero-host state, as facts rather than intentions.
//
// Removing the connection-list page moved a question onto every screen: *which* machine is this the
// project list for? The answer lives in `ConnectionsController.activeHost` and it has to be stable —
// a host that changes because a client connected, or because the list reordered, is exactly the
// silent default the owner warned about. These tests pin each branch of the stated rule, plus the
// two transitions the user can cause (switch, forget).

import 'dart:async';

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/connections_controller.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/host_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/memory_secure_storage.dart';

CoderHost _host(String id, String label) => CoderHost(
      id: id,
      label: label,
      endpoint: '$label:4770',
      ownerId: 'owner',
      app: 'EnvoyDev',
      token: 'tok-$label',
    );

/// A client that is never dialled. The active-host rule is about the store and the list, not about a
/// radio; a controller test that dialled would be timing-dependent and prove nothing about the rule.
class _SilentClient extends HostClient {
  _SilentClient(super.host);

  @override
  Future<void> connectBest() async {}

  @override
  Future<void> dispose() async {}
}

/// A controller whose clients never dial, so these tests hold the rule and nothing else.
ConnectionsController _controller(HostStore store) =>
    ConnectionsController(store)..clientFactory = (host) => _SilentClient(host);

/// A client whose connection state a test drives by hand.
///
/// `_SilentClient` proves the rule without a radio; this one adds the single signal the "last used"
/// write keys off — a link that actually comes up — so a test can tell a *selected* host from a
/// *used* one. Only `states` is faked: everything else is the real client, undialled.
class _ScriptedClient extends HostClient {
  _ScriptedClient(super.host);

  final _states = StreamController<HostConnectionState>.broadcast();

  @override
  Stream<HostConnectionState> get states => _states.stream;

  @override
  Future<void> connectBest() async {}

  /// Publish a connection state exactly where a real dial would.
  void emit(HostConnectionState state) => _states.add(state);

  @override
  Future<void> dispose() async {
    unawaited(_states.close());
    await super.dispose();
  }
}

/// A controller plus the scripted clients it built, keyed by host id.
({ConnectionsController controller, Map<String, _ScriptedClient> clients})
    _scriptedController(HostStore store) {
  final clients = <String, _ScriptedClient>{};
  final controller = ConnectionsController(store)
    ..clientFactory = (host) => clients[host.id] = _ScriptedClient(host);
  return (controller: controller, clients: clients);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<HostStore> storeWith(List<CoderHost> hosts, {String? active}) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final store = HostStore(prefs: prefs, secure: MemorySecureStorage());
    for (final host in hosts) {
      await store.upsert(host);
    }
    if (active != null) await store.saveActiveHostId(active);
    return store;
  }

  test('with no stored choice, the first host paired is the one shown', () async {
    final store = await storeWith([_host('a', 'alpha'), _host('b', 'beta')]);
    final controller = _controller(store);
    addTearDown(controller.dispose);

    await controller.load();
    expect(controller.activeHost?.id, 'a');
  });

  test('a stored choice wins over the stored order', () async {
    final store = await storeWith(
      [_host('a', 'alpha'), _host('b', 'beta')],
      active: 'b',
    );
    final controller = _controller(store);
    addTearDown(controller.dispose);

    await controller.load();
    expect(controller.activeHost?.id, 'b');
  });

  test('a stored choice naming a host that is gone falls back, and is not trusted', () async {
    final store = await storeWith([_host('a', 'alpha')], active: 'deleted-host');
    final controller = _controller(store);
    addTearDown(controller.dispose);

    await controller.load();
    expect(controller.activeHost?.id, 'a');
  });

  test('with zero hosts the controller has no active host at all', () async {
    final store = await storeWith([]);
    final controller = _controller(store);
    addTearDown(controller.dispose);

    await controller.load();
    // The shell reads this null and renders the zero-host empty state, which is why it must be null
    // rather than "a host with nothing in it".
    expect(controller.activeHost, isNull);
    expect(controller.activeClient, isNull);
  });

  test('switching persists, so the next launch opens on the chosen host', () async {
    final store = await storeWith([_host('a', 'alpha'), _host('b', 'beta')]);
    final controller = _controller(store);
    addTearDown(controller.dispose);

    await controller.load();
    await controller.setActive(_host('b', 'beta'));
    expect(controller.activeHost?.id, 'b');
    expect(await store.loadActiveHostId(), 'b');
  });

  test('adding a host makes it active; forgetting it moves to the next one', () async {
    final store = await storeWith([_host('a', 'alpha')]);
    final controller = _controller(store);
    addTearDown(controller.dispose);

    await controller.load();
    await controller.upsertHost(_host('b', 'beta'));
    expect(controller.activeHost?.id, 'b');

    await controller.forget(_host('b', 'beta'));
    expect(controller.activeHost?.id, 'a');
    expect(controller.hosts.map((h) => h.id), ['a']);
  });

  test('forgetting the last host leaves no active host', () async {
    final store = await storeWith([_host('a', 'alpha')]);
    final controller = _controller(store);
    addTearDown(controller.dispose);

    await controller.load();
    await controller.forget(_host('a', 'alpha'));
    expect(controller.activeHost, isNull);
    expect(controller.hosts, isEmpty);
  });

  test('renaming is local: it persists the label and keeps the live client', () async {
    final store = await storeWith([_host('a', 'alpha')]);
    final controller = _controller(store);
    addTearDown(controller.dispose);

    await controller.load();
    final before = controller.clientOf('a');

    await controller.renameHost('a', 'Studio');

    expect(controller.hosts.single.label, 'Studio');
    expect(controller.activeHost?.label, 'Studio');
    // Same machine, same token, same socket: a rename is a label, not a re-pair. `upsertHost` would
    // have dropped and rebuilt this client; `renameHost` must not.
    expect(identical(controller.clientOf('a'), before), isTrue);
    final reloaded = await store.load();
    expect(reloaded.single.label, 'Studio');
    // The rewrite did not lose the credential — the store still holds the token it held before.
    expect(reloaded.single.token, 'tok-alpha');
  });

  test('renaming a host that is no longer in the list is a no-op, not a crash', () async {
    final store = await storeWith([_host('a', 'alpha')]);
    final controller = _controller(store);
    addTearDown(controller.dispose);

    await controller.load();
    await controller.renameHost('gone', 'Nowhere');
    expect(controller.hosts.single.label, 'alpha');
  });

  // -- "Last used" means used, not tapped -------------------------------------
  //
  // The stored id is what the *next* launch opens on, and the owner's point is that it must name the
  // machine actually worked on rather than the one last selected. These tests drive the one signal
  // that tells the two apart — a connection that comes up — and pin that persisting it cannot move
  // the screen the user is looking at.

  test('a successful connect remembers the host actually reached', () async {
    final store = await storeWith([_host('a', 'alpha'), _host('b', 'beta')]);
    final (:controller, :clients) = _scriptedController(store);
    addTearDown(controller.dispose);

    await controller.load();
    // Nothing tapped and nothing reached yet: that is "no explicit choice", which is not "no host".
    // The controller is showing `a` by the first-host fallback, but the store still says nothing.
    expect(controller.activeHost?.id, 'a');
    expect(await store.loadActiveHostId(), isNull);

    clients['a']!.emit(HostConnectionState.connected);
    await pumpEventQueue();

    // The fallback host that answered is now the remembered one, so the store self-heals from the
    // "no id / stale id" drift the old selection-only write could leave behind.
    expect(await store.loadActiveHostId(), 'a');
  });

  test('a stale stored id is healed by the host actually used', () async {
    final store = await storeWith(
      [_host('a', 'alpha'), _host('b', 'beta')],
      active: 'deleted-host',
    );
    final (:controller, :clients) = _scriptedController(store);
    addTearDown(controller.dispose);

    await controller.load();
    // The rule falls back to the first host, but the store still names a machine that is gone — the
    // drift case, where the active host and the persisted one disagree.
    expect(controller.activeHost?.id, 'a');
    expect(await store.loadActiveHostId(), 'deleted-host');

    clients['a']!.emit(HostConnectionState.connected);
    await pumpEventQueue();

    // Using A heals the store: the id now names a host that exists *and* answered.
    expect(await store.loadActiveHostId(), 'a');
  });

  test('a connect that never succeeds does not change the remembered host', () async {
    final store = await storeWith([_host('a', 'alpha'), _host('b', 'beta')]);
    final (:controller, :clients) = _scriptedController(store);
    addTearDown(controller.dispose);

    await controller.load();

    // Every state a failing walk passes through — `reconnecting` included, which a real client
    // publishes after each failed dial — and none of them is a "used". One flaky attempt must not
    // change what the app opens with.
    for (final state in const [
      HostConnectionState.connecting,
      HostConnectionState.reconnecting,
      HostConnectionState.failed,
    ]) {
      clients['a']!.emit(state);
      await pumpEventQueue();
      expect(await store.loadActiveHostId(), isNull, reason: '$state must not persist');
    }
  });

  test('pairing A then B, then using A, opens on A at the next launch', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final store = HostStore(prefs: prefs, secure: MemorySecureStorage());
    final a = _host('a', 'alpha');
    final b = _host('b', 'beta');

    // Pair A, then pair B. Both `addHostFlow` and `upsertHost` persist the just-paired machine, so the
    // store ends up naming B — the precondition in the owner's report.
    await store.upsert(a);
    await store.saveActiveHostId(a.id);
    await store.upsert(b);
    await store.saveActiveHostId(b.id);
    expect(await store.loadActiveHostId(), 'b');

    // Work on A: the screen switches to it and its link comes up.
    final first = _scriptedController(store);
    addTearDown(first.controller.dispose);
    await first.controller.load();
    expect(first.controller.activeHost?.id, 'b');
    await first.controller.setActive(a);
    first.clients['a']!.emit(HostConnectionState.connected);
    await pumpEventQueue();
    expect(await store.loadActiveHostId(), 'a');

    // The next launch: a fresh controller over the same store, exactly as `AppShell` builds one.
    final second = _scriptedController(store);
    addTearDown(second.controller.dispose);
    await second.controller.load();
    expect(second.controller.activeHost?.id, 'a');
  });

  test('forgetting the remembered host falls back, and the next launch follows', () async {
    final store = await storeWith([_host('a', 'alpha'), _host('b', 'beta')], active: 'b');
    final (:controller, :clients) = _scriptedController(store);
    addTearDown(controller.dispose);

    await controller.load();
    clients['b']!.emit(HostConnectionState.connected);
    await pumpEventQueue();
    expect(await store.loadActiveHostId(), 'b');

    await controller.forget(_host('b', 'beta'));
    expect(controller.activeHost?.id, 'a');
    expect(await store.loadActiveHostId(), 'a');

    // A launch after the forget opens on the fallback, not on the machine that is gone.
    final next = _scriptedController(store);
    addTearDown(next.controller.dispose);
    await next.controller.load();
    expect(next.controller.activeHost?.id, 'a');
  });

  test('remembering a used host moves nothing on screen and adds no notification', () async {
    final store = await storeWith([_host('a', 'alpha'), _host('b', 'beta')]);
    final (:controller, :clients) = _scriptedController(store);
    addTearDown(controller.dispose);

    await controller.load();
    expect(controller.activeHost?.id, 'a');

    // `load` dials every paired host, so a background host can connect while the user is on another.
    // It must not be remembered: that would move the app to a different desktop at the next launch.
    clients['b']!.emit(HostConnectionState.connected);
    await pumpEventQueue();
    expect(controller.activeHost?.id, 'a');
    expect(await store.loadActiveHostId(), isNull);

    var notifications = 0;
    controller.addListener(() => notifications++);
    clients['a']!.emit(HostConnectionState.connected);
    await pumpEventQueue();

    // The write happened, and it cost exactly the one notification the state update already sent:
    // `_persistUsed` neither notifies nor reorders, so the screen cannot move under the user.
    expect(await store.loadActiveHostId(), 'a');
    expect(notifications, 1);
    expect(controller.activeHost?.id, 'a');
    expect(controller.hosts.map((h) => h.id), ['a', 'b']);

    // And a background host connecting afterwards still cannot steal the remembered id.
    clients['b']!.emit(HostConnectionState.connected);
    await pumpEventQueue();
    expect(await store.loadActiveHostId(), 'a');
  });
}
