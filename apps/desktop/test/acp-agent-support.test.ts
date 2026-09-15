/**
 * The agents this catalogue claims to support — and the two protocol steps that make the claims true.
 *
 * ## Why this file exists
 *
 * For a while the catalogue listed nine agents and this product could start two of them. The rest were
 * refused *before spawning*, with a sentence saying the adapter drives ACP agents only — honest, but it
 * meant seven rows described recipes nobody had run. This slice replaced three of those recipes with
 * commands that were **driven against the real binaries**, and this is the file that keeps them driven.
 *
 * ## Two halves, deliberately
 *
 *   * **The catalogue's claims, against the real agents.** Each leg drives `launchForHarness` — the same
 *     function `RunManager` and `SessionProbe` call, so argv, environment and the ACP facts cannot drift
 *     between a test and a run — and asserts the handshake, the session, the option categories the
 *     catalogue's model wiring depends on, and that the mode ids the entry now lists are ones the agent
 *     accepts. A leg **skips loudly, naming the install command**, when its binary is not on this
 *     machine: an agent is the user's install rather than something this repository vendors, and a test
 *     that passed vacuously would be worse than one that says it did not run.
 *   * **The two steps the catalogue declares, against a scripted agent.** `authMethodId` and `modeParam`
 *     are facts about somebody else's build, and legs that only run on a machine with the agent installed
 *     would leave them unproven everywhere else — including the two cases that matter most, which are
 *     negative: an agent that refuses `session/new` until it has been authenticated, and one that
 *     *accepts* a mode into a field it ignores.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { HarnessId } from "@envoycoder/protocol";
import { harnessAcpFacts, harnessDefinition, probeHarness } from "@envoycoder/agent-catalog";
import { coderPaths } from "@envoycoder/host-bridge";

import { AcpClient, type AcpUpdate } from "../src/daemon/acp/client.js";
import { launchForHarness } from "../src/daemon/launch.js";
import { SessionProbe } from "../src/daemon/session-probe.js";
import { CoderStore } from "../src/daemon/store.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_AGENT = join(here, "fixtures", "fake-acp-agent.mjs");

/** Everything `AcpClient.start` takes. Named once so a fixture launch and a real one read the same. */
type StartOptions = Parameters<typeof AcpClient.start>[0];

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  // Last in, first out: an agent process must be stopped before the directory it writes into is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * Start a client and keep everything it says, so an assertion can be about the agent's own words.
 *
 * The collector has to be installed *in the options*, before `start` — a listener attached afterwards
 * would miss the chunks a fast agent has already sent, and the assertion would be about timing rather
 * than about the mode.
 */
async function startSaying(options: StartOptions): Promise<{ client: AcpClient; said: () => string }> {
  const texts: string[] = [];
  const client = await AcpClient.start({
    ...options,
    onUpdate: (update: AcpUpdate) => {
      const content = (update as { content?: { text?: unknown } }).content;
      if (typeof content?.text === "string") texts.push(content.text);
    },
  });
  cleanups.push(async () => client.stop());
  return { client, said: () => texts.join("\n") };
}

/** Start, ask the agent to report its mode, and hand back what it said. */
async function reportedMode(options: StartOptions): Promise<string> {
  const { client, said } = await startSaying(options);
  const answer = await client.prompt("mode-me");
  expect(answer.stopReason).toBe("end_turn");
  return said();
}

/**
 * The three agents whose ACP commands were verified, and what each one must publish.
 *
 * `categories` is the ACP `configOption` categories the leg requires — `model` and `mode` for all three,
 * which is what the catalogue's model delivery and its modes array are built on. Asserted by
 * **category** rather than by config id, for the same reason `session-options.ts` keys on the category:
 * an agent is free to rename an option, and a test pinned to an id would go red for a rename that broke
 * nothing.
 */
const VERIFIED_AGENTS: readonly { id: HarnessId; categories: readonly string[] }[] = [
  { id: "claudecode", categories: ["model", "mode"] },
  { id: "codex", categories: ["model", "mode"] },
  { id: "cursor", categories: ["model", "mode"] },
];

for (const { id, categories } of VERIFIED_AGENTS) {
  const probe = probeHarness(id);
  const definition = harnessDefinition(id);

  describe.skipIf(probe.state !== "ready")(
    `${definition.label}, driven over ACP the way a run drives it`,
    () => {
      /**
       * A throwaway world — the agent's working directory and this product's state directory — plus the
       * launch `launchForHarness` resolves for it.
       *
       * **The production path, not a hand-built launch.** `launchForHarness` is what `RunManager` and
       * `SessionProbe` call, so the leg asserts the catalogue's argv, its ACP facts and its environment
       * together; a test that assembled its own `AcpLaunch` would keep passing after the entry changed.
       */
      async function launch(): Promise<StartOptions["launch"]> {
        const cwd = await mkdtemp(join(tmpdir(), "envoycoder-acp-agent-"));
        const home = await mkdtemp(join(tmpdir(), "envoycoder-acp-agent-home-"));
        cleanups.push(async () => {
          await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
          await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        });
        return launchForHarness({ harness: id, cwd, paths: coderPaths(home) });
      }

      it("opens a session, publishes the options its entry's wiring rests on, and accepts its mode ids", async () => {
        const requested = definition.modes[0]?.id;
        expect(requested, `${id} declares no modes`).toBeTruthy();

        // **One session proving three things, because starting two costs a real agent two handshakes.**
        // On the machine this was written on `cursor-agent acp`'s `authenticate` step alone took ~13 s,
        // so a second leg for the mode would have doubled this file's runtime to re-ask a question the
        // first session can answer.
        //
        // `agentModeId` is applied *during* `start` and it is awaited, so a refusal throws here — which
        // makes this a check on two catalogue facts at once: the field name (all three refuse the peer's
        // `mode` with `invalid params`) and the mode id (one the agent does not publish is refused the
        // same way). The options are then read from the same client, which is the state a run is in.
        const client = await AcpClient.start({
          launch: await launch(),
          agentModeId: requested,
          // Generous, and one of these genuinely needs it: `cursor-agent acp`'s `authenticate` re-reads
          // the user's own login state before answering, which is seconds of work, not milliseconds.
          handshakeTimeoutMs: 60_000,
          requestTimeoutMs: 60_000,
        });
        cleanups.push(async () => client.stop());

        // The transport, proven rather than assumed: the agent answered `initialize`, with a protocol
        // version we speak, and it named a session.
        expect(client.agentInfo?.protocolVersion).toBe(1);
        expect(client.sessionId).toBeTruthy();

        // The claim the model delivery rests on: a session publishes its options. Only the *category* is
        // asserted — what an agent calls its model option is its own business, and a test pinned to the id
        // would go red for a rename that broke nothing.
        const options = client.sessionConfigOptions() as { category?: unknown }[];
        const seen = options.map((option) => String(option.category));
        for (const category of categories) {
          expect(seen, `${id} published no ${category} option`).toContain(category);
        }

        // **And the claim the auth step rests on.** When an entry names a method, the agent must be
        // advertising that exact id — otherwise the step is a call answered `unknown auth method`, a
        // failure only a machine with the agent installed would ever see.
        //
        // Note what this leg does *not* prove: that the method had to be sent. On a machine where the
        // step has run once, `cursor-agent acp` opens sessions without it (measured — see that entry's
        // `evidence`), so this leg passes either way there. The deterministic proof that the client sends
        // it is the scripted-agent case below, which is why that case exists in the same file.
        const declared = harnessAcpFacts(id).authMethodId;
        if (declared !== undefined) {
          expect(client.agentInfo?.authMethods, `${id} does not advertise ${declared}`).toContain(
            declared,
          );
        }
      }, 150_000);
    },
  );
}

/**
 * The steps the catalogue declares, against a scripted agent that refuses the way the real ones do.
 *
 * In this file rather than a separate one because it is the same subject: these are the two facts that
 * make the legs above possible, and both were wrong until this slice. `cursor` opened no session at all
 * until the client learned to `authenticate`, and the mode method reads **two different field names**
 * depending on which agent you are talking to.
 */
describe("the protocol steps the catalogue declares", () => {
  const fixture = (
    env: Record<string, string>,
    facts: { authMethodId?: string; modeParam?: "mode" | "modeId" } = {},
  ): StartOptions => ({
    launch: { command: process.execPath, args: [FAKE_AGENT], cwd: tmpdir(), env, ...facts },
    handshakeTimeoutMs: 20_000,
  });

  it("authenticates with the method the catalogue names, and refuses to guess one", async () => {
    // The agent `cursor-agent acp` is: it advertises `cursor_login` and answers `session/new` with
    // `-32000 Authentication required` until that method has been sent.
    const declared = await AcpClient.start(
      fixture({ FAKE_ACP_REQUIRE_AUTH: "cursor_login" }, { authMethodId: "cursor_login" }),
    );
    cleanups.push(async () => declared.stop());
    expect(declared.sessionId).toBeTruthy();
    // What the agent advertised, kept verbatim — the evidence a maintainer needs when a run stops at
    // "Authentication required" and nothing else.
    expect(declared.agentInfo?.authMethods).toEqual(["cursor_login"]);

    // **The other half, and the one that catches a client which never sent it.** The same agent with
    // nothing declared: no session, and the failure is the agent's own sentence rather than silence.
    let error: Error | undefined;
    try {
      const anonymous = await AcpClient.start(fixture({ FAKE_ACP_REQUIRE_AUTH: "cursor_login" }));
      cleanups.push(async () => anonymous.stop());
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }
    expect(error, "the agent opened a session without being authenticated").toBeDefined();
    expect(error?.message).toMatch(/Authentication required/);
    // Naming the method, because that is the sentence a user has to be able to act on.
    expect(error?.message).toContain("cursor_login");
  }, 40_000);

  it("puts a mode into the field the launch declares, and the agent reports it back", async () => {
    // The specification's field, which is what all three verified agents read.
    const reported = await reportedMode({
      ...fixture({ FAKE_ACP_MODE_PARAM: "modeId" }, { modeParam: "modeId" }),
      agentModeId: "plan",
    });
    // **Asserted through the agent's own mouth**, never through the call resolving: a client that
    // believed it had sent a mode would satisfy an assertion about the request, and this is the
    // assertion that tells the two apart.
    expect(reported).toContain("mode: plan");
  }, 40_000);

  it("does not report a mode applied when the declared field is the one the agent ignores", async () => {
    // **The defect this whole field exists for, reproduced.** An agent reading the peer's `mode` that is
    // sent `modeId` does not refuse it: `parseSessionSetModeParams` ignores the unknown field and the
    // backend answers `{mode: <unchanged>}`. So a client that guessed the field, or that "tried both and
    // fell back on a refusal", would be told the mode had been applied while the agent stayed where it
    // was. Here the launch deliberately declares the wrong field: the run must **not** fail, and the mode
    // must be exactly where it started.
    const reported = await reportedMode({
      ...fixture({}, { modeParam: "modeId" }),
      agentModeId: "plan",
    });
    expect(reported).toContain("mode: default");
    expect(reported).not.toContain("mode: plan");
  }, 40_000);

  it("refuses to send a mode at all for an agent whose field nobody wrote down", async () => {
    // Unreachable from a run — `resolveAgentMode` refuses a mode for any entry whose
    // `capabilities.agentMode` is false, and `drivable.test.ts` asserts that every entry claiming one
    // declares the field. Asserted anyway, because that is the kind of invariant that decays silently,
    // and the failure has to be a sentence rather than a mode applied to a field the agent ignores.
    await expect(
      AcpClient.start({ ...fixture({}), agentModeId: "plan" }),
    ).rejects.toThrow(/which parameter/);
  }, 40_000);
});

/**
 * **The auth fact, against the real binary** — and which half of it this machine can prove.
 *
 * ## Why there are two legs and they are not the same leg
 *
 * A probe reads one of three states, and only `unknown` is cheap to produce on any machine. The interesting
 * one, `needs-signin`, requires an agent that will not open a session until it has been signed in — and
 * `cursor-agent`'s requirement is **stateful**, which that entry's `evidence` records from both directions: on
 * a fresh installation `session/new` answers `-32000 Authentication required … methodId 'cursor_login'`, and
 * once the step has run the same binary opens sessions without it. A machine that has already been through it
 * therefore cannot demonstrate the refusal, which is why:
 *
 *   * **the deterministic proof of `needs-signin` is a scripted agent** (`session-probe.test.ts`, with
 *     `FAKE_ACP_REQUIRE_AUTH`), where the refusal is produced on demand;
 *   * **this leg proves the other half**: that against the real binary the probe *learns* a state instead of
 *     guessing one. That is a real assertion and it can fail — an implementation that stopped reading
 *     `authMethods`, or that reported `unknown` for every failed session, goes red here on a warm machine and
 *     a cold one alike.
 *
 * The observation this machine produced when the leg was written is recorded in the report that accompanied
 * this slice, not here: a test that asserted which state a particular laptop is in would be a test about the
 * laptop.
 */
describe("what a probe learns about the real cursor-agent's authentication", () => {
  const probe = probeHarness("cursor");

  describe.skipIf(probe.state !== "ready")("cursor-agent acp, asked rather than believed", () => {
    it("reports one of the two states it can be in, and never 'we could not tell'", async () => {
      const cwd = await mkdtemp(join(tmpdir(), "envoycoder-auth-probe-"));
      const home = await mkdtemp(join(tmpdir(), "envoycoder-auth-probe-home-"));
      cleanups.push(async () => {
        await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      });

      const paths = coderPaths(home);
      const store = await CoderStore.open({ paths });
      const sessionProbe = new SessionProbe({
        paths,
        store,
        // The production resolution, so this is the same launch a run and the sign-in flow make.
        resolveLaunch: (input) => launchForHarness({ harness: input.harness, cwd, paths }),
        // Both generous: `cursor-agent acp`'s own startup is seconds of work, and the step it may want takes
        // longer still.
        handshakeTimeoutMs: 60_000,
        timeoutMs: 90_000,
      });
      cleanups.push(async () => sessionProbe.stopAll());

      const answer = await sessionProbe.probe("cursor");

      // **The assertion that can fail.** `unknown` is what a probe reports when it could not get an answer, and
      // this binary answers: it either opens a session (`ready`, the state of a warm machine) or refuses one and
      // advertises the method it wants (`needs-signin`, the state of a fresh installation). Anything else means
      // the probe stopped reading what the agent told it.
      expect(["ready", "needs-signin"]).toContain(answer.auth.state);
      // …and the record says the same thing as the answer, because `coder.listHarnesses` reads the record.
      expect(store.agentAuth("cursor")?.state).toBe(answer.auth.state);
      if (answer.auth.state === "needs-signin") {
        // The cold-machine half, which only a fresh installation can reach: the method must be one the agent
        // itself advertised — never one we chose.
        expect(answer.auth.methodId).toBe("cursor_login");
      } else {
        // The warm-machine half, and the reason this leg is not vacuous: a session really did open, so the state
        // is a measurement rather than a default.
        expect(answer.outcome).toBe("listed");
        expect(answer.auth.methodId).toBeUndefined();
      }
    }, 150_000);
  });
});
