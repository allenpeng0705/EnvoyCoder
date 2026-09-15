/**
 * **Triggering the agent's own sign-in** — the five outcomes, and the proof that a step's success is not a
 * session.
 *
 * ## Why this file exists beside the probe's
 *
 * The probe *looks* at authentication; this *changes* it, and the difference is the entire risk of the
 * feature. Two failures are possible and both are silent in a naive implementation:
 *
 *   1. **Reporting the step as success.** A browser-login method answers `{}` immediately and the agent still
 *      refuses a session until the human has finished in the browser. A flow that trusted the step's own
 *      answer would tell a user they are signed in when nothing has changed — so `signed-in` here means "a
 *      session opened", and the case where it does not is asserted separately.
 *   2. **Letting a caller's string reach the agent or the disk.** `coder.signInAgent` accepts a `methodId`, and
 *      the field a method id belongs in is exactly the field somebody pastes a key into. Nothing this flow
 *      sends or stores may come from the caller: the method is one of the agent's own advertised ids or it is
 *      nothing, and the tests below assert the negative — the string is not sent, not stored, and not quoted
 *      back.
 *
 * Everything is a scripted agent (the `ProbedAgent` port), because both real cases need a machine in a
 * particular state: `cursor-agent` already signed in cannot produce a refusal, and one that is not signed in
 * would be changed by the test.
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ENVOYCODER_ERRORS,
  SIGN_IN_OUTCOMES,
  SignInOutcomeSchema,
  coderErrorCode,
  coderErrorRef,
  parseMessageRef,
} from "@envoycoder/protocol";
import { coderPaths } from "@envoycoder/host-bridge";

import { AcpRequestError } from "../src/daemon/acp/client.js";
import type { ProbedAgent } from "../src/daemon/agent-processes.js";
import { isMessageKey } from "../src/i18n/messages/en.js";
import { createCoderHandlers, type CoderHandler } from "../src/daemon/service.js";
import { SessionSignIn, SIGN_IN_TIMEOUT_MS, createSignInHandlers } from "../src/daemon/sign-in.js";
import { CoderStore } from "../src/daemon/store.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The script the next attempt will run against. */
interface AgentScript {
  /** What `initialize` advertises. Empty for the agents that need nothing. */
  authMethods?: readonly string[];
  /** The terminal command the agent advertises, for the agents whose sign-in is not a protocol step. */
  authTerminal?: string;
  /** Throw this from `authenticate`. An `Error` becomes a timeout-shaped failure; `AcpRequestError` a refusal. */
  signInFails?: Error;
  /** Throw this from `session/new`. Set it to model an agent that will not open a session. */
  sessionFails?: Error;
}

/** A scripted agent that answers exactly what the test asked for. */
function scriptedAgent(script: AgentScript = {}): ProbedAgent {
  let sessionOpened = false;
  const agent: ProbedAgent = {
    authMethods: () => script.authMethods ?? [],
    // No terminal instruction unless the script asks for one (an agent that logs in through a terminal).
    authTerminalCommand: () => script.authTerminal,
    signIn: async () => {
      if (script.signInFails) throw script.signInFails;
      // The real agents set their own session state here; ours only needs to remember that the step landed,
      // so that "a session opened *afterwards*" is a fact about this script rather than about the order the
      // flow happens to call things in.
      sessionOpened = true;
    },
    openSession: async () => {
      if (script.sessionFails) throw script.sessionFails;
      if (!sessionOpened && script.authMethods !== undefined && script.authMethods.length > 0) {
        // An agent that advertises a sign-in method and has not been given one refuses the session — the
        // measured behaviour of `cursor-agent acp`, and the reason `needs-signin` is an outcome at all.
        throw new AcpRequestError(
          `Authentication required. Please run 'agent login' first, then call authenticate() with methodId ` +
            `'${script.authMethods[0]}'.`,
          -32000,
        );
      }
      return "session-from-the-scripted-agent";
    },
    sessionId: "session-from-the-scripted-agent",
    sessionConfigOptions: () => [],
    stop: async () => undefined,
  };
  return agent;
}

interface Bench {
  signIn: SessionSignIn;
  store: CoderStore;
  paths: ReturnType<typeof coderPaths>;
  /** What the next attempt's scripted agent will do. */
  script: (script: AgentScript) => void;
  /** Every `authenticate` id sent, across every attempt. */
  signedInWith: () => readonly string[];
  /** Every byte under the state directory, for "nothing was stored that should not have been". */
  stateBytes: () => Promise<string>;
  /** How many teardowns reached the agent. `1` after any attempt, and still `1` after a shutdown. */
  stops: () => number;
}

async function bench(
  overrides: { timeoutMs?: number; handshakeTimeoutMs?: number } = {},
  options: {
    /**
     * Use the daemon's own launch resolution, which probes this machine.
     *
     * Off by default, and that default is the point: a scripted agent can only be reached if the *launch*
     * succeeds, and `launchForHarness` refuses on a machine that does not have the agent installed — so a test
     * about what this flow does with an agent would otherwise skip or fail for whoever runs it. The one case
     * that wants the real resolution is `unavailable`, which is precisely about a launch that refuses.
     */
    realLaunch?: boolean;
  } = {},
): Promise<Bench> {
  const home = await mkdtemp(join(tmpdir(), "envoycoder-signin-"));
  const paths = coderPaths(home);
  const store = await CoderStore.open({ paths });

  let current: AgentScript = {};
  const allSignIns: string[] = [];
  let stops = 0;

  const signIn = new SessionSignIn({
    paths,
    store,
    ...(options.realLaunch === true
      ? {}
      : {
          // Node with an empty program: the launch is *resolved* by the shared body (`launchForHarness`) even
          // when the process is a stand-in, so what this asserts about the flow is about the flow.
          resolveLaunch: (input: { cwd: string }) => ({
            command: process.execPath,
            args: ["-e", ""],
            cwd: input.cwd,
          }),
        }),
    startClient: async () => {
      const agent = scriptedAgent(current);
      // The wrapper is what makes "it was never sent" an assertion rather than a hope: every id that crosses
      // this boundary is recorded, whoever asked for it.
      return {
        ...agent,
        signIn: async (methodId: string) => {
          await agent.signIn(methodId);
          allSignIns.push(methodId);
        },
        stop: async () => {
          stops += 1;
          await agent.stop();
        },
      };
    },
    ...overrides,
  });

  cleanups.push(async () => {
    await signIn.stopAll();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  return {
    signIn,
    store,
    paths,
    script: (script) => {
      current = script;
    },
    signedInWith: () => allSignIns,
    stops: () => stops,
    stateBytes: async () => {
      const names = await readdir(paths.stateDir);
      const parts: string[] = [];
      for (const name of names) {
        try {
          parts.push(await readFile(join(paths.stateDir, name), "utf8"));
        } catch {
          // A directory (or a file we cannot read) is not where a string would be stored.
        }
      }
      return parts.join("\\n");
    },
  };
}

/* ────────────────────────────── the five outcomes ────────────────────────────── */

describe("what pressing Sign in can come back as", () => {
  it("is success only when a session opens afterwards", async () => {
    // `cursor` declares `cursor_login`, and this agent advertises it — so the flow sends the catalogue's own
    // method without the caller having to know it, which is how a fresh installation is one press away.
    const b = await bench();
    b.script({ authMethods: ["cursor_login"] });

    const answer = await b.signIn.signIn("cursor");

    expect(answer.outcome).toBe("signed-in");
    expect(b.signedInWith()).toEqual(["cursor_login"]);
    // The record follows the attempt, so the row a client is showing is current without a second call — and
    // `ready` is a claim this flow can make because it just opened a session.
    expect(answer.auth.state).toBe("ready");
    expect(b.store.agentAuth("cursor")?.state).toBe("ready");
    // A keyed sentence, so a German window reads German: the outcome is data, the sentence is prose.
    expect(isMessageKey("signIn.signedIn")).toBe(true);
    expect(answer.detail).toContain("Cursor Agent");
  }, 20_000);

  it("reports the agent's own refusal, and never as success", async () => {
    const b = await bench();
    b.script({
      authMethods: ["cursor_login"],
      // `codex-acp`'s `env_var` methods fail exactly this way when the variable is unset, and the agent's
      // sentence names which one — which is more use to a user than anything we could write.
      signInFails: new AcpRequestError("env var OPENAI_API_KEY is not set", -32602),
    });

    const answer = await b.signIn.signIn("cursor");

    expect(answer.outcome).toBe("refused");
    expect(answer.outcome).not.toBe("signed-in");
    // The agent's own words travel as a value, not as the headline: the headline is ours and translated.
    expect(answer.detail).toContain("OPENAI_API_KEY");
    // And the state is honest about what we now know: it still wants a sign-in, and the method is the one it
    // advertised.
    expect(answer.auth).toMatchObject({ state: "needs-signin", methodId: "cursor_login" });
    expect(b.store.agentAuth("cursor")?.state).toBe("needs-signin");
  }, 20_000);

  it("does not call a browser sign-in done just because the step returned", async () => {
    const b = await bench();
    // The case this whole union exists for: `authenticate` answers `{}` (usually after opening a browser) and
    // the session still refuses, because the human has not finished. A flow that reported the step's own
    // answer would say "signed in" here and be wrong in the way that costs a user an hour.
    b.script({
      authMethods: ["cursor_login"],
      sessionFails: new AcpRequestError(
        "Authentication required. Please run 'agent login' first, then call authenticate() with methodId " +
          "'cursor_login'.",
        -32000,
      ),
    });

    const answer = await b.signIn.signIn("cursor");

    expect(answer.outcome).toBe("not-completed");
    expect(answer.outcome).not.toBe("signed-in");
    expect(answer.detail).toContain("cursor_login");
    // The record says the same thing the answer does, so a second window is not told a different story.
    expect(answer.auth.state).toBe("needs-signin");
  }, 20_000);

  it("says there was nothing to do when the agent already opens sessions", async () => {
    // A user pressing the button on an agent that needs no sign-in is the ordinary case after the first run,
    // and the honest answer is success with the reason — not a complaint about a step nobody needed.
    const b = await bench();
    b.script({ authMethods: [] });

    const answer = await b.signIn.signIn("deepseek-harness");

    expect(answer.outcome).toBe("signed-in");
    expect(b.signedInWith()).toEqual([]);
    expect(answer.auth.state).toBe("ready");
  }, 20_000);

  it("says plainly when there is no sign-in it may send", async () => {
    const b = await bench();
    // An agent that advertises nothing and will not open a session: there is no step to send, and the sentence
    // names the agent's own (empty) list rather than inventing one.
    b.script({ authMethods: [], sessionFails: new Error("no workspace") });

    const answer = await b.signIn.signIn("deepseek-harness");

    expect(answer.outcome).toBe("no-method");
    expect(b.signedInWith()).toEqual([]);
    expect(answer.detail).toContain("DeepSeek Harness");
    // Nothing was sent and nothing is claimed: the state is `unknown`, because an agent that named no way to
    // sign in has not told us a login would help.
    expect(answer.auth.state).toBe("unknown");
  }, 20_000);

  it("refuses to choose between several advertised methods", async () => {
    const b = await bench();
    // `@agentclientprotocol/codex-acp` advertises two `env_var` methods and a browser login, and the catalogue
    // declares none of them. Sending the first would pick a sign-in flow on the user's behalf — and if it were
    // the browser one, open a window they did not ask for.
    b.script({ authMethods: ["api-key", "chat-gpt", "browser-login"], sessionFails: new Error("refused") });

    const answer = await b.signIn.signIn("codex");

    expect(answer.outcome).toBe("no-method");
    expect(b.signedInWith()).toEqual([]);
    // The agent's own ids are listed, so a user can act on the sentence.
    expect(answer.detail).toContain("api-key");
    expect(answer.detail).toContain("browser-login");
  }, 20_000);

  it("says it could not start the agent rather than blaming the sign-in", async () => {
    // The daemon's own resolution here, because this is the case where it must refuse *before* a process
    // exists: `opencode` is a command-line agent this build cannot drive, so `launchForHarness` — the same
    // function a run calls — throws `harnessUnsupported`.
    //
    // (`copilot` was this leg's subject until 2026-09-15: its `--acp` server was measured, so it launches now and
    // the leg's premise — a refusal before any process exists — no longer holds for it.)
    const b = await bench({}, { realLaunch: true });
    const answer = await b.signIn.signIn("opencode");

    expect(answer.outcome).toBe("unavailable");
    // The outer sentence is ours and keyed — so what a translator writes is one string — while the launch's own
    // refusal is embedded as a *value*, arriving whole. That division is the same one `SessionProbe` uses for a
    // failed ask, and it is what makes the reason readable in a language we did not write it in.
    expect(parseMessageRef(answer.detail).ref?.key).toBe("signIn.unavailable");
    expect(answer.detail).toContain("OpenCode");
    // …and the value is the launch's sentence, which is the one that says *which* of the four ways it failed.
    expect(parseMessageRef(answer.detail).ref?.values?.reason).toContain(
      "speaks a protocol EnvoyCoder cannot drive yet",
    );
    expect(b.signedInWith()).toEqual([]);
    // An agent we could not start has told us nothing about how it would like to sign in.
    expect(answer.auth.state).toBe("unknown");
  }, 20_000);

  it("bounds the whole attempt, and calls a step that never answered not-completed", async () => {
    // The budgets are cut to something a test can wait for; the default is `SIGN_IN_TIMEOUT_MS`.
    const b = await bench({ timeoutMs: 60, handshakeTimeoutMs: 60 });
    b.script({ authMethods: ["cursor_login"], signInFails: new Error("The agent did not answer authenticate within 30s.") });

    const answer = await b.signIn.signIn("cursor");

    // **Not `refused`.** A timeout is our failure to get an answer, not the agent declining — attributing our
    // own silence to somebody else's program is the mistake this branch exists to prevent. And not success
    // either: nothing was signed in.
    expect(answer.outcome).toBe("not-completed");
    expect(answer.detail).toContain("did not answer");
    expect(SIGN_IN_TIMEOUT_MS).toBeGreaterThan(30_000);
  }, 20_000);

  it("stops the agent it started, exactly once, whatever happened", async () => {
    const b = await bench();
    b.script({ authMethods: ["cursor_login"], signInFails: new AcpRequestError("nope", -32603) });

    await b.signIn.signIn("cursor");
    // The flow's own `finally`: an agent nobody stops is a process left running on the user's machine, and a
    // refusal is exactly the case where it would be easy to forget.
    expect(b.stops()).toBe(1);

    // `stopAll` is what a daemon shutdown calls, and it must find nothing left to stop — so the count stays
    // where it is rather than a second teardown racing the first (the `ERR_STREAM_WRITE_AFTER_END` the shared
    // guard exists to prevent, `docs/settings-parity.md` §7.8).
    await expect(b.signIn.stopAll()).resolves.toBeUndefined();
    expect(b.stops()).toBe(1);
  }, 20_000);
});

/* ────────────────────────────── nothing a caller typed is stored ────────────────────────────── */

describe("a value where a method name belongs never reaches the agent or the disk", () => {
  it("ignores a caller's methodId unless the agent advertised it", async () => {
    const b = await bench();
    // The field `coder.signInAgent` takes is a method id, and it is exactly the field somebody pastes a key
    // into. This agent advertises two methods and the catalogue declares none, so there is nothing this flow
    // may send — and the caller's string must not be sent, stored, or quoted back in the sentence a user reads.
    const secret = "sk-live-1f4c9ab7-not-a-real-key";
    b.script({ authMethods: ["api-key", "chat-gpt"], sessionFails: new Error("refused") });

    const answer = await b.signIn.signIn("codex", { methodId: secret });

    expect(answer.outcome).toBe("no-method");
    // **The three negatives, and each is the assertion that matters.**
    expect(b.signedInWith()).toEqual([]);
    expect(answer.detail).not.toContain(secret);
    expect(answer.detail).not.toContain("sk-live");
    expect(await b.stateBytes()).not.toContain(secret);
    // And the same on bytes: the rule is about what a user can open, not about what we intended.
    expect(await readFile(b.paths.agentAuthFile, "utf8")).not.toContain("sk-");
  }, 20_000);

  it("sends a caller's methodId when the agent did advertise it — because then it is the agent's", async () => {
    const b = await bench();
    b.script({ authMethods: ["api-key", "browser-login"] });

    // Two methods, none declared, and the caller names one the agent offers: now there is a step to send, and
    // the id crosses the process boundary as the agent's own string rather than as the caller's.
    const answer = await b.signIn.signIn("codex", { methodId: "browser-login" });

    expect(answer.outcome).toBe("signed-in");
    expect(b.signedInWith()).toEqual(["browser-login"]);
    expect((await readFile(b.paths.agentAuthFile, "utf8")).includes("sk-")).toBe(false);
  }, 20_000);

  it("stores the method as a fact beside the state, and never a value from anywhere else", async () => {
    const b = await bench();
    b.script({ authMethods: ["cursor_login"], signInFails: new AcpRequestError("nope", -32603) });

    await b.signIn.signIn("cursor");

    // `AgentAuthObservation` is the whole record: three states, an agent's method id, and a sentence. There is
    // no field on it that could hold a credential, which is the same enforcement `AgentProviderConfig.env`
    // states one layer down — the shape, rather than a rule written beside it.
    const stored = JSON.parse(await readFile(b.paths.agentAuthFile, "utf8")) as Record<string, unknown>[];
    expect(Object.keys(stored[0] ?? {}).sort()).toEqual(["detail", "harness", "methodId", "observedAt", "state"]);
    expect(stored[0]?.methodId).toBe("cursor_login");
  }, 20_000);
});

/* ────────────────────────────── the wire ────────────────────────────── */

describe("the method, and the daemon that has no flow to serve it", () => {
  it("carries one of the five outcomes under a schema, and refuses without a flow", async () => {
    // The wire's copy of the union, so a client can switch on it without importing our types.
    for (const outcome of SIGN_IN_OUTCOMES) {
      expect(SignInOutcomeSchema.safeParse(outcome).success, outcome).toBe(true);
    }
    expect(SignInOutcomeSchema.safeParse("ok").success).toBe(false);

    // A daemon built without an agent runtime cannot start an agent, so the method refuses **by name** rather
    // than answering with an outcome nothing produced — the same rule, sentence and key `requireRuns` and
    // `requireProbeSession` follow, because one missing runtime is one situation.
    const handlers = createSignInHandlers({}) as Record<string, CoderHandler>;
    let code: string | null = null;
    let key: string | undefined;
    try {
      await handlers["coder.signInAgent"]?.({ harness: "cursor" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      code = coderErrorCode(message);
      key = coderErrorRef(message)?.key;
    }
    expect(code).toBe(ENVOYCODER_ERRORS.harnessFailed);
    expect(key).toBe("error.noRunRuntime");
  });

  it("is served by the daemon's own table, so it is a method a window can call", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoycoder-signin-table-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });

    // Built the way `serve.ts` builds it, with the same flow the daemon hands to the handler: a method that
    // exists in the catalogue but is left out of the table would be refused as "not implemented in this
    // build", which is a claim about the build rather than about the agent.
    const withoutFlow = createCoderHandlers({
      store,
      paths,
      instance: { instanceId: "t", version: "0", startedAt: new Date().toISOString(), connectionCount: () => 1 },
      mesh: () => ({ kind: "no-node", reason: "test" }),
    }) as Record<string, CoderHandler>;
    expect(typeof withoutFlow["coder.signInAgent"]).toBe("function");

    const signIn = new SessionSignIn({ paths, store });
    cleanups.push(async () => signIn.stopAll());
    const withFlow = createCoderHandlers({
      store,
      paths,
      signIn,
      instance: { instanceId: "t", version: "0", startedAt: new Date().toISOString(), connectionCount: () => 1 },
      mesh: () => ({ kind: "no-node", reason: "test" }),
    }) as Record<string, CoderHandler>;

    // An id the wire schema refuses is refused by the schema, with no sentence for a user: this is a call
    // addressed to whoever wrote the client.
    await expect(withFlow["coder.signInAgent"]?.({ harness: "not-a-harness" })).rejects.toThrow(
      /coder\.signInAgent was called with an unusable/,
    );
    // And a real one reaches the flow, which reports what this machine can do with `opencode` — an agent this
    // build cannot launch, so the answer is `unavailable` rather than a sign-in nobody could perform.
    const answer = (await withFlow["coder.signInAgent"]?.({ harness: "opencode" })) as { outcome: string };
    expect(answer.outcome).toBe("unavailable");
  });
});


