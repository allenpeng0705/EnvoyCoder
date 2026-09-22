/**
 * **One rule, two flows**: what an agent's authentication is, and which sign-in method may be sent.
 *
 * ## Why this is not a private method of the probe
 *
 * Two flows learn the same two things about the same agent. A **probe** starts it, asks for a session and
 * writes down what it found; a **sign-in** starts it, sends the agent's own `authenticate` step, asks for a
 * session again and writes down what *that* found. Both then have to answer one question — "a session did
 * or did not open, and the agent advertised these methods" → one of `ready | needs-signin | unknown` — and
 * both have to answer a second one first: which method, out of what the agent advertised, may we send?
 *
 * Those two rules are the whole of `AgentAuthObservation`, and a copy per flow is how a row comes to say
 * "needs `cursor_login`" while the button beside it sends something else. So they live here, both flows call
 * them, and neither decides the state for itself.
 *
 * ## What is decided here, and what is not
 *
 * Nothing here starts a process, reads a clock or touches the store: the caller supplies the two
 * observations and the timestamp, and gets the record to store. That keeps the rule testable without an
 * agent — which matters, because the case it exists for (`needs-signin`) is precisely the case a machine
 * that is already signed in cannot produce.
 */

import type { AgentAuthObservation, AgentId, HarnessAuthState } from "@envoydev/protocol";

/**
 * The sign-in method to name for an agent that wants one — **or nothing, when naming one would be a guess.**
 *
 * Three candidates in order, and the order is the whole rule:
 *
 *   1. **What the catalogue declares, when the agent actually offers it.** `cursor` declares `cursor_login`
 *      and advertises exactly that, so this is the case that makes a fresh installation one press away. The
 *      "when the agent offers it" half is not decoration: a catalogue entry can be a version behind its
 *      agent, and naming a method the agent has dropped sends a call that fails for a reason nobody can act
 *      on.
 *   2. **The only method the agent advertised**, when it advertised exactly one and the catalogue declares
 *      none. That is not us choosing: there is one, and the agent put it there.
 *   3. **Nothing.** Several advertised and none declared is the case this function refuses to resolve, and
 *      `@agentclientprotocol/codex-acp` is why — it advertises two `env_var` methods and a browser login, so
 *      a "first advertised" rule would pick a flow on the user's behalf and, if it picked the browser one,
 *      open a window they did not ask for. `HarnessAuth.methodId` is optional for exactly this answer.
 *
 * **The output is always a subset of the input**, which is the property the whole credential story rests on:
 * the only place a method id can come from is what the agent said about itself, so nothing a caller typed —
 * a phone's parameter, a pasted key in the wrong field — can reach the stored record or the agent. See
 * `docs/settings-parity.md` §7.11.
 */
export function signInMethod(
  declared: string | undefined,
  advertised: readonly string[],
): string | undefined {
  if (declared !== undefined && advertised.includes(declared)) return declared;
  if (advertised.length === 1) return advertised[0];
  return undefined;
}

/**
 * Does this agent open a session here, want a sign-in, or neither — from the two things a caller watched.
 *
 * The rule, and why it is **evidence rather than prose**:
 *
 *   * a session opened → `ready`. Nothing is needed from the user, and this is where every agent that needs
 *     no authentication lands (measured while writing this: both ACP bridges and the built-in harness answer
 *     `session/new` on a fresh process).
 *   * a session did not open **and the agent advertised a sign-in method** → `needs-signin`. That is the
 *     agent telling us, in its own protocol's vocabulary, that it wants one: `cursor-agent acp` answers
 *     `-32000 Authentication required … methodId 'cursor_login'`. The method named is `signInMethod`'s
 *     answer, so it may legitimately be absent.
 *   * anything else → `unknown`, with the reason. An agent that would not open a session and named no way to
 *     authenticate has not told us a login would help, and saying `needs-signin` there would send a user to
 *     perform a step that changes nothing. Matching the words "authentication" or "login" inside a refusal
 *     would work for exactly the agents whose wording we happened to read — and would break, silently, on
 *     the next agent release.
 */
export function authStateOf(input: {
  /** Did a session open? The one observation that decides between the three states. */
  opened: boolean;
  /** The `authenticate` methods the agent advertised in `initialize`, verbatim. */
  authMethods: readonly string[];
}): HarnessAuthState {
  if (input.opened) return "ready";
  if (input.authMethods.length === 0) return "unknown";
  return "needs-signin";
}

/**
 * The record to write, and the sentence a maintainer will read beside it.
 *
 * `reason` is the agent's own refusal or our own failure, already flattened to one line
 * (`coderErrorMessage`, at the call sites). It is stored rather than keyed: the *state* is what a window
 * draws, in the user's language, and this is the evidence for it — the same split `HarnessSummary.evidence`
 * and `AgentProviderSummary.detail` already follow.
 */
export function observeAuth(input: {
  harness: AgentId;
  /** ISO 8601 on the daemon's clock, supplied by the caller that has one. */
  observedAt: string;
  opened: boolean;
  authMethods: readonly string[];
  /** What the catalogue declares, if anything — the first candidate `signInMethod` considers. */
  declared?: string | undefined;
  /**
   * The command the agent wants run in a **terminal**, when it advertises one.
   *
   * Measured, not decorative: Copilot's `authenticate {copilot-login}` answers `-32000 Authentication required`
   * and a session keeps refusing, so for that agent the row must carry the instruction rather than a button. The
   * fact is stored with the observation because it is part of *what this machine established* about signing in.
   */
  terminal?: string | undefined;
  reason: string;
}): AgentAuthObservation {
  const state = authStateOf({ opened: input.opened, authMethods: input.authMethods });
  if (state === "ready") {
    return {
      harness: input.harness,
      observedAt: input.observedAt,
      state,
      detail: "A session opened, so this agent needs no sign-in.",
    };
  }
  if (state === "unknown") {
    return {
      harness: input.harness,
      observedAt: input.observedAt,
      state,
      detail:
        `A session did not open and this agent advertises no sign-in method, so nothing here says a login ` +
        `would help: ${input.reason}`,
    };
  }
  const methodId = signInMethod(input.declared, input.authMethods);
  return {
    harness: input.harness,
    observedAt: input.observedAt,
    state,
    ...(methodId !== undefined ? { methodId } : {}),
    ...(input.terminal !== undefined ? { terminal: input.terminal } : {}),
    detail:
      `This agent would not open a session and advertises ${input.authMethods.join(", ")}, so it wants a ` +
      `sign-in: ${input.reason}`,
  };
}
