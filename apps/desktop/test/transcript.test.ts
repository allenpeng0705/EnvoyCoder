/**
 * The transcript projection.
 *
 * Folding rules are where transcript bugs live, and every case here is one that renders visibly
 * wrong when it breaks: a wall of one-word bubbles, a tool call with no result, an approval card
 * that will not go away, a transcript that skips the sentence explaining the change.
 *
 * The events are hand-built rather than produced by a run, on purpose: this is a test of the *folding*,
 * and driving a real agent to produce a specific sequence would make the test about the agent.
 */

import { describe, expect, it } from "vitest";

import type { RunEvent } from "@envoydev/protocol";

import { buildTranscript } from "../src/state/transcript.js";

const base = { runId: "r1", taskId: "w1", at: "2026-09-13T10:00:00.000Z" };

function at(seq: number, event: Record<string, unknown>): RunEvent {
  return { ...base, seq, ...event } as RunEvent;
}

describe("folding what an agent streams", () => {
  it("joins chunks of one message into a single row", () => {
    const transcript = buildTranscript([
      at(1, { kind: "run.output", stream: "assistant", text: "Hello", messageId: "m1" }),
      at(2, { kind: "run.output", stream: "assistant", text: ", ", messageId: "m1" }),
      at(3, { kind: "run.output", stream: "assistant", text: "world", messageId: "m1" }),
    ]);

    expect(transcript.entries).toHaveLength(1);
    expect(transcript.entries[0]).toMatchObject({ kind: "assistant", text: "Hello, world" });
  });

  it("keeps two concurrent messages apart when they are interleaved", () => {
    // The reason `messageId` exists: two replies streaming at once must not merge into one bubble.
    const transcript = buildTranscript([
      at(1, { kind: "run.output", stream: "assistant", text: "first ", messageId: "a" }),
      at(2, { kind: "run.output", stream: "assistant", text: "second ", messageId: "b" }),
      at(3, { kind: "run.output", stream: "assistant", text: "reply", messageId: "a" }),
      at(4, { kind: "run.output", stream: "assistant", text: "reply", messageId: "b" }),
    ]);

    expect(transcript.entries.map((entry) => (entry.kind === "assistant" ? entry.text : ""))).toEqual([
      "first reply",
      "second reply",
    ]);
  });

  it("falls back to joining when an agent sends no message id at all", () => {
    // Some agents omit it. A client that made each chunk its own bubble would render a wall of
    // one-word rows, which is a worse failure than merging two messages that were never concurrent.
    const transcript = buildTranscript([
      at(1, { kind: "run.output", stream: "assistant", text: "one " }),
      at(2, { kind: "run.output", stream: "assistant", text: "two" }),
    ]);
    expect(transcript.entries).toHaveLength(1);
    expect(transcript.entries[0]).toMatchObject({ text: "one two" });
  });

  it("keeps reasoning out of the answer", () => {
    const transcript = buildTranscript([
      at(1, { kind: "run.thought", text: "maybe the parser", messageId: "m1" }),
      at(2, { kind: "run.output", stream: "assistant", text: "the answer", messageId: "m1" }),
    ]);
    // Same `messageId`, different rows: a client that keyed on the id alone would splice the
    // reasoning into the reply.
    expect(transcript.entries.map((entry) => entry.kind)).toEqual(["thought", "assistant"]);
  });
});

describe("tool calls", () => {
  it("is one row from two events, keyed by the agent's call id", () => {
    const transcript = buildTranscript([
      at(1, { kind: "run.tool", callId: "c1", name: "shell", status: "running", input: { command: "ls" } }),
      at(2, { kind: "run.tool", callId: "c1", name: "", status: "completed", output: "a\nb" }),
    ]);

    expect(transcript.entries).toHaveLength(1);
    expect(transcript.entries[0]).toMatchObject({
      kind: "tool",
      name: "shell",
      status: "completed",
      input: { command: "ls" },
    });
  });

  it("does not erase the name when the result event carries none", () => {
    // A real `tool_call_update` has no title, and overwriting with "" is how a row loses its label
    // exactly when it finishes.
    const transcript = buildTranscript([
      at(1, { kind: "run.tool", callId: "c1", name: "read-file", status: "running" }),
      at(2, { kind: "run.tool", callId: "c1", name: "", status: "completed" }),
    ]);
    expect(transcript.entries[0]).toMatchObject({ name: "read-file", status: "completed" });
  });

  it("keeps a call that never finished visible as running", () => {
    const transcript = buildTranscript([
      at(1, { kind: "run.tool", callId: "c1", name: "shell", status: "running" }),
    ]);
    // A tool call that vanishes from the transcript while it is still going is how a user concludes
    // the agent hung.
    expect(transcript.entries[0]).toMatchObject({ status: "running" });
  });
});

describe("approvals", () => {
  const requested = at(1, {
    kind: "run.approval-requested",
    requestId: "req-1",
    question: "Allow the agent to run “shell”?",
    detail: "It has stopped before this step.",
    options: [
      { id: "allow-once", label: "Allow once" },
      { id: "reject-once", label: "Reject", destructive: true },
    ],
  });

  it("is open until it is answered, and shows what the agent offered", () => {
    const transcript = buildTranscript([requested]);
    expect(transcript.pendingApprovalId).toBe("req-1");
    expect(transcript.entries[0]).toMatchObject({ kind: "approval", question: "Allow the agent to run “shell”?" });
    const entry = transcript.entries[0];
    expect(entry?.kind === "approval" ? entry.options.map((option) => option.label) : []).toEqual([
      "Allow once",
      "Reject",
    ]);
  });

  it("stops being a question once it is answered, in place", () => {
    const transcript = buildTranscript([
      requested,
      at(2, { kind: "run.approval-resolved", requestId: "req-1", optionId: "allow-once", by: "you" }),
    ]);
    expect(transcript.pendingApprovalId).toBeUndefined();
    // One row, still where it was: an approval that moved or duplicated would break the reader's
    // place in a long transcript.
    expect(transcript.entries).toHaveLength(1);
    expect(transcript.entries[0]).toMatchObject({ kind: "approval", resolvedWith: "allow-once" });
  });

  it("keeps every chosen option when the question allowed more than one", () => {
    const transcript = buildTranscript([
      at(1, {
        kind: "run.approval-requested",
        requestId: "req-2",
        question: "Which files?",
        selection: "many",
        options: [
          { id: "0", label: "App" },
          { id: "1", label: "Tests" },
        ],
      }),
      at(2, {
        kind: "run.approval-resolved",
        requestId: "req-2",
        optionId: "0",
        optionIds: ["0", "1"],
        by: "you",
      }),
    ]);
    expect(transcript.entries[0]).toMatchObject({
      kind: "approval",
      selection: "many",
      resolvedWith: "0",
      resolvedWithIds: ["0", "1"],
    });
  });

  it("closes an open card when the run ends without an answer", () => {
    // Cancelling while the card is on screen: the question is moot, and a card that stayed would be
    // a UI asking for a decision about something that no longer exists.
    const transcript = buildTranscript([
      requested,
      at(2, { kind: "run.ended", exitCode: null, status: "cancelled" }),
    ]);
    expect(transcript.pendingApprovalId).toBeUndefined();
    expect(transcript.entries.map((entry) => entry.kind)).toEqual(["approval", "note"]);
  });
});

describe("honesty about what arrived", () => {
  it("says so when a sequence number is missing", () => {
    const transcript = buildTranscript([
      at(1, { kind: "run.output", stream: "assistant", text: "one", messageId: "m1" }),
      at(5, { kind: "run.output", stream: "assistant", text: "five", messageId: "m2" }),
    ]);
    // Rendering a transcript that silently skips a frame is how a user reads a decision they never
    // saw, so the gap is reported instead.
    expect(transcript.hasGap).toBe(true);
    expect(transcript.lastSeq).toBe(5);
  });

  it("does not report a gap for a run that begins at its own first event", () => {
    // A client that attached late starts at whatever `seq` the daemon is at; calling that a gap
    // would put an error on every window that opened during a run.
    const transcript = buildTranscript([
      at(7, { kind: "run.output", stream: "assistant", text: "mid-run", messageId: "m1" }),
    ]);
    expect(transcript.hasGap).toBe(false);
  });

  it("renders a user message with how it was delivered", () => {
    const transcript = buildTranscript([
      at(1, { kind: "run.message", text: "and then?", mode: "steer", delivered: "steered" }),
    ]);
    // The transcript records whether it joined the turn or waited, which is the only way a user can
    // see that the two composer modes did different things.
    expect(transcript.entries[0]).toMatchObject({ kind: "user", delivered: "steered", mode: "steer" });
  });

  it("says nothing about the furniture", () => {
    // `run.started` and `run.session` are shown in the header. A transcript that opened with "the
    // run started" would narrate the window frame.
    const transcript = buildTranscript([
      at(1, { kind: "run.started", harness: "deepseek-harness", hostId: "local" }),
      at(2, { kind: "run.session", sessionId: "s1", resumable: true, resumed: false }),
    ]);
    expect(transcript.entries).toEqual([]);
  });
});
