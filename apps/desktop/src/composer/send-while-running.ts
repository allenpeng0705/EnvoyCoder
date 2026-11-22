/**
 * Resolve queue vs steer when the user sends while a turn is live.
 *
 * Desktop default is always **queue** (polish §2). Shift-click Send or Alt+Enter
 * flips to **steer** for one press (Shift+Enter stays a newline). The stored
 * `sendWhileRunning` preference is for mobile / other clients — the window ignores it.
 */

export type SendWhileRunning = "queue" | "steer";

export function resolveSendWhileRunning(flip: boolean): SendWhileRunning {
  return flip ? "steer" : "queue";
}
