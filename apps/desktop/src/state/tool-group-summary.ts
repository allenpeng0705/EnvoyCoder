/**
 * One sentence that summarises a tool group for the transcript header.
 *
 * Built at render time so each part goes through `t()` — the transcript stores counts, not prose.
 */

import type { MessageKey } from "../i18n/messages/en.js";
import type { ToolCounts } from "./tool-buckets.js";

export function toolGroupSummary(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  counts: ToolCounts,
): string {
  const parts: string[] = [];
  if (counts.edited === 1) parts.push(t("run.tools.edited.one"));
  else if (counts.edited > 1) parts.push(t("run.tools.edited.many", { count: counts.edited }));
  if (counts.ran === 1) parts.push(t("run.tools.ran.one"));
  else if (counts.ran > 1) parts.push(t("run.tools.ran.many", { count: counts.ran }));
  if (counts.searched === 1) parts.push(t("run.tools.searched.one"));
  else if (counts.searched > 1) parts.push(t("run.tools.searched.many", { count: counts.searched }));
  if (counts.other === 1) parts.push(t("run.tools.other.one"));
  else if (counts.other > 1) parts.push(t("run.tools.other.many", { count: counts.other }));
  if (parts.length === 0) return t("run.tools.summary.empty");
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return t("run.tools.summary.two", { a: parts[0]!, b: parts[1]! });
  const head = parts.slice(0, -1).join(t("run.tools.summary.comma"));
  return t("run.tools.summary.many", { head, last: parts[parts.length - 1]! });
}
