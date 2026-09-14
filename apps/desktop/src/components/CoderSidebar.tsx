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
  statusLabel,
} from "@envoycoder/task-model";

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
    <aside className="sidebar" aria-label="Projects and tasks">
      <div className="sidebar__top">
        <button
          type="button"
          className="button button--ghost sidebar__add"
          onClick={props.onAddProject}
          title="Register a directory as a project"
        >
          + Add project
        </button>
        <button
          type="button"
          className="button button--ghost sidebar__command"
          onClick={props.onOpenCommandCenter}
          title="Open the Command Center"
        >
          ⌘K
        </button>
      </div>

      <div className="sidebar__search">
        <input
          className="input"
          value={query}
          placeholder="Search tasks, repos, paths"
          aria-label="Search tasks, repositories and paths"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="button button--ghost sidebar__viewmode"
          aria-pressed={flat}
          title={flat ? "Group by project" : "One flat list, newest first"}
          onClick={() => setFlat((value) => !value)}
        >
          {flat ? "Group" : "List"}
        </button>
      </div>

      {attention.badge > 0 ? (
        <div className="sidebar__attention" role="status">
          <span className="dot dot--warn" aria-hidden />
          {attention.badge === 1
            ? "1 task needs you"
            : `${attention.badge} tasks need you`}
        </div>
      ) : null}

      <div className="sidebar__list" data-testid="task-list">
        {groups.length === 0 ? (
          <div className="sidebar__empty">
            {props.projects.length === 0 ? (
              <>
                <p className="sidebar__empty-title">No projects yet</p>
                <p className="sidebar__empty-body">
                  Add a directory you work in. Tasks you start in it appear here, and the project
                  remembers which agent they should use.
                </p>
              </>
            ) : (
              <p className="sidebar__empty-body">Nothing matches “{query}”.</p>
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
                      <span className="badge badge--warn" title="Tasks waiting on you">
                        {group.counts.needsAttention}
                      </span>
                    ) : null}
                    <span
                      className="project__agent"
                      title="The agent new tasks in this project start with"
                    >
                      {harnessBadge(group.defaultHarness)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--icon"
                    aria-label={`Project settings for ${group.project.label}`}
                    title="Project settings"
                    onClick={() => props.onOpenProjectSettings(group.project)}
                  >
                    ⋯
                  </button>
                </div>

                {isCollapsed ? null : (
                  <>
                    <div className="project__tasks-bar">
                      <span className="project__tasks-title">Tasks</span>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => props.onNewTask(group.project.id)}
                        title={`Start a task in ${group.project.label}`}
                      >
                        + New
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
                    {group.rows.length === 0 ? (
                      <p className="project__empty">No tasks here yet.</p>
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
          <span className="icon-button__label">Add project</span>
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={props.onOpenSettings}
          title={`Host: ${props.hostLabel ?? "This machine"}`}
          aria-label={`Host: ${props.hostLabel ?? "This machine"}`}
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
          title="Importing a session from another agent's history is not built yet — it needs a reader per agent."
          aria-label="Import a session (not built yet)"
        >
          <ImportIcon />
        </button>

        <button
          type="button"
          className="icon-button"
          disabled
          title="No help surface yet: the shortcut registry exists, the help sheet does not."
          aria-label="Help and support (not built yet)"
        >
          <HelpIcon />
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={props.onOpenSettings}
          title="Settings"
          aria-label="Settings"
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
        aria-label={statusLabel(task.status)}
        title={statusLabel(task.status)}
      />
      <span className="task-row__body">
        <span className="task-row__title-line">
          <span className="task-row__title">{task.title}</span>
          {needsHuman ? (
            <span className="chip chip--warn">{statusLabel(task.status)}</span>
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
