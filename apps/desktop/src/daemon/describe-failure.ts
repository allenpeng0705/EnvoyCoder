/**
 * Turn a start-up / mid-turn failure into something a user can act on.
 *
 * The agent's own last stderr lines are the difference between "the agent failed" and "the agent
 * needs an API key", and the harness reports that second case as a JSON-RPC error whose text is
 * already good. So the rule is: keep the agent's words, and add our own only when it gave none.
 */

import { keyed } from "./messages.js";

/** Messages that tell the user nothing — replace rather than show. */
export function isUselessFailureMessage(message: string): boolean {
  const trimmed = message.trim();
  return (
    trimmed === "" ||
    trimmed === "undefined" ||
    trimmed === "null" ||
    trimmed === "Error" ||
    trimmed === "[object Object]"
  );
}

/**
 * @param stderrTail Recent agent stderr lines already joined for display (may be empty).
 */
export function describeFailure(error: unknown, stderrTail: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  const tail = stderrTail.trim();
  if (isUselessFailureMessage(trimmed)) {
    // Prefer the agent's own stderr over a generic sentence when that is all we have.
    if (tail !== "") return tail;
    return keyed("run.stop.unknown", "The agent stopped with an error.");
  }
  return tail !== "" && !trimmed.includes(tail) ? `${trimmed} (${tail})` : trimmed;
}
