/**
 * Work Engine — tickets, triage, and the effect outbox (Phase 1–4 host).
 */

import type { RunEvent, Task } from "@envoydev/protocol";
import { ENVOYDEV_ERRORS, coderError } from "@envoydev/protocol";
import {
  assignmentIdFor,
  candidateIdFor,
  canTakeWorkerSlot,
  coalescePending,
  disposeCandidate,
  effectIdFor,
  effectReceiptKey,
  inferReportFromHint,
  needsAttention,
  shortNameFor,
  sortEffectsForDispatch,
  ticketIdFor,
  ticketStage,
  type AcceptMode,
  type WorkCandidate,
  type WorkEffect,
  type WorkPolicy,
  type WorkReportKind,
  type WorkStage,
  type WorkTicket,
} from "@envoydev/work-model";

import { ref } from "./messages.js";
import {
  attentionMetaForEvent,
  attentionQuestionForHint,
  hintFromRunEvent,
  withAssignmentEnded,
  withAssignmentRunning,
} from "./work-run-bridge.js";
import { WorkStore } from "./work-store.js";
import { defaultRunGh, pollGithubTriggers, replyOnGithubThread, type RunGh } from "./work-github.js";

export interface WorkEngineDeps {
  workDir: string;
  store: {
    findTask(id: string): Task | undefined;
    /** Used when auto-triage accepts a candidate with no linked transcript task. */
    createTask?(input: {
      projectId: string;
      title: string;
    }): Promise<Task | undefined>;
    defaultProjectId?(): string | undefined;
  };
  runs?: {
    start(input: { taskId: string; prompt: string }): Promise<{ run: { id: string } }>;
    send?(runId: string, text: string, mode?: "queue" | "steer"): Promise<void>;
    cancel?(runId: string): Promise<void>;
    isLive?(runId: string): boolean;
    pendingApproval?(runId: string): { requestId: string; allowOptionIds: readonly string[] } | undefined;
    answerApproval?(
      runId: string,
      requestId: string,
      optionId: string | undefined,
      extra?: { text?: string },
    ): Promise<boolean>;
  };
  /** When policy requires approvals for unattended work, refuse launch unless this returns true. */
  workerAllowsUnattended?: (taskId: string) => boolean;
  onChanged?: (ticketIds: string[]) => void;
  now?: () => Date;
  runGh?: RunGh;
  workerLimit?: number;
}

export type StagedWorkTicket = WorkTicket & { stage: WorkStage };

function channelReplyBody(kind: "ready" | "blocked" | "failed", note?: string): string {
  const headline =
    kind === "ready"
      ? "EnvoyDev: this work item is ready for review."
      : kind === "blocked"
        ? "EnvoyDev: this work item is blocked and needs a person."
        : "EnvoyDev: this work item failed.";
  const trimmed = note?.trim();
  if (!trimmed) return headline;
  const clipped = trimmed.length > 280 ? `${trimmed.slice(0, 279)}…` : trimmed;
  return `${headline}\n\n${clipped}`;
}

export class WorkEngine {
  private readonly store: WorkStore;
  private readonly workerLimit: number;
  private readonly runGh: RunGh;
  private draining = false;
  private drainAgain = false;
  private githubPollTimer: ReturnType<typeof setInterval> | undefined;
  private githubPollInFlight = false;

  private constructor(private readonly deps: WorkEngineDeps) {
    this.store = new WorkStore(deps.workDir);
    this.workerLimit = deps.workerLimit ?? 2;
    this.runGh = deps.runGh ?? defaultRunGh;
  }

  static async open(deps: WorkEngineDeps): Promise<WorkEngine> {
    const engine = new WorkEngine(deps);
    await engine.load();
    await engine.drainEffects();
    engine.syncGithubPollTimer();
    return engine;
  }

  async load(): Promise<void> {
    await this.store.load();
  }

  /** Stop the background GitHub poll timer (daemon shutdown / tests). */
  dispose(): void {
    if (this.githubPollTimer !== undefined) {
      clearInterval(this.githubPollTimer);
      this.githubPollTimer = undefined;
    }
  }

  private nowIso(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  private withStage(ticket: WorkTicket): StagedWorkTicket {
    return { ...ticket, stage: ticketStage(ticket) };
  }

  private notify(ids: string[]): void {
    if (ids.length > 0) this.deps.onChanged?.(ids);
  }

  private missingTicket(id: string): never {
    throw coderError(
      ENVOYDEV_ERRORS.ticketMissing,
      `There is no work item called "${id}" on this machine.`,
      ref("error.ticketNotFound", { id }),
    );
  }

  private requireEnabled(): void {
    if (this.store.getPolicy().enabled) return;
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "Work items are turned off in Settings.",
      ref("error.work.disabled"),
    );
  }

  listTickets(input: { projectId?: string; includeEnded?: boolean } = {}): StagedWorkTicket[] {
    let rows = this.store.listTickets();
    if (input.projectId) rows = rows.filter((t) => t.projectId === input.projectId);
    if (!input.includeEnded) rows = rows.filter((t) => t.status === "open");
    return rows.map((t) => this.withStage(t));
  }

  getTicket(id: string): StagedWorkTicket {
    const ticket = this.store.getTicket(id);
    if (!ticket) this.missingTicket(id);
    return this.withStage(ticket);
  }

  getPolicy(): WorkPolicy {
    return this.store.getPolicy();
  }

  async setPolicy(patch: {
    acceptMode?: AcceptMode;
    allowList?: string[];
    requireApprovalsForUnattended?: boolean;
    enabled?: boolean;
    githubPollIntervalMs?: number;
    githubPollRepo?: string;
  }): Promise<WorkPolicy> {
    const current = this.store.getPolicy();
    let next: WorkPolicy = {
      ...current,
      ...(patch.acceptMode !== undefined ? { acceptMode: patch.acceptMode } : {}),
      ...(patch.allowList !== undefined ? { allowList: [...patch.allowList] } : {}),
      ...(patch.requireApprovalsForUnattended !== undefined
        ? { requireApprovalsForUnattended: patch.requireApprovalsForUnattended }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.githubPollIntervalMs !== undefined
        ? { githubPollIntervalMs: Math.max(0, Math.floor(patch.githubPollIntervalMs)) }
        : {}),
      updatedAt: this.nowIso(),
    };
    if (patch.githubPollRepo !== undefined) {
      const trimmed = patch.githubPollRepo.trim();
      if (trimmed === "") {
        const { githubPollRepo: _removed, ...rest } = next;
        next = rest;
      } else {
        next = { ...next, githubPollRepo: trimmed };
      }
    }
    await this.store.setPolicy(next);
    this.syncGithubPollTimer();
    return next;
  }

  async createTicket(input: {
    title: string;
    projectId?: string;
    taskId?: string;
    scope?: string;
    externalRef?: string;
  }): Promise<StagedWorkTicket> {
    this.requireEnabled();
    const now = this.nowIso();
    const policy = this.store.getPolicy();
    const id = ticketIdFor(new Date(now));
    const ticket: WorkTicket = {
      id,
      shortName: shortNameFor(input.title),
      title: input.title.trim(),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.externalRef !== undefined && input.externalRef.trim() !== ""
        ? { externalRef: input.externalRef.trim() }
        : {}),
      status: "open",
      mandate: {
        id: `${id}-mandate`,
        policyVersion: policy.version,
        strength: "explicit",
        scope: (input.scope ?? input.title).trim(),
        createdAt: now,
      },
      assignments: input.taskId
        ? [{ id: assignmentIdFor(id, new Date(now)), status: "pending" }]
        : [],
      createdAt: now,
      updatedAt: now,
    };
    await this.store.upsertTicket(ticket);
    this.notify([id]);
    if (input.taskId) {
      await this.enqueueEffect({
        kind: "launch",
        ticketId: id,
        payload: { prompt: ticket.title },
        receiptKey: effectReceiptKey("launch", id, "initial"),
      });
    }
    return this.getTicket(id);
  }

  async promoteTask(input: { taskId: string; title?: string }): Promise<StagedWorkTicket> {
    const existing = this.store.findOpenTicketByTaskId(input.taskId);
    if (existing) return this.withStage(existing);
    this.requireEnabled();
    const task = this.deps.store.findTask(input.taskId);
    if (!task) {
      throw coderError(
        ENVOYDEV_ERRORS.taskMissing,
        `There is no task called "${input.taskId}" on this machine.`,
        ref("error.taskNotFound", { id: input.taskId }),
      );
    }
    return this.createTicket({
      title: input.title ?? task.title,
      projectId: task.projectId,
      taskId: task.id,
    });
  }

  async stopTicket(input: { id: string; reason?: string }): Promise<StagedWorkTicket> {
    const ticket = this.store.getTicket(input.id);
    if (!ticket) this.missingTicket(input.id);
    const now = this.nowIso();
    const latest = ticket.assignments[ticket.assignments.length - 1];
    if (latest?.runId && this.deps.runs?.cancel) {
      await this.deps.runs.cancel(latest.runId).catch(() => undefined);
    }
    const next: WorkTicket = {
      ...ticket,
      status: "ended",
      endedAt: now,
      ...(input.reason ? { endReason: input.reason } : { endReason: "Stopped" }),
      updatedAt: now,
    };
    await this.store.upsertTicket(next);
    // Drop queued launches so Stop cannot race a late runs.start.
    await this.cancelPendingLaunches(input.id, "Stopped");
    this.notify([input.id]);
    return this.withStage(next);
  }

  async retryTicket(input: { id: string }): Promise<StagedWorkTicket> {
    const ticket = this.store.getTicket(input.id);
    if (!ticket) this.missingTicket(input.id);
    const now = this.nowIso();
    const cleared: WorkTicket = {
      ...ticket,
      status: "open",
      endedAt: undefined,
      endReason: undefined,
      attention: undefined,
      deliveryFailed: undefined,
      latestReport:
        ticket.latestReport?.kind === "failed" || ticket.latestReport?.kind === "blocked"
          ? undefined
          : ticket.latestReport,
      updatedAt: now,
    };
    await this.store.upsertTicket(cleared);
    if (cleared.taskId) {
      await this.enqueueEffect({
        kind: "launch",
        ticketId: cleared.id,
        payload: { prompt: cleared.title },
        receiptKey: effectReceiptKey("launch", cleared.id, "retry"),
      });
    } else {
      const waiting = inferReportFromHint({ kind: "run-ended", status: "done" }, now);
      await this.applyReport(cleared.id, waiting.report);
    }
    this.notify([input.id]);
    return this.getTicket(input.id);
  }

  async answerAttention(input: { id: string; text: string }): Promise<StagedWorkTicket> {
    const ticket = this.store.getTicket(input.id);
    if (!ticket) this.missingTicket(input.id);
    const text = input.text.trim();
    if (text.length === 0) {
      throw coderError(ENVOYDEV_ERRORS.badRequest, "Answer text is empty.", ref("error.work.emptyAnswer"));
    }

    const runId = ticket.attention?.runId ?? ticket.assignments[ticket.assignments.length - 1]?.runId;
    const requestId = ticket.attention?.requestId;
    const live = runId !== undefined && this.deps.runs?.isLive?.(runId) === true;
    let delivered = false;

    if (runId && requestId && this.deps.runs?.answerApproval && live) {
      const pending = this.deps.runs.pendingApproval?.(runId);
      const allowId = pending?.allowOptionIds[0];
      delivered = await this.deps.runs
        .answerApproval(runId, requestId, allowId, { text })
        .catch(() => false);
    } else if (runId && this.deps.runs?.send && live) {
      // Queue survives an open approval; steer does not.
      await this.deps.runs
        .send(runId, text, "queue")
        .then(() => {
          delivered = true;
        })
        .catch(() => {
          delivered = false;
        });
    }

    const now = this.nowIso();
    if (!delivered) {
      await this.store.upsertTicket({
        ...ticket,
        deliveryFailed: true,
        updatedAt: now,
      });
      this.notify([input.id]);
      throw coderError(
        ENVOYDEV_ERRORS.harnessFailed,
        live
          ? "Could not deliver that answer to the live run. Try again, or open the task and answer there."
          : "There is no live run to answer. Open the task or Retry the work item.",
        ref(live ? "error.work.deliveryFailed" : "error.work.noLiveRun"),
      );
    }

    await this.store.upsertTicket({
      ...ticket,
      attention: undefined,
      deliveryFailed: undefined,
      updatedAt: now,
    });
    await this.enqueueEffect({
      kind: "deliver",
      ticketId: ticket.id,
      payload: { text },
      receiptKey: effectReceiptKey("deliver", ticket.id, text.slice(0, 120) || "answer"),
    });
    this.notify([input.id]);
    return this.getTicket(input.id);
  }

  listAttention(input: { projectId?: string } = {}): StagedWorkTicket[] {
    return this.listTickets({ ...input, includeEnded: false }).filter((t) => needsAttention(t));
  }

  async enqueueCandidate(input: {
    text: string;
    strength?: WorkCandidate["strength"];
    sourceKind?: WorkCandidate["sourceKind"];
    externalRef?: string;
  }): Promise<WorkCandidate> {
    this.requireEnabled();
    const now = this.nowIso();
    const candidate: WorkCandidate = {
      id: candidateIdFor(new Date(now)),
      text: input.text,
      strength: input.strength ?? "explicit",
      sourceKind: input.sourceKind ?? "manual",
      ...(input.externalRef !== undefined ? { externalRef: input.externalRef } : {}),
      createdAt: now,
    };
    await this.store.appendCandidate(candidate);
    return candidate;
  }

  listCandidates(): WorkCandidate[] {
    return this.store.listCandidates();
  }

  async triageCandidate(input: {
    id: string;
    assessmentAccepts?: boolean;
  }): Promise<{ candidate: WorkCandidate; ticket?: StagedWorkTicket }> {
    const candidate = this.store.getCandidate(input.id);
    if (!candidate) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        "No candidate with that id.",
        ref("error.work.candidateMissing"),
      );
    }

    // Watch → Take: upgrade a recorded would-accept into a real Work item.
    if (candidate.disposition === "would-accept" && input.assessmentAccepts === true) {
      this.requireEnabled();
      if (candidate.ticketId) {
        const existing = this.store.getTicket(candidate.ticketId);
        if (existing) {
          return { candidate, ticket: this.withStage(existing) };
        }
      }
      const title = candidate.text.trim().slice(0, 120) || "Work item";
      let taskId: string | undefined;
      let projectId = this.deps.store.defaultProjectId?.();
      if (projectId && this.deps.store.createTask) {
        const task = await this.deps.store.createTask({ projectId, title });
        if (task) {
          taskId = task.id;
          projectId = task.projectId;
        }
      }
      const ticket = await this.createTicket({
        title,
        ...(projectId ? { projectId } : {}),
        ...(taskId ? { taskId } : {}),
        ...(candidate.externalRef ? { externalRef: candidate.externalRef } : {}),
      });
      const updated = await this.store.updateCandidate(input.id, {
        disposition: "accept",
        dispositionNote: "Taken from Watch.",
        ticketId: ticket.id,
      });
      if (
        candidate.sourceKind === "github" &&
        typeof candidate.externalRef === "string" &&
        candidate.externalRef.length > 0
      ) {
        await this.enqueueEffect({
          kind: "reply",
          ticketId: ticket.id,
          payload: {
            threadKey: candidate.externalRef,
            body: "EnvoyDev accepted this as a work item.",
          },
          receiptKey: effectReceiptKey("reply", ticket.id, "ack"),
        });
      }
      return { candidate: updated ?? candidate, ticket };
    }

    if (candidate.disposition !== undefined) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        "That candidate was already decided.",
        ref("error.work.candidateDecided"),
      );
    }

    const policy = this.store.getPolicy();
    const result = disposeCandidate({
      candidate,
      policy,
      ...(input.assessmentAccepts !== undefined ? { assessmentAccepts: input.assessmentAccepts } : {}),
    });
    let ticket: StagedWorkTicket | undefined;
    if (result.createTicket) {
      const title = candidate.text.trim().slice(0, 120) || "Work item";
      let taskId: string | undefined;
      let projectId = this.deps.store.defaultProjectId?.();
      if (projectId && this.deps.store.createTask) {
        const task = await this.deps.store.createTask({ projectId, title });
        if (task) {
          taskId = task.id;
          projectId = task.projectId;
        }
      }
      ticket = await this.createTicket({
        title,
        ...(projectId ? { projectId } : {}),
        ...(taskId ? { taskId } : {}),
        ...(candidate.externalRef ? { externalRef: candidate.externalRef } : {}),
      });
    }
    const updated = await this.store.updateCandidate(input.id, {
      disposition: result.outcome,
      dispositionNote: result.note,
      ...(ticket ? { ticketId: ticket.id } : {}),
    });
    // Channel ack only when auto-accept created a Ticket from a GitHub thread.
    if (
      ticket &&
      candidate.sourceKind === "github" &&
      typeof candidate.externalRef === "string" &&
      candidate.externalRef.length > 0
    ) {
      await this.enqueueEffect({
        kind: "reply",
        ticketId: ticket.id,
        payload: {
          threadKey: candidate.externalRef,
          body: "EnvoyDev accepted this as a work item.",
        },
        receiptKey: effectReceiptKey("reply", ticket.id, "ack"),
      });
    }
    return { candidate: updated ?? candidate, ...(ticket ? { ticket } : {}) };
  }

  listEffects(input: { pendingOnly?: boolean } = {}): WorkEffect[] {
    const all = this.store.listEffects();
    return input.pendingOnly ? all.filter((e) => e.status === "pending") : all;
  }

  async enqueueEffect(input: {
    kind: WorkEffect["kind"];
    ticketId?: string;
    payload?: Record<string, unknown>;
    receiptKey?: string;
  }): Promise<WorkEffect> {
    if (input.receiptKey) {
      const existing = this.store
        .listEffects()
        .find(
          (e) =>
            e.receiptKey === input.receiptKey &&
            (e.status === "done" || e.status === "pending"),
        );
      if (existing) return existing;
    }
    const now = this.nowIso();
    const effect: WorkEffect = {
      id: effectIdFor(new Date(now)),
      kind: input.kind,
      ...(input.ticketId ? { ticketId: input.ticketId } : {}),
      payload: input.payload ?? {},
      status: "pending",
      ...(input.receiptKey ? { receiptKey: input.receiptKey } : {}),
      createdAt: now,
    };
    await this.store.appendEffect(effect);
    await this.drainEffects();
    return effect;
  }

  async report(input: { ticketId: string; kind: WorkReportKind; note?: string }): Promise<StagedWorkTicket> {
    await this.applyReport(input.ticketId, {
      kind: input.kind,
      ...(input.note !== undefined ? { note: input.note } : {}),
      at: this.nowIso(),
    });
    return this.getTicket(input.ticketId);
  }

  async applyRunEvent(event: RunEvent): Promise<void> {
    const ticket = this.store.findOpenTicketByTaskId(event.taskId);
    if (!ticket) return;

    if (event.kind === "run.started") {
      await this.markAssignmentRunning(ticket.id, event.runId);
    } else if (event.kind === "run.ended") {
      await this.markAssignmentEnded(ticket.id, event.runId);
    }

    const hint = hintFromRunEvent(event);
    if (!hint) return;
    const inferred = inferReportFromHint(hint, event.at);
    const attentionQuestion = attentionQuestionForHint(hint, inferred);
    const meta = attentionQuestion ? attentionMetaForEvent(event) : undefined;
    await this.applyReport(ticket.id, inferred.report, attentionQuestion, meta);
    this.notify([ticket.id]);
  }

  async githubPoll(
    input: { repo?: string } = {},
  ): Promise<{
    ok: boolean;
    triggers: number;
    candidates: number;
    wouldAccept?: number;
    accepted?: number;
    error?: string;
  }> {
    let wouldAccept = 0;
    let accepted = 0;
    const acceptedTicketIds: string[] = [];
    try {
      const poll = await pollGithubTriggers(this.runGh, {
        ...(input.repo ? { repo: input.repo } : {}),
        storeTrigger: (trigger) => this.store.storeTrigger(trigger),
        isKnownTrigger: (id) => this.store.listTriggers().some((t) => t.id === id),
        onMention: async (trigger) => {
          const policy = this.store.getPolicy();
          // Defer (do not consume the trigger) until Work can triage candidates.
          if (!policy.enabled || policy.acceptMode === "off") return false;
          const text =
            trigger.actor !== undefined && trigger.actor.trim() !== ""
              ? `@${trigger.actor}: ${trigger.text}`
              : trigger.text;
          const candidate = await this.enqueueCandidate({
            text,
            strength: "inferred",
            sourceKind: "github",
            externalRef: trigger.threadKey,
          });
          try {
            const triaged = await this.triageCandidate({
              id: candidate.id,
              assessmentAccepts: true,
            });
            if (triaged.candidate.disposition === "would-accept") wouldAccept += 1;
            if (triaged.candidate.disposition === "accept") {
              accepted += 1;
              if (triaged.ticket) acceptedTicketIds.push(triaged.ticket.id);
            }
          } catch (err) {
            // Keep the candidate for the inbox; mark it ignored so poll can dedupe the trigger.
            const note =
              err instanceof Error && err.message.trim() !== ""
                ? err.message.trim().slice(0, 200)
                : "Triage failed.";
            await this.store.updateCandidate(candidate.id, {
              disposition: "ignore",
              dispositionNote: note,
            });
          }
          return true;
        },
      });
      const ackFailed = acceptedTicketIds.reduce((n, ticketId) => {
        const key = effectReceiptKey("reply", ticketId, "ack");
        const effect = this.store.listEffects().find((e) => e.receiptKey === key);
        return effect?.status === "failed" ? n + 1 : n;
      }, 0);
      if (!poll.ok) {
        return {
          ok: false,
          triggers: poll.triggers,
          candidates: poll.candidates,
          wouldAccept,
          accepted,
          ...(ackFailed > 0 ? { ackFailed } : {}),
          error: poll.error ?? "GitHub poll failed.",
        };
      }
      return {
        ok: true,
        triggers: poll.triggers,
        candidates: poll.candidates,
        wouldAccept,
        accepted,
        ...(ackFailed > 0 ? { ackFailed } : {}),
      };
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim() !== ""
          ? err.message.trim().slice(0, 240)
          : "GitHub poll failed.";
      // Preserve any dispositions already recorded this poll.
      return {
        ok: false,
        triggers: 0,
        candidates: 0,
        wouldAccept,
        accepted,
        error: message,
      };
    }
  }

  async githubReply(input: { threadKey: string; body: string }): Promise<{ ok: true }> {
    const result = await replyOnGithubThread(this.runGh, input.threadKey, input.body);
    if (!result.ok) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        result.stderr || "GitHub reply failed.",
        ref("error.work.githubReplyFailed"),
      );
    }
    return { ok: true };
  }

  async drainEffects(): Promise<void> {
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.drainAgain = false;
        const effects = coalescePending(this.store.listEffects());
        const order = sortEffectsForDispatch(effects);
        for (const effect of order) {
          if (effect.status !== "pending") continue;
          // Channel replies are not coding workers — never stall acks behind launch slots.
          if (effect.kind !== "reply") {
            const isHumanWake = effect.kind === "deliver" || effect.kind === "notify";
            if (
              !canTakeWorkerSlot({
                runningCount: this.runningAssignmentCount(),
                limit: this.workerLimit,
                isHumanWake,
              })
            ) {
              continue;
            }
          }
          if (effect.receiptKey && this.receiptAlreadyDone(effect.receiptKey)) {
            await this.store.updateEffect(effect.id, { status: "done", doneAt: this.nowIso() });
            continue;
          }
          await this.dispatchEffect(effect);
        }
      } while (this.drainAgain);
    } finally {
      this.draining = false;
    }
  }

  private receiptAlreadyDone(receiptKey: string): boolean {
    return this.store.listEffects().some((e) => e.receiptKey === receiptKey && e.status === "done");
  }

  private runningAssignmentCount(): number {
    return this.store
      .listTickets()
      .reduce(
        (n, t) => n + t.assignments.filter((a: { status: string }) => a.status === "running").length,
        0,
      );
  }

  private async cancelPendingLaunches(ticketId: string, reason: string): Promise<void> {
    const now = this.nowIso();
    for (const effect of this.store.listEffects()) {
      if (effect.kind !== "launch" || effect.ticketId !== ticketId || effect.status !== "pending") {
        continue;
      }
      await this.store.updateEffect(effect.id, {
        status: "failed",
        doneAt: now,
        error: reason,
      });
    }
  }

  private async markLaunchFailedOnTicket(ticketId: string, note: string): Promise<void> {
    const ticket = this.store.getTicket(ticketId);
    if (!ticket || ticket.status !== "open") return;
    const now = this.nowIso();
    const assignments = ticket.assignments.map((assignment) =>
      assignment.status === "pending" && assignment.runId === undefined
        ? { ...assignment, status: "ended" as const, endedAt: now }
        : assignment,
    );
    await this.store.upsertTicket({
      ...ticket,
      assignments,
      latestReport: { kind: "failed", note, at: now },
      updatedAt: now,
    });
    this.notify([ticketId]);
  }

  private async dispatchEffect(effect: WorkEffect): Promise<void> {
    const now = this.nowIso();
    try {
      if (effect.kind === "launch") {
        const ticketId = effect.ticketId;
        if (!ticketId) throw new Error("launch without ticket");
        const ticket = this.store.getTicket(ticketId);
        if (!ticket || ticket.status !== "open") {
          await this.store.updateEffect(effect.id, {
            status: "done",
            doneAt: now,
            error: "Ticket is not open — launch skipped.",
          });
          return;
        }
        if (!ticket.taskId || !this.deps.runs) throw new Error("launch missing task or runs");
        const policy = this.store.getPolicy();
        if (
          policy.requireApprovalsForUnattended &&
          (this.deps.workerAllowsUnattended === undefined ||
            !this.deps.workerAllowsUnattended(ticket.taskId))
        ) {
          throw new Error(
            "Unattended worker requires an agent that can ask for approvals. Turn that off in Settings → Work items, or use an agent with approvals.",
          );
        }
        const prompt =
          typeof effect.payload.prompt === "string" ? effect.payload.prompt : ticket.title;
        // Mark running only via run.started — avoids double-counting with applyRunEvent.
        await this.deps.runs.start({ taskId: ticket.taskId, prompt });
      } else if (effect.kind === "deliver") {
        // Host-side deliver is satisfied once the answer landed on the ticket path.
      } else if (effect.kind === "reply") {
        const threadKey = String(effect.payload.threadKey ?? "");
        const body = String(effect.payload.body ?? "");
        const replied = await replyOnGithubThread(this.runGh, threadKey, body);
        if (!replied.ok) throw new Error(replied.stderr || "GitHub reply failed");
      } else {
        throw new Error(`Unsupported effect kind: ${effect.kind}`);
      }
      await this.store.updateEffect(effect.id, { status: "done", doneAt: now });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.updateEffect(effect.id, {
        status: "failed",
        doneAt: now,
        error: message,
      });
      if (effect.kind === "launch" && effect.ticketId) {
        await this.markLaunchFailedOnTicket(effect.ticketId, message);
      }
    }
  }

  private async applyReport(
    ticketId: string,
    report: NonNullable<WorkTicket["latestReport"]>,
    attentionQuestion?: string,
    meta?: { requestId?: string; runId?: string },
  ): Promise<void> {
    const ticket = this.store.getTicket(ticketId);
    if (!ticket) return;
    const now = this.nowIso();
    const next: WorkTicket = {
      ...ticket,
      latestReport: report,
      updatedAt: now,
      // Always replace attention: progress/clear must drop a stale person/answer wait.
      attention: attentionQuestion
        ? {
            question: attentionQuestion,
            askedAt: now,
            ...(meta?.requestId ? { requestId: meta.requestId } : {}),
            ...(meta?.runId ? { runId: meta.runId } : {}),
          }
        : undefined,
    };
    await this.store.upsertTicket(next);
    this.notify([ticketId]);

    // Channel result/attention replies for GitHub-linked Tickets only.
    const threadKey = next.externalRef?.trim();
    if (
      threadKey &&
      (report.kind === "ready" || report.kind === "blocked" || report.kind === "failed")
    ) {
      await this.enqueueEffect({
        kind: "reply",
        ticketId,
        payload: {
          threadKey,
          body: channelReplyBody(report.kind, report.note),
        },
        receiptKey: effectReceiptKey("reply", ticketId, report.kind),
      });
    }
  }

  private syncGithubPollTimer(): void {
    if (this.githubPollTimer !== undefined) {
      clearInterval(this.githubPollTimer);
      this.githubPollTimer = undefined;
    }
    const policy = this.store.getPolicy();
    const intervalMs = policy.githubPollIntervalMs;
    if (!policy.enabled || policy.acceptMode === "off" || intervalMs <= 0) {
      return;
    }
    this.githubPollTimer = setInterval(() => {
      if (this.githubPollInFlight) return;
      this.githubPollInFlight = true;
      const repo = this.store.getPolicy().githubPollRepo;
      void this.githubPoll(repo ? { repo } : {})
        .catch(() => undefined)
        .finally(() => {
          this.githubPollInFlight = false;
        });
    }, intervalMs);
    if (typeof this.githubPollTimer === "object" && this.githubPollTimer !== null && "unref" in this.githubPollTimer) {
      (this.githubPollTimer as NodeJS.Timeout).unref();
    }
  }

  private async markAssignmentRunning(ticketId: string, runId: string): Promise<void> {
    const ticket = this.store.getTicket(ticketId);
    if (!ticket) return;
    const now = this.nowIso();
    await this.store.upsertTicket(
      withAssignmentRunning(ticket, runId, assignmentIdFor(ticketId, new Date(now)), now),
    );
  }

  private async markAssignmentEnded(ticketId: string, runId: string): Promise<void> {
    const ticket = this.store.getTicket(ticketId);
    if (!ticket) return;
    await this.store.upsertTicket(withAssignmentEnded(ticket, runId, this.nowIso()));
  }
}
