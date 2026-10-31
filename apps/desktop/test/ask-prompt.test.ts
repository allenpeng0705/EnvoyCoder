import { describe, expect, it } from "vitest";

import { splitAskPrompt } from "../src/daemon/ask-prompt.js";

describe("splitAskPrompt", () => {
  it("leaves a short prompt as the question alone", () => {
    expect(splitAskPrompt("Which files?")).toEqual({ question: "Which files?" });
  });

  it("splits a plan review lead-in from a markdown heading body", () => {
    const prompt =
      'Plan review Approve this plan and leave plan mode? # Veda — "Make the memory work"\n\n## Phase 0\n- Fix tests';
    const split = splitAskPrompt(prompt);
    expect(split.question).toBe("Plan review Approve this plan and leave plan mode?");
    expect(split.body).toContain("# Veda");
    expect(split.body).toContain("## Phase 0");
    expect(split.kind).toBe("plan-review");
  });

  it("splits on the first blank-line paragraph when the lead-in is short", () => {
    const split = splitAskPrompt("Approve the plan?\n\n## Phase 1\n\nDo the work.");
    expect(split.question).toBe("Approve the plan?");
    expect(split.body).toContain("## Phase 1");
    expect(split.kind).toBe("plan-review");
  });

  it("tags remapped Implement wording as plan-review too", () => {
    const split = splitAskPrompt("Implement this plan?\n\n# Title\n\n## Phase 0\n\n- Do work");
    expect(split.kind).toBe("plan-review");
  });

  it("uses the first short line when the remainder is long", () => {
    const body = "A".repeat(100);
    const split = splitAskPrompt(`Pick a direction\n${body}`);
    expect(split.question).toBe("Pick a direction");
    expect(split.body).toBe(body);
  });

  it("puts a single huge blob in the body and leaves the question empty", () => {
    const blob = `Start ${"x".repeat(300)}`;
    expect(splitAskPrompt(blob)).toEqual({ question: "", body: blob });
  });
});
