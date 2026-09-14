/// EnvoyCoder design tokens — mobile (Flutter).
///
/// The **same design** as the desktop app, in Flutter's own idiom: Paseo's values, our code. The
/// desktop sheet is `apps/desktop/src/design/tokens.css`; this file is its twin, and the two must be
/// changed together — `docs/design-tokens.md` is the list of values and where each came from
/// (Paseo v0.8.0 `packages/app/src/styles/theme.ts`, Apache-2.0; no Paseo code is used anywhere).
///
/// Why a hand-written file instead of a generated one: Flutter needs *typed* colours and text styles,
/// and the ramp is small enough that a source-of-truth generator would be more machinery than the
/// values are worth. The tests in `test/design_tokens_test.dart` pin the facts that matter (the accent
/// is the green, the two status bands differ, dark differs from light) so the twin cannot drift
/// silently.
library;

import 'package:flutter/material.dart';

/// Colours, per scheme. Names mirror the CSS custom properties one-for-one.
class CoderColors {
  const CoderColors({
    required this.surface0,
    required this.surface1,
    required this.surface2,
    required this.surface3,
    required this.surface4,
    required this.surfaceSidebar,
    required this.foreground,
    required this.foregroundMuted,
    required this.foregroundExtraMuted,
    required this.border,
    required this.borderAccent,
    required this.accent,
    required this.accentBright,
    required this.accentForeground,
    required this.destructive,
    required this.statusSuccess,
    required this.statusDanger,
    required this.statusWarning,
    required this.statusMerged,
    required this.statusDotSuccess,
    required this.statusDotDanger,
    required this.statusDotWarning,
    required this.statusDotRunning,
  });

  final Color surface0;
  final Color surface1;
  final Color surface2;
  final Color surface3;
  final Color surface4;
  final Color surfaceSidebar;
  final Color foreground;
  final Color foregroundMuted;
  final Color foregroundExtraMuted;
  final Color border;
  final Color borderAccent;

  /// The brand colour: a green, not a blue.
  final Color accent;
  final Color accentBright;
  final Color accentForeground;
  final Color destructive;

  /// Band 1 — icons, badges, diff stats.
  final Color statusSuccess;
  final Color statusDanger;
  final Color statusWarning;
  final Color statusMerged;

  /// Band 2 — the 6pt status dots. Deliberately louder than band 1.
  final Color statusDotSuccess;
  final Color statusDotDanger;
  final Color statusDotWarning;
  final Color statusDotRunning;

  static const CoderColors light = CoderColors(
    surface0: Color(0xFFFFFFFF),
    surface1: Color(0xFFFAFAFA),
    surface2: Color(0xFFF4F4F5),
    surface3: Color(0xFFE4E4E7),
    surface4: Color(0xFFD4D4D8),
    surfaceSidebar: Color(0xFFF4F4F5),
    foreground: Color(0xFF1A1A1E),
    foregroundMuted: Color(0xFF71717A),
    foregroundExtraMuted: Color(0xFFA1A1AA),
    border: Color(0xFFE4E4E7),
    borderAccent: Color(0xFFECECF1),
    accent: Color(0xFF20744A),
    accentBright: Color(0xFF239956),
    accentForeground: Color(0xFFFFFFFF),
    destructive: Color(0xFFB04138),
    statusSuccess: Color(0xFF3E704A),
    statusDanger: Color(0xFF9D433B),
    statusWarning: Color(0xFF7B5D39),
    statusMerged: Color(0xFF7347AF),
    statusDotSuccess: Color(0xFF299F51),
    statusDotDanger: Color(0xFFF12E2F),
    statusDotWarning: Color(0xFFB37824),
    statusDotRunning: Color(0xFF268AE0),
  );

  /// Paseo's default dark variant ("paseo"), which is the one the desktop sheet defaults to.
  static const CoderColors dark = CoderColors(
    surface0: Color(0xFF181B1A),
    surface1: Color(0xFF1E2120),
    surface2: Color(0xFF272A29),
    surface3: Color(0xFF434645),
    surface4: Color(0xFF595B5B),
    surfaceSidebar: Color(0xFF141716),
    foreground: Color(0xFFFAFAFA),
    foregroundMuted: Color(0xFFA1A5A4),
    foregroundExtraMuted: Color(0xFF717574),
    border: Color(0xFF252B2A),
    borderAccent: Color(0xFF2F3534),
    accent: Color(0xFF20744A),
    accentBright: Color(0xFF7CCBA0),
    accentForeground: Color(0xFFFFFFFF),
    destructive: Color(0xFFC64F43),
    statusSuccess: Color(0xFF6CB17B),
    statusDanger: Color(0xFFD8847B),
    statusWarning: Color(0xFFC09664),
    statusMerged: Color(0xFFA890D5),
    statusDotSuccess: Color(0xFF35C264),
    statusDotDanger: Color(0xFFF7796D),
    statusDotWarning: Color(0xFFDB932E),
    statusDotRunning: Color(0xFF5CAAF6),
  );
}

/// The scales. Only the values the phone actually uses are here; the desktop sheet has the rest.
class CoderSpace {
  static const double xs = 2;
  static const double sm = 4;
  static const double sm2 = 6;
  static const double md = 8;
  static const double md2 = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xl2 = 32;
}

class CoderRadius {
  static const double sm = 2;
  static const double base = 4;
  static const double md = 6;
  static const double lg = 8;
  static const double xl = 12;
  static const double xl2 = 16;
}

/// Builds the app theme from the tokens, so a screen never hardcodes a colour.
///
/// The mapping is deliberately thin: Material's names are not ours, and pretending otherwise is how a
/// design system ends up with two vocabularies. Anything Material does not have a slot for (the status
/// bands, the sidebar surfaces) is read from `CoderColors` directly through [CoderTheme.of].
class CoderTheme {
  const CoderTheme(this.colors);

  final CoderColors colors;

  ThemeData toThemeData() {
    final scheme = ColorScheme(
      brightness: colors.surface0.computeLuminance() < 0.5 ? Brightness.dark : Brightness.light,
      primary: colors.accent,
      onPrimary: colors.accentForeground,
      secondary: colors.accentBright,
      onSecondary: colors.accentForeground,
      error: colors.statusDanger,
      onError: colors.accentForeground,
      surface: colors.surface0,
      onSurface: colors.foreground,
      outline: colors.border,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: colors.surface0,
      canvasColor: colors.surface1,
      dividerColor: colors.border,
      fontFamily: null, // system UI face, as on the desktop
      textTheme: TextTheme(
        bodyMedium: TextStyle(fontSize: 14, color: colors.foreground),
        // Chat text and rendered markdown, one step larger than the UI baseline.
        bodyLarge: TextStyle(fontSize: 15, color: colors.foreground),
        labelSmall: TextStyle(fontSize: 12, color: colors.foregroundMuted),
        titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: colors.foreground),
      ),
      focusColor: colors.accent,
      dividerTheme: DividerThemeData(color: colors.border, thickness: 1, space: 1),
      cardTheme: CardThemeData(
        color: colors.surface1,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(CoderRadius.lg),
          side: BorderSide(color: colors.border),
        ),
      ),
    );
  }

  /// Which token set to use for the current platform brightness.
  static CoderColors of(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? CoderColors.dark : CoderColors.light;
}
