/// The project mark's two rules, pinned against the desktop's own algorithm.
///
/// The expected values below were produced by running `projectMarkTone` / `projectMark` from
/// `apps/desktop/src/components/CoderSidebar.tsx:153-172` under Node, so this file is a **parity
/// test** between the two copies rather than a restatement of the Dart implementation. If either
/// copy's hash drifts, a repository would change colour when the user moved between the desktop and
/// the phone — which is exactly the failure the shared rule exists to prevent.
library;

import 'package:envoydev_mobile/theme/project_mark.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the mark is the label\'s first character, upper case', () {
    expect(projectMarkLetter('repo a'), 'R');
    expect(projectMarkLetter('envoymesh'), 'E');
    // Leading whitespace is trimmed before the letter is taken, as the desktop's `label.trim()`.
    expect(projectMarkLetter('  payments-api'), 'P');
    // A non-letter is **not** replaced. The desktop substitutes only for an empty label, and inventing
    // a second rule would make one repository read `3` on the desktop and something else here.
    expect(projectMarkLetter('3rd place'), '3');
  });

  test('an empty or all-whitespace label is "?", the desktop\'s fallback', () {
    expect(projectMarkLetter(''), '?');
    expect(projectMarkLetter('   '), '?');
  });

  test('the tone is the desktop\'s `(hash * 31 + unit) >>> 0 % 10`, per project id', () {
    // (index, tone) exactly as the desktop function answers them.
    const expected = <String, (int, ProjectTone)>{
      'local::/repo-a': (8, ProjectTone.amber),
      'local::/repo-b': (9, ProjectTone.blue),
      'local::/envoymesh': (6, ProjectTone.teal),
      'local::/payments-api': (8, ProjectTone.amber),
      'local::/site': (5, ProjectTone.indigo),
      'h::/repo-a': (9, ProjectTone.blue),
      // An astral character. The desktop's `for…of` walks *code points* and `charCodeAt(0)` then reads
      // that code point's leading UTF-16 unit, so only the high surrogate is hashed; iterating
      // `codeUnits` would hash both halves and answer a different tone here.
      'local::/projects/🦄': (9, ProjectTone.blue),
      'local::/projects/日本語': (6, ProjectTone.teal),
    };
    for (final entry in expected.entries) {
      expect(projectToneIndexFor(entry.key), entry.value.$1, reason: entry.key);
      expect(projectToneFor(entry.key), entry.value.$2, reason: entry.key);
    }
  });

  test('the palette is the desktop\'s ten, in MARK_TONES order', () {
    // Order is load-bearing: the index picks by position, so reordering recolours every project.
    expect(
      ProjectTone.values.map((tone) => tone.color).toList(),
      const [
        Color(0xFF7A6AA8), // violet
        Color(0xFF3D7EA6), // sky
        Color(0xFF388068), // emerald
        Color(0xFFA4673A), // orange
        Color(0xFFB05C80), // pink
        Color(0xFF6A70B8), // indigo
        Color(0xFF368080), // teal
        Color(0xFFB06260), // red
        Color(0xFF8F7838), // amber
        Color(0xFF5179B0), // blue
      ],
    );
    // The desktop's own fixture check: three projects, three tones.
    expect(
      const ['local::/envoymesh', 'local::/payments-api', 'local::/site']
          .map(projectToneFor)
          .toSet()
          .length,
      3,
    );
  });

  testWidgets('the tile is 22×22, the letter in white on the project tone', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Center(child: ProjectMark(projectId: 'local::/envoymesh', label: 'envoymesh')),
        ),
      ),
    );

    final container = tester.widget<Container>(
      find.descendant(of: find.byType(ProjectMark), matching: find.byType(Container)),
    );
    expect(container.constraints?.maxWidth, 22);
    expect(container.constraints?.maxHeight, 22);
    expect((container.decoration as BoxDecoration).color, ProjectTone.teal.color);
    expect((container.decoration as BoxDecoration).borderRadius, BorderRadius.circular(6));

    final letter = tester.widget<Text>(
      find.descendant(of: find.byType(ProjectMark), matching: find.byType(Text)),
    );
    expect(letter.data, 'E');
    expect(letter.style?.color, projectMarkForeground);
    expect(letter.style?.fontSize, 13);
    expect(letter.style?.fontWeight, FontWeight.w600);

    // Decorative, like the desktop's `aria-hidden`: the row's own title already names the project, so
    // the tile must not add a second "E" to a screen reader's reading of the row.
    expect(find.bySemanticsLabel('E'), findsNothing);
  });
}
