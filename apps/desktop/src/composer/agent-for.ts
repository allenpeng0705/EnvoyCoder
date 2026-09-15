/**
 * A harness, as the *controls* need it — and why this is a module rather than a helper in one component.
 *
 * `composer/controls.ts` takes an agent in a shape of its own (`ComposerAgent`), restated from the wire
 * rather than imported from it, so the decision logic can be tested without a daemon. Somebody has to
 * turn `HarnessSummary` into that shape, and the facts it fills in are the ones every control's enabled
 * state rests on:
 *
 *   * `models` and `thinking` are passed through **whole, `undefined` included**. "Nobody has told us
 *     what this agent publishes" is a third state with a sentence of its own, and defaulting it to
 *     `{ kind: "none" }` would turn our ignorance into a claim about somebody else's product.
 *   * `*Applicable` come from `capabilities`, never from `availability`. An agent can publish a list this
 *     build has no way to deliver to, so "it has models" is not the question — "can we apply one" is.
 *   * `availability` comes from `availabilityOf`, which is also where an **older daemon's** boolean answer
 *     is translated. See it for why a legacy `false` becomes `unknown` and not `not-installed`.
 *
 * Two surfaces now ask the same question — the composer, about a task's agent, and the settings pane,
 * about the default agent — and they must answer it identically. A second copy of this mapping is how
 * the model pill and the settings row would come to disagree about which agents take a model, which is
 * the class of drift this repository keeps paying for.
 */

import type {
  HarnessAvailability,
  HarnessId,
  HarnessState,
  HarnessSummary,
} from "@envoycoder/protocol";

import { harnessLabel } from "./harness-label.js";
import type { ComposerAgent } from "./controls.js";

/**
 * What we know about whether this agent can run — including from a daemon that predates the question.
 *
 * ## The compatibility consequence of widening the field, in one function
 *
 * `availability` replaced `available: boolean | "unknown"`. Both halves of EnvoyCoder ship together, but a
 * **running** daemon can be a build behind — this repository already learned that the hard way when a
 * required field's absence crashed the settings page — so the window has to render the old answer rather
 * than pretend it did not arrive. The mapping is the interesting part, and it is deliberately *lossy in one
 * direction*:
 *
 *   * legacy `true` → `ready`. The old daemon resolved the program it drives, which is what `ready` asserts.
 *   * legacy `"unknown"` → `unknown`. The same word for the same thing.
 *   * legacy `false` → **`unknown`, never `not-installed`.** The old field meant "the program *I* drive is
 *     not on *my* search path" — and for `claudecode` and `codex` the program the old daemon drove was the
 *     ACP **bridge**, which nobody had installed and which the user had never been told to install. It never
 *     asked about `claude` or `codex` themselves, so it cannot support "not installed", and turning its
 *     `false` into that word is precisely the bug report this change exists to answer. `unknown` is the
 *     honest rendering of an answer to a different question.
 *   * **No `availability` and no `available`** → `unknown` as well: a daemon older than the field.
 *
 * None of these carry a `fix`, and that is the same rule the schema enforces: a fix is a statement about
 * what is missing, and an older daemon has not established that anything is. The window says the daemon is a
 * build behind instead, which names the action that actually helps (`SectionsFacts.tsx`).
 */
export function availabilityOf(summary: PickerSubject | undefined): HarnessAvailability {
  if (summary?.availability !== undefined) return summary.availability;
  const legacy = (summary as { available?: boolean | "unknown" } | undefined)?.available;
  return { state: legacy === true ? "ready" : "unknown" };
}

/** The single state a control branches on, from either wire generation. */
export function stateOf(summary: PickerSubject | undefined): HarnessState {
  return availabilityOf(summary).state;
}

/** Can this agent be launched at all? One question, one place, both wire generations. */
export function canRun(summary: PickerSubject | undefined): boolean {
  return stateOf(summary) === "ready";
}

/**
 * Has this agent been established as **absent**? The only state a picker may drop.
 *
 * The two settings pickers (a project's agent, and the machine's default) used to filter on
 * `available !== false`, which is the boolean's way of saying "everything except a binary we looked for and
 * did not find". Widening the field makes that rule sayable: `not-installed` **is** that statement, and every
 * other state is either runnable, runnable-but-not-drivable, installed-with-its-adapter-missing, or
 * unexamined — and a picker that hid any of those would remove an agent the user configured from their own
 * list, silently. The row explains the state; the list does not make the decision for them.
 *
 * This is the predicate `offeredAgents` below filters with, and it is the only one. It takes the same
 * two-fact shape a provider carries, so the rule reads a user-declared agent exactly as it reads one we
 * ship: a program the user typed is probed, never believed (§7.10).
 */
export function knownMissing(summary: PickerSubject | undefined): boolean {
  return stateOf(summary) === "not-installed";
}

/**
 * **What a picker offers, derived from what we measured — and why nothing a user stores may enter into it.**
 *
 * ## The rule, and the field it replaced
 *
 * Two facts used to decide this, and one of them did not belong. `knownMissing` (above) is a measurement.
 * The other was a *stored preference* — `CoderSettings.hiddenAgents`, a list of ids the user had taken out
 * of their lists, projected onto every row as `hidden` and filtered on here. That preference is gone, from
 * the wire, the settings document, the daemon and this function, because a list filter is the one kind of
 * control that can make an agent **this product ships disappear from the product's own lists** — which is
 * the exact failure its owner objected to when they said they could not see the agents we support. The
 * brief for this product is "the control plane of coding agents"; a control plane whose list of agents can
 * be shortened by a preference is one that can be made to forget what it controls.
 *
 * The deeper reason a stored filter was the wrong shape is not policy, it is correctness:
 *
 *   * **A derived rule can be wrong about a fact and then get better.** "The program is not on this
 *     machine" is a claim we made, a probe can contradict it, and the next list call is right again. Our
 *     ignorance and our mistakes both have a way out.
 *   * **A stored filter is wrong by design and stays wrong.** A hidden id hides its agent until somebody
 *     edits a settings file — no probe, no upgrade and no run changes it — and it is the one kind of wrong
 *     answer this product has no mechanism to notice, because nothing measures it.
 *
 * ## What the rule is a function of, exactly
 *
 * One agent in, one answer out, and the only input is `availabilityOf(agent)` — that is, `availability`
 * for a daemon that sends it, and the legacy `available` boolean for one that predates the field. Nothing
 * else is read: not the settings document, not the task list, not a prop, not the module's own state. That
 * is what makes "no user setting can hide an agent" a property of the code rather than a promise in a doc,
 * and `test/agent-offer.test.ts` asserts it by handing this function a row that *claims* to be hidden and
 * watching it stay.
 *
 * ## What it drops, what it keeps, and where the rest of the list lives
 *
 * It drops exactly one state: `not-installed`, the only one that asserts the agent is **absent**
 * (`docs/settings-parity.md` §7.9).
 * Every other state stays, `unknown` included — an agent nobody has looked at yet is not one we may decide
 * about on the user's behalf, and a picker that quietly dropped it would remove an agent the user
 * configured from their own list. The order is by how usable the answer says the agent is: `ready` first
 * (`unknown` next, because the honest answer to "can this run" is *we have not looked* rather than *no*),
 * then the states that name something missing. Within a group the incoming order is preserved, so the
 * catalogue's own ordering — `envoy-harness` first, the default — is not rearranged by a sort nobody asked
 * for.
 *
 * **Nothing is invisible because of this.** The Agents page (`docs/settings-parity.md` §7.12) lists the nine
 * we ship, every provider the user declared and all 38 catalogue entries, each with the install command its
 * state implies — so an agent this function drops from a picker is one step away, named, explained and
 * fixable. A picker is where a choice is made; the catalogue is where the whole product is visible, and no
 * control shortens it.
 *
 * ## Why one function rather than a filter at each call site
 *
 * There are two pickers (the machine's default agent, and a project's) and a third place would be invented
 * by the next person who needs one. Both call this, so a third reason to drop a row cannot be added in one
 * of them without the other hearing about it — which is what having no `offerable(one)` helper beside it is
 * for.
 */
export function offeredAgents<T extends PickerSubject>(agents: readonly T[]): T[] {
  return agents
    // Index carried through the sort rather than relying on `Array.prototype.sort` being stable: the order
    // inside a rank is the catalogue's, and "the runtime is specified to be stable now" is not a reason for
    // a picker's order to be a thing nobody can read off this file.
    .map((agent, at) => ({ agent, at }))
    .filter((entry) => !knownMissing(entry.agent))
    .sort(
      (left, right) =>
        OFFER_ORDER[stateOf(left.agent)] - OFFER_ORDER[stateOf(right.agent)] || left.at - right.at,
    )
    .map((entry) => entry.agent);
}

/**
 * How usable each state says an agent is — the whole ordering, and the reason `unknown` outranks the two
 * "something is missing" states.
 *
 * `not-installed` is ranked and never reached: the filter above removes it first. It is in the record
 * anyway, because a partial `Record<HarnessState, number>` would make a *sixth* state added to the
 * protocol a compile error in the one place that must decide where it goes — which is the point.
 */
const OFFER_ORDER: Record<HarnessState, number> = {
  ready: 0,
  unknown: 1,
  "needs-bridge": 2,
  unsupported: 2,
  "not-installed": 3,
};

/** The facts this rule may read — a shipped agent and a user-declared one both have them, and nothing else. */
export interface PickerSubject {
  availability?: HarnessAvailability;
  /** The pre-`availability` wire generation. Read by `availabilityOf`, never by the rule itself. */
  available?: boolean | "unknown";
}

export function agentFor(
  harness: HarnessId,
  summary: HarnessSummary | undefined,
): ComposerAgent {
  return {
    id: harness,
    label: summary?.label ?? harnessLabel(harness),
    modes: summary?.modes ?? [],
    // Passed through whole, `undefined` included: "nobody has told us what it publishes" is a third
    // state with its own sentence, and defaulting it to `{ kind: "none", options: [] }` would turn our
    // ignorance into a claim about the agent.
    models: summary?.models,
    // A third fact about the same agent, passed whole for the same reason: `"session"` means the agent
    // publishes its thinking levels only inside a session and nobody has opened one yet, and defaulting
    // it to `{ kind: "none" }` would turn our ignorance into a claim about the agent.
    thinking: summary?.thinking,
    capabilities: {
      resume: summary?.capabilities.resume ?? false,
      cancel: summary?.capabilities.cancel ?? false,
      approvals: summary?.capabilities.approvals ?? false,
      structuredTools: summary?.capabilities.structuredTools ?? false,
      streaming: summary?.capabilities.streaming ?? false,
      images: summary?.capabilities.images ?? false,
    },
    availability: availabilityOf(summary),
    // **The wire is the only thing that may turn the picker on.** No summary, or a summary that says the
    // daemon cannot set this agent's mode, both leave it off with the reason shown.
    modesApplicable: summary?.capabilities.agentMode === true,
    // The same rule for the model, on its own flag: an agent can publish a list this build still has no
    // way to deliver to, so "it has models" is not the question — "can we apply one" is.
    modelApplicable: summary?.capabilities.model === true,
    // The third flag, on its own wire: whether this daemon can make a chosen level the one the agent
    // runs at. False for `envoy-harness`, whose ACP surface has no thought-level method at all.
    thinkingApplicable: summary?.capabilities.thinking === true,
  };
}
