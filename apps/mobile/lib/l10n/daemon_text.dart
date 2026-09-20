/// Daemon prose, in the language the phone is set to.
///
/// ## Why this file exists
///
/// The daemon cannot know which language a reader wants — two windows on one daemon may be in
/// different languages — so every sentence it authors for a user travels as **an English sentence plus
/// a catalogue key**, glued together by `withMessageRef` (`packages/protocol/src/rpc.ts`):
///
/// ```text
/// Allow the agent to run “ls”? [envoydev.key] {"key":"approval.question.tool","values":{"tool":"ls"}}
/// ```
///
/// The window splits that pair and looks the key up. The phone had no such step, so it rendered the
/// string as it arrived: an approval card whose question line and whose **buttons** read
/// `Allow [envoydev.key] {"key":"approval.allow"}`. This module is that missing step.
///
/// ## Two jobs, and only one of them can be skipped
///
///   * **Strip the marker, always.** The marker and its JSON are for logs and scripts; a reader must
///     never see them, whatever happens to the key.
///   * **Resolve the key when this build has that sentence.** That is a map rather than a lookup for
///     two reasons: the daemon's keys are dotted (`approval.question.generic`) while an ARB key has to
///     be a Dart method name, and the phone's catalogue is deliberately smaller than the window's. A
///     key we do not have is **not** a failure — the English sentence that came with it is exactly what
///     the protocol says a client without the catalogue should show.
///
/// ## What this does not do
///
/// It does not invent wording. Every sentence in [daemonRefRenderers] is the window's own, copied
/// verbatim through `tool/desktop-reuse.json` (see the phone's `l10n/README.md`), so the two surfaces
/// say one thing. A daemon key the phone has no sentence for — the `error.*` refusals, today — stays
/// the daemon's English until somebody translates it, which is visible in the UI rather than silent.
library;

import 'dart:convert';

import 'l10n.dart';

/// The marker the protocol glues a sentence to its key with. Kept byte-identical to
/// `MESSAGE_REF_MARKER`; a copy that drifts would leave the marker on screen for users to read.
const String kDaemonRefMarker = ' [envoydev.key] ';

/// A daemon sentence with its key already split off.
class DaemonMessage {
  const DaemonMessage(this.message, {this.key, this.values = const {}});

  /// The English sentence, always free of the marker and its JSON.
  final String message;

  /// The catalogue key the daemon sent, when it sent a readable one.
  final String? key;

  /// The values that key's template interpolates.
  final Map<String, Object> values;
}

/// How one daemon key becomes a sentence in the user's language.
class DaemonRefRenderer {
  const DaemonRefRenderer(this.arbKey, this.render);

  /// The ARB key this renderer answers, by name — so a test can prove it exists and that
  /// `tool/desktop-reuse.json` still maps it to the same daemon key.
  final String arbKey;

  final String Function(AppLocalizations l10n, Map<String, Object> values) render;
}

/// Split the marker off a daemon message, keeping whatever key came with it.
///
/// Mirrors `parseMessageRef`: a marker with an unreadable payload, or with a payload that is not a
/// key, yields the **sentence alone**. That direction is the point — the failure mode must never be a
/// user reading `{"key":…}`.
DaemonMessage parseDaemonMessage(String raw) {
  final at = raw.lastIndexOf(kDaemonRefMarker);
  if (at < 0) return DaemonMessage(raw);
  final sentence = raw.substring(0, at);
  try {
    final decoded = jsonDecode(raw.substring(at + kDaemonRefMarker.length));
    if (decoded is! Map) return DaemonMessage(sentence);
    final key = decoded['key'];
    if (key is! String || key.isEmpty) return DaemonMessage(sentence);
    final values = <String, Object>{};
    final rawValues = decoded['values'];
    if (rawValues is Map) {
      for (final entry in rawValues.entries) {
        final name = entry.key;
        final value = entry.value;
        // Only what a template can interpolate: a nested object would render as `[object Object]`.
        if (name is String && (value is String || value is num)) values[name] = value;
      }
    }
    return DaemonMessage(sentence, key: key, values: values);
  } on FormatException {
    return DaemonMessage(sentence);
  }
}

/// Daemon prose for a **reader** — an approval question, a note, an option's label.
///
/// Returns the sentence in the user's language when this build has the daemon's key, and the daemon's
/// own English when it does not. The marker is stripped either way.
String daemonText(AppLocalizations l10n, String raw) {
  final parsed = parseDaemonMessage(raw);
  final key = parsed.key;
  if (key == null) return parsed.message;
  final renderer = daemonRefRenderers[key];
  return renderer?.render(l10n, parsed.values) ?? parsed.message;
}

/// Daemon prose for a **failed call** — as [daemonText], with the `envoydev.*:` code removed.
///
/// The code is a developer field: it belongs in the audit log and the diagnostics report, not in a
/// snackbar a user reads. This mirrors `parseCoderError`, including its refusal to treat a colon that
/// is not one of ours as a code (`a sentence: with a colon` stays whole).
String daemonErrorText(AppLocalizations l10n, String raw) {
  final colon = raw.indexOf(':');
  final head = colon > 0 ? raw.substring(0, colon).trim() : '';
  if (colon > 0 && head.startsWith('envoydev.')) {
    return daemonText(l10n, raw.substring(colon + 1).trim());
  }
  return daemonText(l10n, raw);
}

/// The daemon keys this build can say, and the sentence each one becomes.
///
/// Every entry's ARB key is a **reused** window string, recorded in `tool/desktop-reuse.json`; the
/// phone never words a daemon sentence itself. `test/daemon_text_test.dart` proves each entry against
/// the ARB and that record, so a key renamed on one side and not the other is a failing test rather
/// than an English sentence on a German phone.
const Map<String, DaemonRefRenderer> daemonRefRenderers = {
  'approval.question.tool': DaemonRefRenderer('approvalQuestionTool', _questionTool),
  'approval.question.generic': DaemonRefRenderer('approvalQuestionGeneric', _questionGeneric),
  'approval.question.ask': DaemonRefRenderer('approvalQuestionAsk', _questionAsk),
  'approval.detail': DaemonRefRenderer('approvalDetail', _detail),
  'approval.detail.pick': DaemonRefRenderer('approvalDetailPick', _detailPick),
  'approval.detail.multiple': DaemonRefRenderer('approvalDetailMultiple', _detailMultiple),
  'approval.detail.text': DaemonRefRenderer('approvalDetailText', _detailText),
  'approval.allow': DaemonRefRenderer('approvalAllow', _allow),
  'approval.deny': DaemonRefRenderer('approvalDeny', _deny),
};

// One tear-off per sentence rather than a lookup by name: Dart has no reflection, so the compiler is
// what proves each ARB key exists. A key the catalogue drops breaks this file at build time.
String _questionTool(AppLocalizations l10n, Map<String, Object> values) =>
    l10n.approvalQuestionTool('${values['tool'] ?? ''}');

String _questionGeneric(AppLocalizations l10n, Map<String, Object> _) => l10n.approvalQuestionGeneric;

String _questionAsk(AppLocalizations l10n, Map<String, Object> _) => l10n.approvalQuestionAsk;

String _detail(AppLocalizations l10n, Map<String, Object> _) => l10n.approvalDetail;

String _detailPick(AppLocalizations l10n, Map<String, Object> _) => l10n.approvalDetailPick;

String _detailMultiple(AppLocalizations l10n, Map<String, Object> _) => l10n.approvalDetailMultiple;

String _detailText(AppLocalizations l10n, Map<String, Object> _) => l10n.approvalDetailText;

String _allow(AppLocalizations l10n, Map<String, Object> _) => l10n.approvalAllow;

String _deny(AppLocalizations l10n, Map<String, Object> _) => l10n.approvalDeny;
