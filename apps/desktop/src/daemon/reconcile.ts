/**
 * Closing the books on runs a daemon that died left open.
 *
 * A run's life is written down twice: the task row carries `status` and `runId` (so the sidebar can show "running"
 * without reading a transcript), and the transcript carries the events. A daemon that is killed mid-run — a crash,
 * a `SIGKILL`, a laptop losing power — updates neither, so the next boot finds a task that claims a live run and no
 * process behind it. Left alone, the row says "running" for ever, the human waits for something that ended, and the
 * one fact the product is trusted to state ("is my agent still working?") is wrong.
 *
 * ## Why this is a module of its own with its I/O injected
 *
 * The decision is small and the consequences are not, so the decision is testable without a daemon: give it a list
 * of tasks, a way to read one run's events and a way to write one row back, and every branch — ended, never ended,
 * never started, deliberately waiting for a human — is a unit test.
 *
 * ## Two distinctions that are easy to get wrong
 *
 * **`needs-attention` is not a live run.** It is *active* in the sense the sidebar means (`statusIsActive`) because
 * a human still owes it an answer, but its run has already ended — marking it failed on every boot would erase a
 * question somebody was about to answer.
 *
 * **An ended run is reconciled to the status it ended with**, not blanket-marked failed: the transcript knows
 * whether it finished, failed or was cancelled, and a daemon that died *after* the run finished should not turn a
 * finished run into a failure.
 */

import { isTaskStatus, type RunEvent, type TaskStatus } from "@envoydev/protocol";

/** The statuses that claim a run is *in flight right now* — as opposed to waiting for a person. */
export function claimsLiveRun(status: TaskStatus): boolean {
  return status === "queued" || status === "running";
}

/** The task row fields this pass needs, so a caller can pass any shape that has them. */
export interface ReconcilableTask {
  id: string;
  status: TaskStatus;
  runId?: string | undefined;
}

export interface ReconcileDeps {
  tasks: () => readonly ReconcilableTask[];
  /** One run's events, from its transcript. Empty when there is no transcript (`keepTranscripts: false`). */
  eventsFor: (runId: string) => Promise<readonly RunEvent[]>;
  setTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
}

/** The status a transcript says the run ended with, when it says anything at all. */
function endedStatus(events: readonly RunEvent[]): TaskStatus | undefined {
  for (const event of events) {
    if (event.kind === "run.ended" && isTaskStatus(event.status)) return event.status;
  }
  return undefined;
}

/**
 * Mark every task whose run cannot still be running, and return the run ids that were stranded.
 *
 * The returned list is what a boot report prints: a restart that interrupted three runs is something the person
 * should see, not something the daemon should quietly tidy away.
 */
export async function reconcileInterruptedRuns(deps: ReconcileDeps): Promise<string[]> {
  const stranded: string[] = [];
  for (const task of deps.tasks()) {
    if (!claimsLiveRun(task.status)) continue;
    // No run id: nothing was ever launched and the row is simply stale. Left alone deliberately — this pass exists
    // to close *runs*, and only the daemon that wrote a row knows what it meant.
    const runId = task.runId;
    if (runId === undefined || runId === "") continue;
    const events = await deps.eventsFor(runId);
    const ended = endedStatus(events);
    // The run is over and the row never learned: tell it the truth rather than a fresh failure.
    await deps.setTaskStatus(task.id, ended ?? "failed");
    if (ended === undefined) stranded.push(runId);
  }
  return stranded;
}
