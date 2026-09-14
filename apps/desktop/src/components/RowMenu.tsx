/**
 * A row's `…` menu — the first menu in this app, so this file is where the furniture lives.
 *
 * ## Why one component rather than a menu per surface
 *
 * A project row and a task row ask the same question — *what can I do to this row?* — and the answer
 * differs only in the items. Everything else is identical and is exactly the part that goes wrong when
 * it is written twice: where focus goes when the menu opens, what Escape does, whether a click outside
 * closes it, whether choosing an item closes it. Two copies of that is two chances for the rail to
 * behave differently from the rest of the app for no reason a user could predict.
 *
 * ## The keyboard contract, which is the reason this is not a `div` with `onClick`
 *
 *   * **Open** with Enter or Space (a native button's own activation) or with ArrowDown/ArrowUp, which
 *     open *and* land on the first or last item — the WAI-ARIA menu-button pattern, so a keyboard user
 *     does not have to open a menu and then hunt for its first item.
 *   * **Move** with ArrowDown/ArrowUp, cycling, and Home/End for the ends.
 *   * **Escape closes** and returns focus to the trigger it came from. That is where the user was
 *     before they opened it, and leaving focus on a removed popover strands them at the top of the
 *     document. `stopPropagation` is part of the contract rather than tidiness: the shell binds Escape
 *     globally to "stop the agent" (`input/useShortcuts.ts`), and a user pressing Escape to dismiss a
 *     menu must not kill a run they were not looking at.
 *   * **Choosing an item closes** the menu, except for the destructive one, which asks in place.
 *
 * ## The destructive item, and design law 3
 *
 * The colour of destruction (`--destructive`) appears **only inside the confirmation** — never on the
 * row, and never on the menu item itself. So `Remove…` in the list is an ordinary item, and choosing it
 * replaces the list **in the same popover, over the same row** with a question. In place, not in a
 * modal: the family rule is that a decision shows the context it is made in, and the context here is the
 * row the question is about, which is still on screen behind the panel.
 *
 * The question's *wording* is not this component's: it is handed in already translated, because this
 * component knows where the question goes and the caller knows what it means.
 */

import type { JSX, KeyboardEvent } from "react";

import { useEffect, useRef, useState } from "react";

import { useT } from "../i18n/context.js";
import { EllipsisIcon } from "./icons.js";

/** One ordinary item: it does its thing and the menu closes. */
export interface RowMenuAction {
  /** Stable identity, so React keeps the elements in place when the list changes. */
  id: string;
  /** Already translated — this component renders labels, it does not word them. */
  label: string;
  onSelect: () => void;
}

/**
 * The destructive item, with the question it has to ask first.
 *
 * Separate from `RowMenuAction` rather than a flag on it, because the difference is not cosmetic: this
 * one cannot be chosen without a second, explicit decision, and it is the only thing in this file
 * allowed to wear the destructive colour.
 */
export interface RowMenuConfirm {
  /** The item in the menu list, e.g. "Remove project". */
  label: string;
  /** The accessible name of the question block, e.g. "Remove this project". */
  ariaLabel: string;
  /** The question, in the user's language, saying what removing actually does. */
  question: string;
  /** The destructive button's label, shown only after the question. */
  cta: string;
  /** Run **only** once the user has confirmed. */
  onConfirm: () => void;
}

export interface RowMenuProps {
  /**
   * The trigger's accessible name, naming **what this menu acts on**.
   *
   * `aria-label` rather than visible text: the button is an icon, and "Actions for payments-api" is the
   * difference between eleven buttons a screen reader can tell apart and eleven it cannot.
   */
  label: string;
  /** The tooltip, in the same words as the accessible name's action. */
  title: string;
  actions: readonly RowMenuAction[];
  /** The destructive item and its question. Omitted for a menu with nothing destructive in it. */
  confirm?: RowMenuConfirm | undefined;
}

export function RowMenu(props: RowMenuProps): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  /** The destructive item has been chosen; the popover is showing the question instead of the list. */
  const [asking, setAsking] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** Where focus lands when the menu opens: the first item, or the last for ArrowUp. */
  const landOnLast = useRef(false);

  const items = props.actions;
  const confirm = props.confirm;

  const close = (returnFocus = true): void => {
    setOpen(false);
    setAsking(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const openMenu = (last: boolean): void => {
    landOnLast.current = last;
    setAsking(false);
    setOpen(true);
  };

  // Focus on open, and on the swap from list to question. The question block takes focus itself
  // (`tabIndex={-1}`) rather than its destructive button: a dialog that greets the user with focus on
  // "Remove" is a dialog that removes something on a stray Return.
  useEffect(() => {
    if (!open) return;
    if (asking) {
      dialogRef.current?.focus();
      return;
    }
    const buttons = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    if (buttons.length === 0) return;
    buttons[landOnLast.current ? buttons.length - 1 : 0]?.focus();
  }, [open, asking]);

  // Dismissal on an outside press. Both events, because a mouse fires `pointerdown` *and* `mousedown`
  // while a touch fires only the first — and closing twice is a no-op. Capture phase, so a handler on
  // something the panel overlaps cannot swallow the press first.
  useEffect(() => {
    if (!open) return;
    const onPress = (event: Event): void => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("mousedown", onPress, true);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("mousedown", onPress, true);
    };
    // `close` is re-created every render and is deliberately not a dependency: it only sets state and
    // focuses a ref, so the copy this effect captured behaves identically to a fresh one, and depending on
    // it would detach and re-attach the listeners on every render.
  }, [open]);

  /** Focus movement among the items, from wherever the keystroke happened inside the panel. */
  const moveFocus = (step: 1 | -1 | "first" | "last"): void => {
    const buttons = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    if (buttons.length === 0) return;
    if (step === "first") {
      buttons[0]?.focus();
      return;
    }
    if (step === "last") {
      buttons[buttons.length - 1]?.focus();
      return;
    }
    const current = buttons.findIndex((button) => button === document.activeElement);
    // Cycling, because a menu is a loop: ArrowDown on the last item returning to the first is what
    // every menu does, and stopping dead reads as "there is more below" when there is not.
    const next = current < 0 ? 0 : (current + step + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && open) {
      // Before the shell's global Escape ("stop the agent") ever sees it. See the header comment.
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab" && open) {
      // Tab is "leave", not "dismiss": the next control should get focus, so this closes without
      // pulling focus back to the trigger.
      close(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu(event.key === "ArrowUp");
        return;
      }
      if (!asking) moveFocus(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (open && !asking && event.key === "Home") {
      event.preventDefault();
      moveFocus("first");
      return;
    }
    if (open && !asking && event.key === "End") {
      event.preventDefault();
      moveFocus("last");
    }
  };

  return (
    <div className="row-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className="button button--ghost button--icon row-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.label}
        title={props.title}
        onClick={() => (open ? close() : openMenu(false))}
      >
        <EllipsisIcon />
      </button>

      {open ? (
        asking && confirm ? (
          <div
            className="confirm row-menu__confirm"
            role="alertdialog"
            aria-label={confirm.ariaLabel}
            tabIndex={-1}
            ref={dialogRef}
          >
            <p className="confirm__question">{confirm.question}</p>
            <div className="confirm__actions">
              {/* The one place the destructive colour is allowed to exist (design law 3). */}
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  // Closed *before* the action runs: the action usually removes the row this menu
                  // hangs off, and a popover that lingered over a deleted row — or tried to return
                  // focus to a trigger that no longer exists — would be a ghost.
                  close(false);
                  confirm.onConfirm();
                }}
              >
                {confirm.cta}
              </button>
              <button type="button" className="button button--secondary" onClick={() => close()}>
                {t("action.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="row-menu__list" role="menu" aria-label={props.label}>
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="row-menu__item"
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
            {confirm ? (
              <button
                type="button"
                role="menuitem"
                className="row-menu__item"
                ref={(node) => {
                  itemRefs.current[items.length] = node;
                }}
                // Not `button--danger` and not red: choosing this asks a question. The colour arrives
                // with the question, in the panel above.
                onClick={() => setAsking(true)}
              >
                {confirm.label}
              </button>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
