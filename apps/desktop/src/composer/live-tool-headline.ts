/**
 * Human headline for the live Working peek / Steps summary from a running tool.
 *
 * Prefer a concrete object (path, command, query) over the agent's raw tool id.
 */

import type { MessageKey } from "../i18n/messages/en.js";
import {
  commandFromToolInput,
  pathFromToolInput,
  queryFromToolInput,
  shortToolCommand,
  shortToolPath,
  toolBucket,
} from "../state/tool-buckets.js";
import type { ToolEntry, TranscriptEntry } from "../state/transcript.js";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** Flatten tool / tools rows into individual calls, newest last. */
export function toolsFromTranscriptEntries(
  entries: readonly TranscriptEntry[],
): ToolEntry[] {
  const out: ToolEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "tool") out.push(entry);
    else if (entry.kind === "tools") out.push(...entry.tools);
  }
  return out;
}

/** Prefer the newest running tool; else the newest tool overall. */
export function focusLiveTool(tools: readonly ToolEntry[]): ToolEntry | undefined {
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    if (tools[i]!.status === "running") return tools[i];
  }
  return tools.length > 0 ? tools[tools.length - 1] : undefined;
}

function looksLikeRead(name: string): boolean {
  return /read|list_dir|\bls\b|cat|open_file|get_file/.test(name.toLowerCase());
}

/**
 * One short status line for a tool call, or `undefined` when we have nothing
 * more useful than a generic Working… / count summary.
 */
export function liveToolHeadline(tool: ToolEntry, t: Translate): string | undefined {
  const bucket = toolBucket(tool.name);
  const path = pathFromToolInput(tool.input);
  const command = commandFromToolInput(tool.input);
  const query = queryFromToolInput(tool.input);

  if (bucket === "edited" && path !== undefined) {
    return t("task.composer.working.editing", { path: shortToolPath(path) });
  }
  if (bucket === "ran" && command !== undefined) {
    return t("task.composer.working.runningCmd", { command: shortToolCommand(command) });
  }
  if (bucket === "searched") {
    if (path !== undefined && looksLikeRead(tool.name)) {
      return t("task.composer.working.reading", { path: shortToolPath(path) });
    }
    if (query !== undefined) {
      return t("task.composer.working.searching", {
        query: shortToolCommand(query, 48),
      });
    }
    if (path !== undefined) {
      return t("task.composer.working.reading", { path: shortToolPath(path) });
    }
  }
  const name = tool.name.trim();
  if (name !== "" && name.toLowerCase() !== "tool") {
    return t("task.composer.working.using", { name });
  }
  return undefined;
}

/** Headline for the newest relevant tool in a Steps / peek source list. */
export function liveToolsHeadline(
  entries: readonly TranscriptEntry[],
  t: Translate,
): string | undefined {
  const focus = focusLiveTool(toolsFromTranscriptEntries(entries));
  return focus === undefined ? undefined : liveToolHeadline(focus, t);
}
