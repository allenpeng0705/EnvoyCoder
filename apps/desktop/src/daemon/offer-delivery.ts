/**
 * Deliver a pending StepOffer to a remote member after `offerJobStep` persists it.
 *
 * Handlers used to deliver only from a few RPC wrappers; internal complete/retry/stall
 * paths called `offerJobStep` and left peers blind. One hook keeps create + deliver atomic
 * for every caller.
 *
 * Deliverers are keyed by `teamsFile` so two daemons in one process (tests) cannot
 * overwrite each other's hooks.
 */

import type { StepOffer } from "@envoydev/protocol";

import { requireTeam, teamTokenPlain } from "./teams.js";

export type OfferDeliverer = (
  offer: StepOffer,
  hostHints: string | undefined,
  teamToken: string,
) => Promise<void>;

/** Start a real harness for a local auto-accept (returns harness runId). */
export type LocalAutoAcceptStarter = (
  offer: StepOffer,
  resolvedCwd: string,
) => Promise<{ runId: string } | undefined>;

export type LocalAutoAcceptOutcome =
  | { kind: "started"; runId: string }
  /** No daemon harness wired (ledger unit tests). */
  | { kind: "unavailable" }
  /** Harness was wired but failed to start. */
  | { kind: "failed" };

const deliverers = new Map<string, OfferDeliverer>();
const localStarters = new Map<string, LocalAutoAcceptStarter>();

/** Wired once per daemon from collab handlers (has peerCall + originWs). */
export function configureOfferDelivery(teamsFile: string, next: OfferDeliverer | null): void {
  if (!next) deliverers.delete(teamsFile);
  else deliverers.set(teamsFile, next);
}

/** Wired once per daemon so ledger auto-accept can mint a real harness runId. */
export function configureLocalAutoAccept(teamsFile: string, next: LocalAutoAcceptStarter | null): void {
  if (!next) localStarters.delete(teamsFile);
  else localStarters.set(teamsFile, next);
}

/**
 * If the offer is pending for a remote member, push it over the member channel.
 * No-op when delivery is not configured (unit tests that only exercise the ledger).
 */
export async function deliverPendingOffer(options: {
  teamsFile: string;
  offer: StepOffer;
}): Promise<void> {
  const deliverer = deliverers.get(options.teamsFile);
  if (!deliverer) return;
  if (options.offer.status !== "pending") return;
  if (options.offer.assigneeMemberId === "local") return;
  const token = await teamTokenPlain(options.teamsFile, options.offer.teamId);
  if (!token) return;
  const team = await requireTeam(options.teamsFile, options.offer.teamId);
  const member = team.members.find((m) => m.id === options.offer.assigneeMemberId);
  if (!member) return;
  await deliverer(options.offer, member.hostHints ?? member.connection.endpoint, token);
}

/**
 * When AcceptPolicy auto-accepts a local step, start a harness before persisting `runId`.
 * Distinguishes "no harness in this process" from "harness failed" so callers can refuse.
 */
export async function startLocalAutoAcceptRun(options: {
  teamsFile: string;
  offer: StepOffer;
  resolvedCwd: string;
}): Promise<LocalAutoAcceptOutcome> {
  const starter = localStarters.get(options.teamsFile);
  if (!starter) return { kind: "unavailable" };
  if (options.offer.assigneeMemberId !== "local") return { kind: "unavailable" };
  try {
    const started = await starter(options.offer, options.resolvedCwd);
    if (!started) return { kind: "failed" };
    return { kind: "started", runId: started.runId };
  } catch {
    return { kind: "failed" };
  }
}
