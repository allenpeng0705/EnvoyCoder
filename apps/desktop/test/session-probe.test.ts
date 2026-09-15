/**
 * The pre-flight probe: **the decision, with a fake agent.**
 *
 * ## What this file is for
 *
 * The probe is the one thing in this daemon that starts an agent *without the user asking for a run*, so
 * every rule about when it does that has to be provable without watching a process: that it happens once
 * and not on every ask, that a second ask joins the first, that it gives up, that it stops what it
 * started — and that it never writes down an answer the agent did not give.
 *
 * The agent here is a **port object** (`ProbedSession`), not a mock of `AcpClient`: `AcpClient`'s members
 * are private, so a fake of the class needs a cast, and a cast is how a test comes to agree with the bug
 * it was written to catch. The real client is exercised against the real binaries in
 * `acp-transport.test.ts`, and the whole daemon path — handler, store, change event — in
 * `daemon-rpc.test.ts`, so what is left for this file is the decision.
 *
 * The **store is real**, because half of what this file asserts is about the store: `listed` and `none`
 * must land through the same path a run writes them, and `unreachable` must leave the file exactly as it
 * was. A fake store would prove that a function was called; the real one proves what a window would
 * subsequently read.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentAuthObservation, HarnessId, ObservedSessionOptions } from "@envoycoder/protocol";
import { parseMessageRef } from "@envoycoder/protocol";
import { coderPaths } from "@envoycoder/host-bridge";

import { isMessageKey } from "../src/i18n/messages/en.js";
import { localizeText } from "../src/i18n/notice.js";
import { createTranslator } from "../src/i18n/translate.js";
import type { ProbedAgent } from "../src/daemon/agent-processes.js";
import { PROBE_STALE_MS, SessionProbe, type SessionProbeDeps } from "../src/daemon/session-probe.js";
import { CoderStore } from "../src/daemon/store.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A scripted agent, **and the script is now three lines long** because the probe's question is three
 * questions.
 *
 * `configOptions` is what its session published, in the agent's own shape — not ours: it is the option list an
 * ACP agent answers `session/new` with, and empty is the case `envoy-harness` genuinely produces.
 *
 * `authMethods` is what its `initialize` advertised, and `refuseSession` is what it does when asked for a
 * session: the two inputs the auth fact is decided from. A scripted agent whose `refuseSession` is set and
 * whose `authMethods` is non-empty is `cursor-agent acp` on a fresh installation, and that case cannot be
 * produced by the real binary on a machine that has already been signed in — which is why it is a fixture.
 */
function scriptedAgent(
  configOptions: readonly unknown[],
  hooks: {
    onStop?: () => void | Promise<void>;
    /** What the agent advertises in `initialize`. Empty for the agents that need nothing. */
    authMethods?: readonly string[];
    /** Refuse `session/new` the way a real agent refuses it, with the same `-32000` and sentence. */
    refuseSession?: string;
    /** Refuse the `authenticate` step itself, for the sign-in flow's own tests. */
    refuseSignIn?: string;
  } = {},
): { agent: ProbedAgent; stops: () => number; opened: () => number } {
  let stops = 0;
  let opened = 0;
  return {
    agent: {
      authMethods: () => hooks.authMethods ?? [],
      signIn: async (methodId) => {
        if (hooks.refuseSignIn !== undefined) {
          throw new Error(hooks.refuseSignIn);
        }
        void methodId;
      },
      openSession: async () => {
        opened += 1;
        if (hooks.refuseSession !== undefined) {
          throw new Error(hooks.refuseSession);
        }
        return "session-from-the-scripted-agent";
      },
      sessionId: "session-from-the-scripted-agent",
      sessionConfigOptions: () => configOptions,
      stop: async () => {
        stops += 1;
        // Returns a promise so a test can hold a teardown open and start a second one against it —
        // which is the only way the per-client guard can be observed rather than assumed.
        await hooks.onStop?.();
      },
    },
    stops: () => stops,
    opened: () => opened,
  };
}

/** The two options a real `dsh` publishes, in the shape the real binary uses. */
const DSH_OPTIONS = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    options: [
      {
        group: "deepseek-official",
        name: "DeepSeek",
        options: [
          {
            value: JSON.stringify(["deepseek-official", "deepseek-v4-flash"]),
            name: "DeepSeek-V4-Flash",
          },
        ],
      },
    ],
  },
  {
    id: "reasoning_effort",
    name: "Reasoning effort",
    category: "thought_level",
    type: "select",
    options: [
      { value: "off", name: "Off" },
      { value: "max", name: "Max", description: "Think as hard as this model can." },
    ],
  },
];

interface Bench {
  probe: SessionProbe;
  store: CoderStore;
  paths: ReturnType<typeof coderPaths>;
  /** How many sessions have been started — the cost this whole module is bounded on. */
  spawns: () => number;
  /** Every launch the probe asked for, so that it reusing the run path is observable rather than claimed. */
  launches: () => readonly { harness: HarnessId; cwd: string }[];
  /** Change what the next `start` does: refuse, hang, or publish a different list. */
  script: (start: SessionProbeDeps["startClient"]) => void;
  /** Move the probe's clock, so staleness is a fact rather than a wait. */
  advance: (ms: number) => void;
  /** What a rebuild of the agent would look like to the cache. */
  setBuild: (harness: HarnessId, fingerprint: string) => void;
  /** What the daemon wrote, read back the way a window reads it. */
  recorded: (harness: HarnessId) => ObservedSessionOptions | undefined;
  /** The raw file, so "nothing was written" can be asserted on bytes rather than through a reader. */
  file: () => Promise<string>;
  /**
   * The **auth** record, read the way `coder.listHarnesses` reads it.
   *
   * A second reader because it is a second file: the whole reason `AgentAuthObservation` is not a field on
   * the session-options record is that this one is written when nothing could be established and that one
   * deliberately is not. Both readers exist here so a test can tell which file moved.
   */
  recordedAuth: (harness: HarnessId) => AgentAuthObservation | undefined;
  /** The auth file's raw bytes, for "a failed probe still recorded what it learned". */
  authFile: () => Promise<string>;
}

async function bench(
  overrides: { timeoutMs?: number; handshakeTimeoutMs?: number } = {},
): Promise<Bench> {
  const home = await mkdtemp(join(tmpdir(), "envoycoder-probe-"));
  const paths = coderPaths(home);
  const store = await CoderStore.open({ paths });

  let now = Date.parse("2026-09-14T10:00:00.000Z");
  let spawns = 0;
  const launches: { harness: HarnessId; cwd: string }[] = [];
  let script: SessionProbeDeps["startClient"] = async () => scriptedAgent(DSH_OPTIONS).agent;
  const builds = new Map<HarnessId, string>();

  const probe = new SessionProbe({
    paths,
    store,
    now: () => new Date(now),
    // **The launch is injected, and deliberately not the real one.** `launchForHarness` probes this
    // machine for an installed agent, and a test that depended on `dsh` being installed here would skip
    // or fail for everybody else. What the probe *asks it for* is asserted instead — which harness, which
    // directory — and the real resolution is exercised in `acp-transport.test.ts`.
    resolveLaunch: (input) => {
      launches.push({ harness: input.harness, cwd: input.cwd });
      return { command: process.execPath, args: ["-e", ""], cwd: input.cwd };
    },
    // Deterministic too, and the only way to test the changed-build rule without rebuilding an agent.
    fingerprint: (harness) => builds.get(harness) ?? "build-1",
    startClient: async (options) => {
      spawns += 1;
      return script!(options);
    },
    ...overrides,
  });

  cleanups.push(async () => {
    await probe.stopAll();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  return {
    probe,
    store,
    paths,
    spawns: () => spawns,
    launches: () => launches,
    script: (start) => {
      script = start;
    },
    advance: (ms) => {
      now += ms;
    },
    setBuild: (harness, fingerprint) => {
      builds.set(harness, fingerprint);
    },
    recorded: (harness) => store.sessionOptions(harness),
    file: async () => {
      try {
        return await readFile(paths.sessionOptionsFile, "utf8");
      } catch {
        return "";
      }
    },
    recordedAuth: (harness) => store.agentAuth(harness),
    authFile: async () => {
      try {
        return await readFile(paths.agentAuthFile, "utf8");
      } catch {
        return "";
      }
    },
  };
}

/* ────────────────────────────── the three outcomes ────────────────────────────── */

describe("what asking an agent can come back as", () => {
  it("records what a session published, in the run's own shape", async () => {
    const b = await bench();
    const answer = await b.probe.probe("deepseek-harness");

    expect(answer.outcome).toBe("listed");
    // The record goes through `observeSessionOptions`, the same normalization a run's session goes
    // through, so the file cannot hold two shapes depending on which path produced it.
    const recorded = b.recorded("deepseek-harness");
    expect(recorded?.harness).toBe("deepseek-harness");
    expect(recorded?.observedAt).toBe("2026-09-14T10:00:00.000Z");
    expect(recorded?.sessionId).toBe("session-from-the-scripted-agent");
    expect(recorded?.options.map((option) => option.configId)).toEqual(["model", "reasoning_effort"]);
    // The agent's own words, kept verbatim underneath — including the group nesting the model option uses.
    expect(recorded?.options[1]?.values.map((value) => value.value)).toEqual(["off", "max"]);
    expect(recorded?.options[1]?.values[1]?.description).toBe("Think as hard as this model can.");
  }, 20_000);

  it("spawns in its own scratch directory, not in a task's folder", async () => {
    const b = await bench();
    await b.probe.probe("deepseek-harness");

    // A probe must never open a session inside the user's repository: the agent would see (and could
    // index, or run `git` in) a tree nobody asked it to touch. The facts a probe reads belong to the
    // agent's own installation, so the directory it runs in is ours, under the daemon's state folder.
    expect(b.launches()).toHaveLength(1);
    expect(b.launches()[0]?.harness).toBe("deepseek-harness");
    expect(b.launches()[0]?.cwd).toBe(join(b.paths.stateDir, "agent-probe", "deepseek-harness"));
    expect(existsSync(b.launches()[0]!.cwd)).toBe(true);
  }, 20_000);

  it("records a session that published nothing as a fact about the agent", async () => {
    const b = await bench();
    // What `envoy-harness` answers: `{sessionId}` with no `configOptions` at all.
    b.script(async () => scriptedAgent([]).agent);

    const answer = await b.probe.probe("envoy-harness");

    expect(answer.outcome).toBe("none");
    // **Written, not skipped.** "We opened a session and it published nothing" is a different statement
    // from "we have not looked yet", and it is exactly the distinction the thinking pill rests on.
    expect(b.recorded("envoy-harness")?.options).toEqual([]);
    expect(b.recorded("envoy-harness")?.observedAt).toBe("2026-09-14T10:00:00.000Z");
  }, 20_000);

  it("writes nothing at all when it could not ask", async () => {
    const b = await bench();
    b.script(async () => {
      throw new Error("The agent did not answer initialize within 20s.");
    });

    const answer = await b.probe.probe("deepseek-harness");

    expect(answer.outcome).toBe("unreachable");
    // **The defect this third outcome exists for.** A failure of ours must never be recorded as an answer
    // the agent gave, because the window renders the record — and would then say "this agent publishes
    // none" about an agent that was never asked.
    expect(b.recorded("deepseek-harness")).toBeUndefined();
    expect(await b.file()).toBe("");
    expect(existsSync(b.paths.sessionOptionsFile)).toBe(false);
  }, 20_000);

  it("keeps a previous observation when a later ask fails", async () => {
    const b = await bench();
    await b.probe.probe("deepseek-harness");
    const before = await b.file();

    b.advance(PROBE_STALE_MS + 1);
    b.script(async () => {
      throw new Error("spawn ENOENT");
    });
    const answer = await b.probe.probe("deepseek-harness");

    expect(answer.outcome).toBe("unreachable");
    // The list the user is looking at stays the list we actually saw: a failed ask does not erase it and
    // does not replace it with an empty one.
    expect(await b.file()).toBe(before);
    expect(b.recorded("deepseek-harness")?.options).toHaveLength(2);
  }, 20_000);
});

/* ────────────────────────────── the sentences ────────────────────────────── */

describe("what the window will render for each outcome", () => {
  it("carries a catalogue key this build has, for the two outcomes a window draws", async () => {
    const b = await bench();

    b.script(async () => scriptedAgent([]).agent);
    const none = await b.probe.probe("envoy-harness");
    b.advance(PROBE_STALE_MS + 1);
    b.script(async () => {
      throw new Error("spawn ENOENT");
    });
    const failed = await b.probe.probe("deepseek-harness");

    for (const answer of [none, failed]) {
      const parsed = parseMessageRef(answer.detail);
      expect(parsed.ref?.key, `${answer.outcome} carries no key`).toBeDefined();
      // `keyed()` takes a `MessageKey`, so a typo is a `tsc` error; this is the other half — a key that was
      // renamed out from under the sentence would otherwise render as an English line in a German window.
      expect(isMessageKey(parsed.ref!.key), `${parsed.ref!.key} is not in the catalogue`).toBe(true);
      // And the English catalogue holds the *same sentence*, interpolated with the values the daemon sent:
      // the window renders the key, so an English user must read exactly what the daemon wrote — and a
      // translator has one string to translate rather than two that could drift. Rendered through
      // `localizeText`, which is the window's own path, rather than by comparing templates here.
      expect(localizeText(createTranslator("en").t, answer.detail)).toBe(parsed.text);
    }
    // The agent's own words travel as a value, so a German sentence can put them where German wants them.
    expect(parseMessageRef(failed.detail).ref?.values?.reason).toContain("spawn ENOENT");
  }, 20_000);

  it("does not key the listed sentence, because nothing draws it", async () => {
    const b = await bench();
    const answer = await b.probe.probe("deepseek-harness");

    // For `listed` the store's record is what the user sees — the pickers fill, and the "observed at
    // {time}" note gains this session's timestamp. So this line is evidence for a test and a maintainer,
    // and a catalogue key whose sentence no window draws is a key nothing keeps honest.
    expect(parseMessageRef(answer.detail).ref).toBeUndefined();
    expect(answer.detail).toContain("published 2 option(s): model, reasoning_effort.");
  }, 20_000);
});

/* ────────────────────────────── the bounds on cost ────────────────────────────── */

describe("a probe is a process, so it is spent deliberately", () => {
  it("answers a second ask from the record instead of spawning again", async () => {
    const b = await bench();
    await b.probe.probe("deepseek-harness");
    expect(b.spawns()).toBe(1);

    const second = await b.probe.probe("deepseek-harness");

    expect(second.outcome).toBe("listed");
    expect(b.spawns()).toBe(1);
  }, 20_000);

  it("re-probes when the agent's build has changed", async () => {
    const b = await bench();
    await b.probe.probe("deepseek-harness");
    expect(b.spawns()).toBe(1);

    // The user upgraded their agent. The list we have describes a build that is gone, so it must not
    // answer for this one — the rule that keeps a cache from outliving the thing it caches.
    b.setBuild("deepseek-harness", "build-2");
    const answer = await b.probe.probe("deepseek-harness");

    expect(answer.outcome).toBe("listed");
    expect(b.spawns()).toBe(2);
  }, 20_000);

  it("re-probes once the observation is stale", async () => {
    const b = await bench();
    await b.probe.probe("deepseek-harness");
    expect(b.spawns()).toBe(1);

    // One millisecond short of the window: still an answer. Past it: ask the agent again.
    b.advance(PROBE_STALE_MS - 1);
    await b.probe.probe("deepseek-harness");
    expect(b.spawns()).toBe(1);
    b.advance(2);
    await b.probe.probe("deepseek-harness");
    expect(b.spawns()).toBe(2);
  }, 20_000);

  it("does not answer a forced ask from the cache, because a button means it", async () => {
    const b = await bench();
    await b.probe.probe("deepseek-harness");
    expect(b.spawns()).toBe(1);

    await b.probe.probe("deepseek-harness", { force: true });

    expect(b.spawns()).toBe(2);
  }, 20_000);

  it("never serves a failure from the cache, so the next ask is the retry", async () => {
    const b = await bench();
    b.script(async () => {
      throw new Error("spawn ENOENT");
    });
    await b.probe.probe("deepseek-harness");
    expect(b.spawns()).toBe(1);

    // The user installs the agent and asks again — no `force`, and no waiting out a staleness window that
    // would have been describing a failure.
    b.script(async () => scriptedAgent(DSH_OPTIONS).agent);
    const answer = await b.probe.probe("deepseek-harness");

    expect(b.spawns()).toBe(2);
    expect(answer.outcome).toBe("listed");
  }, 20_000);

  it("joins a probe already in flight rather than starting a second agent", async () => {
    const b = await bench();
    /** The first attempt is parked inside the agent until this is released. */
    let release: () => void = () => undefined;
    /** Resolves when the first attempt has actually reached the agent. */
    let reachedAgent: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      reachedAgent = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    b.script(async () => {
      reachedAgent();
      await gate;
      return scriptedAgent(DSH_OPTIONS).agent;
    });

    const first = b.probe.probe("deepseek-harness");
    // The second ask is made in the **same turn**, before the first has spawned anything: this is the case
    // a registration that happened after an `await` would miss, and it is the normal case in production
    // (the composer asks, the phone asks).
    const second = b.probe.probe("deepseek-harness", { force: true });
    await entered;
    release();

    const [a, c] = await Promise.all([first, second]);
    expect(b.spawns()).toBe(1);
    // Even a *forced* ask joins: two probes racing would write two observations, and the loser could be
    // the older one — which is how a window ends up showing a list the agent has already replaced.
    expect(a).toBe(c);
    expect(a.outcome).toBe("listed");
  }, 20_000);

  it("gives up on an agent that never answers, and records nothing", async () => {
    // The budgets are cut to something a test can wait for. Everything else about the probe is production
    // configuration, and the *default* budgets are what the other tests run with.
    const b = await bench({ timeoutMs: 60, handshakeTimeoutMs: 60 });
    b.script(async () => {
      // An agent that took the process and then said nothing at all: a wedged binary, which is exactly
      // what the outer budget is for. This never settles, so the probe has to walk away from it.
      await new Promise<void>(() => undefined);
      return scriptedAgent(DSH_OPTIONS).agent;
    });

    const answer = await b.probe.probe("deepseek-harness");

    expect(answer.outcome).toBe("unreachable");
    expect(parseMessageRef(answer.detail).text).toContain("did not answer within");
    expect(b.recorded("deepseek-harness")).toBeUndefined();
  }, 20_000);

  it("stops the agent it opened, exactly once, even when shutdown races it", async () => {
    const b = await bench();
    let stops = 0;
    /** Resolves once the probe's own teardown has begun. */
    let teardownBegan: () => void = () => undefined;
    const began = new Promise<void>((resolve) => {
      teardownBegan = resolve;
    });
    /** Held so the first teardown is still in progress when the second one asks. */
    let releaseTeardown: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseTeardown = resolve;
    });
    b.script(async () =>
      scriptedAgent(DSH_OPTIONS, {
        onStop: async () => {
          stops += 1;
          teardownBegan();
          await hold;
        },
      }).agent,
    );

    const probing = b.probe.probe("deepseek-harness");
    await began;
    // The daemon is shutting down **while** the probe's own `finally` is tearing the same client down. Two
    // concurrent teardowns would write to a stdin the first one had already ended — the
    // `ERR_STREAM_WRITE_AFTER_END` this guard exists to prevent. One stop, whoever asks: the second caller
    // joins the first's promise instead of starting a second one.
    const shuttingDown = b.probe.stopAll();
    releaseTeardown();
    await Promise.all([probing, shuttingDown]);

    expect(stops).toBe(1);
  }, 20_000);
});

/* ────────────────────────────── the auth fact ────────────────────────────── */

/**
 * **Can this agent open a session, or does it want a sign-in first** — the fact beside availability.
 *
 * The two real cases are a machine that has already signed in and one that has not, and only the second is
 * the one a row has to be able to say something about — which is exactly the case a warm development machine
 * cannot produce from the real binary (`cursor-agent`'s requirement is stateful; its own entry records both
 * observations). So it is a fixture here, and `acp-agent-support.test.ts` drives the real binary for the other
 * half: that the probe learns *something* about it rather than guessing.
 */
describe("what a probe learns about authentication, on the way to asking about options", () => {
  it("says ready when a session opens, and records it with the time it looked", async () => {
    const b = await bench();

    const answer = await b.probe.probe("deepseek-harness");

    expect(answer.auth.state).toBe("ready");
    // No method id with `ready`: the schema refuses one, and the reason is that a method id beside this state
    // would claim a step is still needed by an agent that just opened a session.
    expect(answer.auth.methodId).toBeUndefined();
    // Recorded with a timestamp, so a row can say *when* rather than presenting an observation as current.
    const record = b.recordedAuth("deepseek-harness");
    expect(record?.state).toBe("ready");
    expect(record?.observedAt).toBe("2026-09-14T10:00:00.000Z");
  }, 20_000);

  it("reports needs-signin, with the method the agent named, when a session is refused", async () => {
    const b = await bench();
    // `cursor-agent acp` on a fresh installation, verbatim: the refusal is its own sentence and code, and the
    // method is one it advertised in `initialize` — which is what makes this evidence rather than prose.
    b.script(async () =>
      scriptedAgent(DSH_OPTIONS, {
        authMethods: ["cursor_login"],
        refuseSession:
          "Authentication required. Please run 'agent login' first, then call authenticate() with " +
          "methodId 'cursor_login'.",
      }).agent,
    );

    // `cursor` declares `cursor_login` in the catalogue, which is how a fresh install is one press away.
    const answer = await b.probe.probe("cursor");

    expect(answer.auth.state).toBe("needs-signin");
    expect(answer.auth.methodId).toBe("cursor_login");
    // The outcome of the *session-options* question is unchanged and still honest: we could not ask what it
    // offers, so nothing was recorded as though the agent had answered.
    expect(answer.outcome).toBe("unreachable");
    expect(b.recorded("cursor")).toBeUndefined();
    // …and the auth record is where the truth about this probe lives.
    const record = b.recordedAuth("cursor");
    expect(record?.state).toBe("needs-signin");
    expect(record?.methodId).toBe("cursor_login");
    expect(record?.detail).toContain("cursor_login");
  }, 20_000);

  it("names no method when the agent offers several and the catalogue declares none", async () => {
    const b = await bench();
    // `@agentclientprotocol/codex-acp`, which advertises two `env_var` methods and a browser login. Choosing
    // between them is the one thing this must not do: a browser method would open a window the user did not
    // ask for, and an `env_var` one would fail with a sentence about a variable.
    b.script(async () =>
      scriptedAgent(DSH_OPTIONS, {
        authMethods: ["api-key", "chat-gpt", "browser-login"],
        refuseSession: "-32000 Authentication required.",
      }).agent,
    );

    const answer = await b.probe.probe("codex");

    // The state is still honest — the agent advertised sign-in methods and would not open a session — and the
    // method is simply absent, which is a real answer rather than a gap.
    expect(answer.auth.state).toBe("needs-signin");
    expect(answer.auth.methodId).toBeUndefined();
    expect(b.recordedAuth("codex")?.methodId).toBeUndefined();
  }, 20_000);

  it("stays unknown when a session fails and the agent offers no way to sign in", async () => {
    const b = await bench();
    // An agent that advertised nothing and will not open a session has not told us a login would help. Saying
    // `needs-signin` here is the invention this state exists to refuse: it would send a user to perform a step
    // that changes nothing.
    b.script(async () =>
      scriptedAgent(DSH_OPTIONS, { refuseSession: "Internal error: workspace is not writable" }).agent,
    );

    const answer = await b.probe.probe("deepseek-harness");

    expect(answer.auth.state).toBe("unknown");
    expect(answer.auth.methodId).toBeUndefined();
    // The reason is kept, so a maintainer reading the file learns *why* we could not tell.
    expect(b.recordedAuth("deepseek-harness")?.detail).toContain("not writable");
  }, 20_000);

  it("does not authenticate on the way to asking, because that would change what it measures", async () => {
    const b = await bench();
    let signIns = 0;
    let askedInitializeOnly: boolean | undefined;
    b.script(async (options) => {
      askedInitializeOnly = options.initializeOnly;
      const scripted = scriptedAgent(DSH_OPTIONS);
      return {
        ...scripted.agent,
        signIn: async () => {
          signIns += 1;
        },
      };
    });

    await b.probe.probe("cursor");

    // **The whole reason the probe is allowed near an agent that needs a sign-in.** A probe that sent the
    // step would be measuring its own side effect, and for a browser-login method it would open a window on
    // the user's desktop that nobody asked for. The flag is how the client is told to stop after the
    // handshake, and `cursor` is the entry that declares a method — so a probe that ignored this would
    // authenticate here.
    expect(askedInitializeOnly).toBe(true);
    expect(signIns).toBe(0);
  }, 20_000);

  it("writes the auth record while leaving the session-options record untouched", async () => {
    const b = await bench();
    b.script(async () => scriptedAgent(DSH_OPTIONS, { refuseSession: "-32000 Authentication required." }).agent);

    await b.probe.probe("deepseek-harness");

    // Two files, and each says what it is entitled to say. The session-options one is empty — "we could not
    // ask what you offer" is not an answer the agent gave — while the auth one holds a real observation: a
    // session did not open. That split is why this is its own collection rather than a field.
    expect(await b.file()).toBe("");
    expect(await b.authFile()).toContain("\"harness\": \"deepseek-harness\"");
  }, 20_000);

  it("replaces a stale needs-signin with unknown once the agent cannot be started at all", async () => {
    const b = await bench();
    b.script(async () =>
      scriptedAgent(DSH_OPTIONS, { authMethods: ["cursor_login"], refuseSession: "-32000 Authentication required." }).agent,
    );
    await b.probe.probe("cursor");
    expect(b.recordedAuth("cursor")?.state).toBe("needs-signin");

    // The user uninstalled the agent. Leaving the previous answer in front of them would be a stale fact
    // presented as a current one — and the honest replacement is "we could not tell", not a sign-in prompt
    // for a program that is gone.
    b.advance(PROBE_STALE_MS + 1);
    b.script(async () => {
      throw new Error("spawn ENOENT");
    });
    const answer = await b.probe.probe("cursor");

    expect(answer.auth.state).toBe("unknown");
    expect(b.recordedAuth("cursor")?.state).toBe("unknown");
  }, 20_000);
});
