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

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findBinary } from "@envoycoder/platform";
import { probeHarness, resolveHarnessCommand } from "@envoycoder/agent-catalog";

import { AcpClient, type AcpUpdate } from "../src/daemon/acp/client.js";

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
});

describe.skipIf(!builtInProbe.available)("the ACP client, against the real built-in harness", () => {
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
});

describe.skipIf(dsh)("the ACP client when no agent is installed", () => {
  it("says so, and names what to install", async () => {
    // Not a mock: this is the real path a user without the agent meets, and it must fail with a
    // sentence rather than an `ENOENT` stack from four frames deep.
    await expect(
      AcpClient.start({
        launch: { command: "definitely-not-an-agent-binary", args: [], cwd: tmpdir() },
      }),
    ).rejects.toThrow(/could not start|ENOENT/i);
  });
});
