/**
 * The agent processes this daemon owns **outside a run**: where they are started, and how each one is
 * stopped exactly once.
 *
 * ## Why this is a module rather than two private methods
 *
 * `SessionProbe` was the first thing here that started an agent nobody asked a *run* of, and it learned a
 * lesson the hard way — recorded in its own head doc and in `docs/settings-parity.md` §7.8: two callers
 * really do arrive together (the flow's own `finally`, and `RunManager.stopAll` during shutdown), and two
 * concurrent teardowns write `session/close` to a stdin the first one has already ended. That is the
 * intermittent `ERR_STREAM_WRITE_AFTER_END` this repository kept seeing, and the fix was a per-client memo
 * rather than an `async` method: an `async` function wraps whatever it returns in a *fresh* promise, so two
 * callers would be back to having two.
 *
 * `SessionSignIn` is the second flow of the same shape — a short-lived agent, a daemon that may shut down
 * underneath it, and a process that must not be leaked — and copying those two maps into it would be the
 * second implementation of a rule whose whole point is that there is one. So the maps live here, both
 * flows use it, and "stop what you started, once, whoever asks" is one function.
 *
 * ## What this is deliberately not
 *
 * It is not a pool, a registry keyed by agent, or a policy about which client belongs to which task: those
 * are `RunManager`'s business, and it owns its clients itself (a run's lifetime is a *task*'s). This holds
 * the clients of flows that have no task — a probe and a sign-in — so that a shutdown can find them and
 * nothing is left running on the user's machine.
 *
 * The second half of the module is the other thing those two flows share: **where** they run an agent.
 * `agentScratchDir` is one function because there is one answer — a directory belonging to this daemon
 * rather than to the user's repository — and a second spelling of it is how a probe and a sign-in come to
 * run in two different places for no reason anybody could explain.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { CoderPaths } from "@envoydev/host-bridge";

import type { AcpLaunch } from "./acp/client.js";

/**
 * What a flow needs from a **started agent**, as a port rather than `AcpClient` itself.
 *
 * `AcpClient`'s members are private, which makes the class nominal in TypeScript: a fake cannot be
 * assigned to it, so a test that wanted to drive a flow's decisions without a process would need a cast. A
 * port states what the flows actually use, so the fake is an ordinary object, the real client satisfies it
 * as it stands, and the seam documents itself.
 *
 * **It models an agent, not a session, and that widening is what the auth fact needed.** The probe's
 * question is no longer only "what does this agent offer once a session exists" but also "can it open one
 * here" — and the second question has a *failed* answer, which is precisely the case a port that handed back
 * a ready-made session could not express. So the caller opens the session itself, and a refusal is an
 * ordinary rejection it can classify. `AcpClient` is started with `initializeOnly` to reach this state; see
 * that option for why a probe must not authenticate on its way here.
 *
 * It lives in this module rather than beside the probe because **both** flows are its callers now: a probe
 * uses `authMethods` and `openSession`, a sign-in uses those and `signIn`, and a contract two flows share
 * belongs with the thing they share rather than inside one of them.
 */
export interface ProbedAgent {
  /** The sign-in methods the agent advertised in `initialize`, verbatim. Empty for most agents. */
  authMethods(): readonly string[];
  /**
   * **The command a terminal would run to sign this agent in**, when it advertises one (`_meta["terminal-auth"]`).
   *
   * On this interface rather than only on `AcpClient`, because both flows that record an auth observation hold a
   * `ProbedAgent` — and the fact belongs to the same answer they are recording: Copilot's protocol step cannot
   * perform its login, so a row without this would offer a **Sign in** button that changes nothing.
   */
  authTerminalCommand(methodId?: string): string | undefined;
  /**
   * Send the agent's own `authenticate` step (`AcpClient.signIn`).
   *
   * On the port rather than only on the client because it is what a **sign-in** is, and the two flows share
   * this contract: a probe calls `openSession` and never this one, which is exactly the difference between
   * measuring an agent and changing it. A caller must take the id from `authMethods()` — see
   * `auth-observation.ts`'s `signInMethod`, which is the only thing in this daemon that picks one.
   */
  signIn(methodId: string): Promise<void>;
  /** Open a session. Resolves, or rejects with the agent's own refusal — which is the fact being measured. */
  openSession(): Promise<unknown>;
  readonly sessionId: string | undefined;
  sessionConfigOptions(): readonly unknown[];
  stop(): Promise<void>;
}

/** How to start one, with the two budgets a flow imposes. `AcpClient.start` satisfies this. */
export type StartSession = (options: {
  launch: AcpLaunch;
  handshakeTimeoutMs: number;
  requestTimeoutMs: number;
  /** See `AcpClientOptions.initializeOnly`: handshake only, so the probe can measure without changing. */
  initializeOnly: true;
}) => Promise<ProbedAgent>;

/** The minimum a flow here needs from an agent process: it can be stopped. */
export interface StoppableClient {
  stop(): Promise<void>;
}

export class OwnedClients<T extends StoppableClient> {
  /** The clients this flow currently holds. Registered before anything can read them. */
  private readonly live = new Set<T>();
  /** Teardowns already under way, so a second ask joins rather than racing. */
  private readonly stopping = new Map<T, Promise<void>>();

  /** Take ownership. Called the moment a client exists, so a shutdown arriving now finds it. */
  add(client: T): void {
    this.live.add(client);
  }

  /**
   * Stop one client, **once**, whoever asks.
   *
   * The guard is the point and it is deliberate rather than defensive: two concurrent teardowns of the same
   * process write to a stdin the first has already ended. The second caller gets the first's promise.
   * `Promise.resolve()` for `undefined` so a caller that never got a client writes no branch.
   */
  stop(client: T | undefined): Promise<void> {
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

  /**
   * Stop everything this flow holds, and wait — bounded — for the work in flight to land.
   *
   * The race is the caller's, not this class's: a flow knows what "in flight" means (a probe has answers
   * to wait for; a sign-in has one attempt), and a helper that guessed would either hang a shutdown or cut
   * one short. What this guarantees is the part that is the same for both: after it resolves, nothing this
   * object owns is running.
   */
  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.live].map((client) => this.stop(client)));
  }
}

/**
 * The directory a flow opens an agent in when it is **not** running the user's work.
 *
 * **Its own scratch directory, not the user's project.** A probe is not the user's work: opening a session
 * inside their repository would make the agent look at (and possibly index, or run `git` in) a tree nobody
 * asked it to touch, and two tasks in one project would collide over it. The facts a probe reads — the models
 * a credential set makes available, the thinking levels a resolved model offers — are properties of the
 * agent's own installation rather than of the working directory. A sign-in is even less of the user's work,
 * and runs in the same place so that a row's diagnosis and the fix for it happen in one directory.
 *
 * That is also the probe's honest limit, recorded where the choice is made: **if an agent's option list ever
 * becomes a function of the working directory**, this describes the probe directory rather than the task's,
 * and this is the line to revisit. The record carries the session id and the timestamp, so a maintainer can
 * tell which session produced what they are reading.
 *
 * The harness id is folded into the path rather than used raw, because it reaches a filesystem: a value with
 * a separator in it would put an agent's scratch directory somewhere nobody chose.
 */
export async function agentScratchDir(paths: CoderPaths, harness: string): Promise<string> {
  const dir = join(paths.stateDir, "agent-probe", harness.replace(/[^A-Za-z0-9._-]/g, "_"));
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * A promise, bounded by a deadline — **with the timer taken down either way.**
 *
 * Both flows need the same thing and both had written it by hand: a `Promise.race` against a `setTimeout` that
 * rejects with the sentence a user reads when an agent goes quiet. The hand-written version had a leak, and it
 * is worth naming because it was invisible in the test suite and obvious the first time a script waited for the
 * process to exit: the timer is **never cleared** when the work wins the race, so every bounded call leaves a
 * pending timer behind. Until it fires, the Node event loop is alive — which is a daemon holding a handle for
 * no reason, and a `tsx` script that will not exit.
 *
 * The `finally` is the whole point: whichever side of the race settles first, the timer is gone by the time this
 * resolves. The rejected side is deliberately a plain `Error` carrying `message`, because that is what lands in
 * a log and, for a probe, in a keyed sentence's `reason` value — a sentence a user reads, so the caller writes
 * it and this only enforces it.
 */
export async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
