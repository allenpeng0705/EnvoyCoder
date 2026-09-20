/// The gate that keeps this app localized: no user-facing string may be a Dart literal.
///
/// ## Why a test and not a lint rule
///
/// The family already has gates for peers, wiring, docs and module size, and this is the same idea
/// one level down: a rule that is only in a contributor's head is a rule that decays. It runs under
/// `flutter test`, so it is part of the same command as the rest of the suite — there is no second
/// thing to remember.
///
/// ## What it looks at
///
/// A string is *user-facing* when it is written where the UI will render it: a `Text`, a tooltip, a
/// screen-reader `Semantics` label, a field's `label`/`hint`/`helper`, a dialog's `message`. The
/// scan reads those positions only, so a literal in a log line, an exception, an RPC method name or
/// a storage key is deliberately **not** a defect — the repo's rule is that an error addressed to
/// an engineer stays developer English (`AGENTS.md` #5).
///
/// Interpolation is stripped before the letter test: `Text('$index. ')` is data plus punctuation,
/// not a sentence, and it is allowed. That leaves actual words, which must come from
/// `context.l10n.<key>`.
///
/// ## The pending list
///
/// Three files are still being migrated in a concurrent change and are listed in
/// [_pendingMigration]. The list is the honest half of the gate: it is empty when the migration is
/// done, and adding a file to it is a visible decision rather than a silent exception. Nothing else
/// may be added — a new screen with an English literal fails here.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Files still to migrate. **Empty**: every screen reads its text through `context.l10n`. An entry
/// here is a debt and a visible decision, not an exemption — add one only with a note saying who
/// owns the migration.
const Set<String> _pendingMigration = {};

/// Literals that are not sentences and must not be fed to a translator: units, separators and the
/// two prompt markers the agent protocol uses. Each is here because it is data, not language — if
/// one ever becomes prose, it belongs in the ARB instead.
const Set<String> _notProse = {
  'ms',
};

/// Where a rendered string lives. Kept as a list of patterns so adding a control shape is one line.
final List<RegExp> _uiPositions = [
  RegExp(r'''\bText\(\s*(?:const\s+)?('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")'''),
  RegExp(r'''\btooltip:\s*(?:const\s+)?('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")'''),
  RegExp(r'''\blabel:\s*(?:const\s+)?('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")'''),
  RegExp(r'''\blabelText:\s*(?:const\s+)?('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")'''),
  RegExp(r'''\bhintText:\s*(?:const\s+)?('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")'''),
  RegExp(r'''\bhelperText:\s*(?:const\s+)?('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")'''),
  RegExp(r'''\bmessage:\s*(?:const\s+)?('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")'''),
  RegExp(r'''\bdeleteButtonTooltipMessage:\s*(?:const\s+)?('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")'''),
];

/// The literal with its interpolations removed, so only its own words are left.
String _withoutInterpolation(String body) =>
    body.replaceAll(RegExp(r'\$\{[^}]*\}'), '').replaceAll(RegExp(r'\$[A-Za-z_]\w*'), '');

void main() {
  test('no user-facing string is hardcoded in Dart', () {
    final lib = Directory('lib');
    expect(lib.existsSync(), isTrue, reason: 'run from apps/mobile');

    final offences = <String>[];
    for (final entity in lib.listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      final path = entity.path.replaceAll(r'\', '/');
      // Generated catalogues are the strings, and the l10n helper is the resolver.
      if (path.startsWith('lib/l10n/generated/')) continue;
      if (_pendingMigration.contains(path)) continue;

      final lines = entity.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        final trimmed = line.trimLeft();
        if (trimmed.startsWith('//') || trimmed.startsWith('///') || trimmed.startsWith('*')) {
          continue;
        }
        for (final pattern in _uiPositions) {
          final match = pattern.firstMatch(line);
          if (match == null) continue;
          final literal = match.group(1)!;
          final body = literal.substring(1, literal.length - 1);
          // A slash command is a token the agent published, not a sentence: `/name args` is
          // assembled from the daemon's own command list, and the literal is only the separator.
          if (body.startsWith('/')) continue;
          final prose = _withoutInterpolation(body);
          if (!RegExp(r'[A-Za-z]').hasMatch(prose)) continue;
          if (_notProse.contains(prose.trim())) continue;
          if (literal.startsWith('r')) continue;
          offences.add('$path:${i + 1}  $literal');
        }
      }
    }

    expect(
      offences,
      isEmpty,
      reason: 'These strings are rendered but not localized. Move each into lib/l10n/app_en.arb '
          '(and every other app_*.arb), then read it as context.l10n.<key>:\n'
          '${offences.join('\n')}',
    );
  });
}
