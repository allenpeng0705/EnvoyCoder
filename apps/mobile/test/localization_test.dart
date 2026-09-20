/// The localization contract, asserted rather than assumed.
///
/// Five things have to stay true for the feature to be worth shipping, and each gets a test here:
/// an unsupported system language falls back to English; a supported one renders its catalogue;
/// Settings → Language actually moves the UI; plurals are real plurals; and a screen reader gets
/// the user's language too (a `Semantics` label or tooltip left in English is the same defect as
/// untranslated text).
library;

import 'package:envoydev_mobile/l10n/l10n.dart';
import 'package:envoydev_mobile/l10n/locale_controller.dart';
import 'package:envoydev_mobile/main.dart';
import 'package:envoydev_mobile/screens/no_hosts_screen.dart';
import 'package:envoydev_mobile/widgets/composer_attach.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/l10n.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('locale resolution', () {
    test('an unsupported system language falls back to English, a supported one does not', () {
      const supported = AppLocalizations.supportedLocales;
      // Spanish is not one of the seven; a phone set to it must get English, not a crash and not a
      // best-effort match on some unrelated catalogue.
      expect(resolveAppLocale(const Locale('es'), supported), const Locale('en'));
      expect(resolveAppLocale(const Locale('es', 'MX'), supported), const Locale('en'));
      // A supported language matches on its language code, so a regional variant resolves too.
      expect(resolveAppLocale(const Locale('de', 'AT'), supported), const Locale('de'));
      expect(resolveAppLocale(const Locale('ja'), supported), const Locale('ja'));
      // No system answer at all — the null case — is English.
      expect(resolveAppLocale(null, supported), const Locale('en'));
    });

    testWidgets('a phone set to an unsupported locale renders English', (tester) async {
      tester.binding.platformDispatcher.localeTestValue = const Locale('es');
      addTearDown(tester.binding.platformDispatcher.clearLocaleTestValue);

      // `locale: null` is the "System" preference, so this goes through the same
      // `localeResolutionCallback` production does.
      await pumpLocalized(tester, NoHostsScreen(onAddHost: () {}));

      final context = tester.element(find.byType(NoHostsScreen));
      expect(Localizations.localeOf(context), const Locale('en'));
      expect(find.text('No desktop paired yet'), findsOneWidget);
    });
  });

  group('a supported non-English locale', () {
    testWidgets('renders its own catalogue, not the English source', (tester) async {
      await pumpLocalized(tester, NoHostsScreen(onAddHost: () {}), locale: const Locale('de'));

      expect(find.text('Noch kein Rechner gekoppelt'), findsOneWidget);
      expect(find.text('No desktop paired yet'), findsNothing);
      // The button is translated too — the empty state leads forward in German as well.
      expect(find.widgetWithText(FilledButton, 'Host hinzufügen'), findsOneWidget);
    });

    testWidgets('localizes an icon-only control\'s tooltip and Semantics', (tester) async {
      // The attach button's whole meaning is a glyph, so its tooltip is the only label a screen
      // reader or a long-press has. In German it must not read "Attach".
      await pumpLocalized(
        tester,
        Scaffold(
          body: AttachMenuButton(
            enabled: true,
            onImage: () {},
            onPaste: () {},
            onFile: () {},
          ),
        ),
        locale: const Locale('de'),
      );

      expect(find.byTooltip('Anhängen'), findsOneWidget);
      expect(find.byTooltip('Attach'), findsNothing);
    });
  });

  group('plurals', () {
    test('render the singular and the plural form, in English and in a translated locale', () {
      final en = catalogue('en');
      final de = catalogue('de');

      // English used to be concatenated as "$count file(s)"; the ICU form must produce both.
      expect(en.runNoteDiff(1), '1 file changed.');
      expect(en.runNoteDiff(4), '4 files changed.');
      expect(de.runNoteDiff(1), '1 Datei geändert.');
      expect(de.runNoteDiff(4), '4 Dateien geändert.');

      // The attachment cap is a sentence about a number, so it is a plural too.
      expect(de.attachLimit(1), 'Du kannst 1 Datei anhängen.');
      expect(de.attachLimit(8), 'Du kannst höchstens 8 Dateien anhängen.');

      expect(de.connectionsCount(1), '1 Rechner');
      expect(de.connectionsCount(2), '2 Rechner');
    });
  });

  group('Settings → Language', () {
    testWidgets('changes the phone UI and persists the preference', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final preferences = await SharedPreferences.getInstance();
      final controller = LocaleController(preferences: preferences);

      await tester.pumpWidget(EnvoyDevApp(localeController: controller));
      await tester.pumpAndSettle();

      // English to begin with: the default preference is "system", and the test platform is en.
      expect(find.text('No desktop paired yet'), findsOneWidget);

      // This is exactly what the Settings picker calls.
      await controller.setPreference('de');
      await tester.pumpAndSettle();

      expect(find.text('Noch kein Rechner gekoppelt'), findsOneWidget);
      expect(find.text('No desktop paired yet'), findsNothing);
      expect(preferences.getString(kLanguagePreferenceKey), 'de');

      // And back, because a language the user cannot leave is not a setting.
      await controller.setPreference('system');
      await tester.pumpAndSettle();
      expect(find.text('No desktop paired yet'), findsOneWidget);
      expect(preferences.getString(kLanguagePreferenceKey), isNull);
    });

    testWidgets('an unknown stored preference is ignored rather than applied', (tester) async {
      SharedPreferences.setMockInitialValues({kLanguagePreferenceKey: 'xx'});
      final controller = LocaleController(preferences: await SharedPreferences.getInstance());
      await controller.load();

      expect(controller.preference, kSystemLanguagePreference);
    });
  });
}
