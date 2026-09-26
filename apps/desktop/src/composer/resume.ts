/**
 * Whether the next idle start can rejoin an earlier agent session.
 *
 * A `run.session` event with `resumable: true` is the daemon naming a session the agent will take
 * again. Without that, "Resume" would be a button that starts a fresh session and lies about it.
 * The agent's `capabilities.resume` is the other half: Cursor advertises no resume, so the control
 * stays off even when a session id appears in the transcript.
 */
import type { RunEvent } from "@envoydev/protocol";

export function canResumeRun(input: {
  running: boolean;
  resumeCapability: boolean;
  events: readonly RunEvent[];
}): boolean {
  if (input.running || !input.resumeCapability) return false;
  for (let i = input.events.length - 1; i >= 0; i -= 1) {
    const event = input.events[i];
    if (event?.kind === "run.session" && event.resumable) return true;
  }
  return false;
}
