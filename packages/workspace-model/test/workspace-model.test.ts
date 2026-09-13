/**
 * The sidebar's logic: grouping, ordering, counting, search, and the "does this need me?" number.
 *
 * These are the rules that decide what a user sees first, so they are tested rather than left to
 * the renderer — a tree that reshuffles while it is being read is the kind of bug nobody reports
 * and everybody notices.
 */

import { describe, expect, it } from "vitest";
import type { Project, Workspace } from "@envoycoder/protocol";
import {
  attentionSummary,
  countStatuses,
  filterRows,
  flattenRows,
  groupByProject,
  projectIdFor,
  resolveWorkspaceDefaults,
  statusLabel,
  workspaceIdFor,
} from "../src/index.js";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "local::/repo/a",
    path: "/repo/a",
    label: "a",
    hostId: "local",
    addedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function workspace(over: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    projectId: "local::/repo/a",
    cwd: "/repo/a",
    title: "task",
    harness: "envoy-harness",
    status: "idle",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

describe("ids", () => {
  it("derives a project id every client computes identically, across platforms", () => {
    // A Windows path and the same path with forward slashes must not become two projects.
    expect(projectIdFor("local", "C:\\work\\app")).toBe(projectIdFor("local", "C:/work/app"));
    expect(projectIdFor("local", "/repo/a/")).toBe("local::/repo/a");
    // …but the same path on two machines stays two projects.
    expect(projectIdFor("workstation", "/repo/a")).not.toBe(projectIdFor("local", "/repo/a"));
  });

  it("makes a workspace id that is readable and stable enough to sort by", () => {
    const id = workspaceIdFor("local::/repo/a", "Fix the flaky test", new Date("2026-09-13T10:20:30Z"));
    expect(id).toBe("local::/repo/a::fix-the-flaky-test::20260913102030");
    expect(workspaceIdFor("local::/repo/a", "!!!", new Date("2026-09-13T10:20:30Z"))).toContain("::task::");
  });
});

describe("defaults", () => {
  it("resolves explicit over project over app over built-in", () => {
    const proj = project({ defaults: { harness: "claudecode", model: "anthropic/opus" } });
    expect(resolveWorkspaceDefaults({ project: proj }).harness).toBe("claudecode");
    expect(resolveWorkspaceDefaults({ project: proj, explicit: { harness: "codex" } }).harness).toBe("codex");
    expect(resolveWorkspaceDefaults({ project: project() }).harness).toBe("envoy-harness");
    // A project with a model but no agent keeps the model and takes the app's agent.
    const modelOnly = project({ defaults: { model: "deepseek/deepseek-v4" } });
    expect(resolveWorkspaceDefaults({ project: modelOnly, appDefaults: { harness: "codex" } })).toEqual({
      harness: "codex",
      model: "deepseek/deepseek-v4",
    });
  });
});

describe("grouping", () => {
  it("keeps an empty project visible, because a vanished repo reads as data loss", () => {
    const groups = groupByProject({ projects: [project()], workspaces: [] });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows).toEqual([]);
    expect(groups[0]?.counts.total).toBe(0);
  });

  it("surfaces a project that needs attention above a busier but calmer one", () => {
    const calm = project({ id: "local::/repo/calm", label: "calm" });
    const busy = project({ id: "local::/repo/busy", label: "busy" });
    const groups = groupByProject({
      projects: [calm, busy],
      workspaces: [
        workspace({ id: "a", projectId: calm.id, status: "running", updatedAt: "2026-09-13T12:00:00Z" }),
        workspace({ id: "b", projectId: busy.id, status: "needs-attention", updatedAt: "2026-09-13T09:00:00Z" }),
      ],
    });
    expect(groups[0]?.project.label).toBe("busy");
  });

  it("pins first, then orders by recency, and never loses an orphaned workspace", () => {
    const groups = groupByProject({
      projects: [project()],
      workspaces: [
        workspace({ id: "old", updatedAt: "2026-09-01T00:00:00Z" }),
        workspace({ id: "new", updatedAt: "2026-09-13T00:00:00Z" }),
        workspace({ id: "pinned", pinned: true, updatedAt: "2026-08-01T00:00:00Z" }),
        // Its project is not in the list (removed on another client, or on an unpaired host).
        workspace({ id: "orphan", projectId: "workstation::/srv/site", hostId: "workstation" }),
      ],
    });
    expect(groups[0]?.rows.map((row) => row.workspace.id)).toEqual(["pinned", "new", "old"]);
    const orphan = groups.find((group) => group.project.label === "Unknown project");
    expect(orphan?.rows[0]?.workspace.id).toBe("orphan");
  });

  it("hides archived work unless asked, and can focus one project", () => {
    const projects = [project(), project({ id: "local::/repo/b", label: "b", path: "/repo/b" })];
    const workspaces = [
      workspace({ id: "live" }),
      workspace({ id: "archived", archivedAt: "2026-09-12T00:00:00Z" }),
      workspace({ id: "other", projectId: "local::/repo/b" }),
    ];
    expect(flattenRows(groupByProject({ projects, workspaces })).map((r) => r.workspace.id)).toEqual([
      "live",
      "other",
    ]);
    expect(
      flattenRows(groupByProject({ projects, workspaces, includeArchived: true })).length,
    ).toBe(3);
    expect(
      flattenRows(groupByProject({ projects, workspaces, onlyProjectId: "local::/repo/b" })).map(
        (r) => r.workspace.id,
      ),
    ).toEqual(["other"]);
  });
});

describe("search", () => {
  it("matches the title, the project label and the path — people search for any of the three", () => {
    const groups = groupByProject({
      projects: [project({ label: "payments" })],
      workspaces: [
        workspace({ id: "t", title: "Idempotency keys" }),
        workspace({ id: "p", title: "unrelated", cwd: "/repo/payments-api" }),
      ],
    });
    expect(filterRows(groups, { text: "idempotency" }).flatMap((g) => g.rows).map((r) => r.workspace.id)).toEqual(["t"]);
    expect(filterRows(groups, { text: "payments" }).flatMap((g) => g.rows).length).toBe(2);
    expect(filterRows(groups, { text: "nothing here" })).toEqual([]);
  });

  it("filters by status, agent and host without touching the tree's shape", () => {
    const groups = groupByProject({
      projects: [project()],
      workspaces: [
        workspace({ id: "r", status: "running" }),
        workspace({ id: "f", status: "failed", harness: "codex" }),
      ],
    });
    expect(filterRows(groups, { statuses: ["failed"] }).flatMap((g) => g.rows)[0]?.workspace.id).toBe("f");
    expect(filterRows(groups, { harnesses: ["codex"] }).flatMap((g) => g.rows)[0]?.workspace.id).toBe("f");
    expect(filterRows(groups, { hostIds: ["elsewhere"] })).toEqual([]);
  });
});

describe("attention", () => {
  it("counts what needs a human, newest first, in one place", () => {
    const summary = attentionSummary([
      workspace({ id: "a", status: "needs-attention", updatedAt: "2026-09-13T10:00:00Z" }),
      workspace({ id: "b", status: "needs-attention", updatedAt: "2026-09-13T11:00:00Z" }),
      workspace({ id: "c", status: "failed" }),
      workspace({ id: "d", status: "running" }),
    ]);
    expect(summary.badge).toBe(3);
    expect(summary.needsAttention.map((w) => w.id)).toEqual(["b", "a"]);
    expect(summary.failed.map((w) => w.id)).toEqual(["c"]);
  });

  it("counts active and finished work per project", () => {
    expect(
      countStatuses([
        workspace({ status: "queued" }),
        workspace({ status: "running" }),
        workspace({ status: "done" }),
        workspace({ status: "failed" }),
      ]),
    ).toEqual({ total: 4, active: 2, needsAttention: 1, done: 1, failed: 1 });
  });

  it("says a status in words a user reads, not in the internal bucket's words", () => {
    expect(statusLabel("needs-attention")).toBe("Needs your answer");
    expect(statusLabel("failed")).toBe("Stopped with an error");
    expect(statusLabel("running")).toBe("Working");
  });
});
