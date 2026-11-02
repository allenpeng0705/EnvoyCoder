/// Render-time grouping: thought / tool / interim assistant / quiet notes fold
/// into one Steps segment so only the turn's settled answer stays the focus.
///
/// Matches desktop: the last assistant with no tools after it stays a hero —
/// including while it streams — so the reader does not hunt inside Working….
library;

import 'tool_buckets.dart';
import 'transcript.dart';

/// One Steps disclosure wrapping process rows for a stretch of the turn.
class TranscriptStepsSegment {
  TranscriptStepsSegment({
    required this.id,
    required this.entries,
    required this.live,
    required this.counts,
    required this.thoughtCount,
  });

  final String id;
  final List<TranscriptEntry> entries;

  /// Latest Steps segment while the run is open, or any segment with a running tool.
  final bool live;

  final ToolCounts counts;
  final int thoughtCount;

  int get toolCount => counts.total;
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

List<TranscriptEntry> _toolsFromEntry(TranscriptEntry entry) {
  if (entry.kind == 'tool') return [entry];
  if (entry.kind == 'tools') return List<TranscriptEntry>.from(entry.tools ?? const []);
  return const [];
}

bool _isToolish(TranscriptEntry entry) => entry.kind == 'tool' || entry.kind == 'tools';

bool _isQuietNote(TranscriptEntry entry) => entry.kind == 'note' && entry.tone == 'quiet';

({ToolCounts counts, int thoughtCount, bool toolsRunning}) _segmentMeta(
  List<TranscriptEntry> entries,
) {
  final tools = <TranscriptEntry>[];
  var thoughtCount = 0;
  for (final entry in entries) {
    if (entry.kind == 'thought') thoughtCount += 1;
    tools.addAll(_toolsFromEntry(entry));
  }
  return (
    counts: tools.isEmpty
        ? emptyToolCounts()
        : countToolBuckets([
            for (final tool in tools) (name: tool.text, kind: tool.toolKind),
          ]),
    thoughtCount: thoughtCount,
    toolsRunning: tools.any((t) => t.status == 'running'),
  );
}

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
  if (entry.kind == 'thought' || entry.kind == 'tool' || entry.kind == 'tools') {
    return true;
  }
  if (_isQuietNote(entry)) return true;
  if (entry.kind == 'assistant') return !heroes.contains(entry.id);
  return false;
}

bool _toolsRunning(List<TranscriptEntry> entries) => entries.any(
      (e) => _toolsFromEntry(e).any((tool) => tool.status == 'running'),
    );

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
            counts: steps.segment.counts,
            thoughtCount: steps.segment.thoughtCount,
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
    final meta = _segmentMeta(pending);
    out.add(
      TranscriptStepsItem(
        TranscriptStepsSegment(
          id: 'steps-${pending.first.id}',
          entries: List<TranscriptEntry>.from(pending),
          live: false,
          counts: meta.counts,
          thoughtCount: meta.thoughtCount,
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

/// Last lines of the live stream for the composer peek strip (Wave 3A / 4C).
String workingPeekText(List<TranscriptEntry> entries, {int maxChars = 280}) {
  return workingPeekTail(stepsLiveStreamText(entries), maxChars: maxChars);
}

/// Latest status-header line (Codex `latest_summary_line`).
String? latestSummaryLine(String streamText) {
  final lines = streamText.split('\n');
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].trim();
    if (line.isEmpty || line.startsWith('<!--')) continue;
    line = line.replaceFirst(RegExp(r'^#+\s*'), '').trim();
    if (line.startsWith('**')) {
      final close = line.indexOf('**', 2);
      if (close > 2) {
        line = '${line.substring(2, close)}${line.substring(close + 2)}'.trim();
      }
    }
    if (line.isEmpty) continue;
    return line.length > 96 ? '${line.substring(0, 93)}…' : line;
  }
  return null;
}

/// Muted tail of the live stream for the peek body.
String workingPeekTail(String streamText, {int maxChars = 280}) {
  final full = streamText.trim();
  if (full.isEmpty) return '';
  if (full.length <= maxChars) return full;
  final slice = full.substring(full.length - maxChars);
  final cut = slice.indexOf('\n');
  final trimmed = cut >= 0 && cut < 40 ? slice.substring(cut + 1) : slice;
  return '…${trimmed.trimLeft()}';
}

/// Status header + optional muted body; drops a body that only repeats the summary.
({String? summary, String tail}) workingPeekParts(
  String streamText, {
  int maxChars = 280,
}) {
  final summary = latestSummaryLine(streamText);
  final tail = workingPeekTail(streamText, maxChars: maxChars);
  if (tail.isEmpty) return (summary: summary, tail: '');
  if (summary == null) return (summary: summary, tail: tail);
  final normalized = tail.startsWith('…') ? tail.substring(1).trim() : tail;
  if (normalized == summary || tail == summary) {
    return (summary: summary, tail: '');
  }
  final firstNl = normalized.indexOf('\n');
  if (firstNl > 0 && normalized.substring(0, firstNl).trim() == summary) {
    final rest = normalized.substring(firstNl + 1).trim();
    return (summary: summary, tail: rest);
  }
  return (summary: summary, tail: tail);
}
