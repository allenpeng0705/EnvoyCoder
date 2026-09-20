/// Localization, in one place: the supported set, the English fallback, and how a widget reads it.
///
/// ## The seven languages are the desktop's seven
///
/// `en, de, fr, it, ja, ko, zh` come from `AppLocalizations.supportedLocales`, which `gen-l10n`
/// derives from the `app_*.arb` files in this directory. They are the same set the desktop ships
/// (`apps/desktop/src/i18n/locales.ts`), because a German user must not get German on the desktop
/// and English on the phone.
///
/// ## Why [AppLocalizationsX.l10n] can fall back, and why that is not a second catalogue
///
/// The generated `AppLocalizations.of(context)` is non-null and *asserts*: under a `MaterialApp`
/// that forgot `localizationsDelegates` it throws, and so does any widget test that pumps a screen
/// under a bare `MaterialApp`. [AppLocalizationsX.l10n] asks the framework for the delegate's
/// instance and, when there is none, returns the real English catalogue
/// (`lookupAppLocalizations`) rather than a hand-written copy. So the fallback is the *same*
/// generated English a real device uses — there is exactly one English catalogue — and a screen
/// rendered without a delegate shows English instead of crashing. The production `MaterialApp`
/// always installs the delegate, so this path only serves tests and misconfigured embedders.
library;

import 'package:flutter/widgets.dart';

import 'generated/app_localizations.dart';

export 'generated/app_localizations.dart' show AppLocalizations, lookupAppLocalizations;

/// English is the source the ARB files are written in, and the fallback for everything else.
const Locale kFallbackLocale = Locale('en');

/// A language is listed in its **own** language: "German" is no help to a German user, and the
/// desktop's picker uses the same endonyms (`apps/desktop/src/i18n/locales.ts` `LOCALE_LABELS`).
/// These are proper names, never translated, and the keys are the seven language codes.
const Map<String, String> kLocaleEndonyms = {
  'en': 'English',
  'zh': '中文',
  'de': 'Deutsch',
  'fr': 'Français',
  'it': 'Italiano',
  'ja': '日本語',
  'ko': '한국어',
};

/// Reads the app's catalogue from the widget tree, with the generated English as a safe fallback.
///
/// A screen reader announcement or a tooltip is user-facing text too: every call site uses this,
/// including `Semantics(label: ...)` and `Tooltip(message: ...)`, so a German phone does not read
/// English controls aloud.
extension AppLocalizationsX on BuildContext {
  AppLocalizations get l10n =>
      Localizations.of<AppLocalizations>(this, AppLocalizations) ??
      lookupAppLocalizations(kFallbackLocale);
}

/// Resolve the phone's locale to one of the seven, **falling back to English** for anything else.
///
/// `MaterialApp`'s default resolution is "first supported locale" when nothing matches, which today
/// happens to be English only because `l10n.yaml` lists `en` first. This function makes the rule
/// explicit and independent of ARB file ordering: a supported language matches on its language code
/// (so `de_AT` resolves to `de`), and an unsupported system language — Spanish, say — resolves to
/// English. It is passed as `MaterialApp.localeResolutionCallback`, and it is what the "System"
/// language option runs through, because that option is [LocaleController.locale] `== null`.
Locale resolveAppLocale(Locale? systemLocale, Iterable<Locale> supportedLocales) {
  if (systemLocale == null) return kFallbackLocale;
  for (final supported in supportedLocales) {
    if (supported.languageCode == systemLocale.languageCode) return supported;
  }
  return kFallbackLocale;
}
