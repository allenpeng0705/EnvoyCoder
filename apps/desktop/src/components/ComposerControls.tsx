/**
 * The row above the field: **this task's folder, the agent's own mode, and its model.**
 *
 * ## Why these three, and why together
 *
 * They are the settings a user changes *while looking at the work*, and all three belong to the task
 * rather than to the app: which directory the agent runs in, how much it is allowed to do there, and
 * which model does it. A task with the wrong root is unusable, and so is an agent that edits files when
 * the user asked it to plan — which is why the mode arrived second, and the model third: an agent on the
 * wrong model produces plausible work that is not the work anybody asked for.
 *
 * They share one property, and it decides every sentence here: **all of them apply to the next run.**
 * `runs.ts` launches the agent with `task.cwd`, puts it into its mode right after `session/new`, and —
 * for the agent that takes one there — sets its model on the same session. While a run is live, each
 * control says so in its own line: a user who changed only the folder is not told about a model they
 * never touched.
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

import { useEffect, useState, type JSX } from "react";

import {
  looksLikeModelValue,
  modeDescription,
  modeLabel,
  shortenFolder,
  type ComposerMode,
  type ComposerModel,
  type ModeOffReason,
  type ModelOffReason,
} from "../composer/controls.js";
import { useT } from "../i18n/context.js";

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
  /** Is a turn running? Decides the note, never whether a control works. */
  running: boolean;
}

export function ComposerControls(props: ComposerControlsProps): JSX.Element {
  const t = useT();
  const { cwd, running } = props;
  const modeOff = props.modeOff;
  const modelOff = props.modelOff;

  // `folderProblem` is a message from the platform (a dialog that would not open), so it is a value and
  // not a key; the sentence around it is ours and is translated.
  const folderReason = props.folderProblem
    ? t("palette.pickerFailed", { detail: props.folderProblem })
    : props.canChooseFolder
      ? undefined
      : t("task.composer.folder.noPicker");
  const selectedMode = props.modes.find((mode) => mode.id === props.selectedModeId);
  const selectedModel = props.models.find((model) => model.id === props.selectedModelId);

  /**
   * The free-text draft, and the one piece of state in this component.
   *
   * A text field has to hold what the user is *typing*, which is not yet a model and must not be saved
   * as one: committing `deepseek` on the way to `deepseek/deepseek-chat` would store a value that makes
   * the next run refuse. So the field keeps the draft, and only a value that names both halves (or an
   * emptied field, which means "the agent's own default") is handed upwards.
   *
   * Re-seeded when the task changes, so opening another task never shows the last one's typing.
   */
  const [draft, setDraft] = useState(props.selectedModelId ?? "");
  useEffect(() => {
    setDraft(props.selectedModelId ?? "");
  }, [props.selectedModelId]);

  const commitModel = (): void => {
    const value = draft.trim();
    // Empty is a real choice — "the agent's own default" — and it is the only way to undo a model
    // without replacing it with another. A half-written value is neither, and is left in the field.
    if (value === "") {
      if (props.selectedModelId !== undefined) props.onChooseModel("");
      return;
    }
    // The same predicate the module exports and a test pins, rather than a second copy of it here: the
    // rule for "this names a provider and a model" has to be one rule, or the field and the test come to
    // disagree about what is saveable.
    if (looksLikeModelValue(value) && value !== props.selectedModelId) props.onChooseModel(value);
  };

  return (
    <>
      <div className="composer__controls">
        <div className="composer__control">
          <span className="composer__control-label">{t("task.composer.folder.label")}</span>
          <button
            type="button"
            className="composer__pill"
            // Truncated on the pill, whole in the title: a path is worth reading at the end, and a user
            // who needs the beginning can hover or copy it. The *reason* a chooser is unavailable is not
            // put here — it is the line below, visible without a hover and legible to a screen reader.
            title={cwd}
            aria-label={t("task.composer.folder.aria")}
            disabled={!props.canChooseFolder}
            onClick={props.onChooseFolder}
          >
            {shortenFolder(cwd, props.projectPath)}
          </button>
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
            title={modeDescription(selectedMode, t) ?? t("task.composer.agentMode.title")}
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
        </div>

        <div className="composer__control">
          <span className="composer__control-label" id="composer-model-label">
            {t("task.composer.model.label")}
          </span>
          {/* **Three shapes for three facts, and the middle one is the reason this is not one `<select>`.**
              A list to choose from is a picker. An agent that publishes none and takes one is a text
              field — genuinely usable, with the `provider/model` shape in its note. An agent that takes
              no model is a disabled picker with the reason below it. `options.length === 0` decides
              nothing here: it is true for the free-text case, which works. */}
          {props.modelKind === "free-text" ? (
            <input
              type="text"
              className="input composer__model-input"
              // The visible "Model" span labels both shapes, exactly as it does for the mode picker:
              // `aria-labelledby` rather than a second `aria-label`, so the name a screen reader
              // announces and the name on screen cannot drift apart.
              aria-labelledby="composer-model-label"
              disabled={modelOff !== undefined}
              placeholder={t("task.composer.model.placeholder")}
              title={t("task.composer.model.title")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              // Enter commits and blur commits: a value typed and then clicked away from is still a
              // value the user meant, and a field that silently discards one is worse than a slow save.
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitModel();
                }
              }}
              onBlur={commitModel}
            />
          ) : (
            <select
              className="select"
              // Enabled only when the wire said the daemon can put this agent on a chosen model. An
              // agent that publishes models it cannot be *set* to keeps the control visible and
              // disabled, with the reason on the next line.
              disabled={modelOff !== undefined}
              aria-labelledby="composer-model-label"
              title={selectedModel?.description ?? t("task.composer.model.title")}
              value={props.selectedModelId ?? ""}
              onChange={(event) => props.onChooseModel(event.target.value)}
            >
              {/* "The agent's own default" is a choice, not an empty slot: it is the state a task is in
                  before anybody picks, and picking it is how a user undoes a model they chose. */}
              <option value="">{t("task.composer.model.agentDefault")}</option>
              {props.models.map((model) => (
                <option key={model.id} value={model.id} title={model.description}>
                  {model.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* The reasons, and the "next run" notes. Separate lines because they are separate facts, and each
          control owns its own. */}
      {folderReason !== undefined ? (
        <p className="composer__control-note">{folderReason}</p>
      ) : running ? (
        <p className="composer__control-note">{t("task.composer.folder.nextRun", { path: cwd })}</p>
      ) : null}
      {modeOff !== undefined ? (
        <p className="composer__control-note">{t(modeOff.key, modeOff.values)}</p>
      ) : running ? (
        <p className="composer__control-note">{t("task.composer.agentMode.nextRun")}</p>
      ) : null}
      {/* The model's own note, and it is **two facts rather than one**, which is why they are not a
          single ternary. A free-text field always carries the `provider/model` instruction, because that
          is the shape the value must have and the one thing a user cannot guess — hiding it while a run
          is live would take the instruction away exactly when somebody is typing into the field. The
          "next run" sentence is a separate fact about timing and is added on top of it. */}
      {modelOff !== undefined ? (
        <p className="composer__control-note">{t(modelOff.key, modelOff.values)}</p>
      ) : (
        <>
          {props.modelKind === "free-text" ? (
            <p className="composer__control-note">
              {t("task.composer.model.freeText", { agent: props.agentLabel })}
            </p>
          ) : null}
          {running ? (
            <p className="composer__control-note">{t("task.composer.model.nextRun")}</p>
          ) : null}
        </>
      )}
    </>
  );
}
