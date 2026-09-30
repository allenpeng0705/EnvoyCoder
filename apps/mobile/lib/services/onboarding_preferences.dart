/// First-launch welcome slides + setup-guide completion flags.
library;

import 'package:shared_preferences/shared_preferences.dart';

import '../l10n/locale_controller.dart';
import 'install_id.dart';

class OnboardingPreferences {
  static const slidesKey = 'envoydev.onboarding.slides_completed';
  static const guideKey = 'envoydev.onboarding.guide_completed';

  /// Set once the first-run migration has decided whether to skip onboarding for
  /// an install that already had EnvoyDev state before this feature shipped.
  static const introducedKey = 'envoydev.onboarding.introduced';

  /// Hosts prefs key — same string as `HostStore` (`envoydev.hosts.v1`). Checked
  /// here so upgrades that already paired skip the new first-run flow.
  static const _hostsKey = 'envoydev.hosts.v1';
  static const _activeHostKey = 'envoydev.active-host.v1';

  static Future<bool> hasCompletedSlides() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(slidesKey) ?? false;
  }

  static Future<void> setSlidesCompleted() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(slidesKey, true);
  }

  static Future<bool> hasCompletedGuide() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(guideKey) ?? false;
  }

  static Future<void> setGuideCompleted() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(guideKey, true);
  }

  /// One-shot: existing installs must not re-see first-run slides after an update.
  ///
  /// Fresh installs have empty prefs → onboarding runs. Upgrades that already
  /// hold hosts, a language choice, or an install id skip it. Explicit slide/
  /// guide flags always win once set.
  static Future<void> migrateExistingInstallIfNeeded() async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.containsKey(introducedKey)) return;
    if (prefs.containsKey(slidesKey) || prefs.containsKey(guideKey)) {
      await prefs.setBool(introducedKey, true);
      return;
    }

    final prior = prefs.containsKey(_hostsKey) ||
        prefs.containsKey(_activeHostKey) ||
        prefs.containsKey(kLanguagePreferenceKey) ||
        prefs.containsKey(kInstallIdKey);
    if (prior) {
      await prefs.setBool(slidesKey, true);
      await prefs.setBool(guideKey, true);
    }
    await prefs.setBool(introducedKey, true);
  }
}
