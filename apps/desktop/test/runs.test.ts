/**
 * Runs, end to end, against a scripted agent.
 *
 * ## What this proves that a unit test cannot
 *
 * Everything here happens through a real child process speaking real newline-delimited JSON-RPC on
 * a real pipe: the client's framing, the spawn and teardown, the approval round trip (a request the
 * *agent* raises and the client answers), cancellation mid-turn, and a resume. Those are the parts
 * that fail for reasons no amount of object-shaped unit testing reaches — a missing newline, a
 * teardown that leaves a process alive, an approval answer sent in the wrong shape.
 *
 * The agent is the fixture in `fixtures/fake-acp-agent.mjs`, chosen over a mock object on purpose:
 * a mock would let the two halves of the protocol drift, because the test would agree with the bug.
 * `acp-transport.test.ts` runs the *real* `dsh` against the same client, so the client is held to
 * both a deterministic script and a real subprocess.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { HarnessId, RunEvent } from "@envoycoder/protocol";
import { coderErrorCode, coderErrorMessage, coderErrorRef } from "@envoycoder/protocol";
import { coderPaths } from "@envoycoder/host-bridge";

import { en, isMessageKey } from "../src/i18n/messages/en.js";
import type { AcpLaunch } from "../src/daemon/acp/client.js";
import { RunManager } from "../src/daemon/runs.js";
import { CoderStore } from "../src/daemon/store.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_AGENT = join(here, "fixtures", "fake-acp-agent.mjs");

/* ────────────────────────────── harness ────────────────────────────── */

interface Bench {
  manager: RunManager;
  store: CoderStore;
  events: RunEvent[];
  taskId: string;
  home: string;
  /** Wait until a predicate holds over the events so far, or fail with what did arrive. */
  until: (predicate: (events: RunEvent[]) => boolean, label: string) => Promise<void>;
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  // **Last in, first out.** Teardown order is not cosmetic here: the agent process must be stopped
  // before its home directory is removed, or the removal races the agent still writing into it —
  // which shows up as `ENOTEMPTY` in the *setup* of the next test rather than as the ordering bug it
  // is. Registration order is "create the world, then start the thing in it", so reverse is right.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A run manager over a throwaway home, driving the fixture.
 *
 * `harness` matters to the mode and model tests: the catalogue is what decides whether an agent can be
 * put into a mode, or onto a model, at all — so a test about a refusal needs a task whose agent
 * genuinely has none.
 */
async function bench(
  options: { harness?: HarnessId; agentEnv?: Record<string, string> } = {},
): Promise<Bench> {
  const home = await mkdtemp(join(tmpdir(), "envoycoder-m2-"));
  const paths = coderPaths(home);
  const store = await CoderStore.open({ paths });
  const project = await store.addProject({ path: join(home, "repo") });
  const task = await store.createTask({
    projectId: project.project.id,
    title: "a task",
    ...(options.harness ? { harness: options.harness } : {}),
  });

  const events: RunEvent[] = [];
  const launch: AcpLaunch = {
    command: process.execPath,
    args: [FAKE_AGENT],
    cwd: home,
    ...(options.agentEnv ? { env: options.agentEnv } : {}),
  };

  const manager = new RunManager({
    paths,
    store,
    onEvent: (event) => events.push(event),
    resolveLaunch: () => launch,
  });

  cleanups.push(async () => {
    await manager.stopAll();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  return {
    manager,
    store,
    events,
    taskId: task!.id,
    home,
    async until(predicate, label) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (predicate(events)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(
        `timed out waiting for ${label}. Events so far: ${events.map((event) => event.kind).join(", ")}`,
      );
    },
  };
}

const kinds = (events: readonly RunEvent[], kind: RunEvent["kind"]): RunEvent[] =>
  events.filter((event) => event.kind === kind);

/** What the agent said about itself, from the transcript it produced. */
const said = (events: readonly RunEvent[], needle: string): boolean =>
  kinds(events, "run.output").some(
    (event) => event.kind === "run.output" && event.text.includes(needle),
  );

/* ────────────────────────────── the tests ────────────────────────────── */

describe("one run, end to end", () => {
  it("streams what the agent says into normalized events, in order", async () => {
    const b = await bench();
    const run = await b.manager.start({ taskId: b.taskId, prompt: "please think about it" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    // The order is the contract: a client renders these in arrival order, and `seq` is what lets it
    // detect a gap.
    expect(b.events.map((event) => event.kind)).toEqual([
      "run.started",
      "run.session",
      "run.thought",
      "run.output",
      "run.ended",
    ]);
    expect(b.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    for (const event of b.events) {
      expect(event.runId).toBe(run.id);
      expect(event.taskId).toBe(b.taskId);
    }

    const thought = kinds(b.events, "run.thought")[0];
    expect(thought && thought.kind === "run.thought" ? thought.text : "").toBe("let me consider");
    const output = kinds(b.events, "run.output")[0];
    expect(output && output.kind === "run.output" ? output.stream : "").toBe("assistant");
    // The message id is what lets a client join streaming fragments into one bubble.
    expect(output && output.kind === "run.output" ? output.messageId : undefined).toBe("m-1");

    expect(b.manager.isLive(run.id)).toBe(false);
  });

  it("pairs a tool call with its result by the agent's own call id", async () => {
    const b = await bench();
    await b.manager.start({ taskId: b.taskId, prompt: "run a tool" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    const tools = kinds(b.events, "run.tool");
    expect(tools).toHaveLength(2);
    const [start, end] = tools as [Extract<RunEvent, { kind: "run.tool" }>, Extract<RunEvent, { kind: "run.tool" }>];
    // Two events, one call: the id is what a client folds on. Keying on the tool's *name* would
    // merge two concurrent calls to the same tool into one row.
    expect(start.callId).toBe("call-1");
    expect(end.callId).toBe("call-1");
    expect(start.status).toBe("running");
    expect(end.status).toBe("completed");
    expect(start.name).toBe("shell");
    expect(start.input).toEqual({ command: "ls" });
  });

  it("records context usage when the agent reports it, and stays silent when it does not", async () => {
    const b = await bench();
    await b.manager.start({ taskId: b.taskId, prompt: "run a tool" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    const usage = kinds(b.events, "run.usage")[0];
    expect(usage && usage.kind === "run.usage" ? usage.contextUsed : undefined).toBe(1200);
    expect(usage && usage.kind === "run.usage" ? usage.contextSize : undefined).toBe(128_000);
  });

  it("turns an agent error into a failed run rather than a rejected call", async () => {
    const b = await bench();
    // The real case this models: dsh with no API key answers `session/prompt` with a JSON-RPC error.
    const run = await b.manager.start({ taskId: b.taskId, prompt: "this will fail" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to fail");

    // The RPC that *started* the run succeeded: the run existed, and the UI was already rendering it.
    expect(run.status).toBe("running");
    const ended = kinds(b.events, "run.ended")[0];
    expect(ended && ended.kind === "run.ended" ? ended.status : "").toBe("failed");

    const note = kinds(b.events, "run.status").find(
      (event) => event.kind === "run.status" && event.status === "failed",
    );
    // The agent's own words survive: "no API key" is the part a user can act on.
    expect(note && note.kind === "run.status" ? (note.note ?? "") : "").toContain("no API key");
    expect(b.store.findTask(b.taskId)?.status).toBe("failed");
  });
});

describe("approvals", () => {
  it("surfaces a permission request, waits, and continues when it is answered", async () => {
    const b = await bench();
    await b.manager.start({ taskId: b.taskId, prompt: "please approve this" });
    await b.until((events) => kinds(events, "run.approval-requested").length === 1, "the approval card");

    const requested = kinds(b.events, "run.approval-requested")[0];
    if (requested?.kind !== "run.approval-requested") throw new Error("unreachable");
    // The options come from the agent, in the agent's words — the label the user reads is the one
    // the protocol carried, not one we invented for it.
    expect(requested.options.map((option) => option.label)).toEqual(["Allow once", "Reject"]);
    // …and which one refuses is the protocol's own `kind`, not a guess from the label.
    expect(requested.options.find((option) => option.id === "reject-once")?.destructive).toBe(true);
    // The card names the call we already streamed, so the user knows what they are allowing.
    expect(requested.question).toContain("shell");

    // The run is blocked: a human decision, not progress. This is the whole reason
    // `needs-attention` is not folded into `running` (`docs/envoycoder-ui.md` §4).
    expect(b.store.findTask(b.taskId)?.status).toBe("needs-attention");
    expect(b.manager.isLive(kinds(b.events, "run.started")[0]?.runId ?? "")).toBe(true);

    const answered = await b.manager.answerApproval(
      (kinds(b.events, "run.started")[0] as { runId: string }).runId,
      requested.requestId,
      "allow-once",
    );
    expect(answered).toBe(true);

    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to continue and end");
    // It continued rather than being denied — the failure mode the harness doc warns about for an
    // agent whose surface cannot answer (`docs/envoycoder-harness.md` §1).
    expect(
      kinds(b.events, "run.output").some(
        (event) => event.kind === "run.output" && event.text.includes("permission: allow-once"),
      ),
    ).toBe(true);
    expect(kinds(b.events, "run.approval-resolved")).toHaveLength(1);
    // Back to working, then finished.
    expect(b.store.findTask(b.taskId)?.status).toBe("done");
  });

  it("refuses a second answer to the same request, so a double click cannot decide twice", async () => {
    const b = await bench();
    await b.manager.start({ taskId: b.taskId, prompt: "please approve this" });
    await b.until((events) => kinds(events, "run.approval-requested").length === 1, "the approval card");

    const requested = kinds(b.events, "run.approval-requested")[0];
    if (requested?.kind !== "run.approval-requested") throw new Error("unreachable");
    const runId = requested.runId;

    expect(await b.manager.answerApproval(runId, requested.requestId, "allow-once")).toBe(true);
    expect(await b.manager.answerApproval(runId, requested.requestId, "reject-once")).toBe(false);
    expect(await b.manager.answerApproval(runId, "not-a-request", "allow-once")).toBe(false);
  });

  it("refuses a message while an approval is open, naming why", async () => {
    const b = await bench();
    const run = await b.manager.start({ taskId: b.taskId, prompt: "please approve this" });
    await b.until((events) => kinds(events, "run.approval-requested").length === 1, "the approval card");

    // Queueing behind a prompt strands the message: the prompt must be answered first, so accepting
    // the words would be promising a delivery that cannot happen.
    await expect(b.manager.send(run.id, "actually, stop", "queue")).rejects.toThrow(/waiting for an answer/);
  });
});

describe("cancel and steer", () => {
  it("ends a cancelled run as cancelled, not as a failure", async () => {
    const b = await bench();
    const run = await b.manager.start({ taskId: b.taskId, prompt: "a slow task" });
    await b.until((events) => kinds(events, "run.output").length === 1, "the first chunk");

    expect(await b.manager.cancel(run.id)).toBe(true);
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    const ended = kinds(b.events, "run.ended")[0];
    // A user who asked for the work to stop did not experience a failure, and showing one would
    // teach them to distrust the status column.
    expect(ended && ended.kind === "run.ended" ? ended.status : "").toBe("cancelled");
    expect(b.store.findTask(b.taskId)?.status).toBe("cancelled");
    expect(await b.manager.cancel(run.id)).toBe(false);
  });

  it("queues a message, then delivers it as the next turn — the difference from steering", async () => {
    const b = await bench();
    const run = await b.manager.start({ taskId: b.taskId, prompt: "a slow task" });
    await b.until((events) => kinds(events, "run.output").length === 1, "the first chunk");

    expect(await b.manager.send(run.id, "and then do this", "queue")).toBe("queued");
    const message = kinds(b.events, "run.message")[0];
    // The transcript records which mode was used, so "did it join or wait?" is answerable later.
    expect(message?.kind === "run.message" ? message.delivered : "").toBe("queued");
    expect(message?.kind === "run.message" ? message.mode : "").toBe("queue");

    // Nothing was interrupted: the slow turn is still the one in flight.
    expect(kinds(b.events, "run.ended")).toHaveLength(0);
    await b.manager.cancel(run.id);
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");
    // Cancelling drops what was queued: the user asked for the work to stop.
    expect(kinds(b.events, "run.output").some((event) => event.kind === "run.output" && event.text.includes("and then"))).toBe(false);
  });

  it("steers by interrupting the turn, and the message is what runs next", async () => {
    const b = await bench();
    const run = await b.manager.start({ taskId: b.taskId, prompt: "a slow task" });
    await b.until((events) => kinds(events, "run.output").length === 1, "the first chunk");

    expect(await b.manager.send(run.id, "change of plan", "steer")).toBe("steered");
    await b.until(
      (events) => kinds(events, "run.output").some((event) => event.kind === "run.output" && event.text.includes("change of plan")),
      "the steered message to be answered",
    );
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    // Steered, not cancelled: the run finished normally after the redirect.
    const ended = kinds(b.events, "run.ended")[0];
    expect(ended && ended.kind === "run.ended" ? ended.status : "").toBe("done");
    expect(kinds(b.events, "run.message")[0]?.kind === "run.message" ? (kinds(b.events, "run.message")[0] as { delivered: string }).delivered : "").toBe("steered");
  });
});

describe("resume and transcripts", () => {
  it("rejoins the previous session rather than starting a fresh one", async () => {
    const b = await bench();
    await b.manager.start({ taskId: b.taskId, prompt: "hello" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the first run to end");
    const firstSession = kinds(b.events, "run.session")[0];
    if (firstSession?.kind !== "run.session") throw new Error("unreachable");

    b.events.length = 0;
    await b.manager.start({ taskId: b.taskId, prompt: "resume-me please", resume: true });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the resumed run to end");

    const resumed = kinds(b.events, "run.session")[0];
    expect(resumed?.kind === "run.session" ? resumed.resumed : false).toBe(true);
    // The *same* session id came back, which is what "resume" has to mean to be worth claiming.
    expect(resumed?.kind === "run.session" ? resumed.sessionId : "").toBe(firstSession.sessionId);
    // And the agent's own answer proves which session it was talking to.
    expect(
      kinds(b.events, "run.output").some(
        (event) => event.kind === "run.output" && event.text === `session ${firstSession.sessionId}`,
      ),
    ).toBe(true);
  });

  it("writes a transcript that can be read back line by line", async () => {
    const b = await bench();
    const run = await b.manager.start({ taskId: b.taskId, prompt: "run a tool" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    const stored = b.manager.get(run.id);
    expect(stored?.status).toBe("done");
    const events = b.manager.events(run.id);
    expect(events.length).toBeGreaterThan(3);
    // `nextSeq` is what makes a reconnecting client cheap: it asks from here instead of re-fetching.
    const last = events[events.length - 1];
    expect(last && b.manager.events(run.id, last.seq)).toHaveLength(0);
  });
});

describe("one run per task", () => {
  it("refuses a second run in the same directory, and says what to do instead", async () => {
    const b = await bench();
    await b.manager.start({ taskId: b.taskId, prompt: "a slow task" });
    await b.until((events) => kinds(events, "run.output").length === 1, "the first chunk");

    // Two agents in one working tree is the failure a control plane exists to prevent.
    await expect(b.manager.start({ taskId: b.taskId, prompt: "another" })).rejects.toThrow(
      /already running/,
    );
  });
});

describe("the agent's own mode", () => {
  it("reaches the agent, and the agent confirms which one it is in", async () => {
    const b = await bench();
    await b.manager.start({ taskId: b.taskId, prompt: "mode-me", agentModeId: "plan" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    // The two halves of "the control does something real": the client sent `session/set_mode` (or the
    // fixture would have refused the handshake and failed the run), and the *agent* says which mode it
    // ended up in. Asserting only the request would pass on a client that sent the wrong parameter
    // name, which is precisely how a mode picker comes to be decorative.
    expect(said(b.events, "mode: plan")).toBe(true);
  });

  it("is not sent at all when the task has none, so an agent's own default is left alone", async () => {
    // The negative half: with no mode chosen, a client that always called `session/set_mode` would
    // override whatever the user configured in the agent itself. `default` here is the fixture's own
    // starting value, and nothing should have moved it.
    const b = await bench();
    await b.manager.start({ taskId: b.taskId, prompt: "mode-me" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    expect(said(b.events, "mode: default")).toBe(true);
    expect(said(b.events, "mode: plan")).toBe(false);
  });

  it("reuses the mode the task remembers, so a choice survives to the next run", async () => {
    const b = await bench();
    await b.store.updateTask({ id: b.taskId, agentModeId: "review" });

    await b.manager.start({ taskId: b.taskId, prompt: "mode-me" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    expect(said(b.events, "mode: review")).toBe(true);
  });

  it("refuses a mode the agent does not declare, before anything is spawned", async () => {
    const b = await bench();
    // The window can only offer ids from the wire, so this is a bug or a client built against a
    // different catalogue — either way the honest answer is a refusal, not a run in some other mode.
    const failure = await b.manager
      .start({ taskId: b.taskId, prompt: "hello", agentModeId: "bypassPermissions" })
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );

    expect(failure, "the run should have been refused").toBeDefined();
    expect(failure?.message).toContain('does not offer a mode called "bypassPermissions"');
    // Nothing ran: no process, no transcript, no rail row claiming to be working.
    expect(b.events).toEqual([]);
    expect(b.store.findTask(b.taskId)?.status).toBe("idle");
  });

  it("refuses a mode for an agent whose protocol has no way to be given one", async () => {
    // `deepseek-harness` is the real case: it speaks ACP, it has no `session/set_mode`, and asking for
    // plan mode would otherwise start an agent that edits files while the user believes it will not.
    const b = await bench({ harness: "deepseek-harness" });
    const failure = await b.manager
      .start({ taskId: b.taskId, prompt: "hello", agentModeId: "plan" })
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );

    expect(failure?.message).toContain("cannot be put into a mode");
    expect(b.events).toEqual([]);
  });

  it("fails the run when the agent itself refuses to be put into a mode", async () => {
    // The last line of defence, and the one the other two cannot cover: a harness whose catalogue says
    // it takes modes, an agent that answers `-32601` anyway (a build one version behind, a proxy in
    // between). Continuing would be a run in an unknown posture, so the run ends with the agent's own
    // words instead — the same treatment every other start-up failure gets.
    const b = await bench({ agentEnv: { FAKE_ACP_NO_SET_MODE: "1" } });
    await b.manager.start({ taskId: b.taskId, prompt: "hello", agentModeId: "plan" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to fail");

    const ended = kinds(b.events, "run.ended")[0];
    expect(ended?.kind === "run.ended" ? ended.status : "").toBe("failed");
    const note = kinds(b.events, "run.status").find(
      (event) => event.kind === "run.status" && event.status === "failed",
    );
    expect(note?.kind === "run.status" ? (note.note ?? "") : "").toContain("session/set_mode not supported");
    // And the work never started: no prompt reached the agent.
    expect(said(b.events, "mode:")).toBe(false);
  });

  it("carries a key a translated window can read, matching the English on the wire", async () => {
    // The same guarantee `daemon-errors-i18n.test.ts` makes for the handler table, for the two refusals
    // this file produces: a German user must read German, and an English one must read exactly the
    // sentence the daemon sent — which is why `en.ts` repeats it rather than paraphrasing it.
    const unsupported = await bench({ harness: "deepseek-harness" })
      .then((b) => b.manager.start({ taskId: b.taskId, prompt: "hi", agentModeId: "plan" }))
      .then(() => undefined, (error: unknown) => (error as Error).message);
    const unknown = await bench()
      .then((b) => b.manager.start({ taskId: b.taskId, prompt: "hi", agentModeId: "nope" }))
      .then(() => undefined, (error: unknown) => (error as Error).message);

    const render = (template: string, values: Record<string, string>): string =>
      template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : whole,
      );

    const cases: readonly [string | undefined, keyof typeof en, Record<string, string>][] = [
      [unsupported, "error.agentModeUnsupported", { harness: "DeepSeek Harness" }],
      [unknown, "error.agentModeUnknown", { harness: "Envoy Harness", mode: "nope" }],
    ];

    for (const [wire, key, values] of cases) {
      const ref = coderErrorRef(wire ?? "");
      expect(ref?.key, `${key} carried no key`).toBe(key);
      // A key the catalogue does not have is worse than none: it falls back to English while looking
      // translated in review.
      expect(isMessageKey(ref?.key ?? "")).toBe(true);
      expect(coderErrorCode(wire ?? "")).not.toBeNull();
      // …and the two sentences are the same sentence, with the same values in the same places.
      expect(coderErrorMessage(wire ?? ""), key).toBe(render(en[key], values));
    }
  });
});

/**
 * The model a run is started on.
 *
 * ## What only this layer can prove
 *
 * The two agents that can be launched take a model in two **different** ways, and the daemon decides
 * which — not the client, and not the caller. So the claim worth testing here is precisely that
 * distinction, and it takes both halves:
 *
 *   * for `deepseek-harness` the value is set on the session the agent just opened, and the agent's own
 *     report of its configuration is the only evidence that it arrived (`model-me`);
 *   * for `envoy-harness` the value travels in **argv** and `session/set_config_option` is never called —
 *     so the same probe must come back empty, or the two deliveries have both fired.
 *
 * `agent-catalog/test/models.test.ts` pins the flags and the encoding; `daemon-rpc.test.ts` runs the
 * whole path over a socket. What is here is the daemon's own decision, with a scripted agent that
 * answers, so a wrong decision fails as a refusal from the *agent* rather than as a passing assertion
 * about an object.
 */
describe("the model a run is started on", () => {
  it("is set on the session for the agent that takes one there, and the agent reports it back", async () => {
    const b = await bench({ harness: "deepseek-harness" });
    await b.manager.start({ taskId: b.taskId, prompt: "model-me", model: "deepseek/deepseek-chat" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    // The **opaque** value, exactly as the agent's own protocol wants it: a JSON array of the provider
    // and the model (`model-control.ts:235-237`). Asserting the reported value rather than the request
    // is what stops a client that sent the right ids under the wrong encoding from passing.
    expect(said(b.events, 'model: ["deepseek","deepseek-chat"]')).toBe(true);
    // And the run records the model the task asked for, in the same provider-qualified form the task
    // stores — so the window, the transcript and the agent all name one string.
    const started = kinds(b.events, "run.started")[0];
    expect(started && started.kind === "run.started" ? started.model : undefined).toBe(
      "deepseek/deepseek-chat",
    );
  });

  it("is taken from the task when the caller does not repeat it, so a choice survives a restart", async () => {
    const b = await bench({ harness: "deepseek-harness" });
    await b.store.updateTask({ id: b.taskId, model: "deepseek/deepseek-chat" });
    const run = await b.manager.start({ taskId: b.taskId, prompt: "model-me" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    expect(run.model).toBe("deepseek/deepseek-chat");
    expect(said(b.events, 'model: ["deepseek","deepseek-chat"]')).toBe(true);
  });

  it("leaves the session's configuration alone for the agent that reads it from argv", async () => {
    // The negative half, and the one that would catch a daemon that "helpfully" set both. For
    // `envoy-harness` the model is a pair of launch flags
    // (`../envoy-harness/packages/envoy-harness/src/cli/run/acp.ts:100-106`); calling
    // `session/set_config_option` at it as well would be a second, undocumented write against a
    // protocol that has no such method in its own dispatch, and the fixture reports the empty state
    // rather than accepting it silently.
    const b = await bench({ harness: "envoy-harness" });
    await b.manager.start({ taskId: b.taskId, prompt: "model-me", model: "anthropic/claude-sonnet-4-6" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    expect(said(b.events, "model: (none)")).toBe(true);
    // The run still knows which model it is on — that record is ours, not the agent's.
    const started = kinds(b.events, "run.started")[0];
    expect(started && started.kind === "run.started" ? started.model : undefined).toBe(
      "anthropic/claude-sonnet-4-6",
    );
  });

  it("refuses a model this agent does not publish, rather than starting on its own default", async () => {
    // **The failure that is invisible afterwards.** `envoy-harness` parses `--model` and then ignores
    // it unless `--provider` came too, and for `deepseek-harness` a wrong id would be refused later by
    // the agent — but a daemon that simply *dropped* a model it could not resolve would start an agent
    // on its own default while the transcript, the task and the window all named the user's choice.
    // So the refusal happens here, before a process exists, and it is keyed for a translated window.
    const b = await bench({ harness: "envoy-harness" });

    const wire = await b.manager
      .start({ taskId: b.taskId, prompt: "hi", model: "meta-llama/Llama-3-70b" })
      .then(() => undefined, (error: unknown) => (error as Error).message);

    const ref = coderErrorRef(wire ?? "");
    expect(ref?.key).toBe("error.modelUnknown");
    expect(ref?.values).toEqual({ harness: "Envoy Harness", model: "meta-llama/Llama-3-70b" });
    expect(isMessageKey(ref?.key ?? "")).toBe(true);
    expect(coderErrorMessage(wire ?? "")).toContain("does not publish a model");
    // Nothing was spawned and nothing was recorded: a refused run leaves no transcript to mislead
    // anybody reading the task afterwards.
    expect(kinds(b.events, "run.started")).toEqual([]);
    expect(b.events).toEqual([]);
  });

  it("refuses a model the agent takes but cannot be told, when the task's own default is not needed", async () => {
    // The other refusal code, and a different sentence: "this agent has no model" is not "we do not
    // know that model". `copilot` records no model flag at all.
    const b = await bench({ harness: "copilot" });
    const wire = await b.manager
      .start({ taskId: b.taskId, prompt: "hi", model: "openai/gpt-4o" })
      .then(() => undefined, (error: unknown) => (error as Error).message);

    expect(coderErrorRef(wire ?? "")?.key).toBe("error.modelUnsupported");
    expect(coderErrorMessage(wire ?? "")).toContain("does not take a model");
    expect(b.events).toEqual([]);
  });

  it("never sends a half-written model, so a free-text field cannot strand a run", async () => {
    // The `notProviderQualified` refusal, which is the one a user reaches by typing: free text is the
    // one control whose value we compose, and these agents need a provider to build a route at all.
    const b = await bench({ harness: "deepseek-harness" });
    const wire = await b.manager
      .start({ taskId: b.taskId, prompt: "hi", model: "deepseek-chat" })
      .then(() => undefined, (error: unknown) => (error as Error).message);

    expect(coderErrorRef(wire ?? "")?.key).toBe("error.modelNotProviderQualified");
    expect(b.events).toEqual([]);
  });

  it("is never sent when the task has none, so the agent's own default stands", async () => {
    const b = await bench({ harness: "deepseek-harness" });
    const run = await b.manager.start({ taskId: b.taskId, prompt: "model-me" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    expect(run.model).toBeUndefined();
    // Not "the first model we know about", and not an empty string: an agent whose model nobody chose
    // runs on whatever it is configured with, and a control plane that named a default it did not
    // choose would be describing somebody else's decision as its own.
    expect(said(b.events, "model: (none)")).toBe(true);
  });
});
