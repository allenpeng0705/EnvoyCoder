/**
 * Collab peer delivery, local run watch, and cancel ACK.
 *
 * Split from `collab-handlers.ts` so the RPC table stays nearer the family line budget.
 */

import type { Job, StepOffer } from "@envoydev/protocol";

import { callPeerDaemon } from "./peer-rpc.js";
import type { CollabDeps } from "./collab-deps.js";
import { startRunForOffer } from "./job-step-run.js";
import { patchInboundOffer } from "./memberships.js";
import {
  acceptJobStepOffer,
  remoteCancelTargets,
  reportJobStepProgress,
  resolveCwdHint,
} from "./jobs.js";
import { requireTeam, teamTokenPlain } from "./teams.js";
import { daemonWsUrl } from "./team-invite.js";
import { firstLanAddress } from "./pairing.js";

export async function cancelRemoteWork(
  deps: CollabDeps,
  job: import("@envoydev/protocol").Job,
  stepId?: string,
): Promise<{ missedAcks: number }> {
  const team = await requireTeam(deps.paths.teamsFile, job.teamId);
  const token = await teamTokenPlain(deps.paths.teamsFile, job.teamId);
  if (!token) return { missedAcks: 0 };
  const targets = await remoteCancelTargets(job, deps.paths.jobOffersFile, stepId);
  const ackMs = job.stallPolicy.T_cancelAckMs;
  let missedAcks = 0;
  for (const target of targets) {
    const member = team.members.find((m) => m.id === target.memberId);
    const url = member?.hostHints ?? member?.connection.endpoint;
    if (!url || !target.offerId || !target.cancelNonce) {
      missedAcks += 1;
      continue;
    }
    const outcome = await peerCall(deps)<{ cancelled: boolean; runCancelled: boolean }>({
      url,
      method: "coder.cancelInboundJobStep",
      params: {
        teamId: job.teamId,
        teamToken: token,
        offerId: target.offerId,
        cancelNonce: target.cancelNonce,
        ...(target.runId ? { runId: target.runId } : {}),
        reason: "orchestrator-stop",
      },
      timeoutMs: Math.max(ackMs, 2_000),
    });
    if (!outcome.ok || !outcome.result.cancelled) {
      missedAcks += 1;
    }
  }
  return { missedAcks };
}

export function listenPort(deps: CollabDeps): number {
  return typeof deps.port === "function" ? deps.port() : deps.port;
}

export function selfWsUrls(deps: CollabDeps): string[] {
  const path = deps.wsPath ?? "/ws";
  const port = listenPort(deps);
  const urls = [daemonWsUrl("127.0.0.1", port, path)];
  const lan = firstLanAddress();
  if (lan) urls.push(daemonWsUrl(lan, port, path));
  return urls;
}

export function originWsForInvite(deps: CollabDeps): string {
  const path = deps.wsPath ?? "/ws";
  const lan = firstLanAddress();
  return daemonWsUrl(lan ?? "127.0.0.1", listenPort(deps), path);
}

export function selfHostHint(deps: CollabDeps): string {
  return originWsForInvite(deps);
}

export function peerCall(deps: CollabDeps) {
  return deps.callPeer ?? callPeerDaemon;
}

export async function deliverOfferToMember(
  deps: CollabDeps,
  offer: StepOffer,
  memberHostHints: string | undefined,
  teamToken: string,
): Promise<void> {
  if (!memberHostHints || offer.assigneeMemberId === "local") return;
  const originWs = originWsForInvite(deps);
  const outcome = await peerCall(deps)({
    url: memberHostHints,
    method: "coder.inboundJobStepOffer",
    params: { offer, originWs, teamToken },
    timeoutMs: 10_000,
  });
  if (!outcome.ok) {
    // Offer stays pending on origin; member can still be reached on retry / reassign.
    console.warn(`[collab] failed to deliver offer ${offer.offerId}: ${outcome.message}`);
  }
}

export async function maybeStartLocalRun(
  deps: CollabDeps,
  offer: StepOffer,
  resolvedCwd: string,
  projectId?: string,
  remote?: { originWs: string; teamToken: string; memberToken: string },
): Promise<{ runId: string; taskId: string } | undefined> {
  if (!deps.runs) return undefined;
  try {
    const started = await startRunForOffer(
      { store: deps.store, runs: deps.runs },
      offer,
      resolvedCwd,
      projectId,
    );
    void watchRunForJob(deps, offer, started.runId, remote);
    return started;
  } catch (error) {
    console.warn(`[collab] could not start harness for offer ${offer.offerId}: ${String(error)}`);
    return undefined;
  }
}

export async function reportProgressForOffer(
  deps: CollabDeps,
  offer: StepOffer,
  input: {
    runId: string;
    runPhase?: import("@envoydev/protocol").RunPhase;
    blocked?: import("@envoydev/protocol").BlockReason;
    outcome?: "succeeded" | "failed" | "cancelled";
    error?: string;
    eventSeq?: number;
    approvalRequestId?: string;
  },
  remote?: { originWs: string; teamToken: string; memberToken: string },
): Promise<void> {
  const params = {
    jobId: offer.jobId,
    stepId: offer.stepId,
    memberId: offer.assigneeMemberId,
    runId: input.runId,
    lastEventAt: new Date().toISOString(),
    ...(input.runPhase ? { runPhase: input.runPhase } : {}),
    ...(input.blocked ? { blocked: input.blocked } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.eventSeq !== undefined ? { eventSeq: input.eventSeq } : {}),
    ...(input.approvalRequestId ? { approvalRequestId: input.approvalRequestId } : {}),
  };
  if (remote) {
    await peerCall(deps)({
      url: remote.originWs,
      method: "coder.reportJobStepProgress",
      params: {
        ...params,
        teamToken: remote.teamToken,
        memberToken: remote.memberToken,
      },
    });
    return;
  }
  await reportJobStepProgress(deps.paths.jobsFile, deps.paths.jobOffersFile, deps.paths.teamsFile, params);
}

export async function watchRunForJob(
  deps: CollabDeps,
  offer: StepOffer,
  runId: string,
  remote?: { originWs: string; teamToken: string; memberToken: string },
): Promise<void> {
  if (!deps.runs) return;
  let lastSeq = -1;
  let lastApprovalId: string | undefined;
  for (let i = 0; i < 3_600; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    if (deps.runs.isLive(runId)) {
      const events = deps.runs.events(runId);
      const last = events[events.length - 1];
      if (last) {
        const seq = events.length - 1;
        const needsAttention = last.kind === "run.approval-requested";
        const requestId =
          needsAttention && "requestId" in last
            ? String((last as { requestId?: string }).requestId ?? "")
            : undefined;
        if (needsAttention && requestId && requestId !== lastApprovalId) {
          lastApprovalId = requestId;
          if (remote) {
            await patchInboundOffer(deps.paths.inboundJobOffersFile, offer.offerId, {
              pendingApproval: { requestId, runId },
            });
          }
        }
        if (seq !== lastSeq || needsAttention) {
          lastSeq = seq;
          try {
            await reportProgressForOffer(
              deps,
              offer,
              {
                runId,
                runPhase: needsAttention ? "needs-attention" : "streaming",
                ...(needsAttention ? { blocked: "needs-attention" as const } : {}),
                eventSeq: seq,
                ...(requestId ? { approvalRequestId: requestId } : {}),
              },
              remote,
            );
          } catch {
            /* job may have been cancelled */
          }
        }
      }
      continue;
    }
    const run = deps.runs.get(runId);
    const status = run?.status;
    try {
      await reportProgressForOffer(
        deps,
        offer,
        {
          runId,
          runPhase: "idle",
          outcome: status === "done" ? "succeeded" : status === "cancelled" ? "cancelled" : "failed",
          ...(status && status !== "done" ? { error: String(status) } : {}),
          eventSeq: lastSeq >= 0 ? lastSeq + 1 : 0,
        },
        remote,
      );
    } catch {
      /* ignore */
    }
    return;
  }
}

