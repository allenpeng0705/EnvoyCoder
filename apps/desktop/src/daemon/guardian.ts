/**
 * Thin Guardian: auto-allow clear non-destructive permission cards only.
 *
 * Not a second LLM. Fail closed — unknown kinds, shell commands, and ambiguous
 * tool names still ask the user.
 */

import type { AcpPermissionRequest } from "./acp/protocol.js";

/** ACP kinds that are unambiguously non-mutating. `think` / `lookup` are excluded on purpose. */
const READ_KINDS = new Set(["read", "search"]);

/**
 * Exact tool ids (lowercased) Guardian may auto-allow when kind is absent.
 * Substring matching is refused — `"breadcrumb"` must not look like `"read"`.
 */
const READ_TOOLS = new Set([
  "read",
  "read_file",
  "readfile",
  "search",
  "grep",
  "glob",
  "list_dir",
  "listdir",
  "list_directory",
]);

/**
 * True when Guardian may answer this permission without showing a card.
 *
 * ask_user / plan review never reach this helper — those use a different ACP method.
 */
export function guardianMayAutoAllow(request: AcpPermissionRequest): boolean {
  // Destructive args veto everything — including a forged `kind: "read"`.
  if (hasDestructiveArgs(request.args)) return false;

  const kind = request.toolCall?.kind?.trim().toLowerCase();
  if (kind !== undefined && kind !== "") {
    return READ_KINDS.has(kind);
  }

  const tool =
    (typeof request.toolName === "string" ? request.toolName : undefined)?.trim().toLowerCase() ??
    "";
  if (tool !== "" && READ_TOOLS.has(tool)) return true;

  return false;
}

function hasDestructiveArgs(args: unknown): boolean {
  const record = asRecord(args);
  if (record === undefined) return false;
  if (typeof record.command === "string" && record.command.trim() !== "") return true;
  // Writes / deletes named in common ACP arg shapes — unknown means ask, not allow.
  for (const key of ["content", "new_string", "old_string", "patch", "edits", "diff"]) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") return true;
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
