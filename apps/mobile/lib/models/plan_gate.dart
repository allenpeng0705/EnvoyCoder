/// When to auto-enter Cursor-style “plan carefully” before a large send.
///
/// Conservative on purpose: ordinary short asks start working normally. No
/// interstitial chooser — the user is asked later when the plan is ready.
library;

const planFirstPrefix =
    '[Plan carefully — design only, no code edits yet. Investigate as needed, '
    'then produce a complete markdown plan starting with a # heading and call '
    '`exit_plan_mode` so I can approve before any implementation.]\n\n';

final _strong = RegExp(
  r'\b(refactor|migrate|redesign|overhaul|rewrite)\b.{0,40}\b(system|architecture|codebase|repo|entire|whole|all)\b|'
  r'\b(analyze|investigate|audit)\b.{0,40}\b(whole|entire|full)\b.{0,20}\b(repo|codebase|project)\b|'
  r'\binvestigate (this )?repo\b|'
  r'\b(end[\s.\-]?to[\s.\-]?end).{0,40}\b(refactor|migrate|redesign|overhaul|rewrite|audit|investigate)\b|'
  r'\b(refactor|migrate|redesign|overhaul|rewrite|audit|investigate).{0,40}\b(end[\s.\-]?to[\s.\-]?end)\b|'
  r'\bacross (all|every)\b.{0,20}\b(package|module|service)',
  caseSensitive: false,
);

final _weak = RegExp(
  r'\b(refactor|migrate|redesign|architecture|overhaul|rewrite|multi[\s\-]?step|phased|roadmap)\b',
  caseSensitive: false,
);

bool looksLikeBigTask(String prompt, int attachmentCount) {
  final text = prompt.trim();
  if (text.isEmpty) return false;
  if (_strong.hasMatch(text)) return true;
  if (attachmentCount >= 3) return true;
  if (text.length >= 800) return true;
  if (text.length >= 400 && (_weak.hasMatch(text) || attachmentCount >= 2)) return true;
  return false;
}

bool shouldAutoPlanFirst({
  required String prompt,
  required int attachmentCount,
  required bool planMode,
  required bool planCapable,
  required bool running,
}) {
  if (running) return false;
  if (!planCapable) return false;
  if (planMode) return false;
  return looksLikeBigTask(prompt, attachmentCount);
}

String withPlanFirstFraming(String userPrompt) {
  final trimmed = userPrompt.trim();
  if (trimmed.startsWith('[Plan carefully')) return userPrompt;
  return '$planFirstPrefix$userPrompt';
}

String stripPlanFirstFraming(String text) {
  if (text.startsWith(planFirstPrefix)) return text.substring(planFirstPrefix.length);
  if (text.startsWith('[Plan carefully')) {
    final end = text.indexOf(']\n\n');
    if (end >= 0) return text.substring(end + 3);
  }
  return text;
}

/// Agents that can enter plan / design-only collaboration (matches desktop composerFeatures).
bool planCapableHarness(String? harnessId) {
  return harnessId == 'envoy-harness' || harnessId == 'codex';
}

bool isPlanReviewAsk(String question, [String? detail]) {
  final head = question.toLowerCase();
  if (head.contains('approve this plan') || head.contains('leave plan mode')) return true;
  if (head.contains('plan review')) return true;
  if (head.contains('implement this plan')) return true;
  if (detail != null &&
      detail.trim().isNotEmpty &&
      RegExp(r'^#{1,6}\s', multiLine: true).hasMatch(detail) &&
      RegExp(r'\bplan\b', caseSensitive: false)
          .hasMatch('$question\n${detail.substring(0, detail.length.clamp(0, 240))}')) {
    return true;
  }
  return false;
}

String planReviewOptionLabel(String label, int index, {required String implement, required String revise}) {
  final lower = label.toLowerCase();
  if (RegExp(r'\b(reject|revise|keep planning|deny|no)\b').hasMatch(lower)) return revise;
  if (RegExp(r'\b(approve|implement|continue|accept|yes)\b').hasMatch(lower)) return implement;
  if (index == 0) return implement;
  if (index == 1) return revise;
  return label;
}

bool isPlanReviewApproveChoice(
  String choiceId,
  List<({String id, String label})> options,
) {
  for (final option in options) {
    if (option.id != choiceId) continue;
    final lower = option.label.toLowerCase();
    if (RegExp(r'\b(reject|revise|keep planning|deny|no)\b').hasMatch(lower)) return false;
    if (RegExp(r'\b(approve|implement|continue|accept|yes)\b').hasMatch(lower)) return true;
    return options.isNotEmpty && options.first.id == choiceId;
  }
  return false;
}
