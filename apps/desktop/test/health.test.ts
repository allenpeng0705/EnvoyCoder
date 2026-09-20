/**
 * The daemon's health endpoint: what a supervisor probes, and what it must not pretend to know.
 *
 * The interesting assertions here are not "the fields exist" but the two that decide whether the signal is
 * worth anything: **a blocked event loop shows up as lag** (a probe that cannot fail is a probe a supervisor
 * should not trust), and **the answer matches its own wire spec** — the half of the contract
 * `parseRpcParams` does not cover, checked here for the same reason `git-wire-shape.test.ts` checks the git
 * answers.
 *
 * @vitest-environment node
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";
import { RPC_SPECS } from "@envoydev/protocol";

import { heartbeatIsStale, heartbeatPath, readHeartbeat, startHeartbeat } from "../src/daemon/heartbeat.js";
import { createHealthHandlers, HEALTH_PROBE_MS } from "../src/daemon/health.js";
import { createCoderHandlers, type CoderHandler, type CoderInstance } from "../src/daemon/service.js";
import { CoderStore } from "../src/daemon/store.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const instance: CoderInstance = {
  instanceId: "health-test",
  version: "0.1.0",
  startedAt: new Date(Date.now() - 5_000).toISOString(),
  connectionCount: () => 2,
};

/** The handler table this module publishes, with a runtime that has one live run and one finished one. */
function handlers(options: { active?: number } = {}): Record<string, CoderHandler> {
  const active = options.active ?? 0;
  return createHealthHandlers({
    instance,
    runs: {
      list: () =>
        [
          ...Array.from({ length: active }, (_, index) => ({ id: `r${index}`, endedAt: undefined })),
          { id: "done", endedAt: new Date().toISOString() },
        ] as never,
    },
  }) as Record<string, CoderHandler>;
}

const health = (table: Record<string, CoderHandler> = handlers()): Promise<Record<string, never>> =>
  table["coder.health"]?.({}, { session: undefined }) as Promise<Record<string, never>>;

describe("coder.health", () => {
  it("answers with the facts a supervisor probes, in the shape the wire declares", async () => {
    const answer = await health(handlers({ active: 2 }));

    expect(answer).toMatchObject({
      version: "0.1.0",
      instanceId: "health-test",
      startedAt: instance.startedAt,
      pid: process.pid,
      connections: 2,
      runs: { active: 2 },
      eventLoop: { probeMs: HEALTH_PROBE_MS },
    });
    expect(answer["uptimeMs"] as unknown as number).toBeGreaterThanOrEqual(0);
    expect(answer["memory"] as unknown as { rssBytes: number }).toMatchObject({
      rssBytes: expect.any(Number),
      heapUsedBytes: expect.any(Number),
    });

    // The result spec is a document until a real answer is parsed with it.
    const parsed = RPC_SPECS["coder.health"].result.safeParse(answer);
    expect(parsed.success, JSON.stringify(parsed.success ? [] : parsed.error.issues)).toBe(true);
  });

  it("counts only runs that have not ended", async () => {
    // The finished run in the fixture is the thing being excluded: a health endpoint that counted history
    // would report "1 active" on an idle daemon forever.
    expect((await health(handlers({ active: 0 })))["runs"]).toEqual({ active: 0 });
    expect((await health(handlers({ active: 3 })))["runs"]).toEqual({ active: 3 });
  });

  it("measures a blocked event loop as lag, rather than reporting a healthy zero", async () => {
    // A probe that cannot fail is worth nothing, so this test blocks the loop *during* the probe: the timer
    // the probe is waiting on cannot fire until the block ends, and the delay is the answer.
    const table = handlers();
    setTimeout(() => {
      const until = Date.now() + 250;
      while (Date.now() < until) {
        // deliberately blocking, which is the failure this endpoint exists to expose
      }
    }, 10);

    const answer = await health(table);
    const eventLoop = answer["eventLoop"] as unknown as { lagMs: number };
    expect(eventLoop.lagMs).toBeGreaterThan(100);
  });

  it("is in the handler table a client reaches, not merely in a module", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-health-"));
    cleanups.push(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });
    const table = createCoderHandlers({
      store,
      paths,
      instance,
      mesh: () => ({ kind: "no-node", reason: "not attached in this test" }),
    }) as Record<string, CoderHandler>;

    const answer = (await table["coder.health"]?.({}, { session: undefined })) as Record<string, unknown>;
    // A daemon built without a runtime still answers — with zero runs, which is the truth for it.
    expect(answer).toMatchObject({ instanceId: "health-test", runs: { active: 0 } });
  });
});

/**
 * The heartbeat a supervisor reads: a file whose **age** is the signal.
 *
 * Tested through the filesystem rather than a mock, because the file *is* the protocol: what a probe does is read
 * it and compare the timestamp, so an in-memory fake would prove nothing. The one thing these tests cannot cover is
 * a real launchd or systemd reading it — neither exists on macOS, which is also why the design does not depend on
 * a supervisor-specific protocol.
 */
describe("the heartbeat", () => {
  /** Poll until [check] passes, so a beat arriving on a timer is not a race. */
  async function eventually(check: () => Promise<void>, timeoutMs = 1_500): Promise<void> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      try {
        await check();
        return;
      } catch (error) {
        if (Date.now() > until) throw error;
        await new Promise((done) => setTimeout(done, 10));
      }
    }
  }

  async function pathsFor(): Promise<ReturnType<typeof coderPaths>> {
    const home = await mkdtemp(join(tmpdir(), "envoydev-heartbeat-"));
    cleanups.push(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    return coderPaths(home);
  }

  it("beats on a timer, marks ready and stopping, and stops when told", async () => {
    const paths = await pathsFor();
    const beat = startHeartbeat(paths, { everyMs: 20, now: () => new Date("2026-01-01T00:00:00.000Z") });

    beat.ready();
    await eventually(async () => {
      expect((await readHeartbeat(paths))?.state).toBe("ready");
    });
    // The timer takes over: a probe that only ever saw "ready" would call a working daemon finished.
    await eventually(async () => {
      expect((await readHeartbeat(paths))?.state).toBe("beating");
    });

    beat.stopping();
    await eventually(async () => {
      expect((await readHeartbeat(paths))?.state).toBe("stopping");
    });
    // And once stopped, the file stops moving — a heartbeat that continued after the shutdown began would tell a
    // supervisor the opposite of the truth.
    const last = await readHeartbeat(paths);
    beat.stop();
    await new Promise((done) => setTimeout(done, 60));
    expect(await readHeartbeat(paths)).toEqual(last);
  });

  it("reads as nothing when absent or unreadable, and leaves the staleness policy to the caller", async () => {
    const paths = await pathsFor();
    // Absent: the normal state before a first boot, and not an error.
    expect(await readHeartbeat(paths)).toBeUndefined();
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(heartbeatPath(paths), "not json at all", "utf8");
    expect(await readHeartbeat(paths)).toBeUndefined();
    await writeFile(heartbeatPath(paths), '{"at":"2026-01-01T00:00:00.000Z"}', "utf8");
    // A beat with no pid is not a beat: half a record is not evidence.
    expect(await readHeartbeat(paths)).toBeUndefined();

    // The window is the caller's: how long is too long depends on what the daemon was asked to do.
    expect(heartbeatIsStale(1_000, 5_000)).toBe(false);
    expect(heartbeatIsStale(5_000, 5_000)).toBe(false);
    expect(heartbeatIsStale(5_001, 5_000)).toBe(true);
  });

  it("never takes the daemon down when a beat cannot be written", async () => {
    // A read-only logs directory or a full disk: the beat fails, the daemon carries on, and the *absence* of a
    // fresh beat is what tells the supervisor something is wrong.
    const paths = await pathsFor();
    const beat = startHeartbeat(paths, {
      everyMs: 10,
      write: async () => {
        throw new Error("read-only logs directory");
      },
    });
    beat.ready();
    await new Promise((done) => setTimeout(done, 40));
    beat.stop();
    // Nothing thrown, and no timer left behind (vitest fails a suite that leaves handles open).
  });
});
