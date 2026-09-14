/**
 * The two shapes every settings row is built from: **a row**, and **a field that commits**.
 *
 * ## Why a row is a component and not four `<p>`s per setting
 *
 * The pane's rule is one sentence in `docs/envoycoder-ui.md`: a control is never a dead switch, and a
 * control that cannot be honoured says **why** on screen. That makes three parts mandatory on every
 * row — what it is, what it does, and (when relevant) the reason it is off — and a row that forgot the
 * third would be indistinguishable from a row that has nothing to say. One component is what makes the
 * reason part of the shape rather than something each call site remembers.
 *
 * `note` is separate from `detail` on purpose: `detail` is what the setting *does*, written once and
 * true in every state, while `note` is what is true **now** — the reason a control is disabled, the
 * folder the picker will not open in, or an observation with a timestamp in it. Folding them together
 * would make the reason disappear whenever it stopped applying.
 *
 * ## Why a text field holds a draft
 *
 * A setting that is written on every keystroke writes half-typed values: a path becomes
 * `/Users/me/Doc`, `/Users/me/Docu`, … and the daemon either refuses each one or stores a folder that
 * does not exist. So a field keeps what the user is typing and commits on **blur or Enter** — a value
 * typed and then clicked away from is still a value the user meant, and a field that silently discards
 * one is worse than a slow save. That is the same rule the composer's model field follows, which is why
 * it looks the same.
 *
 * `"` in the committed value means **clear it** on the settings wire, and both callers below pass an
 * empty string straight through: pushing `undefined` at a JSON-RPC patch is not possible (it disappears
 * in `JSON.stringify`), so the empty string is the only way a user can un-choose a value they chose.
 */

import type { JSX, ReactNode } from "react";

import { useEffect, useState } from "react";

import { useI18n } from "../i18n/context.js";
import { hasShellPicker, pickFolder } from "../client/folder-picker.js";

export interface SettingRowProps {
  title: string;
  detail: string;
  /** The developer fact, in the title attribute — the last and smallest band, as the family's rule has it. */
  developerNote: string;
  /**
   * An id for the title element, so a control can be named by the words a user reads.
   *
   * `aria-labelledby` pointing at the row's own title, rather than a second `aria-label` beside it: one
   * name on screen and one announced, which is the only arrangement that cannot drift. The composer's
   * controls take the same line.
   */
  titleId?: string;
  /** What is true *now*: a reason, a warning, an observation. Rendered under the control. */
  note?: ReactNode;
  children: JSX.Element;
}

export function SettingRow(props: SettingRowProps): JSX.Element {
  return (
    <div className="setting">
      <div className="setting__text">
        <p className="setting__title" title={props.developerNote} {...(props.titleId !== undefined ? { id: props.titleId } : {})}>
          {props.title}
        </p>
        <p className="setting__detail">{props.detail}</p>
        {props.note !== undefined && props.note !== null ? (
          <p className="setting__note">{props.note}</p>
        ) : null}
      </div>
      <div className="setting__control">{props.children}</div>
    </div>
  );
}

export interface TextSettingProps {
  /** This control's accessible name — never a second copy of the visible label. */
  ariaLabel: string;
  /** The stored value. `undefined` and `""` both render as an empty field. */
  value: string | undefined;
  placeholder?: string;
  /** Called with the committed value. `""` means "clear it" (see the module doc). */
  onCommit: (value: string) => void;
  title?: string;
}

export function TextSetting(props: TextSettingProps): JSX.Element {
  const [draft, setDraft] = useState(props.value ?? "");
  // Re-seeded when the value changes underneath — a second window editing the same setting, or the
  // daemon refusing a write and answering with what it actually holds.
  useEffect(() => {
    setDraft(props.value ?? "");
  }, [props.value]);

  const commit = (): void => {
    const value = draft.trim();
    if (value === (props.value ?? "")) return;
    props.onCommit(value);
  };

  return (
    <input
      type="text"
      className="input"
      aria-label={props.ariaLabel}
      {...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {})}
      {...(props.title !== undefined ? { title: props.title } : {})}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit();
      }}
      onBlur={commit}
    />
  );
}

export interface FolderSettingProps extends TextSettingProps {
  /** The dialog's own title, which the platform shows and a user reads. */
  pickPrompt: string;
  /** Shown under the row when the chooser would not open. Never a silent failure. */
  onProblem: (reason: string | undefined) => void;
}

/**
 * A path field with the system's own folder chooser beside it.
 *
 * The picker is offered only when there is a shell to ask (`hasShellPicker()` is synchronous, so the
 * button's disabled state is known in the same tick as the click — `client/folder-picker.ts` explains
 * why that matters). A click that finds no picker, or a dialog that will not open, reports the reason
 * through `onProblem` rather than doing nothing, which is the failure the palette already learned to
 * avoid.
 */
export function FolderSetting(props: FolderSettingProps): JSX.Element {
  const { t } = useI18n();
  const pickable = hasShellPicker();

  const choose = async (): Promise<void> => {
    props.onProblem(undefined);
    const result = await pickFolder(props.pickPrompt);
    if (result.kind === "picked") {
      props.onCommit(result.path);
      return;
    }
    // A closed dialog is not an error and is not reported; one that would not open is.
    if (result.kind === "unavailable") {
      props.onProblem(
        result.cause === "no-shell" ? t("palette.noPicker") : t("palette.pickerFailed", { detail: result.reason }),
      );
    }
  };

  return (
    <div className="setting__field-group">
      <TextSetting {...props} />
      {pickable ? (
        <button type="button" className="button button--secondary button--small" onClick={() => void choose()}>
          {t("settings.folder.choose")}
        </button>
      ) : null}
    </div>
  );
}
