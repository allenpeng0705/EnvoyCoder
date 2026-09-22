/**
 * The Project → Task model, and the queries the sidebar asks of it.
 *
 * ## The relationship, stated once
 *
 * A **project** is a registered root: "this directory is somewhere I work". A **task** is
 * one unit of work inside it. That is the whole hierarchy, and it is deliberately only two levels deep.
 *
 * This model is inherited from EnvoyMesh's Coding tab rather than from Paseo's sidebar, on the
 * owner's instruction: both projects use the same two nouns, but EnvoyMesh's tree makes the
 * relationship visible — a project group is a *place*, its tasks are *work in that place*,
 * and a project carries the defaults (agent, model) that new tasks start with. When you have
 * ten agents running across four repositories, "which repo is this in?" is the question the
 * sidebar must answer without a click, and a flat list of sessions cannot answer it.
 *
 * Nothing here touches the filesystem or a daemon: it is a pure projection from collections to
 * rows, so the tree, the search, the badge counts and the sorting rules are all unit-testable,
 * and the UI is a renderer rather than a place where behaviour hides.
 */

import {
  type AgentId,
  type Project,
  type Task,
  type TaskStatus,
  statusIsActive,
  statusNeedsHuman,
} from "@envoydev/protocol";

/* ────────────────────────────── ids ───────────────────────────── */

/**
 * A project id that every client computes identically.
 *
 * Two clients that add the same directory must agree on the id, or the mobile app shows a
 * duplicate of a project the desktop already knows. So the id is derived, not allocated:
 * `<hostId>::<path>` with the path normalised to forward slashes, which is stable across
 * platforms and safe to put in a URL or a filename.
 */
export function projectIdFor(hostId: string, absolutePath: string): string {
  const normalized = absolutePath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return `${hostId}::${normalized}`;
}

export function taskIdFor(projectId: string, title: string, at = new Date()): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = at.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${projectId}::${slug || "task"}::${stamp}`;
}

/**
 * The name a task takes from the first thing the user asked it to do.
 *
 * This is how a task gets named at all now: "+ New" opens an empty chat, and a row called "Untitled"
 * that stays "Untitled" is a list the user has to rename by hand. Paseo does the same thing with its
 * workspaces — the first message names the workspace — and it is the only naming scheme that costs the
 * user nothing, because they were going to type the prompt anyway.
 *
 * Deliberately crude, in this order: the **first line** (a prompt with a body is named after its
 * request, not its exposition), trimmed, collapsed whitespace, and cut to `max` on a word boundary
 * when there is one nearby. Anything cleverer — an LLM summary — would be a second model call to name
 * a row, and a name the user cannot predict.
 */
export function taskTitleFromPrompt(prompt: string, max = 60): string {
  const firstLine = prompt.trim().split("\n")[0] ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/* ────────────────────────────── defaults ───────────────────────────── */

/**
 * Resolve the harness/model a new task should start with: explicit choice, else the
 * project's default, else the app default.
 *
 * The order matters and is the reason "project settings" is a screen at all: a monorepo of Go
 * services and a Python tool want different agents, and the user should set that once per
 * project rather than per task.
 */
export function resolveTaskDefaults(input: {
  project?: Pick<Project, "defaults"> | undefined;
  appDefaults?: { harness?: AgentId; model?: string; extraArgs?: string } | undefined;
  explicit?: { harness?: AgentId; model?: string; extraArgs?: string } | undefined;
  /** Last resort, so a row is always runnable. */
  fallbackHarness?: AgentId;
}): { harness: AgentId; model?: string; extraArgs?: string } {
  const harness =
    input.explicit?.harness ??
    input.project?.defaults?.harness ??
    input.appDefaults?.harness ??
    input.fallbackHarness ??
    "envoy-harness";
  const model = input.explicit?.model ?? input.project?.defaults?.model ?? input.appDefaults?.model;
  const extraArgs =
    input.explicit?.extraArgs ?? input.project?.defaults?.extraArgs ?? input.appDefaults?.extraArgs;
  return {
    harness,
    ...(model ? { model } : {}),
    ...(extraArgs ? { extraArgs } : {}),
  };
}

/* ────────────────────────────── the tree ───────────────────────────── */

export interface TaskRow {
  task: Task;
  project: Project | undefined;
  /** True when this row is the one the user is looking at. */
  active: boolean;
}

export interface ProjectGroup {
  project: Project;
  rows: readonly TaskRow[];
  /** The agent new tasks here will use — shown on the group header. */
  defaultHarness: AgentId;
  counts: StatusCounts;
}

export interface StatusCounts {
  total: number;
  active: number;
  needsAttention: number;
  done: number;
  failed: number;
}

export function countStatuses(tasks: readonly Task[]): StatusCounts {
  return {
    total: tasks.length,
    active: tasks.filter((w) => statusIsActive(w.status)).length,
    needsAttention: tasks.filter((w) => statusNeedsHuman(w.status)).length,
    done: tasks.filter((w) => w.status === "done").length,
    failed: tasks.filter((w) => w.status === "failed").length,
  };
}

/**
 * Group rows by project, in the order the sidebar renders them.
 *
 * Rules, in order:
 *   1. pinned tasks first, then by recency *within* a project;
 *   2. projects stay put: newest `addedAt` first, then label — never reshuffled by
 *      attention or task activity (that was jumping the rail while people read it);
 *   3. find a place by name via the sidebar search (`filterRows`), not by bubbling it up.
 *
 * `archived` tasks are excluded unless asked for; they are reachable through search.
 */
export function groupByProject(input: {
  projects: readonly Project[];
  tasks: readonly Task[];
  activeTaskId?: string | undefined;
  includeArchived?: boolean;
  /** Restrict to one project (the "focus this project" view). */
  onlyProjectId?: string | undefined;
}): ProjectGroup[] {
  const includeArchived = input.includeArchived === true;
  const visible = input.tasks.filter(
    (w) => (includeArchived || !w.archivedAt) && (!input.onlyProjectId || w.projectId === input.onlyProjectId),
  );
  const byProject = new Map<string, Task[]>();
  for (const task of visible) {
    const list = byProject.get(task.projectId);
    if (list) list.push(task);
    else byProject.set(task.projectId, [task]);
  }

  const groups: ProjectGroup[] = [];
  for (const project of input.projects) {
    if (input.onlyProjectId && project.id !== input.onlyProjectId) continue;
    const rows = sortRows(byProject.get(project.id) ?? [], project, input.activeTaskId);
    // A project with nothing in it still appears: it is a place the user registered, and a
    // vanished project is how a user concludes the app "lost" their repository.
    groups.push({
      project,
      rows,
      defaultHarness: project.defaults?.harness ?? "envoy-harness",
      counts: countStatuses(rows.map((row) => row.task)),
    });
  }

  // Tasks whose project is not in the list (a project removed on another client, or a
  // project on a host we are not currently paired with): shown under a synthetic group rather
  // than dropped, because dropping a *running agent* is the worst possible outcome.
  const known = new Set(input.projects.map((project) => project.id));
  for (const [projectId, tasks] of byProject) {
    if (known.has(projectId)) continue;
    const syntheticProject: Project = {
      id: projectId,
      path: tasks[0]?.cwd ?? projectId,
      label: "Unknown project",
      hostId: tasks[0]?.hostId ?? "local",
      // Epoch so unknowns sink below registered projects (newest-first rail).
      addedAt: new Date(0).toISOString(),
    };
    const rows = sortRows(tasks, syntheticProject, input.activeTaskId);
    groups.push({
      project: syntheticProject,
      rows,
      defaultHarness: "envoy-harness",
      counts: countStatuses(rows.map((row) => row.task)),
    });
  }

  return groups.sort((a, b) => {
    const added =
      Date.parse(b.project.addedAt) - Date.parse(a.project.addedAt);
    if (added !== 0) return Number.isFinite(added) ? added : 0;
    return a.project.label.localeCompare(b.project.label);
  });
}

function sortRows(
  tasks: readonly Task[],
  project: Project | undefined,
  activeTaskId?: string,
): TaskRow[] {
  return [...tasks]
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    })
    .map((task) => ({
      task,
      project,
      active: task.id === activeTaskId,
    }));
}

/* ────────────────────────────── search ───────────────────────────── */

export interface SearchFilters {
  text?: string;
  statuses?: readonly TaskStatus[];
  harnesses?: readonly AgentId[];
  projectIds?: readonly string[];
  hostIds?: readonly string[];
}

/**
 * Filter rows for the sidebar's search box.
 *
 * The text query matches the task title, the project label, the project path *and* the
 * task cwd — people look up a place by folder name as often as by what they typed. A
 * hit on the project itself keeps the whole group (including an empty project), so
 * search is how you find a repo without relying on the rail to reshuffle.
 */
export function filterRows(
  groups: readonly ProjectGroup[],
  filters: SearchFilters,
): ProjectGroup[] {
  const text = filters.text?.trim().toLowerCase() ?? "";
  const statuses = filters.statuses ? new Set(filters.statuses) : null;
  const harnesses = filters.harnesses ? new Set(filters.harnesses) : null;
  const projectIds = filters.projectIds ? new Set(filters.projectIds) : null;
  const hostIds = filters.hostIds ? new Set(filters.hostIds) : null;

  const projectTextHit = (group: ProjectGroup): boolean => {
    if (!text) return false;
    return (
      group.project.label.toLowerCase().includes(text) ||
      group.project.path.toLowerCase().includes(text)
    );
  };

  const keep = (row: TaskRow): boolean => {
    const task = row.task;
    if (statuses && !statuses.has(task.status)) return false;
    if (harnesses && !harnesses.has(task.harness)) return false;
    if (projectIds && !projectIds.has(task.projectId)) return false;
    if (hostIds && !hostIds.has(task.hostId ?? "local")) return false;
    if (!text) return true;
    return (
      task.title.toLowerCase().includes(text) ||
      task.cwd.toLowerCase().includes(text) ||
      (row.project?.label.toLowerCase().includes(text) ?? false) ||
      (row.project?.path.toLowerCase().includes(text) ?? false)
    );
  };

  return groups
    .map((group) => {
      if (projectTextHit(group)) return group;
      return {
        ...group,
        rows: group.rows.filter(keep),
      };
    })
    .filter((group) => group.rows.length > 0 || projectTextHit(group));
}

/* ────────────────────────────── attention ───────────────────────────── */

export interface AttentionSummary {
  /** Tasks waiting on a human decision, newest first. */
  needsAttention: Task[];
  /** Runs that ended badly since the user last looked. */
  failed: Task[];
  /** The single number a tray icon or mobile badge should show. */
  badge: number;
}

/**
 * What "needs you" means, computed once so every surface agrees.
 *
 * A control plane that shows three different counts in three places (tray, title bar, mobile
 * badge) teaches users to trust none of them.
 */
export function attentionSummary(tasks: readonly Task[]): AttentionSummary {
  const needsAttention = tasks
    .filter((task) => task.status === "needs-attention")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const failed = tasks
    .filter((task) => task.status === "failed")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return {
    needsAttention,
    failed,
    badge: needsAttention.length + failed.length,
  };
}

/**
 * The status text a row shows, in end-user language.
 *
 * "needs-attention" is an internal bucket; a user reads a sentence. The mapping lives here so
 * the desktop, the tray and the mobile app cannot word it three ways.
 */
export function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "queued":
      return "Waiting to start";
    case "running":
      return "Working";
    case "needs-attention":
      return "Needs your answer";
    case "idle":
      return "Idle";
    case "done":
      return "Finished";
    case "failed":
      return "Stopped with an error";
    case "cancelled":
      return "Stopped";
  }
}

/** Sort key for the "everything, newest first" flat view. */
export function flattenRows(groups: readonly ProjectGroup[]): TaskRow[] {
  return groups
    .flatMap((group) => group.rows)
    .sort((a, b) => Date.parse(b.task.updatedAt) - Date.parse(a.task.updatedAt));
}

export * from "./history.js";
