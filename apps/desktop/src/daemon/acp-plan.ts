/**
 * Parse ACP `session/update` plan payloads into a `run.plan` snapshot.
 *
 * Spec (v1 `plan`, v2 `plan_update` / `plan_removed`): each update replaces the full entry list for
 * a `planId`. Unknown plan `type` values return undefined — we do not invent a checklist.
 */

import type { PlanEntry, PlanEntryPriority, PlanEntryStatus } from "@envoydev/protocol";

export type ParsedAcpPlan = {
  planId: string;
  entries: readonly PlanEntry[];
  markdown?: string;
  removed?: boolean;
};

const STATUSES = new Set<PlanEntryStatus>(["pending", "in_progress", "completed", "cancelled"]);
const PRIORITIES = new Set<PlanEntryPriority>(["high", "medium", "low"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseEntry(raw: unknown): PlanEntry | undefined {
  const row = asRecord(raw);
  if (!row) return undefined;
  const content = typeof row.content === "string" ? row.content : undefined;
  const status = typeof row.status === "string" && STATUSES.has(row.status as PlanEntryStatus)
    ? (row.status as PlanEntryStatus)
    : undefined;
  if (content === undefined || status === undefined) return undefined;
  const id = typeof row.id === "string" && row.id !== "" ? row.id : undefined;
  const priority =
    typeof row.priority === "string" && PRIORITIES.has(row.priority as PlanEntryPriority)
      ? (row.priority as PlanEntryPriority)
      : undefined;
  return {
    content,
    status,
    ...(id !== undefined ? { id } : {}),
    ...(priority !== undefined ? { priority } : {}),
  };
}

function planIdOf(plan: Record<string, unknown>, update: Record<string, unknown>): string | undefined {
  for (const key of ["planId", "id"] as const) {
    const fromPlan = plan[key];
    if (typeof fromPlan === "string" && fromPlan !== "") return fromPlan;
    const fromUpdate = update[key];
    if (typeof fromUpdate === "string" && fromUpdate !== "") return fromUpdate;
  }
  return undefined;
}

/**
 * Turn one ACP plan sessionUpdate into a run.plan payload, or undefined if it is not usable.
 */
export function parseAcpPlanUpdate(update: {
  sessionUpdate?: string;
  plan?: unknown;
  entries?: unknown;
  planId?: unknown;
}): ParsedAcpPlan | undefined {
  const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
  if (kind !== "plan" && kind !== "plan_update" && kind !== "plan_removed") return undefined;

  const updateRec = update as unknown as Record<string, unknown>;
  const plan = asRecord(update.plan) ?? {};

  if (kind === "plan_removed") {
    const planId = planIdOf(plan, updateRec) ?? "plan";
    return { planId, entries: [], removed: true };
  }

  const planId = planIdOf(plan, updateRec);
  if (planId === undefined) return undefined;

  const type = typeof plan.type === "string" ? plan.type : undefined;

  // v1: entries on the update; v2 items: plan.entries
  const rawEntries = Array.isArray(plan.entries)
    ? plan.entries
    : Array.isArray(update.entries)
      ? update.entries
      : undefined;

  if (type === "markdown" || (type === undefined && rawEntries === undefined && typeof plan.content === "string")) {
    const markdown = typeof plan.content === "string" ? plan.content : "";
    return { planId, entries: [], ...(markdown !== "" ? { markdown } : {}) };
  }

  if (type === "file") {
    // File plans need a fetch we do not do here — drop rather than invent entries.
    return undefined;
  }

  if (rawEntries === undefined) {
    // Missing list: items type → empty checklist (keep the row). Removal is only plan_removed.
    if (type === "items") return { planId, entries: [] };
    return undefined;
  }

  const entries: PlanEntry[] = [];
  for (const raw of rawEntries) {
    const entry = parseEntry(raw);
    if (entry) entries.push(entry);
  }

  if (entries.length === 0 && rawEntries.length > 0) {
    // All rows malformed — do not wipe a good plan with garbage.
    return undefined;
  }

  // Empty entries clear the checklist but keep the row; only plan_removed deletes it.
  return { planId, entries };
}
