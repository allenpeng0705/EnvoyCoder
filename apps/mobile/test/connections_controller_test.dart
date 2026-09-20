// The active-host rule, and the zero-host state, as facts rather than intentions.
//
// Removing the connection-list page moved a question onto every screen: *which* machine is this the
// project list for? The answer lives in `ConnectionsController.activeHost` and it has to be stable —
// a host that changes because a client connected, or because the list reordered, is exactly the
// silent default the owner warned about. These tests pin each branch of the stated rule, plus the
// two transitions the user can cause (switch, forget).

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
}
