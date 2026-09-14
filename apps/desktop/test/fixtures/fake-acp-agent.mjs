#!/usr/bin/env node
/**
 * A scripted ACP agent, for tests that need an agent's *behaviour* rather than an agent.
 *
 * ## Why a fixture and not the real thing
 *
 * The real `dsh --profile acp` needs model credentials and answers non-deterministically, so it can
 * prove the **transport** — handshake, framing, argv, teardown — and nothing about semantics. This
 * fixture is the other half: it speaks the same protocol and does exactly what the test asked for,
 * which is how a permission request, a cancellation mid-turn and a resume can be asserted at all.
 *
 * `daemon-rpc.test.ts`'s sibling (`acp-transport.test.ts`) runs the real binary against the same
 * client, so between them the client is proven against both a real subprocess and a deterministic
 * script.
 *
 * ## The script, keyed on what the prompt says
 *
 * | prompt contains | behaviour |
 * |---|---|
 * | `think` | a reasoning chunk, then an answer chunk |
 * | `tool` | a `tool_call`, then a `tool_call_update` that completes it |
 * | `approve` | `session/request_permission`, then a message reporting which option came back |
 * | `fail` | a JSON-RPC error, the way a real agent reports a missing credential |
 * | `slow` | one chunk, then silence — so a test can cancel or steer mid-turn |
 * | `resume-me` | announces the session id it was given, so a resume is observable |
 *
 * The protocol shapes are the ones the real agent emits, taken from
 * `../deepseek-harness/packages/acp/acp/src/updates.ts`.
 */

import process from "node:process";

let buffer = "";
let sessionId = null;
let sessionCounter = 0;
const pendingPrompts = new Map();

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });

const update = (payload) => notify("session/update", { sessionId, update: payload });

/** The next prompt to answer, so an out-of-band permission response can unblock a turn. */
let permissionWaiter = null;

function handlePrompt(id, params) {
  const text = (params?.prompt ?? [])
    .map((part) => (part?.type === "text" ? part.text : ""))
    .join(" ");

  if (text.includes("fail")) {
    // The shape the real agent used when it had no API key: a JSON-RPC error on `session/prompt`,
    // not a failed update. The adapter must surface it as a failed run, not as silence.
    fail(id, -32603, "Internal error: turn failed: llm-deepseek: no API key for provider route \"deepseek-official\"");
    return;
  }

  if (text.includes("slow")) {
    update({
      sessionUpdate: "agent_message_chunk",
      messageId: "m-slow",
      content: { type: "text", text: "working on it" },
    });
    // Deliberately never answers on its own: the test cancels or steers, and the answer comes from
    // the cancel path so the ordering matches a real agent's.
    pendingPrompts.set(id, "slow");
    return;
  }

  if (text.includes("approve")) {
    const toolCallId = "call-approve";
    update({ sessionUpdate: "tool_call", toolCallId, title: "shell", kind: "other", status: "in_progress", rawInput: { command: "rm -rf build" } });
    // Exactly the option set the real agent sends (`packages/acp/acp/src/index.ts:160-167`).
    send({
      jsonrpc: "2.0",
      id: `perm-${id}`,
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: { toolCallId },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        ],
      },
    });
    permissionWaiter = { promptId: id, toolCallId };
    return;
  }

  if (text.includes("tool")) {
    update({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "shell", kind: "other", status: "in_progress", rawInput: { command: "ls" } });
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "file-a\nfile-b" } }],
    });
    update({ sessionUpdate: "usage_update", used: 1200, size: 128_000 });
    ok(id, { stopReason: "end_turn" });
    return;
  }

  if (text.includes("resume-me")) {
    // Proves *which* session answered, so a test can tell a resume from a fresh start.
    update({ sessionUpdate: "agent_message_chunk", messageId: "m-r", content: { type: "text", text: `session ${sessionId}` } });
    ok(id, { stopReason: "end_turn" });
    return;
  }

  if (text.includes("think")) {
    update({ sessionUpdate: "agent_thought_chunk", messageId: "m-1", content: { type: "text", text: "let me consider" } });
    update({ sessionUpdate: "agent_message_chunk", messageId: "m-1", content: { type: "text", text: "here is the answer" } });
    ok(id, { stopReason: "end_turn" });
    return;
  }

  update({ sessionUpdate: "agent_message_chunk", messageId: "m-0", content: { type: "text", text: `echo: ${text}` } });
  ok(id, { stopReason: "end_turn" });
}

function handle(message) {
  const { id, method, params } = message;

  // A reply to the permission request we raised.
  if (method === undefined && id !== undefined && permissionWaiter) {
    const chosen = message.result?.outcome;
    const optionId = chosen?.outcome === "selected" ? chosen.optionId : "cancelled";
    const { promptId, toolCallId } = permissionWaiter;
    permissionWaiter = null;
    update({
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: optionId === "allow-once" ? "completed" : "failed",
      content: [{ type: "content", content: { type: "text", text: `answered ${optionId}` } }],
    });
    update({
      sessionUpdate: "agent_message_chunk",
      messageId: "m-p",
      content: { type: "text", text: `permission: ${optionId}` },
    });
    ok(promptId, { stopReason: "end_turn" });
    return;
  }

  switch (method) {
    case "initialize":
      ok(id, {
        protocolVersion: 1,
        agentInfo: { name: "fake-acp-agent", version: "0.0.1" },
        agentCapabilities: { sessionCapabilities: { close: {}, resume: {} } },
        authMethods: [],
      });
      return;
    case "session/new":
      sessionCounter += 1;
      sessionId = `fake-session-${sessionCounter}`;
      ok(id, { sessionId, configOptions: [] });
      return;
    case "session/resume":
      sessionId = params?.sessionId ?? null;
      ok(id, { sessionId });
      return;
    case "session/close":
      ok(id, {});
      return;
    case "session/prompt":
      handlePrompt(id, params);
      return;
    case "session/cancel": {
      // A real agent answers the in-flight prompt with `cancelled`, and that is what the run loop
      // distinguishes a steer from a cancel by.
      for (const [promptId] of pendingPrompts) ok(promptId, { stopReason: "cancelled" });
      pendingPrompts.clear();
      return;
    }
    default:
      if (id !== undefined) fail(id, -32601, `fake agent does not implement ${String(method)}`);
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line === "") continue;
    try {
      handle(JSON.parse(line));
    } catch (error) {
      process.stderr.write(`fake agent could not read a frame: ${String(error)}\n`);
    }
  }
});
// stdin EOF is the first step of the documented teardown, and an agent that ignored it would hang
// every test that stops one.
process.stdin.on("end", () => process.exit(0));
