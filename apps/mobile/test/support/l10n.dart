/// Test helpers for the app's language.
///
/// ## Two ways a test can stay English, and which one this suite uses
///
/// `AppLocalizationsX.l10n` falls back to the generated English when no delegate is in the tree
/// (`lib/l10n/l10n.dart`), so the existing widget tests — which pump a screen under a bare
/// `MaterialApp` and assert English literals — keep passing untouched. That is the deliberate
/// choice: rewriting hundreds of assertions to thread a locale would have been churn with no
/// coverage gain, and a screen that renders English under a delegate-less `MaterialApp` is also the
/// behaviour a misconfigured embedder should get.
///
/// This helper is the *other* half: a test that wants a specific language uses [localizedApp],
/// which installs the real delegates and the same fallback resolver the app uses, so a test cannot
/// pass under a resolution rule production does not have.
library;

import 'package:envoydev_mobile/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Wraps [child] in the app's own localization setup at [locale].
///
/// [locale] is passed as `MaterialApp.locale` when concrete; `null` means "resolve the system
/// locale", which is the `system` preference and the path [resolveAppLocale] guards.
Widget localizedApp(Widget child, {Locale? locale}) {
  return MaterialApp(
    locale: locale,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    localeResolutionCallback: resolveAppLocale,
    home: child,
  );
}

/// Pumps [child] at [locale] and settles.
Future<void> pumpLocalized(WidgetTester tester, Widget child, {Locale? locale}) async {
  await tester.pumpWidget(localizedApp(child, locale: locale));
  await tester.pumpAndSettle();
}

/// A catalogued locale by code, for tests that want a language rather than a `Locale`.
AppLocalizations catalogue(String languageCode) =>
    lookupAppLocalizations(Locale(languageCode));
