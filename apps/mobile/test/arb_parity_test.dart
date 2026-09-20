/// The ARB catalogues must stay in lockstep: seven languages, one key set, one set of placeholders.
///
/// `gen-l10n` is forgiving in a way that hides a mistake: a key missing from a translation is not a
/// build failure, it simply falls back to English at runtime — so a German user reads one English
/// sentence and nobody notices until they do. This test is the hard edge that makes a missing or
/// malformed translation fail the suite instead.
///
/// It reads the ARB files as data (they are the source of truth; the generated Dart in
/// `lib/l10n/generated/` is committed only so `flutter analyze` works on a clean checkout).
library;

import 'dart:convert';
import 'dart:io';

import 'package:envoydev_mobile/l10n/l10n.dart';
import 'package:flutter_test/flutter_test.dart';

/// The seven the desktop ships, in the order the fallback list uses.
const List<String> _locales = ['en', 'de', 'fr', 'it', 'ja', 'ko', 'zh'];

Map<String, String> _messages(String locale) {
  final file = File('lib/l10n/app_$locale.arb');
  expect(file.existsSync(), isTrue, reason: '${file.path} is missing');
  final decoded = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  return {
    for (final entry in decoded.entries)
      if (!entry.key.startsWith('@')) entry.key: entry.value as String,
  };
}

/// The **real** placeholders in a message: `{name}` or `{name,` — never the first word of an ICU
/// branch body, which `r'\{(\w+)'` would wrongly capture (that bug made every correct translation
/// look broken while this migration was being verified).
Set<String> _placeholders(String message) => RegExp(r'\{([A-Za-z_][A-Za-z0-9_]*)\s*[,}]')
    .allMatches(message)
    .map((m) => m.group(1)!)
    .toSet();

/// True when [marker] (an ICU branch opener) is followed by some branch text before its first `}`.
bool _branchHasText(String message, String marker) {
  final at = message.indexOf(marker);
  if (at < 0) return false;
  final rest = message.substring(at + marker.length);
  return rest.indexOf('}') > 0;
}

void main() {
  test('every catalogue has exactly the English key set', () {
    final english = _messages('en');
    expect(english, isNotEmpty);

    for (final locale in _locales) {
      final messages = _messages(locale);
      expect(
        messages.keys.toSet(),
        english.keys.toSet(),
        reason: '$locale.arb does not match en.arb — a key added to one and not the other either '
            'throws at build time (extra) or silently renders English (missing)',
      );
    }
  });

  test('every translation keeps the English placeholders', () {
    final english = _messages('en');
    for (final locale in _locales.where((l) => l != 'en')) {
      final messages = _messages(locale);
      for (final key in english.keys) {
        expect(
          _placeholders(messages[key]!),
          _placeholders(english[key]!),
          reason: '$locale.$key lost or renamed a placeholder',
        );
      }
    }
  });

  test('every ICU plural keeps its plural shape in every language', () {
    final english = _messages('en');
    final plurals = english.entries.where((e) => e.value.contains(', plural,'));
    expect(plurals, isNotEmpty, reason: 'the suite is supposed to have plural messages');

    for (final locale in _locales.where((l) => l != 'en')) {
      final messages = _messages(locale);
      for (final plural in plurals) {
        final translated = messages[plural.key]!;
        expect(
          translated,
          contains(', plural,'),
          reason: '$locale.${plural.key} dropped the ICU plural form',
        );
        // Both branches must still carry text: `=1{} other{}` would render an empty string.
        expect(
          _branchHasText(translated, '=1{'),
          isTrue,
          reason: '$locale.${plural.key} has an empty singular branch',
        );
        expect(
          _branchHasText(translated, 'other{'),
          isTrue,
          reason: '$locale.${plural.key} has an empty plural branch',
        );
      }
    }
  });

  test('the ARB locale is exactly the seven the desktop ships', () {
    expect(
      AppLocalizations.supportedLocales.map((l) => l.languageCode).toList(),
      _locales,
    );
  });
}
