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
 *   * settings live where the defaults live — per project — with app-wide defaults at the foot of
 *     the rail.
 *
 * A flat list makes the second and third of those awkward and the first impossible. Since two
 * tasks can share one `cwd` (Paseo's own data-model note), grouping by *path* is also the
 * only stable key: grouping by directory contents or by session id would make the tree reshuffle
 * under the user.
 *
 * ## What this component does *not* do
 *
 * No filtering logic, no sorting, no counting: all of that is `@envoycoder/task-model`, which
 * is pure and unit-tested. This file is a renderer, so "why is this row above that one?" has one
 * answer in one place.
 */

import type { JSX } from "react";

import { GearIcon, HelpIcon, ImportIcon, PlusIcon, ServerIcon } from "./icons.js";

import { useMemo, useState } from "react";
import {
  type HarnessId,
  type Project,
  type Task,
  statusNeedsHuman,
} from "@envoycoder/protocol";
import {
  type ProjectGroup,
  type SearchFilters,
  attentionSummary,
  filterRows,
  groupByProject,
} from "@envoycoder/task-model";

import { useT } from "../i18n/context.js";
import { statusKey } from "../i18n/notice.js";

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
  onOpenCommandCenter: () => void;
  onOpenSettings: () => void;
  /**
   * What to call the machine this daemon runs on, for the Host button.
   *
   * Optional and defaulting to "This machine" so the shell can pass the real name (the mesh node's
   * label, or the host from a remote setup) when it has one; until then the button states the truth
   * rather than an empty label.
   */
  hostLabel?: string;
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
}

/** The agent a project's new tasks will use — the group header's badge. */
function harnessBadge(harness: HarnessId): string {
  switch (harness) {
    case "envoy-harness":
      return "Envoy Harness";
    case "deepseek-harness":
      return "DeepSeek";
    case "claudecode":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "copilot":
      return "Copilot";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor";
    case "pi":
      return "Pi";
    case "omp":
      return "Oh My Pi";
  }
}

export function CoderSidebar(props: CoderSidebarProps): JSX.Element {
  const t = useT();
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const [flat, setFlat] = useState(false);
  const [localQuery, setLocalQuery] = useState("");

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
          className="button button--ghost sidebar__add"
          onClick={props.onAddProject}
          title={t("sidebar.add.title")}
        >
          {t("sidebar.add")}
        </button>
        <button
          type="button"
          className="button button--ghost sidebar__command"
          onClick={props.onOpenCommandCenter}
          title={t("sidebar.command.title")}
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
        <button
          type="button"
          className="button button--ghost sidebar__viewmode"
          aria-pressed={flat}
          title={flat ? t("sidebar.view.groupBy") : t("sidebar.view.flat")}
          onClick={() => setFlat((value) => !value)}
        >
          {flat ? t("sidebar.view.group") : t("sidebar.view.list")}
        </button>
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
        ) : flat ? (
          groups
            .flatMap((group) => group.rows)
            .map((row) => (
              <TaskRow
                key={row.task.id}
                row={row}
                active={row.task.id === props.activeTaskId}
                onSelect={props.onSelect}
              />
            ))
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
                    <span className="project__label">{group.project.label}</span>
                    {group.counts.needsAttention > 0 ? (
                      <span className="badge badge--warn" title={t("sidebar.project.attention")}>
                        {group.counts.needsAttention}
                      </span>
                    ) : null}
                    <span
                      className="project__agent"
                      title={t("sidebar.project.agent")}
                    >
                      {harnessBadge(group.defaultHarness)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--icon"
                    aria-label={t("sidebar.project.settings.aria", { project: group.project.label })}
                    title={t("sidebar.project.settings")}
                    onClick={() => props.onOpenProjectSettings(group.project)}
                  >
                    ⋯
                  </button>
                </div>

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
                      <TaskRow
                        key={row.task.id}
                        row={row}
                        active={row.task.id === props.activeTaskId}
                        onSelect={props.onSelect}
                      />
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

      {/* The sidebar's tool row, in Paseo's order: the wide add-project action, then Host, Import,
          Help and Settings. Icons rather than bare words, because five text buttons at the bottom of a
          rail read as a sentence — and `Local` was never a label, it was a host with no name. */}
      <div className="sidebar__footer">
        <button
          type="button"
          className="icon-button icon-button--wide"
          onClick={props.onAddProject}
        >
          <PlusIcon />
          <span className="icon-button__label">{t("sidebar.footer.add")}</span>
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={props.onOpenSettings}
          title={t("sidebar.footer.host", { host: props.hostLabel ?? t("app.thisMachine") })}
          aria-label={t("sidebar.footer.host", { host: props.hostLabel ?? t("app.thisMachine") })}
        >
          <ServerIcon />
        </button>

        {/* Not built yet, and it says so instead of doing nothing. Paseo's Import reads another
            agent's own session store (Claude Code, Codex, …) — a daemon-side job that needs a reader
            per provider, not a button. */}
        <button
          type="button"
          className="icon-button"
          disabled
          title={t("sidebar.footer.import.title")}
          aria-label={t("sidebar.footer.import")}
        >
          <ImportIcon />
        </button>

        <button
          type="button"
          className="icon-button"
          disabled
          title={t("sidebar.footer.help.title")}
          aria-label={t("sidebar.footer.help")}
        >
          <HelpIcon />
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={props.onOpenSettings}
          title={t("sidebar.footer.settings")}
          aria-label={t("sidebar.footer.settings")}
        >
          <GearIcon />
        </button>
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
 */
function TaskRow(input: {
  row: ProjectGroup["rows"][number];
  active: boolean;
  onSelect: (taskId: string) => void;
}): JSX.Element {
  const t = useT();
  const task = input.row.task;
  const needsHuman = statusNeedsHuman(task.status);
  return (
    <button
      type="button"
      className={`task-row${input.active ? " task-row--active" : ""}`}
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
          <span className="task-row__title">{task.title}</span>
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
