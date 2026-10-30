/**
 * Render-time grouping: thought / tool / interim assistant / quiet notes fold into
 * one Steps segment so only the turn's answer stays the visual focus.
 *
 * Approvals (and warn/error notes) break a segment — they must stay findable.
 *
 * The answer itself (the last assistant with no tools after it) stays **outside**
 * Steps, including while it streams. Hiding that text inside an auto-opened Steps
 * dump forced readers to scroll past every tool and thought to find the reply.
 */

import { countToolBuckets, emptyToolCounts, type ToolCounts } from "./tool-buckets.js";
import type { ToolEntry, TranscriptEntry } from "./transcript.js";

export type StepsSegment = {
  kind: "steps";
  id: string;
  entries: readonly TranscriptEntry[];
  /** True while this segment is the live Working… turn (summary hint; Steps stay closed until opened). */
  live: boolean;
  counts: ToolCounts;
  thoughtCount: number;
};

export type TranscriptRenderItem = TranscriptEntry | StepsSegment;

export type SegmentTranscriptStepsOptions = {
  /** True while a run has not ended — keeps Steps marked live when tools are running. */
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

function segmentMeta(entries: readonly TranscriptEntry[]): {
  counts: ToolCounts;
  thoughtCount: number;
  toolsRunning: boolean;
} {
  const tools: ToolEntry[] = [];
  let thoughtCount = 0;
  for (const entry of entries) {
    if (entry.kind === "thought") thoughtCount += 1;
    tools.push(...toolsFromEntry(entry));
  }
  return {
    counts: tools.length > 0 ? countToolBuckets(tools) : emptyToolCounts(),
    thoughtCount,
    toolsRunning: tools.some((tool) => tool.status === "running"),
  };
}

/**
 * Only the latest Steps segment is "live" while the run is open (thought-only
 * phases included). Older segments stay quiet so prior turns do not flip back
 * to "Working…".
 */
function applyLiveFlags(
  items: TranscriptRenderItem[],
  runLive: boolean,
): TranscriptRenderItem[] {
  let lastSteps = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (items[i]!.kind === "steps") lastSteps = i;
  }
  return items.map((item, i) => {
    if (item.kind !== "steps") return item;
    const toolsRunning = item.entries.some((entry) =>
      toolsFromEntry(entry).some((tool) => tool.status === "running"),
    );
    if (toolsRunning) return { ...item, live: true };
    if (runLive && i === lastSteps && item.entries.length > 0) {
      return { ...item, live: true };
    }
    return { ...item, live: false };
  });
}

/**
 * Within one turn, promote the last assistant that is not followed by any tool —
 * that row is the answer the reader should see without opening Steps.
 */
function promoteHeroInTurn(
  turn: readonly TranscriptEntry[],
  heroes: Set<string>,
): void {
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
  _options: SegmentTranscriptStepsOptions = {},
): ReadonlySet<string> {
  const heroes = new Set<string>();
  let turnStart = 0;
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i]!.kind !== "user") continue;
    if (i > turnStart) promoteHeroInTurn(entries.slice(turnStart, i), heroes);
    turnStart = i;
  }
  promoteHeroInTurn(entries.slice(turnStart), heroes);
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
    const meta = segmentMeta(pending);
    out.push({
      kind: "steps",
      id: `steps-${pending[0]!.id}`,
      entries: pending,
      live: false,
      counts: meta.counts,
      thoughtCount: meta.thoughtCount,
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
  return applyLiveFlags(out, runLive);
}
