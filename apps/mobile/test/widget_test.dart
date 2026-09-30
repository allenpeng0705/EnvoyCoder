// Where the app opens, and what a phone with no paired desktop sees.
//
// This file used to assert the *host list* as the entry screen. The owner's restructure moved that:
// the project list for the active host is first now. The zero-host case is the one part of the entry
// contract that is still decided here, and it is pinned hard — an empty state with no way forward was
// one of the two things the ask called out by name.
//
// First-launch onboarding (slides + setup guide) is skipped here by marking those prefs complete —
// those screens have their own coverage path; this file pins the empty-host shell.

import 'package:envoydev_mobile/main.dart';
import 'package:envoydev_mobile/screens/no_hosts_screen.dart';
import 'package:envoydev_mobile/services/onboarding_preferences.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({
      OnboardingPreferences.slidesKey: true,
      OnboardingPreferences.guideKey: true,
      OnboardingPreferences.introducedKey: true,
    });
  });

  testWidgets('with no host paired, the app opens on an empty state that leads to Add host',
      (tester) async {
    await tester.pumpWidget(const EnvoyDevApp());
    await tester.pumpAndSettle();

    expect(find.byType(NoHostsScreen), findsOneWidget);
    expect(find.text('No desktop paired yet'), findsOneWidget);
    // The whole point of the state: there is a button, not just a sentence.
    expect(find.widgetWithText(FilledButton, 'Add host'), findsOneWidget);
    // And it is not the old entry point — nothing here lists connections.
    expect(find.text('Connections'), findsNothing);
  });

  testWidgets('the empty state does not offer the removed New-task button', (tester) async {
    await tester.pumpWidget(const EnvoyDevApp());
    await tester.pumpAndSettle();

    expect(find.byType(FloatingActionButton), findsNothing);
    expect(find.text('New task'), findsNothing);
  });

  testWidgets('first launch shows welcome slides before the empty shell', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const EnvoyDevApp());
    await tester.pumpAndSettle();

    expect(find.text('Welcome to EnvoyDev'), findsOneWidget);
    expect(find.byType(NoHostsScreen), findsNothing);
  });
}
