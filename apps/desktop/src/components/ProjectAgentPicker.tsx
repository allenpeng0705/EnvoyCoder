/**
 * Agent picker — one menu, two writers.
 *
 * The chrome is shared: click the badge, pick an agent. The rail writes `project.defaults.harness`
 * (the default *new* tasks start with). The task header writes `task.harness` via `updateTask`, so
 * two tasks in one project can run different agents.
 */

import type { JSX, KeyboardEvent } from "react";

import { useEffect, useRef, useState } from "react";

import type { AgentId, AgentProviderSummary, CatalogEntry, HarnessSummary, Project, TaskDefaults } from "@envoydev/protocol";
import { isHarnessId } from "@envoydev/protocol";

import { mergeOfferedAgents } from "../composer/agent-for.js";
import { harnessBadge, harnessLabel } from "../composer/harness-label.js";
import { useI18n } from "../i18n/context.js";
import type { MessageKey } from "../i18n/messages/en.js";
import type { Refusal } from "../i18n/notice.js";
import { localize } from "../i18n/notice.js";

export interface AgentPickerProps {
  current: AgentId;
  harnesses: readonly HarnessSummary[];
  /** Providers the user added. They join the same picker as the nine. */
  providers?: readonly AgentProviderSummary[];
  /** Catalogue recipes — choosing one auto-Adds on the daemon. */
  catalog?: readonly CatalogEntry[];
  /**
   * Trigger face: `meta` for the task header link style, `rail` for the project row badge.
   */
  appearance: "meta" | "rail";
  ariaKey: MessageKey;
  titleKey: MessageKey;
  menuKey: MessageKey;
  onChoose: (harness: AgentId) => Promise<{ ok: true } | Refusal>;
}

/** Resolved project agent: project default → app default. */
export function resolvedProjectHarness(project: Project, appHarness: AgentId): AgentId {
  return project.defaults?.harness ?? appHarness;
}

function agentFace(id: AgentId, rows: readonly { id: string; label: string }[]): string {
  if (isHarnessId(id)) return harnessBadge(id);
  const found = rows.find((row) => row.id === id);
  const label = found?.label ?? id;
  return label.length <= 16 ? label : label.slice(0, 16);
}

function agentName(id: AgentId, rows: readonly { id: string; label: string }[]): string {
  return rows.find((row) => row.id === id)?.label ?? (isHarnessId(id) ? harnessLabel(id) : id);
}

export function AgentPicker(props: AgentPickerProps): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const available = mergeOfferedAgents({
    harnesses: props.harnesses,
    ...(props.providers !== undefined ? { providers: props.providers } : {}),
    ...(props.catalog !== undefined ? { catalog: props.catalog } : {}),
  });

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

  const choose = async (harness: AgentId): Promise<void> => {
    if (harness === props.current || busy) {
      close();
      return;
    }
    setBusy(true);
    setNotice(undefined);
    const result = await props.onChoose(harness);
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
        aria-label={t(props.ariaKey, { agent: agentName(props.current, available) })}
        title={t(props.titleKey)}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((was) => !was);
        }}
      >
        {agentFace(props.current, available)}
      </button>
      {open ? (
        <div className="project-agent-picker__menu row-menu__list" role="menu" aria-label={t(props.menuKey)}>
          {available.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className="row-menu__item"
              aria-current={entry.id === props.current ? "true" : undefined}
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

export interface ProjectAgentPickerProps {
  project: Project;
  /** App-wide default, used when the project has not set its own harness. */
  appHarness: AgentId;
  harnesses: readonly HarnessSummary[];
  providers?: readonly AgentProviderSummary[];
  catalog?: readonly CatalogEntry[];
  appearance: "meta" | "rail";
  /** Write project defaults whole (replace semantics) — caller spreads current defaults + harness. */
  onChoose: (defaults: TaskDefaults) => Promise<{ ok: true } | Refusal>;
}

/** The rail (and settings) control: the default new tasks in this project start with. */
export function ProjectAgentPicker(props: ProjectAgentPickerProps): JSX.Element {
  const current = resolvedProjectHarness(props.project, props.appHarness);
  const defaults = props.project.defaults ?? {};
  return (
    <AgentPicker
      current={current}
      harnesses={props.harnesses}
      {...(props.providers !== undefined ? { providers: props.providers } : {})}
      {...(props.catalog !== undefined ? { catalog: props.catalog } : {})}
      appearance={props.appearance}
      ariaKey="project.agent.picker.aria"
      titleKey="project.agent.picker.title"
      menuKey="project.agent.picker.menu"
      onChoose={(harness) => props.onChoose({ ...defaults, harness })}
    />
  );
}
