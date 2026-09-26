/**
 * Step offers: create, accept, refuse.
 *
 * Split from `jobs.ts` so the ledger module stays under the family's ~800-line budget.
 */

import { randomUUID } from "node:crypto";

import {
  ENVOYDEV_ERRORS,
  type Job,
  type JobStepAttempt,
  type StepOffer,
  coderError,
  shouldAutoAccept,
} from "@envoydev/protocol";

import { ref } from "./messages.js";
import { dialMember } from "./member-dial.js";
import { deliverPendingOffer, startLocalAutoAcceptRun } from "./offer-delivery.js";
import {
  assertWriterLocks,
  dependenciesSatisfied,
  failStep,
  getJob,
  note,
  pickAssignee,
  readOffers,
  reassignJobStep,
  resolveCwdHint,
  saveJob,
  writeJsonFile,
} from "./jobs.js";
import {
  memberOnlineForAssign,
  requireTeam,
  teamTokenPlain,
  touchTeamActivity,
  updateMemberConnection,
} from "./teams.js";

export async function offerJobStep(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
  input: {
    jobId: string;
    stepId: string;
    memberId?: string;
    excludeMemberIds?: ReadonlySet<string>;
  },
): Promise<{ status: "offered" | "accepted" | "refused"; offer?: StepOffer; policy?: string }> {
  const job = await getJob(jobsPath, input.jobId);
  if (job.status !== "running" && job.status !== "drafting") {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "Job is not accepting offers.", ref("error.job.notRunning"));
  }
  const step = job.steps.find((s) => s.id === input.stepId);
  if (!step) {
    throw coderError(ENVOYDEV_ERRORS.stepMissing, "No step with that id.", ref("error.job.stepMissing"));
  }
  if (!dependenciesSatisfied(step, job.steps)) {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "Step dependencies are not satisfied.", ref("error.job.deps"));
  }
  assertWriterLocks(job.steps);
  const team = await requireTeam(teamsPath, job.teamId);
  const exclude = input.excludeMemberIds ?? new Set<string>();
  const memberId =
    input.memberId && !exclude.has(input.memberId)
      ? input.memberId
      : pickAssignee(team, { ...step, assigneeMemberId: input.memberId ?? step.assigneeMemberId }, job.policy, exclude);
  if (!memberId) {
    return { status: "refused", policy: "no-candidate" };
  }
  const member = team.members.find((m) => m.id === memberId);
  if (!member) {
    return { status: "refused", policy: "no-candidate" };
  }

  // Slice 7: dial LAN → mesh → ssh before assigning a remote member.
  // Mesh probe uses the team token when present so "online" means auth would succeed.
  const meshAuthToken = await teamTokenPlain(teamsPath, job.teamId);
  const dial = await dialMember(
    { memberId, hostHints: member.hostHints },
    meshAuthToken ? { meshAuthToken } : {},
  );
  await updateMemberConnection(teamsPath, job.teamId, memberId, dial.connection);
  await touchTeamActivity(teamsPath, job.teamId);
  if (!dial.reachable && memberId !== "local") {
    const current = await getJob(jobsPath, input.jobId);
    await saveJob(jobsPath, {
      ...current,
      ledger: [
        ...current.ledger,
        note("info", `Dial failed (${dial.connection.lastDialError ?? "unreachable"})`, {
          stepId: step.id,
          memberId,
        }),
      ],
    });
    return { status: "refused", policy: "peer-offline" };
  }

  const refreshedTeam = await requireTeam(teamsPath, job.teamId);
  const liveMember = refreshedTeam.members.find((m) => m.id === memberId)!;
  if (!memberOnlineForAssign(liveMember, !!job.policy.allowDegradedAssignees)) {
    return { status: "refused", policy: "peer-offline" };
  }

  const offerId = randomUUID();
  const cancelNonce = randomUUID();
  const offer: StepOffer = {
    offerId,
    jobId: job.id,
    stepId: step.id,
    teamId: job.teamId,
    brief: step.brief,
    role: step.role,
    worktreeKey: step.worktreeKey,
    cwdHint: step.cwdHint,
    ...(step.deadline ? { deadline: step.deadline } : {}),
    assigneeMemberId: memberId,
    status: "pending",
    createdAt: new Date().toISOString(),
    cancelNonce,
  };

  const offers = await readOffers(offersPath);
  offers.offers[offerId] = offer;
  await writeJsonFile(offersPath, offers);

  const attempt: JobStepAttempt = {
    memberId,
    startedAt: offer.createdAt,
    offerId,
  };
  const steps = job.steps.map((s) =>
    s.id === step.id
      ? {
          ...s,
          status: "offered" as const,
          assigneeMemberId: memberId,
          attempts: [...s.attempts, attempt],
        }
      : s,
  );
  await saveJob(jobsPath, {
    ...job,
    status: job.status === "drafting" ? "running" : job.status,
    steps,
    ledger: [
      ...job.ledger,
      note(
        "info",
        `Offered step to ${liveMember.label} · ${dial.connection.transport}`,
        { stepId: step.id, memberId },
      ),
    ],
  });

  // Loopback / local: honour AcceptPolicy (§4.7) — no silent implement auto-accept.
  // Origin Job pane Accepts pending local offers; power users set auto-roles on This machine.
  // Start a real harness *before* accept so we never mint a placeholder `job-run-…` id.
  if (shouldAutoAccept(liveMember.acceptPolicy, step.role)) {
    const resolved = await resolveCwdHint(step.cwdHint);
    if (!resolved.ok) {
      return refuseOfferInternal(jobsPath, offersPath, teamsPath, offerId, resolved.policy);
    }
    const started = await startLocalAutoAcceptRun({
      teamsFile: teamsPath,
      offer,
      resolvedCwd: resolved.path,
    });
    if (started.kind === "failed") {
      return refuseOfferInternal(jobsPath, offersPath, teamsPath, offerId, "harness-failed");
    }
    if (started.kind !== "started") {
      // No RunManager wired (unit tests) — leave the offer pending for explicit Accept.
      return { status: "offered", offer };
    }
    const accepted = await acceptJobStepOffer(jobsPath, offersPath, {
      offerId,
      resolvedCwd: resolved.path,
      skipPathCheck: true,
      runId: started.runId,
    });
    return {
      status: "accepted",
      offer: {
        ...offer,
        status: "accepted",
        runId: accepted.runId,
      },
    };
  }

  // Every path that creates a pending remote offer must deliver — complete/retry/stall
  // call offerJobStep without going through an RPC wrapper.
  await deliverPendingOffer({ teamsFile: teamsPath, offer });
  return { status: "offered", offer };
}

async function refuseOfferInternal(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
  offerId: string,
  policy: string,
): Promise<{ status: "refused"; policy: string; offer?: StepOffer }> {
  const result = await refuseJobStepOffer(jobsPath, offersPath, teamsPath, { offerId, policy });
  return { status: "refused", policy: result.policy };
}

export async function acceptJobStepOffer(
  jobsPath: string,
  offersPath: string,
  input: { offerId: string; resolvedCwd: string; skipPathCheck?: boolean; runId: string },
): Promise<{ offerId: string; status: "accepted"; runId: string }> {
  const offers = await readOffers(offersPath);
  const offer = offers.offers[input.offerId];
  if (!offer) {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "No offer with that id.", ref("error.job.offerMissing"));
  }
  if (offer.status === "accepted") {
    if (offer.runId === input.runId) {
      return { offerId: offer.offerId, status: "accepted", runId: offer.runId };
    }
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "That offer was already accepted with a different run.",
      ref("error.job.offerClosed"),
    );
  }
  if (offer.status !== "pending") {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "That offer is no longer pending.", ref("error.job.offerClosed"));
  }
  if (!input.runId.trim()) {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "Accept requires a live harness run id.",
      ref("error.job.notRunning"),
    );
  }
  if (!input.skipPathCheck) {
    const resolved = await resolveCwdHint(input.resolvedCwd);
    if (!resolved.ok) {
      throw coderError(
        ENVOYDEV_ERRORS.peerRefused,
        "Path missing on this machine.",
        ref("error.job.pathMissing"),
      );
    }
  }

  // Real harness runId only — never invent a placeholder the RPC wrapper cannot replace.
  const runId = input.runId;
  const job = await getJob(jobsPath, offer.jobId);
  const step = job.steps.find((s) => s.id === offer.stepId);
  if (!step) {
    throw coderError(ENVOYDEV_ERRORS.stepMissing, "No step with that id.", ref("error.job.stepMissing"));
  }
  // Stale offer after reassign/stop: step must still be offered to this assignee on this offerId.
  if (step.status !== "offered") {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "That step is no longer awaiting this offer.",
      ref("error.job.offerClosed"),
    );
  }
  if (step.assigneeMemberId !== offer.assigneeMemberId) {
    throw coderError(
      ENVOYDEV_ERRORS.unauthorized,
      "That offer is for a different member.",
      ref("error.team.unknownMember"),
    );
  }
  const last = step.attempts[step.attempts.length - 1];
  if (!last || last.offerId !== offer.offerId) {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "That offer is no longer the live attempt.",
      ref("error.job.offerClosed"),
    );
  }

  const at = new Date().toISOString();
  offers.offers[offer.offerId] = {
    ...offer,
    status: "accepted",
    runId,
  };
  await writeJsonFile(offersPath, offers);

  const steps = job.steps.map((s) => {
    if (s.id !== offer.stepId) return s;
    const attempts = s.attempts.map((a) =>
      a.offerId === offer.offerId ? { ...a, runId, outcome: undefined } : a,
    );
    return {
      ...s,
      status: "running" as const,
      attempts,
      resultRef: runId,
      lastEventAt: at,
      runPhase: "starting" as const,
    };
  });
  await saveJob(jobsPath, {
    ...job,
    steps,
    ledger: [
      ...job.ledger,
      note("info", `Step accepted · cwd ${input.resolvedCwd}`, {
        stepId: offer.stepId,
        memberId: offer.assigneeMemberId,
      }),
    ],
  });
  return { offerId: offer.offerId, status: "accepted", runId };
}

export async function refuseJobStepOffer(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
  input: { offerId: string; policy: string },
): Promise<{ offerId: string; status: "refused"; policy: string; job?: Job }> {
  const offers = await readOffers(offersPath);
  const offer = offers.offers[input.offerId];
  if (!offer) {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "No offer with that id.", ref("error.job.offerMissing"));
  }
  if (offer.status === "refused" && offer.policy === input.policy) {
    return { offerId: offer.offerId, status: "refused", policy: input.policy };
  }
  if (offer.status !== "pending") {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "That offer is no longer pending.",
      ref("error.job.offerClosed"),
    );
  }
  offers.offers[offer.offerId] = { ...offer, status: "refused", policy: input.policy };
  await writeJsonFile(offersPath, offers);

  const job = await getJob(jobsPath, offer.jobId);
  const steps = job.steps.map((s) => {
    if (s.id !== offer.stepId) return s;
    const attempts = s.attempts.map((a) =>
      a.offerId === offer.offerId
        ? { ...a, endedAt: new Date().toISOString(), outcome: "refused" as const, policy: input.policy }
        : a,
    );
    return { ...s, status: "pending" as const, attempts, blocked: undefined, runPhase: undefined };
  });
  let next: Job = {
    ...job,
    steps,
    ledger: [
      ...job.ledger,
      note("info", `Offer refused (${input.policy})`, {
        stepId: offer.stepId,
        memberId: offer.assigneeMemberId,
      }),
    ],
  };
  if (job.policy.onPeerRefuse === "fail-step") {
    next = await failStep(jobsPath, next, offer.stepId, `refused:${input.policy}`);
  } else {
    // §7: refuse → reassign (default). Exclude the refusing member.
    next = await saveJob(jobsPath, next);
    try {
      const reassigned = await reassignJobStep(jobsPath, offersPath, teamsPath, {
        jobId: next.id,
        stepId: offer.stepId,
        excludeMemberIds: new Set([offer.assigneeMemberId]),
      });
      next = reassigned.job;
    } catch {
      next = await getJob(jobsPath, next.id);
    }
  }
  return { offerId: offer.offerId, status: "refused", policy: input.policy, job: next };
}

