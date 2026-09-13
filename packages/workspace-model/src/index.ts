/**
 * The Project → Workspace model, and the queries the sidebar asks of it.
 *
 * ## The relationship, stated once
 *
 * A **project** is a registered root: "this directory is somewhere I work". A **workspace** is
 * one task inside it. That is the whole hierarchy, and it is deliberately only two levels deep.
 *
 * This model is inherited from EnvoyMesh's Coding tab rather than from Paseo's sidebar, on the
 * owner's instruction: both projects use the same two nouns, but EnvoyMesh's tree makes the
 * relationship visible — a project group is a *place*, its workspaces are *work in that place*,
 * and a project carries the defaults (agent, model) that its workspaces inherit. When you have
 * ten agents running across four repositories, "which repo is this in?" is the question the
 * sidebar must answer without a click, and a flat list of sessions cannot answer it.
 *
 * Nothing here touches the filesystem or a daemon: it is a pure projection from collections to
 * rows, so the tree, the search, the badge counts and the sorting rules are all unit-testable,
 * and the UI is a renderer rather than a place where behaviour hides.
 */

import {
  type HarnessId,
  type Project,
  type Workspace,
  type WorkspaceStatus,
  statusIsActive,
  statusNeedsHuman,
} from "@envoycoder/protocol";

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

export function workspaceIdFor(projectId: string, title: string, at = new Date()): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = at.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${projectId}::${slug || "task"}::${stamp}`;
}

/* ────────────────────────────── defaults ───────────────────────────── */

/**
 * Resolve the harness/model a new workspace should start with: explicit choice, else the
 * project's default, else the app default.
 *
 * The order matters and is the reason "project settings" is a screen at all: a monorepo of Go
 * services and a Python tool want different agents, and the user should set that once per
 * project rather than per task.
 */
export function resolveWorkspaceDefaults(input: {
  project?: Pick<Project, "defaults"> | undefined;
  appDefaults?: { harness?: HarnessId; model?: string; extraArgs?: string } | undefined;
  explicit?: { harness?: HarnessId; model?: string; extraArgs?: string } | undefined;
  /** Last resort, so a row is always runnable. */
  fallbackHarness?: HarnessId;
}): { harness: HarnessId; model?: string; extraArgs?: string } {
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

export interface WorkspaceRow {
  workspace: Workspace;
  project: Project | undefined;
  /** True when this row is the one the user is looking at. */
  active: boolean;
}

export interface ProjectGroup {
  project: Project;
  rows: readonly WorkspaceRow[];
  /** The agent new workspaces here will use — shown on the group header. */
  defaultHarness: HarnessId;
  counts: StatusCounts;
}

export interface StatusCounts {
  total: number;
  active: number;
  needsAttention: number;
  done: number;
  failed: number;
}

export function countStatuses(workspaces: readonly Workspace[]): StatusCounts {
  return {
    total: workspaces.length,
    active: workspaces.filter((w) => statusIsActive(w.status)).length,
    needsAttention: workspaces.filter((w) => statusNeedsHuman(w.status)).length,
    done: workspaces.filter((w) => w.status === "done").length,
    failed: workspaces.filter((w) => w.status === "failed").length,
  };
}

/**
 * Group rows by project, in the order the sidebar renders them.
 *
 * Rules, in order:
 *   1. pinned workspaces first, then by recency;
 *   2. projects that need attention bubble to the top of the project list, so the badge is not
 *      the only thing competing for the user's eye;
 *   3. otherwise projects sort by their most recent activity, then by label — a stable order
 *      that does not reshuffle while the user is reading it.
 *
 * `archived` workspaces are excluded unless asked for; they are reachable through search.
 */
export function groupByProject(input: {
  projects: readonly Project[];
  workspaces: readonly Workspace[];
  activeWorkspaceId?: string | undefined;
  includeArchived?: boolean;
  /** Restrict to one project (the "focus this project" view). */
  onlyProjectId?: string | undefined;
}): ProjectGroup[] {
  const includeArchived = input.includeArchived === true;
  const visible = input.workspaces.filter(
    (w) => (includeArchived || !w.archivedAt) && (!input.onlyProjectId || w.projectId === input.onlyProjectId),
  );
  const byProject = new Map<string, Workspace[]>();
  for (const workspace of visible) {
    const list = byProject.get(workspace.projectId);
    if (list) list.push(workspace);
    else byProject.set(workspace.projectId, [workspace]);
  }

  const groups: ProjectGroup[] = [];
  for (const project of input.projects) {
    if (input.onlyProjectId && project.id !== input.onlyProjectId) continue;
    const rows = sortRows(byProject.get(project.id) ?? [], project, input.activeWorkspaceId);
    // A project with nothing in it still appears: it is a place the user registered, and a
    // vanished project is how a user concludes the app "lost" their repository.
    groups.push({
      project,
      rows,
      defaultHarness: project.defaults?.harness ?? "envoy-harness",
      counts: countStatuses(rows.map((row) => row.workspace)),
    });
  }

  // Workspaces whose project is not in the list (a project removed on another client, or a
  // project on a host we are not currently paired with): shown under a synthetic group rather
  // than dropped, because dropping a *running agent* is the worst possible outcome.
  const known = new Set(input.projects.map((project) => project.id));
  for (const [projectId, workspaces] of byProject) {
    if (known.has(projectId)) continue;
    const syntheticProject: Project = {
      id: projectId,
      path: workspaces[0]?.cwd ?? projectId,
      label: "Unknown project",
      hostId: workspaces[0]?.hostId ?? "local",
      addedAt: workspaces[0]?.createdAt ?? new Date(0).toISOString(),
    };
    const rows = sortRows(workspaces, syntheticProject, input.activeWorkspaceId);
    groups.push({
      project: syntheticProject,
      rows,
      defaultHarness: "envoy-harness",
      counts: countStatuses(rows.map((row) => row.workspace)),
    });
  }

  return groups.sort((a, b) => {
    const attention = b.counts.needsAttention - a.counts.needsAttention;
    if (attention !== 0) return attention;
    const recency = lastActivityAt(b.rows) - lastActivityAt(a.rows);
    if (recency !== 0) return recency;
    return a.project.label.localeCompare(b.project.label);
  });
}

function sortRows(
  workspaces: readonly Workspace[],
  project: Project | undefined,
  activeWorkspaceId?: string,
): WorkspaceRow[] {
  return [...workspaces]
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    })
    .map((workspace) => ({
      workspace,
      project,
      active: workspace.id === activeWorkspaceId,
    }));
}

function lastActivityAt(rows: readonly WorkspaceRow[]): number {
  let newest = 0;
  for (const row of rows) {
    const at = Date.parse(row.workspace.updatedAt);
    if (Number.isFinite(at) && at > newest) newest = at;
  }
  return newest;
}

/* ────────────────────────────── search ───────────────────────────── */

export interface SearchFilters {
  text?: string;
  statuses?: readonly WorkspaceStatus[];
  harnesses?: readonly HarnessId[];
  projectIds?: readonly string[];
  hostIds?: readonly string[];
}

/**
 * Filter rows for the sidebar's search box.
 *
 * The text query matches the workspace title, the project label *and* the cwd, because users
 * search for "the repo I was in" about as often as for what they typed.
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

  const keep = (row: WorkspaceRow): boolean => {
    const workspace = row.workspace;
    if (statuses && !statuses.has(workspace.status)) return false;
    if (harnesses && !harnesses.has(workspace.harness)) return false;
    if (projectIds && !projectIds.has(workspace.projectId)) return false;
    if (hostIds && !hostIds.has(workspace.hostId ?? "local")) return false;
    if (!text) return true;
    return (
      workspace.title.toLowerCase().includes(text) ||
      workspace.cwd.toLowerCase().includes(text) ||
      (row.project?.label.toLowerCase().includes(text) ?? false)
    );
  };

  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter(keep),
    }))
    .filter((group) => group.rows.length > 0);
}

/* ────────────────────────────── attention ───────────────────────────── */

export interface AttentionSummary {
  /** Workspaces waiting on a human decision, newest first. */
  needsAttention: Workspace[];
  /** Runs that ended badly since the user last looked. */
  failed: Workspace[];
  /** The single number a tray icon or mobile badge should show. */
  badge: number;
}

/**
 * What "needs you" means, computed once so every surface agrees.
 *
 * A control plane that shows three different counts in three places (tray, title bar, mobile
 * badge) teaches users to trust none of them.
 */
export function attentionSummary(workspaces: readonly Workspace[]): AttentionSummary {
  const needsAttention = workspaces
    .filter((workspace) => workspace.status === "needs-attention")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const failed = workspaces
    .filter((workspace) => workspace.status === "failed")
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
export function statusLabel(status: WorkspaceStatus): string {
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
export function flattenRows(groups: readonly ProjectGroup[]): WorkspaceRow[] {
  return groups
    .flatMap((group) => group.rows)
    .sort((a, b) => Date.parse(b.workspace.updatedAt) - Date.parse(a.workspace.updatedAt));
}
