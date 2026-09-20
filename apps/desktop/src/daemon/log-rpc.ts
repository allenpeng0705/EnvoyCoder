/**
 * The daemon's log, as much of it as a window needs to see why something went wrong.
 *
 * **Owner-window-only**, and deliberately: a daemon log carries absolute paths, prompts and command lines — the
 * shape of somebody's work. A paired phone may ask *whether* this machine is serving; reading what it has been
 * doing is a different privilege, and one nobody granted it when they scanned a pairing code.
 */

import { parseRpcParams, type RpcMethod } from "@envoydev/protocol";

import type { LogTail } from "./log-tail.js";
import { requireOwnerWindow } from "./pairing.js";
import type { CoderHandler } from "./service.js";

export interface LogDeps {
  /** Injected by the daemon, which is what knows where its own logs are. Absent means "nothing to show". */
  read?: () => Promise<LogTail>;
}

export function createLogHandlers(deps: LogDeps = {}): Partial<Record<RpcMethod, CoderHandler>> {
  return {
    "coder.getDaemonLog": async (params, context) => {
      parseRpcParams("coder.getDaemonLog", params);
      requireOwnerWindow(context, "coder.getDaemonLog");
      const log = (await deps.read?.()) ?? { path: "", lines: [], truncated: false };
      return { log };
    },
  };
}
