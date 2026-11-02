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
import {
  cancelLocalAutoAcceptRun,
  deliverPendingOffer,
  startLocalAutoAcceptRun,
} from "./offer-delivery.js";
import {
  assertWriterLocks,
  dependenciesSatisfied,
  failStep,
  getJob,
  listJobs,
  note,
  pickAssignee,
  readOffers,
  reassignJobStep,
  saveJob,
  writeJsonFile,
} from "./jobs.js";
import {
  assessGitContentBus,
  gitContentBusMessage,
  gitContentBusRef,
} from "./job-git-readiness.js";
import {
  jobGitSyncMessage,
  jobGitSyncRef,
  prepareStepWorkingTree,
  shouldPullOnAccept,
  shouldPushOnSuccess,
  type JobGitSyncPolicy,
} from "./job-git-sync.js";
import {
  memberOnlineForAssign,
  normalizeTeamRecord,
  requireTeam,
  teamTokenPlain,
  touchTeamActivity,
  updateMemberConnection,
} from "./teams.js";

async function syncCwdForStep(input: {
  cwd: string;
  branch?: string;
  pullOnAccept: boolean;
}): Promise<{ ok: true } | { ok: false; policy: string }> {
  const sync = await prepareStepWorkingTree({
    cwd: input.cwd,
    ...(input.branch ? { branch: input.branch } : {}),
    pullOnAccept: input.pullOnAccept,
  });
  if (!sync.ok) return { ok: false, policy: sync.policy };
  return { ok: true };
}

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
  const team = await requireTeam(teamsPath, job.teamId);
  assertWriterLocks(job.steps, normalizeTeamRecord(team).roleCatalog);
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
  const allowDeferred = job.policy.contentBus?.allowDeferredOffers !== false;
  if (!dial.reachable && memberId !== "local") {
    if (!allowDeferred) {
      // Do not sticky-pin an offline member when deferral is off — try another candidate.
      const exclude = new Set(input.excludeMemberIds ?? []);
      exclude.add(memberId);
      return offerJobStep(jobsPath, offersPath, teamsPath, {
        ...input,
        memberId: undefined,
        excludeMemberIds: exclude,
      });
    }
    const current = await getJob(jobsPath, input.jobId);
    const currentStep = current.steps.find((s) => s.id === step.id);
    const alreadyDeferred =
      currentStep?.blocked === "peer-offline" && currentStep.assigneeMemberId === memberId;
    if (alreadyDeferred) {
      return { status: "refused", policy: "peer-offline" };
    }
    await saveJob(jobsPath, {
      ...current,
      steps: current.steps.map((s) =>
        s.id === step.id
          ? { ...s, assigneeMemberId: memberId, blocked: "peer-offline" as const }
          : s,
      ),
      ledger: [
        ...current.ledger,
        note(
          "info",
          `Assignee offline — will retry when ${member.label} is back (${dial.connection.lastDialError ?? "unreachable"})`,
          { stepId: step.id, memberId },
        ),
      ],
    });
    return { status: "refused", policy: "peer-offline" };
  }

  const refreshedTeam = await requireTeam(teamsPath, job.teamId);
  const liveMember = refreshedTeam.members.find((m) => m.id === memberId)!;
  if (!memberOnlineForAssign(liveMember, !!job.policy.allowDegradedAssignees)) {
    if (!allowDeferred) {
      const exclude = new Set(input.excludeMemberIds ?? []);
      exclude.add(memberId);
      return offerJobStep(jobsPath, offersPath, teamsPath, {
        ...input,
        memberId: undefined,
        excludeMemberIds: exclude,
      });
    }
    const current = await getJob(jobsPath, input.jobId);
    const currentStep = current.steps.find((s) => s.id === step.id);
    const alreadyDeferred =
      currentStep?.blocked === "peer-offline" && currentStep.assigneeMemberId === memberId;
    if (!alreadyDeferred) {
      await saveJob(jobsPath, {
        ...current,
        steps: current.steps.map((s) =>
          s.id === step.id
            ? { ...s, assigneeMemberId: memberId, blocked: "peer-offline" as const }
            : s,
        ),
        ledger: [
          ...current.ledger,
          note("info", `Assignee offline — deferred offer for ${liveMember.label}`, {
            stepId: step.id,
            memberId,
          }),
        ],
      });
    }
    return { status: "refused", policy: "peer-offline" };
  }

  // Re-read after dial — pause/stop/progress during the wait must not be overwritten.
  const liveJob = await getJob(jobsPath, input.jobId);
  if (liveJob.status !== "running" && liveJob.status !== "drafting") {
    return { status: "refused", policy: "job-not-accepting" };
  }
  const liveStep = liveJob.steps.find((s) => s.id === input.stepId);
  // Only mint a new offer from pending — never stack a second offer on an already-offered step.
  if (!liveStep || liveStep.status !== "pending") {
    return { status: "refused", policy: "step-not-pending" };
  }
  if (!dependenciesSatisfied(liveStep, liveJob.steps)) {
    return { status: "refused", policy: "deps-unsatisfied" };
  }

  const offerId = randomUUID();
  const cancelNonce = randomUUID();
  const offer: StepOffer = {
    offerId,
    jobId: liveJob.id,
    stepId: liveStep.id,
    teamId: liveJob.teamId,
    brief: liveStep.brief,
    role: liveStep.role,
    worktreeKey: liveStep.worktreeKey,
    cwdHint: liveStep.cwdHint,
    ...(liveStep.branch ? { branch: liveStep.branch } : {}),
    pullOnAccept: shouldPullOnAccept(liveJob.policy.contentBus),
    pushOnSuccess: shouldPushOnSuccess(liveJob.policy.contentBus),
    ...(liveStep.deadline ? { deadline: liveStep.deadline } : {}),
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
  const steps = liveJob.steps.map((s) => {
    if (s.id !== liveStep.id) return s;
    const { blocked: _cleared, ...rest } = s;
    return {
      ...rest,
      status: "offered" as const,
      assigneeMemberId: memberId,
      attempts: [...s.attempts, attempt],
    };
  });
  await saveJob(jobsPath, {
    ...liveJob,
    status: liveJob.status === "drafting" ? "running" : liveJob.status,
    steps,
    ledger: [
      ...liveJob.ledger,
      note(
        "info",
        `Offered step to ${liveMember.label} · ${dial.connection.transport}`,
        { stepId: liveStep.id, memberId },
      ),
    ],
  });

  // Loopback / local: honour AcceptPolicy (§4.7) — no silent implement auto-accept.
  // Origin Job pane Accepts pending local offers; power users set auto-roles on This machine.
  // Start a real harness *before* accept so we never mint a placeholder `job-run-…` id.
  if (shouldAutoAccept(liveMember.acceptPolicy, liveStep.role)) {
    const git = await assessGitContentBus(liveStep.cwdHint);
    if (!git.ok) {
      return refuseOfferInternal(jobsPath, offersPath, teamsPath, offerId, git.policy);
    }
    const synced = await syncCwdForStep({
      cwd: git.path,
      ...(liveStep.branch ? { branch: liveStep.branch } : {}),
      pullOnAccept: offer.pullOnAccept !== false,
    });
    if (!synced.ok) {
      return refuseOfferInternal(jobsPath, offersPath, teamsPath, offerId, synced.policy);
    }
    const resolved = { ok: true as const, path: git.path };
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
    try {
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
    } catch (error) {
      await cancelLocalAutoAcceptRun({ teamsFile: teamsPath, runId: started.runId });
      throw error;
    }
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
  let job = await getJob(jobsPath, offer.jobId);
  if (!input.skipPathCheck) {
    const git = await assessGitContentBus(input.resolvedCwd);
    if (!git.ok) {
      throw coderError(
        ENVOYDEV_ERRORS.peerRefused,
        gitContentBusMessage(git.policy),
        ref(gitContentBusRef(git.policy)),
      );
    }
    const synced = await syncCwdForStep({
      cwd: git.path,
      ...(offer.branch ? { branch: offer.branch } : {}),
      pullOnAccept:
        offer.pullOnAccept !== undefined
          ? offer.pullOnAccept
          : shouldPullOnAccept(job.policy.contentBus),
    });
    if (!synced.ok) {
      throw coderError(
        ENVOYDEV_ERRORS.peerRefused,
        jobGitSyncMessage(synced.policy as JobGitSyncPolicy),
        ref(jobGitSyncRef(synced.policy as JobGitSyncPolicy)),
      );
    }
    // Sync can take time — re-read so accept does not clobber concurrent pause/stop.
    job = await getJob(jobsPath, offer.jobId);
  }
  // Real harness runId only — never invent a placeholder the RPC wrapper cannot replace.
  const runId = input.runId;
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
    const catalog = normalizeTeamRecord(await requireTeam(teamsPath, job.teamId)).roleCatalog;
    next = await failStep(jobsPath, next, offer.stepId, `refused:${input.policy}`, catalog);
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

/** Retry pending steps that were deferred while their sticky assignee was offline. */
export async function retryDeferredOffers(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
): Promise<void> {
  const jobs = await listJobs(jobsPath);
  for (const job of jobs) {
    if (job.status !== "running") continue;
    if (job.policy.contentBus?.allowDeferredOffers === false) continue;
    for (const step of job.steps) {
      if (step.status !== "pending" || step.blocked !== "peer-offline") continue;
      if (!dependenciesSatisfied(step, job.steps)) continue;
      await offerJobStep(jobsPath, offersPath, teamsPath, {
        jobId: job.id,
        stepId: step.id,
        ...(step.assigneeMemberId ? { memberId: step.assigneeMemberId } : {}),
      });
    }
  }
}

