import type { ServiceStatus } from "@envoydev/platform";
import { describe, expect, it, vi } from "vitest";

import { createSupervisorHandlers } from "../src/daemon/supervisor-rpc.js";
import type { CoderCallContext } from "../src/daemon/service.js";

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

function table(overrides: Parameters<typeof createSupervisorHandlers>[0] = {}) {
  const install = vi.fn(async () => running);
  const uninstall = vi.fn(async () => ({ state: "not-installed", detail: "" }) as ServiceStatus);
  const restart = vi.fn(async () => running);
  const status = vi.fn(async () => running);
  const handlers = createSupervisorHandlers({ status, install, uninstall, restart, facts: noHistory, ...overrides });
  const call = async (method: keyof typeof handlers, params: unknown, context = owner) => {
    const handler = handlers[method];
    if (!handler) throw new Error(`${method} is not served`);
    return handler(params, context);
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
