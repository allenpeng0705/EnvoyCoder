/**
 * Steps segments keep thoughts, tools, and interim narration out of the open transcript.
 */

import { describe, expect, it } from "vitest";

import {
  heroAssistantIds,
  segmentTranscriptSteps,
} from "../src/state/transcript-steps.js";
import type { TranscriptEntry } from "../src/state/transcript.js";

describe("segmentTranscriptSteps", () => {
  it("wraps consecutive thought and tool rows, leaves final assistant outside", () => {
    const entries: TranscriptEntry[] = [
      { kind: "user", id: "u1", text: "hi", mode: "queue", delivered: "queued" },
      { kind: "thought", id: "th1", text: "thinking…" },
      {
        kind: "tool",
        id: "t1",
        callId: "c1",
        name: "Read",
        status: "completed",
        input: { path: "a.ts" },
      },
      { kind: "assistant", id: "a1", text: "done" },
    ];
    const items = segmentTranscriptSteps(entries);
    expect(items.map((item) => item.kind)).toEqual(["user", "steps", "assistant"]);
    const steps = items[1]!;
    expect(steps.kind).toBe("steps");
    if (steps.kind !== "steps") return;
    expect(steps.live).toBe(false);
    expect(steps.entries).toHaveLength(2);
    expect(steps.counts.searched).toBe(1);
  });

  it("folds interim assistant narration into Steps before the final answer", () => {
    const entries: TranscriptEntry[] = [
      { kind: "user", id: "u1", text: "hi", mode: "queue", delivered: "queued" },
      {
        kind: "tool",
        id: "t1",
        callId: "c1",
        name: "Read",
        status: "completed",
      },
      { kind: "assistant", id: "a-interim", text: "looking…" },
      {
        kind: "tool",
        id: "t2",
        callId: "c2",
        name: "Edit",
        status: "completed",
      },
      { kind: "assistant", id: "a-final", text: "fixed" },
    ];
    const items = segmentTranscriptSteps(entries);
    expect(items.map((item) => item.kind)).toEqual(["user", "steps", "assistant"]);
    const steps = items[1]!;
    if (steps.kind !== "steps") return;
    expect(steps.entries.map((e) => e.id)).toEqual(["t1", "a-interim", "t2"]);
    expect(items[2]).toMatchObject({ kind: "assistant", id: "a-final" });
  });

  it("keeps mid-turn narration in Steps when tools still follow", () => {
    const entries: TranscriptEntry[] = [
      { kind: "user", id: "u1", text: "hi", mode: "queue", delivered: "queued" },
      { kind: "assistant", id: "a-early", text: "looking…" },
      {
        kind: "tool",
        id: "t1",
        callId: "c1",
        name: "Read",
        status: "running",
      },
    ];
    const items = segmentTranscriptSteps(entries);
    expect(items.map((item) => item.kind)).toEqual(["user", "steps"]);
    const steps = items[1]!;
    if (steps.kind !== "steps") return;
    expect(steps.entries.map((e) => e.id)).toEqual(["a-early", "t1"]);
    expect(steps.live).toBe(true);
  });

  it("marks a segment live while a tool is running", () => {
    const entries: TranscriptEntry[] = [
      {
        kind: "tool",
        id: "t1",
        callId: "c1",
        name: "Bash",
        status: "running",
        input: { command: "npm test" },
      },
    ];
    const items = segmentTranscriptSteps(entries);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("steps");
    if (items[0]!.kind !== "steps") return;
    expect(items[0]!.live).toBe(true);
  });

  it("marks thought-only Steps live while the run is open", () => {
    const entries: TranscriptEntry[] = [
      { kind: "user", id: "u1", text: "hi", mode: "queue", delivered: "queued" },
      { kind: "thought", id: "th1", text: "planning…" },
    ];
    const idle = segmentTranscriptSteps(entries);
    expect(idle.map((item) => item.kind)).toEqual(["user", "steps"]);
    if (idle[1]!.kind !== "steps") return;
    expect(idle[1]!.live).toBe(false);

    const live = segmentTranscriptSteps(entries, { runLive: true });
    if (live[1]!.kind !== "steps") return;
    expect(live[1]!.live).toBe(true);
  });

  it("does not mark prior-turn Steps live when a later turn is running", () => {
    const entries: TranscriptEntry[] = [
      { kind: "user", id: "u1", text: "first", mode: "queue", delivered: "queued" },
      {
        kind: "tool",
        id: "t1",
        callId: "c1",
        name: "Read",
        status: "completed",
      },
      { kind: "assistant", id: "a1", text: "done" },
      { kind: "user", id: "u2", text: "second", mode: "queue", delivered: "queued" },
      { kind: "thought", id: "th2", text: "next…" },
    ];
    const items = segmentTranscriptSteps(entries, { runLive: true });
    expect(items.map((item) => item.kind)).toEqual([
      "user",
      "steps",
      "assistant",
      "user",
      "steps",
    ]);
    if (items[1]!.kind !== "steps" || items[4]!.kind !== "steps") return;
    expect(items[1]!.live).toBe(false);
    expect(items[4]!.live).toBe(true);
  });

  it("does not swallow approvals into Steps", () => {
    const entries: TranscriptEntry[] = [
      {
        kind: "tool",
        id: "t1",
        callId: "c1",
        name: "Bash",
        status: "completed",
      },
      {
        kind: "approval",
        id: "ap1",
        requestId: "r1",
        question: "Allow?",
        options: [{ id: "allow", label: "Allow" }],
      },
      {
        kind: "tool",
        id: "t2",
        callId: "c2",
        name: "Read",
        status: "completed",
      },
    ];
    const kinds = segmentTranscriptSteps(entries).map((item) => item.kind);
    expect(kinds).toEqual(["steps", "approval", "steps"]);
  });

  it("folds quiet notes into Steps; warn notes stay outside", () => {
    const entries: TranscriptEntry[] = [
      {
        kind: "tool",
        id: "t1",
        callId: "c1",
        name: "Read",
        status: "completed",
      },
      {
        kind: "note",
        id: "n-quiet",
        notice: { message: "queued" },
        tone: "quiet",
      },
      {
        kind: "tool",
        id: "t2",
        callId: "c2",
        name: "Edit",
        status: "completed",
      },
      {
        kind: "note",
        id: "n-warn",
        notice: { message: "denied" },
        tone: "warn",
      },
      {
        kind: "tool",
        id: "t3",
        callId: "c3",
        name: "Read",
        status: "completed",
      },
    ];
    const kinds = segmentTranscriptSteps(entries).map((item) => item.kind);
    expect(kinds).toEqual(["steps", "note", "steps"]);
    const first = segmentTranscriptSteps(entries)[0]!;
    if (first.kind !== "steps") return;
    expect(first.entries.map((e) => e.id)).toEqual(["t1", "n-quiet", "t2"]);
  });

  it("keeps the streaming answer outside Steps so the reader does not hunt for it", () => {
    const entries: TranscriptEntry[] = [
      { kind: "user", id: "u1", text: "hi", mode: "queue", delivered: "queued" },
      { kind: "assistant", id: "a1", text: "working on it…" },
    ];
    const settled = segmentTranscriptSteps(entries);
    expect(settled.map((item) => item.kind)).toEqual(["user", "assistant"]);

    // Live chat-only used to hide the reply inside open Steps — that forced a
    // scroll past every later tool. The answer stays a hero while it streams.
    const live = segmentTranscriptSteps(entries, { runLive: true });
    expect(live.map((item) => item.kind)).toEqual(["user", "assistant"]);
  });

  it("promotes settled assistants before each user as heroes", () => {
    const entries: TranscriptEntry[] = [
      { kind: "assistant", id: "a1", text: "one" },
      { kind: "user", id: "u2", text: "again", mode: "queue", delivered: "queued" },
      { kind: "assistant", id: "a2", text: "two" },
    ];
    expect([...heroAssistantIds(entries)]).toEqual(["a1", "a2"]);
  });

  it("does not promote an assistant that still has tools after it", () => {
    const entries: TranscriptEntry[] = [
      { kind: "assistant", id: "a1", text: "looking" },
      {
        kind: "tool",
        id: "t1",
        callId: "c1",
        name: "Bash",
        status: "completed",
      },
      { kind: "user", id: "u2", text: "next", mode: "queue", delivered: "queued" },
    ];
    expect([...heroAssistantIds(entries)]).toEqual([]);
  });
});
