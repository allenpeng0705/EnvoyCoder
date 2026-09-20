// The daemon's keyed prose on the phone: resolved where this build can, stripped always.
//
// The defect this file exists for was on screen: the daemon sends a sentence *plus* its catalogue key,
// glued together by the protocol (` [envoydev.key] {"key":…}`), and the phone rendered the string as
// it arrived — an approval card whose buttons read `Allow [envoydev.key] {"key":"approval.allow"}`.
//
// So the tests come in the two halves the module has: the parser (which may never leak the marker,
// whatever the payload), and the map (which may only say what the window already says, verified
// against the ARB and `tool/desktop-reuse.json` rather than trusted).

import 'dart:convert';
import 'dart:io';

import 'package:envoydev_mobile/l10n/daemon_text.dart';
import 'package:envoydev_mobile/l10n/l10n.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// The exact string `keyed()` puts on the wire (`apps/desktop/src/daemon/messages.ts`).
String keyed(String key, String sentence, [Map<String, Object>? values]) =>
    '$sentence$kDaemonRefMarker'
    '${jsonEncode(values == null ? {'key': key} : {'key': key, 'values': values})}';

AppLocalizations catalogue(String code) => lookupAppLocalizations(Locale(code));

void main() {
  test('a key this build has becomes the sentence in the user\'s language', () {
    expect(
      daemonText(catalogue('de'), keyed('approval.question.tool', 'Allow the agent to run “ls”?', {'tool': 'ls'})),
      catalogue('de').approvalQuestionTool('ls'),
    );
    expect(
      daemonText(catalogue('ja'), keyed('approval.deny', "Don't allow")),
      catalogue('ja').approvalDeny,
    );
    // And the two surfaces say the same thing: the German is the window's own sentence.
    expect(catalogue('de').approvalQuestionGeneric, 'Dem Agenten erlauben, fortzufahren?');
  });

  test('a key this build does not have keeps the daemon sentence and loses the marker', () {
    final en = catalogue('en');
    final text = daemonText(
      en,
      keyed('error.harness-missing', 'Envoy Harness is not installed.', {'agent': 'Envoy'}),
    );
    expect(text, 'Envoy Harness is not installed.');
  });

  test('no payload a daemon can send reaches a reader with the marker in it', () {
    final en = catalogue('en');
    final sentences = <String>[
      'Allow the agent to continue?',
      'Plain agent text, no key at all',
      '',
    ];
    final payloads = <String>[
      '{ not json',
      '{"key":""}',
      '{"key":123}',
      '[]',
      '{"key":"approval.allow","values":{"nested":{"a":1}}}',
      '',
    ];
    for (final sentence in sentences) {
      expect(daemonText(en, sentence), sentence, reason: 'a sentence without a marker is untouched');
      for (final payload in payloads) {
        final text = daemonText(en, '$sentence$kDaemonRefMarker$payload');
        expect(text.contains(kDaemonRefMarker.trim()), isFalse, reason: 'marker leaked: $payload');
        expect(text.contains('envoydev.key'), isFalse, reason: 'marker leaked: $payload');
        expect(text.contains('{"key"'), isFalse, reason: 'JSON leaked: $payload');
      }
    }
  });

  test('a failed call loses its code, keeps its sentence, and never shows a key', () {
    final en = catalogue('en');
    expect(
      daemonErrorText(
        en,
        'envoydev.harness-missing: Envoy Harness is not installed.'
        '$kDaemonRefMarker${jsonEncode({'key': 'error.harnessMissing'})}',
      ),
      'Envoy Harness is not installed.',
    );
    // A colon that is not one of ours is not treated as a code — the parser refuses to guess.
    expect(daemonErrorText(en, 'Note: the folder is gone.'), 'Note: the folder is gone.');
    // **A wrapped message still loses its code.** Dart stringifies a thrown error with its class name in
    // front (`StateError: …`), and the wrapper is developer text: the sentence starts where the code does.
    expect(
      daemonErrorText(en, 'StateError: envoydev.git-branch-invalid: "a..b" cannot be a branch name.'),
      '"a..b" cannot be a branch name.',
    );

    // And an unmapped key still gets the sentence, not the wire format.
    final text = daemonErrorText(
      en,
      'envoydev.project-not-found: No such project.$kDaemonRefMarker${jsonEncode({'key': 'error.projectNotFound'})}',
    );
    expect(text, 'No such project.');
  });

  test('every renderer names an ARB key that is recorded as reused from that daemon key', () {
    final reuse =
        jsonDecode(File('tool/desktop-reuse.json').readAsStringSync()) as Map<String, dynamic>;
    final arb = jsonDecode(File('lib/l10n/app_en.arb').readAsStringSync()) as Map<String, dynamic>;

    for (final entry in daemonRefRenderers.entries) {
      final renderer = entry.value;
      expect(arb.containsKey(renderer.arbKey), isTrue,
          reason: '${renderer.arbKey} is not in app_en.arb');
      expect(reuse[renderer.arbKey], entry.key,
          reason: '${renderer.arbKey} must be recorded as reused from "${entry.key}"');
    }

    // The other direction: a window approval sentence the phone carries but does not map is one the
    // daemon can send and the phone cannot say — which is how the card came to show raw JSON.
    for (final entry in reuse.entries) {
      final desktopKey = entry.value as String;
      if (!desktopKey.startsWith('approval.')) continue;
      expect(daemonRefRenderers.containsKey(desktopKey), isTrue,
          reason: '"$desktopKey" is reused as ${entry.key} but no renderer claims it');
    }
  });

  test('the values a template needs are the values it is given', () {
    // `{tool}` is the only placeholder the daemon interpolates into an approval sentence, and a
    // missing value must render as a gap rather than as "null" or as the literal `{tool}`.
    final en = catalogue('en');
    final rendered = daemonText(
      en,
      keyed('approval.question.tool', 'Allow the agent to run “ls”?'),
    );
    expect(rendered, en.approvalQuestionTool(''));
    expect(rendered.contains('{'), isFalse);
  });
}
