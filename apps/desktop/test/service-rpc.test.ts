import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ServiceStatus } from "@envoydev/platform";
import { RPC_SPECS } from "@envoydev/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { coderPaths, type CoderPaths } from "@envoydev/host-bridge";

import { writeDaemonClaim } from "../src/daemon/lock.js";
import { createSupervisorHandlers } from "../src/daemon/supervisor-rpc.js";
import type { CoderCallContext } from "../src/daemon/service.js";
import type { ServiceOptions } from "../src/daemon/supervisor.js";

const running: ServiceStatus = { state: "running", pid: 42, detail: "" };

/**
 * The daemon's own life, as `supervisor-rpc.ts` merges it into every answer.
 *
 * Staged rather than left to the real ledger, because these cases are about the *service* shape: the
 * expectations below are exact, and `restartsInLastHour` is part of the service object now.
 */
const noHistory = async () => ({ restartsInLastHour: 0 });

/** What the wire answers for a running service: the supervisor's status plus the daemon's own facts. */
const runningAnswer = { service: { ...running, restartsInLastHour: 0 } };

/** The owner's own window: `session` absent is what `requireOwnerWindow` accepts. */
const owner: CoderCallContext = { session: undefined };
/** A paired phone. */
const phone: CoderCallContext = { session: { deviceId: "device-1" } };

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

function table(overrides: Parameters<typeof createSupervisorHandlers>[0] = {}) {
  const install = vi.fn(async () => running);
  const uninstall = vi.fn(async () => ({ state: "not-installed", detail: "" }) as ServiceStatus);
  const restart = vi.fn(async () => running);
  const status = vi.fn(async () => running);
  const handlers = createSupervisorHandlers({ status, install, uninstall, restart, facts: noHistory, ...overrides });
  const call = async (method: keyof typeof handlers, params: unknown, context = owner) => {
    const handler = handlers[method];
    if (!handler) throw new Error(`${method} is not served`);
    // **The dispatcher does not parse results, so this is the only place the wire shape is exercised.**
    // Parsing here is what makes `RPC_SPECS[method].result` a tested contract rather than a document: a
    // handler that returned a shape the window cannot read fails this line, not a user's Settings pane.
    return RPC_SPECS[method].result.parse(await handler(params, context));
  };
  return { call, install, uninstall, restart, status };
}

describe("the service switch on the wire", () => {
  it("answers the status question for anyone who is paired", () => {
    // Reading which machine runs a service is not a privilege; changing it is. The phone may ask.
    return expect(table().call("coder.getServiceStatus", {}, phone)).resolves.toEqual(runningAnswer);
  });

  it("lets the owner's window install, uninstall and restart", async () => {
    const { call, install, uninstall, restart } = table();
    expect(await call("coder.installService", {})).toEqual(runningAnswer);
    expect(await call("coder.uninstallService", {})).toEqual({
      service: { state: "not-installed", detail: "", restartsInLastHour: 0 },
    });
    expect(await call("coder.restartService", {})).toEqual(runningAnswer);
    expect(install).toHaveBeenCalledTimes(1);
    expect(uninstall).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("gives a paired phone the state and the owner the supervisor's own words", async () => {
    // **D.** `detail` is the whole `launchctl print` dump for a running job — the program, the argv with
    // `--home`, the log paths — and `schtasks /Query` prints "Task To Run". The log read is owner-window-only
    // for exactly that reason, so a readable status that carried the paths contradicted the policy. The state
    // is what a phone can act on; the paths are not.
    const withPaths: ServiceStatus = {
      state: "running",
      pid: 42,
      detail:
        "program = /Users/you/Library/Application Support/EnvoyMesh/runtime/0.1.0/app/node\n" +
        "arguments = { /Users/you/…/node /Users/you/…/main.mjs --home /Users/you/.envoymesh --managed-by service }",
    };
    const { call } = table({ status: async () => withPaths });

    const forPhone = await call("coder.getServiceStatus", {}, phone);
    expect(forPhone.service.state).toBe("running");
    expect(forPhone.service.detail).toBe("");
    expect(JSON.stringify(forPhone)).not.toContain("/Users/you");

    const forOwner = await call("coder.getServiceStatus", {}, owner);
    expect(forOwner.service.detail).toBe(withPaths.detail);
  });

  it("carries the daemon's own restart history beside the supervisor's answer", async () => {
    // The half a supervisor cannot give: a launchd job restarted for ever still reports "running", so the
    // count and the last deliberate stop are the daemon's own ledger, merged into the same object.
    const { call } = table({
      facts: async () => ({
        restartsInLastHour: 3,
        lastStop: { at: "2026-09-14T05:23:00.000Z", signal: "SIGTERM", exitCode: 0 },
      }),
    });
    expect(await call("coder.getServiceStatus", {})).toEqual({
      service: {
        ...running,
        restartsInLastHour: 3,
        lastStop: { at: "2026-09-14T05:23:00.000Z", signal: "SIGTERM", exitCode: 0 },
      },
    });
  });

  it("refuses a paired phone that tries to change the service, without running it", async () => {
    // The same guard the pairing family uses. A phone asking the desktop to install a background service is a
    // privilege nobody granted it, and the refusal must happen *before* the supervisor is touched.
    for (const method of ["coder.installService", "coder.uninstallService", "coder.restartService"] as const) {
      const { call, install, uninstall, restart } = table();
      await expect(call(method, {}, phone)).rejects.toThrow();
      expect(install).not.toHaveBeenCalled();
      expect(uninstall).not.toHaveBeenCalled();
      expect(restart).not.toHaveBeenCalled();
    }
  });

  it("turns a refused step into a state, not a failed call", async () => {
    // `installService` throws when a supervisor refuses a step. On the wire that is `failed` with the
    // supervisor's own words, so a client renders one shape instead of two and a switch cannot get stuck on it.
    const { call } = table({
      install: async () => {
        throw new Error("launchctl bootstrap failed (exit 1): Bootstrap failed: 5");
      },
    });
    expect(await call("coder.installService", {})).toEqual({
      service: {
        state: "failed",
        detail: "launchctl bootstrap failed (exit 1): Bootstrap failed: 5",
        restartsInLastHour: 0,
      },
    });
  });

  it("complains about a parameter it does not have, rather than ignoring it", async () => {
    const { call } = table();
    await expect(call("coder.getServiceStatus", { surprise: true })).rejects.toThrow();
  });
});

describe("the hand-over a successful install owes (C)", () => {
  /** The deferred hand-over runs a macrotask later than the handler; two ticks let it finish. */
  const settleHandOver = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("drains this daemon and asks the supervisor for its job, after the reply", async () => {
    // **The defect this pins.** B exits 0 — "already running" — and 0 is every supervisor's "stay down" code,
    // so nothing ever started the service while the app's own daemon still held the claim. The install
    // therefore hands over: the reply first (so the window reads it), then the drain, then the supervisor's
    // job is asked for once more so it starts after the claim is free.
    const shutdown = vi.fn();
    const restart = vi.fn(async (_options?: ServiceOptions) => ({ state: "installed-stopped", detail: "" }) as ServiceStatus);
    const { call } = table({ install: async () => running, restart, shutdown });

    await expect(call("coder.installService", {})).resolves.toEqual(runningAnswer);
    // The acknowledgement reaches the window before this daemon starts closing sockets.
    expect(shutdown).not.toHaveBeenCalled();
    await settleHandOver();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
    // The drain began here, so the operation it delegates to must not ask for a second stop — the daemon
    // treats a second request as "exit now", which is not what pressing Turn on means.
    expect(restart.mock.calls[0]?.[0]?.shutdown).toBeUndefined();
  });

  it("does not hand over when the supervisor refused the install", async () => {
    const shutdown = vi.fn();
    const restart = vi.fn(async () => running);
    const { call } = table({ install: async () => ({ state: "failed", detail: "Bootstrap failed: 5" }), restart, shutdown });

    await call("coder.installService", {});
    await settleHandOver();
    expect(shutdown).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it("leaves a daemon the supervisor already owns alone", async () => {
    // **Re-pressing Turn on must not stop a running service.** The daemon that answers a reinstall *is* the
    // supervisor's own process in that case, and the claim's `managedBy` is what says so.
    const home = await mkdtemp(join(tmpdir(), "envoydev-handover-"));
    homes.push(home);
    const paths = coderPaths(home);
    await mkdir(paths.stateDir, { recursive: true });
    await writeDaemonClaim(paths, {
      product: "EnvoyDev",
      instanceId: "test",
      pid: process.pid,
      host: "127.0.0.1",
      port: 4770,
      path: "/ws",
      home: paths.home,
      stateDir: paths.stateDir,
      startedAt: "2026-09-14T00:00:00.000Z",
      version: "0.1.0",
      managedBy: "service",
    });
    const shutdown = vi.fn();
    const restart = vi.fn(async () => running);
    const { call } = table({ paths, install: async () => running, restart, shutdown });

    await call("coder.installService", {});
    await settleHandOver();
    expect(shutdown).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
});

describe("which home the switch is about", () => {
  it("tells the operations the daemon's home instead of letting them default to the process's", async () => {
    // The defect this pins: the handlers built no options, so every operation fell back to `coderPaths()` — the
    // *process's* home. A daemon started with `--home` (or embedded with `{ paths }`) would then read its own
    // ledger from one home while installing, restarting or **uninstalling** a service belonging to another, and a
    // test that built this table silently ran the real supervisor on the machine hosting it.
    const paths = { home: "/tmp/daemon-home", stateDir: "/tmp/daemon-home/EnvoyDev" } as unknown as CoderPaths;
    const seen: unknown[] = [];
    const handlers = createSupervisorHandlers({
      paths,
      userHome: "/tmp/daemon-user",
      status: async (options) => {
        seen.push(options);
        return running;
      },
    });
    const built = handlers["coder.getServiceStatus"];
    if (!built) throw new Error("coder.getServiceStatus is not served");
    await built({}, owner);
    expect(seen[0]).toMatchObject({ paths, userHome: "/tmp/daemon-user" });
  });
});
