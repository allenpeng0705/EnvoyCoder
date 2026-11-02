/**
 * Map familiar run events onto Report hints — kept off WorkEngine so that file stays thin.
 */

import type { RunEvent } from "@envoydev/protocol";
import { inferReportFromHint, type WorkTicket } from "@envoydev/work-model";

export type ReportHint = Parameters<typeof inferReportFromHint>[0];

export function hintFromRunEvent(event: RunEvent): ReportHint | undefined {
  if (event.kind === "run.started") return { kind: "run-started" };
  if (event.kind === "run.ended") {
    const status =
      event.status === "done" ? "done" : event.status === "cancelled" ? "cancelled" : "failed";
    return { kind: "run-ended", status };
  }
  if (event.kind === "run.approval-requested") {
    return { kind: "approval-blocked", question: event.question };
  }
  if (event.kind === "run.approval-resolved") {
    return { kind: "approval-cleared" };
  }
  if (event.kind === "run.plan" && !event.removed && event.entries.length > 0) {
    const allPending = event.entries.every((entry) => entry.status === "pending");
    if (allPending) return { kind: "plan-review-ready" };
    // Any progress past the review gate — clear stuck person/review Attention.
    const implementing = event.entries.some(
      (entry) => entry.status === "in_progress" || entry.status === "completed",
    );
    if (implementing) return { kind: "plan-implement" };
  }
  return undefined;
}

export function attentionQuestionForHint(
  hint: ReportHint,
  inferred: ReturnType<typeof inferReportFromHint>,
): string | undefined {
  // Failed/cancelled stay person/blocked; only approval waits use person/answer.
  return hint.kind === "approval-blocked" ? inferred.attentionQuestion : undefined;
}

/** Carry the live approval id so Attention Send can settle it (steer cannot). */
export function attentionMetaForEvent(
  event: RunEvent,
): { requestId?: string; runId?: string } | undefined {
  if (event.kind !== "run.approval-requested") return undefined;
  return { requestId: event.requestId, runId: event.runId };
}

export function withAssignmentRunning(
  ticket: WorkTicket,
  runId: string,
  assignmentId: string,
  now: string,
): WorkTicket {
  const assignments = [...ticket.assignments];
  // Idempotent: launch + run.started both call this for the same runId.
  if (assignments.some((row) => row.runId === runId && row.status === "running")) {
    return ticket;
  }
  const last = assignments[assignments.length - 1];
  if (last && last.status === "pending") {
    assignments[assignments.length - 1] = {
      ...last,
      status: "running",
      runId,
      startedAt: now,
    };
  } else if (last && last.status === "running" && last.runId === undefined) {
    assignments[assignments.length - 1] = {
      ...last,
      runId,
      startedAt: last.startedAt ?? now,
    };
  } else {
    assignments.push({
      id: assignmentId,
      status: "running",
      runId,
      startedAt: now,
    });
  }
  return { ...ticket, assignments, updatedAt: now };
}

export function withAssignmentEnded(ticket: WorkTicket, runId: string, now: string): WorkTicket {
  const assignments = ticket.assignments.map((assignment) =>
    assignment.runId === runId ? { ...assignment, status: "ended" as const, endedAt: now } : assignment,
  );
  return { ...ticket, assignments, updatedAt: now };
}
