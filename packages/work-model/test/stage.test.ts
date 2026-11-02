import { describe, expect, it } from "vitest";

import {
  attentionLabel,
  defaultWorkPolicy,
  needsAttention,
  ticketStage,
  type WorkTicket,
} from "../src/index.js";

function ticket(partial: Partial<WorkTicket> & Pick<WorkTicket, "id" | "title">): WorkTicket {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    shortName: "t",
    status: "open",
    mandate: {
      id: "m1",
      policyVersion: 1,
      strength: "explicit",
      scope: partial.title,
      createdAt: now,
    },
    assignments: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe("ticketStage", () => {
  it("puts ready tickets in person/review", () => {
    const t = ticket({
      id: "T1",
      title: "Fix",
      latestReport: { kind: "ready", at: "2026-01-01T01:00:00.000Z" },
      assignments: [{ id: "a1", status: "ended" }],
    });
    expect(ticketStage(t)).toBe("person/review");
    expect(needsAttention(t)).toBe(true);
    expect(attentionLabel("person/review")).toBe("Awaiting review");
  });

  it("keeps working tickets out of Attention", () => {
    const t = ticket({
      id: "T2",
      title: "Go",
      latestReport: { kind: "progress", at: "2026-01-01T01:00:00.000Z" },
      assignments: [{ id: "a1", status: "running" }],
    });
    expect(ticketStage(t)).toBe("working");
    expect(needsAttention(t)).toBe(false);
  });

  it("surfaces blocked and failed", () => {
    expect(
      ticketStage(
        ticket({
          id: "T3",
          title: "B",
          latestReport: { kind: "blocked", at: "x" },
          assignments: [{ id: "a", status: "running" }],
        }),
      ),
    ).toBe("person/blocked");
    expect(
      ticketStage(
        ticket({
          id: "T4",
          title: "F",
          latestReport: { kind: "failed", at: "x" },
          assignments: [{ id: "a", status: "ended" }],
        }),
      ),
    ).toBe("person/blocked");
  });
});

describe("defaultWorkPolicy", () => {
  it("defaults to observe with Work items off until polished", () => {
    const p = defaultWorkPolicy("t");
    expect(p.acceptMode).toBe("observe");
    expect(p.enabled).toBe(false);
    expect(p.githubPollIntervalMs).toBe(0);
  });
});
