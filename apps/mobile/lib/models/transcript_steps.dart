/// Render-time grouping: thought / tool / interim assistant / quiet notes fold
/// into one Steps segment so only the turn's settled answer stays the focus.
///
/// Matches desktop: the last assistant with no tools after it stays a hero —
/// including while it streams — so the reader does not hunt inside Working….
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

  /// Latest Steps segment while the run is open, or any segment with a running tool.
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

void _promoteHeroInTurn(List<TranscriptEntry> turn, Set<String> heroes) {
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
Set<String> heroAssistantIds(List<TranscriptEntry> entries) {
  final heroes = <String>{};
  var turnStart = 0;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].kind != 'user') continue;
    if (i > turnStart) {
      _promoteHeroInTurn(entries.sublist(turnStart, i), heroes);
    }
    turnStart = i;
  }
  _promoteHeroInTurn(entries.sublist(turnStart), heroes);
  return heroes;
}

bool _foldsIntoSteps(TranscriptEntry entry, Set<String> heroes) {
  if (entry.kind == 'thought' || entry.kind == 'tool') return true;
  if (_isQuietNote(entry)) return true;
  if (entry.kind == 'assistant') return !heroes.contains(entry.id);
  return false;
}

bool _toolsRunning(List<TranscriptEntry> entries) =>
    entries.any((e) => e.kind == 'tool' && e.status == 'running');

/// Only the latest Steps segment is live while the run is open (thought-only
/// included). Older segments stay quiet so prior turns do not flip back to Working….
List<TranscriptRenderItem> _applyLiveFlags(
  List<TranscriptRenderItem> items,
  bool runLive,
) {
  var lastSteps = -1;
  for (var i = 0; i < items.length; i++) {
    if (items[i] is TranscriptStepsItem) lastSteps = i;
  }
  return [
    for (var i = 0; i < items.length; i++)
      if (items[i] case final TranscriptStepsItem steps)
        TranscriptStepsItem(
          TranscriptStepsSegment(
            id: steps.segment.id,
            entries: steps.segment.entries,
            live: _toolsRunning(steps.segment.entries) ||
                (runLive && i == lastSteps && steps.segment.entries.isNotEmpty),
          ),
        )
      else
        items[i],
  ];
}

List<TranscriptRenderItem> segmentTranscriptSteps(
  List<TranscriptEntry> entries, {
  bool runLive = false,
}) {
  final heroes = heroAssistantIds(entries);
  final out = <TranscriptRenderItem>[];
  var pending = <TranscriptEntry>[];

  void flush() {
    if (pending.isEmpty) return;
    out.add(
      TranscriptStepsItem(
        TranscriptStepsSegment(
          id: 'steps-${pending.first.id}',
          entries: List<TranscriptEntry>.from(pending),
          live: false,
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
  return _applyLiveFlags(out, runLive);
}

/// Thought + interim assistant text for the live Working… stream pane.
String stepsLiveStreamText(List<TranscriptEntry> entries) {
  final parts = <String>[];
  for (final entry in entries) {
    if (entry.kind == 'thought' || entry.kind == 'assistant') {
      final text = entry.text.trim();
      if (text.isNotEmpty) parts.add(text);
    }
  }
  return parts.join('\n\n');
}
