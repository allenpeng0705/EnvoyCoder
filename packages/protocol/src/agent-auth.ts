/**
 * **Authentication, as a fact this product can see — and the one method that changes it.**
 *
 * ## Why its own module, in a package that documents itself as two
 *
 * `index.ts` used to say the package is two modules on purpose — the nouns (`domain.ts`) and the wire
 * (`rpc.ts`) — and that is still the shape. This is a third because it is a **subject** rather than a
 * category: what an agent's authentication currently is, the record a probe leaves behind, and the
 * vocabulary of an attempted sign-in. Everything in it is referenced from both of the other two
 * (`domain.ts`'s settings and method catalogue, `rpc.ts`'s summary schema and method specs), so folding
 * it into either would have made one of them the owner of a fact the other needs — which is the
 * circularity the two-module split exists to avoid, and which a third module dissolves: the dependency
 * runs one way, `agent-auth.ts` → `domain.ts`, and `rpc.ts` reads both.
 *
 * ## The rule this module exists to keep
 *
 * **An auth state is never asserted without a probe.** There are three answers and the third is the
 * default: `unknown` is what a row says before anything has looked at the agent, and it is a different
 * statement from both of the others. That is the same discipline `HarnessAvailability` follows for
 * "is it installed" (five states, and `unknown` must never render as "not installed"), applied to the
 * question a user meets one step later: *can this agent open a session here, or does it want a sign-in
 * first?*
 *
 * Two things follow, and both are deliberate:
 *
 *   * **We never sign anything in as a side effect.** The probe sends `initialize` and asks for a
 *     session, and nothing else; a probe that authenticated would change the state it is measuring, and
 *     on a browser-login method it would put a window on the user's desktop nobody asked for. See
 *     `SessionProbe` in the daemon.
 *   * **A sign-in is the agent's own flow, triggered by us.** We send the ACP `authenticate` call with
 *     one of the methods the agent itself advertised, and then we check whether a session opens. We do
 *     not hold a credential, we do not store a token, and there is no field here that could hold either:
 *     the only string this module carries is a **method id the agent published**, which is a name in
 *     somebody else's protocol rather than a secret. `docs/settings-parity.md` §7.10 records the
 *     refusal to store credentials, and §7.11 records how this stays on the right side of it.
 */

import { z } from "zod";

import { AgentIdSchema, type AgentId } from "./domain.js";

/* ────────────────────────────── the fact ────────────────────────────── */

/**
 * Which of three things is true about this agent's authentication **on this machine, right now**.
 *
 *   * `"ready"` — the agent opened a session. Nothing is needed from the user, and this is the state
 *     every agent that needs no authentication is in (which was measured rather than assumed: both ACP
 *     bridges and the built-in harness answer `session/new` on a fresh process).
 *   * `"needs-signin"` — the agent answered us and would not open a session **and advertises a sign-in
 *     method of its own**. That is the agent telling us, in its own protocol's vocabulary, that it wants
 *     one. `cursor-agent acp` is the measured case: without authentication it answers `session/new` with
 *     `-32000 Authentication required … call authenticate() with methodId 'cursor_login'`.
 *   * `"unknown"` — nothing has established anything: no probe has run against this agent yet, or the
 *     last one could not get as far as an answer (the binary is missing, the input was empty so there was
 *     no search to make, or the handshake timed out). **This must never render as "you need to sign
 *     in"** — that is the one mistake the state exists to prevent, because it sends a user to perform a
 *     login that changes nothing.
 *
 * The middle state is decided by **evidence rather than by prose**: an agent that advertises auth
 * methods in its `initialize` answer and will not open a session is asking for a sign-in. An agent that
 * advertises none and fails to open a session is `unknown`, because nothing in that exchange says a login
 * would help — parsing a refusal's sentence for words like "authentication" would work for exactly the
 * agents whose wording we happened to read.
 */
export const HARNESS_AUTH_STATES = ["ready", "needs-signin", "unknown"] as const;

export type HarnessAuthState = (typeof HARNESS_AUTH_STATES)[number];

export const HarnessAuthStateSchema = z.enum(HARNESS_AUTH_STATES);

/**
 * What a client renders about one agent's authentication.
 *
 * ## The agreement rules, and why `methodId` is not required
 *
 * Two rules, checked rather than trusted — the same discipline `HarnessAvailabilitySchema` applies to
 * its five states, and for the same reason: these are claims, and a claim that contradicts another claim
 * is worse than a missing one, because both travel and a client reads whichever it trusts.
 *
 *   1. **`methodId` may appear only with `needs-signin`.** Beside `ready` it would say a step is still
 *      needed by an agent that just opened a session; beside `unknown` it would be a requirement we never
 *      established — the exact invention `unknown` exists to refuse.
 *   2. **`observedAt` is the time this was established**, so a client can say *when* rather than
 *      presenting an observation as current — the rule `AgentModels.observedAt` already follows for the
 *      model list. Absent means the daemon has never looked, which is the same condition `unknown`
 *      describes when it stands alone.
 *
 * `methodId` is deliberately **optional on `needs-signin`**, and the omission is a real state rather than
 * a gap: when an agent advertises several methods and the catalogue declares none of them, choosing one
 * would be us picking a sign-in flow on the user's behalf — and the ACP agents here really do offer
 * several (`@agentclientprotocol/codex-acp` advertises two `env_var` methods and a browser login). A row
 * that says "this agent wants a sign-in and EnvoyDev cannot tell you which" is honest and actionable
 * (sign in with the agent's own command); a row that quietly sent the first advertised method and failed
 * is not.
 */
export interface HarnessAuth {
  state: HarnessAuthState;
  /**
   * The ACP `authenticate` method this agent wants — **one of the ids the agent itself advertised**, never
   * a value a caller supplied. See `SignInOutcome` and the daemon's sign-in flow for why that distinction
   * is enforced rather than trusted.
   */
  methodId?: string;
  /**
   * **The command to run in a terminal to sign in**, when the agent advertises one.
   *
   * Present exactly with `needs-signin`. A window shows the instruction instead of a **Sign in** button for it:
   * Copilot's `authenticate` answers `-32000 Authentication required` (measured 2026-09-15) and a session keeps
   * refusing, so that button would be a press that changes nothing.
   */
  terminal?: string;
  /** When the daemon established this, ISO 8601 on its own clock. Absent when it never has. */
  observedAt?: string;
}

export const HarnessAuthSchema = z
  .object({
    state: HarnessAuthStateSchema,
    methodId: z.string().min(1).optional(),
    terminal: z.string().min(1).optional(),
    observedAt: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.terminal !== undefined && value.state !== "needs-signin") {
      ctx.addIssue({
        code: "custom",
        message:
          `terminal is the sign-in an agent is still waiting for, so it belongs to "needs-signin" alone ` +
          `— not "${value.state}"`,
        path: ["terminal"],
      });
    }
    if (value.methodId !== undefined && value.state !== "needs-signin") {
      ctx.addIssue({
        code: "custom",
        message:
          `methodId is the sign-in an agent is still waiting for, so it belongs to "needs-signin" alone ` +
          `— not "${value.state}"`,
        path: ["methodId"],
      });
    }
  });

/**
 * The answer that asserts nothing, in one place.
 *
 * Two callers need it and neither may invent a different one: the daemon when it has no record of a probe
 * (`summaries.ts`), and a client reading an answer from a **daemon one build behind**, which sends no
 * `auth` field at all. Both must produce exactly `unknown` — a legacy absence turned into "you need to
 * sign in" is the failure this type exists to prevent, and it is the same shape of mistake
 * `availabilityOf` in the desktop app documents for the field that came before `availability`.
 */
export function unknownAuth(): HarnessAuth {
  return { state: "unknown" };
}

/* ────────────────────────────── what a probe leaves behind ────────────────────────────── */

/**
 * What the daemon last established about one agent's authentication, **kept with the time it did**.
 *
 * ## Why this is a record and not a cache
 *
 * `coder.listHarnesses` must answer without starting anything — a list call that spawned agents would
 * make rendering a sidebar start every installed one — so the fact a probe learned has to survive the
 * probe. Three consequences, and each follows the existing `ObservedSessionOptions` precedent exactly:
 *
 *   * **Keyed per agent, newest wins.** A second window, a phone or a daemon restart reads the same
 *     answer, and an agent whose state changes (the user signs in, or uninstalls it) does not have to
 *     contradict a stale record for long: the next probe replaces it whole.
 *   * **A failed probe records too, as `unknown` with the reason.** This is the one place this record
 *     differs from the session-options one, which writes nothing when it could not ask — and the
 *     difference is what each is about. "What does this agent offer" has no answer when we could not ask,
 *     so an observation would be a claim about the agent; "can it open a session here" *does* have an
 *     answer — *we could not tell* — and saying so is better than leaving a previous `needs-signin` in
 *     front of a user whose agent has since been uninstalled.
 *   * **`detail` is English and unkeyed.** It is the agent's own sentence or our reason, for the log and
 *     for a bug report, like `HarnessSummary.evidence`. The *state* is what a window draws, with a
 *     sentence of its own in the user's language.
 */
export interface AgentAuthObservation {
  harness: AgentId;
  /** ISO 8601, daemon clock. */
  observedAt: string;
  state: HarnessAuthState;
  /** Present only for `needs-signin`, and only ever a method the agent advertised. */
  methodId?: string;
  /**
   * **The command to run in a terminal to sign in**, when the agent says a terminal is the way.
   *
   * Copilot's only method carries ACP's `_meta["terminal-auth"]` with the exact command, and its protocol step
   * cannot perform the login — measured: `authenticate {copilot-login}` → `-32000 Authentication required`, and a
   * session keeps refusing. A row offering *Sign in* for that agent would be offering a press that changes nothing,
   * so the instruction travels instead of the button.
   */
  terminal?: string;
  /** What we were told, or why we could not tell. */
  detail?: string;
}

export const AgentAuthObservationSchema = z
  .object({
    harness: AgentIdSchema,
    observedAt: z.string().min(1),
    state: HarnessAuthStateSchema,
    methodId: z.string().min(1).optional(),
    terminal: z.string().min(1).optional(),
    detail: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.terminal !== undefined && value.state !== "needs-signin") {
      ctx.addIssue({
        code: "custom",
        message: `terminal belongs to "needs-signin" alone, not "${value.state}"`,
        path: ["terminal"],
      });
    }
    if (value.methodId !== undefined && value.state !== "needs-signin") {
      ctx.addIssue({
        code: "custom",
        message: `methodId belongs to "needs-signin" alone, not "${value.state}"`,
        path: ["methodId"],
      });
    }
  });

/* ────────────────────────────── the sign-in ────────────────────────────── */

/**
 * What pressing **Sign in** came back as.
 *
 * ## The only success is "a session opens now", and everything else is said plainly
 *
 * The temptation is to report the step: we called `authenticate`, the agent answered `{}`, so it worked.
 * That is not what a user asked for. A sign-in that opens a browser and returns immediately answers `{}`
 * too, and reporting that as success is precisely the lie this union exists to make impossible:
 *
 *   * `"signed-in"` — a session opened. Either the step made it possible, or it already was (in which case
 *     the daemon says so in its sentence: there was nothing to do). **Proven by opening a session, not by
 *     the step returning.**
 *   * `"refused"` — the agent answered the `authenticate` call with an error. Its own words travel in the
 *     sentence, because they name what is wrong better than we can (`env_var` methods say which variable
 *     is unset).
 *   * `"not-completed"` — the step was accepted, or never answered, and no session opened. This is the
 *     browser case and the wedged case together, and they are one state on purpose: in both, **nothing was
 *     signed in**, and the honest thing to tell a user is "not yet — finish it there and ask again" rather
 *     than a success or a failure we did not observe.
 *   * `"no-method"` — there is no sign-in we may send: the agent advertised none, or the method the caller
 *     named is not one the agent offered. Nothing was sent, and nothing is stored from the caller's
 *     string — see the daemon's sign-in flow for why that check is load-bearing rather than polite.
 *   * `"unavailable"` — we could not get as far as an answer: the program is not installed, this build
 *     cannot drive it, there was no search path to find it on, or the handshake failed. The reason is the
 *     keyed refusal the *launch* already produces, embedded as a value.
 *
 * `SignInOutcomeSchema` is the wire's copy, so a client can switch on it without importing our types.
 */
export const SIGN_IN_OUTCOMES = [
  "signed-in",
  "refused",
  "not-completed",
  "no-method",
  "unavailable",
] as const;

export type SignInOutcome = (typeof SIGN_IN_OUTCOMES)[number];

export const SignInOutcomeSchema = z.enum(SIGN_IN_OUTCOMES);
