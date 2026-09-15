/**
 * The three shapes every settings row is built from: **a row**, **a row that goes somewhere**, and
 * **a field that commits**.
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
import { localize, type Notice, type WriteFailure } from "../i18n/notice.js";
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
  /**
   * The control — **or a function that is handed `write`**, when the control writes a setting.
   *
   * ## Why a write is a function of the row rather than a callback the row cannot see
   *
   * A refusal used to be raised globally: every write also stored its sentence in `state.error`, which the
   * shell rendered in the bar across the top of the window. The owner read one of those — for the
   * catalogue's *Add*, which had already said the same thing on the row — and named it: *"it will show the
   * top bar which is ugly and useless"*. A strip above every surface cannot say **which** control failed and
   * has to be dismissed before the user can carry on.
   *
   * So the store raises nothing (`CoderStore.mutate`) and each press answers where it was made. For a
   * settings row, "where it was made" is the row — and the only way to get a `write` is from the row that
   * renders the failure, so a control that writes **cannot** be rendered without one. That is why this is a
   * function rather than a context: a context has a default, a default is a failure nobody sees, and
   * `<TextSetting>` dropped outside a row would then swallow its own refusal silently.
   */
  children: JSX.Element | ((write: RowWrite) => JSX.Element);
}

/**
 * **How a row's control performs a write.** Hand it the promise the write returned; the row renders the
 * refusal under the control, or clears it when the write lands.
 *
 * `Promise<WriteFailure>` and not `Refusal | { ok: true }`: the store methods already answer in that shape,
 * so a call site reads `write(props.onUpdate({ … }))` and nothing in between can forget the `ok` check.
 */
export type RowWrite = (answer: Promise<WriteFailure> | void) => void;

export function SettingRow(props: SettingRowProps): JSX.Element {
  const { t } = useI18n();
  /** The refusal from this row's own last write, if it had one. */
  const [failure, setFailure] = useState<Notice | undefined>(undefined);
  const write: RowWrite = (answer) => {
    // A caller that answered **nothing** — a section rendered without a writer, a test double — has no failure
    // to report, and inventing one would be worse than silence. Everything in this window returns a real
    // promise; this is the guard that keeps a missing one from crashing the pane instead.
    if (typeof answer !== "object" || answer === null) return;
    // A write that lands **clears** the previous refusal: the value on screen is now the stored one, and a
    // sentence about the attempt before last is a claim about a state the user has already moved past.
    void answer.then((notice) => setFailure(notice));
  };
  const control = typeof props.children === "function" ? props.children(write) : props.children;

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
      <div className="setting__control">
        {control}
        {failure ? (
          // `role="status"` and not an alert: the write did not land, which the user needs to read — but it is
          // not an emergency, and the value on screen still shows what they chose.
          <p className="setting__failure" role="status">
            {localize(t, failure)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A row that **goes** somewhere, in the same two bands as a setting's.
 *
 * The reference product's app settings carry a list of projects whose rows are the way into each
 * project's own settings, and the shape is worth keeping for a reason beyond parity: the bands are the
 * pane's (`setting__title` over `setting__detail`) so a project reads exactly like the settings above
 * it, and the *whole row* is the control, so "select the project" is one click anywhere in the row
 * rather than a hunt for a button at the end of it.
 *
 * Three things are deliberately different from `SettingRow`, and each is a decision:
 *
 *   * **The control is the row.** A setting pairs a description with a control on the right; nothing on
 *     the right of a project row would be honest — selecting the row *is* the action — and a `<p>`
 *     inside a `<button>` is invalid HTML, so the bands are `<span>`s and CSS gives them the layout the
 *     `<p>`s get above (`display: block`, in `styles.css`).
 *   * **`actionLabel` names where the row goes**, and it is the *destination's own title* at the call
 *     site ("Project settings for api"). A row whose accessible name is only its label ("api") leaves a
 *     screen-reader user to guess what pressing it does; this one reads as the pane they land on. The
 *     visible label is a prefix of it, so the visible words are still announced.
 *   * **A muted `›` on the right**, `aria-hidden`. A row with nothing at its end reads as text; the
 *     chevron is the smallest honest way to say "this one navigates" — and it is *not* the sidebar's
 *     `▶`/`▼`, which means disclosure rather than movement.
 *
 * `developerNote` is the developer fact in the title attribute, on the same rule as `SettingRow`. Here
 * that fact is the row's **id** rather than a field path: a list of registrations is exactly where
 * "which one is this?" stops being answerable from the label.
 */
export interface SettingNavRowProps {
  title: string;
  detail: string;
  /** The whole of what `detail` abbreviates — a path, usually — shown on hover. */
  detailTitle?: string;
  developerNote: string;
  /** The row's accessible name. It must name where the row *goes*, not only what it shows. */
  actionLabel: string;
  onSelect: () => void;
}

export function SettingNavRow(props: SettingNavRowProps): JSX.Element {
  return (
    <button
      type="button"
      className="setting setting--nav"
      title={props.developerNote}
      aria-label={props.actionLabel}
      onClick={props.onSelect}
    >
      <span className="setting__text">
        <span className="setting__title">{props.title}</span>
        <span
          className="setting__detail"
          {...(props.detailTitle !== undefined ? { title: props.detailTitle } : {})}
        >
          {props.detail}
        </span>
      </span>
      <span className="setting__chevron" aria-hidden>
        ›
      </span>
    </button>
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
  // Named for what it asks rather than `pickable`, which is now the name of nothing: the agent pickers'
  // rule lives in `composer/agent-for.ts` and a local of that name here read like a second copy of it.
  const canPick = hasShellPicker();

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
      {canPick ? (
        <button type="button" className="button button--secondary button--small" onClick={() => void choose()}>
          {t("settings.folder.choose")}
        </button>
      ) : null}
    </div>
  );
}
