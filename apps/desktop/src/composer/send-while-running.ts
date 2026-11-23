/**
 * Resolve queue vs steer when the user sends while a turn is live.
 *
 * Desktop default is always **queue** (polish §2). Shift-click Send or Alt+Enter
 * flips to **steer** for one press (Shift+Enter stays a newline), **only** when
 * {@link canSteerFollowUp} is true. The stored `sendWhileRunning` preference is for
 * mobile / other clients — the window ignores it except via the same harness gate
 * in the daemon.
 */

import { canSteerFollowUp, followUpMustQueue } from "@envoydev/agent-catalog/asking"

export type SendWhileRunning = "queue" | "steer"

export { canSteerFollowUp, followUpMustQueue }

export function resolveSendWhileRunning(flip: boolean): SendWhileRunning {
  return flip ? "steer" : "queue"
}

/** Final mode after harness limits — daemon and UI both use this. */
export function resolveFollowUpMode(
  harnessId: string | undefined,
  requested: SendWhileRunning,
): SendWhileRunning {
  if (followUpMustQueue(harnessId)) return "queue"
  return requested
}
