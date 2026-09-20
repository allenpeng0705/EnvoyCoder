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
 * | `harness-me` | the **built-in harness's own** envelopes: `session/token` deltas (with a split thinking tag), a committed `session/update {message}`, and a `session/activity` tool pair |
 * | `harness-committed` | only the committed envelope, no deltas — the fallback a non-streaming turn needs |
 * | `mode-me` | announces its collaboration mode, so `session/set_mode` is observable |
 * | `model-me` | announces its session config, so `session/set_config_option` is observable |
 * | `thinking-me` | announces its thinking level, so the *second* config option is observable too |
 * | `policy-me` | announces its session's `autoRun` policy, so `session/set_policy` is observable |
 *
 * `FAKE_ACP_NO_SET_MODE=1` makes it refuse `session/set_mode` with `-32601`, the way
 * `deepseek-harness` does. That is how a test proves the honest failure mode: an agent that cannot be
 * put into the requested mode **fails the run** rather than quietly working in the wrong one.
 *
 * `FAKE_ACP_MODE_PARAM=modeId` makes it read the **specification's** field name instead of the peer's —
 * what `cursor-agent acp`, `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`
 * all do (their own refusals are quoted in the catalogue entries). The default, `mode`, is
 * `envoy-harness`'s (`acp-params.ts:352-375`).
 *
 * The two branches are modelled **asymmetrically on purpose, because the real agents are**: an agent
 * reading `mode` that is sent a `modeId` does **not** refuse it. `parseSessionSetModeParams` ignores the
 * unknown field, returns `{sessionId}` with no mode, and the backend answers `{mode: <the current one>}`
 * — a success that changed nothing (`.../src/protocol/agent-backend.ts:625-635`). An agent reading
 * `modeId` that is sent `mode` refuses with `-32602`. A fixture that refused both would let a client
 * which "tries one and falls back on the refusal" pass here while silently applying no mode on a real
 * machine, which is the defect this whole field exists to prevent — so the tests assert the **effect**
 * (what mode the session reports afterwards), not that the call resolved.
 *
 * `FAKE_ACP_REQUIRE_AUTH=<methodId>` makes this agent the one real agent that needs authenticating:
 * `session/new` answers `-32000 Authentication required … call authenticate() with methodId '<id>'`
 * until `authenticate {methodId}` arrives, exactly as `cursor-agent acp` does. It is off by default
 * because the two bridges and the built-in harness all open sessions unauthenticated — a fixture that
 * always demanded it would hide a client that never sends it.
 *
 * `FAKE_ACP_NO_SET_POLICY=1` does the same for `session/set_policy`. It models an agent that has no
 * policy method while *our* catalogue still claims one, which is the drift that matters: the daemon must
 * fail the run with the agent's own words rather than proceed in an approval posture it did not set.
 *
 * `FAKE_ACP_REFUSE_MODEL` is one opaque config value this agent refuses, with the real `dsh`'s own
 * sentence (`unknown model option: …`, `invalid params`). It is a single value rather than a list
 * because the value *is* a JSON array — `["provider","model"]` — so any separator-based list would be
 * ambiguous with it. That refusal is the property the design leans on: because we build the value
 * instead of picking it from a list the agent published, an id its catalog does not have must fail
 * **loudly**, and this is what proves that it does.
 *
 * `FAKE_ACP_PUBLISH_OPTIONS=1` makes `session/new` answer with a `configOptions` array **in the real
 * agent's shape** — a grouped `model` select and a `thought_level` select with names and descriptions.
 * Off by default, and that default is the point: a session that publishes nothing is a real case
 * (`envoy-harness` answers `{sessionId}` alone, verified against the built peer), and it is the only
 * way to test that "we opened a session and it offered nothing" is recorded as such instead of being
 * confused with "we have not looked yet".
 *
 * `FAKE_ACP_REFUSE_THINKING` is one thinking level this agent refuses, with the real `dsh`'s own
 * sentence (`unknown reasoning effort for <provider>/<model>: <value>`, `invalid params`) — verified
 * against the binary. It exists to prove the deliberate limit of our own validation: a level that is
 * not in the observed list is **not** refused by the daemon (the list is a record of an earlier
 * session, not a promise), so the agent's own refusal is what a user meets, and it must be loud.
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
 * Which field name this agent's `session/set_mode` reads. See the module doc for the two contracts and
 * why the branches below are deliberately not symmetric.
 */
const MODE_PARAM = process.env.FAKE_ACP_MODE_PARAM === "modeId" ? "modeId" : "mode";
/**
 * The one auth method this agent demands before `session/new`, or `undefined` for an agent that opens
 * sessions unauthenticated — which is what every real agent in the catalogue but `cursor-agent acp` does.
 */
const REQUIRED_AUTH = process.env.FAKE_ACP_REQUIRE_AUTH;
/** Whether this process has been authenticated. Only meaningful when `REQUIRED_AUTH` is set. */
let authenticated = false;
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
/** The one thinking level this agent refuses, when a test asks it to refuse one. */
const REFUSED_THINKING = process.env.FAKE_ACP_REFUSE_THINKING;
/** Whether this session publishes its options, and therefore accepts changes to them. */
const PUBLISH = process.env.FAKE_ACP_PUBLISH_OPTIONS === "1";
const pendingPrompts = new Map();

/**
 * The option state this session publishes — verbatim the real agent's shape.
 *
 * Copied from a live `dsh --profile acp` response (see the module doc): the model select's values are
 * opaque JSON pairs grouped by provider, and the thinking select's values carry the agent's own names
 * and descriptions.
 *
 * ## Why the thinking levels depend on the model, which is the fixture's one piece of behaviour
 *
 * The real agent builds its `thought_level` option from `info.reasoning` for the route the session
 * resolved (`dsh-acp/lib/index.js:494-508`), so **which levels exist depends on the model**. That is not
 * a detail: it is the reason the daemon sets the model *before* the level and the reason the option state
 * returned by a change is worth recording. A fixture with one fixed list would let a client that set the
 * level first, or that never read the echo, pass every test here.
 *
 * So the stronger model offers a level the fast one does not (`ultra`), and a client that got the order
 * wrong is answered with the agent's own refusal rather than quietly succeeding.
 */
/**
 * The session's own approval posture, as `session/set_policy` set it, or `null` while nobody has.
 *
 * **The peer's state, not ours.** `envoy-harness` keeps a per-session policy whose `autoRun` is
 * *unset* until a caller sends one — a fresh session answers `session/get_policy` with a sandbox and an
 * approval mode and **no** `autoRun` at all — so `null` here is the honest initial value and a fixture
 * that started at `"safe-only"` would let a daemon that never sent a policy look like one that did
 * (`../envoy-harness/packages/envoy-harness/src/protocol/agent-backend.ts:536-545`, the `getPolicy`
 * that omits the key; the defaults it is built over are `session-backend.ts:417-420`).
 */
let autoRunPolicy = null;
let sandboxPolicy = null;
let approvalPolicy = null;

/**
 * The `autoRun` values `envoy-harness` validates, verbatim (`protocol/acp-params.ts:237-295`).
 *
 * Copied rather than approximated for the same reason the mode ids are: the value crosses a process
 * boundary into somebody else's parameter check, so a fixture that accepted anything would let a
 * client with a misspelled posture — or a translated one — pass every test here.
 */
const AUTO_RUN_POLICIES = ["always-confirm", "safe-only", "off"];
const SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"];
const APPROVAL_MODES = ["unless-trusted", "on-request", "granular", "never"];

const MODEL_DEFAULT = '["fake","flash"]';

const REASONING_BY_MODEL = {
  [MODEL_DEFAULT]: [
    { value: "off", name: "Off", description: "Use for simple tasks." },
    { value: "low", name: "Low", description: "Routine work." },
    { value: "high", name: "High", description: "The default balance." },
    { value: "max", name: "Max", description: "Reserve for the hardest tasks." },
  ],
  '["fake","pro"]': [
    { value: "high", name: "High", description: "The default balance for this model." },
    { value: "max", name: "Max", description: "Reserve for the hardest tasks." },
    { value: "ultra", name: "Ultra", description: "This model goes further than the fast one." },
  ],
};

const PUBLISHED_OPTIONS = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: MODEL_DEFAULT,
    options: [
      {
        group: "fake",
        name: "Fake",
        options: [
          {
            value: MODEL_DEFAULT,
            name: "Fake-Flash",
            description: "Fast, efficient and economical.",
          },
          { value: '["fake","pro"]', name: "Fake-Pro", description: "Stronger, and slower." },
        ],
      },
    ],
  },
  {
    id: "reasoning_effort",
    name: "Reasoning effort",
    category: "thought_level",
    type: "select",
    currentValue: "high",
    options: REASONING_BY_MODEL[MODEL_DEFAULT],
  },
];

/**
 * The option state with the changes this session has taken applied, as the real method answers.
 *
 * `[]` for a session that publishes nothing: a fixture that answered a change with options it never
 * advertised would let the daemon record a list no session can produce, which is exactly the kind of
 * quiet inconsistency between the two halves of a protocol that a fixture is supposed to catch.
 */
const optionState = () =>
  PUBLISH
    ? PUBLISHED_OPTIONS.map((option) => {
        const current = sessionConfig[option.id];
        // The thinking option is rebuilt for whichever model the session now resolves — see
        // `REASONING_BY_MODEL`. This is what makes the echo from a change worth anything.
        if (option.id === "reasoning_effort") {
          const model = typeof sessionConfig.model === "string" ? sessionConfig.model : MODEL_DEFAULT;
          return {
            ...option,
            currentValue: current ?? option.currentValue,
            options: REASONING_BY_MODEL[model] ?? REASONING_BY_MODEL[MODEL_DEFAULT],
          };
        }
        return current === undefined ? option : { ...option, currentValue: current };
      })
    : [];

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

  if (text.includes("commands")) {
    // The shape ACP agents use to publish their own slash commands (`available_commands_update`).
    // A leading slash and a nameless entry are noise the daemon must drop, not offer.
    update({
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "compact", description: "Summarize the conversation", input: { hint: "[focus]" } },
        { name: "/review", description: "Review the diff" },
        { name: "", description: "dropped" },
      ],
    });
    ok(id, { stopReason: "end_turn" });
    return;
  }

  if (text.includes("harness-me")) {
    // **The built-in `envoy-harness`'s dialect, envelope for envelope** — taken from a real turn
    // against the built peer rather than from the specification:
    //   session/token   {sessionId, token: {role, delta}}
    //   session/update  {sessionId, message: {role, text}}      (not the spec's `update`)
    //   session/activity{sessionId, activity: {kind, toolName, …}}
    // The first delta deliberately ends mid-tag (`<thi`), because a real token stream splits tags and
    // a client that only stripped whole tags would leak the reasoning into the answer.
    for (const delta of ["<thi", "nk>let me thin", "k</think>the ans", "wer"]) {
      notify("session/token", { sessionId, token: { role: "assistant", delta } });
    }
    // The committed copy a real turn also sends. A client that translated both would print the answer
    // twice, which is the bug this branch exists to catch.
    notify("session/update", {
      sessionId,
      message: { role: "assistant", text: "<think>let me think</think>the answer" },
    });
    notify("session/activity", {
      sessionId,
      activity: {
        ts: new Date().toISOString(),
        kind: "tool_call",
        toolName: "bash",
        toolArgs: { command: "ls" },
        summary: "bash — ls",
      },
    });
    notify("session/activity", {
      sessionId,
      activity: {
        ts: new Date().toISOString(),
        kind: "tool_result",
        toolName: "bash",
        toolCallId: "provider-call-9",
        isError: false,
        resultPreview: "file-a",
        summary: "ok — file-a",
      },
    });
    ok(id, { stopReason: "end_turn" });
    return;
  }

  if (text.includes("harness-committed")) {
    // A turn that streams nothing: the harness's hermetic demo backend and a slash command both take
    // this shape, and the committed row is the only copy of the answer there is.
    notify("session/update", {
      sessionId,
      message: { role: "assistant", text: "<think>private</think>echoed back" },
    });
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

  if (text.includes("thinking-me")) {
    // The thinking level's half of the same proof, and a separate prompt rather than a combined report:
    // a test that asserted both at once could not tell a level that reached the agent from one that was
    // dropped while the model arrived. Reported as the raw value, for the same reason as the model.
    update({ sessionUpdate: "agent_message_chunk", messageId: "m-thinking", content: { type: "text", text: `thinking: ${sessionConfig.reasoning_effort ?? "(none)"}` } });
    ok(id, { stopReason: "end_turn" });
    return;
  }

  if (text.includes("policy-me")) {
    // The approval posture's half of the same proof the mode and the model have, on its own prompt for
    // the same reason: a test that asserted several at once could not tell the posture that reached the
    // agent from one that was dropped while the model arrived. `(none)` is the peer's own "no autoRun
    // has been set" state, and it is a different answer from any of the three values.
    update({ sessionUpdate: "agent_message_chunk", messageId: "m-policy", content: { type: "text", text: `autoRun: ${autoRunPolicy ?? "(none)"} sandbox: ${sandboxPolicy ?? "(none)"} approval: ${approvalPolicy ?? "(none)"}` } });
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
        // **A sibling of `agentCapabilities`, not a child of it** — the real agents put it here, and the
        // difference is exactly what a test would fail to notice: a client reading it one level too deep
        // would see no methods on every agent. What the real agents answer: an empty list for every agent
        // that needs nothing (both bridges and the built-in harness), and the one method this agent is
        // waiting for when a test asked for that. It is how a client is *supposed* to learn what to
        // authenticate with; ours is told by the catalogue instead (`AcpLaunch.authMethodId`), and this
        // is what makes that difference visible.
        authMethods: REQUIRED_AUTH === undefined ? [] : [{ id: REQUIRED_AUTH, name: "Fake login" }],
      });
      return;
    case "authenticate": {
      if (REQUIRED_AUTH === undefined) {
        // The bridges advertise methods they refuse to implement — `@zed-industries/claude-code-acp`
        // answered `-32603 … Method not implemented` for `claude-login` — so a client that called one
        // unconditionally would break on an agent that never needed it.
        fail(id, -32601, "fake agent has nothing to authenticate with");
        return;
      }
      if (params?.methodId !== REQUIRED_AUTH) {
        fail(id, -32602, `unknown auth method: ${String(params?.methodId)}`);
        return;
      }
      authenticated = true;
      ok(id, {});
      return;
    }
    case "session/new":
      // `cursor-agent acp`'s own refusal, verbatim in shape and code: `-32000 Authentication required`
      // with the sentence naming the method. A client that never authenticates meets this instead of a
      // session, which is the whole reason the step exists.
      if (REQUIRED_AUTH !== undefined && !authenticated) {
        fail(
          id,
          -32000,
          `Authentication required. Please run 'agent login' first, then call authenticate() with methodId '${REQUIRED_AUTH}'.`,
        );
        return;
      }
      sessionCounter += 1;
      sessionId = `fake-session-${sessionCounter}`;
      // The real answer is `{sessionId, configOptions}`; `FAKE_ACP_PUBLISH_OPTIONS` decides whether this
      // one publishes anything, because "a session that offered nothing" is a case the daemon records
      // and a case the window has to render differently from "we have not looked yet".
      ok(id, PUBLISH ? { sessionId, configOptions: optionState() } : { sessionId, configOptions: [] });
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
      // `{sessionId, mode}` and answers `-32602 mode must be default|plan|review` for a *bad mode*, so a
      // client that prettified or translated a mode id fails here — which is exactly the drift a fixture
      // should catch. `FAKE_ACP_NO_SET_MODE` models the other harness, which has no such method at all.
      //
      // **And the branch the peer takes for a field it does not know is a success, not a refusal.**
      // `parseSessionSetModeParams` looks only at `obj.mode`; a payload carrying `modeId` therefore
      // parses as "no mode requested", and the backend answers `{mode: <the current one>}`
      // (`.../src/protocol/agent-backend.ts:625-635`). Modelled here because it is the reason the
      // parameter name is a catalogue *fact*: a client that guessed would be told it had applied a mode
      // it never applied, and only an assertion about the **resulting mode** catches that.
      if (process.env.FAKE_ACP_NO_SET_MODE) {
        fail(id, -32601, "session/set_mode not supported");
        return;
      }
      const requested = params?.[MODE_PARAM];
      if (requested === undefined && MODE_PARAM === "mode") {
        // The peer: not an error. An absent mode is a request for the current one.
        ok(id, { mode: collaborationMode });
        return;
      }
      if (!MODES.includes(requested)) {
        // The two shapes of the real refusal: the peer names the values it accepts, and the
        // specification's agents name the field they wanted and did not get
        // (`-32602 … modeId: expected string, received undefined`).
        fail(
          id,
          -32602,
          MODE_PARAM === "modeId"
            ? "Invalid params: modeId expected string, received undefined"
            : "mode must be default|plan|review",
        );
        return;
      }
      collaborationMode = requested;
      ok(id, {});
      return;
    }
    case "session/set_policy": {
      // **The peer's own contract, copied rather than approximated, and transcribed from the wire.**
      // `envoy-harness` accepts `{sessionId, autoRun?, sandbox?, approval?, preset?}`, requires at least
      // one of those four, and answers `-32602 preset, sandbox, approval, or autoRun required` when it
      // gets none (`../envoy-harness/packages/envoy-harness/src/protocol/acp-params.ts:237-295`).
      //
      // Driven against the **built peer** to check the transcription, not only read out of its source.
      // On a fresh session:
      //
      //   session/get_policy                          → {sandbox:"workspace-write",approval:"on-request"}
      //   session/set_policy {autoRun:"always-confirm"}→ accepted, and get_policy then reports it
      //   session/set_policy {autoRun:"off"}           → accepted, and get_policy then reports it
      //   session/set_policy {autoRun:"sometimes"}     → -32602 preset, sandbox, approval, or autoRun
      //   session/set_policy {sandbox:"read-only"}     → accepted, autoRun left exactly as it was
      //
      // Three facts from that run are modelled here: the **absent `autoRun`** on a fresh session (which
      // is why `autoRunPolicy` starts `null`), the refusal sentence, and that a policy set without
      // `sandbox` does not move the sandbox — the boundary that lets this daemon send `autoRun` alone.
      //
      // The extra `{result: …}` nesting is the peer's own, not a mistake here: `session/set_policy`,
      // `session/set_model` and `session/get_policy` answer `{result: <payload>}` while
      // `session/set_mode` and `session/new` answer the payload directly
      // (`.../src/protocol/acp-server.ts:294-315` against `:431-440`). We ignore the payload either way —
      // `AcpClient.setPolicy` awaits the call and reads nothing from it — so the envelope is copied
      // rather than tidied, because a fixture that tidied it would be the wrong half of the protocol to
      // be wrong about. It is a peer-side inconsistency worth reporting upstream (family guide §7.4),
      // not something to work around here.
      if (process.env.FAKE_ACP_NO_SET_POLICY) {
        fail(id, -32601, "session/set_policy not supported");
        return;
      }
      if (params?.sessionId !== sessionId) {
        fail(id, -32602, `unknown session: ${String(params?.sessionId)}`);
        return;
      }
      const hasAuto = AUTO_RUN_POLICIES.includes(params?.autoRun);
      const hasSandbox = SANDBOX_MODES.includes(params?.sandbox);
      const hasApproval = APPROVAL_MODES.includes(params?.approval);
      if (!hasAuto && !hasSandbox && !hasApproval && typeof params?.preset !== "string") {
        fail(id, -32602, "preset, sandbox, approval, or autoRun required");
        return;
      }
      if (hasAuto) autoRunPolicy = params.autoRun;
      if (hasSandbox) sandboxPolicy = params.sandbox;
      if (hasApproval) approvalPolicy = params.approval;
      // Only the keys that were handed over, inside the peer's envelope — so a client that reads
      // `result.result.autoRun` to learn the posture works here too. A sandbox sent alone must not
      // invent an `autoRun` the caller did not set.
      ok(id, {
        result: {
          ...(hasAuto ? { autoRun: autoRunPolicy } : {}),
          ...(hasSandbox ? { sandbox: sandboxPolicy } : {}),
          ...(hasApproval ? { approval: approvalPolicy } : {}),
        },
      });
      return;
    }
    case "session/set_config_option": {
      // **The peer's own validation, copied rather than approximated.** `deepseek-harness` looks the
      // value up in the option state it advertised and throws `unknown model option: <value>` when it
      // is not there, which its dispatcher maps to `invalid params`
      // (`../deepseek-harness/packages/acp/acp/src/model-control.ts:105-111`,
      // `.../src/index.ts:339-342`). A fixture that accepted anything would let a client with a broken
      // value encoding pass, which is the one thing this test exists to prevent.
      //
      // The thinking level is validated the same way and with the real sentence, from
      // `model-control.js`'s `set`: `unknown reasoning effort for <provider>/<model>: <value>`. It is
      // also refused outright when the session published no `reasoning_effort` option at all —
      // `unknown session config option: <configId>` — which is the state every agent that has no such
      // option is in.
      const { configId, value } = params ?? {};
      if (configId === "model") {
        if (REFUSED_MODEL !== undefined && value === REFUSED_MODEL) {
          fail(id, -32602, `unknown model option: ${String(value)}`);
          return;
        }
      } else if (configId === "reasoning_effort") {
        if (!PUBLISH) {
          fail(id, -32602, `unknown session config option: ${String(configId)}`);
          return;
        }
        // Validated against the levels **of the model this session has resolved**, which is exactly what
        // the real agent does and the reason the daemon sets the model first. A level that belongs only
        // to the stronger model is refused while the fast one is still selected.
        const model = typeof sessionConfig.model === "string" ? sessionConfig.model : MODEL_DEFAULT;
        const allowed = (REASONING_BY_MODEL[model] ?? []).map((level) => level.value);
        if (REFUSED_THINKING !== undefined && value === REFUSED_THINKING) {
          fail(id, -32602, `unknown reasoning effort for fake/flash: ${String(value)}`);
          return;
        }
        if (!allowed.includes(value)) {
          const [provider, name] = JSON.parse(model);
          fail(id, -32602, `unknown reasoning effort for ${provider}/${name}: ${String(value)}`);
          return;
        }
      } else {
        fail(id, -32602, `unknown session config option: ${String(configId)}`);
        return;
      }
      sessionConfig[configId] = value;
      // The real method answers with the complete resulting option state, not an acknowledgement —
      // `model-control.js` returns `(await this.state(signal)).options` — which is also how the daemon
      // learns that a change altered *which* values exist (they depend on the resolved model).
      ok(id, { configOptions: optionState() });
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
