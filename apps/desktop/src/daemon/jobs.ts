/**
 * Job + JobStep ledger, offers, scheduler, failure machine (M5).
 *
 * See `docs/envoydev-collaboration.md` §§5–7. Stall automation respects the §4.6 ship gate
 * (`stallPolicy.automationEnabled`).
 */

import { randomUUID } from "node:crypto";
import { access, constants, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  DEFAULT_FAILURE_POLICY,
  DEFAULT_STALL_POLICY,
  ENVOYDEV_ERRORS,
  type FailurePolicy,
  type Job,
  type JobFinalReport,
  type JobLedgerNote,
  type JobRole,
  type JobStep,
  type JobStepAttempt,
  type RoleDef,
  type StallPolicy,
  type StepOffer,
  coderError,
  effectiveRoles,
  isWriterRole,
  shouldAutoAccept,
} from "@envoydev/protocol";

import { ref } from "./messages.js";
import {
  type TeamRecord,
  assertStepsInCatalog,
  memberOnlineForAssign,
  normalizeTeamRecord,
  requireTeam,
  teamTokenPlain,
  touchTeamActivity,
  updateMemberConnection,
} from "./teams.js";
import {
  offerJobStep,
  acceptJobStepOffer,
  refuseJobStepOffer,
} from "./job-offers.js";
import {
  buildJobStepTemplate,
  listJobStepTemplates,
  type JobStepTemplateId,
  type SuggestJobStepsOptions,
} from "./job-step-templates.js";
import { assessGitContentBus, throwGitContentBus } from "./job-git-readiness.js";

export { listJobStepTemplates, type JobStepTemplateId, type SuggestJobStepsOptions };

export interface JobFile {
  jobs: Record<string, Job>;
}

export interface OfferFile {
  offers: Record<string, StepOffer>;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT";
}

async function readJsonFile<T>(path: string, empty: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isMissing(error)) return empty;
    return empty;
  }
}

export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

type JobsChanged = (jobId: string) => void;
const jobsChangedByFile = new Map<string, JobsChanged>();

/** Wired from the daemon so UI rails refresh when the job ledger mutates. */
export function configureJobsChanged(jobsFile: string, next: JobsChanged | null): void {
  if (!next) jobsChangedByFile.delete(jobsFile);
  else jobsChangedByFile.set(jobsFile, next);
}

function emitJobsChanged(jobsPath: string, jobId: string): void {
  jobsChangedByFile.get(jobsPath)?.(jobId);
}

export async function readJobs(path: string): Promise<JobFile> {
  const file = await readJsonFile<JobFile>(path, { jobs: {} });
  if (typeof file.jobs !== "object" || file.jobs === null) return { jobs: {} };
  return file;
}

export async function readOffers(path: string): Promise<OfferFile> {
  const file = await readJsonFile<OfferFile>(path, { offers: {} });
  if (typeof file.offers !== "object" || file.offers === null) return { offers: {} };
  return file;
}

export function note(
  kind: JobLedgerNote["kind"],
  message: string,
  extra?: { stepId?: string; memberId?: string },
): JobLedgerNote {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    message,
    ...extra,
  };
}

function mergePolicy(partial?: Partial<FailurePolicy>): FailurePolicy {
  return { ...DEFAULT_FAILURE_POLICY, ...partial };
}

export type JobStepDraft = {
  id?: string;
  role: JobRole;
  brief: string;
  worktreeKey: string;
  cwdHint: string;
  dependsOn?: readonly string[];
  assigneeMemberId?: string;
  deadline?: string;
};

function draftToStep(jobId: string, draft: JobStepDraft): JobStep {
  return {
    id: draft.id ?? randomUUID(),
    jobId,
    role: draft.role,
    brief: draft.brief,
    worktreeKey: draft.worktreeKey,
    cwdHint: draft.cwdHint,
    ...(draft.dependsOn ? { dependsOn: draft.dependsOn } : {}),
    ...(draft.assigneeMemberId ? { assigneeMemberId: draft.assigneeMemberId } : {}),
    ...(draft.deadline ? { deadline: draft.deadline } : {}),
    status: "pending",
    attempts: [],
    reassignCount: 0,
  };
}

export function dependenciesSatisfied(step: JobStep, steps: readonly JobStep[]): boolean {
  if (!step.dependsOn || step.dependsOn.length === 0) return true;
  const byId = new Map(steps.map((s) => [s.id, s]));
  return step.dependsOn.every((id) => {
    const dep = byId.get(id);
    return dep?.status === "succeeded";
  });
}

/**
 * One writer role per worktreeKey among steps that can run *now* (catalog.writer).
 * Sequential chains may share a key: later writers stay blocked by `dependsOn` until
 * the earlier step succeeds and frees the lock.
 */
export function assertWriterLocks(
  steps: readonly JobStep[],
  catalog: readonly RoleDef[] = [],
): void {
  const writers = new Map<string, string>();
  for (const step of steps) {
    if (!isWriterRole(step.role, catalog)) continue;
    if (step.status === "succeeded" || step.status === "failed" || step.status === "cancelled") continue;
    // Pending but waiting on deps cannot race — same key is fine until they unlock.
    if (step.status === "pending" && !dependenciesSatisfied(step, steps)) continue;
    const existing = writers.get(step.worktreeKey);
    if (existing !== undefined && existing !== step.id) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        `Two writer steps share worktree key “${step.worktreeKey}”.`,
        ref("error.job.writerLock", { key: step.worktreeKey }),
      );
    }
    writers.set(step.worktreeKey, step.id);
  }
}

export async function createJob(
  jobsPath: string,
  input: {
    teamId: string;
    title: string;
    goal: string;
    projectId?: string;
    steps?: readonly JobStepDraft[];
    policy?: Partial<FailurePolicy>;
  },
  teamsPath?: string,
): Promise<Job> {
  const file = await readJobs(jobsPath);
  const at = new Date().toISOString();
  const id = randomUUID();
  const steps = (input.steps ?? []).map((d) => draftToStep(id, d));
  let catalog: readonly RoleDef[] = [];
  if (teamsPath) {
    const team = await requireTeam(teamsPath, input.teamId);
    catalog = normalizeTeamRecord(team).roleCatalog;
    assertStepsInCatalog(steps, catalog);
  }
  assertWriterLocks(steps, catalog);
  const job: Job = {
    id,
    teamId: input.teamId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    title: input.title.trim(),
    goal: input.goal.trim(),
    status: "drafting",
    steps,
    policy: mergePolicy(input.policy),
    stallPolicy: { ...DEFAULT_STALL_POLICY },
    ledger: [note("info", `Job created: ${input.title.trim()}`)],
    createdAt: at,
    updatedAt: at,
  };
  file.jobs[id] = job;
  await writeJsonFile(jobsPath, file);
  return job;
}

export async function listJobs(
  jobsPath: string,
  filter?: { teamId?: string; projectId?: string },
): Promise<Job[]> {
  const file = await readJobs(jobsPath);
  return Object.values(file.jobs)
    .filter((j) => (filter?.teamId ? j.teamId === filter.teamId : true))
    .filter((j) => (filter?.projectId ? j.projectId === filter.projectId : true))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getJob(jobsPath: string, jobId: string): Promise<Job> {
  const file = await readJobs(jobsPath);
  const job = file.jobs[jobId];
  if (!job) {
    throw coderError(ENVOYDEV_ERRORS.jobMissing, "No job with that id.", ref("error.job.missing"));
  }
  return job;
}

export async function saveJob(jobsPath: string, job: Job): Promise<Job> {
  const file = await readJobs(jobsPath);
  const next = { ...job, updatedAt: new Date().toISOString() };
  file.jobs[job.id] = next;
  await writeJsonFile(jobsPath, file);
  emitJobsChanged(jobsPath, job.id);
  return next;
}

export async function updateJobSteps(
  jobsPath: string,
  jobId: string,
  drafts: readonly JobStepDraft[],
  teamsPath?: string,
): Promise<Job> {
  const job = await getJob(jobsPath, jobId);
  if (job.status !== "drafting" && job.status !== "running") {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "Steps can only be edited while the job is drafting or running.",
      ref("error.job.stepsLocked"),
    );
  }
  const steps = drafts.map((d) => {
    const existing = d.id ? job.steps.find((s) => s.id === d.id) : undefined;
    if (existing && existing.status !== "pending") return existing;
    return draftToStep(jobId, d);
  });
  // Replacing a running graph must not drop offered/running/succeeded steps (Suggest uses new ids).
  for (const existing of job.steps) {
    if (existing.status === "pending") continue;
    if (!steps.some((s) => s.id === existing.id)) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        "Cannot replace steps that are already in progress. Pause the job first, or edit only pending steps.",
        ref("error.job.stepsInFlight"),
      );
    }
  }
  let catalog: readonly RoleDef[] = [];
  if (teamsPath) {
    const team = await requireTeam(teamsPath, job.teamId);
    catalog = normalizeTeamRecord(team).roleCatalog;
    assertStepsInCatalog(steps, catalog);
  }
  assertWriterLocks(steps, catalog);
  return saveJob(jobsPath, {
    ...job,
    steps,
    ledger: [...job.ledger, note("info", `Steps updated (${steps.length})`)],
  });
}

export async function resolveCwdHint(cwdHint: string): Promise<{ ok: true; path: string } | { ok: false; policy: string }> {
  try {
    const s = await stat(cwdHint);
    if (!s.isDirectory()) return { ok: false, policy: "path-missing" };
    await access(cwdHint, constants.R_OK);
    return { ok: true, path: cwdHint };
  } catch {
    return { ok: false, policy: "path-missing" };
  }
}

export function pickAssignee(
  team: TeamRecord,
  step: JobStep,
  policy: FailurePolicy,
  excludeMemberIds: ReadonlySet<string> = new Set(),
): string | undefined {
  if (
    step.assigneeMemberId &&
    !excludeMemberIds.has(step.assigneeMemberId)
  ) {
    const sticky = team.members.find((m) => m.id === step.assigneeMemberId);
    if (
      sticky &&
      effectiveRoles(sticky).includes(step.role) &&
      memberOnlineForAssign(sticky, !!policy.allowDegradedAssignees)
    ) {
      return sticky.id;
    }
  }
  const candidates = team.members.filter(
    (m) =>
      !excludeMemberIds.has(m.id) &&
      effectiveRoles(m).includes(step.role) &&
      memberOnlineForAssign(m, !!policy.allowDegradedAssignees),
  );
  return candidates[0]?.id;
}

export async function startJob(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
  jobId: string,
): Promise<Job> {
  let job = await getJob(jobsPath, jobId);
  if (job.status !== "drafting") {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "Only a drafting job can be started.",
      ref("error.job.notDrafting"),
    );
  }
  if (job.steps.length === 0) {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "Add at least one step before starting.", ref("error.job.noSteps"));
  }
  const team = await requireTeam(teamsPath, job.teamId);
  const catalog = normalizeTeamRecord(team).roleCatalog;
  assertStepsInCatalog(job.steps, catalog);
  assertWriterLocks(job.steps, catalog);
  // Preflight: every currently schedulable step needs an online assignee (UI crew gate can race).
  const roots = job.steps.filter(
    (s) => s.status === "pending" && dependenciesSatisfied(s, job.steps),
  );
  for (const step of roots) {
    if (!pickAssignee(team, step, job.policy)) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        `No online machine offers role “${step.role}”. Fix the team, then try Start again.`,
        ref("error.job.noCandidate", { role: step.role }),
      );
    }
  }
  // Origin machine must be Git-ready for every distinct cwd used by this job (content bus).
  const cwdHints = [...new Set(job.steps.map((s) => s.cwdHint).filter((c) => c.trim() !== ""))];
  for (const cwd of cwdHints) {
    const git = await assessGitContentBus(cwd);
    if (!git.ok) throwGitContentBus(git.policy);
  }
  job = await saveJob(jobsPath, {
    ...job,
    status: "running",
    ledger: [...job.ledger, note("info", "Job started")],
  });
  // Offer schedulable pending steps
  for (const step of job.steps) {
    if (step.status !== "pending") continue;
    if (!dependenciesSatisfied(step, job.steps)) continue;
    const offered = await offerJobStep(jobsPath, offersPath, teamsPath, {
      jobId: job.id,
      stepId: step.id,
    });
    if (offered.status === "refused" && offered.policy === "no-candidate") {
      const current = await getJob(jobsPath, jobId);
      await saveJob(jobsPath, {
        ...current,
        ledger: [
          ...current.ledger,
          note("info", `No candidate for step role “${step.role}”`, { stepId: step.id }),
        ],
      });
    }
  }
  return getJob(jobsPath, jobId);
}

export async function pauseJob(jobsPath: string, jobId: string): Promise<Job> {
  const job = await getJob(jobsPath, jobId);
  if (job.status !== "running") {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "Only a running job can be paused.", ref("error.job.notRunning"));
  }
  return saveJob(jobsPath, {
    ...job,
    status: "drafting",
    ledger: [...job.ledger, note("info", "Job paused — no new offers")],
  });
}

export async function stopJob(jobsPath: string, offersPath: string, jobId: string): Promise<Job> {
  const job = await getJob(jobsPath, jobId);
  const offers = await readOffers(offersPath);
  for (const offer of Object.values(offers.offers)) {
    if (offer.jobId === jobId && offer.status === "pending") {
      offers.offers[offer.offerId] = { ...offer, status: "cancelled" };
    }
  }
  await writeJsonFile(offersPath, offers);
  const steps = job.steps.map((s) =>
    s.status === "succeeded" || s.status === "failed" || s.status === "cancelled"
      ? s
      : { ...s, status: "cancelled" as const },
  );
  const at = new Date().toISOString();
  return saveJob(jobsPath, {
    ...job,
    status: "cancelled",
    steps,
    endedAt: at,
    ledger: [...job.ledger, note("stop", "Job stopped")],
    finalReport: buildReport({ ...job, steps }, "Job cancelled"),
  });
}

export async function stopJobStep(
  jobsPath: string,
  offersPath: string,
  input: { jobId: string; stepId: string; reason?: string },
): Promise<Job> {
  const job = await getJob(jobsPath, input.jobId);
  const step = job.steps.find((s) => s.id === input.stepId);
  if (!step) {
    throw coderError(ENVOYDEV_ERRORS.stepMissing, "No step with that id.", ref("error.job.stepMissing"));
  }
  const offers = await readOffers(offersPath);
  for (const offer of Object.values(offers.offers)) {
    if (offer.stepId === input.stepId && (offer.status === "pending" || offer.status === "accepted")) {
      offers.offers[offer.offerId] = { ...offer, status: "cancelled" };
    }
  }
  await writeJsonFile(offersPath, offers);
  const reason = input.reason ?? "orchestrator-stop";
  const outcome = reason === "stall" ? ("abandoned" as const) : ("cancelled" as const);
  const steps = job.steps.map((s) => {
    if (s.id !== input.stepId) return s;
    const attempts = s.attempts.map((a, i) =>
      i === s.attempts.length - 1
        ? { ...a, endedAt: new Date().toISOString(), outcome, error: reason, ...(reason === "stall" ? { policy: "stall" } : {}) }
        : a,
    );
    return {
      ...s,
      status: "cancelled" as const,
      attempts,
      blocked: reason === "stall" ? ("cancel-pending" as const) : undefined,
      runPhase: undefined,
    };
  });
  return saveJob(jobsPath, {
    ...job,
    steps,
    ledger: [
      ...job.ledger,
      note("stop", `Stopped step (${reason})`, { stepId: input.stepId, memberId: step.assigneeMemberId }),
    ],
  });
}

/** Snapshot used by the service layer to dial a member and cancel their run. */
export function remoteCancelTargets(
  job: Job,
  offersPath: string,
  stepId?: string,
): Promise<readonly { memberId: string; offerId?: string; runId?: string; cancelNonce?: string }[]> {
  return readOffers(offersPath).then((offers) => {
    const targets: { memberId: string; offerId?: string; runId?: string; cancelNonce?: string }[] = [];
    for (const step of job.steps) {
      if (stepId && step.id !== stepId) continue;
      if (step.assigneeMemberId === "local" || !step.assigneeMemberId) continue;
      if (step.status !== "running" && step.status !== "offered") continue;
      const last = step.attempts[step.attempts.length - 1];
      const offer = last?.offerId ? offers.offers[last.offerId] : undefined;
      targets.push({
        memberId: step.assigneeMemberId,
        ...(last?.offerId ? { offerId: last.offerId } : {}),
        ...(step.resultRef ?? last?.runId ? { runId: step.resultRef ?? last?.runId } : {}),
        ...(offer?.cancelNonce ? { cancelNonce: offer.cancelNonce } : {}),
      });
    }
    // Also pending offers for this job/step.
    for (const offer of Object.values(offers.offers)) {
      if (offer.jobId !== job.id) continue;
      if (stepId && offer.stepId !== stepId) continue;
      if (offer.assigneeMemberId === "local") continue;
      if (offer.status !== "pending" && offer.status !== "accepted") continue;
      if (targets.some((t) => t.offerId === offer.offerId)) continue;
      targets.push({
        memberId: offer.assigneeMemberId,
        offerId: offer.offerId,
        ...(offer.runId ? { runId: offer.runId } : {}),
        ...(offer.cancelNonce ? { cancelNonce: offer.cancelNonce } : {}),
      });
    }
    return targets;
  });
}

export async function reassignJobStep(
  jobsPath: string,
  offersPath: string,
  teamsPath: string,
  input: { jobId: string; stepId: string; memberId?: string; excludeMemberIds?: ReadonlySet<string> },
): Promise<{ job: Job; offer?: StepOffer }> {
  let job = await getJob(jobsPath, input.jobId);
  const step = job.steps.find((s) => s.id === input.stepId);
  if (!step) {
    throw coderError(ENVOYDEV_ERRORS.stepMissing, "No step with that id.", ref("error.job.stepMissing"));
  }
  const reassignCount = (step.reassignCount ?? 0) + 1;
  const catalog = normalizeTeamRecord(await requireTeam(teamsPath, job.teamId)).roleCatalog;
  if (reassignCount > job.policy.maxReassigns) {
    job = await failStep(jobsPath, job, input.stepId, "reassign-exhausted", catalog);
    throw coderError(ENVOYDEV_ERRORS.stepExhausted, "Step exhausted retries and reassigns.", ref("error.job.exhausted"));
  }
  const exclude = new Set(input.excludeMemberIds ?? []);
  if (step.assigneeMemberId) exclude.add(step.assigneeMemberId);

  // Supersede prior pending/accepted offers so a stale accept cannot race the new assignee.
  const offers = await readOffers(offersPath);
  let offersTouched = false;
  for (const offer of Object.values(offers.offers)) {
    if (
      offer.jobId === job.id &&
      offer.stepId === input.stepId &&
      (offer.status === "pending" || offer.status === "accepted")
    ) {
      offers.offers[offer.offerId] = { ...offer, status: "cancelled", policy: "reassign" };
      offersTouched = true;
    }
  }
  if (offersTouched) await writeJsonFile(offersPath, offers);

  const steps = job.steps.map((s) =>
    s.id === input.stepId
      ? {
          ...s,
          status: "pending" as const,
          reassignCount,
          assigneeMemberId: input.memberId,
          resultRef: undefined,
          runPhase: undefined,
          blocked: undefined,
        }
      : s,
  );
  job = await saveJob(jobsPath, {
    ...job,
    steps,
    ledger: [
      ...job.ledger,
      note("reassign", `Reassigning step (attempt ${reassignCount})`, {
        stepId: input.stepId,
        memberId: step.assigneeMemberId,
      }),
    ],
  });

  const result = await offerJobStep(jobsPath, offersPath, teamsPath, {
    jobId: job.id,
    stepId: input.stepId,
    ...(input.memberId ? { memberId: input.memberId } : {}),
    excludeMemberIds: exclude,
  });
  if (result.status === "refused" && result.policy === "no-candidate") {
    job = await failStep(jobsPath, await getJob(jobsPath, job.id), input.stepId, "no-candidate", catalog);
    return { job };
  }
  return { job: await getJob(jobsPath, job.id), offer: result.offer };
}

/**
 * Force-fail a step (§4.6) — skip remaining retries on this assignee; fail-step / fail-job per policy.
 */
export async function failJobStep(
  jobsPath: string,
  jobId: string,
  stepId: string,
  reason = "force-fail",
  teamsPath?: string,
): Promise<Job> {
  const job = await getJob(jobsPath, jobId);
  const step = job.steps.find((s) => s.id === stepId);
  if (!step) {
    throw coderError(ENVOYDEV_ERRORS.stepMissing, "No step with that id.", ref("error.job.stepMissing"));
  }
  if (step.status === "succeeded" || step.status === "failed" || step.status === "cancelled") {
    return job;
  }
  const catalog = teamsPath
    ? normalizeTeamRecord(await requireTeam(teamsPath, job.teamId)).roleCatalog
    : [];
  return failStep(jobsPath, job, stepId, reason, catalog);
}

export function buildReport(job: Job, summary: string): JobFinalReport {
  const failures = job.steps
    .filter((s) => s.status === "failed" || s.status === "cancelled")
    .map((s) => ({
      stepId: s.id,
      attempts: s.attempts.length,
      lastError: s.attempts[s.attempts.length - 1]?.error,
    }));
  return {
    summary,
    artifacts: job.steps.filter((s) => s.resultRef).map((s) => s.resultRef!),
    failures,
  };
}

export function maybeCompleteJob(job: Job, catalog: readonly RoleDef[] = []): Job {
  const terminal = job.steps.every(
    (s) => s.status === "succeeded" || s.status === "failed" || s.status === "cancelled",
  );
  if (!terminal) return job;
  const writerFailed = job.steps.some((s) => isWriterRole(s.role, catalog) && s.status === "failed");
  const anyFailed = job.steps.some((s) => s.status === "failed");
  const continuePartial = job.policy.onStepExhausted === "continue-partial" && !writerFailed;
  const failed = anyFailed && !continuePartial;
  const summary = failed
    ? "Finished with failures"
    : anyFailed
      ? "Finished with gaps"
      : "All steps succeeded";
  // Brief merging phase then terminal (§5.1 / §7.4).
  return {
    ...job,
    status: failed ? "failed" : "done",
    endedAt: new Date().toISOString(),
    finalReport: buildReport(job, summary),
    ledger: [...job.ledger, note("report", summary)],
  };
}

export async function failStep(
  jobsPath: string,
  job: Job,
  stepId: string,
  error: string,
  catalog: readonly RoleDef[] = [],
): Promise<Job> {
  const steps = job.steps.map((s) =>
    s.id === stepId
      ? {
          ...s,
          status: "failed" as const,
          attempts: s.attempts.map((a, i) =>
            i === s.attempts.length - 1
              ? { ...a, endedAt: new Date().toISOString(), outcome: "failed" as const, error }
              : a,
          ),
        }
      : s,
  );
  let next: Job = {
    ...job,
    steps,
    ledger: [...job.ledger, note("info", `Step failed (${error})`, { stepId })],
  };
  const step = steps.find((s) => s.id === stepId)!;
  if (isWriterRole(step.role, catalog) || job.policy.onStepExhausted === "fail-job") {
    next = {
      ...next,
      status: "failed",
      endedAt: new Date().toISOString(),
      finalReport: buildReport(next, `Job failed: step ${stepId} exhausted`),
      ledger: [...next.ledger, note("report", `Job failed (${error})`, { stepId })],
    };
  } else {
    next = maybeCompleteJob(next, catalog);
  }
  return saveJob(jobsPath, next);
}

/** Throw when a job has failed so RPC clients see `envoydev.job-failed`. */
export function assertJobNotFailed(job: Job): void {
  if (job.status === "failed") {
    throw coderError(
      ENVOYDEV_ERRORS.jobFailed,
      job.finalReport?.summary ?? "This job has failed.",
      ref("error.job.failed"),
    );
  }
}

/** Attempts by the current assignee that count toward maxRetriesPerAssignee. */
export function retriesForAssignee(step: JobStep, memberId: string): number {
  return step.attempts.filter(
    (a) =>
      a.memberId === memberId &&
      (a.outcome === "failed" || a.outcome === "abandoned" || a.outcome === "cancelled"),
  ).length;
}

/**
 * Propose a step graph from a named template (or hint keywords). Proposal only —
 * caller must `updateJobSteps` to commit; daemon never auto-starts.
 */
export function suggestJobSteps(
  job: Job,
  options?: SuggestJobStepsOptions | string,
): { templateId: JobStepTemplateId; steps: JobStepDraft[]; note: string } {
  const opts: SuggestJobStepsOptions =
    typeof options === "string" ? { hint: options } : (options ?? {});
  // Prefer explicit cwd, else keep the path already on this job (project create sets it).
  const inheritedCwd = job.steps.map((s) => s.cwdHint?.trim()).find((c) => c && c !== ".");
  const built = buildJobStepTemplate(job, {
    ...opts,
    cwdHint: opts.cwdHint?.trim() || inheritedCwd || opts.cwdHint || ".",
  });
  return {
    templateId: built.templateId,
    steps: built.steps,
    note: built.note,
  };
}

/** Dial order — see `member-dial.ts` (LAN → mesh → SSH). */
export { preferMemberTransport, type MemberDialTransport } from "./member-dial.js";

export async function cancelJobsForTeam(jobsPath: string, offersPath: string, teamId: string): Promise<void> {
  const file = await readJobs(jobsPath);
  for (const job of Object.values(file.jobs)) {
    if (job.teamId !== teamId) continue;
    if (job.status === "done" || job.status === "failed" || job.status === "cancelled") continue;
    await stopJob(jobsPath, offersPath, job.id);
  }
}

export function enableStallAutomation(policy: StallPolicy): StallPolicy {
  return { ...policy, automationEnabled: true };
}

export async function setJobStallAutomation(
  jobsPath: string,
  jobId: string,
  enabled: boolean,
): Promise<Job> {
  const job = await getJob(jobsPath, jobId);
  return saveJob(jobsPath, {
    ...job,
    stallPolicy: { ...job.stallPolicy, automationEnabled: enabled },
    ledger: [
      ...job.ledger,
      note("info", enabled ? "Stall automation enabled" : "Stall automation disabled"),
    ],
  });
}

export {
  handleStepRunFailure,
  reportJobStepProgress,
  completeJobStep,
  evaluateDeadlines,
  evaluateStalls,
  cancelWorkForMember,
} from "./job-progress.js";

export { offerJobStep, acceptJobStepOffer, refuseJobStepOffer };
