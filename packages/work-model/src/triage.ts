/**
 * Gate + disposition for candidates (Phase 3).
 * Pure: no model calls — host supplies assessment when needed.
 */

import type {
  AcceptMode,
  DecisionOutcome,
  MandateStrength,
  WorkCandidate,
  WorkPolicy,
} from "./types.js";

export type GateResult =
  | { admit: true; strength: MandateStrength }
  | { admit: false; reason: string };

/** Deterministic gate before any assessment. */
export function gateCandidate(
  candidate: Pick<WorkCandidate, "strength" | "text">,
  policy: WorkPolicy,
): GateResult {
  if (!policy.enabled) {
    return { admit: false, reason: "Work items are turned off in Settings." };
  }
  const text = candidate.text.trim();
  if (text.length === 0) {
    return { admit: false, reason: "Empty candidate." };
  }
  if (policy.acceptMode === "off" && candidate.strength === "inferred") {
    return { admit: false, reason: "Inferred candidates are off." };
  }
  if (
    policy.allowList.length > 0 &&
    candidate.strength === "inferred" &&
    !policy.allowList.some((entry) => text.toLowerCase().includes(entry.toLowerCase()))
  ) {
    return { admit: false, reason: "Inferred candidate is not on the allow-list." };
  }
  return { admit: true, strength: candidate.strength };
}

export interface TriageInput {
  candidate: WorkCandidate;
  policy: WorkPolicy;
  /** When true, assessment would accept (host or model). */
  assessmentAccepts?: boolean;
}

export interface TriageResult {
  outcome: DecisionOutcome;
  note: string;
  createTicket: boolean;
}

/**
 * Apply accept mode after the gate.
 * Phase 1/2: callers typically only use observe recording.
 * Phase 3+: auto may create Tickets for explicit (or assessed inferred).
 */
export function disposeCandidate(input: TriageInput): TriageResult {
  const gated = gateCandidate(input.candidate, input.policy);
  if (!gated.admit) {
    return { outcome: "ignore", note: gated.reason, createTicket: false };
  }

  const wantsAccept =
    gated.strength === "explicit"
      ? input.assessmentAccepts !== false
      : input.assessmentAccepts === true;

  if (!wantsAccept) {
    return { outcome: "ignore", note: "Assessment declined.", createTicket: false };
  }

  const mode: AcceptMode = input.policy.acceptMode;
  if (mode === "off") {
    return { outcome: "ignore", note: "Accept mode is off.", createTicket: false };
  }
  if (mode === "observe") {
    return {
      outcome: "would-accept",
      note: "Would accept (observe mode — no Work item created).",
      createTicket: false,
    };
  }
  // auto
  if (gated.strength === "inferred" && input.assessmentAccepts !== true) {
    return {
      outcome: "ignore",
      note: "Inferred accept requires a positive assessment.",
      createTicket: false,
    };
  }
  return { outcome: "accept", note: "Accepted.", createTicket: true };
}
