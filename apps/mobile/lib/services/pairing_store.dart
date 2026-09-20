/// The **peer's** name for the pairing secret, and the one place a revoked pairing is retired.
///
/// ## Why this exists beside `HostStore`
///
/// `HostStore` already keeps each paired host's token, and it is the credential the dial uses. What it
/// cannot say is *who issued it*: its rows are keyed by `CoderHost.id`, a string this app assembles
/// (`ownerId::endpoint`, or `tcp::…` for a typed address), so the same desktop can appear under two
/// ids — a code scanned once and an address typed later — and a token can silently travel between the
/// two. This file keys the credential by the **daemon's own identity**, which is the fact that must
/// never be guessed: a token presented to a different machine is a security bug, not an inconvenience.
///
/// ## Which identity, and which one is deliberately *not* the key
///
/// The key is the connection itself — its address, plus the owner the pairing code claimed
/// ([daemonKeyFor]). That is durable: it survives the desktop restarting, the daemon being updated,
/// and the phone being relaunched.
///
/// `coder.hello`'s `instanceId` **is not the key**, and that is a decision rather than an omission.
/// It names one *process*, and the daemon mints a fresh one on every start
/// (`apps/desktop/src/daemon/serve.ts`: `options.instanceId ?? randomUUID()`). Keying on it would mean
/// a desktop that restarted looked like a different machine, so the phone would re-pair every boot —
/// the exact behaviour this half of the fix exists to end. It is recorded in [PairingRecord.instanceId]
/// for the moment the phone needs to *report* which daemon answered, and it is never a lookup key.
///
/// ## One more property, and it is why the key is a string this file owns
///
/// A display name is never part of the key. Two desktops can both be called "Studio", and a rename is
/// a local act (`ConnectionsController.renameHost`), so a name-keyed map would hand one machine's
/// credential to another the moment a user typed the same word twice.
library;

import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure-storage key prefix. The daemon identity is appended; no token ever rides in the key.
const String _kPairingPrefix = 'envoydev.pairing.v1.';

/// What the phone knows about one of its pairings, all of it local to this phone.
///
/// [lastSeenAt] is the phone's own record of the most recent time the daemon **accepted the token and
/// answered `coder.hello`**. It is deliberately not described as the daemon's last-seen value: the
/// wire has no such field for a client (`coder.hello`'s result is product, version, `instanceId`,
/// home, stateDir, startedAt, windowCount, methods, mesh, notes), and the desktop's own
/// `lastSeenAt` lives in *its* paired-device row and is never sent to the phone. Inventing a
/// daemon-reported time would be claiming a capability the protocol does not provide.
class PairingRecord {
  const PairingRecord({
    required this.token,
    this.instanceId,
    this.lastSeenAt,
  });

  /// The token the daemon issued, keyed in storage by the daemon's identity. Never rendered.
  final String token;

  /// The `instanceId` the daemon reported in the hello that recorded this pairing, when it reported
  /// one. Provenance, not identity — see the library comment.
  final String? instanceId;

  /// When this phone last saw the daemon accept [token]. Null when the token has been stored but no
  /// connection has succeeded yet — a state the Settings surface words rather than guesses at.
  final DateTime? lastSeenAt;
}

/// Pairings keyed by **daemon identity**, in the platform's secure storage.
///
/// Tokens are the whole credential, so they live in `flutter_secure_storage` and never in
/// `shared_preferences` — the same rule `HostStore` follows, and the reason a prefs dump is not a
/// credential dump.
class PairingStore {
  PairingStore({FlutterSecureStorage? secure})
      : _secure = secure ?? const FlutterSecureStorage();

  final FlutterSecureStorage _secure;

  /// Records written or read in this launch, so a reconnect does not pay a keychain round trip (or a
  /// write) for a fact that has not changed. A `clear` removes the entry rather than leaving a stale
  /// copy, which is what makes the next `pairingFor` read the store again.
  final Map<String, PairingRecord> _memo = <String, PairingRecord>{};

  /// The pairing recorded for the daemon at [daemonKey], or null when this phone has none.
  ///
  /// A store that cannot be read answers null, and null is the safe direction: the caller falls back
  /// to the credential it already holds rather than inventing one.
  Future<PairingRecord?> pairingFor(String daemonKey) async {
    final cached = _memo[daemonKey];
    if (cached != null && cached.token.isNotEmpty) return cached;
    try {
      final raw = await _secure.read(key: '$_kPairingPrefix$daemonKey');
      final record = _decode(raw);
      if (record != null) _memo[daemonKey] = record;
      return record;
    } catch (_) {
      return null;
    }
  }

  /// The token to offer this daemon on the next dial, or null when there is none to offer.
  ///
  /// This is the method a connect calls **before** it walks a candidate ladder: a token already
  /// issued by this daemon means no pairing is needed at all.
  Future<String?> tokenFor(String daemonKey) async =>
      (await pairingFor(daemonKey))?.token;

  /// Remember the [token] this daemon issued, and stamp the moment that is being attempted.
  ///
  /// One write per accepted hello, and this is the only writer of `lastSeenAt` — a token re-recorded
  /// with the same identity and the same instant does not touch storage at all.
  ///
  /// Best-effort, like `installId`: a pairing that cannot be written must not fail the connection
  /// that just succeeded. The in-memory copy still serves this launch.
  Future<void> record(
    String daemonKey,
    String token, {
    String? instanceId,
    DateTime? at,
  }) async {
    final trimmed = token.trim();
    if (daemonKey.isEmpty || trimmed.isEmpty) return;
    final previous = _memo[daemonKey] ?? await pairingFor(daemonKey);
    final record = PairingRecord(
      token: trimmed,
      instanceId: instanceId ?? previous?.instanceId,
      lastSeenAt: at ?? previous?.lastSeenAt,
    );
    _memo[daemonKey] = record;
    if (previous != null &&
        previous.token == record.token &&
        previous.instanceId == record.instanceId &&
        previous.lastSeenAt == record.lastSeenAt) {
      return;
    }
    try {
      await _secure.write(
        key: '$_kPairingPrefix$daemonKey',
        value: jsonEncode({
          'token': record.token,
          if (record.instanceId != null) 'instanceId': record.instanceId,
          if (record.lastSeenAt != null)
            'lastSeenAt': record.lastSeenAt!.toUtc().toIso8601String(),
        }),
      );
    } catch (_) {
      // The credential this launch uses is already in `_memo`; refusing the connection would be a
      // worse answer than losing the record on the next launch.
    }
  }

  /// Retire a pairing the daemon has refused — a revoked or expired token.
  ///
  /// The record is **deleted**, not flagged. That is about not *re-offering* a dead grant: leaving it
  /// stored is what makes a rejected credential go back on the wire on the next dial. It is not what
  /// keeps the fallback single-shot — the guard against a clear-and-retry loop is the caller's own
  /// one-shot flag (`HostClient._pairingRefused`), because a host row can hold the same dead
  /// credential and this store has no way to know that.
  Future<void> clear(String daemonKey) async {
    _memo.remove(daemonKey);
    try {
      await _secure.delete(key: '$_kPairingPrefix$daemonKey');
    } catch (_) {
      // A delete that failed leaves the record, but the memo is gone for this launch; the daemon's
      // refusal is what decides the next step either way.
    }
  }

  static PairingRecord? _decode(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      final token = decoded['token'];
      if (token is! String || token.trim().isEmpty) return null;
      final instanceId = decoded['instanceId'];
      final seen = decoded['lastSeenAt'];
      return PairingRecord(
        token: token,
        instanceId: instanceId is String && instanceId.isNotEmpty ? instanceId : null,
        lastSeenAt: seen is String ? DateTime.tryParse(seen)?.toLocal() : null,
      );
    } catch (_) {
      // A record this build cannot read is treated as no record: the phone falls back to its host
      // token, which is the behaviour that shipped before this store existed.
      return null;
    }
  }
}

/// The stable identity of the daemon at [endpoint], as this app keys a credential by.
///
/// The pieces are the two the pairing contract itself provides and the phone cannot confuse: the
/// **address** the daemon is reached at, and the **owner** the code claimed. Neither is a name.
///
/// The owner's length is part of the key on purpose. `owner:endpoint` read back by splitting on the
/// first colon is ambiguous the moment an endpoint carries one (an IPv6 literal), and two daemons
/// sharing a key is the failure this function exists to prevent — so the length is written down
/// rather than inferred.
///
/// Called from `HostStore`-shaped records today (`host.id` for a scanned code, `host.endpoint` for
/// every host), so an address typed by hand and the same address arriving in a code still name the
/// same daemon.
String daemonKeyFor({required String endpoint, String owner = ''}) {
  final where = _normalizedEndpoint(endpoint);
  if (where.isEmpty) return '';
  final ownerKey = owner.trim().toLowerCase();
  return '$ownerKey.length:$ownerKey:$where';
}

/// An endpoint reduced to the part that is the same whoever wrote it: lower-case host and port.
///
/// `10.0.0.4:4770`, `10.0.0.4:4770/` and `[::1]:4770` are the same daemon; a trailing slash or a
/// scheme is not part of its identity.
String _normalizedEndpoint(String endpoint) {
  var text = endpoint.trim().toLowerCase();
  if (text.isEmpty) return '';
  final scheme = text.indexOf('://');
  if (scheme >= 0) text = text.substring(scheme + 3);
  final slash = text.indexOf('/');
  if (slash >= 0) text = text.substring(0, slash);
  return text;
}
