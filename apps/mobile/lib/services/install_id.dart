/// This installation's stable id — which the daemon needs to tell one phone from another.
///
/// ## Why the phone has to say who it is
///
/// The daemon records one paired-device row per **pairing** unless something can tell it that two connections
/// come from the same device. The token cannot: a phone that pairs again is given a *new* token, so the row it
/// used before stays active — a live credential nobody is watching, which is why revoking "the phone" left it
/// connected and why a phone paired five times left five rows, all labelled "Phone". `coder.hello`'s `client.id`
/// is that something.
///
/// ## Why shared_preferences and not the keychain
///
/// This is an **identifier, not a credential**: it proves nothing on its own, and the pairing token remains the
/// only secret this app holds. Keeping it beside the host metadata matches that, and it survives app updates —
/// which is the whole point, since an id that changed on every launch would be worse than none.
library;

import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

/// The preference key. Stable, because a changed key reads as a new device.
const String kInstallIdKey = 'envoydev.install.id';

/// This installation's id, created and persisted on first use.
Future<String> installId() async {
  /**
   * **Storage is best-effort, and the id is not.** This is called while building `coder.hello`, and a handshake
   * that fails because a preference could not be read would be a far worse outcome than an id the daemon does not
   * recognise: the phone would not connect at all, which is exactly what the tests in this repository caught when
   * the first version called `SharedPreferences` unconditionally.
   *
   * An id that could not be persisted is generated fresh and returned — the daemon treats this connection as a
   * device it has not seen before, which is the behaviour that shipped before this id existed.
   */
  try {
    final preferences = await SharedPreferences.getInstance();
    final existing = preferences.getString(kInstallIdKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final created = randomInstallId();
    await preferences.setString(kInstallIdKey, created);
    return created;
  } catch (_) {
    return randomInstallId();
  }
}

/// 16 secure random bytes as hex.
///
/// `Random.secure` rather than `Random`: an id two phones could collide on would make one phone's re-pairing
/// revoke the other's row, which is the failure this whole mechanism exists to avoid.
String randomInstallId() {
  final bytes = List<int>.generate(16, (_) => Random.secure().nextInt(256));
  return bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
}
