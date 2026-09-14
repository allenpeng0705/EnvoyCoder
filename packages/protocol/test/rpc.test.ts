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
  CODER_EVENTS,
  ENVOYCODER_ERRORS,
  RPC_METHODS,
  RPC_SPECS,
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
      capabilities,
      available: true,
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
    };

    expect(spec.result.safeParse({ harnesses: [harness(full)] }).success).toBe(true);
    // Missing is **not** allowed to mean "no": the picker's enabled state is a promise that the choice
    // reaches the agent, and a client left to guess would guess wrong in one direction or the other.
    const { agentMode: _omitted, ...withoutIt } = full;
    expect(spec.result.safeParse({ harnesses: [harness(withoutIt)] }).success).toBe(false);
    expect(
      spec.result.safeParse({ harnesses: [harness({ ...full, agentMode: "yes" })] }).success,
    ).toBe(false);
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
