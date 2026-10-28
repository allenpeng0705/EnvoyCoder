/**
 * Render-time grouping: thought / tool / interim assistant / quiet notes fold into
 * one Steps segment so only the turn's settled answer stays the visual focus.
 *
 * Approvals (and warn/error notes) break a segment — they must stay findable.
 * While the run is live and no tools have settled yet, assistants stay inside
 * open Steps so narration does not flash outside then jump in when tools start.
 */

import { countToolBuckets, emptyToolCounts, type ToolCounts } from "./tool-buckets.js";
import type { ToolEntry, TranscriptEntry } from "./transcript.js";

export type StepsSegment = {
  kind: "steps";
  id: string;
  entries: readonly TranscriptEntry[];
  /** True when tools are running, or the run is live and this segment still holds the answer. */
  live: boolean;
  counts: ToolCounts;
  thoughtCount: number;
};

export type TranscriptRenderItem = TranscriptEntry | StepsSegment;

export type SegmentTranscriptStepsOptions = {
  /** When true, defer chat-only heroes into open Steps until the turn settles. */
  runLive?: boolean;
};

function toolsFromEntry(entry: TranscriptEntry): ToolEntry[] {
  if (entry.kind === "tool") return [entry];
  if (entry.kind === "tools") return [...entry.tools];
  return [];
}

function isToolish(entry: TranscriptEntry): boolean {
  return entry.kind === "tool" || entry.kind === "tools";
}

function isQuietNote(entry: TranscriptEntry): boolean {
  return entry.kind === "note" && entry.tone === "quiet";
}

function segmentMeta(
  entries: readonly TranscriptEntry[],
  runLive: boolean,
): {
  live: boolean;
  counts: ToolCounts;
  thoughtCount: number;
} {
  const tools: ToolEntry[] = [];
  let thoughtCount = 0;
  let hasAssistant = false;
  for (const entry of entries) {
    if (entry.kind === "thought") thoughtCount += 1;
    if (entry.kind === "assistant") hasAssistant = true;
    tools.push(...toolsFromEntry(entry));
  }
  const toolsRunning = tools.some((tool) => tool.status === "running");
  // Keep Steps open while live if it still holds the streaming answer (no tools yet).
  const holdingAnswer = runLive && hasAssistant && tools.length === 0;
  return {
    live: toolsRunning || holdingAnswer,
    counts: tools.length > 0 ? countToolBuckets(tools) : emptyToolCounts(),
    thoughtCount,
  };
}

/**
 * Within one turn, promote the last assistant that is not followed by any tool.
 * While the run is live and the turn has no tools yet, promote nothing — the
 * streaming answer stays in Steps (open) so a later tool does not demote a hero.
 */
function promoteHeroInTurn(
  turn: readonly TranscriptEntry[],
  heroes: Set<string>,
  runLive: boolean,
): void {
  const hasTools = turn.some(isToolish);
  const anyRunning = turn.some(
    (entry) =>
      (entry.kind === "tool" && entry.status === "running") ||
      (entry.kind === "tools" && entry.tools.some((tool) => tool.status === "running")),
  );

  if (runLive && !hasTools) {
    // Chat-only while live: hold in Steps (opened via holdingAnswer).
    return;
  }
  if (runLive && anyRunning) {
    // Tools still going — do not promote a final answer yet.
    return;
  }

  let heroId: string | undefined;
  for (let i = 0; i < turn.length; i += 1) {
    const entry = turn[i]!;
    if (entry.kind !== "assistant") continue;
    const toolsAfter = turn.slice(i + 1).some(isToolish);
    if (!toolsAfter) heroId = entry.id;
  }
  if (heroId !== undefined) heroes.add(heroId);
}

/**
 * Assistants that stay outside Steps.
 */
export function heroAssistantIds(
  entries: readonly TranscriptEntry[],
  options: SegmentTranscriptStepsOptions = {},
): ReadonlySet<string> {
  const runLive = options.runLive === true;
  const heroes = new Set<string>();
  let turnStart = 0;
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i]!.kind !== "user") continue;
    if (i > turnStart) promoteHeroInTurn(entries.slice(turnStart, i), heroes, runLive);
    turnStart = i;
  }
  promoteHeroInTurn(entries.slice(turnStart), heroes, runLive);
  return heroes;
}

function foldsIntoSteps(
  entry: TranscriptEntry,
  heroes: ReadonlySet<string>,
): boolean {
  if (entry.kind === "thought" || entry.kind === "tool" || entry.kind === "tools") return true;
  if (isQuietNote(entry)) return true;
  if (entry.kind === "assistant") return !heroes.has(entry.id);
  return false;
}

/**
 * Fold process rows (and interim assistant narration) into Steps segments.
 */
export function segmentTranscriptSteps(
  entries: readonly TranscriptEntry[],
  options: SegmentTranscriptStepsOptions = {},
): TranscriptRenderItem[] {
  const runLive = options.runLive === true;
  const heroes = heroAssistantIds(entries, options);
  const out: TranscriptRenderItem[] = [];
  let pending: TranscriptEntry[] = [];

  const flush = (): void => {
    if (pending.length === 0) return;
    const meta = segmentMeta(pending, runLive);
    out.push({
      kind: "steps",
      id: `steps-${pending[0]!.id}`,
      entries: pending,
      ...meta,
    });
    pending = [];
  };

  for (const entry of entries) {
    if (foldsIntoSteps(entry, heroes)) {
      pending.push(entry);
      continue;
    }
    flush();
    out.push(entry);
  }
  flush();
  return out;
}
