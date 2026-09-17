/**
 * The pre-flight probe, from the window's side: **should we ask, what does the button say, and what is
 * on screen while we do.**
 *
 * ## Why this is a module and not `if`s in the composer
 *
 * The state this decides has four cases, and two of them look identical if you get them wrong — which is
 * exactly the class of mistake the whole probe exists to remove:
 *
 *   * **`idle`** — nothing has been asked in this window yet. The composer asks by itself (see below).
 *   * **`asking`** — a probe is in flight. The control must *say so*: an empty picker while a probe runs
 *     is a lie about the agent, and the sentence also says what the ask costs, because it starts a
 *     process.
 *   * **`answered`** — the daemon's answer. `listed` needs no line of its own (the picker fills, and the
 *     "observed at {time}" note gains this session's timestamp); `none` and `unreachable` each get the
 *     daemon's own sentence, which says *which* of the two it was.
 *
 * Keeping it here rather than in the component means all four are testable without a DOM, the same split
 * `composer/controls.ts` already uses for the pills.
 *
 * ## Why the composer asks by itself, and how that is still "on demand"
 *
 * The brief's rule is that a probe is never spent at daemon boot, and never as a side effect of a list
 * call. Both hold here: this always follows a *window opening a control that needs the list*, for one
 * agent — not every catalogue agent, not on a timer, and never for an agent whose options the catalogue
 * already answers.
 *
 * The alternative was a button the user has to find and press, and it fails the product's own rule: it
 * makes the user responsible for our ignorance, and it leaves the one state the button exists for —
 * "a probe is running, and this is why the list is empty" — unreachable, because nothing starts one.
 * What the user *does* get is a button for the second ask, which is the one that has to be deliberate:
 * it starts a process the daemon's cache would otherwise have answered.
 *
 * ## When there is nothing to ask about
 *
 * Three gates, and each is a different fact:
 *
 *   * **the agent publishes its options outside a session** — `envoy-harness`'s models come from its own
 *     source and it has no thought-level surface at all, so a probe would spend a process to learn
 *     nothing. This is `publishesOnlyInSession`.
 *   * **the daemon knows the method** — an older daemon (the shell attaches to whichever one owns the
 *     port) has no `coder.probeSessionOptions`, and asking would produce "Method not found". The window's
 *     existing version-skew notice already says which build is behind.
 *   * **the agent is installed** — a probe of a binary that is not there can only come back
 *     "unreachable", and the composer already names the install hint for that agent elsewhere.
 */

import type { HarnessState, ProbeOutcome } from "@envoydev/protocol";

import type { MessageKey } from "../i18n/messages/en.js";
import { localNotice, type Notice } from "../i18n/notice.js";
import type { ComposerModels, ComposerThinking } from "./controls.js";

/**
 * What this window knows about asking one agent what it offers.
 *
 * The `detail` is a **`Notice`** rather than a string: the daemon's answer carries a catalogue key
 * alongside its English sentence (`keyed()`), and a refusal from the transport carries one too. Keeping
 * the key means a German user reads German, and a language change re-renders a sentence that arrived
 * minutes ago — the same rule every other piece of daemon prose in this window follows.
 */
export type ProbeState =
  | { state: "idle" }
  | { state: "asking" }
  | { state: "answered"; outcome: ProbeOutcome; detail: Notice };

/** What the composer should do about it, and what it should draw. */
export interface ProbeAsk {
  /** Start an ask now, without being pressed. See the module doc for why this exists. */
  ask: boolean;
  /** The label of the button that asks again — absent when there is nothing to ask. */
  buttonKey?: MessageKey;
  /** May that button be pressed? False while an ask is in flight: two are never useful. */
  enabled: boolean;
  /** What the next ask sends as `force`. Only the *second* ask forces; the first may use the cache. */
  force: boolean;
  /** The line under the controls: our own sentence, or the daemon's answer rendered in the user's words. */
  note?: Notice;
}

export function probeAsk(input: {
  /** The agent's label, for the sentences we author. */
  agent: string;
  /** Does this agent publish anything only inside a session? `publishesOnlyInSession`. */
  unlisted: boolean;
  /** Does this daemon serve `coder.probeSessionOptions`? */
  supported: boolean;
  /**
   * Can we run this agent? The five-state `state`, not a boolean.
   *
   * This gate used to be `available: boolean | "unknown"`, and it is a gate rather than a label: pressing
   * the button spends an agent process. Only `ready` may ask — `unsupported` would be refused by
   * `isDrivableByAcpAdapter`, `needs-bridge` has no adapter to spawn, and `not-installed`/`unknown` have
   * nothing to start. `unknown` is deliberately *not* yes, which the old union encoded by accident; taking
   * the state makes the single rule readable in one type.
   */
  availability: HarnessState;
  state: ProbeState;
}): ProbeAsk {
  const nothingToAsk = !input.unlisted || !input.supported || input.availability !== "ready";
  if (nothingToAsk) return { ask: false, enabled: false, force: false };

  switch (input.state.state) {
    case "asking":
      // **The state that makes the rest honest.** It names the agent, and it says what the ask costs —
      // an agent process, started and closed — because a control that quietly did that would be spending
      // the user's machine on our curiosity.
      return {
        ask: false,
        buttonKey: "task.composer.probe.askAgain",
        enabled: false,
        force: true,
        // `localNotice` because this sentence is **ours**, not the daemon's: it describes the call this
        // window just made, and its key is known by construction.
        note: localNotice("task.composer.probe.asking", { agent: input.agent }),
      };

    case "answered":
      // `listed` draws nothing here on purpose: the record the probe wrote is read by the pickers, which
      // now have the agent's own list, and by the "observed at {time}" note — the timestamp *is* the
      // confirmation, and a second line saying "it answered" would be noise under a pill that just grew
      // options.
      return {
        ask: false,
        buttonKey: "task.composer.probe.askAgain",
        enabled: true,
        force: true,
        ...(input.state.outcome === "listed" ? {} : { note: input.state.detail }),
      };

    case "idle":
      return {
        ask: true,
        buttonKey: "task.composer.probe.ask",
        enabled: true,
        // The first ask may be answered from the daemon's cache — it is "do we know what this agent
        // offers?", and a second window asking that a minute after the first should not spawn anything.
        force: false,
      };
  }
}

/**
 * Does this agent publish anything we can only learn from a session?
 *
 * True for the two states that mean "the agent has something and we have not been told":
 * `models.kind === "free-text"` (it accepts a model and publishes no list we can read) and
 * `thinking.kind === "session"` (its levels exist only inside a session). Everything else is already
 * answered — a catalogue list, a genuine "it offers none", or "nobody has told us yet", which the pills
 * word for themselves — and a probe there would spend a process to learn nothing.
 */
export function publishesOnlyInSession(agent: {
  models?: ComposerModels | undefined;
  thinking?: ComposerThinking | undefined;
}): boolean {
  return agent.models?.kind === "free-text" || agent.thinking?.kind === "session";
}
