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

import type { HarnessId, ObservedSessionOptions } from "@envoycoder/protocol";
import { parseMessageRef } from "@envoycoder/protocol";
import { coderPaths } from "@envoycoder/host-bridge";

import { isMessageKey } from "../src/i18n/messages/en.js";
import { localizeText } from "../src/i18n/notice.js";
import { createTranslator } from "../src/i18n/translate.js";
import {
  PROBE_STALE_MS,
  SessionProbe,
  type ProbedSession,
  type SessionProbeDeps,
} from "../src/daemon/session-probe.js";
import { CoderStore } from "../src/daemon/store.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A scripted agent session.
 *
 * `configOptions` is what this session published, in the agent's own shape — not ours: it is the option
 * list an ACP agent answers `session/new` with. Empty is the case `envoy-harness` genuinely produces.
 */
function scriptedSession(
  configOptions: readonly unknown[],
  hooks: { onStop?: () => void | Promise<void> } = {},
): { session: ProbedSession; stops: () => number } {
  let stops = 0;
  return {
    session: {
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
  let script: SessionProbeDeps["startClient"] = async () => scriptedSession(DSH_OPTIONS).session;
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
    b.script(async () => scriptedSession([]).session);

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

    b.script(async () => scriptedSession([]).session);
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
    b.script(async () => scriptedSession(DSH_OPTIONS).session);
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
      return scriptedSession(DSH_OPTIONS).session;
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
      return scriptedSession(DSH_OPTIONS).session;
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
      scriptedSession(DSH_OPTIONS, {
        onStop: async () => {
          stops += 1;
          teardownBegan();
          await hold;
        },
      }).session,
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
