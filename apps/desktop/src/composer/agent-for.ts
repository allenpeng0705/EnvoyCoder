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
 *   * `*Applicable` come from `capabilities`, never from `available`. An agent can publish a list this
 *     build has no way to deliver to, so "it has models" is not the question — "can we apply one" is.
 *
 * Two surfaces now ask the same question — the composer, about a task's agent, and the settings pane,
 * about the default agent — and they must answer it identically. A second copy of this mapping is how
 * the model pill and the settings row would come to disagree about which agents take a model, which is
 * the class of drift this repository keeps paying for.
 */

import type { HarnessId, HarnessSummary } from "@envoycoder/protocol";

import { harnessLabel } from "./harness-label.js";
import type { ComposerAgent } from "./controls.js";

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
    available: summary?.available ?? "unknown",
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
