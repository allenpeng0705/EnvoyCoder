/// Pure helpers for how [RunScreen] projects a folded transcript onto the phone.
///
/// Kept free of Flutter so streaming / empty-state rules can be tested without pumping
/// a full run screen (desktop twin: TaskPane index-of + `task.runId === undefined`).
library;

import 'transcript.dart';

/// True when [entry] is the live hero answer — last assistant in the **display**
/// list (after `groupConsecutiveTools`), matching desktop TaskPane.
bool isStreamingAssistant({
  required bool runLive,
  required List<TranscriptEntry> displayEntries,
  required TranscriptEntry entry,
  required int entryIndex,
}) {
  if (!runLive || entry.kind != 'assistant' || entryIndex < 0) return false;
  return !displayEntries
      .skip(entryIndex + 1)
      .any((later) => later.kind == 'assistant');
}

/// Empty transcript chrome: hero only when there is no run yet; otherwise loading
/// (desktop: `entries.length === 0 && task.runId === undefined` vs loading).
({bool showHero, bool showLoading}) emptyTranscriptChrome({
  required bool bootstrapLoading,
  required bool transcriptEmpty,
  required String runId,
}) {
  if (bootstrapLoading || !transcriptEmpty) {
    return (showHero: false, showLoading: false);
  }
  if (runId.isEmpty) return (showHero: true, showLoading: false);
  return (showHero: false, showLoading: true);
}

/// Composer send / attach — blocked for **any** open approval, including when
/// choices stay on the transcript card (`approvals: false`). Desktop:
/// `disabled={approvalOpen}`.
bool composerSendable({
  required bool approvalOpen,
  required bool live,
  required bool hasTask,
}) {
  if (approvalOpen) return false;
  return live || hasTask;
}
