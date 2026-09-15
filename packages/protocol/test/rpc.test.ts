/**
 * The wire contract's own tests.
 *
 * Three things are worth testing here, and none of them is a getter:
 *
 *   1. **The catalogue and the table agree.** A method that exists in `RPC_METHODS` but has no
 *      spec is a method a client can call and the daemon cannot validate; a spec for a method that
 *      is not in the catalogue is dead weight that will drift. Both are checked, in both
 *      directions, because one direction passing is exactly how the other rots.
 *   2. **The error convention round-trips.** Our codes cannot ride in the transport's `error.code`
 *      (its catalogue is closed), so the code is a prefix of the message. If `coderError` and
 *      `coderErrorCode` ever disagree, every failure in the app degrades to prose — with no test
 *      failing anywhere else.
 *   3. **The run-event union validates whole.** The window and the phone both parse what they
 *      render, so a member the schema rejects is a transcript that silently stays empty.
 */

import { describe, expect, it } from "vitest";

import {
  AgentModeSchema,
  AgentModelsSchema,
  AgentOptionValueSchema,
  AgentThinkingSchema,
  AgentModelSchema,
  CODER_EVENTS,
  ENVOYCODER_ERRORS,
  RPC_METHODS,
  RPC_SPECS,
  HarnessAuthSchema,
  HarnessAvailabilitySchema,
  HarnessSummarySchema,
  RUN_EVENT_KINDS,
  RunEventSchema,
  TaskSchema,
  coderError,
  coderErrorCode,
  coderErrorMessage,
  coderErrorRef,
  missingMethods,
  missingRpcSpecs,
  orphanRpcSpecs,
  parseMessageRef,
  parseRpcParams,
  readRpcError,
} from "@envoycoder/protocol";

describe("the method table", () => {
  it("covers the catalogue exactly, in both directions", () => {
    expect(missingRpcSpecs()).toEqual([]);
    expect(orphanRpcSpecs()).toEqual([]);
  });

  it("names every method the app actually calls", () => {
    // The M1 set: a client that can do these has a usable app, so their absence is a regression the
    // table should catch rather than a reviewer.
    for (const method of [
      "coder.hello",
      "coder.listProjects",
      "coder.addProject",
      "coder.listTasks",
      "coder.createTask",
      "coder.getSettings",
      "coder.updateSettings",
      "coder.meshStatus",
    ]) {
      expect(RPC_METHODS).toContain(method);
    }
  });

  it("rejects unusable parameters with a code the client can branch on", () => {
    // `path` is required and must be non-empty; an empty one is the shape a UI bug produces.
    let thrown: unknown;
    try {
      parseRpcParams("coder.addProject", { path: "" });
    } catch (error) {
      thrown = error;
    }
    const message = thrown instanceof Error ? thrown.message : "";
    expect(coderErrorCode(message)).toBe(ENVOYCODER_ERRORS.badRequest);
    // The refusal names the method and the field: "which call, which argument" is the whole value.
    expect(message).toContain("coder.addProject");
    expect(message).toContain("path");
  });

  it("accepts omitted optional parameters, which is what a thin client sends", () => {
    expect(() => parseRpcParams("coder.listProjects", undefined)).not.toThrow();
    expect(() => parseRpcParams("coder.listTasks", undefined)).not.toThrow();
    expect(() => parseRpcParams("coder.getSettings", undefined)).not.toThrow();
  });
});

describe("errors on the wire", () => {
  it("carries a code through the message, because error.code cannot hold one", () => {
    const error = coderError(ENVOYCODER_ERRORS.taskMissing, "/gone is not a directory");
    expect(coderErrorCode(error.message)).toBe(ENVOYCODER_ERRORS.taskMissing);
    expect(coderErrorMessage(error.message)).toBe("/gone is not a directory");
  });

  it("leaves a foreign message alone rather than guessing at its code", () => {
    // The transport's own refusals ("Authentication required") arrive through the same channel.
    const foreign = "Authentication required";
    expect(coderErrorCode(foreign)).toBeNull();
    expect(coderErrorMessage(foreign)).toBe(foreign);
  });

  it("does not mistake a Windows drive letter for one of our codes", () => {
    const message = "C:\\Users\\dev\\project is gone";
    expect(coderErrorCode(message)).toBeNull();
    expect(coderErrorMessage(message)).toBe(message);
  });

  it("carries a message key beside the English sentence, because there is no field for one", () => {
    // The family's transport builds `{ code, message }` from a thrown Error's message alone, so a
    // refusal that a German user must read in German has to fit its key in there too. The sentence
    // stays a sentence: a log line and a client that never heard of the convention both still read
    // exactly what they read before.
    const error = coderError(ENVOYCODER_ERRORS.taskMissing, "/gone is not a directory", {
      key: "error.addProject.notDirectory",
      values: { path: "/gone" },
    });
    expect(error.message.startsWith(`${ENVOYCODER_ERRORS.taskMissing}: /gone is not a directory`)).toBe(true);
    expect(coderErrorCode(error.message)).toBe(ENVOYCODER_ERRORS.taskMissing);
    expect(coderErrorMessage(error.message)).toBe("/gone is not a directory");
    expect(coderErrorRef(error.message)).toEqual({
      key: "error.addProject.notDirectory",
      values: { path: "/gone" },
    });
  });

  it("reads a wire error into the object shape a client gets", () => {
    // What a client actually receives: the transport's `{ code, message }`, with the key inside the
    // message. `readRpcError` is the one place that unpacks it, so no client has to know the marker.
    const wire = coderError(ENVOYCODER_ERRORS.harnessUnsupported, "x cannot be driven", {
      key: "error.harnessUnsupported",
      values: { harness: "Cursor" },
    });
    const read = readRpcError({ code: "ERROR", message: wire.message });
    expect(read.code).toBe("ERROR"); // the transport's own catalogue is closed; ours rides in the text
    expect(read.message).toBe("x cannot be driven");
    expect(read.messageKey).toBe("error.harnessUnsupported");
    expect(read.messageValues).toEqual({ harness: "Cursor" });
  });

  it("never shows a user the key's JSON, whatever arrives after the marker", () => {
    // Two ways the tail can be unusable: truncated on the way, or a sentence that merely contains
    // the marker. Both must yield the sentence, not the payload.
    expect(parseMessageRef("a sentence [envoycoder.key] {not json").text).toBe("a sentence");
    expect(parseMessageRef('a sentence [envoycoder.key] {"key":""}').ref).toBeUndefined();
    expect(parseMessageRef('a sentence [envoycoder.key] {"key":"error.x","values":{"n":{}}}')).toEqual({
      text: "a sentence",
      // Only what a template can render: a nested object would print `[object Object]`.
      ref: { key: "error.x" },
    });
  });

  it("has no key at all when none was sent", () => {
    expect(coderErrorRef(`${ENVOYCODER_ERRORS.badRequest}: something`)).toBeUndefined();
    expect(readRpcError({ code: "ERROR", message: "Authentication required" })).toEqual({
      code: "ERROR",
      message: "Authentication required",
    });
  });
});

describe("the broadcast vocabulary", () => {
  it("prefixes every event so it cannot collide with the mesh's own", () => {
    expect(CODER_EVENTS.length).toBe(3);
    for (const event of CODER_EVENTS) expect(event.startsWith("coder:")).toBe(true);
  });
});

describe("run events", () => {
  const base = {
    runId: "r1",
    taskId: "w1",
    at: "2026-09-13T10:00:00.000Z",
    seq: 1,
  };

  const samples: Record<(typeof RUN_EVENT_KINDS)[number], unknown> = {
    "run.started": { ...base, kind: "run.started", harness: "envoy-harness", hostId: "local" },
    "run.session": { ...base, kind: "run.session", sessionId: "s1", resumable: true, resumed: false },
    "run.output": { ...base, kind: "run.output", stream: "assistant", text: "hello", messageId: "m1" },
    "run.thought": { ...base, kind: "run.thought", text: "weighing options", messageId: "m1" },
    "run.message": { ...base, kind: "run.message", text: "do it", mode: "steer", delivered: "steered" },
    "run.tool": { ...base, kind: "run.tool", callId: "c1", name: "shell", status: "completed", input: { command: "ls" } },
    "run.approval-requested": {
      ...base,
      kind: "run.approval-requested",
      requestId: "req-1",
      question: "Run the suite?",
      options: [{ id: "allow", label: "Allow once" }, { id: "deny", label: "Deny", destructive: true }],
    },
    "run.approval-resolved": { ...base, kind: "run.approval-resolved", requestId: "req-1", optionId: "allow", by: "desktop" },
    "run.diff": { ...base, kind: "run.diff", files: [{ path: "a.ts", added: 3, removed: 1 }] },
    "run.usage": { ...base, kind: "run.usage", inputTokens: 10, outputTokens: 20, contextUsed: 100, contextSize: 1000 },
    "run.status": { ...base, kind: "run.status", status: "needs-attention", note: "waiting" },
    "run.ended": { ...base, kind: "run.ended", exitCode: 0, status: "done" },
  };

  it("covers every declared kind — a kind with no sample is a kind no client can render", () => {
    expect(Object.keys(samples).sort()).toEqual([...RUN_EVENT_KINDS].sort());
  });

  it("validates every kind", () => {
    for (const [kind, sample] of Object.entries(samples)) {
      const parsed = RunEventSchema.safeParse(sample);
      expect(parsed.success, `${kind}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    }
  });

  it("refuses an event with no sequence number, because a gap must be detectable", () => {
    expect(RunEventSchema.safeParse({ ...base, seq: undefined, kind: "run.status", status: "running" }).success).toBe(false);
  });
});

/**
 * The two fields this milestone added, at the wire, and the same fields refused when they do not
 * belong.
 *
 * Every spec here is `.strict()`, so the acceptance half is cheap and the *rejection* half is the one
 * worth writing: a schema that silently accepted an extra key is how a client ends up sending a field
 * the daemon ignores — the "control that does nothing" failure, one layer further down.
 */
describe("the model an agent publishes, and what an empty list means", () => {
  const MODEL = {
    id: "anthropic/claude-sonnet-4-6",
    label: "claude-sonnet-4-6",
    description: "Anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  };

  it("carries the choice taken apart, so nothing downstream splits the id", () => {
    expect(AgentModelSchema.safeParse(MODEL).success).toBe(true);
    // `provider` and `model` are **required**, not derivable: an Ollama tag or a Hugging Face id can
    // itself contain a slash (`meta-llama/Llama-3-70b`), and a `split("/")` would hand the agent a
    // provider called `meta-llama`. A model without both halves is not a model we can route.
    const { provider: _p, ...withoutProvider } = MODEL;
    expect(AgentModelSchema.safeParse(withoutProvider).success).toBe(false);
    const { model: _m, ...withoutModel } = MODEL;
    expect(AgentModelSchema.safeParse(withoutModel).success).toBe(false);
    // An id and a label are both mandatory: the id is the contract, the label is what a user reads.
    expect(AgentModelSchema.safeParse({ ...MODEL, id: "" }).success).toBe(false);
    expect(AgentModelSchema.safeParse({ ...MODEL, label: "" }).success).toBe(false);
    // And nothing invented rides along.
    expect(AgentModelSchema.safeParse({ ...MODEL, contextWindow: 200_000 }).success).toBe(false);
  });

  it("refuses a list that disagrees with what it says the list means", () => {
    const listed = { kind: "listed", options: [MODEL], source: "…" };
    expect(AgentModelsSchema.safeParse(listed).success).toBe(true);

    // **The rule the whole feature turns on.** `"listed"` with no options would be a picker with
    // nothing in it; options with another kind would be a list nothing promised. Either way the
    // composer has to guess, and the guess that matters is this one: an empty list read as "the user
    // cannot set a model" disables a control for an agent that accepts one.
    expect(AgentModelsSchema.safeParse({ kind: "listed", options: [], source: "…" }).success).toBe(false);
    expect(
      AgentModelsSchema.safeParse({ kind: "free-text", options: [MODEL], source: "…" }).success,
    ).toBe(false);
    expect(AgentModelsSchema.safeParse({ kind: "none", options: [MODEL], source: "…" }).success).toBe(false);

    // The two states that mean "no list", and they are **not** the same claim about the agent: one says
    // it accepts a model we cannot enumerate, the other that there is nothing to set.
    expect(AgentModelsSchema.safeParse({ kind: "free-text", options: [], source: "…" }).success).toBe(true);
    expect(AgentModelsSchema.safeParse({ kind: "none", options: [], source: "…" }).success).toBe(true);
    // A fourth kind is not a kind: a client that invented one would be telling its own UI a story the
    // daemon never told it.
    expect(AgentModelsSchema.safeParse({ kind: "dynamic", options: [], source: "…" }).success).toBe(false);
  });

  it("requires a source, so no list can travel without where it came from", () => {
    // The provenance is for maintainers and is never rendered, but it is *required* for the reason the
    // catalogue's `evidence` is: a list on the wire with no citation behind it is a list somebody made
    // up, and nothing downstream can tell the difference.
    expect(AgentModelsSchema.safeParse({ kind: "none", options: [], source: "" }).success).toBe(false);
    const { source: _s, ...withoutSource } = { kind: "none", options: [], source: "…" };
    expect(AgentModelsSchema.safeParse(withoutSource).success).toBe(false);
  });

  it("takes a model on the run, so the choice reaches the agent this time and not only the task", () => {
    const spec = RPC_SPECS["coder.startRun"];
    expect(spec.params.safeParse({ taskId: "w1", prompt: "go", model: MODEL.id }).success).toBe(true);
    // Empty is not a model: "the agent's own default" is the *absence* of the field, because a run
    // started with `model: ""` would record a model called nothing on `run.started`.
    expect(spec.params.safeParse({ taskId: "w1", prompt: "go", model: "" }).success).toBe(false);
    // And the task keeps its copy, so a run started after a restart uses the same model.
    expect(
      RPC_SPECS["coder.updateTask"].params.safeParse({ id: "w1", model: MODEL.id }).success,
    ).toBe(true);
  });
});

/**
 * The thinking level, which is the one fact on this wire that no catalogue can answer.
 *
 * Two things are asserted here and nothing else, because both halves of the *behaviour* live where the
 * behaviour is: the schema's three kinds (so a client cannot read "we have not looked" as "the agent
 * has none"), and the two places a chosen level travels.
 */
describe("the thinking level an agent offers, and what 'no list' means", () => {
  const OPTION = { value: "high", label: "High", description: "The default balance for most tasks." };

  it("keeps a value opaque, and refuses one that is not a value", () => {
    // `value` is what goes back to the agent unchanged — for a model it is a JSON pair rather than a
    // name — so it is allowed to be an empty string (this agent uses `""` for "the provider's default")
    // and is never validated against a shape of ours.
    expect(AgentOptionValueSchema.safeParse(OPTION).success).toBe(true);
    expect(AgentOptionValueSchema.safeParse({ value: "", label: "Provider default" }).success).toBe(true);
    // A label is required: an option a user cannot read is not an option this control can offer.
    expect(AgentOptionValueSchema.safeParse({ value: "high", label: "" }).success).toBe(false);
    // `labelKey`/`descriptionKey` are the mechanism for wording that is *ours*; nothing sets them for a
    // level today, so the field being absent must stay valid.
    expect(AgentOptionValueSchema.safeParse({ ...OPTION, labelKey: "task.some.key" }).success).toBe(true);
  });

  it("refuses a list that disagrees with what it says the list means", () => {
    expect(AgentThinkingSchema.safeParse({ kind: "listed", options: [OPTION], source: "…" }).success).toBe(true);
    expect(AgentThinkingSchema.safeParse({ kind: "listed", options: [], source: "…" }).success).toBe(false);
    expect(AgentThinkingSchema.safeParse({ kind: "session", options: [OPTION], source: "…" }).success).toBe(false);
    // **The distinction this field exists for**, and it is a *value* test rather than a comment test:
    // `"session"` (publishes levels, none observed yet) and `"none"` (offers none) are both accepted and
    // are different answers, while a kind nobody defined is not accepted at all.
    expect(AgentThinkingSchema.safeParse({ kind: "session", options: [], source: "…" }).success).toBe(true);
    expect(AgentThinkingSchema.safeParse({ kind: "none", options: [], source: "…" }).success).toBe(true);
    expect(AgentThinkingSchema.safeParse({ kind: "unknown", options: [], source: "…" }).success).toBe(false);
    // The time travels with an observation, and only with one: a catalogue list has none to give.
    expect(AgentThinkingSchema.safeParse({ kind: "none", options: [], source: "…", observedAt: "2026-09-14T05:23:00.000Z" }).success).toBe(true);
    expect(AgentThinkingSchema.safeParse({ kind: "none", options: [], source: "" }).success).toBe(false);
  });

  it("requires the harness summary to say what the agent offers and whether we can set it", () => {
    // The two fields are required for the same reason `capabilities.model` is: an absent *fact* must
    // never be readable as "this agent has none", and an absent *flag* must never be readable as "we
    // can". Both were the failure the mode picker had.
    const spec = RPC_SPECS["coder.listHarnesses"];
    const harness = (over: Record<string, unknown>): unknown => ({
      id: "envoy-harness",
      label: "Envoy Harness",
      tier: "built-in",
      summary: "…",
      modes: [],
      models: { kind: "none", options: [], source: "…" },
      thinking: { kind: "none", options: [], source: "…" },
      capabilities: {
        resume: true,
        cancel: true,
        approvals: true,
        structuredTools: true,
        streaming: true,
        images: false,
        agentMode: true,
        model: true,
        thinking: false,
        // The fourth delivery flag, added by settings slice 1: `session/set_policy`. Required on the
        // same terms as the other three — see the two assertions below.
        approvalPolicy: true,
      },
      availability: { state: "ready", binary: "/usr/local/bin/agent" },
      // What a probe established about whether the agent will open a session, and required for the reason the
      // block below asserts.
      auth: { state: "unknown" },
      evidence: "…",
      ...over,
    });
    expect(spec.result.safeParse({ harnesses: [harness({})] }).success).toBe(true);
    const { thinking: _t, ...withoutFact } = harness({}) as Record<string, unknown>;
    expect(spec.result.safeParse({ harnesses: [withoutFact] }).success).toBe(false);
    // **The auth fact, required.** An absent `auth` would be read as "this agent needs a sign-in" by a
    // client that had to guess, which sends a user to perform a login that changes nothing.
    for (const field of ["auth"]) {
      const { [field]: _dropped, ...withoutField } = harness({}) as Record<string, unknown>;
      expect(
        spec.result.safeParse({ harnesses: [withoutField] }).success,
        `a summary without ${field} was accepted`,
      ).toBe(false);
    }
    // And the fourth flag's absence, which is the one that decides whether the approvals row is a live
    // switch or a disabled row with a reason. A client left to guess would guess "enabled" often enough
    // to ship a control the agent is never told about, which is the defect this flag exists to end.
    // Destructured off **`capabilities`**, not off the harness — a flag is not a fact, and a
    // destructure at the wrong level would remove nothing and assert nothing.
    const built = harness({}) as { capabilities: Record<string, unknown> } & Record<string, unknown>;
    const { approvalPolicy: _p, ...capabilitiesWithoutPolicy } = built.capabilities;
    expect(
      spec.result.safeParse({ harnesses: [{ ...built, capabilities: capabilitiesWithoutPolicy }] }).success,
    ).toBe(false);
  });

  /**
   * **The five availability states, and the five ways two of their fields can disagree.**
   *
   * The rules live in `HarnessAvailabilitySchema`'s `superRefine` and the point of this test is that they are
   * *enforced*, not documented: a state that contradicts its own evidence is worse than a missing one, because
   * both travel on the wire and a client reads whichever it trusts. Every case below is a real mistake a
   * catalogue change could make — the first being the original bug, restated as a schema violation.
   */
  it("rejects an auth state that disagrees with itself, and accepts the one that says nothing", () => {
    // The same discipline the availability rules above apply to the neighbouring question, and the reason is
    // the same: these are claims that travel, and a claim contradicting another is worse than a missing one.
    const ok = {
      // The ordinary case: an agent that opens sessions and needs nothing.
      ready: { state: "ready" },
      // An agent that named the sign-in it wants — `cursor-agent acp`'s measured case.
      named: { state: "needs-signin", methodId: "cursor_login", observedAt: "2026-09-14T10:00:00.000Z" },
      // **And without a method, which is a real answer rather than a gap.** An agent that advertises several
      // methods while our catalogue declares none leaves us unable to name one without choosing on the
      // user's behalf — `@agentclientprotocol/codex-acp` offers two `env_var` methods and a browser login.
      unnamed: { state: "needs-signin" },
      // The answer that asserts nothing, which is what a row says before anything has looked.
      unknown: { state: "unknown" },
      // Time is what makes a fact an observation rather than a current claim, so it may accompany any state.
      observed: { state: "needs-signin", methodId: "cursor_login", observedAt: "2026-09-14T10:00:00.000Z" },
    };
    for (const [name, value] of Object.entries(ok)) {
      expect(HarnessAuthSchema.safeParse(value).success, name).toBe(true);
    }

    const rejects = (value: unknown, why: string) => {
      expect(HarnessAuthSchema.safeParse(value).success, why).toBe(false);
    };
    // The one rule the schema enforces, in the two directions it can be broken: a method id beside a state
    // that says nothing is needed would claim a step that will never happen, and beside `unknown` it would be
    // a requirement we never established — the invention `unknown` exists to refuse.
    rejects({ state: "ready", methodId: "cursor_login" }, "a method id with ready");
    rejects({ state: "unknown", methodId: "cursor_login" }, "a method id with unknown");
    // The three states are the whole vocabulary: a fourth spelling is a state no client can render.
    rejects({ state: "needs-login" }, "a state that is not one of the three");
    rejects({}, "no state at all");
  });

  it("rejects an availability that disagrees with itself, on all five rules", () => {
    const ok = {
      ready: { state: "ready", binary: "/usr/local/bin/dsh" },
      bridged: {
        state: "needs-bridge",
        agentBinary: "/Users/you/.local/bin/claude",
        fix: [{ command: "npm install -g @agentclientprotocol/claude-agent-acp" }],
      },
      missing: { state: "not-installed", fix: [{ command: "npm install -g @openai/codex" }] },
      unknown: { state: "unknown" },
      unsupported: { state: "unsupported", binary: "/usr/local/bin/copilot" },
      provisional: { state: "ready", binary: "/Users/you/.npm/_npx/a1b2/node_modules/.bin/dsh", provisional: "npx" },
    };
    for (const [name, value] of Object.entries(ok)) {
      expect(HarnessAvailabilitySchema.safeParse(value).success, name).toBe(true);
    }

    const rejects = (value: unknown, why: string) => {
      const parsed = HarnessAvailabilitySchema.safeParse(value);
      expect(parsed.success, why).toBe(false);
    };

    // 1. A resolved path means we found the thing we drive, so the state has to say so — and vice versa. This
    //    is the reported bug as a type error: "not installed" *with* a binary beside it.
    rejects({ state: "not-installed", binary: "/usr/bin/x" }, "a path with not-installed");
    rejects({ state: "ready" }, "ready with nothing found");
    // 2. `agentBinary` is the evidence for exactly one state.
    rejects(
      { state: "ready", binary: "/usr/bin/x", agentBinary: "/usr/bin/claude" },
      "agentBinary outside needs-bridge",
    );
    rejects(
      { state: "needs-bridge", fix: [{ command: "npm i -g b" }] },
      "needs-bridge without the agent it found",
    );
    // 3. Provenance belongs to a resolved program.
    rejects({ state: "not-installed", provisional: "npx" }, "provisional without a program");
    // 4. A state asserting an absence must carry the command. Applying the old `available: false` behaviour —
    //    a row that says something is missing and not what to do — is refused here.
    rejects({ state: "not-installed" }, "not-installed with no fix");
    rejects({ state: "needs-bridge", agentBinary: "/usr/bin/claude" }, "needs-bridge with no fix");
    rejects({ state: "not-installed", fix: [] }, "an empty fix list");
    rejects({ state: "needs-bridge", agentBinary: "/usr/bin/claude", fix: [] }, "an empty fix list");
    // 5. And a state that asserts nothing must not tell the user to install something — which is the back door
    //    the old boolean was: `unknown` carrying an install command would turn our blindness into advice.
    rejects({ state: "unknown", fix: [{ command: "npm i -g x" }] }, "unknown with a fix");
    rejects({ state: "ready", binary: "/usr/bin/x", fix: [{ command: "npm i -g x" }] }, "ready with a fix");
    rejects({ state: "unsupported", binary: "/usr/bin/x", fix: [{ command: "npm i -g x" }] }, "unsupported with a fix");
  });

  it("carries the level on the task, on the run, and in the transcript's first event", () => {
    // Three places, and each is load-bearing: the run's record says what it asked for, the task keeps
    // the choice for a run started after a restart, and `run.started` is what a client renders before
    // the agent has said anything.
    expect(RPC_SPECS["coder.startRun"].params.safeParse({ taskId: "w1", prompt: "go", thinkingLevel: "max" }).success).toBe(true);
    // `""` is the control's "the agent's own default" and is **not** a level: it clears the stored one,
    // and a run started with it would record a level called nothing.
    expect(RPC_SPECS["coder.startRun"].params.safeParse({ taskId: "w1", prompt: "go", thinkingLevel: "" }).success).toBe(false);
    expect(RPC_SPECS["coder.updateTask"].params.safeParse({ id: "w1", thinkingLevel: "" }).success).toBe(true);
    expect(RPC_SPECS["coder.updateTask"].params.safeParse({ id: "w1", thinkingLevel: "max" }).success).toBe(true);

    const task = {
      id: "w1",
      projectId: "local::/repo",
      cwd: "/repo",
      title: "a task",
      harness: "deepseek-harness",
      status: "idle",
      createdAt: "2026-09-13T10:00:00.000Z",
      updatedAt: "2026-09-13T10:00:00.000Z",
    };
    expect(TaskSchema.safeParse({ ...task, thinkingLevel: "max" }).success).toBe(true);
    // An empty level is not stored — the *absence* of the key is what "the agent decides" means.
    expect(TaskSchema.safeParse({ ...task, thinkingLevel: "" }).success).toBe(false);
    expect(RunEventSchema.safeParse({
      runId: "r1",
      taskId: "w1",
      at: "2026-09-13T10:00:00.000Z",
      seq: 1,
      kind: "run.started",
      harness: "deepseek-harness",
      thinkingLevel: "max",
      hostId: "local",
    }).success).toBe(true);
  });
});

describe("the agent's mode, and a task's folder", () => {
  it("accepts an agent mode on a run, and refuses an unnamed one", () => {
    const spec = RPC_SPECS["coder.startRun"];
    expect(spec.params.safeParse({ taskId: "w1", prompt: "hi", agentModeId: "plan" }).success).toBe(true);
    // `mode` (ours: queue|steer) and `agentModeId` (the agent's) are different fields, and the ids the
    // agent accepts are not ours to validate: an empty one is the only shape that is always wrong.
    expect(spec.params.safeParse({ taskId: "w1", prompt: "hi", agentMode: "plan" }).success).toBe(false);
    expect(spec.params.safeParse({ taskId: "w1", prompt: "hi", agentModeId: "" }).success).toBe(false);
    expect(
      spec.params.safeParse({ taskId: "w1", prompt: "hi", mode: "steer", agentModeId: "plan" }).success,
    ).toBe(true);
  });

  it("accepts a folder on updateTask, and refuses an empty path", () => {
    const spec = RPC_SPECS["coder.updateTask"];
    expect(spec.params.safeParse({ id: "w1", cwd: "/repo/packages/api" }).success).toBe(true);
    // An empty path is the shape a UI bug produces, and it would replace a real directory with one
    // that cannot exist.
    expect(spec.params.safeParse({ id: "w1", cwd: "" }).success).toBe(false);
    expect(spec.params.safeParse({ id: "w1", cwd: "/repo", agentModeId: "review" }).success).toBe(true);
    // A field nobody implemented must not ride along unnoticed.
    expect(spec.params.safeParse({ id: "w1", worktree: "/repo" }).success).toBe(false);
  });

  it("keeps the task's mode on the task, so a later run reuses it", () => {
    const base = {
      id: "w1",
      projectId: "local::/repo",
      cwd: "/repo",
      title: "a task",
      harness: "envoy-harness",
      status: "idle",
      createdAt: "2026-09-13T10:00:00.000Z",
      updatedAt: "2026-09-13T10:00:00.000Z",
    };
    expect(TaskSchema.safeParse({ ...base, agentModeId: "plan" }).success).toBe(true);
    expect(TaskSchema.safeParse(base).success).toBe(true);
    // The stored value is an id, not a copy of the catalogue's entry: a task file carrying last
    // release's labels would show a user last release's wording.
    expect(TaskSchema.safeParse({ ...base, agentMode: { id: "plan" } }).success).toBe(false);
  });

  it("requires the wire to say whether a mode can be applied at all", () => {
    const spec = RPC_SPECS["coder.listHarnesses"];
    const harness = (capabilities: Record<string, unknown>): unknown => ({
      id: "envoy-harness",
      label: "Envoy Harness",
      tier: "built-in",
      summary: "…",
      modes: [{ id: "plan", label: "Plan" }],
      models: {
        kind: "listed",
        options: [{ id: "anthropic/x", label: "x", provider: "anthropic", model: "x" }],
        source: "…",
      },
      thinking: { kind: "none", options: [], source: "…" },
      capabilities,
      availability: { state: "ready", binary: "/usr/local/bin/agent" },
      auth: { state: "unknown" },
      evidence: "…",
    });
    const full = {
      resume: true,
      cancel: true,
      approvals: true,
      structuredTools: true,
      streaming: true,
      images: false,
      agentMode: true,
      model: true,
      thinking: true,
      // A fourth wire again, and the one the approvals row rests on: `envoy-harness` takes a session
      // policy, `deepseek-harness` has no such method at all.
      approvalPolicy: true,
    };

    expect(spec.result.safeParse({ harnesses: [harness(full)] }).success).toBe(true);
    // Missing is **not** allowed to mean "no": the picker's enabled state is a promise that the choice
    // reaches the agent, and a client left to guess would guess wrong in one direction or the other.
    const { agentMode: _omitted, ...withoutIt } = full;
    expect(spec.result.safeParse({ harnesses: [harness(withoutIt)] }).success).toBe(false);
    expect(
      spec.result.safeParse({ harnesses: [harness({ ...full, agentMode: "yes" })] }).success,
    ).toBe(false);
    // The model's flag is required for exactly the same reason, and it is a *separate* field rather
    // than a reuse of `agentMode` because the two wires differ: `envoy-harness` takes its mode over ACP
    // and its model through argv, so a daemon can honour one and not the other.
    const { model: _alsoOmitted, ...withoutModel } = full;
    expect(spec.result.safeParse({ harnesses: [harness(withoutModel)] }).success).toBe(false);
    // And the thinking level's, which is a third wire again: an agent can take a model in argv and have
    // no thought-level method at all, which is exactly `envoy-harness`.
    const { thinking: _thinkingOmitted, ...withoutThinking } = full;
    expect(spec.result.safeParse({ harnesses: [harness(withoutThinking)] }).success).toBe(false);
    // And the approval policy's, which is the *fourth* wire: an agent can take a model and a mode and
    // still have no `session/set_policy`, which is exactly `deepseek-harness`. The settings row is
    // disabled on this flag, so an absent one must fail the parse rather than silently disabling — or
    // worse, enabling — the control.
    const { approvalPolicy: _policyOmitted, ...withoutPolicy } = full;
    expect(spec.result.safeParse({ harnesses: [harness(withoutPolicy)] }).success).toBe(false);
    // The thinking *fact* is required too, so "absent" can never be read as "this agent has none".
    const { thinking: _factOmitted, ...harnessWithoutFact } = harness(full) as Record<string, unknown>;
    expect(spec.result.safeParse({ harnesses: [harnessWithoutFact] }).success).toBe(false);
  });

  it("carries our wording for a mode only when we wrote it", () => {
    // `label`/`description` are prose; `labelKey`/`descriptionKey` are the keys a window renders
    // instead. A third-party agent's mode arrives with neither key, and showing its own words is the
    // rule the approval prompt's option labels already follow.
    const mine = AgentModeSchema.safeParse({
      id: "plan",
      label: "Plan",
      descriptionKey: "task.agentMode.plan.description",
      labelKey: "task.agentMode.plan.label",
    });
    expect(mine.success).toBe(true);
    expect(AgentModeSchema.safeParse({ id: "plan", label: "Plan" }).success).toBe(true);
    expect(AgentModeSchema.safeParse({ id: "plan", label: "Plan", titleKey: "x" }).success).toBe(false);
    // The id and the label are the agent's contract; an empty one is not a mode.
    expect(AgentModeSchema.safeParse({ id: "", label: "Plan" }).success).toBe(false);
  });
});

describe("hello", () => {
  const spec = RPC_SPECS["coder.hello"];

  it("requires an instance id, which is what tells our daemon from a squatter", () => {
    const withoutInstance = {
      product: "EnvoyCoder",
      version: "0.1.0",
      home: "/home/dev/.envoymesh",
      stateDir: "/home/dev/.envoymesh/EnvoyCoder",
      startedAt: "2026-09-13T10:00:00.000Z",
      windowCount: 1,
      methods: [],
      mesh: { kind: "no-node", reason: "" },
      notes: [],
    };
    expect(spec.result.safeParse(withoutInstance).success).toBe(false);
    expect(spec.result.safeParse({ ...withoutInstance, instanceId: "abc" }).success).toBe(true);
  });
});

describe("telling the window and its daemon apart", () => {
  it("names the methods a daemon's own build does not have", () => {
    // The failure this answers: the shell attaches to a daemon that already owns the port (family rule
    // D2), so after an upgrade the window can talk to the previous build — which answers what it has and
    // refuses the rest with `Method not found`. Both halves describe themselves in `hello`, so the
    // window can know before it asks.
    expect(missingMethods([...RPC_METHODS])).toEqual([]);
    const older = RPC_METHODS.filter((method) => method !== "coder.listTasks");
    expect(missingMethods(older)).toEqual(["coder.listTasks"]);
    // Order follows this build's catalogue, so the notice names the first method a user would notice.
    expect(missingMethods(["coder.hello"])).toEqual([...RPC_METHODS].filter((m) => m !== "coder.hello"));
  });

  it("keeps a fetched row's install command and the delivery in agreement", () => {
    // **The owner's requirement, as a type rule:** *"we should keep the command text, but also provide the exec
    // button. Not to remove the text."* `installFix` is the *other* route's commands, so it is present exactly
    // when the delivery in force is `npx` — the same "a claim that contradicts another claim is worse than a
    // missing one" discipline `HarnessAvailabilitySchema` enforces, one field along. Without this rule a row
    // could offer an install command for the connector it says it is already running.
    const base = {
      id: "codex" as const,
      label: "Codex",
      tier: "catalogued" as const,
      summary: "…",
      modes: [],
      models: { kind: "none" as const, options: [], source: "…" },
      thinking: { kind: "none" as const, options: [], source: "…" },
      capabilities: {
        resume: true,
        cancel: true,
        approvals: false,
        structuredTools: true,
        streaming: true,
        images: false,
        agentMode: false,
        model: false,
        thinking: false,
        approvalPolicy: false,
      },
      availability: { state: "ready" as const, binary: "/usr/local/bin/npx" },
      auth: { state: "unknown" as const },
      evidence: "…",
    };
    const install = [{ command: "npm install -g @agentclientprotocol/codex-acp" }];

    // A fetched row carries the command that would install it here instead.
    expect(
      HarnessSummarySchema.safeParse({
        ...base,
        delivery: { kind: "npx", package: "@agentclientprotocol/codex-acp" },
        installFix: install,
      }).success,
    ).toBe(true);
    // A fetched row without it is refused: the text cannot be dropped from a row that is fetching.
    expect(
      HarnessSummarySchema.safeParse({
        ...base,
        delivery: { kind: "npx", package: "@agentclientprotocol/codex-acp" },
      }).success,
    ).toBe(false);
    // And an installed row must not carry it: there is nothing to install.
    expect(
      HarnessSummarySchema.safeParse({ ...base, delivery: { kind: "installed" }, installFix: install }).success,
    ).toBe(false);
    // A daemon older than the field is unaffected — no delivery, no install commands, and that parses.
    expect(HarnessSummarySchema.safeParse(base).success).toBe(true);
  });

  it("does not turn 'says nothing' into 'has nothing'", () => {
    // An empty list is a daemon that predates the field, not one with no methods: reporting all of them
    // missing would break the window against a daemon that works, which is a worse answer than silence.
    expect(missingMethods([])).toEqual([]);
  });

  it("ignores a daemon with more methods than this window", () => {
    // The daemon is the newer half. Nothing this window can ask for is missing, so this is not skew.
    expect(missingMethods([...RPC_METHODS, "coder.somethingFromTheFuture"])).toEqual([]);
  });
});
