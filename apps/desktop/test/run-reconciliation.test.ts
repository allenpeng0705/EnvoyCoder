import type { RunEvent, TaskStatus } from "@envoydev/protocol";
import { describe, expect, it } from "vitest";

import { claimsLiveRun, reconcileInterruptedRuns } from "../src/daemon/reconcile.js";

/** Events in the shape the pass reads: it looks at `kind` and, for an ending, at `status`. */
const event = (input: Record<string, unknown>): RunEvent => input as unknown as RunEvent;

const started = event({ kind: "run.started", runId: "run-1", taskId: "task-1", at: "2026-01-01T00:00:00.000Z", seq: 1 });
const ended = (status: TaskStatus): RunEvent =>
  event({ kind: "run.ended", runId: "run-1", taskId: "task-1", at: "2026-01-01T00:01:00.000Z", seq: 2, exitCode: 0, status });

function scenario(tasks: { id: string; status: TaskStatus; runId?: string }[], events: RunEvent[] = []) {
  const written: { taskId: string; status: TaskStatus }[] = [];
  return {
    written,
    run: () =>
      reconcileInterruptedRuns({
        tasks: () => tasks,
        eventsFor: async () => events,
        setTaskStatus: async (taskId, status) => void written.push({ taskId, status }),
      }),
  };
}

describe("closing the books on runs a dead daemon left open", () => {
  it("marks a run that never ended as failed, and reports it", async () => {
    // The daemon was killed mid-run: the transcript has a start and no end, and the row still says "running".
    const s = scenario([{ id: "task-1", status: "running", runId: "run-1" }], [started]);
    expect(await s.run()).toEqual(["run-1"]);
    expect(s.written).toEqual([{ taskId: "task-1", status: "failed" }]);
  });

  it("believes the transcript when it says the run did end, rather than inventing a failure", async () => {
    // The run finished and the daemon died before the row was updated — a daemon that dies *after* the work must
    // not turn finished work into a failure.
    const s = scenario([{ id: "task-1", status: "running", runId: "run-1" }], [started, ended("done")]);
    expect(await s.run()).toEqual([]);
    expect(s.written).toEqual([{ taskId: "task-1", status: "done" }]);
  });

  it("carries a cancelled run forward as cancelled", async () => {
    const s = scenario([{ id: "task-1", status: "running", runId: "run-1" }], [started, ended("cancelled")]);
    // A cancelled run is not stranded work: the transcript says it ended, so it is carried forward, not "failed".
    expect(await s.run()).toEqual([]);
    expect(s.written).toEqual([{ taskId: "task-1", status: "cancelled" }]);
  });

  it("leaves a task that is waiting for a person entirely alone", async () => {
    // `needs-attention` is *active* for the sidebar, but its run has ended and somebody owes it an answer. Marking
    // it failed on every boot would erase a question a person was about to answer.
    const s = scenario([{ id: "task-1", status: "needs-attention", runId: "run-1" }], [started]);
    expect(await s.run()).toEqual([]);
    expect(s.written).toEqual([]);
  });

  it("touches nothing that is not claiming a live run, and nothing with no run at all", async () => {
    const s = scenario([
      { id: "done", status: "done", runId: "run-1" },
      { id: "idle", status: "idle" },
      { id: "no-run", status: "running" },
    ]);
    expect(await s.run()).toEqual([]);
    expect(s.written).toEqual([]);
  });

  it("treats only queued and running as claims that a run is in flight", () => {
    for (const status of ["queued", "running"] as const) expect(claimsLiveRun(status)).toBe(true);
    for (const status of ["needs-attention", "idle", "done", "failed", "cancelled"] as const) {
      expect(claimsLiveRun(status)).toBe(false);
    }
  });
});
