// The approval card, over the wire format the daemon actually sends.
//
// Every sentence on this card that the daemon authored arrives keyed (see `l10n/daemon_text.dart`), so
// the card is where a missing resolution step becomes visible to a user: the question line, the detail,
// and — the ones nobody would think to check — the **buttons** and the answered summary, which name
// options the daemon labels `Allow` / `Don't allow` through the same mechanism.

import 'dart:convert';

import 'package:envoydev_mobile/l10n/daemon_text.dart';
import 'package:envoydev_mobile/l10n/l10n.dart';
import 'package:envoydev_mobile/models/transcript.dart';
import 'package:envoydev_mobile/theme/tokens.dart';
import 'package:envoydev_mobile/widgets/transcript_row.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/l10n.dart';

String keyed(String key, String sentence, [Map<String, Object>? values]) =>
    '$sentence$kDaemonRefMarker'
    '${jsonEncode(values == null ? {'key': key} : {'key': key, 'values': values})}';

TranscriptApproval approval({
  required String question,
  String? detail,
  String selection = 'one',
  List<Map<String, String>> options = const [
    {'id': 'allow', 'label': 'Allow'},
    {'id': 'deny', 'label': "Don't allow"},
  ],
}) =>
    TranscriptApproval(
      requestId: 'req-1',
      question: question,
      detail: detail,
      selection: selection,
      options: [
        for (final option in options)
          TranscriptOption(
            id: option['id']!,
            label: keyed('approval.${option['id']}', option['label']!),
            destructive: option['id'] == 'deny',
          ),
      ],
    );

Future<void> pumpCard(WidgetTester tester, TranscriptApproval card, {Locale? locale}) async {
  await pumpLocalized(
    tester,
    Scaffold(
      body: SingleChildScrollView(
        child: ApprovalCard(approval: card, colors: CoderColors.light),
      ),
    ),
    locale: locale,
  );
}

/// Nothing on this card may show the marker or its JSON, in any language, in any branch.
void expectNoWireFormat(WidgetTester tester) {
  expect(find.textContaining('envoydev.key'), findsNothing);
  expect(find.textContaining('{"key"'), findsNothing);
}

void main() {
  testWidgets('the daemon\'s keyed question, detail and buttons are the window\'s sentences',
      (tester) async {
    await pumpCard(
      tester,
      approval(
        question: keyed('approval.question.tool', 'Allow the agent to run “ls”?', {'tool': 'ls'}),
        detail: keyed('approval.detail', 'It has stopped before this step.'),
      ),
      locale: const Locale('de'),
    );

    final de = lookupAppLocalizations(const Locale('de'));
    expect(find.text(de.approvalQuestionTool('ls')), findsOneWidget);
    expect(find.text(de.approvalDetail), findsOneWidget);
    // The buttons: `approval.allow` / `approval.deny`, which the daemon sends keyed like everything
    // else. These read as raw JSON before this was fixed.
    expect(find.text(de.approvalAllow), findsOneWidget);
    expect(find.text(de.approvalDeny), findsOneWidget);
    expectNoWireFormat(tester);
  });

  testWidgets('a question that arrived empty says so in the user\'s language', (tester) async {
    // A daemon older than the question, or a refusal shape it did not word: the card keeps its shape
    // and says what is happening rather than leaving the line blank.
    await pumpCard(tester, approval(question: ''), locale: const Locale('de'));

    final de = lookupAppLocalizations(const Locale('de'));
    expect(find.text(de.runApprovalNeedsDecision), findsOneWidget);
    expect(find.text(de.runNeedsAnswer), findsOneWidget);
    expectNoWireFormat(tester);
  });

  testWidgets('a checkbox question labels every option in the user\'s language', (tester) async {
    await pumpCard(
      tester,
      approval(
        question: keyed('approval.question.ask', 'The agent asked a question.'),
        selection: 'many',
        detail: keyed('approval.detail.multiple', 'Tick every option that applies.'),
      ),
      locale: const Locale('ja'),
    );

    final ja = lookupAppLocalizations(const Locale('ja'));
    expect(find.text(ja.approvalAllow), findsOneWidget);
    expect(find.text(ja.approvalDeny), findsOneWidget);
    expect(find.text(ja.approvalDetailMultiple), findsOneWidget);
    expectNoWireFormat(tester);
  });

  testWidgets('an answered card names the choice, not the key', (tester) async {
    final card = approval(
      question: keyed('approval.question.generic', 'Allow the agent to continue?'),
    )..resolvedWith = 'allow';

    await pumpCard(tester, card, locale: const Locale('fr'));

    final fr = lookupAppLocalizations(const Locale('fr'));
    expect(find.text(fr.runAnsweredWith(fr.approvalAllow)), findsOneWidget);
    expectNoWireFormat(tester);
  });

  testWidgets('a daemon note is read in the user\'s language', (tester) async {
    // The note rows carry daemon prose too, and a failure note is where a user meets the sentence that
    // explains what went wrong.
    await pumpLocalized(
      tester,
      Scaffold(
        body: TranscriptRow(
          colors: CoderColors.light,
          entry: TranscriptEntry(
            kind: 'note',
            id: 'n1',
            tone: 'error',
            text: keyed('error.harness-missing', 'Envoy Harness is not installed.'),
          ),
        ),
      ),
      locale: const Locale('de'),
    );

    // No German sentence exists for an `error.*` key yet, so the daemon's English stands — and the
    // marker still does not reach the screen.
    expect(find.text('Envoy Harness is not installed.'), findsOneWidget);
    expectNoWireFormat(tester);
  });
}
