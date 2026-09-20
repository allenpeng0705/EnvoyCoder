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

/// Which host the app opens on when more than one is paired — the "last used" choice.
///
/// Deliberately a plain id rather than, say, "the first host" or "the most recently connected one".
/// Either of those is a silent default that changes under the user: a reconnect reordering the list,
/// or a fresh pairing arriving first, would move the app to a different machine between launches.
///
/// The id is written by exactly two moments, both in `ConnectionsController`: an explicit selection
/// (a switch, or the pairing that lands on the just-added machine) and a **successful connection by
/// the host already on screen**. The second is what makes "last used" mean *used* rather than merely
/// tapped, and it is still only a fact about the next launch — never a reason for the screen to move
/// now. A failed connect writes nothing, so one flaky dial cannot change what the app opens with.
const _kActiveHostKey = 'envoydev.active-host.v1';

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
    // Forgetting the host the app was on would leave the stored id pointing at nothing. Clearing it
    // here rather than in the screen keeps the two facts — "this host is gone" and "this host was
    // active" — from ever disagreeing, whichever screen forgets it.
    if (await loadActiveHostId() == hostId) {
      await prefs.remove(_kActiveHostKey);
    }
  }

  /// The id of the host the app should open on, or null when the user has never switched.
  ///
  /// Null is **not** "no host": it means "no explicit choice yet", and the caller's rule (see
  /// `ConnectionsController.activeHost`) decides what that means for the stored order. Keeping the
  /// two apart is what lets `remove` fall back to the list rather than fabricate an id.
  Future<String?> loadActiveHostId() async {
    final prefs = await _preferences();
    final id = prefs.getString(_kActiveHostKey);
    return id == null || id.isEmpty ? null : id;
  }

  /// Remember [hostId] as the host to open on.
  ///
  /// Called when the user selects a host (a switch, or the pairing that lands on the just-added
  /// machine) and when the host already on screen connects
  /// (`ConnectionsController._persistUsed`). The second call is what keeps the stored id equal to the
  /// machine actually in use rather than only the one last tapped; both describe the *next* launch,
  /// so neither can move the screen the user is looking at.
  Future<void> saveActiveHostId(String hostId) async {
    final prefs = await _preferences();
    await prefs.setString(_kActiveHostKey, hostId);
  }
}
