/**
 * The built-in harness's notification dialect, translated.
 *
 * The end-to-end proof is in `runs.test.ts`, against a real child process. This file is for the rules
 * a scripted turn is a poor place to reach: a thinking tag split across deltas, a committed row that
 * supersedes an in-flight one, and the tool pair the harness names in two different shapes.
 */

import { describe, expect, it } from "vitest";

import { HarnessDialect, stripThinking } from "../src/daemon/acp/harness-dialect.js";
import type { AcpUpdate } from "../src/daemon/acp/protocol.js";

/** The text a list of updates carries, joined — what the transcript would concatenate. */
const textOf = (updates: readonly AcpUpdate[], kind: string): string =>
  updates
    .filter((update) => update.sessionUpdate === kind)
    .map((update) => (update.content as { text?: string } | undefined)?.text ?? "")
    .join("");

/** Feed deltas through a fresh turn, plus whatever committed rows the caller adds, then end it. */
function turn(
  deltas: readonly string[],
  committed: readonly string[] = [],
): AcpUpdate[] {
  const dialect = new HarnessDialect();
  dialect.beginTurn();
  const out: AcpUpdate[] = [];
  for (const delta of deltas) {
    out.push(...dialect.accept("session/token", { sessionId: "s", token: { role: "assistant", delta } }));
  }
  for (const text of committed) {
    out.push(...dialect.accept("session/update", { sessionId: "s", message: { role: "assistant", text } }));
  }
  out.push(...dialect.endTurn());
  return out;
}

describe("streaming deltas", () => {
  it("joins a turn's deltas into one answer", () => {
    const updates = turn(["the ", "ans", "wer"]);
    expect(textOf(updates, "agent_message_chunk")).toBe("the answer");
    expect(updates.every((update) => update.sessionUpdate === "agent_message_chunk")).toBe(true);
  });

  it("recognizes a thinking tag split across two deltas instead of leaking it", () => {
    // The real stream splits tags mid-name; a client that stripped only whole tags would put
    // "<thi" into the answer and never show the reasoning as reasoning.
    const updates = turn(["<thi", "nk>let me thin", "k</think>the ans", "wer"]);
    expect(textOf(updates, "agent_thought_chunk")).toBe("let me think");
    expect(textOf(updates, "agent_message_chunk")).toBe("the answer");
  });

  it("holds back a trailing `<` until the next delta decides whether it is a tag", () => {
    const dialect = new HarnessDialect();
    dialect.beginTurn();
    // A lone `<` could begin a tag, so it is held rather than emitted...
    expect(dialect.accept("session/token", { token: { role: "assistant", delta: "a <" } })).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "a " } },
    ]);
    // ...and once the next delta is not a tag, it is emitted as the literal text it was.
    const rest = dialect.accept("session/token", { token: { role: "assistant", delta: "b" } });
    expect(textOf(rest, "agent_message_chunk")).toBe("<b");
  });

  it("treats an unclosed thinking block as reasoning, not as the answer", () => {
    const updates = turn(["<think>still reasoning"]);
    expect(textOf(updates, "agent_thought_chunk")).toBe("still reasoning");
    expect(textOf(updates, "agent_message_chunk")).toBe("");
  });

  it("ignores a token that is not the assistant's", () => {
    const dialect = new HarnessDialect();
    dialect.beginTurn();
    expect(dialect.accept("session/token", { token: { role: "user", delta: "hi" } })).toEqual([]);
    expect(dialect.accept("session/token", { token: { role: "assistant", delta: "" } })).toEqual([]);
  });
});

describe("committed rows", () => {
  it("does not repeat text that already streamed", () => {
    const updates = turn(["the answer"], ["the answer"]);
    expect(textOf(updates, "agent_message_chunk")).toBe("the answer");
  });

  it("renders the last committed copy when the turn streamed nothing, with thinking stripped", () => {
    // The harness commits an in-flight row and then the final one; only the last is the answer, and
    // the fallback must replace rather than append or the transcript shows both.
    const updates = turn([], ["<think>draft</think>half", "<think>draft</think>the answer"]);
    expect(textOf(updates, "agent_message_chunk")).toBe("the answer");
  });

  it("ignores the user, system and tool rows, which the run records elsewhere", () => {
    const dialect = new HarnessDialect();
    dialect.beginTurn();
    for (const role of ["user", "system", "tool"]) {
      expect(
        dialect.accept("session/update", { message: { role, text: `${role} text` } }),
      ).toEqual([]);
    }
  });

  it("ignores the specification's `update` envelope, which the client routes itself", () => {
    const dialect = new HarnessDialect();
    dialect.beginTurn();
    expect(
      dialect.accept("session/update", {
        update: { sessionUpdate: "available_commands_update", availableCommands: [] },
      }),
    ).toEqual([]);
  });
});

describe("the activity stream's tool pair", () => {
  it("pairs a call with its result on one id, even though only the result carries one", () => {
    const dialect = new HarnessDialect();
    dialect.beginTurn();
    const start = dialect.accept("session/activity", {
      activity: { kind: "tool_call", toolName: "bash", toolArgs: { command: "ls" }, summary: "bash — ls" },
    });
    expect(start).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "harness-tool-1",
        title: "bash",
        rawInput: { command: "ls" },
      },
    ]);

    const end = dialect.accept("session/activity", {
      activity: {
        kind: "tool_result",
        toolName: "bash",
        toolCallId: "provider-call-9",
        isError: false,
        resultPreview: "file-a",
        summary: "ok — file-a",
      },
    });
    expect(end).toEqual([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "harness-tool-1",
        status: "completed",
        content: "file-a",
      },
    ]);
  });

  it("reports a refused tool as failed", () => {
    const dialect = new HarnessDialect();
    dialect.beginTurn();
    dialect.accept("session/activity", { activity: { kind: "tool_call", toolName: "bash" } });
    const end = dialect.accept("session/activity", {
      activity: { kind: "tool_result", toolName: "bash", isError: true, resultPreview: "denied" },
    });
    expect(end[0]).toMatchObject({ status: "failed", content: "denied" });
  });

  it("does not translate the progress and lifecycle events the transcript does not show", () => {
    const dialect = new HarnessDialect();
    dialect.beginTurn();
    expect(dialect.accept("session/activity", { activity: { kind: "agent_start" } })).toEqual([]);
    expect(dialect.accept("session/activity", { activity: { kind: "model_response" } })).toEqual([]);
    expect(dialect.accept("session/activity", { activity: { kind: "tool_progress" } })).toEqual([]);
  });
});

describe("stripThinking", () => {
  it("removes every tag the harness recognizes, and a trailing unclosed one", () => {
    expect(stripThinking("<think>a</think>answer")).toBe("answer");
    expect(stripThinking("<thinking>a</thinking>answer")).toBe("answer");
    expect(stripThinking("<redacted_thinking>a</redacted_thinking>answer")).toBe("answer");
    expect(stripThinking("answer<think>unfinished")).toBe("answer");
    expect(stripThinking("plain")).toBe("plain");
  });
});
