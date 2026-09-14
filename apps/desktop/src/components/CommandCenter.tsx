/**
 * The Command Center.
 *
 * ## Why it is not called a palette, and why it is typed
 *
 * The reference implementation's name and shape are worth keeping: contributions are registered as
 * **two kinds**, `action` (something that runs) and `choice` (something that is picked, and whose
 * selected state is part of the row), ranked, keyword-searchable, and extensible by plugins
 * (`packages/app/src/command-center/contributions.ts:20-39`). The distinction earns its keep the
 * moment there is more than one thing in the list: a user cannot tell a toggle from a button if both
 * are just rows, and a "selected" mark is the only way to show state without a second screen.
 *
 * ## Why the arguments are collected in the same input
 *
 * A command that needs a value — a directory to register, a title for a task — asks for it in the
 * **same box the user is already typing in**, rather than opening a modal with a field in it. A
 * modal on top of a palette is two overlays competing for one keystroke, and the reference
 * implementation avoids it for the same reason. The stage is visible: the row says what it wants.
 *
 * ## What is deliberately absent
 *
 * No plugins, no per-pane contributions, no fuzzy subsequence matching — the reference product
 * turned subsequence matching *off* in its own search for this surface
 * (`command-center/results.ts:129`), and this app has eight commands, not eight hundred. When the
 * list outgrows one screen, ranking moves into `@envoycoder/task-model` where it can be tested
 * like the rest of the rail's logic.
 */

import type { JSX } from "react";

import {
  hasShellPicker,
  pickFolder,
  type FolderPickResult,
} from "../client/folder-picker.js";

/** Why there is no picker here, in one short clause for the stage label. */
async function pickFolderUnavailableReason(
  t: Translator["t"],
): Promise<string | undefined> {
  const probe: FolderPickResult = await pickFolder(t("palette.addProject.pickPrompt"));
  if (probe.kind !== "unavailable") return undefined;
  return probe.cause === "no-shell"
    ? t("palette.noPicker")
    : t("palette.pickerFailed", { detail: probe.reason });
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@envoycoder/protocol";

import { useT } from "../i18n/context.js";
import type { Translator } from "../i18n/translate.js";

/** A row a user can run. `selected` only means anything for `choice`. */
export interface CommandContribution {
  id: string;
  title: string;
  subtitle?: string;
  group: string;
  kind: "action" | "choice";
  /** Extra words that should match this row without being shown. */
  keywords?: readonly string[];
  selected?: boolean;
  /** What the command needs from the user before it can run. */
  needs?: { label: string; placeholder?: string; value?: string };
  /**
   * Ask for the value *without typing* — a folder picker, for the commands where one exists.
   *
   * Resolves with the value, or `null` when there is no picker here (the browser dev server, or a Linux
   * box without zenity/kdialog). `null` is not a failure: it means "fall through to `needs`", so a
   * command can offer the native chooser and still work on a machine that has none.
   */
  pick?: () => Promise<string | null>;
  run: (value: string) => void | Promise<void>;
}

export interface CommandCenterProps {
  open: boolean;
  onClose: () => void;
  contributions: readonly CommandContribution[];
  /** Shown at the foot while an action is in flight, and on failure. */
  status?: string | undefined;
}

export function CommandCenter(props: CommandCenterProps): JSX.Element | null {
  const t = useT();
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<{ command: CommandContribution } | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on close rather than on open: the palette should come back the way it was left only if
  // the user reopens it *for the same thing*, which is exactly what `stage` records. Closing is a
  // decision to do something else.
  useEffect(() => {
    if (!props.open) {
      setQuery("");
      setStage(undefined);
    }
  }, [props.open]);

  useEffect(() => {
    if (props.open) inputRef.current?.focus();
  }, [props.open, stage]);

  const rows = useMemo(() => {
    const text = (stage ? "" : query).trim().toLowerCase();
    const matching = props.contributions.filter((row) => {
      if (!text) return true;
      return (
        row.title.toLowerCase().includes(text) ||
        (row.subtitle?.toLowerCase().includes(text) ?? false) ||
        (row.keywords?.some((word) => word.toLowerCase().includes(text)) ?? false)
      );
    });
    // Grouped, then stable within a group by the order the contributions arrived — the registrant
    // knows its own ranking, and re-sorting by a heuristic here would override it for no gain.
    const groups = new Map<string, CommandContribution[]>();
    for (const row of matching) {
      const list = groups.get(row.group);
      if (list) list.push(row);
      else groups.set(row.group, [row]);
    }
    return [...groups.entries()];
  }, [props.contributions, query, stage]);

  if (!props.open) return null;

  const submit = (): void => {
    if (stage) {
      void stage.command.run(query);
      props.onClose();
      return;
    }
    const first = rows[0]?.[1][0];
    if (!first) return;
    if (first.needs) setStage({ command: first });
    else {
      void first.run("");
      props.onClose();
    }
  };

  return (
    <div
      className="palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.title")}
      onClick={props.onClose}
    >
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        {stage ? (
          // **Entering the "value" stage used to change almost nothing on screen** — a placeholder swap
          // and one thin line of text — so clicking "Add project…" looked like a click that did nothing.
          // A staged command now says what it wants, in the same words it would use for a button.
          <div className="palette__stage-row">
            <span className="palette__stage-label">{stage.command.needs?.label ?? t("palette.value")}</span>
            <button
              type="button"
              className="button button--primary"
              onClick={submit}
              disabled={query.trim().length === 0}
            >
              {stage.command.title.replace(/…$/, "")}
            </button>
          </div>
        ) : null}
        <input
          ref={inputRef}
          className="input palette__input"
          placeholder={
            stage
              ? (stage.command.needs?.placeholder ?? stage.command.needs?.label ?? t("palette.value"))
              : t("palette.placeholder")
          }
          aria-label={stage ? (stage.command.needs?.label ?? t("palette.value")) : t("palette.search.aria")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
            if (event.key === "Escape") props.onClose();
          }}
        />
        {/* While a command is staged the list is replaced by the field and its confirm button — the
            header above already says what is being asked, so a second line of the same words is gone. */}
        {stage ? null : (
          <ul className="palette__list">
            {rows.map(([group, entries]) => (
              <li key={group} className="palette__group">
                <p className="palette__group-title">{group}</p>
                <ul>
                  {entries.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="palette__item"
                        onClick={() => {
                          // A command with a picker asks the operating system first: a folder chooser
                          // beats pasting an absolute path, and this is the only place that knows
                          // whether the picker exists on this machine.
                          // **Synchronous decision first.** In a window with no shell there is no picker to
                          // await, so the prompt must appear in the same tick as the click — the previous
                          // version hopped through a promise to discover that, and a click that shows
                          // nothing for a moment is a click a user reports as "nothing happened".
                          if (row.pick && !hasShellPicker()) {
                            if (row.needs) {
                              setStage({
                                command: {
                                  ...row,
                                  needs: { ...row.needs, label: `${row.needs.label} (${t("palette.noPicker")})` },
                                },
                              });
                              setQuery("");
                              return;
                            }
                          }
                          if (row.pick && hasShellPicker()) {
                            // **Never leave the row dead.** A picker can be absent (no shell, no
                            // zenity) or fail, and the first version of this returned silently in those
                            // cases — the row appeared to do nothing at all. Every path now ends in
                            // either a run or the text stage, and the reason is *shown* on the stage
                            // label instead of being swallowed.
                            void (async () => {
                              let picked: string | null = null;
                              let why: string | undefined;
                              try {
                                picked = await row.pick!();
                                if (picked === null) {
                                  const probed = await pickFolderUnavailableReason(t);
                                  why = probed;
                                }
                              } catch (error) {
                                why = error instanceof Error ? error.message : String(error);
                              }
                              if (picked !== null) {
                                void row.run(picked);
                                props.onClose();
                                return;
                              }
                              if (row.needs) {
                                setStage({
                                  command: why
                                    ? { ...row, needs: { ...row.needs, label: `${row.needs.label} (${why})` } }
                                    : row,
                                });
                                setQuery("");
                              }
                            })();
                            return;
                          }
                          if (row.needs) {
                            setStage({ command: row });
                            setQuery("");
                          } else {
                            void row.run("");
                            props.onClose();
                          }
                        }}
                      >
                        <strong>{row.title}</strong>
                        {row.selected ? <span className="palette__check" aria-label={t("palette.selected")} /> : null}
                        {row.subtitle ? <span className="palette__hint">{row.subtitle}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {rows.length === 0 ? <li className="palette__empty">{t("palette.empty")}</li> : null}
          </ul>
        )}
        {props.status ? <p className="palette__status">{props.status}</p> : null}
      </div>
    </div>
  );
}

/**
 * The rows the app registers.
 *
 * Built here rather than registered from four modules, because there are four of them and the
 * registry pattern would be more code than the thing it registers. The shape is what matters: when
 * a plugin surface arrives, this function becomes the built-in registry and the shape does not move.
 */
export function buildCommandContributions(input: {
  projects: readonly Project[];
  onAddProject: (path: string) => void | Promise<void>;
  onNewTask: (projectId: string, title: string) => void | Promise<void>;
  onNewTaskInFirstProject?: () => void;
  onOpenSettings: () => void;
  onPairPhone: () => void;
  onToggleRail: () => void;
  onRevealTask: (taskId: string) => void;
  tasks: readonly { id: string; title: string; projectId: string }[];
  /**
   * The window's translator.
   *
   * Taken as an argument rather than read from context inside this function, because this is not a
   * component: it is called from the shell's `useMemo`, which is where the language is already known.
   * A hook here would work by accident and break the moment the rows are built anywhere else.
   */
  t: Translator["t"];
}): CommandContribution[] {
  const { t } = input;
  const rows: CommandContribution[] = [
    {
      id: "project.add",
      title: t("palette.addProject.title"),
      subtitle: t("palette.addProject.subtitle"),
      group: t("palette.group.projects"),
      kind: "action",
      // Search keywords stay in English on purpose: they are typed synonyms for what the row does
      // ("folder", "repo"), they are never shown, and translating them would make the palette's
      // search behave differently per language for no user-visible gain.
      keywords: ["folder", "repository", "repo", "open"],
      // The native folder chooser, so adding a project is a pick rather than a paste. A cancelled
      // dialog returns null and *nothing happens* — changing your mind is not an error — while a machine
      // with no picker falls through to the text stage below.
      pick: async () => {
        // The dialog's own title is platform UI a user reads, so it is translated too.
        const picked = await pickFolder(t("palette.addProject.pickPrompt"));
        return picked.kind === "picked" ? picked.path : null;
      },
      run: (value) => input.onAddProject(value.trim()),
    },
  ];

  for (const project of input.projects) {
    rows.push({
      id: `task.new.${project.id}`,
      title: t("palette.newTask.title", { project: project.label }),
      subtitle: project.path,
      group: t("palette.group.tasks"),
      kind: "action",
      keywords: ["start", "agent", "task"],
      needs: { label: t("palette.newTask.label"), placeholder: t("palette.newTask.placeholder") },
      run: (value) => input.onNewTask(project.id, value.trim()),
    });
  }

  for (const task of input.tasks) {
    rows.push({
      id: `task.open.${task.id}`,
      title: task.title,
      subtitle: t("palette.openTask.subtitle"),
      group: t("palette.group.tasks"),
      kind: "action",
      keywords: ["jump", "go"],
      run: () => input.onRevealTask(task.id),
    });
  }

  rows.push(
    {
      id: "phone.pair",
      title: t("palette.pairPhone.title"),
      subtitle: t("palette.pairPhone.subtitle"),
      group: t("palette.group.machine"),
      kind: "action",
      keywords: ["qr", "mobile", "device"],
      run: () => input.onPairPhone(),
    },
    {
      id: "view.rail",
      title: t("palette.toggleRail.title"),
      group: t("palette.group.machine"),
      kind: "action",
      keywords: ["sidebar", "hide", "show"],
      run: () => input.onToggleRail(),
    },
    {
      id: "settings.open",
      title: t("palette.settings.title"),
      subtitle: t("palette.settings.subtitle"),
      group: t("palette.group.machine"),
      kind: "action",
      keywords: ["preferences", "config"],
      run: () => input.onOpenSettings(),
    },
  );

  return rows;
}
