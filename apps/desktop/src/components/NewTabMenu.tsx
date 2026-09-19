/**
 * The plus on the tab row: Task, Terminal, Browser.
 *
 * Task is a new conversation in this project — the same thing "+ New" already does, not a second
 * kind of object. Terminal and Browser are tabs beside the chat. Escape closes the menu and does
 * not stop the agent: the shell's global Escape is "stop the run", and dismissing a menu must not
 * do that.
 */

import type { JSX, KeyboardEvent } from "react";

import { useEffect, useRef, useState } from "react";

import { useT } from "../i18n/context.js";
import { PlusIcon } from "./icons.js";

export function NewTabMenu(props: {
  taskEnabled: boolean;
  onTask: () => void;
  onTerminal: () => void;
  onBrowser: () => void;
  onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  function setMenu(next: boolean): void {
    setOpen(next);
    props.onOpenChange?.(next);
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      event.preventDefault();
      setMenu(false);
    }
  };

  function choose(action: () => void): void {
    setMenu(false);
    action();
  }

  return (
    <div className="work__add" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="work__add-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("work.newTab")}
        title={t("work.newTab")}
        onClick={() => setMenu(!open)}
      >
        <PlusIcon size={14} />
      </button>
      {open ? (
        <div className="row-menu__list work__add-menu" role="menu" aria-label={t("work.newTab")}>
          <button
            type="button"
            role="menuitem"
            className="row-menu__item"
            disabled={!props.taskEnabled}
            onClick={() => choose(props.onTask)}
          >
            {t("work.new.task")}
          </button>
          <button type="button" role="menuitem" className="row-menu__item" onClick={() => choose(props.onTerminal)}>
            {t("work.new.terminal")}
          </button>
          <button type="button" role="menuitem" className="row-menu__item" onClick={() => choose(props.onBrowser)}>
            {t("work.new.browser")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
