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

describe("what the pass must survive", () => {
  it("keeps going when one transcript cannot be read, instead of stopping the daemon from serving", async () => {
    // `readTranscript` forgives a missing file and nothing else, and this runs during boot: a permission error or a
    // directory wearing the run's name would otherwise take the whole daemon down over one old transcript.
    const written: { taskId: string; status: TaskStatus }[] = [];
    const stranded = await reconcileInterruptedRuns({
      tasks: () => [
        { id: "broken", status: "running", runId: "run-broken" },
        { id: "fine", status: "running", runId: "run-fine" },
      ],
      eventsFor: async (runId) => {
        if (runId === "run-broken") throw new Error("EACCES: permission denied, open '/state/run-broken.jsonl'");
        return [started];
      },
      setTaskStatus: async (taskId, status) => void written.push({ taskId, status }),
    });
    // Both rows were dealt with: the unreadable one failed (a claim we cannot substantiate is still wrong) and the
    // readable one was reconciled as usual.
    expect(stranded).toEqual(["run-broken", "run-fine"]);
    expect(written).toEqual([
      { taskId: "broken", status: "failed" },
      { taskId: "fine", status: "failed" },
    ]);
  });

  it("keeps going when the store refuses the write as well", async () => {
    // Both ends failing is the worst case, and it must still not throw out of boot.
    const stranded = await reconcileInterruptedRuns({
      tasks: () => [{ id: "task-1", status: "running", runId: "run-1" }],
      eventsFor: async () => {
        throw new Error("EIO");
      },
      setTaskStatus: async () => {
        throw new Error("ENOSPC: no space left on device");
      },
    });
    expect(stranded).toEqual(["run-1"]);
  });

  it("refuses an ending that belongs to another task, rather than marking the wrong row", async () => {
    // A row whose `runId` points at another task's run is corrupt. Believing the ending would give this task
    // another task's outcome while the real owner kept claiming "running" for ever — so it is failed, visibly.
    const written: { taskId: string; status: TaskStatus }[] = [];
    const stranded = await reconcileInterruptedRuns({
      tasks: () => [{ id: "task-1", status: "running", runId: "run-1" }],
      eventsFor: async () => [
        event({ kind: "run.started", runId: "run-1", taskId: "task-2", at: "2026-01-01T00:00:00.000Z", seq: 1 }),
        event({
          kind: "run.ended",
          runId: "run-1",
          taskId: "task-2",
          at: "2026-01-01T00:01:00.000Z",
          seq: 2,
          exitCode: 0,
          status: "done",
        }),
      ],
      setTaskStatus: async (taskId, status) => void written.push({ taskId, status }),
    });
    expect(stranded).toEqual(["run-1"]);
    expect(written).toEqual([{ taskId: "task-1", status: "failed" }]);
  });
});
