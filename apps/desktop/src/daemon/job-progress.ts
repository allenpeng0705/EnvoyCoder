/**
 * Job progress reporting, completion, deadlines, and stall evaluation.
 *
 * Split from `jobs.ts` so the ledger module stays under the family's ~800-line budget.
 */

import {
  ENVOYDEV_ERRORS,
  type Job,
  type JobFinalReport,
  type JobLedgerNote,
  type JobStep,
  type StallPolicy,
  coderError,
} from "@envoydev/protocol";

import { ref } from "./messages.js";
import {
  assertJobNotFailed,
  buildReport,
  dependenciesSatisfied,
  failJobStep,
  getJob,
  maybeCompleteJob,
  note,
  offerJobStep,
  readJobs,
  readOffers,
  reassignJobStep,
  refuseJobStepOffer,
  retriesForAssignee,
  saveJob,
  stopJobStep,
  writeJsonFile,
} from "./jobs.js";
import { requireTeam } from "./teams.js";

type RemoteStepCancel = (job: Job, stepId: string) => Promise<void>;
const remoteCancelByJobsFile = new Map<string, RemoteStepCancel>();

/**
 * Wired from collab handlers so stall automation dials `cancelInboundJobStep`
 * the same way manual stop/fail does — not only rewrite the origin ledger.
 */
export function configureRemoteStepCancel(jobsFile: string, next: RemoteStepCancel | null): void {
  if (!next) remoteCancelByJobsFile.delete(jobsFile);
  else remoteCancelByJobsFile.set(jobsFile, next);
}

async function cancelRemoteIfWired(jobsPath: string, job: Job, stepId: string): Promise<void> {
  const cancel = remoteCancelByJobsFile.get(jobsPath);
  if (!cancel) return;
  try {
    await cancel(job, stepId);
  } catch {
    /* origin ledger still stops; peer may miss — same as a dial timeout on manual stop */
  }
}

export async function handleStepRunFailure(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
  input: { jobId: string; stepId: string; error: string },
): Promise<Job> {
  let job = await getJob(jobsPath, input.jobId);
  const step = job.steps.find((s) => s.id === input.stepId);
  if (!step) {
    throw coderError(ENVOYDEV_ERRORS.stepMissing, "No step with that id.", ref("error.job.stepMissing"));
  }
  const memberId = step.assigneeMemberId ?? "local";
  const retries = retriesForAssignee(step, memberId);
  const steps = job.steps.map((s) => {
    if (s.id !== input.stepId) return s;
    const attempts = s.attempts.map((a, i) =>
      i === s.attempts.length - 1
        ? { ...a, endedAt: new Date().toISOString(), outcome: "failed" as const, error: input.error }
        : a,
    );
    return { ...s, status: "pending" as const, attempts, runPhase: undefined };
  });
  job = await saveJob(jobsPath, {
    ...job,
    steps,
    ledger: [...job.ledger, note("info", `Run failed (${input.error})`, { stepId: input.stepId, memberId })],
  });

  if (retries < job.policy.maxRetriesPerAssignee) {
    // Same assignee retry — backoff is recorded; scheduler re-offers immediately (tests) /
    // production may delay via stall loop.
    await new Promise((r) => setTimeout(r, Math.min(job.policy.retryBackoffMs, 50)));
    await offerJobStep(jobsPath, offersPath, teamsPath, {
      jobId: job.id,
      stepId: input.stepId,
      memberId,
    });
    return getJob(jobsPath, job.id);
  }

  try {
    const result = await reassignJobStep(jobsPath, offersPath, teamsPath, {
      jobId: job.id,
      stepId: input.stepId,
      excludeMemberIds: new Set([memberId]),
    });
    return result.job;
  } catch (error) {
    const exhausted = await getJob(jobsPath, job.id);
    if (exhausted.status === "failed") {
      throw coderError(
        ENVOYDEV_ERRORS.jobFailed,
        exhausted.finalReport?.summary ?? "Job failed after exhausting retries.",
        ref("error.job.failed"),
      );
    }
    throw error;
  }
}

export async function reportJobStepProgress(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
  input: {
    jobId: string;
    stepId: string;
    memberId: string;
    runId?: string;
    runPhase?: JobStep["runPhase"];
    lastEventAt?: string;
    blocked?: JobStep["blocked"];
    outcome?: "succeeded" | "failed" | "cancelled";
    error?: string;
    ledgerMessage?: string;
    eventSeq?: number;
    approvalRequestId?: string;
  },
): Promise<Job> {
  let job = await getJob(jobsPath, input.jobId);
  const step = job.steps.find((s) => s.id === input.stepId);
  if (!step) {
    throw coderError(ENVOYDEV_ERRORS.stepMissing, "No step with that id.", ref("error.job.stepMissing"));
  }
  if (step.assigneeMemberId && step.assigneeMemberId !== input.memberId) {
    throw coderError(ENVOYDEV_ERRORS.unauthorized, "That member does not own this step.", ref("error.team.unknownMember"));
  }
  if (input.outcome) {
    if (step.status !== "running") {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        "Only a running step can report a terminal outcome.",
        ref("error.job.notRunning"),
      );
    }
    if (!step.resultRef) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        "That step has no live run to complete.",
        ref("error.job.notRunning"),
      );
    }
    if (!input.runId || input.runId !== step.resultRef) {
      throw coderError(
        ENVOYDEV_ERRORS.unauthorized,
        "That run is not bound to this step.",
        ref("error.team.badToken"),
      );
    }
  } else if (step.status !== "running") {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "Progress is only accepted for running steps.",
      ref("error.job.notRunning"),
    );
  } else if (step.resultRef && input.runId && input.runId !== step.resultRef) {
    throw coderError(
      ENVOYDEV_ERRORS.unauthorized,
      "That run is not bound to this step.",
      ref("error.team.badToken"),
    );
  }

  const at = input.lastEventAt ?? new Date().toISOString();
  let gapNote: JobLedgerNote | undefined;
  let hasGap = step.hasGap === true;
  let lastEventSeq = step.lastEventSeq;
  if (input.eventSeq !== undefined) {
    if (lastEventSeq !== undefined && input.eventSeq > lastEventSeq + 1) {
      hasGap = true;
      gapNote = note("info", `Event gap detected (seq ${lastEventSeq} → ${input.eventSeq})`, {
        stepId: input.stepId,
        memberId: input.memberId,
      });
    }
    lastEventSeq = input.eventSeq;
  }
  const steps = job.steps.map((s) => {
    if (s.id !== input.stepId) return s;
    return {
      ...s,
      ...(input.runPhase ? { runPhase: input.runPhase } : {}),
      lastEventAt: at,
      ...(lastEventSeq !== undefined ? { lastEventSeq } : {}),
      ...(hasGap ? { hasGap: true } : {}),
      ...(input.approvalRequestId
        ? { approvalRequestId: input.approvalRequestId }
        : input.runPhase && input.runPhase !== "needs-attention"
          ? { approvalRequestId: undefined }
          : {}),
      ...(input.blocked !== undefined ? { blocked: input.blocked } : { blocked: undefined }),
    };
  });
  let ledger = job.ledger;
  if (gapNote) ledger = [...ledger, gapNote];
  if (input.ledgerMessage) {
    ledger = [...ledger, note("info", input.ledgerMessage, { stepId: input.stepId, memberId: input.memberId })];
  }
  job = await saveJob(jobsPath, { ...job, steps, ledger });

  if (input.outcome === "succeeded") {
    return completeJobStep(jobsPath, offersPath, teamsPath, input.jobId, input.stepId);
  }
  if (input.outcome === "failed") {
    return handleStepRunFailure(jobsPath, offersPath, teamsPath, {
      jobId: input.jobId,
      stepId: input.stepId,
      error: input.error ?? "run-failed",
    });
  }
  if (input.outcome === "cancelled") {
    return stopJobStep(jobsPath, offersPath, {
      jobId: input.jobId,
      stepId: input.stepId,
      reason: input.error ?? "member-cancelled",
    });
  }
  return job;
}

/** Cancel in-flight offers/steps for a kicked member (§4.6). */
export async function cancelWorkForMember(
  jobsPath: string,
  offersPath: string,
  teamId: string,
  memberId: string,
): Promise<void> {
  const file = await readJobs(jobsPath);
  const offers = await readOffers(offersPath);
  for (const job of Object.values(file.jobs)) {
    if (job.teamId !== teamId) continue;
    if (job.status === "done" || job.status === "failed" || job.status === "cancelled") continue;
    let touched = false;
    const steps = job.steps.map((s) => {
      if (s.assigneeMemberId !== memberId) return s;
      if (s.status === "succeeded" || s.status === "failed" || s.status === "cancelled") return s;
      touched = true;
      return {
        ...s,
        status: "pending" as const,
        assigneeMemberId: undefined,
        attempts: s.attempts.map((a, i) =>
          i === s.attempts.length - 1
            ? { ...a, endedAt: new Date().toISOString(), outcome: "abandoned" as const, error: "kick" }
            : a,
        ),
      };
    });
    for (const offer of Object.values(offers.offers)) {
      if (
        offer.jobId === job.id &&
        offer.assigneeMemberId === memberId &&
        (offer.status === "pending" || offer.status === "accepted")
      ) {
        offers.offers[offer.offerId] = { ...offer, status: "cancelled", policy: "kick" };
        touched = true;
      }
    }
    if (touched) {
      file.jobs[job.id] = {
        ...job,
        steps,
        updatedAt: new Date().toISOString(),
        ledger: [...job.ledger, note("kick", `Cancelled work for kicked member`, { memberId })],
      };
    }
  }
  await writeJsonFile(offersPath, offers);
  await writeJsonFile(jobsPath, file);
}

/** Mark a running step succeeded (loopback / tests). */
export async function completeJobStep(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
  jobId: string,
  stepId: string,
): Promise<Job> {
  let job = await getJob(jobsPath, jobId);
  const steps = job.steps.map((s) => {
    if (s.id !== stepId) return s;
    const attempts = s.attempts.map((a, i) =>
      i === s.attempts.length - 1
        ? { ...a, endedAt: new Date().toISOString(), outcome: "succeeded" as const }
        : a,
    );
    return { ...s, status: "succeeded" as const, attempts };
  });
  job = maybeCompleteJob({
    ...job,
    steps,
    ledger: [...job.ledger, note("info", "Step succeeded", { stepId })],
  });
  job = await saveJob(jobsPath, job);
  if (job.status === "running") {
    for (const step of job.steps) {
      if (step.status !== "pending") continue;
      if (!dependenciesSatisfied(step, job.steps)) continue;
      await offerJobStep(jobsPath, offersPath, teamsPath, { jobId, stepId: step.id });
    }
  }
  return getJob(jobsPath, jobId);
}

/**
 * Enforce step deadlines (§7.3) — independent of stall automation.
 * Expired running/offered steps follow the transient → fail/reassign path.
 */
export async function evaluateDeadlines(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
  jobId: string,
  now: () => Date = () => new Date(),
): Promise<Job> {
  let job = await getJob(jobsPath, jobId);
  if (job.status !== "running") return job;
  const at = now().getTime();
  for (const step of [...job.steps]) {
    if (step.status !== "running" && step.status !== "offered") continue;
    if (!step.deadline) continue;
    const due = Date.parse(step.deadline);
    if (!Number.isFinite(due) || due > at) continue;
    job = await saveJob(jobsPath, {
      ...job,
      ledger: [
        ...job.ledger,
        note("info", "Step deadline expired", { stepId: step.id, memberId: step.assigneeMemberId }),
      ],
    });
    try {
      job = await handleStepRunFailure(jobsPath, offersPath, teamsPath, {
        jobId,
        stepId: step.id,
        error: "deadline",
      });
    } catch {
      job = await getJob(jobsPath, jobId);
    }
  }
  return job;
}

/**
 * Stall evaluation — no-ops unless `stallPolicy.automationEnabled` (ship gate §4.6).
 * Watches unacked offers, no-progress while streaming, and needs-attention past T_approval.
 * Default onStall: stop-and-retry once on the same peer, then reassign (§4.6).
 */
export async function evaluateStalls(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
  jobId: string,
  now: () => Date = () => new Date(),
): Promise<Job> {
  let job = await getJob(jobsPath, jobId);
  if (!job.stallPolicy.automationEnabled) return job;
  if (job.status !== "running") return job;
  const at = now().getTime();
  for (const step of [...job.steps]) {
    if (step.status !== "running" && step.status !== "offered") continue;
    const last = step.attempts[step.attempts.length - 1];
    const anchor = step.lastEventAt
      ? Date.parse(step.lastEventAt)
      : last
        ? Date.parse(last.startedAt)
        : 0;
    const quiet = at - anchor;

    const needsAttention = step.runPhase === "needs-attention" || step.blocked === "needs-attention";
    const threshold = needsAttention
      ? job.stallPolicy.T_approvalMs
      : job.stallPolicy.T_stallMs;
    if (quiet <= threshold) continue;

    const reason: JobStep["blocked"] = step.status === "offered"
      ? "offer-unacked"
      : needsAttention
        ? "needs-attention"
        : "no-progress";

    // Already stall-retried this assignee? (attempt error "stall")
    const stallRetries = step.attempts.filter(
      (a) => a.memberId === step.assigneeMemberId && (a.error === "stall" || a.policy === "stall"),
    ).length;

    job = await saveJob(jobsPath, {
      ...job,
      steps: job.steps.map((s) =>
        s.id === step.id ? { ...s, blocked: reason } : s,
      ),
      ledger: [
        ...job.ledger,
        note("stall", `${reason} — ${job.stallPolicy.onStall}`, {
          stepId: step.id,
          memberId: step.assigneeMemberId,
        }),
      ],
    });

    if (job.stallPolicy.onStall === "alert-only") {
      job = await getJob(jobsPath, jobId);
      continue;
    }

    // Mark current attempt abandoned before retry/reassign — dial the peer first when wired.
    await cancelRemoteIfWired(jobsPath, job, step.id);
    await stopJobStep(jobsPath, offersPath, {
      jobId,
      stepId: step.id,
      reason: "stall",
    });

    const retrySame =
      job.stallPolicy.onStall === "stop-and-retry" && stallRetries < 1 && !!step.assigneeMemberId;

    try {
      if (retrySame) {
        await offerJobStep(jobsPath, offersPath, teamsPath, {
          jobId,
          stepId: step.id,
          memberId: step.assigneeMemberId,
        });
      } else {
        await reassignJobStep(jobsPath, offersPath, teamsPath, {
          jobId,
          stepId: step.id,
          excludeMemberIds: new Set(step.assigneeMemberId ? [step.assigneeMemberId] : []),
        });
      }
    } catch {
      /* exhausted */
    }
    job = await getJob(jobsPath, jobId);
  }
  return job;
}

/** Propose steps only — never commits (§9 / slice 9). */
