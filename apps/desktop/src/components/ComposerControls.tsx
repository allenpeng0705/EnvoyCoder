/**
 * The row above the field: **this task's folder, and the agent's own mode.**
 *
 * ## Why these two, and why together
 *
 * They are the two settings a user changes *while looking at the work*, and both belong to the task
 * rather than to the app: which directory the agent runs in, and how much it is allowed to do there. A
 * task with the wrong root is unusable, and so is an agent that edits files when the user asked it to
 * plan — which is why the mode arrived second and sits beside the folder.
 *
 * They share one property, and it decides every sentence here: **both apply to the next run.**
 * `runs.ts` launches the agent with `task.cwd` and puts it into its mode right after `session/new`, so
 * neither control can move or re-mode a run already in flight. While one is live, each says so in its
 * own line — a user who changed only the folder is not told about a mode they never touched.
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
 * ## Why this is a component and not more lines in `TaskPane`
 *
 * `TaskPane` renders the transcript and owns the composer's state; this is one region of it, with
 * explicit props and no state of its own. The *decisions* — what the agent allows, which reason
 * applies, how a path is shortened — live in `composer/controls.ts`, pure and testable without a DOM,
 * the same split `state/transcript.ts` and `TaskPane` already use.
 */

import type { JSX } from "react";

import {
  modeDescription,
  modeLabel,
  shortenFolder,
  type ComposerMode,
  type ModeOffReason,
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
  /** Is a turn running? Decides the note, never whether a control works. */
  running: boolean;
}

export function ComposerControls(props: ComposerControlsProps): JSX.Element {
  const t = useT();
  const { cwd, running } = props;
  const modeOff = props.modeOff;

  // `folderProblem` is a message from the platform (a dialog that would not open), so it is a value and
  // not a key; the sentence around it is ours and is translated.
  const folderReason = props.folderProblem
    ? t("palette.pickerFailed", { detail: props.folderProblem })
    : props.canChooseFolder
      ? undefined
      : t("task.composer.folder.noPicker");
  const selectedMode = props.modes.find((mode) => mode.id === props.selectedModeId);

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
    </>
  );
}
