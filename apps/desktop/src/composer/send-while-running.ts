/**
 * Resolve queue vs steer when the user sends while a turn is live.
 *
 * Settings owns the default. Shift-click Send or Alt+Enter flips for one press
 * (Shift+Enter stays a newline in the composer).
 */

export type SendWhileRunning = "queue" | "steer";

export function resolveSendWhileRunning(
  setting: SendWhileRunning | undefined,
  flip: boolean,
): SendWhileRunning {
  const base: SendWhileRunning = setting === "steer" ? "steer" : "queue";
  if (!flip) return base;
  return base === "queue" ? "steer" : "queue";
}
