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
 * list outgrows one screen, ranking moves into `@envoydev/task-model` where it can be tested
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
import type { Project } from "@envoydev/protocol";

import { useT } from "../i18n/context.js";
import { localize, type WriteFailure } from "../i18n/notice.js";
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
  /**
   * What the command needs from the user before it can run.
   *
   * `value` **seeds the field**, and it is what makes `defaultProjectPath` a setting that does
   * something rather than one the daemon stores and nobody reads. "Add project…" asks for a folder;
   * this is where the folder the user nominated in Settings arrives, so the stage opens on the place
   * they keep their work instead of asking them to paste a path they have already given us. Absent —
   * the shipped state — means the field starts empty and nothing is assumed.
   */
  needs?: { label: string; placeholder?: string; value?: string };
  /**
   * Ask for the value *without typing* — a folder picker, for the commands where one exists.
   *
   * Resolves with the value, or `null` when there is no picker here (the browser dev server, or a Linux
   * box without zenity/kdialog). `null` is not a failure: it means "fall through to `needs`", so a
   * command can offer the native chooser and still work on a machine that has none.
   */
  pick?: () => Promise<string | null>;
  /**
   * **Run it, and answer.** `undefined` is "it landed"; a `Notice` is the refusal, and the palette shows it in
   * its own status line **without closing** — so a user who mistyped a path reads why in the field they typed
   * it in, and presses again, instead of watching the dialog vanish and a strip appear above the window.
   *
   * A command that only navigates returns `undefined` and is done.
   */
  run: (value: string) => void | Promise<WriteFailure>;
}

export interface CommandCenterProps {
  open: boolean;
  onClose: () => void;
  contributions: readonly CommandContribution[];
  /**
   * Open *inside* a workflow rather than on the catalogue.
   *
   * "New task" and "Add project" are not choices between workflows — the user has already said what
   * they want, and answering with twenty rows to search through again is the friction this removes. An
   * id means "activate that row as if it had been clicked"; a prefix means "show only those rows",
   * which is how a task is started in one of several projects, where the chooser *is* the list.
   *
   * Both are plain strings, so the effect that honours them can depend on them without re-running on
   * every render and re-staging the palette mid-keystroke — which a predicate prop would have done.
   */
  initialCommandId?: string | undefined;
  initialIdPrefix?: string | undefined;
}

export function CommandCenter(props: CommandCenterProps): JSX.Element | null {
  const t = useT();
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<{ command: CommandContribution } | undefined>(undefined);
  /**
   * A restriction on the visible rows, set when the palette is opened for one workflow.
   *
   * Not a filter of the search field: the search field is the user's, and this is the shell's. Typing
   * must not lift a restriction the shell applied — nor should clearing the search restore the whole
   * catalogue halfway through starting a task.
   */
  const [subset, setSubset] = useState<{ prefix: string } | undefined>(undefined);
  /**
   * **What the last command said** — the palette's own line, at its foot.
   *
   * A refusal that arrives here is one the palette kept itself open for, so the message and the field it is
   * about are on screen together. The line used to be a prop the shell never passed (the failure went to the
   * window's strip instead), which is why `finish` above owns it now: a sink a caller can forget is a sink that
   * is not there.
   */
  const [status, setStatus] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Which intent has already been honoured for this opening — see the effect below. */
  const appliedIntent = useRef<string | undefined>(undefined);

  // Reset on close rather than on open: the palette should come back the way it was left only if
  // the user reopens it *for the same thing*, which is exactly what `stage` records. Closing is a
  // decision to do something else.
  useEffect(() => {
    if (!props.open) {
      setQuery("");
      setStage(undefined);
      setSubset(undefined);
    }
  }, [props.open]);

  /**
   * Enter the value stage for a command, **with the field seeded from `needs.value` when it has one**.
   *
   * One function rather than a `setStage`/`setQuery` pair at each of the four places a stage begins
   * (the picker that is absent, the picker that failed, the row with no picker at all, and pressing
   * Enter on the first row). Seeding at only some of them is exactly how a setting comes to work when
   * the user clicks and not when they use the keyboard — so the seeding belongs to "entering the
   * stage", not to any one caller.
   *
   * Seeding the *query* is deliberate: while a command is staged this field is the command's argument,
   * not the search box, which is why the list is replaced by the stage row. An empty seed leaves the
   * old behaviour exactly: an empty field and a confirm button that stays disabled.
   */
  const stageInto = (command: CommandContribution): void => {
    setStage({ command });
    setQuery(command.needs?.value ?? "");
  };

  /**
   * **What happens after a command runs.** One function, so the three ways a command can be started — a click,
   * the value stage's confirm, Enter on the first row — cannot disagree about what a refusal does.
   *
   * A refusal keeps the palette open and shows the daemon's sentence in its own status line: the user is still
   * holding the field they typed the wrong value into, and closing the dialog to shout from the window's top bar
   * is what made the owner call that bar *"ugly and useless"*. A command that landed closes the palette, which
   * is the only confirmation a performed action needs.
   */
  const finish = async (command: CommandContribution, value: string): Promise<void> => {
    const answer = await command.run(value);
    if (answer) {
      setStatus(localize(t, answer));
      return;
    }
    setStatus(undefined);
    props.onClose();
  };

  /**
   * Activating a row — from a click, or from the intent the shell opened the palette with.
   *
   * One function rather than two paths, because "the row the user clicked" and "the row the shell asked
   * for" must behave identically: a picker that opens for a click but not for ⌘N would be a bug nobody
   * could see in the code that claims to do this.
   */
  const activate = (row: CommandContribution): void => {
    // A command with a picker asks the operating system first: a folder chooser
    // beats pasting an absolute path, and this is the only place that knows
    // whether the picker exists on this machine.
    // **Synchronous decision first.** In a window with no shell there is no picker to
    // await, so the prompt must appear in the same tick as the click — the previous
    // version hopped through a promise to discover that, and a click that shows
    // nothing for a moment is a click a user reports as "nothing happened".
    if (row.pick && !hasShellPicker()) {
      if (row.needs) {
        stageInto({
          ...row,
          needs: { ...row.needs, label: `${row.needs.label} (${t("palette.noPicker")})` },
        });
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
          await finish(row, picked);
          return;
        }
        if (row.needs) {
          stageInto(
            why ? { ...row, needs: { ...row.needs, label: `${row.needs.label} (${why})` } } : row,
          );
        }
      })();
      return;
    }
    if (row.needs) {
      stageInto(row);
    } else {
      void finish(row, "");
    }
  };

  /**
   * Honour the intent the palette was opened with.
   *
   * Runs on open only — `stage` and `subset` are the palette's own state afterwards, so the intent
   * cannot fight the user for control of the field they are typing in.
   */
  useEffect(() => {
    if (!props.open) {
      appliedIntent.current = undefined;
      return;
    }
    // **Once per opening, not once per render.** `contributions` is rebuilt whenever the store refreshes
    // its lists, and those refreshes arrive on their own schedule — a task event from another window
    // mid-typing would otherwise re-activate the intent, clear the field the user is writing in, and
    // look like a keyboard that drops characters.
    const key = `${props.initialCommandId ?? ""}|${props.initialIdPrefix ?? ""}`;
    if (appliedIntent.current === key) return;
    appliedIntent.current = key;

    const wanted = props.initialCommandId
      ? props.contributions.find((row) => row.id === props.initialCommandId)
      : undefined;
    if (wanted) {
      setSubset(undefined);
      activate(wanted);
      return;
    }
    setSubset(props.initialIdPrefix ? { prefix: props.initialIdPrefix } : undefined);
    // `activate` is rebuilt every render by design (it closes over `t` and `props`); including it would
    // re-run this on each keystroke. The intent props are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initialCommandId, props.initialIdPrefix, props.contributions]);

  useEffect(() => {
    if (props.open) inputRef.current?.focus();
  }, [props.open, stage]);

  const rows = useMemo(() => {
    const text = (stage ? "" : query).trim().toLowerCase();
    const matching = props.contributions.filter((row) => {
      if (subset && !row.id.startsWith(subset.prefix)) return false;
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
  }, [props.contributions, query, stage, subset]);

  if (!props.open) return null;

  const submit = (): void => {
    if (stage) {
      void finish(stage.command, query);
      return;
    }
    const first = rows[0]?.[1][0];
    if (!first) return;
    if (first.needs) stageInto(first);
    else void finish(first, "");
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
                        onClick={() => activate(row)}
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
        {status ? (
          <p className="palette__status" role="status">
            {status}
          </p>
        ) : null}
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
  /** Both answer with the write's outcome, so the palette can keep itself open on a refusal — see `run`. */
  onAddProject: (path: string) => Promise<WriteFailure>;
  onNewTask: (projectId: string, title: string) => Promise<WriteFailure>;
  onNewTaskInFirstProject?: () => void;
  onOpenSettings: () => void;
  onPairPhone: () => WriteFailure;
  onToggleRail: () => void;
  onRevealTask: (taskId: string) => void;
  tasks: readonly { id: string; title: string; projectId: string }[];
  /**
   * The folder the user nominated in Settings, which seeds the "Add project" field.
   *
   * **This is the read site that makes `defaultProjectPath` an honest setting.** It sat in the schema,
   * travelled the RPC and was read by nobody until settings slice 1
   * (`docs/settings-parity.md` §7.1), and `apps/desktop/test/settings-coverage.test.ts` now fails if a
   * `CoderSettings` field loses its reader again. Optional because the key is optional on disk:
   * absent means "the field starts empty", which is not a failure.
   */
  defaultProjectPath?: string | undefined;
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
      // **The text stage the comment above promised and this row did not have.** With a picker the user
      // never sees it; without one — a browser window, or a Linux box with no zenity/kdialog — the row
      // had no `needs`, so it fell straight through to `run("")` and answered "No folder was chosen" to a
      // user who had chosen nothing because nothing was ever offered. It also means the "picker failed"
      // path has somewhere to land, instead of silently doing nothing.
      needs: {
        label: t("palette.addProject.needs"),
        placeholder: t("palette.addProject.needsPlaceholder"),
        // The settings row's folder, where there is one. Read here rather than defaulted into
        // `run`'s argument, because the user has to *see* the value before it is used: this field is
        // editable, and a confirm button that added a folder nobody could read would be the same
        // defect in the other direction. Spread rather than assigned so an unset setting leaves the
        // key off entirely — `undefined` and "no default" are the same state, and one of them is
        // visible in a debugger.
        ...(input.defaultProjectPath ? { value: input.defaultProjectPath } : {}),
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
      // No value stage: choosing this row *is* the decision, and the task's own composer is where the
      // prompt goes — the same shape as Paseo's new workspace, which opens the chat rather than asking
      // for a name first. The first message names the task (see `startNewTask` in `CoderApp`).
      run: () => input.onNewTask(project.id, ""),
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
      run: () => {
        input.onRevealTask(task.id);
        return undefined;
      },
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
      // Async like the rest, because the answer is what the palette decides on: "Pairing a phone is not built
      // yet" is a *refusal of the press*, and this is where the user pressed.
      run: async () => input.onPairPhone(),
    },
    {
      id: "view.rail",
      title: t("palette.toggleRail.title"),
      group: t("palette.group.machine"),
      kind: "action",
      keywords: ["sidebar", "hide", "show"],
      run: () => {
        input.onToggleRail();
        return undefined;
      },
    },
    {
      id: "settings.open",
      title: t("palette.settings.title"),
      subtitle: t("palette.settings.subtitle"),
      group: t("palette.group.machine"),
      kind: "action",
      keywords: ["preferences", "config"],
      run: () => {
        input.onOpenSettings();
        return undefined;
      },
    },
  );

  return rows;
}
