/**
 * Empty / useless agent errors must not become the only line a user sees.
 */

import { describe, expect, it } from "vitest";

import { describeFailure, isUselessFailureMessage } from "../src/daemon/describe-failure.js";
import { noticeOf } from "../src/i18n/notice.js";

describe("isUselessFailureMessage", () => {
  it("rejects empty and placeholder strings", () => {
    expect(isUselessFailureMessage("")).toBe(true);
    expect(isUselessFailureMessage("   ")).toBe(true);
    expect(isUselessFailureMessage("undefined")).toBe(true);
    expect(isUselessFailureMessage("null")).toBe(true);
    expect(isUselessFailureMessage("Error")).toBe(true);
    expect(isUselessFailureMessage("[object Object]")).toBe(true);
  });

  it("keeps real agent wording", () => {
    expect(isUselessFailureMessage("Missing API key")).toBe(false);
  });
});

describe("describeFailure", () => {
  it("prefers stderr when the thrown message is empty", () => {
    expect(describeFailure(new Error(""), "needs an API key")).toBe("needs an API key");
  });

  it("uses a keyed fallback when there is no message and no stderr", () => {
    const note = describeFailure(new Error(""), "");
    const notice = noticeOf(note);
    expect(notice?.key).toBe("run.stop.unknown");
    expect(notice?.message).toContain("stopped with an error");
  });

  it("keeps a real message and appends stderr when useful", () => {
    expect(describeFailure(new Error("boom"), "tail")).toBe("boom (tail)");
    expect(describeFailure(new Error("boom with tail"), "tail")).toBe("boom with tail");
  });
});
