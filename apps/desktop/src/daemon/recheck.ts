/**
 * **Looking at this machine again** — the one method whose subject is the measurement rather than an agent.
 *
 * ## The gap it closes, in the owner's words
 *
 * *"After I run `npm install -g @agentclientprotocol/codex-acp`, how do we let EnvoyDev know that without
 * restarting?"* The daemon's half of the answer was already right: `coder.listHarnesses` and
 * `coder.listCatalog` resolve every row's state from filesystem and environment reads **on the read**, with no
 * cache anywhere in the path — measured on the machine this was written on, where a bridge installed minutes
 * earlier was reported `ready`, correct binary and all, by a daemon that had never been restarted.
 *
 * What cannot be right is knowing that the answer *might* have changed. Two of the daemon's own inputs are
 * captured once per process, deliberately: the login shell's `PATH` (one shell per daemon, because the user's
 * rc files are expensive) and its `command -v` answer per program name
 * (`packages/platform/src/shell-binaries.ts` — asked once, because a toolchain manager's rc file should not run
 * on every probe). A program that installs into a directory the daemon already searches is found on the next
 * read; one that only the user's own shell can resolve — the `npx`-cache case that made `dsh` read "not
 * installed" for its own owner — stays missed until something re-asks.
 *
 * So this method re-asks, and then says so on the bus. It is the **only** new privilege it needs: no process is
 * started, no package is fetched, and the answer is not returned here — the windows re-read through
 * `coder.listHarnesses`, the one projection, exactly as they do when the boot primes land.
 *
 * ## Why it is a method rather than a timer
 *
 * A periodic re-check would spawn a login shell on a schedule nobody asked for, on a machine whose owner may be
 * running builds; and a re-check on window focus would do it every time the user alt-tabs. Both are the
 * product doing work to answer a question that was not asked. A press is a question, and the user is the only
 * one who knows that something changed — which is also why the page offers the control next to the count it
 * invalidates.
 */

import { parseRpcParams } from "@envoydev/protocol";
import type { RpcMethod } from "@envoydev/protocol";

import type { CoderHandler } from "./service.js";

export interface RecheckHandlerDeps {
  /**
   * Re-ask the machine, then emit the `harnesses` change.
   *
   * Injected rather than implemented here, because the two things it touches — the platform's login-shell
   * caches and the daemon's event bus — belong to `serve.ts`, which owns the daemon's lifecycle. A test
   * provides its own and asserts that a press reaches it, which is the property this table can have.
   */
  recheck: () => Promise<void>;
}

/** The one handler, ready to spread into the daemon's table. */
export function createRecheckHandlers(
  deps: RecheckHandlerDeps,
): Partial<Record<RpcMethod, CoderHandler>> {
  return {
    "coder.recheckAgents": async (params) => {
      parseRpcParams("coder.recheckAgents", params);
      await deps.recheck();
      return { ok: true as const };
    },
  };
}
