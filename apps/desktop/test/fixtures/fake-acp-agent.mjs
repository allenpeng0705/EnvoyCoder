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
 * | `mode-me` | announces its collaboration mode, so `session/set_mode` is observable |
 * | `model-me` | announces its session config, so `session/set_config_option` is observable |
 *
 * `FAKE_ACP_NO_SET_MODE=1` makes it refuse `session/set_mode` with `-32601`, the way
 * `deepseek-harness` does. That is how a test proves the honest failure mode: an agent that cannot be
 * put into the requested mode **fails the run** rather than quietly working in the wrong one.
 *
 * `FAKE_ACP_REFUSE_MODEL` is one opaque config value this agent refuses, with the real `dsh`'s own
 * sentence (`unknown model option: …`, `invalid params`). It is a single value rather than a list
 * because the value *is* a JSON array — `["provider","model"]` — so any separator-based list would be
 * ambiguous with it. That refusal is the property the design leans on: because we build the value
 * instead of picking it from a list the agent published, an id its catalog does not have must fail
 * **loudly**, and this is what proves that it does.
 *
 * The protocol shapes are the ones the real agent emits, taken from
 * `../deepseek-harness/packages/acp/acp/src/updates.ts`. The mode ids and the refusal sentence are
 * `envoy-harness`'s own (`../envoy-harness/packages/envoy-harness/src/protocol/acp-params.ts:352-375`),
 * and the session-config shape (`{sessionId, configId, value}` in, `{configOptions}` out) is
 * `deepseek-harness`'s (`../deepseek-harness/packages/acp/acp/src/index.ts:333-340`).
 */

import process from "node:process";

let buffer = "";
let sessionId = null;
let sessionCounter = 0;
/** The three `ModeKind`s `envoy-harness` accepts, and the one this session is currently in. */
const MODES = ["default", "plan", "review"];
let collaborationMode = "default";
/**
 * The session's own configuration, keyed by the agent's `configId`.
 *
 * Starts empty and is filled only by `session/set_config_option`, so `model-me` reports what the
 * *client* set rather than something the agent would have chosen anyway. A value the client believed
 * it sent has to be visible here or the test proves nothing about delivery.
 */
const sessionConfig = {};
/** The one opaque model value this agent refuses, when a test asks it to refuse one. */
const REFUSED_MODEL = process.env.FAKE_ACP_REFUSE_MODEL;
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

  if (text.includes("mode-me")) {
    // Proves which mode the session is *in*, which is the only way to tell a mode that reached the
    // agent from one a client merely believed it had sent.
    update({ sessionUpdate: "agent_message_chunk", messageId: "m-mode", content: { type: "text", text: `mode: ${collaborationMode}` } });
    ok(id, { stopReason: "end_turn" });
    return;
  }

  if (text.includes("model-me")) {
    // Proves what the session is *configured with*, which is the only way to tell a model that reached
    // the agent from one a client merely believed it had sent. Reported as the raw config value,
    // because that is exactly what the agent stores: an opaque string it was handed and validated.
    update({ sessionUpdate: "agent_message_chunk", messageId: "m-model", content: { type: "text", text: `model: ${sessionConfig.model ?? "(none)"}` } });
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
    case "session/set_mode": {
      // **The peer's own contract, copied rather than approximated.** `envoy-harness` accepts
      // `{sessionId, mode}` and answers `-32602 mode must be default|plan|review` for anything else,
      // so a client that prettified or translated a mode id fails here — which is exactly the drift a
      // fixture should catch. `FAKE_ACP_NO_SET_MODE` models the other harness, which has no such
      // method at all.
      if (process.env.FAKE_ACP_NO_SET_MODE) {
        fail(id, -32601, "session/set_mode not supported");
        return;
      }
      if (!MODES.includes(params?.mode)) {
        fail(id, -32602, "mode must be default|plan|review");
        return;
      }
      collaborationMode = params.mode;
      ok(id, {});
      return;
    }
    case "session/set_config_option": {
      // **The peer's own validation, copied rather than approximated.** `deepseek-harness` looks the
      // value up in the option state it advertised and throws `unknown model option: <value>` when it
      // is not there, which its dispatcher maps to `invalid params`
      // (`../deepseek-harness/packages/acp/acp/src/model-control.ts:105-111`,
      // `.../src/index.ts:339-342`). A fixture that accepted anything would let a client with a broken
      // value encoding pass, which is the one thing this test exists to prevent.
      const { configId, value } = params ?? {};
      if (configId !== "model") {
        fail(id, -32602, `unknown session config option: ${String(configId)}`);
        return;
      }
      if (REFUSED_MODEL !== undefined && value === REFUSED_MODEL) {
        fail(id, -32602, `unknown model option: ${String(value)}`);
        return;
      }
      sessionConfig[configId] = value;
      // The real method answers with the complete resulting option state, not an acknowledgement.
      ok(id, {
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: value,
            options: [{ group: "fake", name: "Fake", options: [{ value, name: String(value) }] }],
          },
        ],
      });
      return;
    }
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
