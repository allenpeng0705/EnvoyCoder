/**
 * The sidebar: projects as *places*, tasks as *work in those places*.
 *
 * ## Where this design comes from, and why
 *
 * The shell (a left rail, tabs, panes, a Command Center, a composer with a queue) follows Paseo,
 * because that information architecture is the baseline users arrive with. The **project tree**
 * does not: it follows EnvoyMesh's Coding tab, on the owner's instruction, and the reason is
 * concrete — Paseo's sidebar is a list of what they call workspaces (our **tasks**) grouped by
 * project, where the group is a
 * heading; EnvoyMesh's is a *tree*, where the group is a row you can collapse, configure, and
 * that names the agent its children inherit.
 *
 * That difference earns its keep the moment there is real work in flight:
 *
 *   * the branch that matters is "is this repo busy?" — answered by a per-project rollup (status
 *     counts and the default agent) rather than by scrolling its tasks;
 *   * "new work in this repo" is a control *on the repo*, not a global button plus a project
 *     picker;
 *   * settings live where the defaults live — per project — with app-wide defaults in the title bar.
 *
 * A flat list makes the second and third of those awkward and the first impossible. Since two
 * tasks can share one `cwd` (Paseo's own data-model note), grouping by *path* is also the
 * only stable key: grouping by directory contents or by session id would make the tree reshuffle
 * under the user.
 *
 * ## What this component does *not* do
 *
 * No filtering logic, no sorting, no counting: all of that is `@envoydev/task-model`, which
 * is pure and unit-tested. This file is a renderer, so "why is this row above that one?" has one
 * answer in one place.
 */

import type { JSX } from "react";

import { GearIcon, QrIcon } from "./icons.js";
import { RowMenu } from "./RowMenu.js";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  type HarnessId,
  type HarnessSummary,
  type Project,
  type Task,
  type TaskDefaults,
  statusNeedsHuman,
} from "@envoydev/protocol";
import {
  type ProjectGroup,
  type SearchFilters,
  attentionSummary,
  filterRows,
  groupByProject,
} from "@envoydev/task-model";

import { useT } from "../i18n/context.js";
import { localize, statusKey, type Notice, type Refusal } from "../i18n/notice.js";
import { harnessBadge } from "../composer/harness-label.js";
import type { GitSnapshot } from "../state/coderStore.js";

import { ProjectAgentPicker } from "./ProjectAgentPicker.js";
import { ProjectBranches } from "./ProjectBranches.js";

export interface CoderSidebarProps {
  projects: readonly Project[];
  tasks: readonly Task[];
  activeTaskId?: string | undefined;
  /** Called when the user picks a task. */
  onSelect: (taskId: string) => void;
  /** Called when the user asks for a new task inside a project. */
  onNewTask: (projectId: string) => void;
  onAddProject: () => void;
  onOpenProjectSettings: (project: Project) => void;
  /**
   * Change a project's coding agent from the rail badge. Migrates idle tasks on the daemon.
   */
  onChangeProjectAgent?: (
    project: Project,
    defaults: TaskDefaults,
  ) => Promise<{ ok: true } | Refusal>;
  /** Per project: the repository this window last measured, when it has measured one. */
  git?: Readonly<Record<string, GitSnapshot>>;
  /** Measure a project's repository — a read, so it is never refused while a run is live. */
  onReadGit?: (projectId: string) => Promise<{ ok: true } | Refusal>;
  /** Switch a project's repository to an existing branch. */
  onGitCheckout?: (projectId: string, branch: string) => Promise<{ ok: true } | Refusal>;
  /** Create a branch in a project's repository and switch to it. */
  onGitCreateBranch?: (projectId: string, name: string) => Promise<{ ok: true } | Refusal>;
  /** Agents this daemon lists — for the project agent menu. */
  harnesses?: readonly HarnessSummary[];
  /** App-wide default agent when a project has not set its own. */
  appHarness?: HarnessId;
  /**
   * Open this project in a new window (desktop shell only).
   *
   * Same affordance as Paseo's project kebab "Open in new window": one daemon, another window
   * that lands on this project. Absent when the window has no shell to ask (browser dev).
   */
  onOpenProjectInNewWindow?: ((project: Project) => void) | undefined;
  /**
   * Take a project out of the rail.
   *
   * "Remove", not "Delete", for the same reason the task menu says Remove: the daemon drops the row and
   * archives that project's tasks (`coder.removeProject`), and nothing on disk — no folder, no file, no
   * transcript — is touched. Shell-level rather than local because the scope the settings pane is
   * showing has to fall back when the project it was showing stops existing.
   */
  onRemoveProject: (projectId: string) => void;
  /** Rename a task. The daemon stores the title (`coder.updateTask`); the row edits it in place. */
  onRenameTask: (taskId: string, title: string) => void;
  /**
   * Take a task out of the rail.
   *
   * Here and not in the pane: see `TaskRow`, and `TaskPane`'s header comment. The daemon archives it
   * (`coder.archiveTask`) — the folder, the files and the transcript on disk are untouched, which is what
   * the confirmation says.
   */
  onRemoveTask: (taskId: string) => void;
  onOpenCommandCenter: () => void;
  onOpenSettings: () => void;
  /** Mint and open Pairing — the rail-top QR beside ⌘K. */
  onShowPairing: () => void;
  /** Search box contents, owned by the shell so the Command Center can drive it too. */
  query?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
  /**
   * Why the rail has nothing to show, when that is *not* the same as having no projects.
   *
   * The empty state below used to be the only thing this rail could say, so every failure to load
   * looked like "No projects yet" — a project registered a second earlier, a daemon that answered
   * `coder.listProjects` and refused `coder.listTasks` because it was an older build, a window that
   * never reached its daemon at all. The user's conclusion in each case is the same and always wrong:
   * the app lost my work.
   *
   * Set to an already-localized sentence when the list could not be read; `undefined` means the rail
   * was actually loaded, and an empty rail then really is empty.
   */
  unavailable?: string | undefined;
  /**
   * Whether the task rows came from the daemon — see `CoderState.tasksKnown`.
   *
   * When the list could not be read, a group renders its header and no "No tasks yet" line: an empty
   * group plus a notice that names the reason is honest, and a per-project claim of emptiness is not.
   */
  tasksUnknown?: boolean | undefined;
  /**
   * **The refusal from a row's own last press, and which row it is about.**
   *
   * A press that fails shows the daemon's sentence *under the row that was pressed* — never in the bar above
   * the whole window, which names no control and has to be dismissed before the user can carry on. `rowId` is
   * the project's or the task's own id, so a removal that failed says so where the removal was asked for, and
   * the sentence leaves with the row if the row does.
   */
  failure?: { rowId: string; notice: Notice } | undefined;
  /**
   * Project this window was opened to work in (from "Open in new window").
   *
   * Other projects start collapsed so the rail lands on that project the way Paseo's new window
   * lands on the path it was given.
   */
  focusProjectId?: string | undefined;
}

/** The mark beside a project name: the first letter, upper case. */
function projectMark(label: string): string {
  const letter = label.trim().charAt(0);
  return letter === "" ? "?" : letter.toUpperCase();
}

/**
 * Ten muted fills, one per project. The index is a hash of the project id, so a rename does not
 * recolor the row and a reload does not shuffle the list. These are not status colours: green,
 * amber, red and blue already mean finished, needs you, failed and working.
 */
const MARK_TONES = ["violet", "sky", "emerald", "orange", "pink", "indigo", "teal", "red", "amber", "blue"] as const;

function projectMarkTone(id: string): (typeof MARK_TONES)[number] {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return MARK_TONES[hash % MARK_TONES.length] ?? "violet";
}

export function CoderSidebar(props: CoderSidebarProps): JSX.Element {
  const t = useT();
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const [localQuery, setLocalQuery] = useState("");
  /** Apply the landing focus once — do not fight the user if they later expand another project. */
  const focusApplied = useRef(false);

  useEffect(() => {
    if (focusApplied.current) return;
    const focusId = props.focusProjectId;
    if (!focusId) return;
    if (!props.projects.some((project) => project.id === focusId)) return;
    focusApplied.current = true;
    setCollapsed(props.projects.filter((project) => project.id !== focusId).map((project) => project.id));
  }, [props.focusProjectId, props.projects]);

  const query = props.query ?? localQuery;
  const setQuery = props.onQueryChange ?? setLocalQuery;

  const groups = useMemo(() => {
    const tree = groupByProject({
      projects: props.projects,
      tasks: props.tasks,
      activeTaskId: props.activeTaskId,
    });
    if (!query.trim()) return tree;
    const filters: SearchFilters = { text: query };
    return filterRows(tree, filters);
  }, [props.projects, props.tasks, props.activeTaskId, query]);

  const attention = useMemo(() => attentionSummary(props.tasks), [props.tasks]);

  return (
    <aside className="sidebar" aria-label={t("sidebar.aria")}>
      <div className="sidebar__top">
        <button
          type="button"
          className="button button--primary sidebar__add"
          onClick={props.onAddProject}
          title={t("sidebar.add.title")}
        >
          {t("sidebar.add")}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={props.onShowPairing}
          title={t("sidebar.pair")}
        >
          <QrIcon />
          <span className="visually-hidden">{t("sidebar.pair")}</span>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={props.onOpenSettings}
          title={t("sidebar.settings")}
          aria-label={t("sidebar.settings")}
        >
          <GearIcon />
        </button>
        <button
          type="button"
          className="button button--ghost sidebar__command"
          onClick={props.onOpenCommandCenter}
          title={t("sidebar.command.title")}
          aria-label={t("sidebar.command.title")}
        >
          ⌘K
        </button>
      </div>

      <div className="sidebar__search">
        <input
          className="input"
          value={query}
          placeholder={t("sidebar.search.placeholder")}
          aria-label={t("sidebar.search.aria")}
          onChange={(event) => setQuery(event.target.value)}
        />
        {/* Flat "List" view is deferred — grouped by project is the default and only layout for now. */}
      </div>

      {attention.badge > 0 ? (
        <div className="sidebar__attention" role="status">
          <span className="dot dot--warn" aria-hidden />
          {attention.badge === 1
            ? t("sidebar.attention.one")
            : t("sidebar.attention.many", { count: attention.badge })}
        </div>
      ) : null}

      <div className="sidebar__list" data-testid="task-list">
        {groups.length === 0 ? (
          <div className="sidebar__empty">
            {props.unavailable !== undefined ? (
              // "I could not ask" and "there is nothing" are different sentences. This is the first.
              <>
                <p className="sidebar__empty-title">{t("sidebar.empty.cannotLoadTitle")}</p>
                <p className="sidebar__empty-body">{t("sidebar.empty.cannotLoadBody")}</p>
                <p className="sidebar__empty-reason">{props.unavailable}</p>
              </>
            ) : props.projects.length === 0 ? (
              <>
                <p className="sidebar__empty-title">{t("sidebar.empty.title")}</p>
                <p className="sidebar__empty-body">{t("sidebar.empty.body")}</p>
              </>
            ) : (
              <p className="sidebar__empty-body">{t("sidebar.empty.noMatch", { query })}</p>
            )}
          </div>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.includes(group.project.id);
            return (
              <section
                key={group.project.id}
                className="project"
                data-testid={`project-${group.project.label}`}
              >
                <div className="project__header-row">
                  <button
                    type="button"
                    className="project__header"
                    aria-expanded={!isCollapsed}
                    title={group.project.path}
                    onClick={() =>
                      setCollapsed((current) =>
                        current.includes(group.project.id)
                          ? current.filter((id) => id !== group.project.id)
                          : [...current, group.project.id],
                      )
                    }
                  >
                    <span className="project__chevron" aria-hidden>
                      {isCollapsed ? "▶" : "▼"}
                    </span>
                    <span className="project__mark" data-tone={projectMarkTone(group.project.id)} aria-hidden>
                      {projectMark(group.project.label)}
                    </span>
                    <span className="project__label">{group.project.label}</span>
                    {group.counts.needsAttention > 0 ? (
                      <span className="badge badge--warn" title={t("sidebar.project.attention")}>
                        {group.counts.needsAttention}
                      </span>
                    ) : null}
                  </button>
                  {props.onChangeProjectAgent !== undefined && props.harnesses !== undefined ? (
                    <ProjectAgentPicker
                      project={group.project}
                      appHarness={props.appHarness ?? "envoy-harness"}
                      harnesses={props.harnesses}
                      appearance="rail"
                      onChoose={(defaults) => props.onChangeProjectAgent!(group.project, defaults)}
                    />
                  ) : (
                    <span className="project__agent" title={t("sidebar.project.agent")}>
                      {harnessBadge(group.defaultHarness)}
                    </span>
                  )}
                  {props.onReadGit !== undefined &&
                  props.onGitCheckout !== undefined &&
                  props.onGitCreateBranch !== undefined ? (
                    <ProjectBranches
                      project={group.project}
                      snapshot={props.git?.[group.project.id]}
                      onRead={() => props.onReadGit!(group.project.id)}
                      onCheckout={(branch) => props.onGitCheckout!(group.project.id, branch)}
                      onCreate={(name) => props.onGitCreateBranch!(group.project.id, name)}
                    />
                  ) : null}
                  {/* The row's `…`, which used to be a bare `⋯` that opened project settings and nothing
                      else — a button whose only item had to be its whole accessible name. It is a menu
                      now, and project settings is one item in it rather than the button's identity.
                      "Project settings" keeps the key it always had (`sidebar.project.settings`), so the
                      action is still named in the same words as the pane it opens. */}
                  <RowMenu
                    label={t("sidebar.project.menu.aria", { project: group.project.label })}
                    title={t("sidebar.project.menu.title")}
                    actions={[
                      {
                        id: "settings",
                        label: t("sidebar.project.settings"),
                        onSelect: () => props.onOpenProjectSettings(group.project),
                      },
                      {
                        id: "new-task",
                        label: t("sidebar.project.menu.newTask"),
                        onSelect: () => props.onNewTask(group.project.id),
                      },
                      ...(props.onOpenProjectInNewWindow
                        ? [
                            {
                              id: "open-new-window",
                              label: t("sidebar.project.menu.openNewWindow"),
                              onSelect: () => props.onOpenProjectInNewWindow?.(group.project),
                            },
                          ]
                        : []),
                    ]}
                    confirm={{
                      label: t("sidebar.project.remove"),
                      ariaLabel: t("sidebar.project.remove.aria"),
                      question: t("sidebar.project.remove.confirm", { project: group.project.label }),
                      cta: t("sidebar.project.remove.cta"),
                      onConfirm: () => props.onRemoveProject(group.project.id),
                    }}
                  />
                </div>

                {props.failure?.rowId === group.project.id ? (
                  // Under the project's own header, which is the row the press came from — the `…` menu's
                  // Remove, or the group's "+ New" — so the sentence is read where the action was asked for.
                  <p className="sidebar__failure" role="status">
                    {localize(t, props.failure.notice)}
                  </p>
                ) : null}

                {isCollapsed ? null : (
                  <>
                    <div className="project__tasks-bar">
                      <span className="project__tasks-title">{t("sidebar.section.tasks")}</span>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => props.onNewTask(group.project.id)}
                        title={t("sidebar.project.newTask.title", { project: group.project.label })}
                      >
                        {t("sidebar.project.newTask")}
                      </button>
                    </div>
                    {group.rows.map((row) => (
                      <Fragment key={row.task.id}>
                        <TaskRow
                          row={row}
                          active={row.task.id === props.activeTaskId}
                          onSelect={props.onSelect}
                          onRenameTask={props.onRenameTask}
                          onRemoveTask={props.onRemoveTask}
                        />
                        {props.failure?.rowId === row.task.id ? (
                          <p className="sidebar__failure" role="status">
                            {localize(t, props.failure.notice)}
                          </p>
                        ) : null}
                      </Fragment>
                    ))}
                    {group.rows.length === 0 && props.tasksUnknown !== true ? (
                      <p className="project__empty">{t("sidebar.tasks.empty")}</p>
                    ) : null}
                  </>
                )}
              </section>
            );
          })
        )}
      </div>
    </aside>
  );
}

/**
 * A task row.
 *
 * Anatomy, and the one deliberate choice in it: the **status is a dot first and words second**.
 * The dot answers "does this need me?" at a glance down a column of rows; the chip spells it out
 * for the row you have actually stopped on. Words on every row would make the column unreadable
 * exactly when it matters most — when ten agents are running.
 *
 * ## Why the row is a `div` with a button inside it, now
 *
 * It was a `<button>` with a `data-testid` on it, and it could not gain a menu without becoming a
 * button inside a button — invalid HTML, which browsers resolve by dropping one of the two nested
 * interactive elements and taking its click behaviour with it. So the row is the layout, `.task-row`,
 * and **selecting the task is a button inside it** (`task-row__select`) which keeps the
 * `data-testid={`task-${task.id}`}`. That placement is the point: the testid still sits on the element
 * a click has to land on to open the task, so the assertion in `sidebar.test.tsx` — click the row,
 * `onSelect` is called with this id — means exactly what it always meant.
 *
 * ## Removing a task happens here, and no longer in the pane
 *
 * `TaskPane`'s header used to carry a "Remove task" button with its own inline confirmation. It does not
 * any more: this row is where a task *is*, it is the surface the action changes (the row leaves the
 * rail), and one action with one home is better than two controls that have to be kept honest
 * separately. The wording did not move with it — the menu reuses `task.remove.*`, the very keys the pane
 * used, so the confirmation still says the same true sentence: it leaves the rail and is archived, and
 * the folder and its files are not touched.
 */
function TaskRow(input: {
  row: ProjectGroup["rows"][number];
  active: boolean;
  onSelect: (taskId: string) => void;
  onRenameTask: (taskId: string, title: string) => void;
  onRemoveTask: (taskId: string) => void;
}): JSX.Element {
  const t = useT();
  const task = input.row.task;
  const needsHuman = statusNeedsHuman(task.status);
  const name = task.title || t("task.untitled");

  /** The row is being renamed, so the title slot is a field instead of a button. */
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(task.title);
  /**
   * Escape means "keep the name it had", and blur — this field's commit path — must not then save the text
   * the user just cancelled. A ref rather than state because it has to be read *during* the blur handler
   * that runs in the same tick, before React has re-rendered anything.
   */
  const cancelled = useRef(false);
  const renameField = useRef<HTMLInputElement>(null);

  const commitRename = (): void => {
    setRenaming(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const value = draft.trim();
    // An emptied field is not a new name — it is a field somebody cleared. The app's own word for a task
    // with no title is "Untitled", but that is the state a *new* task is in and a rename is not a way to
    // get back to it, so a blank field leaves the name alone rather than storing one.
    if (value !== "" && value !== task.title) input.onRenameTask(task.id, value);
  };

  return (
    <div className={`task-row${input.active ? " task-row--active" : ""}`}>
      {renaming ? (
        <input
          ref={renameField}
          className="input task-row__rename"
          // The current title, so the user edits what the row says rather than retyping it.
          value={draft}
          autoFocus
          aria-label={t("sidebar.task.rename.aria")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
              return;
            }
            if (event.key === "Escape") {
              // Before the shell's global Escape ("stop the agent"); a user cancelling a rename must not
              // also kill a run they were not looking at.
              event.stopPropagation();
              // **The flag first, then the blur, and both on purpose.** Blur is where this field commits,
              // so cancelling has to go *through* it rather than around it: unmounting the field would
              // leave the commit path untested and would depend on whether the platform fires a blur for a
              // removed element (it does not). Handing the blur its own cancellation is the version that is
              // true on every platform — and the one a test can hold.
              cancelled.current = true;
              renameField.current?.blur();
            }
          }}
          // Committed on blur as well as Enter, on `ModelChoice`'s rule: a name typed and then clicked
          // away from is still a name the user meant.
          onBlur={commitRename}
        />
      ) : (
        <button
          type="button"
          className="task-row__select"
          onClick={() => input.onSelect(task.id)}
          data-testid={`task-${task.id}`}
        >
          <span
            className={`dot ${dotClassFor(task.status)}`}
            aria-label={t(statusKey(task.status))}
            title={t(statusKey(task.status))}
          />
          <span className="task-row__body">
            <span className="task-row__title-line">
              {/* A task created from "+ New" has no name yet — the first message becomes one. An empty
                  span here is a row a user cannot click on purpose, so the gap says what it is. */}
              <span className="task-row__title">{name}</span>
              {needsHuman ? (
                <span className="chip chip--warn">{t(statusKey(task.status))}</span>
              ) : null}
            </span>
            <span className="task-row__sub">
              <span className="task-row__harness">{harnessBadge(task.harness)}</span>
              {task.worktree ? (
                <span className="task-row__branch" title={task.worktree.path}>
                  {task.worktree.branch}
                </span>
              ) : null}
              {task.hostId && task.hostId !== "local" ? (
                <span className="chip chip--quiet">{task.hostId}</span>
              ) : null}
            </span>
          </span>
        </button>
      )}

      <RowMenu
        // The trigger names the row it acts on: "Actions for Review the migration diff", so a screen
        // reader announcing eleven of these can tell which row each one belongs to.
        label={t("sidebar.task.menu.aria", { task: name })}
        title={t("sidebar.task.menu.title")}
        actions={[
          {
            id: "rename",
            label: t("sidebar.task.rename"),
            onSelect: () => {
              // Cleared as the edit *starts*, not only where the commit consumes it: the guard is spent by
              // the commit it cancels, and an edit that ended without one — a field that was never focused,
              // a row unmounted mid-edit — must not leave a flag that swallows the next rename's commit.
              cancelled.current = false;
              setDraft(task.title);
              setRenaming(true);
            },
          },
        ]}
        confirm={{
          label: t("task.remove"),
          ariaLabel: t("task.remove.aria"),
          question: t("task.remove.confirm", { title: name }),
          cta: t("task.remove.cta"),
          onConfirm: () => input.onRemoveTask(task.id),
        }}
      />
    </div>
  );
}

function dotClassFor(status: Task["status"]): string {
  switch (status) {
    case "running":
      return "dot--running";
    case "needs-attention":
      return "dot--warn";
    case "failed":
      return "dot--danger";
    case "done":
      return "dot--ok";
    case "queued":
      return "dot--queued";
    case "idle":
    case "cancelled":
      return "dot--quiet";
  }
}
