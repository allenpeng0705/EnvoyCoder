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
 * that names the default agent new tasks start with.
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

import { isDarkTheme } from "../design/applyTheme.js";
import { GearIcon, MoonIcon, QrIcon, SunIcon } from "./icons.js";
import { RowMenu } from "./RowMenu.js";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  type AgentId,
  type AgentProviderSummary,
  type CatalogEntry,
  type HarnessSummary,
  type Project,
  type Task,
  type TaskDefaults,
  isHarnessId,
  statusNeedsHuman,
} from "@envoydev/protocol";
import type { Job } from "@envoydev/protocol";
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
import { mergeOfferedAgents } from "../composer/agent-for.js";
import type { GitSnapshot } from "../state/coderStore.js";
import { jobAttentionCount } from "./JobPane.js";

import { ProjectList } from "./sidebar-project-list.js";

export interface CoderSidebarProps {
  projects: readonly Project[];
  tasks: readonly Task[];
  /** Opt-in collaborative jobs (M5) — shown as rail rows under Jobs. */
  jobs?: readonly Job[];
  activeJobId?: string | undefined;
  onSelectJob?: (jobId: string) => void;
  activeTaskId?: string | undefined;
  /** Called when the user picks a task. */
  onSelect: (taskId: string) => void;
  /**
   * Called when the user activates a project on the rail (header click — expand/collapse).
   * The shell uses this to leave Settings so the work column is visible again.
   */
  onActivateProject?: (projectId: string) => void;
  /** Called when the user asks for a new task inside a project. */
  onNewTask: (projectId: string) => void;
  /** Called when the user asks for a Team job inside a project (§13). */
  onTeamJob?: (projectId: string) => void;
  onAddProject: () => void;
  onOpenProjectSettings: (project: Project) => void;
  /**
   * Change a project's default coding agent from the rail badge. New tasks start with it;
   * existing tasks keep the agent they already have.
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
  /** Merge a branch into the one a project is on. A conflict comes back as a refusal naming the files. */
  onGitMerge?: (projectId: string, branch: string) => Promise<{ ok: true; into?: string } | Refusal>;
  /** Fetch a project's remote. Allowed while a run is live: it touches no working tree. */
  onGitFetch?: (projectId: string) => Promise<{ ok: true; summary: string } | Refusal>;
  /** Pull a project's branch — a fast-forward, or a refusal saying the histories diverged. */
  onGitPull?: (projectId: string) => Promise<{ ok: true; summary: string } | Refusal>;
  /** Merge a branch and hand a conflict to an agent, in a task of its own. */
  onGitResolveMerge?: (
    projectId: string,
    branch: string,
  ) => Promise<
    | { ok: true; outcome: "merged"; into?: string }
    | { ok: true; outcome: "resolving"; task: string }
    | Refusal
  >;
  /** Record a merge whose conflicts are resolved. */
  onGitMergeContinue?: (projectId: string) => Promise<{ ok: true; sha: string } | Refusal>;
  /** Take a merge in progress back. */
  onGitMergeAbort?: (projectId: string) => Promise<{ ok: true } | Refusal>;
  /** Agents this daemon lists — for the project default and this-task agent menus. */
  harnesses?: readonly HarnessSummary[];
  /** Providers the user added. They join the same menus once they are not known-missing. */
  providers?: readonly AgentProviderSummary[];
  /** Catalogue recipes — choosing one auto-Adds on the daemon. */
  catalog?: readonly CatalogEntry[];
  /** App-wide default agent when a project has not set its own. */
  appHarness?: AgentId;
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
   * Change this *task's* coding agent from the row menu. Applies to the next run.
   *
   * Absent when the rail has no write path (a test that only renders the tree).
   */
  onChangeTaskHarness?: (taskId: string, harness: AgentId) => void;
  /**
   * Take a task out of the rail.
   *
   * Here and not in the pane: see `TaskRow`, and `TaskPane`'s header comment. The daemon archives it
   * (`coder.archiveTask`) — the folder, the files and the transcript on disk are untouched, which is what
   * the confirmation says.
   */
  onRemoveTask: (taskId: string) => void;
  onOpenSettings: () => void;
  /** Mint and open Pairing — the rail-top QR beside Settings / theme. */
  onShowPairing: () => void;
  /**
   * Appearance toggle on the rail. Writes an explicit `"light"` / `"dark"` (not `"system"`) so the
   * press always changes what is painted. Command Center stays on Mod+K — not a rail button.
   */
  onSetTheme: (theme: "light" | "dark") => void;
  /** Stored preference — drives the toggle icon so it flips with settings state, not only `data-theme`. */
  theme?: "light" | "dark" | "system";
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
  /**
   * Paired EnvoyDev homes. Projects and tasks stay **under this section**, using the same chrome as
   * This machine. The local list above is always this laptop.
   */
  pairedHomes?: readonly {
    record: { id: string; label: string; host: string; port: number };
    state: {
      connection: { state: string };
      projects: readonly Project[];
      tasks: readonly Task[];
      harnesses?: readonly HarnessSummary[];
      providers?: readonly AgentProviderSummary[];
      catalog?: readonly CatalogEntry[];
      appHarness?: AgentId;
    };
  }[];
  activeHomeId?: string | undefined;
  workingOnLabel?: string | undefined;
  onFocusPairedHome?: (homeId: string) => void;
  /** Expand / focus a project under a paired home — keeps that home active (does not bounce to local). */
  onActivatePairedHome?: (homeId: string) => void;
  onFocusLocalHome?: () => void;
  onSelectPairedTask?: (homeId: string, taskId: string) => void;
  onNewPairedTask?: (homeId: string, projectId: string) => void;
  onRenamePairedTask?: (homeId: string, taskId: string, title: string) => void;
  onChangePairedTaskHarness?: (homeId: string, taskId: string, harness: AgentId) => void;
  onRemovePairedTask?: (homeId: string, taskId: string) => void;
  onRemovePairedProject?: (homeId: string, projectId: string) => void;
  onChangePairedProjectAgent?: (
    homeId: string,
    project: Project,
    defaults: TaskDefaults,
  ) => Promise<{ ok: true } | Refusal>;
  onAddPairedHome?: () => void;
  onForgetPairedHome?: (homeId: string) => void;
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
    setCollapsed(
      props.projects
        .filter((project) => project.id !== focusId)
        .map((project) => `local:${project.id}`),
    );
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

  const attention = useMemo(
    () => attentionSummary(props.tasks, jobAttentionCount(props.jobs ?? [])),
    [props.tasks, props.jobs],
  );

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
          className="button button--ghost button--icon"
          onClick={props.onShowPairing}
          title={t("sidebar.pair")}
        >
          <QrIcon />
          <span className="visually-hidden">{t("sidebar.pair")}</span>
        </button>
        <button
          type="button"
          className="button button--ghost button--icon"
          onClick={props.onOpenSettings}
          title={t("sidebar.settings")}
          aria-label={t("sidebar.settings")}
        >
          <GearIcon />
        </button>
        {(() => {
          // Prefer the stored preference so the icon flips with settings state; `"system"` falls back
          // to the resolved paint (`data-theme` / OS).
          const dark =
            props.theme === "light" ? false : props.theme === "dark" ? true : isDarkTheme();
          const label = dark ? t("sidebar.theme.toLight") : t("sidebar.theme.toDark");
          return (
            <button
              type="button"
              className="button button--ghost button--icon"
              onClick={() => props.onSetTheme(dark ? "light" : "dark")}
              title={label}
              aria-label={label}
              data-testid="sidebar-theme-toggle"
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
          );
        })()}
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

      {(() => {
        const orphans = (props.jobs ?? []).filter(
          (job) => !props.projects.some((p) => p.id === job.projectId),
        );
        if (orphans.length === 0) return null;
        return (
          <div className="sidebar__jobs" data-testid="job-list-orphan">
            <div className="sidebar__group-label">{t("sidebar.jobs")}</div>
            <ul className="sidebar__job-rows">
              {orphans.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    className={
                      props.activeJobId === job.id
                        ? "sidebar__task sidebar__task--active"
                        : "sidebar__task"
                    }
                    onClick={() => props.onSelectJob?.(job.id)}
                  >
                    <span className="dot" data-status={job.status} aria-hidden />
                    <span className="sidebar__task-title">{job.title}</span>
                    <span className="sidebar__task-meta">{job.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      <div className="sidebar__home-section" data-testid="sidebar-this-machine-label">
        {props.onFocusLocalHome && props.activeHomeId !== undefined && props.activeHomeId !== "local" ? (
          <button
            type="button"
            className="sidebar__home-heading sidebar__home-heading--button"
            onClick={props.onFocusLocalHome}
            title={t("sidebar.section.thisMachine")}
          >
            {t("sidebar.section.thisMachine")}
          </button>
        ) : (
          <span
            className={`sidebar__home-heading${props.activeHomeId === undefined || props.activeHomeId === "local" ? " sidebar__home-heading--active" : ""}`}
          >
            {t("sidebar.section.thisMachine")}
          </span>
        )}
      </div>

      <ProjectList
        groups={groups}
        jobs={props.jobs}
        query={query}
        projectsEmpty={props.projects.length === 0}
        unavailable={props.unavailable}
        tasksUnknown={props.tasksUnknown}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        activeTaskId={props.activeHomeId === undefined || props.activeHomeId === "local" ? props.activeTaskId : undefined}
        activeJobId={props.activeJobId}
        listTestId="task-list"
        collapseKeyPrefix="local:"
        onActivateProject={props.onActivateProject}
        onSelect={props.onSelect}
        onSelectJob={props.onSelectJob}
        onNewTask={props.onNewTask}
        onTeamJob={props.onTeamJob}
        onOpenProjectSettings={props.onOpenProjectSettings}
        onChangeProjectAgent={props.onChangeProjectAgent}
        git={props.git}
        onReadGit={props.onReadGit}
        onGitCheckout={props.onGitCheckout}
        onGitCreateBranch={props.onGitCreateBranch}
        onGitMerge={props.onGitMerge}
        onGitFetch={props.onGitFetch}
        onGitPull={props.onGitPull}
        onGitResolveMerge={props.onGitResolveMerge}
        onGitMergeContinue={props.onGitMergeContinue}
        onGitMergeAbort={props.onGitMergeAbort}
        harnesses={props.harnesses}
        providers={props.providers}
        catalog={props.catalog}
        appHarness={props.appHarness}
        onOpenProjectInNewWindow={props.onOpenProjectInNewWindow}
        onRemoveProject={props.onRemoveProject}
        onRenameTask={props.onRenameTask}
        onChangeTaskHarness={props.onChangeTaskHarness}
        onRemoveTask={props.onRemoveTask}
        failure={props.failure}
        TaskRow={TaskRow}
      />

      <div className="sidebar__paired" data-testid="sidebar-paired-homes">
        <div className="sidebar__home-section">
          <span className="sidebar__home-heading">{t("sidebar.section.pairedHomes")}</span>
          {props.onAddPairedHome ? (
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={props.onAddPairedHome}
              title={t("homes.add.title")}
            >
              {t("homes.add")}
            </button>
          ) : null}
        </div>
        {props.workingOnLabel ? (
          <p className="sidebar__working-on" role="status" data-testid="sidebar-working-on">
            {t("homes.workingOn", { label: props.workingOnLabel })}
          </p>
        ) : null}
        {(props.pairedHomes ?? []).length === 0 ? (
          <p className="sidebar__paired-empty">{t("homes.empty")}</p>
        ) : (
          (props.pairedHomes ?? []).map((home) => {
            const online = home.state.connection.state === "connected";
            const focused = props.activeHomeId === home.record.id;
            return (
              <section
                key={home.record.id}
                className={`sidebar__paired-home${focused ? " sidebar__paired-home--active" : ""}`}
                data-testid={`paired-home-${home.record.id}`}
              >
                <div className="sidebar__paired-home-head">
                  <button
                    type="button"
                    className="sidebar__paired-home-label"
                    onClick={() => props.onFocusPairedHome?.(home.record.id)}
                    title={`${home.record.host}:${home.record.port}`}
                  >
                    <span
                      className={`dot ${online ? "dot--ok" : "dot--quiet"}`}
                      aria-hidden
                    />
                    <span>{home.record.label}</span>
                    <span className="sidebar__paired-home-status">
                      {online ? t("homes.online") : t("homes.offline")}
                    </span>
                  </button>
                  {props.onForgetPairedHome ? (
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => props.onForgetPairedHome?.(home.record.id)}
                      title={t("homes.forget")}
                    >
                      {t("homes.forget")}
                    </button>
                  ) : null}
                </div>
                {online ? (
                  <ProjectList
                    groups={(() => {
                      const tree = groupByProject({
                        projects: home.state.projects,
                        tasks: home.state.tasks,
                        activeTaskId: focused ? props.activeTaskId : undefined,
                      });
                      if (!query.trim()) return tree;
                      return filterRows(tree, { text: query });
                    })()}
                    query={query}
                    projectsEmpty={home.state.projects.length === 0}
                    tasksUnknown={false}
                    collapsed={collapsed}
                    setCollapsed={setCollapsed}
                    activeTaskId={focused ? props.activeTaskId : undefined}
                    listTestId={`paired-home-tasks-${home.record.id}`}
                    collapseKeyPrefix={`${home.record.id}:`}
                    compact
                    onActivateProject={() => {
                      props.onActivatePairedHome?.(home.record.id);
                    }}
                    onSelect={(taskId) => {
                      if (props.onSelectPairedTask) props.onSelectPairedTask(home.record.id, taskId);
                      else props.onSelect(taskId);
                    }}
                    onNewTask={(projectId) => {
                      if (props.onNewPairedTask) props.onNewPairedTask(home.record.id, projectId);
                    }}
                    onOpenProjectSettings={(project) => {
                      props.onActivatePairedHome?.(home.record.id);
                      props.onOpenProjectSettings(project);
                    }}
                    onChangeProjectAgent={
                      props.onChangePairedProjectAgent
                        ? (project, defaults) =>
                            props.onChangePairedProjectAgent!(home.record.id, project, defaults)
                        : undefined
                    }
                    onRemoveProject={(projectId) => {
                      props.onRemovePairedProject?.(home.record.id, projectId);
                    }}
                    onRenameTask={(taskId, title) => {
                      props.onRenamePairedTask?.(home.record.id, taskId, title);
                    }}
                    onChangeTaskHarness={
                      props.onChangePairedTaskHarness
                        ? (taskId, harness) =>
                            props.onChangePairedTaskHarness!(home.record.id, taskId, harness)
                        : undefined
                    }
                    onRemoveTask={(taskId) => {
                      props.onRemovePairedTask?.(home.record.id, taskId);
                    }}
                    harnesses={home.state.harnesses}
                    providers={home.state.providers}
                    catalog={home.state.catalog}
                    appHarness={home.state.appHarness}
                    failure={focused ? props.failure : undefined}
                    TaskRow={TaskRow}
                  />
                ) : null}
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
  onChangeTaskHarness?: (taskId: string, harness: AgentId) => void;
  onRemoveTask: (taskId: string) => void;
  harnesses?: readonly HarnessSummary[];
  providers?: readonly AgentProviderSummary[];
  catalog?: readonly CatalogEntry[];
}): JSX.Element {
  const t = useT();
  const task = input.row.task;
  const needsHuman = statusNeedsHuman(task.status);
  const name = task.title || t("task.untitled");
  const agentOptions =
    input.onChangeTaskHarness !== undefined && input.harnesses !== undefined
      ? mergeOfferedAgents({
          harnesses: input.harnesses,
          ...(input.providers !== undefined ? { providers: input.providers } : {}),
          ...(input.catalog !== undefined ? { catalog: input.catalog } : {}),
        }).map((entry) => ({
          id: entry.id,
          label: entry.label,
          current: entry.id === task.harness,
        }))
      : [];

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
              <span className="task-row__harness">
                {isHarnessId(task.harness) ? harnessBadge(task.harness) : task.harness}
              </span>
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
        pick={
          agentOptions.length > 0
            ? {
                label: t("sidebar.task.changeAgent"),
                ariaLabel: t("task.agent.picker.menu"),
                options: agentOptions,
                onChoose: (id) => {
                  const chosen = agentOptions.find((option) => option.id === id);
                  if (chosen !== undefined) input.onChangeTaskHarness!(task.id, chosen.id);
                },
              }
            : undefined
        }
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
