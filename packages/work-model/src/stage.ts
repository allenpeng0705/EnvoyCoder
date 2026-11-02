/**
 * Ticket stage — derived, never free-text.
 * First matching row wins (design doc §5.4 / prototype docs/003).
 */

import type { WorkStage, WorkTicket } from "./types.js";

/** True when the latest report is blocked/failed and still needs a person. */
export function waitsForPerson(ticket: WorkTicket): boolean {
  const kind = ticket.latestReport?.kind;
  return kind === "blocked" || kind === "failed";
}

export function ticketStage(ticket: WorkTicket): WorkStage {
  if (ticket.status === "ended") return "idle";
  if (ticket.deliveryFailed === true) return "person/delivery";
  if (ticket.attention !== undefined && ticket.attention.question.trim() !== "") {
    return "person/answer";
  }
  const report = ticket.latestReport?.kind;
  if (report === "ready") return "person/review";
  if (report === "blocked" || report === "failed") return "person/blocked";
  const latest = ticket.assignments[ticket.assignments.length - 1];
  if (latest === undefined || latest.status === "pending") return "working/queued";
  if (report === "waiting" || latest.status === "ended") return "idle";
  return "working";
}

/** Attention view only shows person/* stages. */
export function needsAttention(ticket: WorkTicket): boolean {
  if (ticket.status !== "open") return false;
  return ticketStage(ticket).startsWith("person/");
}

export function attentionLabel(stage: WorkStage): string {
  switch (stage) {
    case "person/delivery":
      return "Input undelivered";
    case "person/answer":
      return "Awaiting answer";
    case "person/review":
      return "Awaiting review";
    case "person/blocked":
      return "Blocked";
    case "working/queued":
      return "Queued";
    case "idle":
      return "Waiting";
    case "working":
      return "Working";
  }
}
