/**
 * What a run asks for, checked against the catalogue — or refused with a sentence a user can read.
 *
 * ## Why this is its own module
 *
 * Three values travel from a composer to an agent: the agent's mode, its model, and its thinking level.
 * They look like three features and they are one decision repeated: **a value the user picked has to be
 * checked against what this build can actually deliver, before any process exists**, and the refusal has
 * to be specific enough that the user knows what to do next. Those are the two facts each function here
 * returns — the delivery, or the refusal — and keeping them together is what stops the three drifting
 * into three different ideas of what "we cannot do that" means.
 *
 * The module owns no state and spawns nothing, which is why it can be read (and tested) as a table: for
 * each value, what the catalogue says and what a user is told when it says no.
 *
 * ## The three answers, which are the same three every time
 *
 *   * **Nothing was asked for** (`undefined`, or the control's `""` for "the agent's own default") —
 *     for mode and thinking level, not an error: the agent runs the way it decides for itself. For a
 *     **model**, that is only fine when this build cannot apply one at all; every agent that *can*
 *     take a model must have one configured, or the run is refused before a process exists.
 *   * **Something this build can deliver** — a delivery: argv flags the caller has already built, a
 *     session-config pair applied to the session the agent just opened, or `undefined` when the value
 *     travelled in the launch itself.
 *   * **Something it cannot** — a `coderError` with a code and a catalogue key, thrown **before a
 *     process exists**. Silently dropping a value is the failure this module exists to prevent: the
 *     agent answers, and it answers on a model, or at a depth, or in a posture the user did not ask for.
 *
 * Every refusal names the *cause* rather than the value, because the two are different sentences: an
 * agent that cannot be put into a mode at all, one whose id is not one it declares, and one that accepts
 * a model but not that one are three things to tell a user, and folding them into "the mode failed"
 * would leave them with nothing to try.
 */

import {
  harnessDefinition,
  harnessModelDelivery,
  resolveModelChoice,
  thinkingDelivery,
} from "@envoydev/agent-catalog";
import { ENVOYDEV_ERRORS, type HarnessId, coderError } from "@envoydev/protocol";

import type { AcpAutoRunPolicy } from "./acp/client.js";
import { ref } from "./messages.js";

/**
 * The mode a run starts in, or a refusal that names why it cannot be one.
 *
 * ## Why the daemon checks rather than passing it through
 *
 * `session/set_mode` is not a method every ACP agent answers. `envoy-harness` implements it with
 * `default | plan | review`; `deepseek-harness` does not implement it at all, and its own per-session
 * configuration is the model and the reasoning effort. So "the window offered a picker" is not proof
 * that a given agent accepts a mode, and the check has to be against the *harness*, from the
 * catalogue — the same source the window renders its picker from, which is what keeps the two ends
 * telling the user the same story.
 *
 * Two refusals, and the code tells them apart the way `ENVOYDEV_ERRORS` says to: the **cause** is
 * the harness when its protocol has no way to be put into a mode, and the **caller's** mistake when
 * the id is one this agent never declared. A client that has just been told "this agent cannot do
 * modes" offers the user something different from one told "that mode name is not one of its".
 *
 * Returning `undefined` for "no mode requested" is deliberate: that is not a failure, it is an agent
 * running in its own default, and the task file says nothing rather than naming a default it did not
 * choose.
 */
export function resolveAgentMode(harness: HarnessId, requested: string | undefined): string | undefined {
  if (requested === undefined) return undefined;
  const definition = harnessDefinition(harness);

  if (!definition.capabilities.agentMode) {
    throw coderError(
      ENVOYDEV_ERRORS.harnessUnsupported,
      `${definition.label} cannot be put into a mode over the protocol EnvoyDev speaks to it, so the run was not started. Leave the mode unset to run ${definition.label} in its own default.`,
      ref("error.agentModeUnsupported", { harness: definition.label }),
    );
  }
  if (!definition.modes.some((mode) => mode.id === requested)) {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      `${definition.label} does not offer a mode called "${requested}", so the run was not started. Pick one of its modes and try again.`,
      ref("error.agentModeUnknown", { harness: definition.label, mode: requested }),
    );
  }
  return requested;
}

/**
 * How the chosen model reaches this agent — or a refusal naming why it cannot.
 *
 * ## The three outcomes, and why the middle one is not "ignore it"
 *
 *   * **No model asked for** (`undefined`) — for an agent this build **cannot** put on a model
 *     (`canApplyModel` is false), that is fine: the agent has no model control and runs as itself.
 *     For **Envoy Harness** (argv delivery), it is a refusal: starting without one leaves the
 *     transcript naming nothing while the agent answers on its silent default (the hermetic demo
 *     backend). External ACP agents (DeepSeek, Claude, Codex, Cursor) may omit a model and use
 *     whatever default their own CLI / account already has — credentials and custom providers live
 *     there, not in EnvoyDev's picker.
 *   * **A model this agent takes** — returned as the agent's own session-configuration pair when it is
 *     an agent that reads one there (`deepseek-harness`), or as `undefined` when the value already
 *     travelled in argv (`envoy-harness`, where the catalogue's `buildArgs` built the flags). Two
 *     deliveries, one resolution: the *split* is the catalogue's, and doing it twice is how the two
 *     ends come to disagree.
 *   * **A model this agent cannot take** — refused, before a process exists. Both sub-cases refuse:
 *     an agent with no model support at all, and an id it does not publish (which we cannot map to a
 *     provider ourselves, and which `envoy-harness` would silently drop on the floor).
 *
 * The refusal codes are the catalogue's (`noModelSupport` / `unknownModel` /
 * `notProviderQualified`), turned into one translated sentence each, because "this agent has no model"
 * and "we do not know that model" are different things to tell a user.
 */
export function resolveModelDelivery(
  harness: HarnessId,
  model: string | undefined,
): { configId: string; value: string } | undefined {
  if (model === undefined || model === "") {
    // Only argv delivery (Envoy Harness) must name a model before a process exists. Session-config
    // agents keep their own default when the picker is left empty.
    if (harnessModelDelivery(harness)?.kind === "argv") {
      const label = harnessDefinition(harness).label;
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        `${label} has no model configured. Choose a model from the list, then try again.`,
        ref("error.modelRequired", { harness: label }),
      );
    }
    return undefined;
  }
  const label = harnessDefinition(harness).label;
  const resolved = resolveModelChoice(harness, model);
  if (!resolved.ok) {
    throw coderError(
      resolved.code === "noModelSupport"
        ? ENVOYDEV_ERRORS.harnessUnsupported
        : ENVOYDEV_ERRORS.badRequest,
      `${resolved.reason} The run was not started.`,
      ref(
        resolved.code === "noModelSupport"
          ? "error.modelUnsupported"
          : resolved.code === "unknownModel"
            ? "error.modelUnknown"
            : "error.modelNotProviderQualified",
        { harness: label, model },
      ),
    );
  }
  const delivery = harnessModelDelivery(harness);
  // No delivery at all, for an agent that was never launchable anyway: `launchFromCatalogue` refuses
  // it by name a few lines later, and inventing a second refusal here would be two sentences for one
  // fact. The argv entries need nothing from this function beyond the check above.
  if (delivery === undefined || delivery.kind === "argv") return undefined;
  return {
    configId: delivery.configId,
    value: delivery.encode({ provider: resolved.provider, model: resolved.model }),
  };
}

/**
 * The config id a chosen thinking level travels in — or a refusal naming why it cannot.
 *
 * ## The three outcomes, and the one that is deliberately absent
 *
 *   * **No level asked for** (`undefined`, or the control's `""` for "the agent's own default") — the
 *     agent runs at whatever depth it defaults to. Not an error.
 *   * **A level this agent takes** — returned as `{configId, value}`, and `AcpClient` sets it on the
 *     session right after the model, in that order, because an agent derives its thinking options from
 *     the model it has resolved.
 *   * **A level this agent cannot take at all** — refused **before a process exists**, with a keyed
 *     sentence. Silently dropping it would be the exact failure the whole control row exists to
 *     prevent: the agent answers, and it answers having thought for less time than the user asked it
 *     to. `envoy-harness` is this case — no thought-level method in its dispatch — and the refusal names
 *     the agent rather than the level, because nothing the user could type would help.
 *
 * ## What is *not* checked here, and why that is the honest choice
 *
 * A level the agent does not currently publish is **not** refused by us. The list we would check it
 * against came from an earlier session, is per model, and is explicitly presented to the user as an
 * observation rather than a promise; refusing on it would turn a stale record into a veto over a value
 * the agent would have accepted. The agent is the authority, it validates every value itself
 * (`dsh-acp/lib/index.js:217-231`), and it refuses with its own sentence — `invalid params: unknown
 * reasoning effort for <provider>/<model>: <value>` — which the run surfaces verbatim. That is a loud
 * failure after a process exists, and it is still better than a claim we cannot support.
 */
export function resolveThinkingDelivery(
  harness: HarnessId,
  level: string | undefined,
): { configId: string; value: string } | undefined {
  // `""` is the control's "the agent's own default" — a real request that means "do not name one".
  if (level === undefined || level === "") return undefined;
  const label = harnessDefinition(harness).label;
  const delivery = thinkingDelivery(harness);
  if (delivery === undefined) {
    throw coderError(
      ENVOYDEV_ERRORS.harnessUnsupported,
      `${label} cannot be given a thinking level over the protocol EnvoyDev speaks to it, so the run was not started. Leave the thinking level unset to run ${label} the way it decides for itself.`,
      ref("error.thinkingUnsupported", { harness: label }),
    );
  }
  return { configId: delivery.configId, value: level };
}

/**
 * Whether this agent should ask before destructive actions — the value its own policy method takes,
 * or nothing when it has no such method.
 *
 * ## Why the app setting is resolved here rather than into a second control
 *
 * "Ask before anything destructive" is an **app** setting, not a per-task one (`CoderSettings`), but
 * the mechanism that honours it is a **session** method on one agent out of the catalogue. So the
 * setting's effect is a small resolution with three answers, and they are the same three
 * `resolveModelDelivery` has:
 *
 *   * **The agent accepts a policy** — `{ autoRun }`, handed to `AcpClient` and stated on the session
 *     that agent just opened. `envoy-harness` validates exactly
 *     `always-confirm | safe-only | off`, and its live permission hook asks per tool call on the result
 *     (`shouldAskUnderAutoRun`, `agent-backend-host.ts:217-231`, so the hook is what a
 *     `session/request_permission` actually comes from).
 *   * **The agent has no such method** — `undefined`, and **not** a thrown error.
 *   * **Nothing to say** — also `undefined`: `false` is a posture, and so is the default.
 *
 * ## Why the second answer is `undefined` and not a refusal
 *
 * Every other resolver in this module refuses a value the agent cannot take, and it is tempting to
 * refuse here for symmetry. It would be wrong, and in a way worth stating: a *task* value the user
 * chose for *this* agent is a request the user can withdraw ("leave the mode unset"), while this is an
 * application-wide preference that would then refuse to start any task on an agent that merely has its
 * own opinion about approvals. The honest outcome is that the run proceeds under the agent's own
 * policy, and that the settings pane says so **before** the user gets here — which is why the wire
 * carries `capabilities.approvalPolicy` and the row is disabled with a reason when it is false.
 *
 * ## Which value for which state, and why the strict one
 *
 *   * `requireApprovalForDestructive: true` → **`always-confirm`**: ask before every tool. That is also
 *     what the peer does when no policy is sent at all (`shouldAskUnderAutoRun(undefined)` answers
 *     `undefined`, and the live hook falls through to `shouldAskTool?.(…) ?? true`), so turning the
 *     setting *on* pins the safe posture rather than silently loosening it — and pins it against a
 *     harness whose default could change under us. Stated on the session either way, so
 *     `session/get_policy` can prove which posture a run is in.
 *   * `false` → **`off`**: never ask.
 *
 * `safe-only` — the third value the peer accepts — is deliberately **not** used for the `true` state,
 * and the reason is the value's own definition: it auto-allows every tool in `AUTO_RUN_SAFE_TOOLS`,
 * which includes the whole `git` tool regardless of arguments (`permissions/auto-run.ts:16-23`), so a
 * commit or a push would run without asking. That contradicts the sentence on the row ("ask before
 * anything destructive"), and a safety control that quietly under-delivers is the exact defect this
 * slice exists to remove.
 */
export function resolveApprovalPolicy(
  harness: HarnessId,
  requireApprovalForDestructive: boolean,
): { autoRun: AcpAutoRunPolicy } | undefined {
  if (!harnessDefinition(harness).capabilities.approvalPolicy) return undefined;
  return { autoRun: requireApprovalForDestructive ? "always-confirm" : "off" };
}
