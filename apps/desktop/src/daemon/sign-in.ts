/**
 * **Triggering the agent's own sign-in flow** — and reporting truthfully whether it worked.
 *
 * ## What this flow does, in order, and why each step is where it is
 *
 *   1. **Start the agent for its own sake** (`initializeOnly`), so the first thing we know is what the agent
 *      says about itself — including the `authMethods` it advertises. Nothing has been sent to it at this
 *      point that could change the state we are about to act on: a probe that authenticated would be
 *      measuring its own side effect, and this flow is the one place that step is *supposed* to happen, when
 *      a user asked for it.
 *   2. **Decide which method may be sent** — `signInMethod`, over the agent's own advertised ids and the
 *      catalogue's declaration. A method the caller passed is used **only if the agent advertised it**, which
 *      is the rule that keeps a caller's string out of both the agent's protocol and our record: a parameter
 *      where a method id belongs is very often the credential itself, and `docs/settings-parity.md` §7.11
 *      keeps it out the same way the provider schema does — there is no path from it to disk.
 *   3. **If there is no method**, ask whether a session opens anyway. An agent may need no sign-in at all (a
 *      user pressing the button on an agent that already works), and the honest answer then is success with
 *      the reason, not a refusal about a step nobody needed. If it does not open, the outcome is `no-method`.
 *   4. **Send the step**, and tell a refusal from silence: an `AcpRequestError` **is the agent answering**
 *      (its own sentence names what is wrong — an `env_var` method says which variable is unset), while a
 *      timeout or a dead pipe is our failure to get an answer. Those are `refused` and `not-completed`.
 *   5. **Prove it by opening a session.** This is the whole discipline of the feature: a browser-login method
 *      returns `{}` immediately and the session still refuses until the human has finished in the browser, so
 *      *the step returning is not success*. `signed-in` means a session opened; anything else is reported as
 *      what it is (`not-completed`), with the agent's own reason attached.
 *
 * ## What is stored, and where the session state lives
 *
 * Nothing about a credential, ever. The record this writes is `AgentAuthObservation` — one of three states,
 * the agent's method id when there is one, and the sentence behind it — in the daemon's own state directory.
 * The agent's session state belongs to the agent: `cursor-agent` writes `~/.cursor/acp-config.json`, which
 * this product neither reads nor writes, and the sign-in is precisely the mechanism by which that file is
 * produced **by the agent**, on the user's machine, under the agent's own rules.
 *
 * ## Bounds, because a button press may not hang a window
 *
 * The agent's own per-request budgets are `AcpClient`'s (a handshake call gets `handshakeTimeoutMs`), and
 * `SIGN_IN_TIMEOUT_MS` is the outer ceiling on the whole attempt, including the teardown. A sign-in still
 * running after a minute is either a wedged binary or a step waiting for a human who has walked away — and
 * both are reported as `not-completed`, which is the state that does not claim anything happened.
 */

import type { HarnessAuth, HarnessId, RpcMethod, SignInOutcome } from "@envoydev/protocol";
import {
  ENVOYDEV_ERRORS,
  coderError,
  coderErrorMessage,
  parseRpcParams,
} from "@envoydev/protocol";
import { harnessAcpFacts, harnessDefinition } from "@envoydev/agent-catalog";
import type { PlatformId } from "@envoydev/platform";
import type { CoderPaths } from "@envoydev/host-bridge";

import { AcpClient, AcpRequestError, type AcpLaunch } from "./acp/client.js";
import {
  OwnedClients,
  agentScratchDir,
  withDeadline,
  type ProbedAgent,
  type StartSession,
} from "./agent-processes.js";
import { observeAuth, signInMethod } from "./auth-observation.js";
import { launchForHarness } from "./launch.js";
import { keyed } from "./messages.js";
import { authOf } from "./summaries.js";
import type { CoderHandler } from "./service.js";
import type { CoderStore } from "./store.js";

/**
 * How long the **whole** attempt may take, including the teardown.
 *
 * The outer ceiling only: every call inside has `AcpClient`'s own, shorter budget, which is the failure with
 * the better sentence ("the agent did not answer authenticate within 30s"). This exists so that "a sign-in
 * answers within a minute" is a property of this module rather than a hope about three timeouts composing —
 * and so that a browser step waiting on a human who has walked away does not hold a request open forever.
 * Measured against the real case while writing this: `cursor-agent acp`'s `authenticate` answered in about
 * 13 s, so a minute is roughly four times the slowest real step observed.
 */
export const SIGN_IN_TIMEOUT_MS = 60_000;

/** What one attempt came back as — the wire's result, built once so the handler adds nothing. */
export interface SignInAnswer {
  harness: HarnessId;
  outcome: SignInOutcome;
  /** A keyed sentence in the user's language, with the agent's own words as a value. */
  detail: string;
  /** What this attempt established — the same fact `HarnessSummary.auth` carries from now on. */
  auth: HarnessAuth;
}

export interface SessionSignInDeps {
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
  /**
   * **How this agent's connector is delivered** — the user's stored choice, read here rather than inside
   * `launchForHarness`.
   *
   * Injected because the launch is a pure function of its input by design, and because a test that wants to prove
   * the `npx` argv must not need a state file to do it. Absent means `installed`.
   */
  deliveryOf?: (harness: HarnessId) => "installed" | "npx";
  now?: () => Date;
  /**
   * The ACP client constructor, **the same seam the probe uses**.
   *
   * That is not a convenience: `AcpClient.start` is what a run calls, the probe calls, and this calls, so the
   * three cannot drift on argv, on environment, or on which agents are drivable. A test that drives a fixture
   * drives the production path.
   */
  startClient?: StartSession;
  /** The two budgets, injectable so the bound can be proved without waiting for it. */
  timeoutMs?: number;
  handshakeTimeoutMs?: number;
}

export class SessionSignIn {
  private readonly deps: SessionSignInDeps;
  /** The agents this flow owns right now. Shared with the probe — see `./agent-processes.js`. */
  private readonly clients = new OwnedClients<ProbedAgent>();

  constructor(deps: SessionSignInDeps) {
    this.deps = deps;
  }

  /** Stop every agent this flow holds. Called from the daemon's shutdown, beside `SessionProbe.stopAll`. */
  async stopAll(): Promise<void> {
    await this.clients.stopAll();
  }

  /**
   * Sign in to this agent — or find out that it needs nothing, or that it will not.
   *
   * **Nothing about an agent throws.** Not being installed, not being drivable, having no search path to be
   * found on, refusing the step, never answering it — all of it comes back as one of the five outcomes with a
   * keyed sentence, because a client that had to catch exceptions to learn which of five things happened would
   * be re-deriving a union this type already is. The refusal a *launch* produces (the daemon's own
   * `harnessMissing` / `harnessUnknown` / `harnessUnsupported`) is folded in as `unavailable` for the same
   * reason: a caller has one shape to switch on, and the launch's sentence travels inside it as a value.
   *
   * The one thing that throws is a *parameters* bug — an id the wire schema cannot accept — which is addressed
   * to whoever wrote the client rather than to a user, and is refused by `parseRpcParams` before this is
   * reached.
   */
  async signIn(harness: HarnessId, options: { methodId?: string } = {}): Promise<SignInAnswer> {
    const label = harnessDefinition(harness).label;
    let client: ProbedAgent | undefined;
    const budget = this.deps.timeoutMs ?? SIGN_IN_TIMEOUT_MS;
    try {
      const attempt = (async (): Promise<SignInAnswer> => {
        const cwd = await agentScratchDir(this.deps.paths, harness);
        const launch = this.deps.resolveLaunch
          ? this.deps.resolveLaunch({ harness, cwd })
          : launchForHarness({
              harness,
              cwd,
              paths: this.deps.paths,
              ...(this.deps.platform ? { platform: this.deps.platform } : {}),
              ...(this.deps.deliveryOf ? { delivery: this.deps.deliveryOf(harness) } : {}),
            });
        client = await this.acquire(launch);
        return await this.attempt(harness, label, client, options);
      })();
      // The abandoned attempt is not dropped: whatever it eventually resolves to is stopped by the
      // `finally` below, which is the same guarantee the probe gives (`acquire`). `withDeadline` also takes
      // the timer down when the attempt wins, which a hand-written race does not — see its own doc.
      return await withDeadline(
        attempt,
        budget,
        `The agent did not answer within ${Math.round(budget / 1000)}s.`,
      );
    } catch (error) {
      // **We never got as far as the agent answering.** A program that is not installed, a dialect this
      // build cannot drive, no search path to look on, a handshake that died, or the outer ceiling: none of
      // those is a refusal by the agent, and none of them is a sign-in. The reason is the *launch*'s own
      // keyed refusal when there was one — embedded as a value, so the outer sentence is the only thing
      // translated — and `unknown` is recorded, because an agent we could not start has told us nothing.
      const reason = coderErrorMessage(error instanceof Error ? error.message : String(error));
      const auth = await this.record(harness, {
        opened: false,
        authMethods: [],
        reason,
      });
      return {
        harness,
        outcome: "unavailable",
        detail: keyed(
          "signIn.unavailable",
          `${label} could not be started, so nothing was signed in: ${reason}`,
          { agent: label, reason },
        ),
        auth,
      };
    } finally {
      await this.clients.stop(client);
    }
  }

  /**
   * The attempt itself, over an agent that has answered `initialize`.
   *
   * Five exits and each one is a distinct truth; see the module doc for the order and the reasons. Two of them
   * report `signed-in`, and both are the same fact — a session opened, either because the step made it
   * possible or because it already was — while the three that do not are the three ways a sign-in can fail to
   * have happened without anybody lying about it.
   */
  private async attempt(
    harness: HarnessId,
    label: string,
    client: ProbedAgent,
    options: { methodId?: string },
  ): Promise<SignInAnswer> {
    const advertised = client.authMethods();
    const declared = harnessAcpFacts(harness).authMethodId;
    /**
     * **What a terminal would run, kept for the record.**
     *
     * A sign-in that fails against an agent which only knows how to log in through a terminal (Copilot, measured)
     * must leave the row able to say so: the observation this flow writes carries the command, and the next window
     * renders the instruction instead of the button that just failed.
     */
    const terminal = client.authTerminalCommand(declared);
    const methodId = this.methodFor(options.methodId, declared, advertised);

    if (methodId === undefined) {
      // No step we may send. The first question is still worth asking: an agent that needs no authentication
      // opens a session, and a user pressing "Sign in" there has a working agent rather than a failure.
      const opened = await this.tryOpen(client);
      if (opened.ok) {
        return this.finish(harness, "signed-in", {
          opened: true,
          authMethods: advertised,
          ...(terminal !== undefined ? { terminal } : {}),
          reason: "",
          detail: keyed(
            "signIn.already",
            `${label} opened a session without needing a sign-in, so there was nothing to do.`,
            { agent: label },
          ),
        });
      }
      return this.finish(harness, "no-method", {
        opened: false,
        authMethods: advertised,
          ...(terminal !== undefined ? { terminal } : {}),
        reason: opened.reason,
        // The agent's own ids travel as a value, never the caller's string: a method id a client supplied is
        // not quoted back, for the same reason `coder.addProvider` never echoes a refused `env` entry — what
        // reaches that field is very often the credential itself, and a refusal reaches a log.
        detail: keyed(
          "signIn.noMethod",
          `${label} will not open a session here and did not name a sign-in method EnvoyDev may send` +
            (advertised.length > 0 ? `. It offers: ${advertised.join(", ")}.` : ".") +
            ` Sign in with the agent's own command, then ask again.`,
          {
            agent: label,
            methods: advertised.join(", "),
          },
        ),
      });
    }

    try {
      await client.signIn(methodId);
    } catch (error) {
      const reason = coderErrorMessage(error instanceof Error ? error.message : String(error));
      // **Two different failures, and the difference is whether the agent spoke.** An `AcpRequestError` is
      // the agent's own refusal, which names what is wrong better than we can; anything else is a step that
      // was never answered, and calling that a refusal would attribute our timeout to somebody else's
      // program.
      const refused = error instanceof AcpRequestError;
      return this.finish(harness, refused ? "refused" : "not-completed", {
        // A refusal means the session did not open *by construction*: the step is what stood in the way, and
        // the process stops here (the `finally` above). Recording `needs-signin` is therefore an observation
        // rather than an assumption — the method the agent wants is the one it just named.
        opened: false,
        authMethods: advertised,
          ...(terminal !== undefined ? { terminal } : {}),
        reason,
        detail: keyed(
          refused ? "signIn.refused" : "signIn.notCompleted",
          refused
            ? `${label} refused the sign-in step: ${reason}`
            : `${label} did not answer the sign-in step, so nothing was signed in: ${reason}`,
          { agent: label, reason },
        ),
      });
    }

    const opened = await this.tryOpen(client);
    if (opened.ok) {
      return this.finish(harness, "signed-in", {
        opened: true,
        authMethods: advertised,
          ...(terminal !== undefined ? { terminal } : {}),
        reason: "",
        detail: keyed(
          "signIn.signedIn",
          `${label} accepted the sign-in and opened a session.`,
          { agent: label },
        ),
      });
    }
    // **The browser case, and the reason this flow does not trust the step's own answer.** The agent took the
    // step and answered `{}`; the session still will not open, so the sign-in has not happened *yet*. Reported
    // as `not-completed` with the agent's own sentence, and never as success.
    return this.finish(harness, "not-completed", {
      opened: false,
      authMethods: advertised,
          ...(terminal !== undefined ? { terminal } : {}),
      reason: opened.reason,
      detail: keyed(
        "signIn.notCompleted",
        `${label} accepted the sign-in step but no session opened yet, so the sign-in has not finished: ` +
          `${opened.reason} If the agent opened a browser or a terminal, finish there and try again.`,
        { agent: label, reason: opened.reason },
      ),
    });
  }

  /**
   * The method this attempt may send — **never a string the caller invented.**
   *
   * `signInMethod` (in `./auth-observation.js`) answers from the agent's own advertised ids, so the only
   * thing this adds is the caller's preference **filtered through that answer**: a `methodId` a client passed
   * is honoured when the agent advertised it, and otherwise ignored entirely — not echoed back, not stored,
   * not sent. That is what makes "no code path stores a value where a name belongs" true for this slice rather
   * than intended: the value never leaves this function.
   */
  private methodFor(
    requested: string | undefined,
    declared: string | undefined,
    advertised: readonly string[],
  ): string | undefined {
    if (requested !== undefined && advertised.includes(requested)) return requested;
    return signInMethod(declared, advertised);
  }

  /** Ask for a session, and hand back either the success or the agent's own reason. */
  private async tryOpen(client: ProbedAgent): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await client.openSession();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: coderErrorMessage(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  /** Record what the attempt established, and answer in the wire's shape. */
  private async finish(
    harness: HarnessId,
    outcome: SignInOutcome,
    input: { opened: boolean; authMethods: readonly string[]; reason: string; detail: string },
  ): Promise<SignInAnswer> {
    const auth = await this.record(harness, input);
    return { harness, outcome, detail: input.detail, auth };
  }

  /**
   * Write the auth state **the same way the probe does**, through the same rule.
   *
   * This is why the sign-in is a second, stronger probe rather than a separate subject: after it, the row a
   * client is showing is up to date without anybody re-asking, and a second window is told through the
   * store's own `harnesses` change event.
   */
  private async record(
    harness: HarnessId,
    input: {
      opened: boolean;
      authMethods: readonly string[];
      reason: string;
      /** The command a terminal would run, when the agent advertises one — see `HarnessAuth.terminal`. */
      terminal?: string;
    },
  ): Promise<HarnessAuth> {
    const observation = observeAuth({
      harness,
      observedAt: this.now(),
      opened: input.opened,
      authMethods: input.authMethods,
      declared: harnessAcpFacts(harness).authMethodId,
      ...(input.terminal !== undefined ? { terminal: input.terminal } : {}),
      reason: input.reason,
    });
    await this.deps.store.recordAgentAuth(observation);
    return authOf(observation);
  }

  /**
   * Start the agent under the outer ceiling, and never leave a process behind.
   *
   * Deliberately the probe's own arrangement (`SessionProbe.acquire`), including the abandoned-promise
   * handling: `AcpClient.start` spawns before it handshakes, so a ceiling that fires mid-handshake leaves a
   * process whose only reference is the promise we walked away from.
   */
  private async acquire(launch: AcpLaunch): Promise<ProbedAgent> {
    const startClient = this.deps.startClient ?? AcpClient.start;
    const pending = startClient({
      launch,
      handshakeTimeoutMs: this.deps.handshakeTimeoutMs ?? 30_000,
      // The sign-in sends no prompt. Set anyway, so a future change that did cannot inherit the half-hour
      // turn budget `AcpClient` defaults to.
      requestTimeoutMs: this.deps.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
      // Handshake only: this flow sends the step itself, which is the only way to tell a refusal of that step
      // from a session that would not open after it. See `AcpClientOptions.initializeOnly`.
      initializeOnly: true,
    });
    try {
      const client = await pending;
      this.clients.add(client);
      return client;
    } catch (error) {
      void pending.then((client) => this.clients.stop(client)).catch(() => undefined);
      throw error;
    }
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
}

/* ────────────────────────────── the method ───────────────────────────── */

/**
 * What the handler needs: the flow, which a daemon built without an agent runtime does not have.
 *
 * `undefined` is a real configuration (`createCoderHandlers` is built that way in tests that are about
 * something else), and it is refused **at call time** rather than at construction, so the rest of the table
 * still works and `coder.hello` still advertises the method.
 */
export interface SignInHandlerDeps {
  signIn?: SessionSignIn;
}

/**
 * `coder.signInAgent`, ready to spread into the daemon's table.
 *
 * A thin handler on purpose, exactly like `coder.probeSessionOptions`: the budgets, the outcomes, the record
 * and the teardown are `SessionSignIn`'s, and a handler that decided any of them again would be the second
 * copy of a rule — the copy that goes stale first.
 *
 * A missing flow is a refusal **by name** rather than an answer nothing produced, on the same terms as
 * `requireRuns`/`requireProbeSession`: a daemon built without an agent runtime cannot start an agent, and
 * that is one situation with one sentence.
 */
export function createSignInHandlers(deps: SignInHandlerDeps): Partial<Record<RpcMethod, CoderHandler>> {
  return {
    "coder.signInAgent": async (params) => {
      const input = parseRpcParams("coder.signInAgent", params) as {
        harness: HarnessId;
        methodId?: string;
      };
      const answer = await requireSignIn(deps.signIn).signIn(input.harness, {
        ...(input.methodId !== undefined ? { methodId: input.methodId } : {}),
      });
      return answer;
    },
  };
}

/**
 * The refusal for a daemon that was started without a sign-in flow.
 *
 * The same code, sentence and key `requireRuns` and `requireProbeSession` use, and deliberately: one missing
 * agent runtime is one situation, and its consequences — no runs, no asking, no signing in — are a list rather
 * than three different problems. A second key saying "…so it cannot sign an agent in" would be a second
 * sentence for a translator to keep in step with the first.
 */
export function requireSignIn(signIn: SessionSignIn | undefined): SessionSignIn {
  if (!signIn) {
    throw coderError(
      ENVOYDEV_ERRORS.harnessFailed,
      "This daemon was started without an agent runtime, so it cannot run tasks.",
      { key: "error.noRunRuntime" },
    );
  }
  return signIn;
}

