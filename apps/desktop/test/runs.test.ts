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

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { HarnessId, RunEvent } from "@envoydev/protocol";
import { coderErrorCode, coderErrorMessage, coderErrorRef } from "@envoydev/protocol";
import { coderPaths } from "@envoydev/host-bridge";

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
  const home = await mkdtemp(join(tmpdir(), "envoydev-m2-"));
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
    // The fixture's `session/set_mode` reads the peer's `{mode}`, so this bench declares that — the same
    // field name the catalogue records for `envoy-harness`. It is neither optional nor defaulted:
    // `AcpClient.setMode` refuses to send a mode for an agent whose field name nobody wrote down, which
    // is what keeps a mode from being applied to a field the agent ignores (see `AcpLaunch.modeParam`).
    modeParam: "mode",
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
    // `needs-attention` is not folded into `running` (`docs/envoydev-ui.md` §4).
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
    // agent whose surface cannot answer (`docs/envoydev-harness.md` §1).
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

    // The thinking level's refusal belongs in this list rather than in a test of its own: the property
    // is "the English on the wire is the entry in the catalogue", and a fourth case is a line here
    // instead of a fourth near-identical assertion.
    const thinking = await bench({ harness: "envoy-harness" })
      .then((b) => b.manager.start({ taskId: b.taskId, prompt: "hi", thinkingLevel: "max" }))
      .then(() => undefined, (error: unknown) => (error as Error).message);

    const cases: readonly [string | undefined, keyof typeof en, Record<string, string>][] = [
      [unsupported, "error.agentModeUnsupported", { harness: "DeepSeek Harness" }],
      [unknown, "error.agentModeUnknown", { harness: "Envoy Harness", mode: "nope" }],
      [thinking, "error.thinkingUnsupported", { harness: "Envoy Harness" }],
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
 * "Ask before anything destructive", end to end — the row settings slice 1 exists for.
 *
 * ## Why this belongs in the daemon's own tests rather than beside the settings object
 *
 * The setting is an app preference; the *effect* is a session method on the agent, and only a real
 * child process can show that the preference arrived. A test asserting the stored object, or that the
 * daemon called `session/set_policy` with something, would pass on a daemon that sent the wrong value
 * to the wrong agent — and "the switch stored a preference nothing read" is the exact defect
 * `docs/settings-parity.md` §7.1 recorded for this field.
 *
 * Three cases, and the third is the one that keeps the settings pane honest:
 *
 *   * **on** (the shipped default) → `autoRun: "always-confirm"`, with the agent's own report as the
 *     evidence rather than the request we sent;
 *   * **off** → `autoRun: "off"`, because a user who turns the switch off is asking the agent to stop
 *     asking, and a daemon that only ever sent the strict value would be a switch with one position;
 *   * **an agent the catalogue says cannot be told** → **no call at all**. The fixture refuses
 *     `session/set_policy` with `-32601` here, so a daemon that sent one anyway would fail this run;
 *     the run finishing is what the disabled row's reason ("it has no way to be told") claims.
 */
describe("whether the agent asks before it acts", () => {
  it("is handed to the agent as its own policy, and the agent reports the posture it is in", async () => {
    const b = await bench();
    const run = await b.manager.start({ taskId: b.taskId, prompt: "policy-me" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    // The shipped default is `requireApprovalForDestructive: true` and the mapping is
    // `resolveApprovalPolicy`'s. A run that sent no policy at all reports `(none)` — the peer's own
    // "unset" state — so this assertion fails for the defect rather than for a formatting change.
    expect(run.harness).toBe("envoy-harness");
    expect(said(b.events, "autoRun: always-confirm")).toBe(true);
  });

  it("stops the agent asking when the user turns the switch off", async () => {
    const b = await bench();
    // The daemon's own store, not a caller's argument: the preference is about this machine, so a task
    // started from a second window or from the phone has to be governed by the same one.
    await b.store.updateSettings({ requireApprovalForDestructive: false });

    await b.manager.start({ taskId: b.taskId, prompt: "policy-me" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    expect(said(b.events, "autoRun: off")).toBe(true);
    expect(said(b.events, "autoRun: always-confirm")).toBe(false);
  });

  it("is not sent at all to an agent that has no way to be told, and the run still works", async () => {
    // `deepseek-harness` is the real case: nine ACP methods, `session/set_policy` not among them. The
    // switch is disabled with a reason on screen; this is the other half — the daemon must not send the
    // call anyway and fail every task on that agent. `FAKE_ACP_NO_SET_POLICY` is what makes the
    // negative testable: were the daemon to send one, the handshake would fail and this run would not
    // reach `done`.
    const b = await bench({
      harness: "deepseek-harness",
      agentEnv: { FAKE_ACP_NO_SET_POLICY: "1" },
    });
    await b.manager.start({ taskId: b.taskId, prompt: "policy-me" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    const ended = kinds(b.events, "run.ended")[0];
    expect(ended?.kind === "run.ended" ? ended.status : "").toBe("done");
    expect(said(b.events, "autoRun: (none)")).toBe(true);
  });

  it("fails the run when the agent refuses, rather than running in an unknown posture", async () => {
    // **What makes the test above a test.** An agent the catalogue says takes a policy, and a peer that
    // answers `-32601` anyway — a build a version behind, or a proxy in between. A run whose posture
    // silently failed to apply would report an approval setting it is not in, so it ends with the
    // agent's own words instead. Without this case, the previous one would pass just as well against a
    // fixture that accepted `session/set_policy` from anyone.
    const b = await bench({ agentEnv: { FAKE_ACP_NO_SET_POLICY: "1" } });
    await b.manager.start({ taskId: b.taskId, prompt: "policy-me" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to fail");

    const ended = kinds(b.events, "run.ended")[0];
    expect(ended?.kind === "run.ended" ? ended.status : "").toBe("failed");
    const note = kinds(b.events, "run.status").find(
      (event) => event.kind === "run.status" && event.status === "failed",
    );
    expect(note?.kind === "run.status" ? (note.note ?? "") : "").toContain(
      "session/set_policy not supported",
    );
    // And the turn never ran: a prompt answered under a posture we failed to set is the outcome this
    // whole ordering exists to prevent.
    expect(said(b.events, "autoRun:")).toBe(false);
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
    const b = await bench({ harness: "deepseek-harness", agentEnv: { FAKE_ACP_PUBLISH_OPTIONS: "1" } });
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

/**
 * The thinking level a run is started at, and what the session tells us back.
 *
 * ## What only this layer can prove
 *
 * `agent-catalog/test/session-options.test.ts` pins the catalogue — which agent takes a level, through
 * which config id, and which state the pill is in. What it cannot pin is the **wire**: that the value
 * actually reaches a process, in the agent's own encoding, on the same session the model was set on.
 * So this drives the scripted agent and reads back what its session was configured with, which is the
 * only evidence that distinguishes a level that arrived from one a client believed it had sent.
 *
 * The other half is the observation. A run is the *only* place the daemon can learn what an agent
 * offers — a session is the only thing that knows — so the record it leaves behind is part of the run's
 * behaviour, and it is asserted here rather than inferred from a UI test.
 */
describe("the thinking level a run is started at", () => {
  it("reaches the session for the agent that takes one there, and the agent reports it back", async () => {
    const b = await bench({ harness: "deepseek-harness", agentEnv: { FAKE_ACP_PUBLISH_OPTIONS: "1" } });
    const run = await b.manager.start({
      taskId: b.taskId,
      prompt: "thinking-me",
      thinkingLevel: "max",
    });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    // The agent's own id, passed through verbatim: a level we prettified or translated would be one the
    // agent refuses, and the refusal would arrive after the process existed rather than here.
    expect(said(b.events, "thinking: max")).toBe(true);
    // And the run records what it asked for, so a transcript can say what depth the agent worked at
    // rather than leaving a reader to infer it.
    expect(run.thinkingLevel).toBe("max");
    const started = kinds(b.events, "run.started")[0];
    expect(started && started.kind === "run.started" ? started.thinkingLevel : undefined).toBe("max");
  });

  it("applies the model before the level, because the agent derives one from the other", async () => {
    // **The ordering is the agent's, not ours.** `dsh-acp` builds the thinking option from the model the
    // session resolved (`info.reasoning` for the current route, lib/index.js:494-508), so the levels a
    // level is validated against belong to the model the session is *now* on. The fixture reproduces
    // that: `ultra` exists only on the stronger model, so a client that sent the level first is refused
    // by the agent — which is why this test can tell the two orders apart at all.
    const b = await bench({ harness: "deepseek-harness", agentEnv: { FAKE_ACP_PUBLISH_OPTIONS: "1" } });
    await b.manager.start({
      taskId: b.taskId,
      prompt: "thinking-me",
      model: "fake/pro",
      thinkingLevel: "ultra",
    });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    expect(said(b.events, "thinking: ultra")).toBe(true);
    const failed = kinds(b.events, "run.status").filter((event) => event.kind === "run.status" && event.status === "failed");
    expect(failed).toEqual([]);
    // Both landed on one session, which is the other property that matters: two `set_config_option`
    // calls, not one call that overwrote the other.
    expect(kinds(b.events, "run.session")).toHaveLength(1);
  });

  it("is taken from the task when the caller does not repeat it, so a choice survives a restart", async () => {
    const b = await bench({ harness: "deepseek-harness", agentEnv: { FAKE_ACP_PUBLISH_OPTIONS: "1" } });
    await b.store.updateTask({ id: b.taskId, thinkingLevel: "off" });
    const run = await b.manager.start({ taskId: b.taskId, prompt: "thinking-me" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    expect(run.thinkingLevel).toBe("off");
    expect(said(b.events, "thinking: off")).toBe(true);
  });

  it("refuses a level for an agent with no thought-level method, before anything is spawned", async () => {
    // `envoy-harness` has none — verified against the built peer, whose `session/set_config_option`
    // answers `-32601 method not found`. Sending one anyway would mean an agent that answers while
    // thinking for less time than the user asked for, which is invisible in a transcript; the refusal
    // names the agent rather than the level, because nothing the user could type would help.
    const b = await bench({ harness: "envoy-harness" });
    const wire = await b.manager
      .start({ taskId: b.taskId, prompt: "hi", thinkingLevel: "max" })
      .then(() => undefined, (error: unknown) => (error as Error).message);

    expect(coderErrorRef(wire ?? "")?.key).toBe("error.thinkingUnsupported");
    expect(coderErrorMessage(wire ?? "")).toContain("cannot be given a thinking level");
    // Nothing was spawned and nothing was recorded: a refused run leaves no transcript to mislead
    // anybody reading the task afterwards.
    expect(b.events).toEqual([]);
  });

  it("sends nothing when no level was chosen, so the agent's own depth stands", async () => {
    const b = await bench({ harness: "deepseek-harness", agentEnv: { FAKE_ACP_PUBLISH_OPTIONS: "1" } });
    const run = await b.manager.start({ taskId: b.taskId, prompt: "thinking-me" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    expect(run.thinkingLevel).toBeUndefined();
    // `""` is the control's "the agent's own default" and is not a level: the request never goes out, so
    // the agent keeps whatever it decides for itself.
    expect(said(b.events, "thinking: (none)")).toBe(true);
  });

  it("does not refuse a level the observed list does not have, and lets the agent say so instead", async () => {
    // **The deliberate limit of our own validation.** The list a user picks from is a record of an
    // earlier session, built for the model that session resolved, so treating it as a whitelist would
    // veto a value the agent would have accepted. The agent validates its own values, refuses loudly,
    // and this asserts that the refusal we surface is *its* sentence rather than ours.
    const b = await bench({
      harness: "deepseek-harness",
      agentEnv: { FAKE_ACP_PUBLISH_OPTIONS: "1", FAKE_ACP_REFUSE_THINKING: "max" },
    });
    await b.manager.start({ taskId: b.taskId, prompt: "thinking-me", thinkingLevel: "max" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    const failed = kinds(b.events, "run.status")[0];
    const note = failed && failed.kind === "run.status" ? (failed.note ?? "") : "";
    expect(note).toMatch(/unknown reasoning effort/);
    // **Not keyed, and that is the boundary rather than an omission.** A catalogue key exists for a
    // sentence *we* author, so a translated window can render our refusal in the user's language; this
    // sentence is the agent's own words about its own option, and a key would mean inventing a
    // translation for somebody else's product. The same rule the approval prompt's option labels follow.
    expect(coderErrorRef(note)).toBeUndefined();
    // A failed run that still produced output would mean the level had been dropped rather than refused.
    expect(b.events.filter((event) => event.kind === "run.output")).toEqual([]);
  });
});

/**
 * What a session teaches the daemon, and what it leaves behind for the next window.
 *
 * The options a session offers are knowable **only** from a session, so a run is the one moment the
 * daemon can learn them. It writes them down per agent with the time it saw them, and the window
 * renders that for the *next* run — the arrangement the whole control row's honesty rests on, since
 * nothing else can tell a user whether a list is current.
 */
describe("what a run learns about the agent", () => {
  it("records the options a session published, with the time and the session it saw them in", async () => {
    const b = await bench({ harness: "deepseek-harness", agentEnv: { FAKE_ACP_PUBLISH_OPTIONS: "1" } });
    await b.manager.start({ taskId: b.taskId, prompt: "hello" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    const observed = b.store.sessionOptions("deepseek-harness");
    expect(observed, "the run recorded nothing").toBeDefined();
    expect(observed?.options.map((option) => option.configId)).toEqual(["model", "reasoning_effort"]);
    // The agent's own ids and category, kept verbatim: the mapping to a control is ours, and the record
    // is of what the agent said rather than of how we interpreted it.
    expect(observed?.options[1]?.category).toBe("thought_level");
    // The session it came from, so a maintainer can trace one record back to one run.
    expect(observed?.sessionId).toMatch(/fake-session-/);
    expect(Number.isNaN(Date.parse(observed?.observedAt ?? ""))).toBe(false);
  });

  it("records a session that published nothing, which is not the same as not having looked", async () => {
    // The default fixture publishes nothing — the shape `envoy-harness` produces in real life (its
    // `session/new` answers `{sessionId}` alone). The record must still exist: "we opened a session and
    // it offered nothing" is a fact about the agent, and it is what turns the thinking pill's disabled
    // state into a statement about the agent rather than about our ignorance.
    const b = await bench({ harness: "deepseek-harness" });
    await b.manager.start({ taskId: b.taskId, prompt: "hello" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    const observed = b.store.sessionOptions("deepseek-harness");
    expect(observed).toBeDefined();
    expect(observed?.options).toEqual([]);
  });

  it("records what the session said *after* a change, which is the state a picker should offer", async () => {
    // The method answers with the complete resulting option state rather than an acknowledgement, and
    // that return value is the more accurate answer for an option derived from the model: `dsh-acp`
    // rebuilds the thinking list for whatever model the session now resolves. A client that ignored the
    // echo would offer the levels of the model the agent *started* on.
    const b = await bench({ harness: "deepseek-harness", agentEnv: { FAKE_ACP_PUBLISH_OPTIONS: "1" } });
    await b.manager.start({ taskId: b.taskId, prompt: "hello", model: "fake/pro", thinkingLevel: "max" });
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end");

    const observed = b.store.sessionOptions("deepseek-harness");
    expect(observed?.options.map((option) => option.configId)).toEqual(["model", "reasoning_effort"]);
    // **The stronger model's levels, not the ones `session/new` advertised.** The session opened on the
    // agent's default route (`flash`, four levels) and then changed to `pro`, whose levels are a
    // different list — so this asserts the echo was read, and a client that kept only what the session
    // first said would offer a user `off` on a model that has no such level.
    expect(observed?.options[1]?.values.map((value) => value.value)).toEqual(["high", "max", "ultra"]);
  });

  it("keeps a session that published options from being overwritten by one that published none", async () => {
    // Two runs on the same agent, and the second is a *resume*: both of ours answer `session/resume`
    // with little more than the session id. Recording that would replace a full list with an empty one,
    // which is the difference between a picker and "this agent offers nothing" — so a resume is
    // deliberately not recorded at all.
    const b = await bench({ harness: "deepseek-harness", agentEnv: { FAKE_ACP_PUBLISH_OPTIONS: "1" } });
    await b.manager.start({ taskId: b.taskId, prompt: "hello" });
    await b.until((events) => kinds(b.events, "run.ended").length === 1, "the first run to end");
    const first = b.store.sessionOptions("deepseek-harness");
    expect(first?.options).toHaveLength(2);

    await b.manager.start({ taskId: b.taskId, prompt: "hello again", resume: true });
    await b.until((events) => kinds(b.events, "run.ended").length === 2, "the second run to end");

    const after = b.store.sessionOptions("deepseek-harness");
    expect(after?.options).toHaveLength(2);
    expect(after?.observedAt).toBe(first?.observedAt);
  });
});

/**
 * The record on disk, which is the only reason a window can show a list before a run exists.
 *
 * `runs.test.ts`'s tests above prove a run *records*; this proves the record **survives the process**,
 * because that is its entire purpose: the window that renders the picker is usually a different process
 * from the run that learned the options, and sometimes a different launch of the app. Two rules of the
 * store are asserted here too, because this file is data a user can lose if they are wrong: the newest
 * observation replaces the oldest per agent (a merge would offer a level the agent has dropped), and an
 * unreadable file is quarantined rather than overwritten.
 */
describe("the record of what agents published, on disk", () => {
  const AT = "2026-09-14T05:23:00.000Z";

  it("is readable by the next process, which is the only reason it is written down", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-observed-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const paths = coderPaths(home);

    const first = await CoderStore.open({ paths });
    await first.recordSessionOptions({
      harness: "deepseek-harness",
      observedAt: AT,
      sessionId: "sess-1",
      options: [
        {
          configId: "reasoning_effort",
          label: "Reasoning effort",
          category: "thought_level",
          values: [{ value: "high", label: "High", description: "The default balance." }],
        },
      ],
    });

    // A second store over the same directory: a fresh launch of the app, or the daemon the window
    // reconnects to. Nothing is kept in memory between the two.
    const second = await CoderStore.open({ paths });
    const observed = second.sessionOptions("deepseek-harness");
    expect(observed?.sessionId).toBe("sess-1");
    expect(observed?.observedAt).toBe(AT);
    expect(observed?.options[0]?.values[0]?.label).toBe("High");
    // And an agent nothing has been recorded for answers `undefined`, which the wire carries as
    // "nothing has told us yet" rather than as "it has none".
    expect(second.sessionOptions("envoy-harness")).toBeUndefined();
    // Nothing was quarantined on the way in: a file this daemon wrote is a file it can read.
    expect(second.notes().quarantined).toEqual([]);
    expect(second.notes().skipped).toEqual([]);
  });

  it("replaces an agent's record rather than merging it, so a dropped level stops being offered", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-observed-replace-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const store = await CoderStore.open({ paths: coderPaths(home) });

    const option = (values: string[]) => ({
      configId: "reasoning_effort",
      label: "Reasoning effort",
      category: "thought_level",
      values: values.map((value) => ({ value, label: value })),
    });
    await store.recordSessionOptions({
      harness: "deepseek-harness",
      observedAt: AT,
      options: [option(["low", "high", "max"])],
    });
    await store.recordSessionOptions({
      harness: "deepseek-harness",
      observedAt: "2026-09-15T05:23:00.000Z",
      options: [option(["off", "low"])],
    });

    const observed = store.sessionOptions("deepseek-harness");
    // **Replaced, not unioned.** An agent that has stopped offering `max` must be able to stop being
    // offered it: a union of everything ever seen would offer a value the agent now refuses, which is
    // the one failure this control row exists to prevent.
    expect(observed?.options[0]?.values.map((value) => value.value)).toEqual(["off", "low"]);
    expect(observed?.observedAt).toBe("2026-09-15T05:23:00.000Z");
    // One entry per agent, not one per run.
    expect(await CoderStore.open({ paths: coderPaths(home) }).then((s) => s.sessionOptions("deepseek-harness"))).toBeDefined();
  });

  it("moves a file it cannot read aside instead of starting over on top of it", async () => {
    // The store's own rule, applied to this file: what it holds is *evidence* about other products, so
    // silently overwriting a corrupt one would leave a user with a text field where a picker used to be
    // and no explanation. The bytes are kept, beside the original, under a name a backup tool includes.
    const home = await mkdtemp(join(tmpdir(), "envoydev-observed-corrupt-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const paths = coderPaths(home);
    await CoderStore.open({ paths });
    await writeFile(paths.sessionOptionsFile, "{ this is not json", "utf8");

    const store = await CoderStore.open({ paths });
    expect(store.sessionOptions("deepseek-harness")).toBeUndefined();
    const [note] = store.notes().quarantined;
    expect(note?.file).toContain("session-options.json");
    expect(note?.reason).toMatch(/not readable as JSON/);
    // The bytes survive, in the same directory — the difference between preserving them and losing them.
    expect(await readFile(note!.movedTo, "utf8")).toBe("{ this is not json");
  });
});
