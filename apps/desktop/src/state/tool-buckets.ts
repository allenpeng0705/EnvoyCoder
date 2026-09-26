/**
 * Classify a tool call for the transcript's grouped summary.
 *
 * Names and ACP `kind` values vary by agent; the buckets are what a user reads
 * ("edited 3 files, ran 2 commands") rather than the agent's vocabulary.
 */

export type ToolBucket = "edited" | "ran" | "searched" | "other";

export interface ToolCounts {
  edited: number;
  ran: number;
  searched: number;
  other: number;
}

export function emptyToolCounts(): ToolCounts {
  return { edited: 0, ran: 0, searched: 0, other: 0 };
}

/** Which summary bucket a tool name (and optional ACP kind) falls into. */
export function toolBucket(name: string, kind?: string): ToolBucket {
  const k = (kind ?? "").toLowerCase();
  if (k === "edit" || k === "write" || k === "delete") return "edited";
  if (k === "execute" || k === "terminal") return "ran";
  if (k === "search" || k === "read" || k === "fetch") return "searched";

  const n = name.toLowerCase();
  if (
    /write|edit|create|patch|apply_patch|str_replace|delete_file|notebook|multi_edit|file_edit/.test(n)
  ) {
    return "edited";
  }
  if (/shell|bash|exec|terminal|command|run_terminal|powershell/.test(n)) return "ran";
  if (/search|grep|glob|find|read|list_dir|ls |web_search|semantic/.test(n)) return "searched";
  return "other";
}

export function countToolBuckets(
  tools: readonly { name: string; kind?: string }[],
): ToolCounts {
  const counts = emptyToolCounts();
  for (const tool of tools) {
    counts[toolBucket(tool.name, tool.kind)] += 1;
  }
  return counts;
}

/**
 * A path a write/edit tool named in its arguments, when we can read one.
 *
 * Agents disagree on the field name; these are the ones we have seen on the wire.
 */
export function pathFromToolInput(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath", "file", "target_file", "filename", "target"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

/** True when this tool is likely to have changed a file — the seed for `run.diff`. */
export function isFileMutatingTool(name: string, kind?: string): boolean {
  return toolBucket(name, kind) === "edited";
}
