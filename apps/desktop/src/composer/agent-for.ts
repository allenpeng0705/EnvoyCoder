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
  HarnessSummary,
  HarnessState,
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
export function availabilityOf(summary: HarnessSummary | undefined): HarnessAvailability {
  if (summary?.availability !== undefined) return summary.availability;
  const legacy = (summary as { available?: boolean | "unknown" } | undefined)?.available;
  return { state: legacy === true ? "ready" : "unknown" };
}

/** The single state a control branches on, from either wire generation. */
export function stateOf(summary: HarnessSummary | undefined): HarnessState {
  return availabilityOf(summary).state;
}

/** Can this agent be launched at all? One question, one place, both wire generations. */
export function canRun(summary: HarnessSummary | undefined): boolean {
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
 */
export function knownMissing(summary: HarnessSummary | undefined): boolean {
  return stateOf(summary) === "not-installed";
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
