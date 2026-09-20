/**
 * The service switch on the wire: four methods, and no new vocabulary.
 *
 * The states a client sees are **the platform package's** (`@envoydev/platform`'s `ServiceStatus`), restated once
 * in `@envoydev/protocol` so the window, the daemon and the supervisor cannot drift into three answers about one
 * machine. Everything this file does is carry the answer back and forth; the decisions are in
 * `supervisor.ts` (which payload, which log) and in the platform package (which command, what the answer meant).
 *
 * ## Two decisions worth naming
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
 */

import type { ServiceStatus } from "@envoydev/platform";
import { parseRpcParams, type RpcMethod } from "@envoydev/protocol";

import { requireOwnerWindow } from "./pairing.js";
import type { CoderCallContext, CoderHandler } from "./service.js";
import {
  daemonServiceStatus,
  installDaemonService,
  restartDaemonService,
  uninstallDaemonService,
  type ServiceOptions,
} from "./supervisor.js";

type Operation = (options?: ServiceOptions) => Promise<ServiceStatus>;

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
}

export function createSupervisorHandlers(
  deps: SupervisorDeps = {},
): Partial<Record<RpcMethod, CoderHandler>> {
  const operations = {
    status: deps.status ?? daemonServiceStatus,
    install: deps.install ?? installDaemonService,
    uninstall: deps.uninstall ?? uninstallDaemonService,
    restart: deps.restart ?? restartDaemonService,
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

  /** Every handler parses its (empty) params: a client that sends a typo hears about it here. */
  const handler =
    (method: RpcMethod, act: () => Promise<ServiceStatus>, ownerOnly: boolean): CoderHandler =>
    async (params: unknown, context: CoderCallContext) => {
      parseRpcParams(method, params);
      if (ownerOnly) requireOwnerWindow(context, method);
      return attempt(act);
    };

  return {
    "coder.getServiceStatus": handler("coder.getServiceStatus", () => operations.status(), false),
    "coder.installService": handler("coder.installService", () => operations.install(), true),
    "coder.uninstallService": handler("coder.uninstallService", () => operations.uninstall(), true),
    "coder.restartService": handler("coder.restartService", () => operations.restart(), true),
  };
}
