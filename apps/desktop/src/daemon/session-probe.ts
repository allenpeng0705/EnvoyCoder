/**
 * The pre-flight probe: **ask an agent what it offers, before the first run.**
 *
 * ## The gap this closes
 *
 * Both native harnesses publish their model list and their thinking levels in the `session/new`
 * response, and nowhere else. So until this module existed, the three pills were populated for one
 * agent and hand-typed for the other, and the user could not tell why:
 *
 *   * `envoy-harness` has no per-session options at all, and its models are a static list of provider
 *     defaults it takes as `--provider`/`--model` argv — a catalogue fact, cited in `models.ts`;
 *   * `deepseek-harness` **publishes** `provider/model` pairs, with names and descriptions, plus a
 *     `reasoning_effort` level — but only inside a session, so before the first run the window had
 *     nothing to render and asked the user to type `provider/model` from memory.
 *
 * A probe closes that by doing exactly what a run does at the same point in a session's life:
 * `initialize` → `session/new {cwd, mcpServers: []}` → read `configOptions` → close it. The answer is
 * written through the **same store path a run uses** (`CoderStore.recordSessionOptions`), so there is
 * one shape of truth on disk and the window needs no new rendering path: `coder.listHarnesses` reads
 * the record it always read.
 *
 * ## One spawn path, not two
 *
 * The launch is resolved by `launch.ts` — the same function `RunManager` calls — so the probe cannot
 * drift from a run on argv, on the environment, or on which agents are drivable at all. A second spawn
 * path written from memory is how the two come to disagree on the day the catalogue changes.
 *
 * ## Three outcomes, never two
 *
 * `PROBE_OUTCOMES` in `@envoycoder/protocol` is the type; this is what produces each one, and the
 * distinction is the whole reason the type exists:
 *
 *   * **`listed`** — the session opened and published options. Recorded.
 *   * **`none`** — the session opened and published nothing. Recorded **as an observation**, because
 *     "we asked and it offered nothing" is a fact about the agent; it is what a run records for
 *     `envoy-harness` too.
 *   * **`unreachable`** — the binary is missing, it is not drivable, it refused to start, it never
 *     answered, or the budget ran out. **Nothing is written.** Rendering this as `"none"` would be the
 *     defect this product keeps refusing: a failure of ours reported as a fact about somebody else's
 *     product, which the user then cannot tell apart from the truth.
 *
 * ## Cost, bounded in four ways
 *
 * A probe is a process spawn, so it is never free and never automatic-by-default:
 *
 *   1. **On demand only.** Nothing here runs at daemon boot, on a timer, or as a side effect of
 *      `coder.listHarnesses` — the window asks through `coder.probeSessionOptions` when a control
 *      actually needs the list, and the composer asks **once per agent** for as long as the pane lives.
 *   2. **Cached, with a staleness window of `PROBE_STALE_MS` (10 minutes) and a build fingerprint.**
 *      A second window, a phone, or a pane re-render gets the answer we already have instead of a new
 *      agent process. The fingerprint is the agent binary's path, mtime and size, so **a changed agent
 *      build is re-probed** rather than served from a cache describing the previous install. Ten
 *      minutes is chosen against the two things that actually change a list: the agent's build (caught
 *      by the fingerprint, not by the clock) and the user's credentials (rare; and the window's
 *      *Ask again* forces past the cache, which is what the `force` flag is for).
 *   3. **Serialised per agent.** Two asks for one agent never spawn two processes: the second joins the
 *      first's answer. Probes of *different* agents are independent on purpose — a hung probe of one
 *      agent must not stall the ask for another.
 *   4. **Bounded by a timeout**, and the bound is mostly the client's own handshake budget
 *      (`PROBE_HANDSHAKE_MS` per request, so a wedged agent fails with the client's own sentence) with
 *      `PROBE_TIMEOUT_MS` as the outer ceiling on the whole probe.
 *
 * The cache lives in memory and dies with the daemon. That is deliberate rather than unfinished: the
 * durable record is the store's (`session-options.json`), a daemon restart is a legitimate moment to
 * ask again, and a second on-disk file would be a second thing to quarantine, migrate and keep in step
 * with the first.
 *
 * ## Teardown, which is where this could make an existing flake worse
 *
 * `AcpClient.write` can raise `ERR_STREAM_WRITE_AFTER_END` when something writes to stdin after
 * `stop()` has ended it, and a probe is exactly the kind of short-lived client that would trip it.
 * Three things keep this orderly:
 *
 *   * `stopClient` is **guarded per client** — the probe's own `finally` and a daemon shutdown can both
 *     ask, and the second gets the first's promise rather than starting a second teardown;
 *   * a client that arrives **after** the outer timeout is stopped too (`acquire`), because a client
 *     nobody stops is a leaked agent process;
 *   * nothing writes to the session once teardown has started: the probe never prompts, so the only
 *     traffic is the client's own `session/close` → stdin EOF → signal sequence.
 *
 * ## What a probe deliberately does not do
 *
 * It sends **no** model, mode or policy. The question is "what does this agent offer with nothing
 * chosen", which is exactly the state the pickers are in before a first run; asking with a model set
 * would answer a question about a run that does not exist.
 */

import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { HarnessId, ProbeOutcome } from "@envoycoder/protocol";
import { coderErrorMessage } from "@envoycoder/protocol";
import { harnessDefinition, observeSessionOptions, probeHarness } from "@envoycoder/agent-catalog";
import type { PlatformId } from "@envoycoder/platform";
import type { CoderPaths } from "@envoycoder/host-bridge";

import { AcpClient, type AcpLaunch } from "./acp/client.js";
import { launchForHarness } from "./launch.js";
import { keyed } from "./messages.js";
import type { CoderStore } from "./store.js";

/**
 * How long the **whole** probe may take, including the teardown.
 *
 * The outer ceiling only: the handshake inside it has its own, shorter budget, which is the failure
 * with the better sentence. This exists so that "a probe answers within 30 seconds" is a property of
 * this module rather than a hope about two timeouts composing.
 */
export const PROBE_TIMEOUT_MS = 30_000;

/**
 * Per-request budget for the two handshake calls.
 *
 * Deliberately short: `initialize` and `session/new` are milliseconds of real work, so anything near
 * this is a wedged agent — and a user waiting on a button should hear that rather than wait for the
 * outer ceiling. It is also the bound that keeps a timed-out probe from leaking a process, because it
 * rejects inside `AcpClient.start`, which stops the half-started child itself.
 */
export const PROBE_HANDSHAKE_MS = 20_000;

/**
 * How long an observation answers for, when the agent's build has not changed.
 *
 * See the module doc for how this was chosen: a list changes when the *build* changes (caught by the
 * fingerprint) or when the user's credentials change (rare, and *Ask again* forces).
 */
export const PROBE_STALE_MS = 10 * 60_000;

/** How long a shutdown waits for answers in flight before giving up on them. */
const PROBE_STOP_BUDGET_MS = 5_000;

/**
 * What the probe needs from a **started agent**, as a port rather than `AcpClient` itself.
 *
 * `AcpClient`'s members are private, which makes the class nominal in TypeScript: a fake cannot be
 * assigned to it, so a test that wanted to drive the probe's decisions without a process would need a
 * cast. A port states what the probe actually uses — the session id, what that session published, and
 * `stop` — so the fake is an ordinary object, the real client satisfies it as it stands, and the seam
 * documents itself.
 */
export interface ProbedSession {
  readonly sessionId: string | undefined;
  sessionConfigOptions(): readonly unknown[];
  stop(): Promise<void>;
}

/** How to start one, with the two budgets the probe imposes. `AcpClient.start` satisfies this. */
export type StartSession = (options: {
  launch: AcpLaunch;
  handshakeTimeoutMs: number;
  requestTimeoutMs: number;
}) => Promise<ProbedSession>;

export interface SessionProbeDeps {
  paths: CoderPaths;
  store: CoderStore;
  /** Resolve the agent's binary and argv. Injected so tests drive a fixture, not a real CLI. */
  resolveLaunch?: (input: {
    harness: HarnessId;
    cwd: string;
    extraArgs?: string;
    model?: string;
  }) => AcpLaunch;
  platform?: PlatformId;
  now?: () => Date;
  /** The ACP client constructor. Overridden by tests, which must not spawn real agents. */
  startClient?: StartSession;
  /**
   * The two budgets, injectable **so that the bound can be proved without waiting for it**.
   *
   * The defaults are the policy (`PROBE_HANDSHAKE_MS`, `PROBE_TIMEOUT_MS`); a test that wants to watch a
   * whole probe give up sets them to tens of milliseconds rather than sitting out a minute. Same
   * arrangement as `AcpClientOptions.handshakeTimeoutMs`.
   */
  timeoutMs?: number;
  handshakeTimeoutMs?: number;
  /**
   * What identifies the installed agent's **build**, so the cache is dropped when it changes.
   *
   * Defaults to the resolved binary's path + mtime + size. Injectable so the rule is testable without
   * rebuilding an agent, and because "cheap to detect" is the only requirement here: `undefined` never
   * matches a cache entry, so an unmeasurable build is re-probed rather than trusted.
   */
  fingerprint?: (harness: HarnessId) => string | undefined;
}

/** What asking came back as. The wire's result, and the shape the store's record was built from. */
export interface ProbeAnswer {
  harness: HarnessId;
  outcome: ProbeOutcome;
  /** The evidence, or the reason we could not ask. A keyed English sentence. */
  detail: string;
}

interface CacheEntry {
  /** When the answer was produced, on this daemon's clock, for the staleness comparison. */
  at: number;
  /** The agent build the answer describes. `undefined` never matches. */
  fingerprint: string | undefined;
  answer: ProbeAnswer;
}

export class SessionProbe {
  private readonly deps: SessionProbeDeps;
  /** Answers we already have. Dropped by a build change, by staleness, and by `force`. */
  private readonly cache = new Map<HarnessId, CacheEntry>();
  /** One probe per agent at a time: a second ask joins the first rather than spawning again. */
  private readonly inflight = new Map<HarnessId, Promise<ProbeAnswer>>();
  /** The clients this probe owns right now, so a daemon shutdown can stop them. */
  private readonly live = new Set<ProbedSession>();
  /** Teardowns already under way, so a second `stop` joins rather than racing. See the module doc. */
  private readonly stopping = new Map<ProbedSession, Promise<void>>();

  constructor(deps: SessionProbeDeps) {
    this.deps = deps;
  }

  /**
   * Ask this agent what it offers — or answer from a recent observation.
   *
   * `force` is "ask the agent, not your notes": it is what the window's *Ask again* sends, and it is
   * the only way past a fresh cache entry. It does **not** bypass the in-flight join, because two probes
   * of one agent racing would write two observations and the loser could be the older one.
   */
  async probe(harness: HarnessId, options: { force?: boolean } = {}): Promise<ProbeAnswer> {
    const running = this.inflight.get(harness);
    if (running) return running;
    return this.begin(harness, options);
  }

  /**
   * Start one attempt and register it **before returning**, which is the whole reason this is a separate
   * method.
   *
   * The registration has to happen in the same synchronous turn as the call. A version that awaited the
   * cache lookup first — `await this.fresh(...)`, a `stat` of the agent's binary — would leave a window in
   * which a second ask sees no probe in flight, and two asks arriving together is the normal case
   * (the composer asks, the phone asks). Two processes for one question is exactly what "serialised per
   * agent" promises not to happen, and nothing about the promise is visible in a test that asks twice in
   * sequence — `session-probe.test.ts` asks twice in one turn for that reason.
   */
  private begin(harness: HarnessId, options: { force?: boolean }): Promise<ProbeAnswer> {
    const attempt = (async (): Promise<ProbeAnswer> => {
      if (options.force !== true) {
        const cached = await this.fresh(harness);
        if (cached) return cached;
      }
      return this.run(harness);
    })().finally(() => {
      this.inflight.delete(harness);
    });
    this.inflight.set(harness, attempt);
    return attempt;
  }

  /** Stop every agent this probe owns, and wait — bounded — for the answers in flight to land. */
  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.live].map((client) => this.stopClient(client)));
    await Promise.race([
      Promise.allSettled([...this.inflight.values()]),
      new Promise((resolve) => setTimeout(resolve, PROBE_STOP_BUDGET_MS)),
    ]);
  }

  /* ────────────────────────────── the cache: the first bound on cost ────────────────────────────── */

  /**
   * A recent answer about the same build, or `undefined`.
   *
   * Only successful outcomes are cached: `listed` and `none` are facts about the agent, while
   * `unreachable` is the *absence* of an answer — a state that changes under us when the user installs
   * the agent or adds a credential. Serving a failure from cache would hide the retry that fixes it.
   */
  private async fresh(harness: HarnessId): Promise<ProbeAnswer | undefined> {
    const entry = this.cache.get(harness);
    if (!entry) return undefined;
    if (this.nowMs() - entry.at >= PROBE_STALE_MS) return undefined;
    // An unmeasurable build never matches, on either side: a fingerprint we cannot take is not evidence
    // that nothing changed.
    const current = await this.fingerprintOf(harness);
    if (current === undefined || entry.fingerprint !== current) return undefined;
    return entry.answer;
  }

  /** The agent's installed build, or `undefined` when we cannot tell. Path + mtime + size. */
  private async fingerprintOf(harness: HarnessId): Promise<string | undefined> {
    if (this.deps.fingerprint) return this.deps.fingerprint(harness);
    const probe = probeHarness(harness, this.deps.platform ? { platform: this.deps.platform } : {});
    if (!probe.available || probe.binaryPath === undefined) return undefined;
    // `stat`, not a hash: this runs on every ask, and a build whose content changed without its mtime or
    // size changing is not a case worth reading 40 MB per click for. Wrapped rather than allowed to
    // throw, because a fingerprint we cannot take must not fail an ask.
    try {
      const info = await stat(probe.binaryPath);
      return `${probe.binaryPath}:${info.mtimeMs}:${info.size}`;
    } catch {
      return undefined;
    }
  }

  /* ────────────────────────────── one probe ────────────────────────────── */

  private async run(harness: HarnessId): Promise<ProbeAnswer> {
    const label = harnessDefinition(harness).label;
    let client: ProbedSession | undefined;
    try {
      const cwd = await this.probeDir(harness);
      const launch = this.deps.resolveLaunch
        ? this.deps.resolveLaunch({ harness, cwd })
        : launchForHarness({
            harness,
            cwd,
            paths: this.deps.paths,
            ...(this.deps.platform ? { platform: this.deps.platform } : {}),
          });

      client = await this.acquire(launch);
      // The options the agent published, **verbatim** — normalized by `observeSessionOptions`, which is
      // the same function a run goes through, so the record on disk has one shape whichever path
      // produced it. Read straight off the client, so nothing can happen between the session opening
      // and this daemon keeping what it said.
      const observation = observeSessionOptions({
        harness,
        observedAt: this.now(),
        ...(client.sessionId !== undefined ? { sessionId: client.sessionId } : {}),
        configOptions: client.sessionConfigOptions(),
      });
      await this.deps.store.recordSessionOptions(observation);

      const answer: ProbeAnswer =
        observation.options.length > 0
          ? {
              harness,
              outcome: "listed",
              // **Evidence rather than prose, and deliberately not keyed.** Nothing renders this one: the
              // store's record is what the user sees — the pickers fill, and the "observed at {time}"
              // note gains the timestamp of the session this probe just opened. A catalogue key whose
              // sentence no window draws is a key nobody maintains and nothing can notice rotting, so
              // this stays a plain English line for the tests and for whoever reads a raw answer.
              detail:
                `${label} opened a session and published ${observation.options.length} option(s): ` +
                `${observation.options.map((option) => option.configId).join(", ")}.`,
            }
          : {
              harness,
              outcome: "none",
              detail: keyed(
                "task.composer.probe.none",
                `${label} answered and published nothing to choose from, so there is still no list here — ` +
                  `type a value it documents, or pick one after the first run.`,
                { agent: label },
              ),
            };

      this.cache.set(harness, {
        at: this.nowMs(),
        fingerprint: await this.fingerprintOf(harness),
        answer,
      });
      return answer;
    } catch (error) {
      // **Nothing is written.** See the module doc: "we could not ask" is not an answer the agent gave,
      // and recording it would turn our failure into a claim about somebody else's product. The reason is
      // put through `coderErrorMessage`, so a keyed refusal from `launch.ts` is embedded as the plain
      // sentence it carries rather than with its own marker (the outer sentence is the one keyed here).
      const reason = coderErrorMessage(error instanceof Error ? error.message : String(error));
      return {
        harness,
        outcome: "unreachable",
        detail: keyed(
          "task.composer.probe.failed",
          `EnvoyCoder could not ask ${label} what it offers: ${reason} Nothing you see has changed.`,
          { agent: label, reason },
        ),
      };
    } finally {
      await this.stopClient(client);
    }
  }

  /**
   * Start the client, under the outer ceiling — **and never leave a process behind.**
   *
   * `AcpClient.start` spawns the child before it handshakes, so a timeout during the handshake leaves a
   * process whose only reference is the promise we walked away from. When that promise does settle — the
   * client's own handshake budget expires, or the agent answers very late — whatever it resolves to is
   * stopped here rather than abandoned. If it rejects, `AcpClient.start` has already stopped it
   * internally, and the rejection is swallowed.
   */
  private async acquire(launch: AcpLaunch): Promise<ProbedSession> {
    const startClient = this.deps.startClient ?? AcpClient.start;
    const budget = this.deps.timeoutMs ?? PROBE_TIMEOUT_MS;
    const pending = startClient({
      launch,
      handshakeTimeoutMs: this.deps.handshakeTimeoutMs ?? PROBE_HANDSHAKE_MS,
      // The probe sends no prompt. This is set anyway so that a future probe which does cannot inherit
      // the half-hour turn budget `AcpClient` defaults to.
      requestTimeoutMs: budget,
    });
    try {
      const client = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`The agent did not answer within ${Math.round(budget / 1000)}s.`)),
            budget,
          );
        }),
      ]);
      // Registered as ours **before** anything can read it, so a shutdown arriving at this instant finds
      // the process rather than a client nobody knows about.
      this.live.add(client);
      return client;
    } catch (error) {
      // The race is over — by the budget above, or because `start` itself refused. Whether the abandoned
      // promise rejects (the client stopped the half-started child itself) or resolves very late, its
      // outcome is one nobody is waiting for — and a client nobody stops is a leaked agent process.
      void pending.then((client) => this.stopClient(client)).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Stop one client, **once**, whoever asks.
   *
   * The guard is the point: this probe's own `finally` and a daemon shutdown can both fire, and two
   * concurrent teardowns would write to a stdin the first one has already ended — which is exactly the
   * `ERR_STREAM_WRITE_AFTER_END` the module doc describes. The second caller gets the first's promise.
   */
  private stopClient(client: ProbedSession | undefined): Promise<void> {
    if (client === undefined) return Promise.resolve();
    const existing = this.stopping.get(client);
    if (existing) return existing;
    const stopping = client
      .stop()
      .catch(() => undefined)
      .then(() => {
        this.live.delete(client);
        this.stopping.delete(client);
      });
    this.stopping.set(client, stopping);
    return stopping;
  }

  /* ────────────────────────────── where the probe runs ────────────────────────────── */

  /**
   * The directory the probe's session is opened in.
   *
   * **Its own scratch directory, not the user's project.** A probe is not the user's work: opening a
   * session inside their repository would make the agent look at (and possibly index, or run `git` in) a
   * tree nobody asked it to touch, and two tasks in one project would collide over it. The facts a probe
   * reads — the models a credential set makes available, the thinking levels a resolved model offers —
   * are properties of the agent's own installation rather than of the working directory.
   *
   * That is also this probe's honest limit, recorded where the choice is made: **if an agent's option
   * list ever becomes a function of the working directory**, this answer describes the probe directory
   * rather than the task's, and this is the line to revisit. The record carries the session id and the
   * timestamp, so a maintainer can tell which session produced what they are reading.
   */
  private async probeDir(harness: HarnessId): Promise<string> {
    const dir = join(
      this.deps.paths.stateDir,
      "agent-probe",
      harness.replace(/[^A-Za-z0-9._-]/g, "_"),
    );
    await mkdir(dir, { recursive: true });
    return dir;
  }

  private nowMs(): number {
    return (this.deps.now?.() ?? new Date()).getTime();
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
}
