/**
 * Work Engine nouns — Tickets, Mandates, Reports, Policy.
 *
 * User-facing copy says "Work item"; wire and code say Ticket.
 * Pure data: no I/O. See docs/superagent-control-plane-design.md.
 */

export const WORK_REPORTS = [
  "progress",
  "waiting",
  "ready",
  "blocked",
  "failed",
  "dropped",
] as const;
export type WorkReportKind = (typeof WORK_REPORTS)[number];

export const WORK_STAGES = [
  "person/delivery",
  "person/answer",
  "person/review",
  "person/blocked",
  "working/queued",
  "idle",
  "working",
] as const;
export type WorkStage = (typeof WORK_STAGES)[number];

export const ACCEPT_MODES = ["off", "observe", "auto"] as const;
export type AcceptMode = (typeof ACCEPT_MODES)[number];

export const MANDATE_STRENGTHS = ["explicit", "inferred"] as const;
export type MandateStrength = (typeof MANDATE_STRENGTHS)[number];

export const TICKET_STATUSES = ["open", "ended"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const ASSIGNMENT_STATUSES = ["pending", "running", "ended"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const EFFECT_KINDS = ["launch", "deliver", "notify", "assess", "reply"] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export const EFFECT_STATUSES = ["pending", "done", "failed"] as const;
export type EffectStatus = (typeof EFFECT_STATUSES)[number];

export const DECISION_OUTCOMES = ["accept", "attach", "ignore", "stop", "would-accept"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export interface WorkMandate {
  id: string;
  policyVersion: number;
  strength: MandateStrength;
  scope: string;
  createdAt: string;
}

export interface WorkAttention {
  question: string;
  askedAt: string;
  /** When set, Answer must settle this run approval — steer cannot. */
  requestId?: string;
  runId?: string;
}

export interface WorkReport {
  kind: WorkReportKind;
  note?: string;
  at: string;
}

export interface WorkAssignment {
  id: string;
  status: AssignmentStatus;
  runId?: string;
  harness?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface WorkTicket {
  id: string;
  shortName: string;
  title: string;
  projectId?: string;
  /** 0..1 link to an EnvoyDev Task for transcript UI. */
  taskId?: string;
  /**
   * Channel thread key when this Ticket came from an external Source
   * (e.g. `github:owner/repo#N`) — used for ack / result / attention replies.
   */
  externalRef?: string;
  status: TicketStatus;
  mandate: WorkMandate;
  assignments: WorkAssignment[];
  latestReport?: WorkReport;
  attention?: WorkAttention;
  deliveryFailed?: boolean;
  enabled?: boolean;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  endReason?: string;
}

export interface WorkPolicy {
  version: number;
  acceptMode: AcceptMode;
  /** Placeholder allow-list (Source identities later). */
  allowList: string[];
  /** Refuse unattended Assignment when the worker lacks approvals. */
  requireApprovalsForUnattended: boolean;
  /** Product kill switch — when false, Work Engine creates nothing. */
  enabled: boolean;
  /**
   * Background GitHub poll interval in ms. `0` = off (default).
   * Settings presets: 5m / 15m / 60m.
   */
  githubPollIntervalMs: number;
  /** Optional `owner/name`; empty/undefined = notifications poll. */
  githubPollRepo?: string;
  updatedAt: string;
}

export interface WorkEffect {
  id: string;
  kind: EffectKind;
  ticketId?: string;
  payload: Record<string, unknown>;
  status: EffectStatus;
  receiptKey?: string;
  createdAt: string;
  doneAt?: string;
  error?: string;
}

export interface WorkCandidate {
  id: string;
  text: string;
  strength: MandateStrength;
  sourceKind: "manual" | "github";
  externalRef?: string;
  createdAt: string;
  disposition?: DecisionOutcome;
  dispositionNote?: string;
  ticketId?: string;
}

export interface WorkTrigger {
  id: string;
  sourceKind: string;
  externalId: string;
  text: string;
  actor?: string;
  threadKey: string;
  createdAt: string;
}

export function defaultWorkPolicy(now = new Date().toISOString()): WorkPolicy {
  return {
    version: 1,
    acceptMode: "observe",
    allowList: [],
    requireApprovalsForUnattended: true,
    enabled: false,
    githubPollIntervalMs: 0,
    updatedAt: now,
  };
}
