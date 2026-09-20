/**
 * The portable stop: one request, over the socket a client is already using.
 *
 * ## Why this exists when there are already signals
 *
 * `SIGINT` and `SIGTERM` cover macOS and Linux, and the family's platform matrix says so plainly: `windows:
 * { signals: false }` (`@envoydev/platform`), with no equivalent for an unrelated process to send. On Windows the
 * only ways to stop a daemon the window started are a console control event (which needs a shared console — not
 * how the shell spawns it) or `taskkill`, which is a kill, not a stop: it leaves a live agent's process behind and
 * skips the drain entirely.
 *
 * So the stop that works *everywhere* is the one that goes through the same wire everything else does. It is also
 * the one an installer, a service manager or a person at a terminal can use without knowing a pid.
 *
 * ## The two things it must get right
 *
 * **Answer before stopping.** A client that asked has to read `{stopping: true}` rather than a closed socket;
 * "did it work?" is the whole question. So the hook is deferred by a tick, after the result is on its way.
 *
 * **Owner-window-only**, like minting a pairing code. A paired phone can already reach the daemon; letting it
 * *stop* the desktop's daemon would be a privilege nobody granted, and one that turns a lost phone into an outage.
 */

import { parseRpcParams, type RpcMethod } from "@envoydev/protocol";

import { requireOwnerWindow } from "./pairing.js";
import type { CoderHandler } from "./service.js";

export interface ShutdownDeps {
  /**
   * How to begin the graceful stop. Injected by the daemon's boot, which is the only place that knows how to record
   * the reason, drain the runs and exit; this module never ends the process itself.
   */
  shutdown?: () => void;
}

export function createShutdownHandlers(
  deps: ShutdownDeps = {},
): Partial<Record<RpcMethod, CoderHandler>> {
  /**
   * **No hook, no method.** Answering `{stopping: true}` with nothing behind it would be a promise this module
   * cannot keep, and the dispatcher's "not implemented in this build" is the honest answer for a daemon that cannot
   * stop. (It also means a test bench that wires no hook cannot accidentally pin the lie as intended behaviour.)
   */
  if (deps.shutdown === undefined) return {};
  const stop = deps.shutdown;
  return {
    "coder.shutdown": async (params, context) => {
      parseRpcParams("coder.shutdown", params);
      requireOwnerWindow(context, "coder.shutdown");
      // Deferred, not immediate: the result below has to reach the client before the socket starts closing.
      setTimeout(stop, 0);
      return { stopping: true as const };
    },
  };
}
