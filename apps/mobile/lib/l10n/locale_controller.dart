/// The phone's own language preference — a setting of this device, not of the paired daemon.
///
/// ## Why it is phone-local *and* written to the daemon
///
/// The same `language` value already exists daemon-side (`coder.updateSettings`), because the
/// desktop window reads it and speaks the user's language too. The phone's UI, however, cannot
/// depend on an RPC: it has to render before any daemon answers, offline, and on the very screen
/// that pairs a machine. So the preference is stored here first, in `SharedPreferences`, and applied
/// immediately; `SettingsScreen` additionally writes it to the daemon on a best-effort basis so the
/// two halves agree. If that write fails the phone keeps the language the user picked and says so —
/// rolling the UI back would be a worse lie than a desktop that is one save behind.
///
/// ## `system` is a preference, not a locale
///
/// [preference] is `system` or one of the seven language codes. [locale] is `null` for `system`,
/// which is what makes `MaterialApp` follow the phone — and run the system locale through
/// [resolveAppLocale]'s English fallback when the phone speaks a language we do not ship.
library;

import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'l10n.dart';

/// The stored value that means "follow the phone".
const String kSystemLanguagePreference = 'system';

/// Namespaced so it cannot collide with the host store's keys in the same preferences file.
const String kLanguagePreferenceKey = 'envoydev.language';

class LocaleController extends ChangeNotifier {
  LocaleController({
    String preference = kSystemLanguagePreference,
    SharedPreferences? preferences,
  })  : _preference = preference,
        _preferences = preferences;

  String _preference;
  final SharedPreferences? _preferences;

  /// `system` or a language code. Never anything else: [setPreference] refuses an unknown code.
  String get preference => _preference;

  /// What `MaterialApp.locale` should be: `null` means "resolve the system locale".
  Locale? get locale =>
      _preference == kSystemLanguagePreference ? null : Locale(_preference);

  /// Read the stored preference, if any. Safe to call once at startup; a corrupt or unknown stored
  /// value is ignored rather than applied, so an older build's value cannot put the app in a
  /// language this build does not have.
  Future<void> load() async {
    final preferences = _preferences ?? await SharedPreferences.getInstance();
    final stored = preferences.getString(kLanguagePreferenceKey);
    if (stored == null || !_isOffered(stored) || stored == _preference) return;
    _preference = stored;
    notifyListeners();
  }

  /// Apply a language now, then persist it. Notifies before the disk write so the UI does not wait
  /// on I/O to change language.
  Future<void> setPreference(String value) async {
    if (!_isOffered(value) || value == _preference) return;
    _preference = value;
    notifyListeners();
    final preferences = _preferences ?? await SharedPreferences.getInstance();
    if (value == kSystemLanguagePreference) {
      await preferences.remove(kLanguagePreferenceKey);
    } else {
      await preferences.setString(kLanguagePreferenceKey, value);
    }
  }

  /// `system`, or a code this build actually ships a catalogue for.
  static bool _isOffered(String value) {
    if (value == kSystemLanguagePreference) return true;
    return AppLocalizations.supportedLocales
        .any((locale) => locale.languageCode == value);
  }
}
