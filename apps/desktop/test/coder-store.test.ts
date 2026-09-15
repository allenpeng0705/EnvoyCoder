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

import { RPC_METHODS, type AgentRun, type RunEvent } from "@envoycoder/protocol";

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

  /**
   * A method that rejects with a specific message — the family's transport's own words.
   *
   * Used for the version-skew case: a daemon that answers one list and does not have the other
   * answers `Method not found: <method>`, and that string is what the store has to turn into
   * something a user can act on.
   */
  refusals = new Map<string, string>();

  status: ConnectionStatus = { state: "idle" };
  hello: HelloResult | undefined;

  constructor() {
    this.answers.set("coder.listProjects", { projects: [] });
    this.answers.set("coder.listTasks", { tasks: [] });
    this.answers.set("coder.getSettings", {
      // **The shape the daemon actually sends**, and it lost a key rather than gaining one: settings
      // slice 1 removed `allowRemoteRuns` (there was no remote path to gate), so a fixture that still
      // carried it would be describing a wire nobody serves — and, because this fake answers without
      // validation, it would keep passing while every real daemon refused.
      settings: { defaults: { harness: "envoy-harness" }, requireApprovalForDestructive: true, keepTranscripts: true },
    });
    this.answers.set("coder.listHarnesses", { harnesses: [] });
    // The list of agents the **user** declared. Answered empty, which is the healthy fresh install and
    // the shape the daemon serves for it — a missing answer here would make every store test take the
    // refusal path in `loadProviders` and report a failure nobody staged.
    this.answers.set("coder.listProviders", { providers: [] });
    this.answers.set("coder.meshStatus", { mesh: { kind: "no-node", reason: "" } });
    // The catalogue: a projection of a static list, so the healthy answer is the shape the daemon serves
    // and the store may load it with everything else. Empty here, because a fixture with thirty-eight
    // entries would be describing `@envoycoder/agent-catalog` a second time.
    this.answers.set("coder.listCatalog", { entries: [] });
    // Looking at the machine again: acknowledged, and deliberately carrying no list (`coder.recheckAgents`
    // documents why). A store leg that wanted a *different* answer after a re-check stages it in `answers`.
    this.answers.set("coder.recheckAgents", { ok: true });
    // Running a fix: a success with no output, which is the shape the daemon serves for a command that worked
    // quietly. A leg about one of the other three outcomes stages its own.
    this.answers.set("coder.runFix", {
      outcome: "succeeded",
      commands: ["npm install -g x"],
      exitCode: 0,
      output: "",
    });
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
    const refusal = this.refusals.get(method);
    if (refusal !== undefined) return Promise.reject(new Error(refusal));
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

describe("one window, one socket", () => {
  /**
   * **The bug the title bar was reporting.** `main.tsx` renders inside `<StrictMode>`, so React invokes the
   * window's effect twice in development — and `start()`'s guard was `if (this.connection) return`, checked
   * *before* `await resolveEndpoint()`. Both calls got past it, both opened a socket, and the second replaced the
   * first in `this.connection` while the first stayed connected for the life of the window. The daemon counted
   * two, and the chip in the title bar said **"2 windows"** for one window.
   *
   * The instrument is a `connect` factory that counts, and an endpoint resolver that takes a turn of the event
   * loop — which is exactly the window the race lived in.
   */
  async function started(over: { resolve?: () => Promise<ResolvedEndpoint> } = {}) {
    const connections: FakeConnection[] = [];
    const created = createCoderStore({
      resolveEndpoint: over.resolve ?? (async () => endpoint),
      connect: () => {
        const connection = new FakeConnection();
        connections.push(connection);
        return connection as unknown as CoderConnection;
      },
    });
    return { store: created, connections };
  }

  it("opens exactly one connection when two starts overlap, as StrictMode makes them", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store: created, connections } = await started({
      resolve: async () => {
        await gate;
        return endpoint;
      },
    });

    // Both calls arrive before the endpoint is resolved: the second must join the first rather than start again.
    const first = created.start();
    const second = created.start();
    release?.();
    await Promise.all([first, second]);

    expect(connections).toHaveLength(1);
    // And the socket that exists is connected, not merely present.
    expect(created.getSnapshot().connection.state).toBe("connected");
  });

  it("opens nothing on a later start, and a fresh one only after a dispose", async () => {
    const { store: created, connections } = await started();
    await created.start();
    await created.start();
    expect(connections).toHaveLength(1);

    // A disposed store is a window that has gone: its socket closes, and a start after that is a new one — the
    // same path a reload takes, and the reason `open()` closes whatever was there before it opens more.
    created.dispose();
    expect(connections[0]?.status.state).toBe("idle");
    await created.start();
    expect(connections).toHaveLength(2);
    expect(connections[1]?.status.state).toBe("connected");
  });

  it("keeps a failed start retryable instead of caching the failure", async () => {
    // The endpoint resolution fails when there is no shell and no claim file. Nothing else calls `start()` again,
    // so a promise cached across a failure would leave the window disconnected for the life of the process.
    let attempts = 0;
    const { store: created, connections } = await started({
      resolve: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("no daemon claim file");
        return endpoint;
      },
    });

    await created.start();
    expect(connections).toHaveLength(0);
    expect(created.getSnapshot().connection.state).toBe("disconnected");

    await created.start();
    expect(attempts).toBe(2);
    expect(connections).toHaveLength(1);
  });
});

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

  it("knows the daemon is an older build at connect, without waiting for a call to fail", async () => {
    const connection = new FakeConnection();
    // What an older build advertises: its own compiled catalogue, missing the method added since. This
    // is the situation that produced "I added a project and it never appeared" — the shell attaches to a
    // daemon already owning the port (family rule D2), so the new window kept talking to the old build.
    const older: HelloResult = {
      product: "EnvoyCoder",
      version: "0.1.0",
      instanceId: "daemon-from-an-older-build",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyCoder",
      startedAt: "2026-09-14T01:41:19.093Z",
      windowCount: 1,
      methods: ["coder.hello", "coder.listProjects", "coder.getSettings"],
      mesh: { kind: "no-node" },
      notes: [],
    };
    connection.hello = older;

    const created = createCoderStore({
      resolveEndpoint: async () => endpoint,
      connect: () => connection as unknown as CoderConnection,
    });
    await created.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = created.getSnapshot();
    expect(state.hello?.instanceId).toBe("daemon-from-an-older-build");
    expect(state.error?.key).toBe("error.daemonTooOld");
    // …and it did not ask for the method it already knew was missing: firing a call whose answer is
    // known produces a raw transport error in front of a user for no new information.
    expect(connection.calls.map((call) => call.method)).not.toContain("coder.listTasks");
    // The list it could not read is marked unknown rather than empty, so the rail does not claim a
    // project has no tasks.
    expect(state.tasksKnown).toBe(false);
    expect(state.projects).toEqual([]);
  });

  it("says nothing when the daemon is the same build, or a newer one", async () => {
    const connection = new FakeConnection();
    connection.hello = {
      product: "EnvoyCoder",
      version: "0.1.0",
      instanceId: "same-build",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyCoder",
      startedAt: "2026-09-14T01:41:19.093Z",
      windowCount: 1,
      // A daemon with *more* than this window: `coder.somethingFromTheFuture`. Not skew.
      methods: [...RPC_METHODS, "coder.somethingFromTheFuture"],
      mesh: { kind: "no-node" },
      notes: [],
    };
    const created = createCoderStore({
      resolveEndpoint: async () => endpoint,
      connect: () => connection as unknown as CoderConnection,
    });
    await created.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(created.getSnapshot().error).toBeUndefined();
    expect(connection.calls.map((call) => call.method)).toContain("coder.listTasks");
  });

  it("runs a fix through the daemon, sending the target and returning its outcome", async () => {
    // The one action in this store that changes the user's machine, and its shape is the design: **an id, never a
    // command**. The daemon resolves the commands through the same probes that drew the row, so the mutation this
    // fails on is a window passing a command line down from the row it happens to be showing.
    const connection = new FakeConnection();
    const created = createCoderStore({
      resolveEndpoint: async () => endpoint,
      connect: () => connection as unknown as CoderConnection,
    });
    await created.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    connection.calls.length = 0;

    const result = await created.runFix({ kind: "harness", id: "codex" });
    expect(result.ok).toBe(true);
    const call = connection.calls.find((entry) => entry.method === "coder.runFix");
    expect(call?.params).toEqual({ target: { kind: "harness", id: "codex" } });
    // Nothing is refetched here: the daemon re-checks as part of the run and emits `harnesses`, and the window
    // re-reads on that event like it does for every other change.
    expect(connection.calls.map((entry) => entry.method)).toEqual(["coder.runFix"]);
    if (result.ok) expect(result.result.outcome).toBe("succeeded");
  });

  it("does not offer to run a fix to a daemon that does not serve the method", async () => {
    const connection = new FakeConnection();
    connection.hello = {
      product: "EnvoyCoder",
      version: "0.1.0",
      instanceId: "daemon-from-an-older-build",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyCoder",
      startedAt: "2026-09-14T01:41:19.093Z",
      windowCount: 1,
      methods: ["coder.hello", "coder.listHarnesses"],
      mesh: { kind: "no-node" },
      notes: [],
    };
    const created = createCoderStore({
      resolveEndpoint: async () => endpoint,
      connect: () => connection as unknown as CoderConnection,
    });
    await created.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    connection.calls.length = 0;

    const result = await created.runFix({ kind: "harness", id: "codex" });
    expect(result.ok).toBe(false);
    expect(connection.calls).toEqual([]);
  });

  it("re-checks the machine on request, then re-reads both lists through their ordinary loaders", async () => {
    // The owner's question, as the store's half of it: *"After I run `npm install -g
    // @agentclientprotocol/codex-acp`, how do we let EnvoyCoder know that without restarting?"* The daemon
    // re-measures on every read; this is the window asking it to, and then reading again — through
    // `loadHarnesses`/`loadCatalog` rather than by accepting a list on the re-check's own answer, so there is
    // one projection and one path.
    const connection = new FakeConnection();
    const created = createCoderStore({
      resolveEndpoint: async () => endpoint,
      connect: () => connection as unknown as CoderConnection,
    });
    await created.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    connection.calls.length = 0;

    // What the daemon measures *after* the user installed something: the same call, a different answer.
    connection.answers.set("coder.listHarnesses", {
      harnesses: [{ id: "codex", availability: { state: "ready", binary: "/usr/bin/codex-acp" } }],
    });
    await created.recheckAgents();

    const methods = connection.calls.map((call) => call.method);
    expect(methods[0]).toBe("coder.recheckAgents");
    expect(methods).toContain("coder.listHarnesses");
    expect(methods).toContain("coder.listCatalog");
    expect(created.getSnapshot().harnesses).toHaveLength(1);
  });

  it("does nothing at all when the daemon is a build behind, rather than asking for a method it lacks", async () => {
    // The same rule the rest of this store follows: a call whose answer is already known to be "Method not
    // found" is not made. The page does not draw the control either — two halves of one decision, and this is
    // the half a test can see from here.
    const connection = new FakeConnection();
    connection.hello = {
      product: "EnvoyCoder",
      version: "0.1.0",
      instanceId: "daemon-from-an-older-build",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyCoder",
      startedAt: "2026-09-14T01:41:19.093Z",
      windowCount: 1,
      methods: ["coder.hello", "coder.listHarnesses"],
      mesh: { kind: "no-node" },
      notes: [],
    };
    const created = createCoderStore({
      resolveEndpoint: async () => endpoint,
      connect: () => connection as unknown as CoderConnection,
    });
    await created.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    connection.calls.length = 0;

    await created.recheckAgents();
    expect(connection.calls).toEqual([]);
  });

  it("treats an empty method list as 'no idea', not as 'no methods'", async () => {
    // A daemon that predates the field sends nothing. Skipping every call on that basis would break the
    // window against a daemon that works perfectly well.
    const connection = new FakeConnection();
    connection.hello = {
      product: "EnvoyCoder",
      version: "0.1.0",
      instanceId: "quiet-daemon",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyCoder",
      startedAt: "2026-09-14T01:41:19.093Z",
      windowCount: 1,
      methods: [],
      mesh: { kind: "no-node" },
      notes: [],
    };
    const created = createCoderStore({
      resolveEndpoint: async () => endpoint,
      connect: () => connection as unknown as CoderConnection,
    });
    await created.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(created.getSnapshot().error).toBeUndefined();
    expect(connection.calls.map((call) => call.method)).toContain("coder.listTasks");
    expect(created.getSnapshot().tasksKnown).toBe(true);
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
    //
    // The sentence belongs to the **connection**, not the attention banner: a banner is for something
    // the user just did, and this is the state the window is in (`CoderApp`'s own note says so, and
    // `start()` documents the decision). So what a store test can pin is that the window kept the
    // reason and did *not* claim to be loaded — and the rail, which is where the lie would be
    // rendered, is pinned in `sidebar.test.tsx` ("does not claim there are no projects when it could
    // not ask").
    expect(created.getSnapshot().loaded).toBe(false);
    expect(created.getSnapshot().connection.state).toBe("disconnected");
    const connection0 = created.getSnapshot().connection;
    expect(connection0.state === "disconnected" ? connection0.reason : "").toContain(
      "did not say where its daemon is",
    );
  });

  it("keeps the projects when the other list is refused — a daemon older than the window", async () => {
    // The real report: "I added a project and it never appeared in the sidebar." The daemon had stored
    // it (the file was on disk), but it was an older build that answered `coder.listProjects` and
    // refused `coder.listTasks`. One `Promise.all` dropped *both*, so the rail rendered "No projects
    // yet" for a project that existed — the add looked like it had done nothing.
    const connection = new FakeConnection();
    connection.answers.set("coder.listProjects", {
      projects: [
        {
          id: "local::/tmp/added",
          path: "/tmp/added",
          label: "added",
          hostId: "local",
          addedAt: "2026-09-14T01:35:16.077Z",
        },
      ],
    });
    connection.refusals.set("coder.listTasks", "Method not found: coder.listTasks");

    const created = createCoderStore({
      resolveEndpoint: async () => endpoint,
      connect: () => connection as unknown as CoderConnection,
    });
    await created.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = created.getSnapshot();
    expect(state.projects.map((project) => project.label)).toEqual(["added"]);
    expect(state.tasks).toEqual([]);
    // …and the emptiness is marked as *unknown* rather than real: the rail draws "No tasks yet" under
    // every project from an empty array, and it must not, since nobody could ask.
    expect(state.tasksKnown).toBe(false);
    // …and the failure is said out loud, in the user's language, naming what the daemon does not have.
    expect(state.error?.key).toBe("error.daemonTooOld");
    expect(state.error?.values?.method).toBe("coder.listTasks");
    expect(state.error?.message).toContain("Method not found");
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
    // **And it raises nothing app-wide.** This assertion used to be the opposite one — `error` was set to the
    // same sentence, which the shell rendered in the bar above every surface, so a press that had already
    // answered on its own row answered twice. The owner read the second copy and called it what it was:
    // *"it will show the top bar which is ugly and useless"*. A write's refusal is the caller's to render
    // (`mutate`'s doc states the rule; `failure-placement.test.tsx` holds it surface by surface).
    expect(s.getSnapshot().error).toBeUndefined();
  });

  it("sends the agent's mode with the run, and only when there is one", async () => {
    const { store: s, connection } = await store();
    const run: AgentRun = { id: "run-1", taskId: "w1", harness: "envoy-harness", hostId: "local", startedAt: "", status: "running" };
    connection.answers.set("coder.startRun", { run });
    connection.answers.set("coder.tailRun", { run, events: [] });

    await s.startRun("w1", "plan this", { agentModeId: "plan" });
    expect(connection.calls.find((call) => call.method === "coder.startRun")?.params).toEqual({
      taskId: "w1",
      prompt: "plan this",
      agentModeId: "plan",
    });

    // **The negative half, and the one that matters for the agents that have no modes.** The daemon
    // falls back to the mode the *task* remembers when the field is absent, so a store that always sent
    // one — even as `undefined` — would be a second, quieter source of truth. It is not sent at all.
    connection.calls.length = 0;
    await s.startRun("w1", "just do it");
    const params = connection.calls.find((call) => call.method === "coder.startRun")?.params ?? {};
    expect(Object.keys(params)).not.toContain("agentModeId");
  });
});

describe("changing a task's folder or mode from the window", () => {
  it("passes the new folder through, and hands back the task the daemon stored", async () => {
    const { store: s, connection } = await store();
    connection.answers.set("coder.updateTask", {
      task: {
        id: "w1",
        projectId: "local::/repo",
        cwd: "/elsewhere/api",
        title: "a task",
        harness: "envoy-harness",
        status: "idle",
        createdAt: "",
        updatedAt: "",
      },
    });

    const result = await s.updateTask({ id: "w1", cwd: "/elsewhere/api" });
    // The field reaches the wire, spelled the way `coder.updateTask` declares it.
    expect(connection.calls.find((call) => call.method === "coder.updateTask")?.params).toEqual({
      id: "w1",
      cwd: "/elsewhere/api",
    });
    expect(result.ok).toBe(true);
    // …and the *daemon's* answer is what the caller gets: the path the daemon normalised, not the one
    // the window typed. The list itself is refetched from the `coder:state-changed` event the daemon
    // emits, which is the mechanism every other window relies on too.
    expect(result.ok ? result.task.cwd : "").toBe("/elsewhere/api");
  });

  it("passes a mode through the same call, because both are facts about the task", async () => {
    const { store: s, connection } = await store();
    connection.answers.set("coder.updateTask", {
      task: {
        id: "w1",
        projectId: "local::/repo",
        cwd: "/repo",
        title: "a task",
        harness: "envoy-harness",
        agentModeId: "review",
        status: "idle",
        createdAt: "",
        updatedAt: "",
      },
    });

    const result = await s.updateTask({ id: "w1", agentModeId: "review" });
    expect(connection.calls.find((call) => call.method === "coder.updateTask")?.params).toEqual({
      id: "w1",
      agentModeId: "review",
    });
    expect(result.ok ? result.task.agentModeId : undefined).toBe("review");
  });

  it("keeps a refusal rather than pretending the change landed", async () => {
    const { store: s } = await store();
    // No answer registered: the daemon refused, which is what "that is not a folder on this machine"
    // looks like at this seam.
    const result = await s.updateTask({ id: "w1", cwd: "/gone" });
    expect(result.ok).toBe(false);
    // The refusal travels back to the caller, which is the pane's own line under the composer. Nothing is
    // raised in the window's bar: see the sibling case above for why that assertion is now this one.
    expect(s.getSnapshot().error).toBeUndefined();
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

describe("the agents the user declared", () => {
  it("keeps the daemon's probe verbatim, and defaults nothing", async () => {
    // **The state in this window is the daemon's probe, not a default.** A provider a user typed is a
    // recipe; whether its program is on this machine is measured, and the window renders the
    // measurement. The failure this test exists to catch is the flattering one: a client that read
    // "there is a provider row" as "it works" would show a runnable agent for a command that is not
    // there — which is the assertion-instead-of-a-probe defect this whole slice is about.
    const connection = new FakeConnection();
    connection.answers.set("coder.listProviders", {
      providers: [
        {
          id: "auggie",
          label: "Auggie",
          command: "auggie",
          args: ["--acp"],
          env: [{ name: "AUGMENT_TOKEN", set: false }],
          transport: "acp",
          availability: { state: "not-installed", fix: [{ command: "auggie --acp" }] },
          detail: "Auggie is not installed (looked for auggie on PATH)",
        },
      ],
    });
    const created = createCoderStore({
      resolveEndpoint: async () => endpoint,
      connect: () => connection as unknown as CoderConnection,
    });
    await created.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const providers = created.getSnapshot().providers;
    expect(providers).toHaveLength(1);
    expect(providers[0]?.availability.state).toBe("not-installed");
    // The variables travel as **names and a boolean**, which is the half of the credential story a
    // window can render: `set: false` says this daemon does not have it, and no value is anywhere.
    expect(providers[0]?.env).toEqual([{ name: "AUGMENT_TOKEN", set: false }]);
    created.dispose();
  });

  it("refetches the providers, not the agents we ship, when the daemon says that list moved", async () => {
    // A second window that heard `harnesses` here would ask `coder.listHarnesses` — nine agents it
    // already has — and never see the provider it was just told about. The store's own rule is that the
    // event names *what* moved so exactly one list is refetched.
    const { connection } = await store();
    const providers = connection.calls.filter((call) => call.method === "coder.listProviders").length;
    const harnesses = connection.calls.filter((call) => call.method === "coder.listHarnesses").length;
    const tasks = connection.calls.filter((call) => call.method === "coder.listTasks").length;

    connection.push("coder:state-changed", { kind: "providers", at: "2026-09-14T06:00:00.000Z", ids: ["auggie"] });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(connection.calls.filter((call) => call.method === "coder.listProviders").length).toBe(providers + 1);
    expect(connection.calls.filter((call) => call.method === "coder.listHarnesses").length).toBe(harnesses);
    expect(connection.calls.filter((call) => call.method === "coder.listTasks").length).toBe(tasks);
  });
});

describe("what a run learned about an agent", () => {
  it("refetches the agents, not the tasks, when the daemon says the agent's answer moved", async () => {
    // **The event that makes the observation visible at all.** A run reports what its agent published
    // when the session opened, and the composer's pickers are rendered from `coder.listHarnesses` — so a
    // window that refetched its task list on this event would keep showing the text field it had before
    // the agent ever ran. The three older kinds still land in the lists, which the test below covers.
    const { connection } = await store();
    const harnesses = connection.calls.filter((call) => call.method === "coder.listHarnesses").length;
    const tasks = connection.calls.filter((call) => call.method === "coder.listTasks").length;

    connection.push("coder:state-changed", { kind: "harnesses", at: "2026-09-14T05:23:00.000Z" });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(connection.calls.filter((call) => call.method === "coder.listHarnesses").length).toBe(harnesses + 1);
    // Not a task refetch: nothing about the task list changed, and a client that fetched it would be
    // reading a different question's answer.
    expect(connection.calls.filter((call) => call.method === "coder.listTasks").length).toBe(tasks);
  });

  it("declares an agent with exactly the parameters it was handed, dialect included", async () => {
    // **The mutation this fails on:** renaming a field, or defaulting `transport` on the way to the wire.
    // The screen passes the catalogue entry's own statement of its dialect through untouched, and that
    // property dies the moment this method reshapes the object instead of forwarding it — silently, because
    // a defaulted `"acp"` reaches a daemon that accepts it.
    const { store: s, connection } = await store();
    connection.answers.set("coder.addProvider", { provider: { id: "vtcode" } });

    const input = {
      id: "vtcode",
      label: "VT Code",
      command: "vtcode",
      args: ["acp", "--x"],
      env: ["VT_ACP_ENABLED"],
      transport: "cli" as const,
    };
    const result = await s.addProvider(input);

    expect(result.ok).toBe(true);
    expect(connection.calls.find((call) => call.method === "coder.addProvider")?.params).toEqual({
      id: "vtcode",
      label: "VT Code",
      command: "vtcode",
      args: ["acp", "--x"],
      env: ["VT_ACP_ENABLED"],
      // The unusual value, passed through: the whole point of the field is that the daemon is told what the
      // entry states rather than what a caller assumed.
      transport: "cli",
    });
  });

  it("loads the catalogue with the other lists, and stays quiet when the daemon has none", async () => {
    // **Silence is deliberate here and reported nowhere else.** `coder.listCatalog` is a method this build
    // added, so a daemon one build behind refuses it — and an empty catalogue is not a lie about anything,
    // because the page renders "this daemon is an older build" from the method list rather than from an empty
    // array. Raising the global error banner for it would put a scary sentence over the whole window for a
    // feature that simply is not there yet.
    const { store: s, connection } = await store();
    connection.answers.set("coder.listCatalog", { entries: [{ id: "goose", title: "goose" }] });
    await s.loadAll();
    expect(s.getSnapshot().catalog).toEqual([{ id: "goose", title: "goose" }]);
    expect(s.getSnapshot().error).toBeUndefined();

    const { store: older, connection: olderConnection } = await store();
    olderConnection.refusals.set("coder.listCatalog", "Method not found: coder.listCatalog");
    await older.loadAll();
    expect(older.getSnapshot().catalog).toEqual([]);
    // The refusal is not raised as the window's error — see the case's own doc.
    expect(older.getSnapshot().error).toBeUndefined();
  });

  it("starts a run with the thinking level the composer chose, and drops the control's empty value", async () => {
    // `""` is the control's "the agent's own default" and is **not** a level: it must not travel, because
    // the daemon's schema requires a non-empty value — the same care the model already takes.
    const { store: s, connection } = await store();
    connection.answers.set("coder.startRun", { run: { id: "run-1", taskId: "t1", harness: "deepseek-harness", hostId: "local", startedAt: "x", status: "running" } });
    connection.answers.set("coder.tailRun", { run: { id: "run-1", taskId: "t1", harness: "deepseek-harness", hostId: "local", startedAt: "x", status: "running" }, events: [], nextSeq: 0, live: true });

    await s.startRun("t1", "go", { thinkingLevel: "max" });
    expect(connection.calls.find((call) => call.method === "coder.startRun")?.params).toMatchObject({ thinkingLevel: "max" });

    await s.startRun("t1", "go", { thinkingLevel: "" });
    const starts = connection.calls.filter((call) => call.method === "coder.startRun");
    expect(Object.prototype.hasOwnProperty.call(starts[1]?.params ?? {}, "thinkingLevel")).toBe(false);
  });
});
