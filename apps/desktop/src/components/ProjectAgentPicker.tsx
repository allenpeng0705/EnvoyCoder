/**
 * Project agent picker — the one control that chooses which coding agent a project uses.
 *
 * Opens as a small menu on the agent label (task header or project rail). Picking an agent writes
 * `project.defaults.harness` via `updateProject`; the daemon migrates idle tasks onto that agent so
 * the rail and the pane never disagree.
 */

import type { JSX, KeyboardEvent } from "react";

import { useEffect, useRef, useState } from "react";

import type { HarnessId, HarnessSummary, Project, TaskDefaults } from "@envoydev/protocol";

import { offeredAgents } from "../composer/agent-for.js";
import { harnessBadge, harnessLabel } from "../composer/harness-label.js";
import { useI18n } from "../i18n/context.js";
import type { Refusal } from "../i18n/notice.js";
import { localize } from "../i18n/notice.js";

export interface ProjectAgentPickerProps {
  project: Project;
  /** App-wide default, used when the project has not set its own harness. */
  appHarness: HarnessId;
  harnesses: readonly HarnessSummary[];
  /**
   * Trigger face: `meta` for the task header link style, `rail` for the project row badge.
   */
  appearance: "meta" | "rail";
  /** Write project defaults whole (replace semantics) — caller spreads current defaults + harness. */
  onChoose: (defaults: TaskDefaults) => Promise<{ ok: true } | Refusal>;
}

/** Resolved project agent: project default → app default. */
export function resolvedProjectHarness(project: Project, appHarness: HarnessId): HarnessId {
  return project.defaults?.harness ?? appHarness;
}

export function ProjectAgentPicker(props: ProjectAgentPickerProps): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const current = resolvedProjectHarness(props.project, props.appHarness);
  const available = offeredAgents(props.harnesses);
  const defaults = props.project.defaults ?? {};

  const close = (returnFocus = true): void => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const buttons = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    buttons[0]?.focus();
  }, [open]);

  const choose = async (harness: HarnessId): Promise<void> => {
    if (harness === current || busy) {
      close();
      return;
    }
    setBusy(true);
    setNotice(undefined);
    const result = await props.onChoose({ ...defaults, harness });
    setBusy(false);
    if (!result.ok) {
      setNotice(localize(t, result) ?? result.message);
      return;
    }
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && open) {
      event.preventDefault();
      const buttons = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
      if (buttons.length === 0) return;
      const currentIndex = buttons.findIndex((button) => button === document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = currentIndex < 0 ? 0 : (currentIndex + step + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };

  const triggerClass =
    props.appearance === "meta" ? "pane__meta-link project-agent-picker__trigger" : "project__agent project-agent-picker__trigger";

  return (
    <div className="project-agent-picker" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("project.agent.picker.aria", { agent: harnessLabel(current) })}
        title={t("project.agent.picker.title")}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((was) => !was);
        }}
      >
        {harnessBadge(current)}
      </button>
      {open ? (
        <div className="project-agent-picker__menu row-menu__list" role="menu" aria-label={t("project.agent.picker.menu")}>
          {available.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className="row-menu__item"
              aria-current={entry.id === current ? "true" : undefined}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              onClick={(event) => {
                event.stopPropagation();
                void choose(entry.id);
              }}
            >
              {entry.label}
            </button>
          ))}
          {notice !== undefined ? (
            <p className="project-agent-picker__notice" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
