import { describe, expect, it } from "vitest";

import {
  canTakeWorkerSlot,
  coalescePending,
  defaultWorkPolicy,
  disposeCandidate,
  effectReceiptKey,
  sortEffectsForDispatch,
  type WorkCandidate,
  type WorkEffect,
} from "../src/index.js";

const candidate = (partial: Partial<WorkCandidate> = {}): WorkCandidate => ({
  id: "C1",
  text: "Please fix the flaky test",
  strength: "explicit",
  sourceKind: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...partial,
});

describe("disposeCandidate", () => {
  it("observe records would-accept without creating", () => {
    const policy = { ...defaultWorkPolicy(), enabled: true, acceptMode: "observe" as const };
    const result = disposeCandidate({ candidate: candidate(), policy });
    expect(result.outcome).toBe("would-accept");
    expect(result.createTicket).toBe(false);
  });

  it("auto creates for explicit candidates", () => {
    const policy = { ...defaultWorkPolicy(), enabled: true, acceptMode: "auto" as const };
    const result = disposeCandidate({ candidate: candidate(), policy });
    expect(result.outcome).toBe("accept");
    expect(result.createTicket).toBe(true);
  });

  it("auto ignores inferred without assessment", () => {
    const policy = { ...defaultWorkPolicy(), enabled: true, acceptMode: "auto" as const };
    const result = disposeCandidate({
      candidate: candidate({ strength: "inferred" }),
      policy,
    });
    expect(result.createTicket).toBe(false);
  });

  it("rejects inferred candidates off the allow-list", () => {
    const policy = {
      ...defaultWorkPolicy(),
      enabled: true,
      acceptMode: "auto" as const,
      allowList: ["@trusted"],
    };
    const rejected = disposeCandidate({
      candidate: candidate({ strength: "inferred", text: "please fix something" }),
      policy,
      assessmentAccepts: true,
    });
    expect(rejected.outcome).toBe("ignore");
    expect(rejected.createTicket).toBe(false);

    const allowed = disposeCandidate({
      candidate: candidate({ strength: "inferred", text: "@trusted please fix" }),
      policy,
      assessmentAccepts: true,
    });
    expect(allowed.createTicket).toBe(true);
  });
});

describe("effects", () => {
  it("coalesces pending by receipt key", () => {
    const a: WorkEffect = {
      id: "E1",
      kind: "deliver",
      ticketId: "T1",
      payload: {},
      status: "pending",
      receiptKey: effectReceiptKey("deliver", "T1", "msg1"),
      createdAt: "a",
    };
    const b: WorkEffect = { ...a, id: "E2" };
    expect(coalescePending([a, b])).toHaveLength(1);
  });

  it("sorts human wake ahead of launch", () => {
    const launch: WorkEffect = {
      id: "E1",
      kind: "launch",
      ticketId: "T1",
      payload: {},
      status: "pending",
      createdAt: "a",
    };
    const deliver: WorkEffect = {
      id: "E2",
      kind: "deliver",
      ticketId: "T1",
      payload: {},
      status: "pending",
      createdAt: "b",
    };
    expect(sortEffectsForDispatch([launch, deliver]).map((e) => e.kind)).toEqual([
      "deliver",
      "launch",
    ]);
  });

  it("reserves a human-wake slot past the limit", () => {
    expect(canTakeWorkerSlot({ runningCount: 2, limit: 2, isHumanWake: false })).toBe(false);
    expect(canTakeWorkerSlot({ runningCount: 2, limit: 2, isHumanWake: true })).toBe(true);
  });
});
