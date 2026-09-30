/// First-launch onboarding prefs: upgrade migration must not re-show slides.
library;

import 'package:envoydev_mobile/l10n/locale_controller.dart';
import 'package:envoydev_mobile/services/install_id.dart';
import 'package:envoydev_mobile/services/onboarding_preferences.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('fresh install still shows onboarding after migration', () async {
    SharedPreferences.setMockInitialValues({});
    await OnboardingPreferences.migrateExistingInstallIfNeeded();
    expect(await OnboardingPreferences.hasCompletedSlides(), isFalse);
    expect(await OnboardingPreferences.hasCompletedGuide(), isFalse);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool(OnboardingPreferences.introducedKey), isTrue);
  });

  test('upgrade with prior hosts skips onboarding', () async {
    SharedPreferences.setMockInitialValues({
      'envoydev.hosts.v1': '[]',
    });
    await OnboardingPreferences.migrateExistingInstallIfNeeded();
    expect(await OnboardingPreferences.hasCompletedSlides(), isTrue);
    expect(await OnboardingPreferences.hasCompletedGuide(), isTrue);
  });

  test('upgrade with language preference skips onboarding', () async {
    SharedPreferences.setMockInitialValues({
      kLanguagePreferenceKey: 'zh',
    });
    await OnboardingPreferences.migrateExistingInstallIfNeeded();
    expect(await OnboardingPreferences.hasCompletedSlides(), isTrue);
    expect(await OnboardingPreferences.hasCompletedGuide(), isTrue);
  });

  test('upgrade with install id skips onboarding', () async {
    SharedPreferences.setMockInitialValues({
      kInstallIdKey: 'already-installed-id',
    });
    await OnboardingPreferences.migrateExistingInstallIfNeeded();
    expect(await OnboardingPreferences.hasCompletedSlides(), isTrue);
    expect(await OnboardingPreferences.hasCompletedGuide(), isTrue);
  });

  test('migration is one-shot and does not flip completed flags later', () async {
    SharedPreferences.setMockInitialValues({});
    await OnboardingPreferences.migrateExistingInstallIfNeeded();
    expect(await OnboardingPreferences.hasCompletedSlides(), isFalse);

    // A later host write must not retroactively skip — migration already ran.
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('envoydev.hosts.v1', '[]');
    await OnboardingPreferences.migrateExistingInstallIfNeeded();
    expect(await OnboardingPreferences.hasCompletedSlides(), isFalse);
  });
}
