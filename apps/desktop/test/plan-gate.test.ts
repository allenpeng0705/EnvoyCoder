import { describe, expect, it } from "vitest";

import {
  isPlanReviewApproveChoice,
  isPlanReviewAsk,
  looksLikeBigTask,
  planReviewOptionLabel,
  shouldAutoPlanFirst,
  stripPlanFirstFraming,
  withPlanFirstFraming,
} from "../src/composer/plan-gate.js";

describe("looksLikeBigTask", () => {
  it("ignores ordinary short asks", () => {
    expect(looksLikeBigTask("Fix the typo in README", 0)).toBe(false);
    expect(looksLikeBigTask("Add a unit test for parseDate", 0)).toBe(false);
    expect(looksLikeBigTask("What does this function do?", 0)).toBe(false);
  });

  it("does not fire on bare architecture / end-to-end questions", () => {
    expect(looksLikeBigTask("What's the architecture of this module?", 0)).toBe(false);
    expect(looksLikeBigTask("Is this end-to-end tested?", 0)).toBe(false);
  });

  it("fires on strong whole-system wording", () => {
    expect(looksLikeBigTask("Refactor the entire architecture of this codebase", 0)).toBe(true);
    expect(looksLikeBigTask("Investigate this repo end to end", 0)).toBe(true);
    expect(looksLikeBigTask("Audit the whole codebase for auth bugs", 0)).toBe(true);
  });

  it("fires on length alone only when very long", () => {
    expect(looksLikeBigTask("x".repeat(400), 0)).toBe(false);
    expect(looksLikeBigTask("x".repeat(800), 0)).toBe(true);
  });

  it("combines medium length with weak cues or attachments", () => {
    expect(looksLikeBigTask(`Please refactor this module. ${"y".repeat(400)}`, 0)).toBe(true);
    expect(looksLikeBigTask("x".repeat(400), 2)).toBe(true);
    expect(looksLikeBigTask("short", 3)).toBe(true);
  });
});

describe("shouldAutoPlanFirst", () => {
  const base = {
    prompt: "Refactor the entire architecture of this codebase",
    attachmentCount: 0,
    planMode: false,
    planCapable: true,
    running: false,
  };

  it("auto-plans only when idle, capable, and not already planning", () => {
    expect(shouldAutoPlanFirst(base)).toBe(true);
    expect(shouldAutoPlanFirst({ ...base, running: true })).toBe(false);
    expect(shouldAutoPlanFirst({ ...base, planCapable: false })).toBe(false);
    expect(shouldAutoPlanFirst({ ...base, planMode: true })).toBe(false);
    expect(shouldAutoPlanFirst({ ...base, prompt: "fix a typo" })).toBe(false);
  });
});

describe("withPlanFirstFraming / stripPlanFirstFraming", () => {
  it("prefixes once and strips back to the user words", () => {
    const framed = withPlanFirstFraming("Do the big thing");
    expect(framed).toContain("[Plan carefully");
    expect(framed).toContain("Do the big thing");
    expect(withPlanFirstFraming(framed)).toBe(framed);
    expect(stripPlanFirstFraming(framed)).toBe("Do the big thing");
    expect(stripPlanFirstFraming("plain")).toBe("plain");
  });
});

describe("isPlanReviewAsk", () => {
  it("detects exit_plan_mode style questions", () => {
    expect(isPlanReviewAsk("Approve this plan and leave plan mode?")).toBe(true);
    expect(isPlanReviewAsk("Implement this plan?", "# Phase 1\n\nDo work")).toBe(true);
    expect(isPlanReviewAsk("Which file?", "a or b")).toBe(false);
  });
});

describe("planReviewOptionLabel / isPlanReviewApproveChoice", () => {
  it("prefers wording over index", () => {
    expect(
      planReviewOptionLabel("Reject", 0, { implement: "Implement plan", revise: "Keep planning" }),
    ).toBe("Keep planning");
    expect(
      planReviewOptionLabel("Approve plan and continue", 1, {
        implement: "Implement plan",
        revise: "Keep planning",
      }),
    ).toBe("Implement plan");
  });

  it("detects approve by label", () => {
    const options = [
      { id: "0", label: "Reject" },
      { id: "1", label: "Approve plan and continue" },
    ];
    expect(isPlanReviewApproveChoice("1", options)).toBe(true);
    expect(isPlanReviewApproveChoice("0", options)).toBe(false);
  });
});
