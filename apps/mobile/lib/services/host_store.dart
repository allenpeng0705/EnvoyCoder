/// Persist paired hosts: metadata in shared_preferences, tokens only in flutter_secure_storage.
///
/// The split is deliberate. A prefs dump / device backup must not walk away with the pairing
/// credential. The token is the whole credential — it is never written beside the host row.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/host.dart';
import 'pairing_service.dart';

const _kHostsKey = 'envoydev.hosts.v1';
const _kTokenPrefix = 'envoydev.host.token.';
const _kSshPasswordPrefix = 'envoydev.host.ssh-password.';

class HostStore {
  HostStore({
    SharedPreferences? prefs,
    FlutterSecureStorage? secure,
  })  : _prefs = prefs,
        _secure = secure ?? const FlutterSecureStorage();

  SharedPreferences? _prefs;
  final FlutterSecureStorage _secure;

  Future<SharedPreferences> _preferences() async =>
      _prefs ??= await SharedPreferences.getInstance();

  Future<List<CoderHost>> load() async {
    final prefs = await _preferences();
    final raw = prefs.getString(_kHostsKey);
    if (raw == null || raw.isEmpty) return const [];
    final meta = decodeHosts(raw);
    final withSecrets = <CoderHost>[];
    for (final host in meta) {
      final token = await _secure.read(key: '$_kTokenPrefix${host.id}');
      if (token == null || token.isEmpty) continue;
      final sshPassword = await _secure.read(key: '$_kSshPasswordPrefix${host.id}');
      final ssh = host.ssh == null
          ? null
          : SshHop(
              host: host.ssh!.host,
              port: host.ssh!.port,
              user: host.ssh!.user,
              password: sshPassword,
            );
      withSecrets.add(host.copyWith(token: token, ssh: ssh));
    }
    return withSecrets;
  }

  /// Insert or replace by [CoderHost.id]. Persists metadata without the token.
  Future<void> upsert(CoderHost host) async {
    if (host.token.isEmpty) {
      throw ArgumentError('A host without a token cannot be saved.');
    }
    final prefs = await _preferences();
    final existing = await load();
    final next = [
      for (final h in existing)
        if (h.id != host.id) h,
      host,
    ];
    await prefs.setString(_kHostsKey, encodeHosts(next));
    await _secure.write(key: '$_kTokenPrefix${host.id}', value: host.token);
    final sshPassword = host.ssh?.password;
    if (sshPassword != null && sshPassword.isNotEmpty) {
      await _secure.write(key: '$_kSshPasswordPrefix${host.id}', value: sshPassword);
    } else {
      await _secure.delete(key: '$_kSshPasswordPrefix${host.id}');
    }
  }

  Future<void> remove(String hostId) async {
    final prefs = await _preferences();
    final existing = await load();
    final next = existing.where((h) => h.id != hostId).toList();
    await prefs.setString(_kHostsKey, encodeHosts(next));
    await _secure.delete(key: '$_kTokenPrefix$hostId');
    await _secure.delete(key: '$_kSshPasswordPrefix$hostId');
  }
}
