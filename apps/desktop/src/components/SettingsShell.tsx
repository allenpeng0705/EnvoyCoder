/**
 * The frame every settings page renders through: a title, the way back, the daemon facts, Close, the bar
 * when there is room for it, and the scrolling body — plus the one read-only thing that belongs to the
 * frame rather than to a page.
 *
 * ## Why this is its own module, and why it is not `SettingsPane`
 *
 * The pane's levels agreed on this frame from the day the third was added, and every level passes the
 * same things to it. That is the shape of a component, not of a block of JSX inside the file that happens
 * to render them — and each restructure since (the projects page, and now the sections bar) pushed
 * `SettingsPane.tsx` past the point where this repo's own rule says to split it. So the split is along
 * the line the code already had: **rows** live in `SettingsRows.tsx`, the **sections** in
 * `SettingsNav.tsx` and `settings/`, the **frame** here, and the **pages** in `SettingsPane.tsx`.
 *
 * ## The back control, which is why the frame takes a label rather than a direction
 *
 * `back` is absent on the root (the list of sections, which has nothing above it — a back control that
 * went nowhere would be worse than none) and present on every page below it, where the label is the
 * **destination's own name**: *All settings* for the list of sections, *Projects* for a project's
 * parent. A single "Back" would be a control a user has to press to find out what it does, and a single
 * label shared by both would be a lie at one of them; both mistakes live in the *label*, which is why it
 * is a value the page supplies rather than something this frame decides.
 *
 * ## The bar is a slot, not section data
 *
 * `nav` is a `ReactNode` because the frame has no business knowing which sections exist or which one is
 * current — that is the registry's job and the scope's. The frame only decides the **layout**: with a
 * `nav` there is a column beside the body, without one the body is the whole width. The pane passes a
 * bar or nothing based on the window's shape, which is the shell's answer rather than this frame's.
 */

import type { JSX, ReactNode } from "react";

import { useI18n } from "../i18n/context.js";
import { localizeText } from "../i18n/notice.js";
import type { CoderState } from "../state/coderStore.js";

export interface SettingsShellProps {
  title: string;
  /** The pane's accessible name — the same words as the title, since one place has one name. */
  ariaLabel: string;
  state: CoderState;
  onClose: () => void;
  /**
   * Where this level came from: the label names the destination, so the control reads as the place it
   * goes rather than as a direction.
   */
  back?: { label: string; title: string; onClick: () => void } | undefined;
  /**
   * The bar, when there is room for it beside the content.
   *
   * A **slot** rather than a prop of section data: the frame is this pane's chrome, and which sections
   * exist is the registry's business, not the frame's. Absent means "the layout has no room for a
   * column", and then the sections are reachable as the page the pane is on — which is the whole reason
   * the pane is told the window's shape rather than sniffing it.
   */
  nav?: ReactNode;
  children: ReactNode;
}

export function SettingsShell(props: SettingsShellProps): JSX.Element {
  const { t } = useI18n();
  return (
    <section className={`pane${props.nav !== undefined ? " pane--sections" : ""}`} aria-label={props.ariaLabel}>
      <header className="pane__header">
        <div className="pane__title-group">
          {props.back !== undefined ? (
            <button
              type="button"
              className="button button--ghost button--small settings__back"
              title={props.back.title}
              onClick={props.back.onClick}
            >
              {/* The arrow is decoration and says nothing a screen reader needs: the name is the
                  sentence after it. Keyboard reachable like every other control in the header — it is a
                  `<button>`, so Enter and Space work, and it is first in the header's tab order. */}
              <span aria-hidden>←</span> {props.back.label}
            </button>
          ) : null}
          <h1 className="pane__title">{props.title}</h1>
          <div className="pane__meta">
            <span
              className="chip chip--quiet"
              title={props.state.hello?.stateDir ?? t("connection.none")}
            >
              {props.state.hello
                ? t("settings.stateDir", { path: shortPath(props.state.hello.stateDir) })
                : t("connection.none")}
            </span>
            <span className="chip chip--quiet" title={t("settings.daemon.title")}>
              {props.state.hello
                ? t("settings.daemon", { version: props.state.hello.version })
                : t("settings.noDaemon")}
            </span>
          </div>
        </div>
        <div className="pane__actions">
          <button type="button" className="button button--secondary" onClick={props.onClose}>
            {t("settings.close")}
          </button>
        </div>
      </header>
      {/* **The body, and the only thing in this pane that scrolls.** The `.pane` grid gives this row the
          leftover height and the header its own, so a list of forty projects moves under a header that
          stays put — measured in a real window rather than asserted here (docs/settings-parity.md §7.5).
          The bar, when there is one, is a **column of this row**, not a row of its own: it scrolls
          independently and its own width never pushes the content out of the window. */}
      <div className="settings-layout">
        {props.nav}
        <div className="settings">{props.children}</div>
      </div>
    </section>
  );
}

/**
 * The daemon's own sentences — what it could not read, and what it did about it.
 *
 * Not a setting, and deliberately below every control: it is the one part of this pane that says what
 * happened without offering a switch that pretends to fix it. A note is rendered through its key when
 * the daemon sent one, so a quarantined file is explained in German with the parse error it cited left
 * as it is.
 *
 * It belongs to the frame rather than to a level because it is a fact about the **file** this daemon read,
 * not about the scope being shown: every level renders it identically, at the bottom.
 */
export function StoreNotes(props: { notes: readonly string[] }): JSX.Element | null {
  const { t } = useI18n();
  if (props.notes.length === 0) return null;
  return (
    <>
      <h2 className="settings__heading">{t("settings.notes.heading")}</h2>
      <ul className="settings__notes">
        {props.notes.map((note) => (
          <li key={note}>{localizeText(t, note)}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * Home directories are long and the middle is the interesting part; keep the tail.
 *
 * Exported because three places share it and a second implementation would be a second answer to "how do
 * we abbreviate a path": the two chips in the frame above, the project rows on level 2, and the folder row
 * on level 3.
 */
export function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}
