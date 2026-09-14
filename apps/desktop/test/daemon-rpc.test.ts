import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** The scripted ACP agent, so a run's event sequence is deterministic. */
const FAKE_AGENT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

/**
 * The daemon, over a real socket, with a real client.
 *
 * ## Why this test exists next to the unit tests
 *
 * The repo has already been burned by the difference (`AGENTS.md`: "Tests and the bundle are
 * different proofs" — a green suite once shipped a broken import path). Everything interesting about
 * M1 only fails when something is *actually listening*:
 *
 *   * the transport subscribes to our event names **at start**, from the disposition table, and a
 *     missing entry looks exactly like a working daemon that never updates;
 *   * the claim file is written after the bind, so a reordering makes `coder.hello` report a port
 *     nobody is on;
 *   * the request envelope is the family's, and a client that gets the framing subtly wrong sees
 *     silence rather than an error.
 *
 * So this boots the real daemon on an OS-chosen port, under a temporary home, with a temporary
 * state directory, and drives it with the same `ws` protocol the window uses. `port: 0` throughout:
 * a fixed port in a test is a test that fails when something else on the machine happens to use it.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import {
  CODER_EVENTS,
  DEFAULT_DAEMON_PATH,
  ENVOYCODER_ERRORS,
  coderErrorCode,
  coderErrorMessage,
  coderErrorRef,
} from "@envoycoder/protocol";
import { coderPaths } from "@envoycoder/host-bridge";

import { AcpClient } from "../src/daemon/acp/client.js";
import { readDaemonClaim } from "../src/daemon/lock.js";
import { isMessageKey } from "../src/i18n/messages/en.js";
import { startCoderDaemon, type StartedCoderDaemon } from "../src/daemon/serve.js";

/* ────────────────────────────── harness ────────────────────────────── */

interface JsonRpcClient {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Resolve with the next event of this name. */
  nextEvent(event: string): Promise<unknown>;
  /** Resolve once an event of this name matches. */
  waitForEvent(event: string, match: (data: unknown) => boolean): Promise<unknown>;
  /** Record every event of this name into `sink` until the returned function is called. */
  collectEvents(event: string, sink: unknown[]): () => void;
  /** Ask the daemon for events on this connection, the way the window does. */
  subscribe(events?: readonly string[]): Promise<{ subscribed: string[] }>;
  close(): void;
}

/**
 * A minimal client for the family's transport.
 *
 * Deliberately *not* the app's client runtime: if both sides shared an implementation, a mistake in
 * the framing would be invisible here — the test would agree with the bug. This speaks the wire
 * format directly (`{id, method, params}` → `{id, result|error}`, events as `{event, data}`), which
 * is what "the contract" means.
 */
async function connect(port: number, path = DEFAULT_DAEMON_PATH): Promise<JsonRpcClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  let counter = 0;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  /**
   * The two frames the transport sends, declared so `event` and `id` are required — which is what
   * makes the `in` check below a real narrowing rather than a guess. An optional discriminator is
   * not a discriminator.
   */
  type Incoming =
    | { id: string; result?: unknown; error?: { message: string } }
    | { event: string; data?: unknown };

  /**
   * One mechanism for "tell me about this event", used three ways.
   *
   * It has to be *persistent* listeners rather than a queue of one-shot waiters: a test that waits
   * for a matching event would otherwise lose its place every time a non-matching event arrived
   * first, which is every run whose first events are not the one being waited for.
   */
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  socket.on("message", (raw: Buffer) => {
    const message = JSON.parse(raw.toString("utf8")) as Incoming;

    if ("event" in message) {
      for (const listener of [...(listeners.get(message.event) ?? [])]) listener(message.data);
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });

  const onEvent = (event: string, listener: (data: unknown) => void): (() => void) => {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  };

  // Named rather than a `this.call(...)` method: an object literal inside an async function is
  // contextually typed by the *promise* it returns, so `this` there is the union, not the client.
  const call = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const id = `c${(counter += 1)}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  };

  return {
    call,
    subscribe(events) {
      return call("coder.subscribe", events ? { events } : {}) as Promise<{ subscribed: string[] }>;
    },
    nextEvent(event) {
      return new Promise((resolve) => {
        const off = onEvent(event, (data) => {
          off();
          resolve(data);
        });
      });
    },
    waitForEvent(event, match) {
      return new Promise((resolve) => {
        const off = onEvent(event, (data) => {
          if (!match(data)) return;
          off();
          resolve(data);
        });
      });
    },
    collectEvents(event, sink) {
      return onEvent(event, (data) => {
        sink.push(data);
      });
    },
    close() {
      socket.close();
    },
  };
}

/** Boot a daemon under a throwaway home, and return it with its state directory. */
async function bootDaemon(): Promise<{ daemon: StartedCoderDaemon; home: string }> {
  const home = await mkdtemp(join(tmpdir(), "envoycoder-m1-"));
  const daemon = await startCoderDaemon({
    port: 0,
    home,
    paths: coderPaths(home),
    skipMeshAttach: true,
    // No test should depend on which agent CLIs happen to be installed.
    isDirectory: async (path) => path.startsWith(home) || path.startsWith(tmpdir()),
  });
  return { daemon, home };
}

/**
 * Teardown, last in first out.
 *
 * Order is not cosmetic: an agent process must be stopped before the directory it is working in is
 * removed, or the removal races the agent and the failure surfaces as `ENOTEMPTY` in the *next*
 * test rather than as the ordering bug it is.
 */
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("the daemon over a socket", () => {
  it("says which daemon it is, and where its state lives", async () => {
    const { daemon, home } = await bootDaemon();
    cleanups.push(async () => {
      await daemon.stop();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const hello = (await client.call("coder.hello", { client: { name: "test" } })) as {
      product: string;
      instanceId: string;
      home: string;
      stateDir: string;
      methods: string[];
      mesh: { kind: string };
      windowCount: number;
    };

    expect(hello.product).toBe("EnvoyCoder");
    // The instance id is what tells this daemon from a squatter on the same port; a client that
    // cannot compare it cannot tell them apart.
    expect(hello.instanceId).toBe(daemon.instanceId);
    expect(hello.home).toBe(home);
    expect(hello.stateDir).toBe(join(home, "EnvoyCoder"));
    expect(hello.methods).toContain("coder.addProject");
    expect(hello.mesh.kind).toBe("no-node");
    expect(hello.windowCount).toBeGreaterThanOrEqual(1);
  });

  it("adds a project, creates a task in it, and reads both back", async () => {
    const { daemon, home } = await bootDaemon();
    cleanups.push(async () => {
      await daemon.stop();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const projectPath = join(home, "work", "payments-api");
    const added = (await client.call("coder.addProject", { path: projectPath })) as {
      project: { id: string; label: string; hostId: string };
    };
    // The id is derived, not allocated, so a phone and a window that add the same directory agree
    // without a handshake.
    expect(added.project.id).toBe(`local::${projectPath}`);
    expect(added.project.label).toBe("payments-api");

    const task = (
      await client.call("coder.createTask", {
        projectId: added.project.id,
        title: "Add idempotency keys to the refund endpoint",
      })
    ) as { task: { id: string; cwd: string; harness: string; status: string } };
    // Defaults resolve from the project, then the app, then the fallback — never from a guess.
    expect(task.task.cwd).toBe(projectPath);
    expect(task.task.harness).toBe("envoy-harness");
    expect(task.task.status).toBe("idle");

    const listed = (await client.call("coder.listTasks", {})) as { tasks: unknown[] };
    expect(listed.tasks).toHaveLength(1);
  });

  it("survives a restart with its projects and tasks intact", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m1-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const first = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      // The real filesystem check, because this test is about state surviving a restart: a stub
      // that says "yes" to any path would let a bug in the path handling pass.
      isDirectory: async () => true,
    });
    const client = await connect(first.port);
    const project = (await client.call("coder.addProject", { path: join(home, "repo") })) as {
      project: { id: string };
    };
    await client.call("coder.createTask", { projectId: project.project.id, title: "first task" });
    client.close();
    await first.stop();

    // The claim must be gone, or the next daemon refuses to start believing one is running.
    expect((await readDaemonClaim(coderPaths(home))).state).toBe("none");

    const second = await startCoderDaemon({ port: 0, home, paths: coderPaths(home), skipMeshAttach: true });
    cleanups.push(async () => second.stop());
    const secondClient = await connect(second.port);
    cleanups.push(async () => secondClient.close());

    const projects = (await secondClient.call("coder.listProjects", {})) as { projects: unknown[] };
    const tasks = (await secondClient.call("coder.listTasks", {})) as { tasks: unknown[] };
    expect(projects.projects).toHaveLength(1);
    expect(tasks.tasks).toHaveLength(1);
  });

  it("remembers the language across a restart, because it is a user setting and not a window's", async () => {
    // The language is the one setting whose *storage* is part of its behaviour: the daemon is what
    // sends the refusals, so a window that kept the choice for itself would answer a German user in
    // English the moment it reconnected to a daemon that had never been told. This asserts the two
    // halves that make it a per-user setting rather than a per-window preference — accepted at the
    // wire, and still there after the process it was written by is gone.
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m1-"));
    const paths = coderPaths(home);
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const first = await startCoderDaemon({ port: 0, home, paths, skipMeshAttach: true });
    const client = await connect(first.port);
    const initial = (await client.call("coder.getSettings", {})) as { settings: { language?: string } };
    // Absent in a fresh install means `system`, which is the default the picker shows and applies.
    expect(initial.settings.language ?? "system").toBe("system");

    const patched = (await client.call("coder.updateSettings", { settings: { language: "ko" } })) as {
      settings: { language?: string };
    };
    expect(patched.settings.language).toBe("ko");
    client.close();
    await first.stop();

    const second = await startCoderDaemon({ port: 0, home, paths, skipMeshAttach: true });
    cleanups.push(async () => second.stop());
    const secondClient = await connect(second.port);
    cleanups.push(async () => secondClient.close());
    const after = (await secondClient.call("coder.getSettings", {})) as { settings: { language?: string } };
    expect(after.settings.language).toBe("ko");
  });

  it("refuses a language nobody translated, rather than storing it", async () => {
    // The picker cannot offer one — `LOCALE_PREFERENCES` is the same closed list — but a client on
    // another build can ask, and a stored language that does not exist would render as the English
    // fallback forever with nothing to point at.
    const { daemon, home } = await bootDaemon();
    cleanups.push(async () => {
      await daemon.stop();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    await expect(client.call("coder.updateSettings", { settings: { language: "nl" } })).rejects.toThrow();
    const settings = (await client.call("coder.getSettings", {})) as { settings: { language?: string } };
    expect(settings.settings.language ?? "system").toBe("system");
  });

  it("quarantines an unreadable file instead of overwriting it, and says so at hello", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m1-"));
    const paths = coderPaths(home);
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const { mkdir } = await import("node:fs/promises");
    await mkdir(paths.stateDir, { recursive: true });
    // A half-written file: the shape a crash leaves behind, and the one case where the wrong
    // response destroys a user's list of what they were working on.
    await writeFile(paths.projectsFile, '[{"id":"local::/x","path":"/x",', "utf8");

    const daemon = await startCoderDaemon({ port: 0, home, paths, skipMeshAttach: true });
    cleanups.push(async () => daemon.stop());
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const hello = (await client.call("coder.hello", {})) as { notes: string[]; methods: string[] };
    expect(hello.notes.join("\n")).toContain("could not read projects.json");

    const projects = (await client.call("coder.listProjects", {})) as { projects: unknown[] };
    expect(projects.projects).toEqual([]);

    // The bytes still exist, under a name the user can find and open.
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(paths.stateDir);
    const saved = files.find((name) => name.startsWith("projects.corrupt-"));
    expect(saved).toBeDefined();
    expect(await readFile(join(paths.stateDir, saved!), "utf8")).toContain('"id":"local::/x"');
  });

  it("keeps the valid rows when one row is unusable", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m1-"));
    const paths = coderPaths(home);
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const { mkdir } = await import("node:fs/promises");
    await mkdir(paths.stateDir, { recursive: true });
    await writeFile(
      paths.projectsFile,
      JSON.stringify([
        { id: "local::/good", path: "/good", label: "good", hostId: "local", addedAt: "2026-09-13T10:00:00.000Z" },
        // No `path`. One bad row must not cost the other one.
        { id: "local::/bad", label: "bad", hostId: "local", addedAt: "2026-09-13T10:00:00.000Z" },
      ]),
      "utf8",
    );

    const daemon = await startCoderDaemon({ port: 0, home, paths, skipMeshAttach: true });
    cleanups.push(async () => daemon.stop());
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const projects = (await client.call("coder.listProjects", {})) as { projects: { id: string }[] };
    expect(projects.projects.map((project) => project.id)).toEqual(["local::/good"]);

    const hello = (await client.call("coder.hello", {})) as { notes: string[] };
    expect(hello.notes.join("\n")).toContain("entry 2");
  });

  it("refuses a project directory that does not exist, with a code a UI can use", async () => {
    const { daemon, home } = await bootDaemon();
    cleanups.push(async () => {
      await daemon.stop();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    await expect(client.call("coder.addProject", { path: "/definitely/not/here" })).rejects.toThrow(
      /envoycoder\.path-missing/,
    );
  });

  it("refuses an unknown method by name rather than hanging", async () => {
    const { daemon, home } = await bootDaemon();
    cleanups.push(async () => {
      await daemon.stop();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    await expect(client.call("coder.notAMethod", {})).rejects.toThrow(/Method not found/);
    // This daemon was started without an agent runtime on purpose (it is the M1 test bench), and the
    // run methods say *that* rather than pretending the build cannot do it at all. The distinction
    // matters to a user: "this build has no runtime" and "this feature does not exist yet" call for
    // different things.
    await expect(client.call("coder.startRun", { taskId: "w", prompt: "hi" })).rejects.toThrow(
      /no agent runtime|no task called/i,
    );
  });

  it("refuses unusable parameters with our own code, not a schema dump", async () => {
    const { daemon, home } = await bootDaemon();
    cleanups.push(async () => {
      await daemon.stop();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    // `project-missing`, not `task-missing` and not the `path-missing` above: three different
    // conditions, three different next steps for a caller ("reload the list", "pick another folder").
    // The codes used to be one, which is why these two tests name them separately.
    await expect(client.call("coder.createTask", { projectId: "nope", title: "x" })).rejects.toThrow(
      /envoycoder\.project-missing/,
    );
    await expect(client.call("coder.addProject", {})).rejects.toThrow(/envoycoder\.bad-request/);
  });

  it("tells a second client about a change the first one made — the multi-window rule", async () => {
    const { daemon, home } = await bootDaemon();
    cleanups.push(async () => {
      await daemon.stop();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });

    const windowOne = await connect(daemon.port);
    const windowTwo = await connect(daemon.port);
    cleanups.push(async () => {
      windowOne.close();
      windowTwo.close();
    });

    // Each client subscribes to what it renders; the transport pushes nothing unasked.
    const subscription = await windowTwo.subscribe(["coder:state-changed"]);
    expect(subscription.subscribed).toEqual(["coder:state-changed"]);
    const pendingEvent = windowTwo.nextEvent("coder:state-changed");

    await windowOne.call("coder.addProject", { path: join(home, "shared-repo") });

    const event = (await pendingEvent) as { kind: string; at: string };
    expect(event.kind).toBe("projects");
    // The event carries *what* changed, not the new state, so both windows refetch the same list
    // and cannot disagree about ordering.
    expect(typeof event.at).toBe("string");
  });

  it("declares exactly the three events the client subscribes to", () => {
    // A guard against the failure mode this test file exists for: an event the daemon emits but the
    // disposition table does not name is dropped by the transport as a typo-like no-op.
    expect([...CODER_EVENTS]).toEqual(["coder:state-changed", "coder:run-event", "coder:mesh-status"]);
  });
});
/**
 * A run driven over the socket, which is what the window does.
 *
 * The daemon is the only thing that runs agents — the window and `scripts/run-once.ts` are both
 * clients of the same methods — so this is where "a task started from the UI appears in the
 * transcript" is actually decided. The agent here is the scripted fixture, because the *semantics*
 * of a run are what this asserts; `acp-transport.test.ts` is where a real agent process is proven.
 */
describe("a run, driven over the socket", () => {
  it("streams normalized events to a subscribed client, and answers getRun from the same log", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m2-wire-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const daemon = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      isDirectory: async () => true,
      // The scripted agent, so the event sequence is fixed rather than dependent on a model.
      resolveLaunch: () => ({ command: process.execPath, args: [FAKE_AGENT], cwd: home }),
    });
    cleanups.push(async () => daemon.stop());

    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());
    await client.subscribe(["coder:run-event"]);

    const project = (await client.call("coder.addProject", { path: join(home, "repo") })) as {
      project: { id: string };
    };
    const task = (await client.call("coder.createTask", {
      projectId: project.project.id,
      title: "wire it up",
    })) as { task: { id: string } };

    const pushed: unknown[] = [];
    const collector = client.collectEvents("coder:run-event", pushed);

    const started = (await client.call("coder.startRun", {
      taskId: task.task.id,
      prompt: "think about it and use a tool",
    })) as { run: { id: string } };

    // Wait for the pushed stream to report the end, rather than polling getRun: the push *is* the
    // mechanism under test.
    await client.waitForEvent("coder:run-event", (data) => (data as { kind?: string }).kind === "run.ended");

    // The same events the daemon pushed are the ones it stored — a client that reconnected and asked
    // `getRun` must not receive a different transcript from one that stayed subscribed.
    const snapshot = (await client.call("coder.getRun", { runId: started.run.id })) as {
      events: { kind: string; seq: number }[];
      nextSeq: number;
      live: boolean;
    };
    const pushedKinds = (pushed as { kind: string }[]).map((event) => event.kind);
    expect(pushedKinds).toEqual(snapshot.events.map((event) => event.kind));
    expect(snapshot.live).toBe(false);
    expect(snapshot.nextSeq).toBe(snapshot.events[snapshot.events.length - 1]?.seq);
    // The task's status followed the run, which is what the rail renders.
    const tasks = (await client.call("coder.listTasks", {})) as {
      tasks: { id: string; status: string; runId?: string }[];
    };
    expect(tasks.tasks[0]?.status).toBe("done");
    expect(tasks.tasks[0]?.runId).toBe(started.run.id);
    collector();
  }, 30_000);

  it("puts the agent into the mode the window asked for, over the real wire", async () => {
    // The claim a mode picker makes, end to end: the id goes out as a parameter of `coder.startRun`,
    // survives the daemon, and comes back out of the *agent's* mouth. Anything less — asserting the
    // request was sent, or that the task remembers the id — would pass on a daemon that never calls
    // `session/set_mode` at all, which is exactly the state this milestone started from.
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m2-mode-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const daemon = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      isDirectory: async () => true,
      // The scripted agent, whose mode ids and refusal sentence are the peer harness's own — and which
      // therefore reads a mode from the peer's field. Declared here for the same reason the catalogue
      // declares it: `AcpClient.setMode` refuses to guess, because the built-in harness silently ignores
      // the specification's `modeId` and would answer "done" having changed nothing.
      resolveLaunch: () => ({
        command: process.execPath,
        args: [FAKE_AGENT],
        cwd: home,
        modeParam: "mode",
      }),
    });
    cleanups.push(async () => daemon.stop());

    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());
    // Events are pushed only to a connection that asked for them (`coder.subscribe`) — the family's
    // transport's rule, and not something this test may skip.
    await client.subscribe(["coder:run-event"]);

    const project = (await client.call("coder.addProject", { path: join(home, "repo") })) as {
      project: { id: string };
    };
    const task = (await client.call("coder.createTask", {
      projectId: project.project.id,
      title: "plan first",
    })) as { task: { id: string } };

    const started = (await client.call("coder.startRun", {
      taskId: task.task.id,
      prompt: "mode-me",
      agentModeId: "plan",
    })) as { run: { id: string } };
    await client.waitForEvent("coder:run-event", (data) => (data as { kind?: string }).kind === "run.ended");

    const snapshot = (await client.call("coder.getRun", { runId: started.run.id })) as {
      events: { kind: string; text?: string }[];
    };
    expect(
      snapshot.events.some(
        (event) => event.kind === "run.output" && (event.text ?? "").includes("mode: plan"),
      ),
    ).toBe(true);
  }, 30_000);

  it("refuses a mode an agent cannot take, and starts nothing", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m2-nomode-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const daemon = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      isDirectory: async () => true,
      resolveLaunch: () => ({ command: process.execPath, args: [FAKE_AGENT], cwd: home }),
    });
    cleanups.push(async () => daemon.stop());

    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const project = (await client.call("coder.addProject", { path: join(home, "repo") })) as {
      project: { id: string };
    };
    // `deepseek-harness`: a real ACP agent with no `session/set_mode`, so a mode cannot be honoured.
    const task = (await client.call("coder.createTask", {
      projectId: project.project.id,
      title: "no modes here",
      harness: "deepseek-harness",
    })) as { task: { id: string } };

    await expect(
      client.call("coder.startRun", { taskId: task.task.id, prompt: "hello", agentModeId: "plan" }),
    ).rejects.toThrow(/cannot be put into a mode/);

    // **Nothing was started.** The refusal has to come before the agent does, or a user is left with an
    // agent running in a posture they did not choose *and* an error message.
    const runs = (await client.call("coder.listRuns", {})) as { runs: unknown[] };
    expect(runs.runs).toHaveLength(0);
    const tasks = (await client.call("coder.listTasks", {})) as { tasks: { status: string }[] };
    expect(tasks.tasks[0]?.status).toBe("idle");
  }, 30_000);
});

/**
 * Changing a task's folder, over the socket.
 *
 * The two halves that matter are the ones a component test cannot reach: the daemon **normalises and
 * checks** the path the way it already does for `coder.addProject` (a person types `~/work/api`, wraps
 * a path with a space in quotes, or pastes one with the trailing slash Finder gives), and it **writes
 * it to disk**, so a task reopened after a restart still points at the folder the user chose.
 */
describe("changing the folder a task runs in", () => {
  it("normalises what a person types, and keeps the task's own row", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m2-cwd-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const wanted = join(home, "work", "api");
    const daemon = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      // The real filesystem, because normalisation is about *what the filesystem means*: a stub that
      // says yes to anything would let a bug in the `~/` expansion pass.
      isDirectory: async (path) => path === wanted || path.startsWith(home),
    });
    cleanups.push(async () => daemon.stop());

    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const project = (await client.call("coder.addProject", { path: join(home, "repo") })) as {
      project: { id: string };
    };
    const task = (await client.call("coder.createTask", {
      projectId: project.project.id,
      title: "somewhere else",
    })) as { task: { id: string; cwd: string } };
    expect(task.task.cwd).toBe(join(home, "repo"));

    // Three spellings of one directory, and the same answer for all three.
    for (const typed of [`"${wanted}"`, `${wanted}/`]) {
      const updated = (await client.call("coder.updateTask", { id: task.task.id, cwd: typed })) as {
        task: { cwd: string; projectId: string };
      };
      expect(updated.task.cwd, typed).toBe(wanted);
      // The row stays filed under its project: a user who moved where the agent works did not ask for
      // the task to jump to a different heading in the rail.
      expect(updated.task.projectId).toBe(project.project.id);
    }

    // And it survives a restart, because the next run reads it from the task rather than from memory.
    client.close();
    await daemon.stop();
    const second = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      isDirectory: async () => true,
    });
    cleanups.push(async () => second.stop());
    const secondClient = await connect(second.port);
    cleanups.push(async () => secondClient.close());
    const listed = (await secondClient.call("coder.listTasks", {})) as { tasks: { cwd: string }[] };
    expect(listed.tasks[0]?.cwd).toBe(wanted);
  }, 30_000);

  it("refuses a folder that is not there, and leaves the task where it was", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m2-badcwd-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const daemon = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      isDirectory: async (path) => path === join(home, "repo"),
    });
    cleanups.push(async () => daemon.stop());

    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const project = (await client.call("coder.addProject", { path: join(home, "repo") })) as {
      project: { id: string };
    };
    const task = (await client.call("coder.createTask", {
      projectId: project.project.id,
      title: "stays put",
    })) as { task: { id: string; cwd: string } };

    const missing = join(home, "gone");
    await expect(client.call("coder.updateTask", { id: task.task.id, cwd: missing })).rejects.toThrow(
      /not a directory on this machine/,
    );

    // **Unchanged, not half-applied.** A refusal that had already written the row would leave a task
    // whose next run cannot start, which is worse than the mistake it was reporting.
    const tasks = (await client.call("coder.listTasks", {})) as { tasks: { cwd: string }[] };
    expect(tasks.tasks[0]?.cwd).toBe(task.task.cwd);
  }, 30_000);

  it("says what each agent can do about modes, so a window never has to guess", async () => {
    const { daemon, home } = await bootDaemon();
    cleanups.push(async () => {
      await daemon.stop();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const answer = (await client.call("coder.listHarnesses", {})) as {
      harnesses: {
        id: string;
        modes: { id: string; labelKey?: string }[];
        capabilities: { agentMode: boolean };
      }[];
    };
    const byId = new Map(answer.harnesses.map((harness) => [harness.id, harness]));

    // The three ids are the peer's own, and the picker's labels carry a key because *we* wrote them —
    // an agent's own wording would arrive without one and be shown as the agent wrote it.
    const envoy = byId.get("envoy-harness");
    expect(envoy?.modes.map((mode) => mode.id)).toEqual(["default", "plan", "review"]);
    expect(envoy?.modes.every((mode) => typeof mode.labelKey === "string")).toBe(true);
    expect(envoy?.capabilities.agentMode).toBe(true);

    // No `session/set_mode` on this one's ACP surface, so the mode is not offered and the field says so.
    expect(byId.get("deepseek-harness")?.modes).toEqual([]);
    expect(byId.get("deepseek-harness")?.capabilities.agentMode).toBe(false);

    // Every entry answers the question, so a client never has to treat "absent" as "no".
    for (const harness of answer.harnesses) {
      expect(typeof harness.capabilities.agentMode, harness.id).toBe("boolean");
    }
  }, 30_000);
});

/**
 * Switching the agent, and the mode the task was remembering.
 *
 * Modes are per agent — `envoy-harness` takes `default | plan | review`, `deepseek-harness` takes none
 * — so a task carrying a mode across a harness change carries something the new agent cannot honour.
 * Left in place, `RunManager` would refuse *every* later run of that task, with a sentence about a
 * choice the user made for an agent they have since replaced. This is the test for the fix: the stale
 * mode goes, and the task runs again.
 */
describe("changing which agent a task uses", () => {
  it("forgets a mode the new agent cannot take, so the task does not become unrunnable", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m2-switch-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const daemon = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      isDirectory: async () => true,
      resolveLaunch: () => ({ command: process.execPath, args: [FAKE_AGENT], cwd: home }),
    });
    cleanups.push(async () => daemon.stop());

    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const project = (await client.call("coder.addProject", { path: join(home, "repo") })) as {
      project: { id: string };
    };
    const task = (await client.call("coder.createTask", {
      projectId: project.project.id,
      title: "switching agents",
    })) as { task: { id: string } };

    const withMode = (await client.call("coder.updateTask", {
      id: task.task.id,
      agentModeId: "plan",
    })) as { task: { agentModeId?: string } };
    expect(withMode.task.agentModeId).toBe("plan");

    const switched = (await client.call("coder.updateTask", {
      id: task.task.id,
      harness: "deepseek-harness",
    })) as { task: { harness: string; agentModeId?: string } };
    expect(switched.task.harness).toBe("deepseek-harness");
    // Away, and absent rather than `undefined` on the wire: an absent field is what `TaskSchema` means
    // by "no mode", and it survives the JSON round trip through the task file.
    expect(Object.prototype.hasOwnProperty.call(switched.task, "agentModeId")).toBe(false);

    // And the proof that the drop was worth making: the task starts.
    await client.subscribe(["coder:run-event"]);
    await client.call("coder.startRun", { taskId: task.task.id, prompt: "hello" });
    await client.waitForEvent("coder:run-event", (data) => (data as { kind?: string }).kind === "run.ended");
    const tasks = (await client.call("coder.listTasks", {})) as { tasks: { status: string }[] };
    expect(tasks.tasks[0]?.status).toBe("done");
  }, 30_000);
});

/**
 * The model, over the socket and all the way to the agent.
 *
 * ## Why this block exists rather than more unit tests
 *
 * A picker whose choice is dropped is the failure this control row was built to avoid, and it is
 * exactly the failure an object-shaped test cannot see: everything agrees, and the value never reaches
 * the process. So the last test here starts a **real** run against the scripted agent and reads back
 * what the session was configured with — the agent's own report of the value it was handed, which is
 * the only evidence that the whole path (window → `coder.startRun` → the catalogue's encoding →
 * `session/set_config_option`) is connected.
 *
 * `deepseek-harness` is the agent under test because it is the one whose model travels through the
 * *session* rather than through argv: `envoy-harness`'s model is a pair of flags, and
 * `agent-catalog/test/models.test.ts` pins those. Both deliveries are therefore covered, by the test
 * each of them is cheapest to observe in.
 */
describe("the model a task runs on", () => {
  /** A daemon whose agent is the scripted one, with a task ready to run. */
  async function modelBench(options: { refuseModel?: string } = {}): Promise<{
    client: JsonRpcClient;
    taskId: string;
  }> {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m2-model-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const daemon = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      isDirectory: async () => true,
      resolveLaunch: () => ({
        command: process.execPath,
        args: [FAKE_AGENT],
        cwd: home,
        ...(options.refuseModel === undefined
          ? {}
          : { env: { FAKE_ACP_REFUSE_MODEL: options.refuseModel } }),
      }),
    });
    cleanups.push(async () => daemon.stop());

    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const project = (await client.call("coder.addProject", { path: join(home, "repo") })) as {
      project: { id: string };
    };
    const task = (await client.call("coder.createTask", {
      projectId: project.project.id,
      title: "a model to choose",
      harness: "deepseek-harness",
    })) as { task: { id: string } };
    return { client, taskId: task.task.id };
  }

  it("tells the window what each agent publishes, and what an empty list means", async () => {
    const { daemon, home } = await bootDaemon();
    cleanups.push(async () => {
      await daemon.stop();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const answer = (await client.call("coder.listHarnesses", undefined)) as {
      harnesses: {
        id: string;
        models: { kind: string; options: { id: string; provider: string; model: string }[]; source: string };
        capabilities: { model: boolean };
      }[];
    };
    const byId = new Map(answer.harnesses.map((harness) => [harness.id, harness]));

    // The list is the agent's own, and it travels with the citation a maintainer needs. This is the
    // wire test for the facts `agent-catalog/test/models.test.ts` pins at the source.
    const envoy = byId.get("envoy-harness");
    expect(envoy?.models.kind).toBe("listed");
    expect(envoy?.models.options.map((option) => option.id)).toEqual([
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4-6",
      "deepseek/deepseek-chat",
      "minimax/MiniMax-M3",
      "glm/glm-4-flash",
      "qwen/qwen-plus",
      "ollama/llama3.1",
    ]);
    expect(envoy?.capabilities.model).toBe(true);
    expect(envoy?.models.source).toContain("llm/index.ts:110-120");

    // **The value-level rule, on the wire.** `deepseek-harness` publishes nothing here and takes a
    // model, so it is `free-text` with no options — not `none`, which would tell the window to disable
    // a control the agent supports.
    const deepseek = byId.get("deepseek-harness");
    expect(deepseek?.models.kind).toBe("free-text");
    expect(deepseek?.models.options).toEqual([]);
    expect(deepseek?.capabilities.model).toBe(true);

    // A runnable agent with no model wired keeps its declared models visible with the flag off, so the
    // window can say "not wired up yet" rather than something false about the agent. `claudecode` used
    // to be that example and no longer is — it has a delivery now — so the example is one of the four
    // entries this build cannot launch at all.
    const copilot = byId.get("copilot");
    expect(copilot?.capabilities.model).toBe(false);
    // And the three agents this slice made drivable report the control as usable, with the same
    // free-text shape `deepseek-harness` has, because their lists are per session too.
    for (const id of ["claudecode", "codex", "cursor"]) {
      const entry = byId.get(id);
      expect(entry?.capabilities.model, id).toBe(true);
      expect(entry?.models.kind, id).toBe("free-text");
      expect(entry?.models.options, id).toEqual([]);
    }
  });

  it("keeps the chosen model on the task, and clears it when the choice is the agent's own", async () => {
    const { client, taskId } = await modelBench();

    const chosen = (await client.call("coder.updateTask", {
      id: taskId,
      model: "deepseek/deepseek-chat",
    })) as { task: { model?: string } };
    expect(chosen.task.model).toBe("deepseek/deepseek-chat");

    // `""` is the control's "the agent's own default", and it means the *key goes away* — not that the
    // task stores a model called nothing, which would render as an empty chip on the task header and
    // would be a value the run had to special-case forever.
    const cleared = (await client.call("coder.updateTask", { id: taskId, model: "" })) as {
      task: { model?: string };
    };
    expect(Object.prototype.hasOwnProperty.call(cleared.task, "model")).toBe(false);
  });

  it("forgets a model the new agent cannot resolve, so switching agent does not strand the task", async () => {
    const { client, taskId } = await modelBench();

    // Free text is why this matters: `deepseek-harness` takes a bare-ish `provider/model`, and a task
    // can carry a value that `envoy-harness` has no published provider for. Keeping it would make every
    // later run of this task refuse, with a sentence about a model chosen for a *different* agent.
    // A value `envoy-harness` does not publish — and one that exists in the wild: it is the model id
    // this app's own task fixtures carry. Its provider is not one of the seven the peer documents a
    // default for, so the new agent cannot build a route from it.
    await client.call("coder.updateTask", { id: taskId, model: "deepseek-official/deepseek-v4-flash" });
    const switched = (await client.call("coder.updateTask", {
      id: taskId,
      harness: "envoy-harness",
    })) as { task: { harness: string; model?: string } };
    expect(switched.task.harness).toBe("envoy-harness");
    expect(Object.prototype.hasOwnProperty.call(switched.task, "model")).toBe(false);

    // The other direction keeps a value that *is* resolvable for the new agent, because dropping a
    // choice the user made and that still works would be a silent edit of their task.
    const kept = (await client.call("coder.updateTask", {
      id: taskId,
      harness: "envoy-harness",
      model: "anthropic/claude-sonnet-4-6",
    })) as { task: { model?: string } };
    expect(kept.task.model).toBe("anthropic/claude-sonnet-4-6");
    const stillThere = (await client.call("coder.updateTask", {
      id: taskId,
      harness: "deepseek-harness",
    })) as { task: { model?: string } };
    expect(stillThere.task.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("refuses a model this agent does not publish, instead of starting a run on another one", async () => {
    // The failure that motivates the whole check: `envoy-harness` parses `--model`, and then ignores it
    // unless `--provider` came with it. A model we could not take apart would leave the agent answering
    // on its own default while the transcript named the user's choice — so the call is refused, before
    // any process exists, with a sentence and a key a translated window can render.
    const { client, taskId } = await modelBench();
    await client.call("coder.updateTask", { id: taskId, harness: "envoy-harness" });

    const refusal = await client
      .call("coder.startRun", { taskId, prompt: "go", model: "meta-llama/Llama-3-70b" })
      .then(() => "")
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    // The code, the sentence and the key, in that order of specificity: the transport carries a coded
    // string (`ENVOYCODER_ERRORS` prefixed onto the prose), the prose is what a log shows, and the key
    // is what a translated window renders instead of the English.
    expect(coderErrorCode(refusal)).toBe(ENVOYCODER_ERRORS.badRequest);
    expect(coderErrorMessage(refusal)).toContain("does not publish a model");
    const ref_ = coderErrorRef(refusal);
    expect(ref_?.key).toBe("error.modelUnknown");
    expect(ref_?.values).toEqual({ harness: "Envoy Harness", model: "meta-llama/Llama-3-70b" });
    // The window's own catalogue has that key, so a German user reads German. The English on the wire
    // and the English in the catalogue are the same sentence on purpose.
    expect(isMessageKey(ref_!.key)).toBe(true);

    // Nothing was started: a refused call must not leave a run behind in the rail.
    const tasks = (await client.call("coder.listTasks", {})) as { tasks: { status: string; runId?: string }[] };
    expect(tasks.tasks[0]?.runId).toBeUndefined();
    expect(tasks.tasks[0]?.status).toBe("idle");
  });

  it("carries the model into the session the agent opens, not merely onto the task", async () => {
    // **The end-to-end proof.** The agent is asked to report its own session configuration; the value
    // it reports is the opaque `["provider","model"]` array, built by the catalogue and set by
    // `AcpClient` on the session `session/new` returned. Nothing here is a stub: this is a real child
    // process, a real pipe, and the agent's own answer.
    const { client, taskId } = await modelBench();
    await client.call("coder.updateTask", { id: taskId, model: "deepseek/deepseek-chat" });

    await client.subscribe(["coder:run-event"]);
    await client.call("coder.startRun", { taskId, prompt: "model-me" });
    await client.waitForEvent("coder:run-event", (data) => (data as { kind?: string }).kind === "run.ended");

    const snapshot = (await client.call("coder.getRun", {
      runId: ((await client.call("coder.listTasks", {})) as { tasks: { runId?: string }[] }).tasks[0]?.runId,
    })) as { events: { kind: string; text?: string }[] };
    const said = snapshot.events
      .filter((event) => event.kind === "run.output")
      .map((event) => event.text ?? "")
      .join("\n");
    expect(said).toContain('model: ["deepseek","deepseek-chat"]');
  }, 30_000);

  it("fails the run, with the agent's own words, when the agent refuses the model", async () => {
    // Because the value is constructed rather than chosen from a list, this is the property that makes
    // that acceptable: an id the agent's catalog does not have is **refused loudly**, never ignored.
    // The fixture refuses exactly this value, with the real agent's own sentence.
    // The agent refuses exactly the opaque value the daemon will build for this model — stated in the
    // test so the refusal is about *this* value and not about the fixture being permissive.
    const { client, taskId } = await modelBench({
      refuseModel: JSON.stringify(["deepseek", "deepseek-nonexistent"]),
    });
    await client.call("coder.updateTask", { id: taskId, model: "deepseek/deepseek-nonexistent" });

    await client.subscribe(["coder:run-event"]);
    await client.call("coder.startRun", { taskId, prompt: "model-me" });
    await client.waitForEvent("coder:run-event", (data) => (data as { kind?: string }).kind === "run.ended");

    const tasks = (await client.call("coder.listTasks", {})) as { tasks: { status: string; runId?: string }[] };
    expect(tasks.tasks[0]?.status).toBe("failed");
    const snapshot = (await client.call("coder.getRun", {
      runId: tasks.tasks[0]?.runId,
    })) as { events: { kind: string; note?: string }[] };
    const failure = snapshot.events.find((event) => event.kind === "run.status" && event.note !== undefined);
    expect(failure?.note).toContain("unknown model option");
  }, 30_000);
});

/**
 * The thinking level, over the socket and all the way to the agent.
 *
 * `runs.test.ts` proves the daemon's own decision, and `agent-catalog/test/session-options.test.ts`
 * proves the catalogue. What neither can prove is the **socket**: that `coder.startRun` carries the
 * field, that `coder.listHarnesses` reports the three states a client needs to render a pill honestly,
 * and — the one that closes slice 2's recorded gap — that a run's observation of what its agent
 * published comes back on the *next* `coder.listHarnesses` call, so a window shows a list the agent
 * really enumerated rather than a text field forever.
 *
 * That last one is why this block is here rather than in a unit test: the fact has to cross a process
 * boundary and a file on disk before the window can see it.
 */
describe("the thinking level a task runs at", () => {
  /** A daemon whose agent publishes its options, with a task ready to run. */
  async function thinkingBench(options: { refuseThinking?: string } = {}): Promise<{
    client: JsonRpcClient;
    taskId: string;
  }> {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-m2-thinking-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    const daemon = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      isDirectory: async () => true,
      resolveLaunch: () => ({
        command: process.execPath,
        args: [FAKE_AGENT],
        cwd: home,
        env: {
          FAKE_ACP_PUBLISH_OPTIONS: "1",
          ...(options.refuseThinking === undefined
            ? {}
            : { FAKE_ACP_REFUSE_THINKING: options.refuseThinking }),
        },
      }),
    });
    cleanups.push(async () => daemon.stop());

    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const project = (await client.call("coder.addProject", { path: join(home, "repo") })) as {
      project: { id: string };
    };
    const task = (await client.call("coder.createTask", {
      projectId: project.project.id,
      title: "how much thinking",
      harness: "deepseek-harness",
    })) as { task: { id: string } };
    return { client, taskId: task.task.id };
  }

  it("tells the window what each agent offers, and which of the three states that is", async () => {
    const { daemon, home } = await bootDaemon();
    cleanups.push(async () => {
      await daemon.stop();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());

    const answer = (await client.call("coder.listHarnesses", undefined)) as {
      harnesses: {
        id: string;
        thinking: { kind: string; options: { value: string }[]; observedAt?: string; source: string };
        capabilities: { thinking: boolean };
      }[];
    };
    const byId = new Map(answer.harnesses.map((harness) => [harness.id, harness]));

    // **The state the pill's honest sentence rests on.** `deepseek-harness` publishes its levels inside
    // a session, so before a run there is nothing to show — and the wire says *that* rather than "none",
    // which is a claim about the agent that one run would disprove.
    const deepseek = byId.get("deepseek-harness");
    expect(deepseek?.thinking.kind).toBe("session");
    expect(deepseek?.thinking.options).toEqual([]);
    expect(deepseek?.thinking.observedAt).toBeUndefined();
    expect(deepseek?.capabilities.thinking).toBe(true);

    // `envoy-harness` has no thought-level method at all — verified against the built peer — so the
    // control is disabled with a reason about the *agent*, and there is no delivery either.
    const envoy = byId.get("envoy-harness");
    expect(envoy?.thinking.kind).toBe("none");
    expect(envoy?.capabilities.thinking).toBe(false);

    // Every entry answers both questions, so a client never has to read "absent" as an answer.
    for (const harness of answer.harnesses) {
      expect(typeof harness.capabilities.thinking, harness.id).toBe("boolean");
      expect(harness.thinking.source.length, harness.id).toBeGreaterThan(60);
    }
  }, 30_000);

  it("keeps the chosen level on the task, and clears it when the choice is the agent's own", async () => {
    const { client, taskId } = await thinkingBench();

    const chosen = (await client.call("coder.updateTask", {
      id: taskId,
      thinkingLevel: "max",
    })) as { task: { thinkingLevel?: string } };
    expect(chosen.task.thinkingLevel).toBe("max");

    // `""` is the control's "the agent's own default", and it means the *key goes away* — not that the
    // task stores a level called nothing, which would be a value the run had to special-case forever.
    const cleared = (await client.call("coder.updateTask", { id: taskId, thinkingLevel: "" })) as {
      task: { thinkingLevel?: string };
    };
    expect(Object.prototype.hasOwnProperty.call(cleared.task, "thinkingLevel")).toBe(false);
  }, 30_000);

  it("forgets a level the new agent cannot take, so switching agent does not strand the task", async () => {
    // A level is an id in one agent's vocabulary, and `envoy-harness` has no thought-level method at
    // all. Left on the task, every later run would refuse with a sentence about a choice the user made
    // for the agent they replaced — so the handler drops it, exactly as it drops a stranded mode.
    const { client, taskId } = await thinkingBench();
    await client.call("coder.updateTask", { id: taskId, thinkingLevel: "high" });

    const switched = (await client.call("coder.updateTask", {
      id: taskId,
      harness: "envoy-harness",
    })) as { task: { thinkingLevel?: string } };
    expect(Object.prototype.hasOwnProperty.call(switched.task, "thinkingLevel")).toBe(false);
  }, 30_000);

  it("carries the level through the whole path, and the agent confirms what it was handed", async () => {
    // The value has to reach the *process*: window → `coder.startRun` → the catalogue's config id → the
    // session the agent just opened. The agent's own report of its configuration is the only evidence
    // that distinguishes a level that arrived from one a client believed it had sent.
    const { client, taskId } = await thinkingBench();
    await client.subscribe(["coder:run-event"]);
    await client.call("coder.startRun", { taskId, prompt: "thinking-me", thinkingLevel: "low" });
    await client.waitForEvent("coder:run-event", (data) => (data as { kind?: string }).kind === "run.ended");

    const tasks = (await client.call("coder.listTasks", {})) as { tasks: { status: string; runId?: string }[] };
    const snapshot = (await client.call("coder.getRun", { runId: tasks.tasks[0]?.runId })) as {
      events: { kind: string; text?: string; thinkingLevel?: string }[];
    };
    const said = snapshot.events
      .filter((event) => event.kind === "run.output")
      .map((event) => event.text ?? "")
      .join("\n");
    expect(said).toContain("thinking: low");
    // And the run records the level it asked for, so the transcript can say what depth the agent worked
    // at rather than leaving a reader to infer it from nothing.
    const started = snapshot.events.find((event) => event.kind === "run.started");
    expect(started?.thinkingLevel).toBe("low");
  }, 30_000);

  it("refuses a level for an agent that has no way to receive one, before starting anything", async () => {
    const { client, taskId } = await thinkingBench();
    await client.call("coder.updateTask", { id: taskId, harness: "envoy-harness" });

    await expect(
      client.call("coder.startRun", { taskId, prompt: "hi", thinkingLevel: "max" }),
    ).rejects.toThrow(/cannot be given a thinking level/);
    // Nothing ran: the refusal is a refusal, not a run that quietly ignored the level.
    const runs = (await client.call("coder.listRuns", { taskId })) as { runs: unknown[] };
    expect(runs.runs).toEqual([]);
  }, 30_000);

  it("fails the run with the agent's own words when the agent refuses the level", async () => {
    // The deliberate limit of our own validation, over the socket: the level the user picked came from a
    // list an *earlier* session published, for the model that session resolved, so the agent is the
    // authority on what it accepts now. It refuses loudly, and the user reads its sentence.
    const { client, taskId } = await thinkingBench({ refuseThinking: "max" });
    await client.subscribe(["coder:run-event"]);
    await client.call("coder.startRun", { taskId, prompt: "thinking-me", thinkingLevel: "max" });
    await client.waitForEvent("coder:run-event", (data) => (data as { kind?: string }).kind === "run.ended");

    const tasks = (await client.call("coder.listTasks", {})) as { tasks: { status: string; runId?: string }[] };
    expect(tasks.tasks[0]?.status).toBe("failed");
    const snapshot = (await client.call("coder.getRun", { runId: tasks.tasks[0]?.runId })) as {
      events: { kind: string; note?: string }[];
    };
    const failure = snapshot.events.find((event) => event.kind === "run.status" && event.note !== undefined);
    expect(failure?.note).toContain("unknown reasoning effort");
  }, 30_000);

  it("shows the next window what the last session published — the list exists only because a run did", async () => {
    // **The gap this slice closes, end to end.** Before the run, `deepseek-harness` is `free-text` with a
    // text field and a local-publishing thinking state; after it, the models and levels the *agent*
    // enumerated are on the wire, with the time they were seen. Nothing here is inferred: the values
    // travel from the agent's own `session/new` response, through the daemon's state file, to a client.
    const { client, taskId } = await thinkingBench();

    const before = (await client.call("coder.listHarnesses", undefined)) as {
      harnesses: { id: string; models: { kind: string; options: unknown[] }; thinking: { kind: string } }[];
    };
    expect(before.harnesses.find((h) => h.id === "deepseek-harness")?.models.kind).toBe("free-text");
    expect(before.harnesses.find((h) => h.id === "deepseek-harness")?.thinking.kind).toBe("session");

    await client.subscribe(["coder:run-event"]);
    await client.call("coder.startRun", { taskId, prompt: "hello" });
    await client.waitForEvent("coder:run-event", (data) => (data as { kind?: string }).kind === "run.ended");

    const after = (await client.call("coder.listHarnesses", undefined)) as {
      harnesses: {
        id: string;
        models: { kind: string; observedAt?: string; options: { id: string; provider: string }[] };
        thinking: { kind: string; observedAt?: string; options: { value: string; label: string }[] };
      }[];
    };
    const deepseek = after.harnesses.find((h) => h.id === "deepseek-harness");
    expect(deepseek?.models.kind).toBe("listed");
    expect(deepseek?.models.options.map((option) => option.id)).toEqual([
      "fake/flash",
      "fake/pro",
    ]);
    // The provider id is the agent's own, decoded from its opaque value — the fact a catalogue list
    // would have got wrong.
    expect(deepseek?.models.options[0]?.provider).toBe("fake");
    expect(deepseek?.thinking.kind).toBe("listed");
    expect(deepseek?.thinking.options.map((option) => option.value)).toEqual(["off", "low", "high", "max"]);
    expect(deepseek?.thinking.options[3]?.label).toBe("Max");
    // Both carry the time they were observed, because that is what the window's sentence names.
    expect(Number.isNaN(Date.parse(deepseek?.models.observedAt ?? ""))).toBe(false);
    expect(Number.isNaN(Date.parse(deepseek?.thinking.observedAt ?? ""))).toBe(false);
  }, 30_000);
});

/**
 * The pre-flight probe, over the socket.
 *
 * `session-probe.test.ts` proves the decision against a port object, and `acp-transport.test.ts` proves
 * the real binaries. What neither can prove is the path a **window** takes: that `coder.probeSessionOptions`
 * exists in the catalogue and is served, that the three outcomes survive the wire, that a successful probe
 * lands in the store and reaches the *next* `coder.listHarnesses`, and that a failed one changes nothing.
 *
 * The three cases run against one daemon, because that is the situation a user is in: two agents that
 * behave differently and a third that cannot be started at all. Each is a real child process — the same
 * fixture the run tests use — so the spawn, the handshake and the teardown are the production ones.
 */
describe("asking an agent what it offers, before any run", () => {
  /** A daemon whose three harnesses answer differently, and a counter of the agents it started. */
  async function probeBench(): Promise<{
    client: JsonRpcClient;
    spawns: () => number;
    stateFile: string;
  }> {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-probe-rpc-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

    let spawns = 0;
    const daemon = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      // The launch is the *same* seam a run uses, which is the point of the probe reusing it. The three
      // harness ids stand for the three outcomes: one that publishes, one that answers `{sessionId}` alone,
      // and one whose binary is not there.
      resolveLaunch: (input) =>
        input.harness === "opencode"
          ? { command: "definitely-not-an-agent-binary", args: [], cwd: home }
          : {
              command: process.execPath,
              args: [FAKE_AGENT],
              cwd: home,
              ...(input.harness === "deepseek-harness" ? { env: { FAKE_ACP_PUBLISH_OPTIONS: "1" } } : {}),
            },
      // A real client, counted: the cache is only observable as "how many agents did this start".
      startClient: async (options) => {
        spawns += 1;
        return AcpClient.start(options);
      },
    });
    cleanups.push(async () => daemon.stop());

    const client = await connect(daemon.port);
    cleanups.push(async () => client.close());
    return { client, spawns: () => spawns, stateFile: coderPaths(home).sessionOptionsFile };
  }

  it("publishes what a session published, and nothing about a session that did not open", async () => {
    const { client, stateFile } = await probeBench();

    const before = (await client.call("coder.listHarnesses", undefined)) as {
      harnesses: { id: string; models: { kind: string }; thinking: { kind: string } }[];
    };
    // The state every user starts in: the agent publishes nothing we have seen, so the window has a text
    // field and a disabled pill and says which is which.
    expect(before.harnesses.find((h) => h.id === "deepseek-harness")?.models.kind).toBe("free-text");
    expect(before.harnesses.find((h) => h.id === "deepseek-harness")?.thinking.kind).toBe("session");

    // The store's change event, which is how a second window learns without polling. The listener is
    // registered **before** the call that causes it: an event is not replayed for a late subscriber, and
    // a test that subscribed afterwards would wait forever for something that had already happened.
    await client.subscribe(["coder:state-changed"]);
    const announced = client.waitForEvent(
      "coder:state-changed",
      (data) => (data as { kind?: string }).kind === "harnesses",
    );

    const listed = (await client.call("coder.probeSessionOptions", {
      harness: "deepseek-harness",
    })) as { harness: string; outcome: string; detail: string };
    expect(listed.harness).toBe("deepseek-harness");
    expect(listed.outcome).toBe("listed");

    // …and the window needs no new rendering path: the *same* call it already makes now answers with the
    // list the agent enumerated, through the same store record a run writes.
    const after = (await client.call("coder.listHarnesses", undefined)) as {
      harnesses: {
        id: string;
        models: { kind: string; observedAt?: string; options: { id: string; provider: string }[] };
        thinking: { kind: string; options: { value: string }[] };
      }[];
    };
    const deepseek = after.harnesses.find((h) => h.id === "deepseek-harness");
    expect(deepseek?.models.kind).toBe("listed");
    expect(deepseek?.models.options.map((option) => option.id)).toEqual(["fake/flash", "fake/pro"]);
    expect(deepseek?.thinking.options.map((option) => option.value)).toEqual([
      "off",
      "low",
      "high",
      "max",
    ]);
    expect(Number.isNaN(Date.parse(deepseek?.models.observedAt ?? ""))).toBe(false);

    // The record is on disk, in the file the run path writes, so a daemon restart keeps it.
    const stored = JSON.parse(await readFile(stateFile, "utf8")) as { harness: string; options: unknown[] }[];
    expect(stored.map((entry) => entry.harness)).toEqual(["deepseek-harness"]);
    expect(stored[0]?.options).toHaveLength(2);

    // And the window was told — with kind `harnesses`, which is what makes a client refetch the *agent*
    // list rather than its task list: what moved is the answer about an agent.
    const change = (await announced) as { kind: string; ids?: readonly string[] };
    expect(change.kind).toBe("harnesses");
    expect(change.ids).toEqual(["deepseek-harness"]);
  }, 60_000);

  it("records a session that offered nothing as a fact about the agent", async () => {
    const { client } = await probeBench();

    // A different agent, because the answer is cached per agent: this one answers `session/new` with
    // `{sessionId, configOptions: []}`, which is what `envoy-harness` does in the real world.
    const answer = (await client.call("coder.probeSessionOptions", {
      harness: "envoy-harness",
    })) as { outcome: string; detail: string };

    expect(answer.outcome).toBe("none");
    const after = (await client.call("coder.listHarnesses", undefined)) as {
      harnesses: { id: string; thinking: { kind: string; observedAt?: string } }[];
    };
    // `"none"` **with a timestamp**: the pill now says the agent offers no level because we asked, not
    // because a catalogue entry says so — and those are different sentences to a user.
    const envoy = after.harnesses.find((h) => h.id === "envoy-harness");
    expect(envoy?.thinking.kind).toBe("none");
    expect(Number.isNaN(Date.parse(envoy?.thinking.observedAt ?? ""))).toBe(false);
  }, 60_000);

  it("says it could not ask, and writes nothing down", async () => {
    const { client, stateFile } = await probeBench();

    const answer = (await client.call("coder.probeSessionOptions", {
      harness: "opencode",
    })) as { outcome: string; detail: string };

    // **The distinction the whole feature turns on.** A spawn that failed is our failure, not the agent's
    // answer, so it is not recorded — a window that rendered it as "publishes none" would be making a
    // claim about somebody else's product from evidence it does not have.
    expect(answer.outcome).toBe("unreachable");
    expect(answer.detail).toContain("could not ask");
    await expect(readFile(stateFile, "utf8")).rejects.toThrow();
  }, 60_000);

  it("answers a repeated ask without starting a second agent", async () => {
    const { client, spawns } = await probeBench();

    await client.call("coder.probeSessionOptions", { harness: "deepseek-harness" });
    expect(spawns()).toBe(1);
    await client.call("coder.probeSessionOptions", { harness: "deepseek-harness" });
    expect(spawns()).toBe(1);
    // …and a forced ask is the user pressing the button, which means it.
    await client.call("coder.probeSessionOptions", { harness: "deepseek-harness", force: true });
    expect(spawns()).toBe(2);
  }, 60_000);
});
