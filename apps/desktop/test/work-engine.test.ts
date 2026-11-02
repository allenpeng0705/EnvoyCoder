import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunEvent, Task } from "@envoydev/protocol";
import { defaultWorkPolicy, effectReceiptKey } from "@envoydev/work-model";
import { describe, expect, it, afterEach, vi } from "vitest";

import { WorkEngine } from "../src/daemon/work-engine.js";

const fixedNow = new Date("2026-02-01T12:00:00.000Z");

function mockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "proj-1",
    cwd: "/tmp/work",
    title: "Fix the flaky test",
    harness: "claude-code",
    status: "idle",
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
    ...overrides,
  };
}

describe("WorkEngine", () => {
  let workDir: string;
  let engineRef: WorkEngine | undefined;

  afterEach(async () => {
    engineRef?.dispose();
    engineRef = undefined;
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  async function openEngine(input: {
    tasks?: Record<string, Task>;
    runs?: NonNullable<Parameters<typeof WorkEngine.open>[0]["runs"]>;
    workerLimit?: number;
    workerAllowsUnattended?: (taskId: string) => boolean;
    runGh?: NonNullable<Parameters<typeof WorkEngine.open>[0]["runGh"]>;
    createTask?: NonNullable<Parameters<typeof WorkEngine.open>[0]["store"]["createTask"]>;
    defaultProjectId?: () => string | undefined;
  } = {}) {
    workDir = await mkdtemp(join(tmpdir(), "envoy-work-"));
    const tasks = input.tasks ?? { "task-1": mockTask() };
    const engine = await WorkEngine.open({
      workDir,
      store: {
        findTask: (id) => tasks[id],
        ...(input.createTask ? { createTask: input.createTask } : {}),
        ...(input.defaultProjectId ? { defaultProjectId: input.defaultProjectId } : {}),
      },
      now: () => fixedNow,
      ...(input.runs ? { runs: input.runs } : {}),
      ...(input.workerLimit !== undefined ? { workerLimit: input.workerLimit } : {}),
      ...(input.workerAllowsUnattended ? { workerAllowsUnattended: input.workerAllowsUnattended } : {}),
      ...(input.runGh ? { runGh: input.runGh } : {}),
    });
    engineRef = engine;
    return engine;
  }

  it("refuses create/promote/candidates while Work items are off", async () => {
    const engine = await openEngine();
    await expect(engine.createTicket({ title: "Nope" })).rejects.toThrow(/turned off/i);
    await expect(engine.promoteTask({ taskId: "task-1" })).rejects.toThrow(/turned off/i);
    await expect(engine.enqueueCandidate({ text: "silent pile" })).rejects.toThrow(/turned off/i);
  });

  it("promotes a task, launches once, and lists tickets with stage", async () => {
    let launches = 0;
    const engine = await openEngine({
      workerAllowsUnattended: () => true,
      runs: {
        start: async () => {
          launches += 1;
          return { run: { id: `run-${launches}` } };
        },
      },
    });
    await engine.setPolicy({ enabled: true });
    const ticket = await engine.promoteTask({ taskId: "task-1" });
    expect(ticket.taskId).toBe("task-1");
    expect(launches).toBe(1);
    expect(
      engine.listEffects().some(
        (e) => e.kind === "launch" && e.status === "done" && e.receiptKey?.endsWith(":initial"),
      ),
    ).toBe(true);

    const again = await engine.promoteTask({ taskId: "task-1" });
    expect(again.id).toBe(ticket.id);
    expect(launches).toBe(1);

    const listed = engine.listTickets({});
    expect(listed).toHaveLength(1);
  });

  it("does not re-launch when initial receipt is already done on reopen", async () => {
    let launches = 0;
    const runs = {
      start: async () => {
        launches += 1;
        return { run: { id: `run-${launches}` } };
      },
    };
    const first = await openEngine({ runs, workerAllowsUnattended: () => true });
    await first.setPolicy({ enabled: true });
    await first.promoteTask({ taskId: "task-1" });
    expect(launches).toBe(1);

    const second = await WorkEngine.open({
      workDir,
      store: { findTask: (id) => (id === "task-1" ? mockTask() : undefined) },
      now: () => fixedNow,
      runs,
      workerAllowsUnattended: () => true,
    });
    await second.drainEffects();
    expect(launches).toBe(1);
  });

  it("clears person/review when the plan starts implementing", async () => {
    const engine = await openEngine({
      workerAllowsUnattended: () => true,
      runs: { start: async () => ({ run: { id: "run-plan" } }) },
    });
    await engine.setPolicy({ enabled: true });
    await engine.promoteTask({ taskId: "task-1" });
    await engine.applyRunEvent({
      kind: "run.plan",
      runId: "run-plan",
      taskId: "task-1",
      at: fixedNow.toISOString(),
      seq: 1,
      planId: "p1",
      entries: [{ content: "Do it", status: "pending" }],
    });
    expect(engine.listTickets({})[0]?.stage).toBe("person/review");

    await engine.applyRunEvent({
      kind: "run.plan",
      runId: "run-plan",
      taskId: "task-1",
      at: fixedNow.toISOString(),
      seq: 2,
      planId: "p1",
      entries: [{ content: "Do it", status: "in_progress" }],
    });
    const ticket = engine.listTickets({})[0]!;
    expect(ticket.latestReport?.kind).toBe("progress");
    expect(ticket.stage).not.toBe("person/review");
    expect(engine.listAttention()).toHaveLength(0);
  });

  it("surfaces ready and failed tickets in Attention", async () => {
    const engine = await openEngine();
    await engine.setPolicy({ enabled: true });
    const created = await engine.createTicket({ title: "Review me" });
    await engine.report({ ticketId: created.id, kind: "ready" });
    const ready = engine.listAttention();
    expect(ready).toHaveLength(1);
    expect(ready[0]?.stage).toBe("person/review");

    const failed = await engine.createTicket({ title: "Broken" });
    await engine.report({ ticketId: failed.id, kind: "failed", note: "Run failed" });
    const attention = engine.listAttention();
    expect(attention.some((t) => t.id === failed.id && t.stage === "person/blocked")).toBe(true);
  });

  it("loads default policy observe + disabled", async () => {
    const engine = await openEngine();
    const policy = engine.getPolicy();
    expect(policy.acceptMode).toBe("observe");
    expect(policy.enabled).toBe(false);
    expect(defaultWorkPolicy(fixedNow.toISOString()).enabled).toBe(false);
  });

  it("observe triage records would-accept without a ticket", async () => {
    const engine = await openEngine();
    await engine.setPolicy({ enabled: true, acceptMode: "observe" });
    const candidate = await engine.enqueueCandidate({ text: "Ship the patch" });
    const result = await engine.triageCandidate({ id: candidate.id });
    expect(result.candidate.disposition).toBe("would-accept");
    expect(result.ticket).toBeUndefined();
    expect(engine.listTickets({})).toHaveLength(0);
  });

  it("auto triage creates a ticket", async () => {
    const engine = await openEngine();
    await engine.setPolicy({ enabled: true, acceptMode: "auto" });
    const candidate = await engine.enqueueCandidate({ text: "New work" });
    const result = await engine.triageCandidate({ id: candidate.id });
    expect(result.candidate.disposition).toBe("accept");
    expect(result.ticket?.title).toBe("New work");
    expect(engine.listTickets({})).toHaveLength(1);
  });

  it("drain coalesces duplicate deliver receipts and prefers human wake", async () => {
    let launches = 0;
    const engine = await openEngine({
      workerLimit: 0,
      runs: {
        start: async () => {
          launches += 1;
          return { run: { id: "run-1" } };
        },
      },
    });
    await engine.setPolicy({ enabled: true });
    const ticket = await engine.createTicket({ title: "Human first", taskId: "task-1" });
    const receipt = effectReceiptKey("deliver", ticket.id, "ping");
    await engine.enqueueEffect({
      kind: "launch",
      ticketId: ticket.id,
      payload: {},
    });
    await engine.enqueueEffect({
      kind: "deliver",
      ticketId: ticket.id,
      payload: { text: "ping" },
      receiptKey: receipt,
    });
    await engine.enqueueEffect({
      kind: "deliver",
      ticketId: ticket.id,
      payload: { text: "ping" },
      receiptKey: receipt,
    });
    await engine.drainEffects();
    expect(launches).toBe(0);
    const effects = engine.listEffects();
    const doneDeliver = effects.filter((e) => e.kind === "deliver" && e.status === "done");
    expect(doneDeliver.length).toBeGreaterThanOrEqual(1);
    expect(effects.some((e) => e.kind === "launch" && e.status === "pending")).toBe(true);
  });

  it("applyRunEvent maps failed runs to person/blocked", async () => {
    const engine = await openEngine({
      workerAllowsUnattended: () => true,
      runs: { start: async () => ({ run: { id: "run-9" } }) },
    });
    await engine.setPolicy({ enabled: true });
    await engine.promoteTask({ taskId: "task-1" });
    const event: RunEvent = {
      kind: "run.ended",
      runId: "run-9",
      taskId: "task-1",
      at: fixedNow.toISOString(),
      seq: 3,
      exitCode: 1,
      status: "failed",
    };
    await engine.applyRunEvent(event);
    const ticket = engine.listTickets({}).find((t) => t.taskId === "task-1");
    expect(ticket?.latestReport?.kind).toBe("failed");
    expect(ticket?.stage).toBe("person/blocked");
    expect(ticket?.attention).toBeUndefined();
  });

  it("stores approval requestId and clears attention on resolve", async () => {
    const engine = await openEngine({
      workerAllowsUnattended: () => true,
      runs: { start: async () => ({ run: { id: "run-a" } }) },
    });
    await engine.setPolicy({ enabled: true });
    await engine.promoteTask({ taskId: "task-1" });
    await engine.applyRunEvent({
      kind: "run.approval-requested",
      runId: "run-a",
      taskId: "task-1",
      at: fixedNow.toISOString(),
      seq: 1,
      requestId: "req-1",
      question: "Allow shell?",
      options: [{ id: "allow", label: "Allow" }],
    });
    let ticket = engine.listTickets({})[0]!;
    expect(ticket.stage).toBe("person/answer");
    expect(ticket.attention?.requestId).toBe("req-1");
    expect(ticket.attention?.runId).toBe("run-a");

    await engine.applyRunEvent({
      kind: "run.approval-resolved",
      runId: "run-a",
      taskId: "task-1",
      at: fixedNow.toISOString(),
      seq: 2,
      requestId: "req-1",
      optionId: "allow",
      by: "you",
    });
    ticket = engine.listTickets({})[0]!;
    expect(ticket.attention).toBeUndefined();
    expect(ticket.latestReport?.kind).toBe("progress");
  });

  it("answerAttention settles a pending approval instead of steering", async () => {
    const answerApproval = vi.fn(async () => true);
    const send = vi.fn(async () => undefined);
    const engine = await openEngine({
      workerAllowsUnattended: () => true,
      runs: {
        start: async () => ({ run: { id: "run-a" } }),
        send,
        isLive: () => true,
        pendingApproval: () => ({ requestId: "req-1", allowOptionIds: ["allow"] }),
        answerApproval,
      },
    });
    await engine.setPolicy({ enabled: true });
    await engine.promoteTask({ taskId: "task-1" });
    await engine.applyRunEvent({
      kind: "run.approval-requested",
      runId: "run-a",
      taskId: "task-1",
      at: fixedNow.toISOString(),
      seq: 1,
      requestId: "req-1",
      question: "Allow shell?",
      options: [{ id: "allow", label: "Allow" }],
    });
    const ticket = await engine.answerAttention({ id: engine.listTickets({})[0]!.id, text: "yes" });
    expect(answerApproval).toHaveBeenCalledWith("run-a", "req-1", "allow", { text: "yes" });
    expect(send).not.toHaveBeenCalled();
    expect(ticket.attention).toBeUndefined();
    expect(ticket.deliveryFailed).toBeUndefined();
  });

  it("does not double-count running assignments for the same runId", async () => {
    const engine = await openEngine({
      workerAllowsUnattended: () => true,
      runs: {
        start: async () => ({ run: { id: "run-dup" } }),
      },
    });
    await engine.setPolicy({ enabled: true });
    await engine.promoteTask({ taskId: "task-1" });
    await engine.applyRunEvent({
      kind: "run.started",
      runId: "run-dup",
      taskId: "task-1",
      at: fixedNow.toISOString(),
      seq: 1,
      harness: "claude-code",
      hostId: "local",
    });
    await engine.applyRunEvent({
      kind: "run.started",
      runId: "run-dup",
      taskId: "task-1",
      at: fixedNow.toISOString(),
      seq: 2,
      harness: "claude-code",
      hostId: "local",
    });
    const ticket = engine.listTickets({})[0]!;
    expect(ticket.assignments.filter((a) => a.status === "running")).toHaveLength(1);
  });

  it("marks reply effects failed when gh returns ok:false", async () => {
    const engine = await openEngine({
      runs: { start: async () => ({ run: { id: "r" } }) },
    });
    // Inject failing gh via private path: reopen with runGh
    workDir = await mkdtemp(join(tmpdir(), "envoy-work-reply-"));
    const failing = await WorkEngine.open({
      workDir,
      store: { findTask: () => mockTask() },
      now: () => fixedNow,
      runGh: async () => ({ ok: false, stdout: "", stderr: "boom" }),
    });
    await failing.setPolicy({ enabled: true });
    const ticket = await failing.createTicket({ title: "t" });
    await failing.enqueueEffect({
      kind: "reply",
      ticketId: ticket.id,
      payload: { threadKey: "github:acme/app#1", body: "hi" },
    });
    const effects = failing.listEffects();
    expect(effects.some((e) => e.kind === "reply" && e.status === "failed")).toBe(true);
  });

  it("surfaces failed unattended launch in Attention as person/blocked", async () => {
    const engine = await openEngine({
      workerAllowsUnattended: () => false,
      runs: {
        start: async () => ({ run: { id: "run-x" } }),
      },
    });
    await engine.setPolicy({ enabled: true, requireApprovalsForUnattended: true });
    const ticket = await engine.createTicket({ title: "Unattended", taskId: "task-1" });
    const effects = engine.listEffects();
    expect(effects.some((e) => e.kind === "launch" && e.status === "failed")).toBe(true);
    const attention = engine.listAttention();
    expect(attention.some((t) => t.id === ticket.id)).toBe(true);
    const blocked = engine.getTicket(ticket.id);
    expect(blocked.stage).toBe("person/blocked");
    expect(blocked.latestReport?.kind).toBe("failed");
    expect(blocked.latestReport?.note).toMatch(/approvals/i);
  });

  it("stop cancels pending launches so drain does not start a run", async () => {
    let launches = 0;
    const engine = await openEngine({
      workerLimit: 0,
      runs: {
        start: async () => {
          launches += 1;
          return { run: { id: `run-${launches}` } };
        },
      },
    });
    await engine.setPolicy({ enabled: true, requireApprovalsForUnattended: false });
    const ticket = await engine.createTicket({ title: "Queued", taskId: "task-1" });
    expect(engine.listEffects().some((e) => e.kind === "launch" && e.status === "pending")).toBe(
      true,
    );
    await engine.stopTicket({ id: ticket.id });
    await engine.drainEffects();
    expect(launches).toBe(0);
    expect(
      engine.listEffects().every((e) => e.kind !== "launch" || e.status !== "pending"),
    ).toBe(true);
  });

  it("answerAttention refuses when there is no live run and keeps attention", async () => {
    const engine = await openEngine({
      runs: {
        start: async () => ({ run: { id: "run-dead" } }),
        isLive: () => false,
        send: async () => undefined,
      },
    });
    await engine.setPolicy({ enabled: true, requireApprovalsForUnattended: false });
    await engine.promoteTask({ taskId: "task-1" });
    await engine.applyRunEvent({
      kind: "run.approval-requested",
      runId: "run-dead",
      taskId: "task-1",
      at: fixedNow.toISOString(),
      seq: 1,
      requestId: "req-dead",
      question: "Still here?",
      options: [{ id: "allow", label: "Allow" }],
    });
    const id = engine.listTickets({})[0]!.id;
    await expect(engine.answerAttention({ id, text: "hello" })).rejects.toThrow(/no live run/i);
    const ticket = engine.getTicket(id);
    expect(ticket.attention?.question).toBe("Still here?");
    expect(ticket.deliveryFailed).toBe(true);
  });

  it("githubPoll observe records would-accept with externalRef and dedupes", async () => {
    const runGh = vi.fn(async () => ({
      ok: true,
      stdout: JSON.stringify([
        [
          {
            id: 501,
            body: "@envoy please fix auth",
            user: { login: "alice" },
            created_at: "2026-01-01T00:00:00Z",
            issue_url: "https://api.github.com/repos/acme/app/issues/4",
          },
        ],
      ]),
      stderr: "",
    }));
    const engine = await openEngine({ runGh });
    await engine.setPolicy({ enabled: true, acceptMode: "observe" });

    const first = await engine.githubPoll({ repo: "acme/app" });
    expect(first.ok).toBe(true);
    expect(first.candidates).toBe(1);
    expect(first.wouldAccept).toBe(1);
    expect(first.accepted).toBe(0);

    const candidates = engine.listCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.externalRef).toBe("github:acme/app#4");
    expect(candidates[0]!.disposition).toBe("would-accept");
    expect(candidates[0]!.text).toMatch(/^@alice:/);
    expect(engine.listTickets({})).toHaveLength(0);

    const second = await engine.githubPoll({ repo: "acme/app" });
    expect(second.ok).toBe(true);
    expect(second.candidates).toBe(0);
    expect(second.wouldAccept).toBe(0);
    expect(engine.listCandidates()).toHaveLength(1);
  });

  it("githubPoll with acceptMode off does not consume mentions", async () => {
    const runGh = vi.fn(async () => ({
      ok: true,
      stdout: JSON.stringify([
        [
          {
            id: 600,
            body: "@envoy later please",
            user: { login: "dan" },
            created_at: "2026-01-01T00:00:00Z",
            issue_url: "https://api.github.com/repos/acme/app/issues/6",
          },
        ],
      ]),
      stderr: "",
    }));
    const engine = await openEngine({ runGh });
    await engine.setPolicy({ enabled: true, acceptMode: "off" });
    const deferred = await engine.githubPoll({ repo: "acme/app" });
    expect(deferred.ok).toBe(true);
    expect(deferred.candidates).toBe(0);
    expect(engine.listCandidates()).toHaveLength(0);

    await engine.setPolicy({ acceptMode: "observe" });
    const observed = await engine.githubPoll({ repo: "acme/app" });
    expect(observed.ok).toBe(true);
    expect(observed.candidates).toBe(1);
    expect(observed.wouldAccept).toBe(1);
    expect(engine.listCandidates()[0]!.disposition).toBe("would-accept");
  });

  it("githubPoll auto creates a Ticket and posts an ack reply", async () => {
    const replies: { args: string[]; stdin?: string }[] = [];
    const runGh = vi.fn(async (args: string[], options?: { stdin?: string }) => {
      const isReply = args.includes("--input");
      if (isReply) {
        replies.push({ args, stdin: options?.stdin });
      }
      const isCommentList = args.some(
        (arg) => arg.includes("/issues/comments") || arg.endsWith("issues/comments"),
      );
      return {
        ok: true,
        stdout:
          isCommentList && !isReply
            ? JSON.stringify([
                [
                  {
                    id: 502,
                    body: "@envoydev ship it",
                    user: { login: "bob" },
                    created_at: "2026-01-01T00:00:00Z",
                    issue_url: "https://api.github.com/repos/acme/app/issues/5",
                  },
                ],
              ])
            : "{}",
        stderr: "",
      };
    });
    let created = 0;
    const engine = await openEngine({
      runGh,
      defaultProjectId: () => "proj-1",
      createTask: async ({ title }) => {
        created += 1;
        return mockTask({ id: `task-gh-${created}`, title });
      },
      runs: {
        start: async () => ({ run: { id: `run-gh-${created}` } }),
      },
      workerAllowsUnattended: () => true,
    });
    await engine.setPolicy({
      enabled: true,
      acceptMode: "auto",
      requireApprovalsForUnattended: false,
    });

    const poll = await engine.githubPoll({ repo: "acme/app" });
    expect(poll.ok).toBe(true);
    expect(poll.accepted).toBe(1);
    expect(engine.listTickets({})).toHaveLength(1);
    expect(engine.listTickets({})[0]!.externalRef).toBe("github:acme/app#5");

    const replyEffects = engine.listEffects().filter((e) => e.kind === "reply");
    expect(replyEffects).toHaveLength(1);
    expect(replyEffects[0]!.status).toBe("done");
    expect(replyEffects[0]!.receiptKey).toBe(
      effectReceiptKey("reply", engine.listTickets({})[0]!.id, "ack"),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]!.stdin).toContain("EnvoyDev accepted this as a work item.");
  });

  it("githubPoll soft-fails when gh is missing", async () => {
    const engine = await openEngine({
      runGh: async () => ({ ok: false, stdout: "", stderr: "gh not available" }),
    });
    await engine.setPolicy({ enabled: true, acceptMode: "observe" });
    const poll = await engine.githubPoll({ repo: "acme/app" });
    expect(poll.ok).toBe(false);
    expect(poll.error).toMatch(/gh CLI is not available/i);
    expect(engine.listCandidates()).toHaveLength(0);
  });

  it("githubPoll reports ackFailed when the acknowledgement reply fails", async () => {
    const runGh = vi.fn(async (args: string[]) => {
      const isReply = args.includes("--input");
      if (isReply) {
        return { ok: false, stdout: "", stderr: "HTTP 401: Bad credentials" };
      }
      return {
        ok: true,
        stdout: JSON.stringify([
          [
            {
              id: 777,
              body: "@envoydev please ship",
              user: { login: "erin" },
              created_at: "2026-01-01T00:00:00Z",
              issue_url: "https://api.github.com/repos/acme/app/issues/7",
            },
          ],
        ]),
        stderr: "",
      };
    });
    let created = 0;
    const engine = await openEngine({
      runGh,
      defaultProjectId: () => "proj-1",
      createTask: async ({ title }) => {
        created += 1;
        return mockTask({ id: `task-ack-${created}`, title });
      },
      runs: { start: async () => ({ run: { id: `run-ack-${created}` } }) },
      workerAllowsUnattended: () => true,
    });
    await engine.setPolicy({
      enabled: true,
      acceptMode: "auto",
      requireApprovalsForUnattended: false,
    });
    const poll = await engine.githubPoll({ repo: "acme/app" });
    expect(poll.ok).toBe(true);
    expect(poll.accepted).toBe(1);
    expect(poll.ackFailed).toBe(1);
    expect(engine.listTickets({})).toHaveLength(1);
  });

  it("posts Channel replies on ready/blocked/failed with idempotent receipts", async () => {
    const replies: string[] = [];
    const runGh = vi.fn(async (_args: string[], options?: { stdin?: string }) => {
      if (options?.stdin) replies.push(options.stdin);
      return { ok: true, stdout: "{}", stderr: "" };
    });
    const engine = await openEngine({ runGh, workerAllowsUnattended: () => true });
    await engine.setPolicy({ enabled: true, requireApprovalsForUnattended: false });
    const ticket = await engine.createTicket({
      title: "From GitHub",
      taskId: "task-1",
      externalRef: "github:acme/app#42",
    });

    await engine.report({ ticketId: ticket.id, kind: "ready", note: "PR up" });
    await engine.report({ ticketId: ticket.id, kind: "ready", note: "PR up again" });
    await engine.report({ ticketId: ticket.id, kind: "blocked", note: "Need secrets" });

    const replyEffects = engine.listEffects().filter((e) => e.kind === "reply");
    expect(replyEffects.map((e) => e.receiptKey).sort()).toEqual(
      [
        effectReceiptKey("reply", ticket.id, "ready"),
        effectReceiptKey("reply", ticket.id, "blocked"),
      ].sort(),
    );
    expect(replyEffects.every((e) => e.status === "done")).toBe(true);
    expect(replies.some((body) => body.includes("ready for review"))).toBe(true);
    expect(replies.some((body) => body.includes("blocked"))).toBe(true);
    // Second ready must not enqueue another reply (receipt already done).
    expect(replyEffects.filter((e) => e.receiptKey?.endsWith(":ready"))).toHaveLength(1);
  });

  it("upgrades a would-accept candidate into a Ticket on Accept", async () => {
    const replies: string[] = [];
    const runGh = vi.fn(async (_args: string[], options?: { stdin?: string }) => {
      if (options?.stdin) replies.push(options.stdin);
      return { ok: true, stdout: "{}", stderr: "" };
    });
    let created = 0;
    const engine = await openEngine({
      runGh,
      defaultProjectId: () => "proj-1",
      createTask: async ({ title }) => {
        created += 1;
        return mockTask({ id: `task-up-${created}`, title });
      },
      runs: { start: async () => ({ run: { id: `run-up-${created}` } }) },
      workerAllowsUnattended: () => true,
    });
    await engine.setPolicy({
      enabled: true,
      acceptMode: "observe",
      requireApprovalsForUnattended: false,
    });
    const candidate = await engine.enqueueCandidate({
      text: "@bob: @envoy please fix",
      strength: "inferred",
      sourceKind: "github",
      externalRef: "github:acme/app#99",
    });
    const watched = await engine.triageCandidate({ id: candidate.id, assessmentAccepts: true });
    expect(watched.candidate.disposition).toBe("would-accept");
    expect(watched.ticket).toBeUndefined();

    const taken = await engine.triageCandidate({ id: candidate.id, assessmentAccepts: true });
    expect(taken.candidate.disposition).toBe("accept");
    expect(taken.ticket?.externalRef).toBe("github:acme/app#99");
    expect(replies.some((body) => body.includes("accepted this as a work item"))).toBe(true);
  });

  it("starts and stops the background GitHub poll timer from policy", async () => {
    vi.useFakeTimers();
    const runGh = vi.fn(async () => ({
      ok: true,
      stdout: JSON.stringify([[]]),
      stderr: "",
    }));
    try {
      const engine = await openEngine({ runGh });
      await engine.setPolicy({
        enabled: true,
        acceptMode: "observe",
        githubPollIntervalMs: 60_000,
        githubPollRepo: "acme/app",
      });
      expect(runGh).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runGh).toHaveBeenCalled();
      const callsAfterFirst = runGh.mock.calls.length;

      await engine.setPolicy({ githubPollIntervalMs: 0 });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(runGh.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      vi.useRealTimers();
    }
  });
});
