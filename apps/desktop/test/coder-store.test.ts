/**
 * The store: the seam between the socket and the window.
 *
 * ## What is actually being tested
 *
 * This is the piece of the app a user would notice breaking and no lower test can see: the daemon
 * pushes an event, and the rail, the pane and the transcript are supposed to change. The connection
 * has its own tests (framing, reconnect, the squatter refusal), the transcript has its own (the
 * folding rules), and the pane has its own (rendering). What none of them covers is the middle —
 * whether an event that arrives is *applied*, to the right run, without either dropping it or
 * applying it twice.
 *
 * The connection is faked at the store's own seam rather than by mocking a WebSocket, because what
 * the store is supposed to do with a connection is the contract; the socket's bytes are somebody
 * else's test.
 */

import { describe, expect, it, vi } from "vitest";

import type { AgentRun, RunEvent } from "@envoycoder/protocol";

import type { CoderConnection, ConnectionStatus, HelloResult } from "../src/client/connection.js";
import { createCoderStore, type CoderState } from "../src/state/coderStore.js";
import type { ResolvedEndpoint } from "../src/client/endpoint.js";

/* ────────────────────────────── a connection the test drives ────────────────────────────── */

class FakeConnection {
  readonly calls: { method: string; params: Record<string, unknown> }[] = [];
  readonly listeners = new Map<string, Set<(data: unknown) => void>>();
  readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  /** Answers, by method. A method with no answer rejects, which is how a refusal is staged. */
  answers = new Map<string, unknown>();

  status: ConnectionStatus = { state: "idle" };
  hello: HelloResult | undefined;

  constructor() {
    this.answers.set("coder.listProjects", { projects: [] });
    this.answers.set("coder.listTasks", { tasks: [] });
    this.answers.set("coder.getSettings", {
      settings: { defaults: { harness: "envoy-harness" }, requireApprovalForDestructive: true, allowRemoteRuns: false, keepTranscripts: true },
    });
    this.answers.set("coder.listHarnesses", { harnesses: [] });
    this.answers.set("coder.meshStatus", { mesh: { kind: "no-node", reason: "" } });
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  on(event: string, listener: (data: unknown) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (!this.answers.has(method)) {
      return Promise.reject(new Error(`envoycoder.harness-failed: ${method} was refused in this test`));
    }
    return Promise.resolve(this.answers.get(method));
  }

  callTyped<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.call(method, params) as Promise<T>;
  }

  start(): void {
    this.setStatus({ state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } });
  }

  dispose(): void {
    this.setStatus({ state: "idle" });
  }

  /* — what the test does to it — */

  setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of [...this.statusListeners]) listener(status);
  }

  push(event: string, data: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(data);
  }
}

const endpoint: ResolvedEndpoint = {
  endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" },
  verifiedBy: "shell",
};

async function store(): Promise<{ store: ReturnType<typeof createCoderStore>; connection: FakeConnection; state: () => CoderState }> {
  const connection = new FakeConnection();
  const created = createCoderStore({
    resolveEndpoint: async () => endpoint,
    connect: () => connection as unknown as CoderConnection,
  });
  await created.start();
  // The store subscribes and connects synchronously; `loadAll` runs on the status callback.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { store: created, connection, state: () => created.getSnapshot() };
}

let seq = 0;
function runEvent(payload: Record<string, unknown>): RunEvent {
  seq += 1;
  return { runId: "run-1", taskId: "w1", at: "2026-09-13T10:00:00.000Z", seq, ...payload } as RunEvent;
}

/* ────────────────────────────── the tests ────────────────────────────── */

describe("the store's connection to the daemon", () => {
  it("subscribes to what it renders, once, and loads what it needs", async () => {
    const { connection, state } = await store();
    const subscribed = connection.listeners.get("coder:run-event");
    expect(subscribed?.size).toBe(1);
    // State changes are how the rail hears about another window's edit, so it must be subscribed
    // too — a window that only listened to runs would show a stale sidebar.
    expect(connection.listeners.get("coder:state-changed")?.size).toBe(1);
    expect(state().loaded).toBe(true);
  });

  it("reports a failure to reach the daemon instead of rendering an empty rail", async () => {
    const connection = new FakeConnection();
    const created = createCoderStore({
      resolveEndpoint: async () => {
        throw new Error("The EnvoyCoder shell did not say where its daemon is.");
      },
      connect: () => connection as unknown as CoderConnection,
    });
    await created.start();
    // "No projects yet" and "I could not ask" are different sentences, and showing the first for the
    // second is how a user concludes the app lost their work.
    expect(created.getSnapshot().error).toContain("did not say where its daemon is");
    expect(created.getSnapshot().loaded).toBe(false);
  });
});

describe("applying run events", () => {
  it("appends an event to the run it belongs to", async () => {
    const { store: s, connection, state } = await store();
    s.getSnapshot();
    // The store learns about a run by asking for its backlog, which is what a window does when the
    // run was started by another window or before this one connected.
    connection.answers.set("coder.tailRun", {
      run: { id: "run-1", taskId: "w1", harness: "deepseek-harness", hostId: "local", startedAt: "", status: "running" },
      events: [runEvent({ kind: "run.started", harness: "deepseek-harness", hostId: "local" })],
    });

    connection.push("coder:run-event", runEvent({ kind: "run.output", stream: "assistant", text: "hi", messageId: "m1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Unknown run → the store fetches it, including the backlog, so the transcript does not begin
    // mid-sentence.
    expect(connection.calls.some((call) => call.method === "coder.tailRun")).toBe(true);
    expect(state().runs["run-1"]?.events).toHaveLength(1);
  });

  it("appends a later event to a run it already knows", async () => {
    const { store: s, connection } = await store();
    const run: AgentRun = { id: "run-1", taskId: "w1", harness: "deepseek-harness", hostId: "local", startedAt: "", status: "running" };
    connection.answers.set("coder.startRun", { run });
    connection.answers.set("coder.tailRun", { run, events: [] });

    await s.startRun("w1", "hello");
    connection.push("coder:run-event", runEvent({ kind: "run.output", stream: "assistant", text: "one", messageId: "m1" }));
    connection.push("coder:run-event", runEvent({ kind: "run.output", stream: "assistant", text: "two", messageId: "m1" }));

    const events = s.getSnapshot().runs["run-1"]?.events ?? [];
    expect(events).toHaveLength(2);
    // The transcript the pane renders is derived here, from the events the store applied.
    expect(s.transcript("run-1").entries[0]).toMatchObject({ kind: "assistant", text: "onetwo" });
  });

  it("ignores a repeated event, so a reconnect cannot duplicate the transcript", async () => {
    const { store: s, connection } = await store();
    const run: AgentRun = { id: "run-1", taskId: "w1", harness: "deepseek-harness", hostId: "local", startedAt: "", status: "running" };
    connection.answers.set("coder.startRun", { run });
    connection.answers.set("coder.tailRun", { run, events: [] });
    await s.startRun("w1", "hello");

    const event = runEvent({ kind: "run.output", stream: "assistant", text: "once", messageId: "m1" });
    connection.push("coder:run-event", event);
    // The daemon re-sends the backlog after a re-subscribe, so the same `seq` arrives twice. Applying
    // it twice would render the same sentence twice — the bug that makes a reconnect look like the
    // agent repeating itself.
    connection.push("coder:run-event", event);
    expect(s.getSnapshot().runs["run-1"]?.events).toHaveLength(1);
  });
});

describe("starting a task from the window", () => {
  it("starts the run, loads it, and refreshes the rail", async () => {
    const { store: s, connection } = await store();
    const run: AgentRun = { id: "run-1", taskId: "w1", harness: "deepseek-harness", hostId: "local", startedAt: "", status: "running" };
    connection.answers.set("coder.startRun", { run });
    connection.answers.set("coder.tailRun", { run, events: [runEvent({ kind: "run.started", harness: "deepseek-harness", hostId: "local" })] });

    const result = await s.startRun("w1", "add the keys");
    expect(result.ok).toBe(true);
    expect(connection.calls.find((call) => call.method === "coder.startRun")?.params).toEqual({
      taskId: "w1",
      prompt: "add the keys",
    });
    // The run is fetched immediately: `startRun` answers as soon as the run exists, and events may
    // already have been broadcast before the reply landed.
    expect(connection.calls.some((call) => call.method === "coder.tailRun")).toBe(true);
    // And the rail is refetched, because the task's status just changed.
    const listCalls = connection.calls.filter((call) => call.method === "coder.listTasks").length;
    expect(listCalls).toBeGreaterThan(1);
  });

  it("reports a refusal in the daemon's words rather than throwing at the click handler", async () => {
    const { store: s } = await store();
    // No answer registered: the call rejects, which is what a daemon refusal looks like here.
    const result = await s.startRun("w-busy", "another");
    expect(result.ok).toBe(false);
    // `harness-failed` is stripped to its sentence — a user reads "the task is already running", not
    // a code.
    expect(result.ok === false ? result.message : "").toContain("refused in this test");
    expect(s.getSnapshot().error).toBeTruthy();
  });
});

describe("answering an approval", () => {
  it("sends the option id and clears the error on success", async () => {
    const { store: s, connection } = await store();
    connection.answers.set("coder.answerApproval", { runId: "run-1", requestId: "req-1", resolved: true });

    const result = await s.answerApproval("run-1", "req-1", "allow-once");
    expect(result.ok).toBe(true);
    expect(connection.calls.find((call) => call.method === "coder.answerApproval")?.params).toEqual({
      runId: "run-1",
      requestId: "req-1",
      optionId: "allow-once",
    });
    expect(s.getSnapshot().error).toBeUndefined();
  });

  it("says so when the request was already answered", async () => {
    const { store: s, connection } = await store();
    connection.answers.set("coder.answerApproval", { runId: "run-1", requestId: "req-1", resolved: false });
    // `resolved: false` is not an error — the daemon refused a second answer to the same question,
    // which is what a double click produces. The store passes the outcome through rather than
    // inventing a failure for it.
    const result = await s.answerApproval("run-1", "req-1", "allow-once");
    expect(result.ok).toBe(true);
  });
});

describe("other windows", () => {
  it("refetches the lists when another window changes something", async () => {
    const { store: s, connection } = await store();
    const before = connection.calls.filter((call) => call.method === "coder.listTasks").length;

    connection.push("coder:state-changed", { kind: "tasks", at: "2026-09-13T10:00:00.000Z" });
    // Coalesced on a frame, so a burst of changes is one refetch rather than one per event.
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(connection.calls.filter((call) => call.method === "coder.listTasks").length).toBeGreaterThan(before);
    void s;
  });

  it("takes the mesh at its word when it says the attachment changed", async () => {
    const { connection, state } = await store();
    connection.push("coder:mesh-status", { kind: "attached", scopeKey: "product:EnvoyCoder", ownerId: "owner" });
    expect(state().mesh.kind).toBe("attached");
  });
});
