/// The pairing this phone holds, keyed by **daemon identity**.
///
/// Three properties are the whole point of this file, and each is the half of a bug the owner reported:
/// a token that is kept is offered again on the next connect (so no re-pairing happens); a token the
/// daemon has refused is retired (so a dead credential is not presented forever); and neither of those
/// ever crosses daemons (a token offered to the wrong machine is a security bug, not a UX one).
///
/// The client-level half — that a connect actually *uses* the stored token, and that a refusal is
/// acted on exactly once — is in `host_client_pairing_test.dart`.
library;

import 'package:envoydev_mobile/services/pairing_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/memory_secure_storage.dart';

PairingStore storeOn(MemorySecureStorage secure) => PairingStore(secure: secure);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('daemonKeyFor', () {
    test('is built from the connection identity, never from a display name', () {
      final first = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'envoy:owner:local-a');
      final renamed = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'envoy:owner:local-a');

      // There is no name parameter to vary: the same machine reached by the same owner is one key
      // whatever the user calls it in the Connections list.
      expect(daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'envoy:owner:local-a'), renamed);
      expect(first, renamed);
      // And the key does not mention a name even when one exists in the host record.
      expect(first.contains('Studio'), isFalse);
    });

    test('separates two daemons that share an address, and two that share an owner', () {
      final a = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');
      final b = daemonKeyFor(endpoint: '10.0.0.5:4770', owner: 'owner-a');
      final c = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-b');
      expect({a, b, c}, hasLength(3));
    });

    test('reads the same endpoint however it was written', () {
      final typed = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');
      // Case, a scheme and a trailing slash are how it was spelled, not which machine it is.
      expect(daemonKeyFor(endpoint: '10.0.0.4:4770/', owner: 'owner-a'), typed);
      expect(daemonKeyFor(endpoint: 'ws://10.0.0.4:4770/ws', owner: 'owner-a'), typed);
      expect(daemonKeyFor(endpoint: ' 10.0.0.4:4770 ', owner: 'owner-a'), typed);
      expect(daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'OWNER-A'), typed);
    });

    test('an endpoint that carries a colon cannot collide with a different owner', () {
      // `owner:endpoint` read back by splitting on the first colon is ambiguous for an IPv6 literal;
      // the owner's length in the key is what keeps these two apart.
      final a = daemonKeyFor(endpoint: '[fe80::1]:4770', owner: 'owner');
      final b = daemonKeyFor(endpoint: '1]:4770', owner: 'owner:fe80:');
      expect(a, isNot(b));
    });

    test('an address with nothing in it names no daemon', () {
      expect(daemonKeyFor(endpoint: '   ', owner: 'owner-a'), isEmpty);
    });
  });

  group('a stored pairing', () {
    test('is offered on the next connect', () async {
      final secure = MemorySecureStorage();
      final store = storeOn(secure);
      final key = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');

      // The first launch: nothing held, so nothing is offered and a pairing is what has to happen.
      expect(await store.tokenFor(key), isNull);

      await store.record(key, 'grant-1', instanceId: 'inst-1', at: DateTime(2026, 1, 2, 3));
      // A later launch reads it back — this is the whole "no re-pairing" mechanism: the credential
      // survives the process, so the phone presents it instead of asking for a new code.
      expect(await storeOn(secure).tokenFor(key), 'grant-1');
    });

    test('keeps the daemon it came from, and the moment this phone saw it accepted', () async {
      final secure = MemorySecureStorage();
      final store = storeOn(secure);
      final key = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');
      await store.record(key, 'grant-1',
          instanceId: 'inst-1', at: DateTime(2026, 1, 2, 3, 4, 5));

      final record = (await storeOn(secure).pairingFor(key))!;
      expect(record.token, 'grant-1');
      expect(record.instanceId, 'inst-1');
      expect(record.lastSeenAt, DateTime(2026, 1, 2, 3, 4, 5));
    });

    test('an empty token is not a pairing', () async {
      final store = storeOn(MemorySecureStorage());
      final key = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');
      await store.record(key, '   ', instanceId: 'inst-1');
      expect(await store.tokenFor(key), isNull);
      expect(await store.pairingFor(key), isNull);
    });

    test('never appears in shared_preferences', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final preferences = await SharedPreferences.getInstance();
      final secure = MemorySecureStorage();
      final store = storeOn(secure);
      final key = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');
      await store.record(key, 'super-secret', instanceId: 'inst-1');

      final dumped = preferences.getKeys().map((k) => '$k=${preferences.get(k)}').join('\n');
      expect(dumped, isNot(contains('super-secret')));
      // The credential is in the platform's secure storage, under a key that is the daemon's identity.
      expect(await secure.read(key: 'envoydev.pairing.v1.$key'), contains('super-secret'));
    });

    test('is stored under a key that is not a display name', () async {
      final secure = MemorySecureStorage();
      final store = storeOn(secure);
      final key = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');
      await store.record(key, 'grant-1');

      // Nothing was written under a named key — the only key is the identity one.
      expect(await secure.read(key: 'envoydev.pairing.v1.Studio'), isNull);
      expect(await secure.read(key: 'envoydev.pairing.v1.$key'), contains('grant-1'));
    });

    test('survives the desktop restarting, because instanceId is not the key', () async {
      final secure = MemorySecureStorage();
      final key = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');
      await storeOn(secure).record(key, 'grant-1', instanceId: 'process-1');
      // A daemon that restarted reports a brand-new instanceId for the *same* machine. The credential
      // must still be offered: keying on the process would re-pair the phone every desktop reboot.
      await storeOn(secure).record(key, 'grant-1', instanceId: 'process-2', at: DateTime(2026, 2));

      expect(await storeOn(secure).tokenFor(key), 'grant-1');
      expect((await storeOn(secure).pairingFor(key))!.instanceId, 'process-2');
    });
  });

  group('a refused pairing', () {
    test('is cleared, and the next connect has nothing to offer', () async {
      final secure = MemorySecureStorage();
      final store = storeOn(secure);
      final key = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');
      await store.record(key, 'revoked', instanceId: 'inst-1');
      expect(await store.tokenFor(key), 'revoked');

      await store.clear(key);

      expect(await store.tokenFor(key), isNull);
      expect(await storeOn(secure).pairingFor(key), isNull);
      // Deleted, not flagged: a token the daemon has rejected has no use this phone can put it to,
      // and leaving it stored is what makes a dead credential get offered again on the next dial.
      expect(await secure.read(key: 'envoydev.pairing.v1.$key'), isNull);
    });

    test('clearing one daemon leaves the other daemon alone', () async {
      final secure = MemorySecureStorage();
      final store = storeOn(secure);
      final a = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');
      final b = daemonKeyFor(endpoint: '10.0.0.5:4770', owner: 'owner-a');
      await store.record(a, 'grant-a');
      await store.record(b, 'grant-b');

      await store.clear(a);

      expect(await store.tokenFor(a), isNull);
      expect(await store.tokenFor(b), 'grant-b');
    });
  });

  group('a record this build cannot read', () {
    test('is treated as no pairing rather than as a token', () async {
      final secure = MemorySecureStorage();
      final key = daemonKeyFor(endpoint: '10.0.0.4:4770', owner: 'owner-a');
      await secure.write(key: 'envoydev.pairing.v1.$key', value: 'not json at all');

      final store = storeOn(secure);
      expect(await store.pairingFor(key), isNull);
      expect(await store.tokenFor(key), isNull);
    });
  });
}
