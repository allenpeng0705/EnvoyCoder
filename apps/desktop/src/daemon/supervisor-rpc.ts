/**
 * The service switch on the wire: four methods, and no new vocabulary.
 *
 * The states a client sees are **the platform package's** (`@envoydev/platform`'s `ServiceStatus`), restated once
 * in `@envoydev/protocol` so the window, the daemon and the supervisor cannot drift into three answers about one
 * machine. Everything this file does is carry the answer back and forth; the decisions are in
 * `supervisor.ts` (which payload, which log, which operations run out of process) and in the platform package
 * (which command, what the answer meant).
 *
 * ## Three decisions worth naming
 *
 * **A failed operation is a state, not a rejected call.** `installService` *throws* when a supervisor refuses a
 * step, because that is an exceptional path inside the platform module. On the wire it becomes
 * `state: "failed"` with the supervisor's own words in `detail` — the same shape as a service that is installed
 * and broken. A client then has one thing to render instead of two, and the window's switch cannot get stuck
 * showing an error toast for something a later status call would describe perfectly well.
 *
 * **Changing the service is owner-window-only**, like minting a pairing code (`pairing.ts`'s
 * `requireOwnerWindow`). A paired phone reading the status is fine and useful; a paired phone *installing a
 * service* on the desktop is a privilege nobody granted it, and this is the same guard the pairing family
 * already uses rather than a second one that could disagree.
 *
 * **A paired phone reads the state, never the supervisor's words.** `detail` is the supervisor's whole
 * definition dump for a running launchd job — the program, the argv (which carries `--home`), the log paths —
 * and `schtasks /Query` prints "Task To Run". `coder.getDaemonLog` is owner-window-only for exactly that
 * reason, so leaving this readable *and* path-bearing was the policy contradicting itself. A paired session
 * keeps the state, which is what a phone can act on, and loses `detail`; the owner's window keeps everything
 * (`docs/daemon-lifecycle.md` §11).
 *
 * ## The hand-over an install owes (C)
 *
 * The window's install is answered by *this* daemon: the app's own child (A). The supervisor then starts its
 * own process (B), which finds A's live claim, prints "already running" and exits **0** — and 0 is every
 * supervisor's "stay down" code, so B never retries. Nothing stops A, and when the window later quits the shell
 * stops it, leaving the phone with no host right after "always reachable" was switched on.
 *
 * So a successful install on an app-managed daemon hands over: this daemon drains, and the supervisor's job is
 * asked for once more so that it starts *after* the claim is free. A daemon the supervisor already owns is left
 * alone — re-pressing *Turn on* on a running service must not stop it.
 *
 * @see docs/daemon-lifecycle.md §11 — what a paired phone may read, and who may change the service.
 */

import type { ServiceStatus } from "@envoydev/platform";
import type { CoderPaths } from "@envoydev/host-bridge";
import { parseRpcParams, type DaemonServiceStatus, type RpcMethod } from "@envoydev/protocol";

import { readDaemonClaim } from "./lock.js";
import { requireOwnerWindow } from "./pairing.js";
import type { CoderCallContext, CoderHandler } from "./service.js";
import {
  daemonServiceStatus,
  installDaemonService,
  restartServiceOutOfProcess,
  uninstallServiceOutOfProcess,
  type ServiceOptions,
} from "./supervisor.js";

type Operation = (options?: ServiceOptions) => Promise<ServiceStatus>;

/**
 * The protocol's six states and the platform's are the *same* six, and this pair of totals is what makes `tsc`
 * say so.
 *
 * `service-state.ts` (the window) indexes a table by the wire state with a `satisfies` of its own, but that
 * table cannot see `@envoydev/platform`. This module is the one place that imports both, so the binding
 * belongs here: a seventh member added to either union stops one of these two annotations from compiling,
 * instead of surfacing as "cannot read properties of undefined" taking the whole Settings pane down.
 */
const PROTOCOL_STATE_OF_PLATFORM: Record<ServiceStatus["state"], DaemonServiceStatus["state"]> = {
  "not-installed": "not-installed",
  "installed-stopped": "installed-stopped",
  running: "running",
  failed: "failed",
  unsupported: "unsupported",
  unknown: "unknown",
};
const PLATFORM_STATE_OF_PROTOCOL: Record<DaemonServiceStatus["state"], ServiceStatus["state"]> = {
  "not-installed": "not-installed",
  "installed-stopped": "installed-stopped",
  running: "running",
  failed: "failed",
  unsupported: "unsupported",
  unknown: "unknown",
};
// Read, not dead: the annotations above *are* the check, and this keeps a `noUnusedLocals` pass (or a
// tidy-minded reader) from deleting the only thing binding the two unions.
void PROTOCOL_STATE_OF_PLATFORM;
void PLATFORM_STATE_OF_PROTOCOL;

/** The daemon's own life, as the ledger keeps it — the half of the answer a supervisor cannot give. */
export interface DaemonFacts {
  restartsInLastHour: number;
  lastStop?: { at: string; signal: string; exitCode?: number };
}

export interface SupervisorDeps {
  /** Injected so the table can be tested without touching a real supervisor. Defaults are the real thing. */
  status?: Operation;
  install?: Operation;
  uninstall?: Operation;
  restart?: Operation;
  /** The daemon's restart history, read from its ledger. Absent means "nothing known", which is not an error. */
  facts?: () => Promise<DaemonFacts>;
  /**
   * **Which home these operations are about**, and which OS user's home the unit file belongs to.
   *
   * Both must come from the daemon rather than defaulting inside the operations: `installDaemonService()` and its
   * siblings fall back to `coderPaths()` and `homedir()` — the *process's* answer. A daemon started with `--home`,
   * or embedded with `{ paths }`, would then read its own ledger from one home while installing, restarting or
   * **uninstalling** a service belonging to another; and a test that builds this table would run real
   * `launchctl`/`systemctl`/`schtasks` commands against the developer's machine and delete their actual unit file.
   * Both of those happened, which is why this is not optional.
   */
  paths?: CoderPaths;
  userHome?: string;
  /**
   * This daemon's own graceful stop, when it has one — the hook `coder.shutdown` and `main.mjs stop` reach.
   *
   * A restart calls it **before** the supervisor's command so live runs drain rather than being cut in half
   * (`supervisor.ts`'s `restartServiceOutOfProcess`), and an install on an app-managed daemon calls it to hand
   * over. Absent means a bench, or a daemon built with no way to stop; the switch still works, it just cannot
   * promise the drain.
   */
  shutdown?: () => void;
}

/**
 * What a **paired session** may see of a supervisor's answer.
 *
 * The state is the useful half to a phone — "is this machine serving?" — and it names nothing. `detail` is the
 * supervisor's own output, and for launchd it is the entire `launchctl print` dump (`program`, `arguments` with
 * `--home`, log paths). The owner's window keeps it: the row is where a supervisor's diagnosis is meant to be
 * read (`service-state.ts` shows it only for `failed`/`unknown`).
 */
function forCaller(service: ServiceStatus, ownerWindow: boolean): ServiceStatus {
  return ownerWindow ? service : { ...service, detail: "" };
}

/**
 * Whether **this** process is the app's own child, the only case that hands over.
 *
 * The daemon already knows, but that fact lives at the boot; the claim is the same fact written down, and
 * reading it keeps the decision beside the operations rather than adding a boot field that could disagree with
 * the file. An absent or unreadable claim reads as `app`, the same default `lock.ts` gives an absent
 * `managedBy` — and a bench with no home at all is treated as app-managed, which is what its tests need.
 */
async function daemonIsAppManaged(paths: CoderPaths | undefined): Promise<boolean> {
  if (paths === undefined) return true;
  try {
    const claim = await readDaemonClaim(paths);
    const descriptor = "descriptor" in claim ? claim.descriptor : undefined;
    return (descriptor?.managedBy ?? "app") === "app";
  } catch {
    return true;
  }
}

export function createSupervisorHandlers(
  deps: SupervisorDeps = {},
): Partial<Record<RpcMethod, CoderHandler>> {
  const operations = {
    status: deps.status ?? daemonServiceStatus,
    install: deps.install ?? installDaemonService,
    // Out of process: both of these stop the daemon they are invoked from (see `supervisor.ts`'s module doc).
    uninstall: deps.uninstall ?? uninstallServiceOutOfProcess,
    restart: deps.restart ?? restartServiceOutOfProcess,
  };

  /**
   * The daemon's own facts, never allowed to fail the answer.
   *
   * A ledger that cannot be read is "nothing known" rather than an error: the row's subject is the *service*, and
   * refusing to say whether the service is running because a log file is unreadable would be a worse answer than
   * saying it without the history.
   */
  const daemonFacts = async (): Promise<DaemonFacts> => {
    try {
      return (await deps.facts?.()) ?? { restartsInLastHour: 0 };
    } catch {
      return { restartsInLastHour: 0 };
    }
  };

  /** One shape for every answer, including the one where the supervisor refused to do anything. */
  const attempt = async (act: () => Promise<ServiceStatus>): Promise<{ service: ServiceStatus }> => {
    let service: ServiceStatus;
    try {
      service = await act();
    } catch (error) {
      service = { state: "failed", detail: error instanceof Error ? error.message : String(error) };
    }
    return { service: { ...service, ...(await daemonFacts()) } };
  };

  /** The answer on the wire, narrowed to what the caller may see. */
  const respond = (service: ServiceStatus, context: CoderCallContext): { service: ServiceStatus } => ({
    service: forCaller(service, context.session === undefined),
  });

  // Built once, so all four operations agree about the subject: the same home, the same user's unit file.
  const options: ServiceOptions = {
    ...(deps.paths ? { paths: deps.paths } : {}),
    ...(deps.userHome ? { userHome: deps.userHome } : {}),
    ...(deps.shutdown ? { shutdown: deps.shutdown } : {}),
  };

  /**
   * **C, the hand-over.** Run after a successful install, and only when it is owed.
   *
   * `installed-stopped` counts as success: launchd accepts a job and starts it asynchronously, so that is the
   * ordinary instant right after an install (`docs/daemon-lifecycle.md` §6). `failed`/`unsupported`/`unknown`
   * are not a service that can take over from anybody.
   *
   * The two calls are deferred a tick for the same reason `coder.shutdown` is: the reply has to reach the
   * window before this daemon begins closing the socket it arrived on. The supervisor command that follows is
   * the same out-of-process `service restart` a user's *Restart* press uses, so its stop-then-start semantics
   * run the job once this process is gone — the "then let the supervisor's job start" half of the decision.
   * `shutdown` is cleared from the copy the operation receives: this call already began the drain, and the
   * daemon's own stop treats a second request as "I know — exit now", which is not what an install means.
   */
  const handOverAfterInstall = (service: ServiceStatus): void => {
    if (service.state !== "running" && service.state !== "installed-stopped") return;
    if (options.shutdown === undefined) return;
    setTimeout(() => {
      void (async () => {
        if (!(await daemonIsAppManaged(options.paths))) return;
        options.shutdown?.();
        await operations
          .restart({ ...options, shutdown: undefined })
          .catch(() => undefined);
      })();
    }, 0);
  };

  /** Every handler parses its (empty) params: a client that sends a typo hears about it here. */
  const handler =
    (
      method: RpcMethod,
      act: () => Promise<ServiceStatus>,
      ownerOnly: boolean,
      after?: (service: ServiceStatus) => void,
    ): CoderHandler =>
    async (params: unknown, context: CoderCallContext) => {
      parseRpcParams(method, params);
      if (ownerOnly) requireOwnerWindow(context, method);
      const { service } = await attempt(act);
      after?.(service);
      return respond(service, context);
    };

  return {
    "coder.getServiceStatus": handler("coder.getServiceStatus", () => operations.status(options), false),
    "coder.installService": handler(
      "coder.installService",
      () => operations.install(options),
      true,
      handOverAfterInstall,
    ),
    "coder.uninstallService": handler("coder.uninstallService", () => operations.uninstall(options), true),
    "coder.restartService": handler("coder.restartService", () => operations.restart(options), true),
  };
}
