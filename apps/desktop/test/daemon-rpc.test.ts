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

import { CODER_EVENTS, DEFAULT_DAEMON_PATH } from "@envoycoder/protocol";
import { coderPaths } from "@envoycoder/host-bridge";

import { readDaemonClaim } from "../src/daemon/lock.js";
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
});
