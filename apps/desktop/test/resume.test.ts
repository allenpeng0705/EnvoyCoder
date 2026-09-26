/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "@envoydev/protocol";

import { canResumeRun } from "../src/composer/resume.js";

function session(resumable: boolean, seq = 1): RunEvent {
  return {
    kind: "run.session",
    seq,
    at: "2026-01-01T00:00:00.000Z",
    runId: "r1",
    sessionId: "s1",
    resumable,
    resumed: false,
  };
}

describe("canResumeRun", () => {
  it("is false while a turn is live, even with a resumable session in the log", () => {
    expect(
      canResumeRun({
        running: true,
        resumeCapability: true,
        events: [session(true)],
      }),
    ).toBe(false);
  });

  it("is false when the agent does not advertise resume", () => {
    expect(
      canResumeRun({
        running: false,
        resumeCapability: false,
        events: [session(true)],
      }),
    ).toBe(false);
  });

  it("is false when the transcript never named a resumable session", () => {
    expect(
      canResumeRun({
        running: false,
        resumeCapability: true,
        events: [session(false)],
      }),
    ).toBe(false);
  });

  it("is true when idle, the agent can resume, and a resumable session is in the events", () => {
    expect(
      canResumeRun({
        running: false,
        resumeCapability: true,
        events: [session(true)],
      }),
    ).toBe(true);
  });
});
