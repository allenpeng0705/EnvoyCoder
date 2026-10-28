/// Render-time grouping: thought / tool / interim assistant / quiet notes fold
/// into one Steps segment so only the turn's settled answer stays the focus.
///
/// While the run is live and no tools have settled yet, assistants stay inside
/// open Steps so narration does not flash outside then jump in when tools start.
library;

import 'transcript.dart';

/// One Steps disclosure wrapping process rows for a stretch of the turn.
class TranscriptStepsSegment {
  TranscriptStepsSegment({
    required this.id,
    required this.entries,
    required this.live,
  });

  final String id;
  final List<TranscriptEntry> entries;

  /// Tools running, or live run still holding the streaming answer.
  final bool live;

  int get thoughtCount => entries.where((e) => e.kind == 'thought').length;

  int get toolCount => entries.where((e) => e.kind == 'tool').length;
}

/// Either a normal transcript row or a Steps segment.
sealed class TranscriptRenderItem {
  const TranscriptRenderItem();
}

class TranscriptEntryItem extends TranscriptRenderItem {
  const TranscriptEntryItem(this.entry);
  final TranscriptEntry entry;
}

class TranscriptStepsItem extends TranscriptRenderItem {
  const TranscriptStepsItem(this.segment);
  final TranscriptStepsSegment segment;
}

bool _isToolish(TranscriptEntry entry) => entry.kind == 'tool';

bool _isQuietNote(TranscriptEntry entry) => entry.kind == 'note' && entry.tone == 'quiet';

void _promoteHeroInTurn(
  List<TranscriptEntry> turn,
  Set<String> heroes, {
  required bool runLive,
}) {
  final hasTools = turn.any(_isToolish);
  final anyRunning = turn.any((e) => e.kind == 'tool' && e.status == 'running');

  if (runLive && !hasTools) return;
  if (runLive && anyRunning) return;

  String? heroId;
  for (var i = 0; i < turn.length; i++) {
    final entry = turn[i];
    if (entry.kind != 'assistant') continue;
    final toolsAfter = turn.skip(i + 1).any(_isToolish);
    if (!toolsAfter) heroId = entry.id;
  }
  if (heroId != null) heroes.add(heroId);
}

/// Assistants that stay outside Steps.
Set<String> heroAssistantIds(
  List<TranscriptEntry> entries, {
  bool runLive = false,
}) {
  final heroes = <String>{};
  var turnStart = 0;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].kind != 'user') continue;
    if (i > turnStart) {
      _promoteHeroInTurn(entries.sublist(turnStart, i), heroes, runLive: runLive);
    }
    turnStart = i;
  }
  _promoteHeroInTurn(entries.sublist(turnStart), heroes, runLive: runLive);
  return heroes;
}

bool _foldsIntoSteps(TranscriptEntry entry, Set<String> heroes) {
  if (entry.kind == 'thought' || entry.kind == 'tool') return true;
  if (_isQuietNote(entry)) return true;
  if (entry.kind == 'assistant') return !heroes.contains(entry.id);
  return false;
}

bool _segmentLive(List<TranscriptEntry> entries, bool runLive) {
  final toolsRunning = entries.any((e) => e.kind == 'tool' && e.status == 'running');
  final hasAssistant = entries.any((e) => e.kind == 'assistant');
  final hasTool = entries.any(_isToolish);
  final holdingAnswer = runLive && hasAssistant && !hasTool;
  return toolsRunning || holdingAnswer;
}

List<TranscriptRenderItem> segmentTranscriptSteps(
  List<TranscriptEntry> entries, {
  bool runLive = false,
}) {
  final heroes = heroAssistantIds(entries, runLive: runLive);
  final out = <TranscriptRenderItem>[];
  var pending = <TranscriptEntry>[];

  void flush() {
    if (pending.isEmpty) return;
    out.add(
      TranscriptStepsItem(
        TranscriptStepsSegment(
          id: 'steps-${pending.first.id}',
          entries: List<TranscriptEntry>.from(pending),
          live: _segmentLive(pending, runLive),
        ),
      ),
    );
    pending = [];
  }

  for (final entry in entries) {
    if (_foldsIntoSteps(entry, heroes)) {
      pending.add(entry);
      continue;
    }
    flush();
    out.add(TranscriptEntryItem(entry));
  }
  flush();
  return out;
}
