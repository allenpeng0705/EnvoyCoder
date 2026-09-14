/**
 * The ACP client against a real agent process.
 *
 * ## Why this runs the real binary
 *
 * `runs.test.ts` uses a scripted agent, which is what makes approvals, cancellation and resume
 * deterministic — and it is also, by construction, an agent that behaves the way *we* wrote it. That
 * is fine for semantics and useless for the transport: framing, argv, the handshake's exact shapes
 * and the teardown are all things a fixture cannot disagree with us about, because we wrote both
 * sides of it.
 *
 * So this file drives `dsh --profile acp` — the real binary, from DeepSeek's harness — over a real
 * pipe. It is the check the roadmap means by "the adapter is proven against a real subprocess".
 *
 * ## Two honest limitations, stated rather than hidden
 *
 *   * **It skips when `dsh` is not installed**, because an agent is the *user's* install
 *     (`docs/envoycoder-harness.md`), not something this repository vendors. The skip is loud in the
 *     output; a skipped test that looks like a pass is worse than no test.
 *   * **A successful model turn is not asserted**, because it needs credentials this machine does
 *     not have. What *is* asserted is the failure path — and that path is not a consolation prize:
 *     "the agent answered with a JSON-RPC error, and we surfaced it" is the first thing a real user
 *     meets on a fresh machine, and the text they get is the difference between fixing it and giving
 *     up. `RUN_LIVE_ACP=1` asserts the successful turn for a machine that does have a key.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findBinary } from "@envoycoder/platform";
import { probeHarness, resolveHarnessCommand, sessionFacts } from "@envoycoder/agent-catalog";
import { coderPaths } from "@envoycoder/host-bridge";

import { AcpClient, type AcpUpdate } from "../src/daemon/acp/client.js";
import { SessionProbe } from "../src/daemon/session-probe.js";
import { CoderStore } from "../src/daemon/store.js";

const dsh = findBinary("dsh");
/**
 * The built-in harness, which may be a global command or the **peer checkout**.
 *
 * Both are first-class: the harness is a peer the product clones (design D4, guide §7.5), so a
 * development machine legitimately has it built and not installed. The probe is what decides, which
 * is the same decision the daemon makes before it spawns anything.
 */
const builtInProbe = probeHarness("envoy-harness");
const live = process.env.RUN_LIVE_ACP === "1";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  // **Last in, first out.** Teardown order is not cosmetic here: the agent process must be stopped
  // before its home directory is removed, or the removal races the agent still writing into it —
  // which shows up as `ENOTEMPTY` in the *setup* of the next test rather than as the ordering bug it
  // is. Registration order is "create the world, then start the thing in it", so reverse is right.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function workdir(): Promise<{ cwd: string; dshHome: string; cleanup: () => Promise<void> }> {
  const cwd = await mkdtemp(join(tmpdir(), "envoycoder-acp-work-"));
  const dshHome = await mkdtemp(join(tmpdir(), "envoycoder-acp-home-"));
  const cleanup = async (): Promise<void> => {
    await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(dshHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  };
  cleanups.push(cleanup);
  return { cwd, dshHome, cleanup };
}

describe.skipIf(!dsh)("the ACP client, against the real dsh binary", () => {
  it("handshakes, opens a session, and says who the agent is", async () => {
    const { cwd, dshHome } = await workdir();
    const updates: AcpUpdate[] = [];

    const client = await AcpClient.start({
      launch: {
        command: dsh as string,
        args: ["--profile", "acp"],
        cwd,
        // A home of our own: EnvoyCoder must never write into the state a user's own `dsh` owns.
        env: { DSH_HOME: dshHome },
      },
      onUpdate: (update) => updates.push(update),
      // The handshake is the part under test; a prompt is not sent here.
      requestTimeoutMs: 60_000,
    });
    cleanups.push(async () => client.stop());

    // The identity is the agent's, reported by the agent — which is how the run's `run.session`
    // event knows what it is talking to rather than assuming.
    expect(client.agentInfo?.name).toBe("deepseek-harness-acp");
    expect(client.agentInfo?.protocolVersion).toBe(1);
    expect(client.sessionId).toMatch(/[0-9a-f-]{8,}/);
  }, 90_000);

  it("reports a missing credential as a readable failure, not as silence", async () => {
    const { cwd, dshHome } = await workdir();
    const client = await AcpClient.start({
      launch: { command: dsh as string, args: ["--profile", "acp"], cwd, env: { DSH_HOME: dshHome } },
      requestTimeoutMs: 120_000,
    });
    cleanups.push(async () => client.stop());

    let error: Error | undefined;
    try {
      await client.prompt("Say only the word ok, and nothing else.");
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }

    if (!error) {
      // On a machine with credentials the turn genuinely ran. That is the better outcome; assert the
      // weaker thing that must still hold.
      expect(client.sessionId).toBeTruthy();
      return;
    }

    // The exact failure this machine produces, and the shape a user meets on a fresh install: the
    // agent's own sentence, naming the variable to set. An adapter that swallowed this would leave
    // the window showing a task that never starts and never explains itself.
    expect(error.message).toMatch(/session\/prompt|turn failed|api key|credential/i);
  }, 180_000);

  it.skipIf(!live)("runs a real turn when credentials are available (RUN_LIVE_ACP=1)", async () => {
    const { cwd, dshHome } = await workdir();
    const updates: AcpUpdate[] = [];
    const client = await AcpClient.start({
      launch: { command: dsh as string, args: ["--profile", "acp"], cwd, env: { DSH_HOME: dshHome } },
      onUpdate: (update) => updates.push(update),
      requestTimeoutMs: 300_000,
    });
    cleanups.push(async () => client.stop());

    const result = await client.prompt("Write the single word: hello");
    expect(result.stopReason).not.toBe("unknown");
    expect(updates.length).toBeGreaterThan(0);
    // Every update carries a kind this build either renders or deliberately drops; what must never
    // happen is an update with no kind at all, which would be a framing bug.
    for (const update of updates) expect(typeof update.sessionUpdate).toBe("string");
  }, 360_000);

  it("names the real agent's own session-config method, and gets its own refusal for a model it lacks", async () => {
    // **Why this test is worth having even though it always fails to set a model.** The one thing about
    // the model path that a fixture cannot prove is the *method name*: a client that sent
    // `session/setConfigOption` — the same name in camelCase, which is what every source file uses —
    // would look perfect against our fixture and be answered `method not found` by the real agent, on a
    // user's machine, only when they first picked a model.
    //
    // So the assertion is about *which* refusal comes back. A deliberately impossible value is sent, and
    // the agent must answer with its own configuration error (unknown model option / no model selection)
    // rather than a transport-level "unsupported". Credential-independent on purpose: the refusal
    // happens before any provider is called, so this holds on a machine with no keys at all — which is
    // exactly why it can run in CI for everyone rather than behind `RUN_LIVE_ACP`.
    const { cwd, dshHome } = await workdir();

    let error: Error | undefined;
    try {
      const client = await AcpClient.start({
        launch: { command: dsh as string, args: ["--profile", "acp"], cwd, env: { DSH_HOME: dshHome } },
        requestTimeoutMs: 120_000,
        // The encoding the catalogue builds: a JSON array of provider and model
        // (`model-control.ts:235-237`). The provider here is one no catalog has, so the agent must say so.
        sessionConfigs: [{ configId: "model", value: JSON.stringify(["envoycoder", "no-such-model"]) }],
      });
      cleanups.push(async () => client.stop());
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }

    expect(error, "the real agent accepted a model it cannot have").toBeDefined();
    expect(error!.message).toMatch(/unknown model option|no model selection/i);
    // The distinction that matters: not a protocol-level refusal, which is what a wrong method name or
    // a wrong parameter shape would produce.
    expect(error!.message).not.toMatch(/not supported|method not found|-32601/i);
  }, 180_000);


  it("publishes a thought level, and accepts a change to it with the agent's own config id", async () => {
    // **The one thing about the thinking level that a fixture cannot prove**: the config id.
    // `reasoning_effort` and the ACP category `thought_level` were read out of the installed package
    // (`@deepseek-ai/dsh-acp`, `lib/index.js:306`, `:494-508`), and a wrong id would look perfect
    // against our fixture — which we wrote — and be answered `unknown session config option` here, on a
    // user's machine, only when they first picked a level.
    //
    // Credential-independent on purpose: the option state is built before any provider is called, so
    // this holds on a machine with no API keys at all — which is why it can run for everyone rather
    // than behind `RUN_LIVE_ACP`.
    const { cwd, dshHome } = await workdir();
    const client = await AcpClient.start({
      launch: { command: dsh as string, args: ["--profile", "acp"], cwd, env: { DSH_HOME: dshHome } },
      requestTimeoutMs: 60_000,
    });
    cleanups.push(async () => client.stop());

    const options = client.sessionConfigOptions() as {
      id?: unknown;
      category?: unknown;
      type?: unknown;
      options?: { value?: unknown; name?: unknown; description?: unknown }[];
    }[];
    const thought = options.find((option) => option.category === "thought_level");
    expect(thought, "the real agent published no thought-level option").toBeDefined();
    // The agent's own id, which is what the catalogue sends with: the field is the *contract* between
    // `HARNESS_THINKING_DELIVERY` and this binary.
    expect(thought?.id).toBe("reasoning_effort");
    expect(thought?.type).toBe("select");
    // Real values with real names, which is why the pill can show the agent's own words rather than
    // ours: these are the strings the agent validates a change against.
    const values = (thought?.options ?? []).map((option) => option.value);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => typeof value === "string")).toBe(true);

    // And a change with that id is **accepted**, which is the half a name alone cannot prove: the
    // catalogue's own delivery goes through `sessionConfigs`, so this is the daemon's real path.
    const accepted = await AcpClient.start({
      launch: { command: dsh as string, args: ["--profile", "acp"], cwd, env: { DSH_HOME: dshHome } },
      requestTimeoutMs: 60_000,
      sessionConfigs: [{ configId: "reasoning_effort", value: String(values[0]) }],
    });
    cleanups.push(async () => accepted.stop());
    expect(accepted.sessionId).toBeTruthy();
  }, 180_000);

  it("refuses an unknown level with its own sentence, rather than accepting anything", async () => {
    // The other half of the same fact, and the reason free validation is not enough: the agent looks the
    // value up in the state it advertised and refuses anything else. That refusal is what a user meets
    // when an observed list is out of date — our own validation deliberately does not veto a level, so
    // this is the loud failure the design relies on.
    const { cwd, dshHome } = await workdir();

    let error: Error | undefined;
    try {
      const client = await AcpClient.start({
        launch: { command: dsh as string, args: ["--profile", "acp"], cwd, env: { DSH_HOME: dshHome } },
        requestTimeoutMs: 60_000,
        sessionConfigs: [{ configId: "reasoning_effort", value: "envoycoder-not-a-level" }],
      });
      cleanups.push(async () => client.stop());
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }

    expect(error, "the real agent accepted a level it does not offer").toBeDefined();
    expect(error!.message).toMatch(/unknown reasoning effort/i);
    // Not a protocol-level refusal: `method not found` or `-32601` would mean the id or the parameter
    // shape is wrong, which is exactly what this pair of tests is here to tell apart.
    expect(error!.message).not.toMatch(/not supported|method not found|-32601/i);
  }, 180_000);

  it("stops the process, so a cancelled run leaves nothing behind", async () => {
    const { cwd, dshHome } = await workdir();
    const client = await AcpClient.start({
      launch: { command: dsh as string, args: ["--profile", "acp"], cwd, env: { DSH_HOME: dshHome } },
      requestTimeoutMs: 60_000,
    });

    await client.stop();
    // After `stop`, the client refuses new work rather than writing into a dead pipe — the
    // difference between a cancelled run and a crashed daemon.
    await expect(client.prompt("anything")).rejects.toThrow(/no longer running/);
    // Idempotent: a daemon shutting down may race its own teardown.
    await client.stop();
  }, 90_000);

  it("tears down once when two callers ask at the same moment", async () => {
    // **The race this repo has actually seen.** A run's own `finally` stops the client it started while
    // `RunManager.stopAll` is stopping every live client for shutdown: two callers, one process. Before
    // this was pinned, each caller got its own promise, both passed the `stopped` check, and the second
    // sent `session/close` down a stdin the first had already ended — the intermittent
    // `ERR_STREAM_WRITE_AFTER_END` that can make the vitest *process* leave 1 under load without failing
    // any one test, which is exactly why it is worth a test of its own rather than a comment.
    const { cwd, dshHome } = await workdir();
    const client = await AcpClient.start({
      launch: { command: dsh as string, args: ["--profile", "acp"], cwd, env: { DSH_HOME: dshHome } },
      requestTimeoutMs: 60_000,
    });

    const first = client.stop();
    const second = client.stop();
    // One teardown, so one promise: this is the mechanism, and it is observable.
    expect(second).toBe(first);
    await Promise.all([first, second]);
    await expect(client.prompt("anything")).rejects.toThrow(/no longer running/);
  }, 90_000);
});

describe.skipIf(builtInProbe.state !== "ready")("the ACP client, against the real built-in harness", () => {
  /**
   * The *second* native harness, and the one that produces a **successful** turn on this machine.
   *
   * `dsh` needs a model credential and this box has none, so its test necessarily ends at the failure
   * path — which is worth having, but it leaves "a real agent turn completes" unproven. The built-in
   * harness needs no credential (it says so itself: `--acp using demo backend`), so this is where a
   * whole turn is asserted: handshake, session, prompt accepted, `end_turn`, clean stop.
   *
   * It also proves the *dialect* fallback. The two harnesses do not agree on how a prompt is shaped:
   * `dsh` takes the standard `prompt: [{type:"text", …}]`, the built-in one rejects it with
   * `-32602 text required` and wants a flat string
   * (`../envoy-harness/packages/envoy-harness/src/protocol/acp-params.ts:120-133`). One client has to
   * drive both, and the retry in `AcpClient.prompt` is what makes that true.
   */
  it("completes a turn — including the prompt-shape fallback the two harnesses need", async () => {
    const { cwd } = await workdir();
    const resolved = resolveHarnessCommand(
      "envoy-harness",
      builtInProbe,
      { prompt: "", cwd },
    );

    const client = await AcpClient.start({
      launch: { command: resolved.command, args: resolved.args, cwd },
      requestTimeoutMs: 120_000,
    });
    cleanups.push(async () => client.stop());

    expect(client.agentInfo?.name).toBe("envoy-harness");
    expect(client.sessionId).toBeTruthy();

    const result = await client.prompt("say hello to the control plane");
    // `end_turn`, not `cancelled` and not a thrown error: the turn was accepted and finished. This is
    // the assertion `dsh` cannot make without a credential.
    expect(result.stopReason).toBe("end_turn");
  }, 180_000);

  it("publishes no session configuration options at all — the fact the thinking pill's reason rests on", async () => {
    // **Verified against the built peer rather than inferred from its source.** The catalogue says
    // `envoy-harness` has no thought-level method (`capabilities.thinking: false`), and the window
    // disables the pill with a sentence about the *agent* on the strength of it. That claim has two
    // halves and this test is the first: a session it opens offers nothing, so there is no level (or
    // model) for a picker to list.
    const { cwd } = await workdir();
    const resolved = resolveHarnessCommand("envoy-harness", builtInProbe, { prompt: "", cwd });

    const client = await AcpClient.start({
      launch: { command: resolved.command, args: resolved.args, cwd },
      requestTimeoutMs: 60_000,
    });
    cleanups.push(async () => client.stop());

    expect(client.sessionConfigOptions()).toEqual([]);

    // And the second half: the method the model and the thinking level both travel through is not
    // implemented, so a level sent anyway would be answered `method not found` — which is why the daemon
    // refuses *before* spawning rather than letting a run fail here.
    let error: Error | undefined;
    try {
      const second = await AcpClient.start({
        launch: { command: resolved.command, args: resolved.args, cwd },
        requestTimeoutMs: 60_000,
        sessionConfigs: [{ configId: "reasoning_effort", value: "high" }],
      });
      cleanups.push(async () => second.stop());
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }
    expect(error, "the built-in harness accepted a session config option").toBeDefined();
    expect(error!.message).toMatch(/not supported|method not found|-32601/i);
  }, 180_000);
});

/**
 * The probe, against the real agents.
 *
 * The probe's *decisions* are proved with a port object in `session-probe.test.ts`; what only a real
 * binary can prove is that asking "what do you offer?" of the shipped agents gives the answers this
 * feature's whole surface rests on: `dsh` publishes a model list and a thought level, and
 * `envoy-harness` publishes nothing at all. Both are read through the store a run writes, because a
 * probe that filled a *different* record would be a second shape of truth.
 */
describe("the probe, against the real agents", () => {
  /** A real store under a throwaway home, and a probe that launches agents the way a run does. */
  async function probeBench(): Promise<{
    probe: SessionProbe;
    store: CoderStore;
    stateFile: string;
  }> {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-probe-real-"));
    const paths = coderPaths(home);
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const store = await CoderStore.open({ paths });
    // No `resolveLaunch`, on purpose: this is the production path — `launchForHarness`, the same function
    // `RunManager` calls — so the probe is proved to start the real binary with the real argv, including the
    // `DSH_HOME` of its own that keeps EnvoyCoder out of the user's `dsh` state.
    const probe = new SessionProbe({ paths, store });
    cleanups.push(async () => probe.stopAll());
    return { probe, store, stateFile: paths.sessionOptionsFile };
  }

  it.skipIf(!dsh)("lands what dsh publishes in the run's own record, where a window already reads", async () => {
    const bench = await probeBench();
    const answer = await bench.probe.probe("deepseek-harness");

    expect(answer.outcome).toBe("listed");
    const recorded = bench.store.sessionOptions("deepseek-harness");
    expect(recorded?.sessionId, "the real agent named its session").toBeTruthy();
    expect(Number.isNaN(Date.parse(recorded?.observedAt ?? ""))).toBe(false);
    // The agent's own config ids, read out of a live `session/new` response. A wrong id here is what the
    // thinking pill would be built on, which is why the id is asserted rather than a count.
    const configIds = recorded?.options.map((option) => option.configId) ?? [];
    expect(configIds).toContain("model");
    expect(configIds).toContain("reasoning_effort");

    // And the *window's* answer is derived from that record by the same function `coder.listHarnesses`
    // uses — so this is what the pills will show, not a private summary of it.
    const facts = sessionFacts("deepseek-harness", recorded);
    expect(facts.models.kind).toBe("listed");
    expect(facts.models.options.length).toBeGreaterThan(0);
    expect(facts.thinking.kind).toBe("listed");
    expect(facts.thinking.options.length).toBeGreaterThan(0);

    // On disk, in the file a run writes — one shape of truth for both paths.
    const stored = JSON.parse(await readFile(bench.stateFile, "utf8")) as { harness: string }[];
    expect(stored.map((entry) => entry.harness)).toEqual(["deepseek-harness"]);
  }, 90_000);

  it.skipIf(builtInProbe.state !== "ready")(
    "records that the built-in harness publishes nothing — as an observation, not as our ignorance",
    async () => {
      const bench = await probeBench();
      const answer = await bench.probe.probe("envoy-harness");

      // The claim the thinking pill's disabled state rests on, and the *second* of the two ways it can be
      // true: not "its source has no such method" (that is the catalogue's answer) but "we asked it and it
      // offered nothing". Before this slice only a run could produce that evidence.
      expect(answer.outcome).toBe("none");
      const recorded = bench.store.sessionOptions("envoy-harness");
      expect(recorded?.options).toEqual([]);
      expect(Number.isNaN(Date.parse(recorded?.observedAt ?? ""))).toBe(false);

      const facts = sessionFacts("envoy-harness", recorded);
      expect(facts.thinking.kind).toBe("none");
      // The models are the catalogue's list, untouched and **unstamped**: a session that says nothing about
      // models has not contradicted a list that came from the agent's own source, and attaching this
      // session's time to it would date a fact from somewhere else.
      expect(facts.models.kind).toBe("listed");
      expect(facts.models.observedAt).toBeUndefined();
    },
    90_000,
  );
});

describe("the ACP client when the agent cannot be started at all", () => {
  it("says so promptly, rather than waiting for an exit that will never come", async () => {
    // Not a mock: this is the real path a user meets when the configured command is not there, and it must
    // fail with a sentence rather than an `ENOENT` stack from four frames deep.
    const started = Date.now();
    await expect(
      AcpClient.start({
        launch: { command: "definitely-not-an-agent-binary", args: [], cwd: tmpdir() },
      }),
    ).rejects.toThrow(/could not start|ENOENT/i);

    // **The bound is the assertion that matters, and it is a bug this slice found.** A failed spawn emits
    // `error` and `close` — never `exit` — and `stop()` used to end with an unbounded `await this.exited`,
    // so the client hung forever and every caller awaiting `stop()` hung with it. The probe hit it on the
    // first run: a missing binary took the full 30-second probe budget to report itself.
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);
});
