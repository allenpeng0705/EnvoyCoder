/**
 * The row above the field: **this task's folder, the agent's own mode, its model, and how much it
 * thinks.**
 *
 * ## Why these four, and why together
 *
 * They are the settings a user changes *while looking at the work*, and all four belong to the task
 * rather than to the app: which directory the agent runs in, how much it is allowed to do there, which
 * model does it, and how hard that model is asked to think. A task with the wrong root is unusable, and
 * so is an agent that edits files when the user asked it to plan — which is why the mode arrived second,
 * the model third, and the thinking level fourth: an agent on the wrong model produces plausible work
 * that is not the work anybody asked for, and at the wrong depth it produces work that is not as good as
 * the user asked for.
 *
 * They share one property, and it decides every sentence here: **all of them apply to the next run.**
 * `runs.ts` launches the agent with `task.cwd`, puts it into its mode right after `session/new`, and —
 * for the agent that takes them there — sets its model and then its thinking level on the same session.
 * While a run is live, each control says so in its own line: a user who changed only the folder is not
 * told about a model they never touched.
 *
 * ## The two kinds of "we do not know", which the last two controls have in common
 *
 * The model and the thinking level are both published **per session**, so for both of them an empty list
 * is a state of *our* knowledge rather than a fact about the agent — and each draws its own sentence for
 * it. The difference between them is the same one `composer/controls.ts` models in three states: the
 * agent may accept a value it does not publish (free text, for a model), or publish nothing until a
 * session exists (a disabled pill, for a thinking level, with the sentence saying which of the two it
 * is). Both carry the **time** an observed list was seen, because a list from a real session is a
 * record and not a promise.
 *
 * ## The rule that shapes every branch
 *
 * **A control we cannot honour is disabled, with the reason on screen**, never hidden: a user looking
 * for the folder cannot tell "this window has no chooser" from "the app forgot to draw it". Three
 * different facts can leave the mode picker off, and they are not interchangeable:
 *
 *   * the agent declares no modes — `deepseek-harness`, whose ACP surface has no `session/set_mode`, so
 *     there is genuinely nothing to choose;
 *   * the daemon cannot set this agent's mode — a catalogued CLI that declares modes (from Paseo's
 *     provider manifest) while `isDrivableByAcpAdapter` refuses to launch it at all;
 *   * nothing has told us yet — the harness list has not arrived, which is *our* ignorance and not a
 *     fact about the agent.
 *
 * Folding those into one sentence is how a user concludes an agent has no plan mode when it has one and
 * we simply cannot reach it.
 *
 * ## The model is the same rule with one more state, and the extra state is the point
 *
 * A model list can be absent for a reason that is **not** a refusal to choose: `deepseek-harness`
 * publishes its models only inside a live session's `configOptions`, so before a run exists there is no
 * list to render and the user must still be able to name one. That is `kind: "free-text"`, and it draws
 * a **text field** — with the `provider/model` shape spelled out underneath, because that is the only
 * form the agent can be handed and the one a user cannot guess. `kind: "none"` — the agent takes no
 * model at all — is the only state that disables it. `options.length === 0` is never the test: an empty
 * list with `"free-text"` is a working control, and treating it as "none" would disable the feature.
 *
 * ## Why this is a component and not more lines in `TaskPane`
 *
 * `TaskPane` renders the transcript and owns the composer's state; this is one region of it, with
 * explicit props and no state of its own beyond the free-text draft. The *decisions* — what the agent
 * allows, which reason applies, how a path is shortened — live in `composer/controls.ts`, pure and
 * testable without a DOM, the same split `state/transcript.ts` and `TaskPane` already use.
 */

// No hooks: this component keeps no state of its own (the free-text draft moved into `ModelChoice`,
// which owns the field that needs it). The `useEffect`/`useState` imports had been dead here since that
// move — removed while this file was being edited.
import type { JSX } from "react";

import {
  modeDescription,
  modeLabel,
  modelNote,
  optionDescription,
  optionLabel,
  shortenFolder,
  thinkingNote,
  type ComposerMode,
  type ComposerModel,
  type ComposerThinkingOption,
  type ModeOffReason,
  type ModelOffReason,
  type ThinkingOffReason,
} from "../composer/controls.js";
import { useI18n } from "../i18n/context.js";
import type { MessageKey } from "../i18n/messages/en.js";
import { localize, type Notice } from "../i18n/notice.js";
import { formatWhen } from "../i18n/when.js";
import { ModelChoice } from "./ModelChoice.js";

export interface ComposerControlsProps {
  /** The folder the agent works in — the one the next run will be launched with. */
  cwd: string;
  /** The project's path, so the pill can show the folder the way the user thinks of it. */
  projectPath?: string | undefined;
  /** Is there a shell to ask for a folder? The caller decides this synchronously. */
  canChooseFolder: boolean;
  /** Why the chooser would not open, after a click that found out. */
  folderProblem?: string | undefined;
  onChooseFolder: () => void;
  /** The modes the agent declares, in the agent's own order. Empty is a fact, not a gap. */
  modes: readonly ComposerMode[];
  /** What the picker shows, when it has something to show. */
  selectedModeId: string | undefined;
  /** Which reason leaves the picker off — a key and its values, or nothing when it works. */
  modeOff?: ModeOffReason | undefined;
  onChooseMode: (id: string) => void;
  /**
   * Which of the three model controls to draw — **carried, not inferred from `models.length`**.
   *
   * `"free-text"` with no options is a working control, so a component that asked
   * `models.length === 0` would replace a usable field with a disabled pill.
   */
  modelKind: "listed" | "free-text" | "none";
  /** The models the agent publishes, in its own order. Empty for every other `kind`. */
  models: readonly ComposerModel[];
  /** The task's stored model, provider-qualified. `undefined` means the agent's own default. */
  selectedModelId: string | undefined;
  /** Why the model control is off — the same key-and-values pair the mode picker uses. */
  modelOff?: ModelOffReason | undefined;
  /**
   * The agent's name, for the one note that is not a refusal.
   *
   * The refusal notes get it through `reasonValues`; the free-text instruction names the agent just as
   * directly ("{agent} publishes its models only inside a running session"), so it is a prop of its own
   * rather than something read out of a reason object that does not exist in that branch.
   */
  agentLabel: string;
  /** `""` means the agent's own default: the choice is cleared rather than replaced. */
  onChooseModel: (id: string) => void;
  /**
   * The thinking levels the agent published in its last session, in its own order.
   *
   * Empty for every other `kind` — including `"session"`, which means the agent publishes levels and
   * nothing has been observed yet. That state is **not** a refusal to choose on the agent's part, and
   * the reason line says which of the two it is.
   */
  thinkingOptions: readonly ComposerThinkingOption[];
  /** The task's stored thinking level. `undefined` means the agent's own default. */
  selectedThinkingLevel: string | undefined;
  /** Which reason leaves the thinking control off — its own key-and-values pair. */
  thinkingOff?: ThinkingOffReason | undefined;
  /**
   * When the model list was observed from a session, if it was.
   *
   * Passed through rather than looked up, and deliberately a *time* rather than a boolean: the sentence
   * the window shows names it, because "what it offered last time" is only honest with the *when* — a
   * list from an hour ago and one from last month are different claims about the machine.
   */
  modelObservedAt?: string | undefined;
  /** The same, for the thinking levels. */
  thinkingObservedAt?: string | undefined;
  /** `""` means the agent's own default, on the same terms as the model. */
  onChooseThinking: (level: string) => void;
  /** Is a turn running? Decides the note, never whether a control works. */
  running: boolean;
  /**
   * The pre-flight probe's own line, when there is one: "asking…", or the daemon's answer.
   *
   * A `Notice` rather than a string because the daemon's answer carries a catalogue key with it — the
   * window renders it in the user's language, and a language change re-renders a sentence that arrived
   * minutes ago. Absent means "nothing to say", which is the normal case: a list we observed needs no
   * sentence of its own, since the pills show it and their note carries the time.
   */
  probeNote?: Notice | undefined;
  /**
   * The button that asks the agent what it offers — and, in its label, whether this is the first ask or
   * another one.
   *
   * Drawn **once**, under both option-bearing controls, because one probe answers both questions: the
   * model list and the thinking levels come from the same `session/new` response, so two buttons would
   * be two controls doing one thing. Absent for an agent the daemon cannot be asked about — an older
   * build, an agent whose options the catalogue already answers, an agent that is not installed.
   */
  probeAction?: { key: MessageKey; enabled: boolean } | undefined;
  onProbeAgent?: (() => void) | undefined;
}

export function ComposerControls(props: ComposerControlsProps): JSX.Element {
  const { t, locale } = useI18n();
  const { cwd, running } = props;
  const modeOff = props.modeOff;
  const modelOff = props.modelOff;
  const thinkingOff = props.thinkingOff;

  /**
   * **A press that failed is news; a state that never changes is a description.**
   *
   * `folderProblem` is a dialog that would not open — something the user just did, and §7.27's rule says a
   * refusal is read where the press was, so it keeps the visible line. "This window has no folder chooser" is
   * a permanent property of the window, and it becomes the pill's own description instead.
   *
   * `folderProblem` is a message from the platform, so it is a value and not a key; the sentence around it is
   * ours and is translated.
   */
  const folderFailure = props.folderProblem
    ? t("palette.pickerFailed", { detail: props.folderProblem })
    : undefined;
  const folderUnavailable = props.canChooseFolder ? undefined : t("task.composer.folder.noPicker");
  const selectedMode = props.modes.find((mode) => mode.id === props.selectedModeId);
  const selectedModel = props.models.find((model) => model.id === props.selectedModelId);
  const selectedThinking = props.thinkingOptions.find(
    (option) => option.value === props.selectedThinkingLevel,
  );
  /**
   * The timestamp on an observed list, in the user's language and calendar.
   *
   * Through `Intl` rather than a fixed format, because "14.09.2026, 13:23" and "Sep 14, 2026, 1:23 PM"
   * are the same fact written for two readers, and a hand-rolled format would be wrong in six of the
   * seven languages this window speaks. `formatWhen` degrades to the raw ISO string rather than
   * throwing, so a timestamp a daemon built differently can still be shown.
   */
  const observedAt = (at: string | undefined): string | undefined =>
    at === undefined ? undefined : formatWhen(at, locale);
  /**
   * Which observed note belongs under each control — **decided in `composer/controls.ts`**, not here.
   *
   * The module owns the rule "a disabled control gets its reason and no note"; a component that decided
   * it again from `props.observedAt !== undefined` would be a second copy of the rule, and the copy that
   * goes stale is always the one further from the data.
   */
  const modelObservedNote = modelNote(
    {
      kind: props.modelKind,
      ...(props.modelObservedAt !== undefined ? { observedAt: props.modelObservedAt } : {}),
    },
    { enabled: modelOff === undefined },
  );
  /**
   * The probe's sentence, in the user's language.
   *
   * Through `localize`, exactly like every other piece of daemon prose: the daemon cannot know which
   * language this window is in (two windows on one daemon may differ), so it sends the key with the
   * sentence and the window resolves it — and a key this build does not have falls back to the English
   * sentence rather than to the key.
   */
  const probeText = localize(t, props.probeNote);
  const thinkingObservedNote = thinkingNote(
    { ...(props.thinkingObservedAt !== undefined ? { observedAt: props.thinkingObservedAt } : {}) },
    { enabled: thinkingOff === undefined },
  );

  /**
   * **Each control's own reason**, for its `title` and its `aria-describedby` — never a paragraph.
   *
   * A reason is a *refusal* (the control works and is disabled because the agent or the daemon cannot honour a
   * choice) or an *observation* (this list came from a session, at a time). Both answer "what is this control,
   * and why should I trust it", which is the question a user has while reaching for the control — so both belong
   * on it. See the notes rule at the foot of this component for why.
   */
  const modeReason = modeOff === undefined ? undefined : t(modeOff.key, modeOff.values);
  const modelReason =
    modelOff !== undefined
      ? t(modelOff.key, modelOff.values)
      : modelObservedNote !== undefined
        ? t(modelObservedNote, { agent: props.agentLabel, at: observedAt(props.modelObservedAt) ?? "" })
        : undefined;
  const thinkingReason =
    thinkingOff !== undefined
      ? t(thinkingOff.key, thinkingOff.values)
      : thinkingObservedNote !== undefined
        ? t(thinkingObservedNote, { agent: props.agentLabel, at: observedAt(props.thinkingObservedAt) ?? "" })
        : undefined;

  /**
   * The free-text draft moved into `ModelChoice`, along with the commit rule — a field's state belongs
   * with the field, and the settings pane's model row needs exactly the same behaviour (see that file).
   */
  return (
    <>
      <div className="composer__controls">
        <div className="composer__control">
          <span className="composer__control-label">{t("task.composer.folder.label")}</span>
          <button
            type="button"
            className="composer__pill"
            // Truncated on the pill, whole in the title: a path is worth reading at the end, and a user
            // who needs the beginning can hover or copy it. When there is no chooser the reason takes the
            // title, and the hidden paragraph beside it carries the same sentence to a screen reader.
            // The path stays in the title even when there is no chooser — it is the fact a user hovers for — and
            // the reason is appended rather than substituted, because both answers are wanted from the same hover.
            title={folderUnavailable === undefined ? cwd : `${cwd} — ${folderUnavailable}`}
            aria-label={t("task.composer.folder.aria")}
            {...(folderUnavailable !== undefined ? { "aria-describedby": "composer-folder-reason" } : {})}
            disabled={!props.canChooseFolder}
            onClick={props.onChooseFolder}
          >
            {shortenFolder(cwd, props.projectPath)}
          </button>
          {folderUnavailable === undefined ? null : (
            <p className="visually-hidden" id="composer-folder-reason">
              {folderUnavailable}
            </p>
          )}
        </div>

        <div className="composer__control">
          <span className="composer__control-label" id="composer-agent-mode-label">
            {t("task.composer.agentMode.label")}
          </span>
          <select
            className="select"
            // Enabled only when the wire said the daemon can put this agent into a mode. An agent with
            // modes it cannot be *set* into keeps its options *visible* and the control disabled, with
            // the reason on the next line: a picker that silently does nothing is the bug this control
            // exists to avoid.
            disabled={modeOff !== undefined}
            aria-labelledby="composer-agent-mode-label"
            {...(modeReason !== undefined ? { "aria-describedby": "composer-mode-reason" } : {})}
            title={modeReason ?? modeDescription(selectedMode, t) ?? t("task.composer.agentMode.title")}
            value={props.selectedModeId ?? ""}
            onChange={(event) => props.onChooseMode(event.target.value)}
          >
            {/* No modes to list is a *state*, not an empty box: the option says so, and the reason line
                below says why. */}
            {props.modes.length === 0 ? (
              <option value="">{t("task.composer.agentMode.unset")}</option>
            ) : null}
            {props.modes.map((mode) => (
              <option key={mode.id} value={mode.id} title={modeDescription(mode, t)}>
                {modeLabel(mode, t)}
              </option>
            ))}
          </select>
          {modeReason === undefined ? null : (
            <p className="visually-hidden" id="composer-mode-reason">
              {modeReason}
            </p>
          )}
        </div>

        <div className="composer__control">
          <span className="composer__control-label" id="composer-model-label">
            {t("task.composer.model.label")}
          </span>
          {/* **Three shapes for three facts, and the middle one is the reason this is not one `<select>`.**
              A list to choose from is a picker. An agent that publishes none and takes one is a text
              field — genuinely usable, with the `provider/model` shape in its note. An agent that takes
              no model is a disabled picker with the reason below it. `options.length === 0` decides
              nothing here: it is true for the free-text case, which works.
              The control itself is shared with the settings pane (`ModelChoice`), so the app's default
              model, a project's default model and a task's model cannot come to mean three things. */}
          <ModelChoice
            labelId="composer-model-label"
            kind={props.modelKind}
            options={props.models}
            selected={props.selectedModelId}
            off={modelOff}
            {...(modelReason !== undefined ? { descriptionId: "composer-model-reason" } : {})}
            title={modelReason ?? selectedModel?.description ?? t("task.composer.model.title")}
            onChoose={props.onChooseModel}
            inputClassName="input composer__model-input"
          />
          {modelReason === undefined ? null : (
            <p className="visually-hidden" id="composer-model-reason">
              {modelReason}
            </p>
          )}
        </div>

        <div className="composer__control">
          <span className="composer__control-label" id="composer-thinking-label">
            {t("task.composer.thinking.label")}
          </span>
          {/* **One shape, unlike the model.** A thinking level is an id in the agent's own vocabulary
              (`off`, `low`, `high`, `max`) that nobody outside the agent can guess, so there is no
              free-text counterpart: the control is a picker, or it is off with the reason below it. The
              first option is *ours* and means "the agent decides", which is also the state a task is in
              before anybody picks — and the only way to undo a choice. */}
          <select
            className="select"
            disabled={thinkingOff !== undefined}
            aria-labelledby="composer-thinking-label"
            {...(thinkingReason !== undefined ? { "aria-describedby": "composer-thinking-reason" } : {})}
            title={thinkingReason ?? optionDescription(selectedThinking, t) ?? t("task.composer.thinking.title")}
            value={props.selectedThinkingLevel ?? ""}
            onChange={(event) => props.onChooseThinking(event.target.value)}
          >
            <option value="">{t("task.composer.thinking.agentDefault")}</option>
            {props.thinkingOptions.map((option) => (
              <option key={option.value} value={option.value} title={optionDescription(option, t)}>
                {optionLabel(option, t)}
              </option>
            ))}
          </select>
          {thinkingReason === undefined ? null : (
            <p className="visually-hidden" id="composer-thinking-reason">
              {thinkingReason}
            </p>
          )}
        </div>
      </div>

      {/* **One line, and only when the user needs it now.**
          This was a stack of up to five paragraphs — one per control saying "your choice applies to the next
          run", plus a reason under each disabled control — and the owner's report was exact: *"These texts are
          useless, but make the chats inputting messy."* Four of those sentences were the *same* fact told four
          times, and the rest were reasons for controls the user had not reached for.

          So the rule is now about **where** a fact belongs rather than whether it is true:

            * a control that cannot be used carries its own reason **on itself** — a `title` for a pointer and
              `aria-describedby` for a screen reader (see the reasons below). It is still drawn and still
              disabled, and nothing is hidden: the explanation simply arrives at the control instead of sitting
              permanently above the field;
            * the fact all four controls share — that a choice made while a turn is running applies to the
              **next** run — is said **once**, and only while a turn is running;
            * and a line the user must act on (a chooser that would not open; the probe that is the only way to
              learn what the agent offers) takes the line instead.

          One line at the most, in that order. Measured: `composer-notes.test.tsx` counts them. */}
      {folderFailure !== undefined ? (
        <p className="composer__control-note">{folderFailure}</p>
      ) : (probeText !== undefined && probeText !== "") ||
        (props.probeAction !== undefined && props.onProbeAgent !== undefined) ? (
        <p className="composer__control-note">
          {probeText === undefined ? null : <span>{probeText}</span>}
          {props.probeAction === undefined || props.onProbeAgent === undefined ? null : (
            <>
              {probeText === undefined ? null : " "}
              <button
                type="button"
                className="button button--ghost"
                disabled={!props.probeAction.enabled}
                onClick={props.onProbeAgent}
              >
                {t(props.probeAction.key, { agent: props.agentLabel })}
              </button>
            </>
          )}
        </p>
      ) : running ? (
        <p className="composer__control-note">{t("task.composer.appliesNextRun")}</p>
      ) : null}
    </>
  );
}
