/// The project mark: the letter tile the desktop rail puts in front of a project's name.
///
/// **This is a copy of the desktop, on purpose, and here is what was copied.** The desktop keeps the
/// label rule and the tone hash in `apps/desktop/src/components/CoderSidebar.tsx:153-172`
/// (`projectMark`, `projectMarkTone`, `MARK_TONES`) and the ten fills, the shape and the type in
/// `apps/desktop/src/styles.css:565-590`. Neither is reachable from Dart — one is TypeScript in
/// another app, the other is a CSS rule — and no shared token sheet holds the ten tones: they are
/// literal hexes in that stylesheet, *not* in `design/tokens.css`, which is the only sheet this app
/// twins. So the ten values are duplicated here rather than imported, and `project_mark_test.dart`
/// pins the hash-to-tone mapping so the two copies cannot drift without a test going red.
///
/// **No light/dark variant exists to mirror.** The desktop defines the ten tones once, under no
/// `[data-theme]` selector — they are deliberately muted mid-tones carrying white text at about
/// 4.5:1 either way ("a saturated swatch would shout over the status colours", `styles.css:579-580`).
/// The phone therefore uses the same ten in both schemes, which is what matching the desktop means.
library;

import 'package:flutter/material.dart';

import 'tokens.dart';

/// `MARK_TONES` (`CoderSidebar.tsx:164`), in order — the declaration order *is* the palette index.
///
/// An enum rather than a name-to-colour map so the palette, the tone's name and `data-tone`'s mobile
/// counterpart cannot get out of step, and so a test can say "these three ids pick three tones".
enum ProjectTone {
  violet(Color(0xFF7A6AA8)),
  sky(Color(0xFF3D7EA6)),
  emerald(Color(0xFF388068)),
  orange(Color(0xFFA4673A)),
  pink(Color(0xFFB05C80)),
  indigo(Color(0xFF6A70B8)),
  teal(Color(0xFF368080)),
  red(Color(0xFFB06260)),
  amber(Color(0xFF8F7838)),
  blue(Color(0xFF5179B0));

  const ProjectTone(this.color);

  /// The fill, exactly the hex `styles.css:581-590` assigns to this tone.
  final Color color;
}

/// The badge's foreground: the desktop's `#ffffff` (`styles.css:573`). Named rather than inlined so
/// the tile below is the one place that paints it.
const Color projectMarkForeground = Color(0xFFFFFFFF);

/// The desktop's `projectMarkTone(id)` (`CoderSidebar.tsx:166-172`), returning the tone itself.
ProjectTone projectToneFor(String id) => ProjectTone.values[projectToneIndexFor(id)];

/// The palette index for a project id — the half worth testing, because it is arithmetic.
///
/// `hash = (hash * 31 + character.charCodeAt(0)) >>> 0`, over `for (const character of id)`. Three
/// details are load-bearing for "the same project has the same colour on both surfaces":
///
///   * the `& 0xFFFFFFFF` **is** JavaScript's `>>> 0`. Dart's ints are 64-bit and would not wrap on
///     their own, so without the mask the two languages part company after about six characters —
///     which is every real project id (`hostId::/path`, `packages/task-model/src/index.ts:40-43`).
///   * `for…of` walks **code points**, and `charCodeAt(0)` then reads that code point's *leading*
///     UTF-16 unit. An astral character (an emoji in a folder name) therefore contributes its high
///     surrogate only; iterating `id.codeUnits` would add both halves and choose a different tone.
///   * the divisor is the palette length, so extending the palette reshuffles existing projects —
///     which is why the ten are frozen to the desktop's list rather than "ten more we liked".
int projectToneIndexFor(String id) {
  var hash = 0;
  for (final rune in id.runes) {
    final unit = rune > 0xFFFF ? 0xD800 + ((rune - 0x10000) >> 10) : rune;
    hash = (hash * 31 + unit) & 0xFFFFFFFF;
  }
  return hash % ProjectTone.values.length;
}

/// The mark's letter: the label's first character, upper-cased (`CoderSidebar.tsx:154-157`).
///
/// The `?` fallback is for a label with **nothing in it**, and only for that. A label that starts
/// with a digit or a punctuation mark keeps that character — the desktop does not substitute for
/// non-letters, and inventing a different rule here would make one repo read `?` on the phone and
/// `3` on the desktop.
String projectMarkLetter(String label) {
  final trimmed = label.trim();
  if (trimmed.isEmpty) return '?';
  return trimmed.substring(0, 1).toUpperCase();
}

/// The 22×22 tile: the letter, upper case, on the project's tone.
///
/// Shape and type are the desktop's `styles.css:565-577`: 22×22, a 6pt radius (this app's
/// `CoderRadius.md`), and a 13pt/600 white letter on line-height 1.
///
/// [ExcludeSemantics] is the desktop's `aria-hidden` (`CoderSidebar.tsx:311`): the row's own title
/// already names the project, and a screen reader announcing "R" before "Repo A" is noise, not
/// information. This is why the tile carries no tooltip of its own — it is not a control.
class ProjectMark extends StatelessWidget {
  const ProjectMark({super.key, required this.projectId, required this.label});

  /// What the tone is derived from. Its **id**, not its label: a rename must not recolour the row,
  /// and a reload must not reshuffle the list (`CoderSidebar.tsx:160-161`).
  final String projectId;

  final String label;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: Container(
        width: 22,
        height: 22,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: projectToneFor(projectId).color,
          borderRadius: BorderRadius.circular(CoderRadius.md),
        ),
        child: Text(
          projectMarkLetter(label),
          style: const TextStyle(
            color: projectMarkForeground,
            fontSize: 13,
            fontWeight: FontWeight.w600,
            height: 1,
          ),
        ),
      ),
    );
  }
}
