/**
 * The two rows that carry a decision rather than a value, and the small lookups the section pages share.
 *
 * ## Why these are not in a section page
 *
 * The model row is rendered at **both** scopes — this machine's default and a project's override — and
 * the approval row is rendered on the Safety page for whichever agent new tasks start with. A row that
 * has to exist twice belongs where both callers can reach it, and the alternative (a copy per section)
 * is how the app default model, a project's model and a task's model would come to mean three things.
 *
 * ## What the model row is, and why it asks the composer
 *
 * The three shapes and the reasons are `composer/controls.ts`'s, and that is the point: this row asks
 * the *same* function the composer does, with a state that says "nothing is running and no approval is
 * waiting". A second implementation of "which shape is this control" is how the pane and the composer
 * would come to disagree about whether an agent takes a model at all — which is the one disagreement
 * that turns a supported feature into a disabled control.
 */

import type { JSX } from "react";

import type { HarnessId, HarnessSummary } from "@envoydev/protocol";

import { agentFor } from "../../composer/agent-for.js";
import { composerControls, modelNote, modelOffReason } from "../../composer/controls.js";
import { harnessLabel } from "../../composer/harness-label.js";
import { useI18n } from "../../i18n/context.js";
import type { WriteFailure } from "../../i18n/notice.js";
import { formatWhen } from "../../i18n/when.js";
import type { CoderState } from "../../state/coderStore.js";
import { ModelChoice } from "../ModelChoice.js";
import { SettingRow } from "../SettingsRows.js";

export function summaryFor(state: CoderState, harness: HarnessId): HarnessSummary | undefined {
  return state.harnesses.find((entry) => entry.id === harness);
}

export function labelForHarness(harness: HarnessId, state: CoderState): string {
  return summaryFor(state, harness)?.label ?? harnessLabel(harness);
}

/**
 * The model a run will start on — the app's default, or a project's.
 *
 * `composerControls` needs *an agent* to answer, and the agent a default belongs to is the one named
 * beside it: the app's default agent for the app scope, the project's own for a project's. That is why
 * this row takes `harness` rather than reading a global — a project that names an agent decides which
 * models its rows can offer.
 */
export function ModelRow(props: {
  idPrefix: string;
  harness: HarnessId;
  summary: HarnessSummary | undefined;
  value: string | undefined;
  title: string;
  detail: string;
  developerNote: string;
  /**
   * Choose a model. **It returns the write's answer**, not nothing: the row is the only place that can show a
   * refusal, so the section hands the promise through and `SettingRow`'s `write` renders it under the control.
   * See `SettingRowProps.children` for why the sink is the row.
   */
  onChoose: (model: string) => Promise<WriteFailure>;
}): JSX.Element {
  const { t, locale } = useI18n();
  const agent = agentFor(props.harness, props.summary);
  // One call, exactly as the composer makes it — see the module doc for why that matters.
  const controls = composerControls(agent, { running: false, approvalPending: false }, {
    ...(props.value !== undefined ? { selectedModelId: props.value } : {}),
  });
  const off = modelOffReason(controls.model, {
    known: props.summary !== undefined,
    agent: agent.label,
  });
  const noteKey = modelNote(controls.model, { enabled: off === undefined });
  const at =
    controls.model.observedAt !== undefined
      ? formatWhen(controls.model.observedAt, locale)
      : undefined;

  const note =
    off !== undefined
      ? t(off.key, off.values)
      : noteKey !== undefined
        ? t(noteKey, { agent: agent.label, at: at ?? "" })
        : undefined;

  const titleId = `${props.idPrefix}-model`;

  return (
    <SettingRow
      title={props.title}
      detail={props.detail}
      developerNote={props.developerNote}
      titleId={titleId}
      note={note}
    >
      {(write) => (
        <ModelChoice
          labelId={titleId}
          kind={controls.model.kind}
          options={controls.model.options}
          selected={props.value}
          off={off}
          title={t("task.composer.model.title")}
          onChoose={(model) => write(props.onChoose(model))}
        />
      )}
    </SettingRow>
  );
}

/**
 * "Ask before anything destructive" — the row the first settings slice exists for.
 *
 * **What it does.** The value is handed to the agent as its own session policy at the start of every
 * run (`session/set_policy { autoRun }`), which is the only mechanism that can change whether an agent
 * stops to ask: `envoy-harness` validates `always-confirm | safe-only | off` and its live permission hook
 * asks per tool call on the result. `true` states the fail-closed posture, `false` asks it to stop
 * asking; `resolveApprovalPolicy` in the daemon owns the mapping and records why the strict value is the
 * one for `true`.
 *
 * **What it does not do, said on screen.** Only `envoy-harness` documents such a method —
 * `deepseek-harness` registers nine ACP methods and `session/set_policy` is not among them — so when the
 * default agent is one of the others, the row is **disabled and names it**. The alternative, a live
 * switch that stores a preference no agent hears, is precisely the lie this pane removes.
 */
export function ApprovalRow(props: {
  state: CoderState;
  harness: HarnessId;
  checked: boolean;
  /** As `ModelRow`'s `onChoose`: the row shows the refusal, so the answer travels back to it. */
  onToggle: (checked: boolean) => Promise<WriteFailure>;
}): JSX.Element {
  const { t } = useI18n();
  const summary = summaryFor(props.state, props.harness);
  const agent = summary?.label ?? harnessLabel(props.harness);
  const supported = summary?.capabilities.approvalPolicy === true;
  const note = supported
    ? t("settings.approvals.reaches", { agent })
    : summary === undefined
      ? t("settings.approvals.unknown", { agent })
      : t("settings.approvals.unsupported", { agent });

  return (
    <SettingRow
      title={t("settings.approvals.title")}
      detail={t("settings.approvals.detail")}
      developerNote="settings.requireApprovalForDestructive"
      titleId="setting-approvals"
      note={note}
    >
      {(write) => (
        <input
          type="checkbox"
          checked={props.checked}
          disabled={!supported}
          onChange={(event) => write(props.onToggle(event.target.checked))}
          aria-labelledby="setting-approvals"
        />
      )}
    </SettingRow>
  );
}
