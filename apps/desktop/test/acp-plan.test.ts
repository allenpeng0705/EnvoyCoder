import { describe, expect, it } from "vitest";

import { parseAcpPlanUpdate } from "../src/daemon/acp-plan.js";

describe("parseAcpPlanUpdate", () => {
  it("parses v2 items plan_update", () => {
    const parsed = parseAcpPlanUpdate({
      sessionUpdate: "plan_update",
      plan: {
        type: "items",
        planId: "sess-1",
        entries: [
          { content: "Fix tests", priority: "high", status: "in_progress" },
          { content: "Ship", status: "pending" },
        ],
      },
    });
    expect(parsed).toEqual({
      planId: "sess-1",
      entries: [
        { content: "Fix tests", priority: "high", status: "in_progress" },
        { content: "Ship", status: "pending" },
      ],
    });
  });

  it("keeps an empty checklist without removing the row", () => {
    expect(
      parseAcpPlanUpdate({
        sessionUpdate: "plan_update",
        plan: { type: "items", planId: "p", entries: [] },
      }),
    ).toEqual({ planId: "p", entries: [] });
    expect(
      parseAcpPlanUpdate({
        sessionUpdate: "plan_update",
        plan: { type: "items", planId: "p" },
      }),
    ).toEqual({ planId: "p", entries: [] });
  });

  it("parses plan_removed", () => {
    expect(
      parseAcpPlanUpdate({
        sessionUpdate: "plan_removed",
        plan: { planId: "p" },
      }),
    ).toEqual({ planId: "p", entries: [], removed: true });
  });

  it("forwards stable entry ids", () => {
    expect(
      parseAcpPlanUpdate({
        sessionUpdate: "plan_update",
        plan: {
          type: "items",
          planId: "p",
          entries: [{ id: "todo-1", content: "A", status: "pending" }],
        },
      }),
    ).toEqual({
      planId: "p",
      entries: [{ id: "todo-1", content: "A", status: "pending" }],
    });
  });

  it("parses markdown plans", () => {
    expect(
      parseAcpPlanUpdate({
        sessionUpdate: "plan_update",
        plan: { type: "markdown", id: "md-1", content: "# Hello" },
      }),
    ).toEqual({ planId: "md-1", entries: [], markdown: "# Hello" });
  });

  it("ignores file plans and garbage", () => {
    expect(
      parseAcpPlanUpdate({
        sessionUpdate: "plan_update",
        plan: { type: "file", planId: "f", uri: "file:///x" },
      }),
    ).toBeUndefined();
    expect(parseAcpPlanUpdate({ sessionUpdate: "agent_message_chunk" })).toBeUndefined();
  });
});
