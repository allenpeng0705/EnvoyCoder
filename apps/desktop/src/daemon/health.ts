/**
 * The daemon's own health — the one method a supervisor can call.
 *
 * ## Why this is separate from `coder.hello`
 *
 * `coder.hello` answers *who* is listening: product, version, `instanceId`, home, methods, mesh. That is
 * identity, and identity is what a window needs before it trusts a socket. It is not liveness: a daemon whose
 * event loop is blocked, whose heap has run away, or which is about to be killed by the OS answers `hello`
 * just as well as a healthy one — if it answers at all.
 *
 * So this module answers the other question, and only that one: **can this process still do work, and how much
 * is it carrying?** It exists because the daemon is expected to run for weeks (`docs/daemon-lifecycle.md`), and
 * "it is up" is not something the process can be trusted to say about itself. The probe is designed to be
 * called from *outside* — by a launchd/systemd scheduler, a Windows task, or the window's service page — which
 * is the only way a wedged process is ever noticed.
 *
 * ## Why the probe is a timer and not a counter
 *
 * The tempting implementation is a histogram enabled at boot (`perf_hooks.monitorEventLoopDelay`); it costs a
 * little on every tick and answers a slightly different question ("how delayed were recent timers"). The probe
 * here asks the question a supervisor actually cares about — **if I hand this process a trivial callback now,
 * how long until it runs?** — because that is exactly what an RPC is. It needs no boot-time state, no timer
 * left running for weeks, and it cannot drift: a blocked loop delays the callback, and the delay *is* the
 * answer.
 *
 * The honest limit is worth stating: a probe scheduled at the same instant as a block still fires late, so
 * this catches a loop that is blocked *when it is asked*. A process that is wedged permanently will not answer
 * at all, which is the supervisor's other signal (a timeout), and the two together are what a watchdog needs.
 */

import { parseRpcParams, type RpcMethod } from "@envoydev/protocol";

import type { RunManager } from "./runs.js";
import type { CoderHandler, CoderInstance } from "./service.js";

/**
 * How long the probe waits before deciding the process is late.
 *
 * 50ms is a compromise: long enough that an idle machine does not report noise as lag, short enough that a
 * supervisor polling every 30 seconds does not accumulate waiting. A daemon that needed *more* than 50ms to
 * run a timer would already be failing its own RPC deadlines.
 */
export const HEALTH_PROBE_MS = 50;

export interface HealthDeps {
  /**
   * The instance facts `coder.hello` also carries — reused rather than re-measured, so the two answers cannot
   * disagree about the process they are both describing.
   */
  instance: Pick<CoderInstance, "instanceId" | "version" | "startedAt" | "connectionCount">;
  /** The runs, when this daemon has a runtime at all. Absent means one that cannot run anything. */
  runs?: Pick<RunManager, "list"> & { lastEventAt?: RunManager["lastEventAt"] };
}

/** How late a trivial timer fired. Never negative: a clock that stepped backwards is not "early work". */
async function eventLoopLagMs(probeMs: number): Promise<number> {
  const askedAt = Date.now();
  await new Promise((done) => setTimeout(done, probeMs));
  return Math.max(0, Date.now() - askedAt - probeMs);
}

/** One handler table, ready to spread into the daemon's. */
export function createHealthHandlers(deps: HealthDeps): Partial<Record<RpcMethod, CoderHandler>> {
  return {
    "coder.health": async (params) => {
      // No parameters, but parsed anyway: a client that sends a typo should hear about it here rather than
      // silently succeed against a schema nothing checked.
      parseRpcParams("coder.health", params);

      const lagMs = await eventLoopLagMs(HEALTH_PROBE_MS);
      const memory = process.memoryUsage();
      // `endedAt` is the fact that says a run is over; `status` is what the *task* row shows and can lag it.
      const active = (deps.runs?.list() ?? []).filter((run) => run.endedAt === undefined);

      return {
        version: deps.instance.version,
        instanceId: deps.instance.instanceId,
        startedAt: deps.instance.startedAt,
        // The process's own uptime, not the age of the stored `startedAt`: after a clock step, or a state file
        // written by an earlier boot, those two disagree and this one is the one about *this* process.
        uptimeMs: Math.round(process.uptime() * 1000),
        pid: process.pid,
        connections: deps.instance.connectionCount(),
        // The staleness signal, and the reason `active` alone is not one: a run that has produced nothing for
        // an hour is the failure a supervisor exists to catch, and it is invisible in a count.
        runs: {
          active: active.length,
          ...(deps.runs?.lastEventAt?.() !== undefined ? { lastEventAt: deps.runs.lastEventAt() } : {}),
        },
        memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
        eventLoop: { probeMs: HEALTH_PROBE_MS, lagMs },
      };
    },
  };
}
