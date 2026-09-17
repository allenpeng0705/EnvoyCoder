import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/host_store.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// In-memory stand-in so tests do not touch the platform secure-storage plugin.
class _MemorySecureStorage extends FlutterSecureStorage {
  final Map<String, String> _values = {};

  @override
  Future<void> write({
    required String key,
    required String? value,
    AndroidOptions? aOptions,
    IOSOptions? iOptions,
    LinuxOptions? lOptions,
    WindowsOptions? wOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
  }) async {
    if (value == null) {
      _values.remove(key);
    } else {
      _values[key] = value;
    }
  }

  @override
  Future<String?> read({
    required String key,
    AndroidOptions? aOptions,
    IOSOptions? iOptions,
    LinuxOptions? lOptions,
    WindowsOptions? wOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
  }) async =>
      _values[key];

  @override
  Future<void> delete({
    required String key,
    AndroidOptions? aOptions,
    IOSOptions? iOptions,
    LinuxOptions? lOptions,
    WindowsOptions? wOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
  }) async {
    _values.remove(key);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('upsert keeps the token out of shared_preferences', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final secure = _MemorySecureStorage();
    final store = HostStore(prefs: prefs, secure: secure);

    const host = CoderHost(
      id: 'owner::10.0.0.1:4770',
      label: 'desk',
      endpoint: '10.0.0.1:4770',
      ownerId: 'owner',
      app: 'EnvoyDev',
      token: 'super-secret',
      lanWsUrl: 'ws://10.0.0.1:4770/ws',
    );

    await store.upsert(host);
    final raw = prefs.getString('envoydev.hosts.v1')!;
    expect(raw, isNot(contains('super-secret')));
    expect(raw, contains('10.0.0.1:4770'));

    final loaded = await store.load();
    expect(loaded, hasLength(1));
    expect(loaded.single.token, 'super-secret');
    expect(loaded.single.lanWsUrl, 'ws://10.0.0.1:4770/ws');
  });

  test('upsert replaces by id and stores an SSH password only in secure storage', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final secure = _MemorySecureStorage();
    final store = HostStore(prefs: prefs, secure: secure);

    const first = CoderHost(
      id: 'ssh::bastion::127.0.0.1:4770',
      label: 'bastion',
      endpoint: '127.0.0.1:4770',
      ownerId: '',
      app: 'EnvoyDev',
      token: 'tok-1',
      ssh: SshHop(host: 'bastion', user: 'dev', password: 'ssh-pass'),
    );
    await store.upsert(first);
    await store.upsert(first.copyWith(token: 'tok-2'));

    final loaded = await store.load();
    expect(loaded, hasLength(1));
    expect(loaded.single.token, 'tok-2');
    expect(loaded.single.ssh?.password, 'ssh-pass');
    expect(prefs.getString('envoydev.hosts.v1'), isNot(contains('ssh-pass')));
    expect(prefs.getString('envoydev.hosts.v1'), isNot(contains('tok-2')));
  });
}
