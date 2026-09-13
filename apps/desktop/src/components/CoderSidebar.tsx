/**
 * The sidebar: projects as *places*, workspaces as *work in those places*.
 *
 * ## Where this design comes from, and why
 *
 * The shell (a left rail, tabs, panes, a Command Center, a composer with a queue) follows Paseo,
 * because that information architecture is the baseline users arrive with. The **project tree**
 * does not: it follows EnvoyMesh's Coding tab, on the owner's instruction, and the reason is
 * concrete — Paseo's sidebar is a list of workspaces grouped by project, where the group is a
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
 * workspaces can share one `cwd` (Paseo's own data-model note), grouping by *path* is also the
 * only stable key: grouping by directory contents or by session id would make the tree reshuffle
 * under the user.
 *
 * ## What this component does *not* do
 *
 * No filtering logic, no sorting, no counting: all of that is `@envoycoder/workspace-model`, which
 * is pure and unit-tested. This file is a renderer, so "why is this row above that one?" has one
 * answer in one place.
 */

import type { JSX } from "react";

import { useMemo, useState } from "react";
import {
  type HarnessId,
  type Project,
  type Workspace,
  statusNeedsHuman,
} from "@envoycoder/protocol";
import {
  type ProjectGroup,
  type SearchFilters,
  attentionSummary,
  filterRows,
  groupByProject,
  statusLabel,
} from "@envoycoder/workspace-model";

export interface CoderSidebarProps {
  projects: readonly Project[];
  workspaces: readonly Workspace[];
  activeWorkspaceId?: string | undefined;
  /** Called when the user picks a workspace. */
  onSelect: (workspaceId: string) => void;
  /** Called when the user asks for a new task inside a project. */
  onNewWorkspace: (projectId: string) => void;
  onAddProject: () => void;
  onOpenProjectSettings: (project: Project) => void;
  onOpenCommandCenter: () => void;
  onOpenSettings: () => void;
  /** Search box contents, owned by the shell so the Command Center can drive it too. */
  query?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
}

/** The agent a project's new workspaces will use — the group header's badge. */
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
      workspaces: props.workspaces,
      activeWorkspaceId: props.activeWorkspaceId,
    });
    if (!query.trim()) return tree;
    const filters: SearchFilters = { text: query };
    return filterRows(tree, filters);
  }, [props.projects, props.workspaces, props.activeWorkspaceId, query]);

  const attention = useMemo(() => attentionSummary(props.workspaces), [props.workspaces]);

  return (
    <aside className="sidebar" aria-label="Projects and workspaces">
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

      <div className="sidebar__list" data-testid="workspace-list">
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
              <WorkspaceRow
                key={row.workspace.id}
                row={row}
                active={row.workspace.id === props.activeWorkspaceId}
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
                    <div className="project__workspaces-bar">
                      <span className="project__workspaces-title">Workspaces</span>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => props.onNewWorkspace(group.project.id)}
                        title={`Start a task in ${group.project.label}`}
                      >
                        + New
                      </button>
                    </div>
                    {group.rows.map((row) => (
                      <WorkspaceRow
                        key={row.workspace.id}
                        row={row}
                        active={row.workspace.id === props.activeWorkspaceId}
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

      <div className="sidebar__footer">
        <button type="button" className="button button--ghost" onClick={props.onOpenSettings}>
          Settings
        </button>
        <span className="sidebar__footer-hint">Local</span>
      </div>
    </aside>
  );
}

/**
 * A workspace row.
 *
 * Anatomy, and the one deliberate choice in it: the **status is a dot first and words second**.
 * The dot answers "does this need me?" at a glance down a column of rows; the chip spells it out
 * for the row you have actually stopped on. Words on every row would make the column unreadable
 * exactly when it matters most — when ten agents are running.
 */
function WorkspaceRow(input: {
  row: ProjectGroup["rows"][number];
  active: boolean;
  onSelect: (workspaceId: string) => void;
}): JSX.Element {
  const workspace = input.row.workspace;
  const needsHuman = statusNeedsHuman(workspace.status);
  return (
    <button
      type="button"
      className={`workspace-row${input.active ? " workspace-row--active" : ""}`}
      onClick={() => input.onSelect(workspace.id)}
      data-testid={`workspace-${workspace.id}`}
    >
      <span
        className={`dot ${dotClassFor(workspace.status)}`}
        aria-label={statusLabel(workspace.status)}
        title={statusLabel(workspace.status)}
      />
      <span className="workspace-row__body">
        <span className="workspace-row__title-line">
          <span className="workspace-row__title">{workspace.title}</span>
          {needsHuman ? (
            <span className="chip chip--warn">{statusLabel(workspace.status)}</span>
          ) : null}
        </span>
        <span className="workspace-row__sub">
          <span className="workspace-row__harness">{harnessBadge(workspace.harness)}</span>
          {workspace.worktree ? (
            <span className="workspace-row__branch" title={workspace.worktree.path}>
              {workspace.worktree.branch}
            </span>
          ) : null}
          {workspace.hostId && workspace.hostId !== "local" ? (
            <span className="chip chip--quiet">{workspace.hostId}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function dotClassFor(status: Workspace["status"]): string {
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
