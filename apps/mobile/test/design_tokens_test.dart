/// The mobile twin of the desktop token sheet, pinned.
///
/// `apps/mobile/lib/theme/tokens.dart` and `apps/desktop/src/design/tokens.css` hold the same values,
/// and nothing generates one from the other. These tests are the cheap guard: they assert the facts a
/// careless edit would break — the accent is the product green, the two status bands are different
/// colours, dark is not light, and the sidebar is darker than the page in dark mode (which is what
/// makes the rail read as a separate plane).
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/theme/tokens.dart';

void main() {
  test('the accent is the product green, in both schemes', () {
    expect(CoderColors.light.accent, const Color(0xFF20744A));
    expect(CoderColors.dark.accent, const Color(0xFF20744A));
  });

  test('the status bands are two bands, not one', () {
    // A dot is 6px with no label, so it is allowed to be louder than an icon beside text.
    expect(CoderColors.dark.statusDotSuccess, isNot(CoderColors.dark.statusSuccess));
    expect(CoderColors.light.statusDotDanger, isNot(CoderColors.light.statusDanger));
    expect(CoderColors.dark.statusDotRunning, const Color(0xFF5CAAF6));
    expect(CoderColors.light.statusDotRunning, const Color(0xFF268AE0));
  });

  test('dark is a different scheme, and its rail sits below the page', () {
    expect(CoderColors.dark.surface0, isNot(CoderColors.light.surface0));
    expect(CoderColors.dark.surfaceSidebar, const Color(0xFF141716));
    expect(CoderColors.dark.surface0, const Color(0xFF181B1A));
    // The rail must be darker than the page it sits beside, in dark mode only.
    expect(
      CoderColors.dark.surfaceSidebar.computeLuminance(),
      lessThan(CoderColors.dark.surface0.computeLuminance()),
    );
  });

  test('the theme builds from tokens, so no screen hardcodes a colour', () {
    final theme = const CoderTheme(CoderColors.dark).toThemeData();
    expect(theme.colorScheme.primary, CoderColors.dark.accent);
    expect(theme.colorScheme.surface, CoderColors.dark.surface0);
    expect(theme.colorScheme.brightness, Brightness.dark);
    expect(theme.scaffoldBackgroundColor, CoderColors.dark.surface0);
    expect(const CoderTheme(CoderColors.light).toThemeData().colorScheme.brightness, Brightness.light);
  });
}
