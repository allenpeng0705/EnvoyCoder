/**
 * The sidebar's logic: grouping, ordering, counting, search, and the "does this need me?" number.
 *
 * These are the rules that decide what a user sees first, so they are tested rather than left to
 * the renderer — a tree that reshuffles while it is being read is the kind of bug nobody reports
 * and everybody notices.
 */

import { describe, expect, it } from "vitest";
import type { Project, Task } from "@envoydev/protocol";
import {
  attentionSummary,
  countStatuses,
  filterRows,
  flattenRows,
  groupByProject,
  projectIdFor,
  resolveTaskDefaults,
  statusLabel,
  taskIdFor,
  taskTitleFromPrompt,
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

function task(over: Partial<Task> = {}): Task {
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

  it("makes a task id that is readable and stable enough to sort by", () => {
    const id = taskIdFor("local::/repo/a", "Fix the flaky test", new Date("2026-09-13T10:20:30Z"));
    expect(id).toBe("local::/repo/a::fix-the-flaky-test::20260913102030");
    expect(taskIdFor("local::/repo/a", "!!!", new Date("2026-09-13T10:20:30Z"))).toContain("::task::");
  });
});

describe("defaults", () => {
  it("resolves explicit over project over app over built-in", () => {
    const proj = project({ defaults: { harness: "claudecode", model: "anthropic/opus" } });
    expect(resolveTaskDefaults({ project: proj }).harness).toBe("claudecode");
    expect(resolveTaskDefaults({ project: proj, explicit: { harness: "codex" } }).harness).toBe("codex");
    expect(resolveTaskDefaults({ project: project() }).harness).toBe("envoy-harness");
    // A project with a model but no agent keeps the model and takes the app's agent.
    const modelOnly = project({ defaults: { model: "deepseek/deepseek-v4" } });
    expect(resolveTaskDefaults({ project: modelOnly, appDefaults: { harness: "codex" } })).toEqual({
      harness: "codex",
      model: "deepseek/deepseek-v4",
    });
  });
});

describe("grouping", () => {
  it("keeps an empty project visible, because a vanished repo reads as data loss", () => {
    const groups = groupByProject({ projects: [project()], tasks: [] });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows).toEqual([]);
    expect(groups[0]?.counts.total).toBe(0);
  });

  it("surfaces a project that needs attention above a busier but calmer one", () => {
    const calm = project({ id: "local::/repo/calm", label: "calm" });
    const busy = project({ id: "local::/repo/busy", label: "busy" });
    const groups = groupByProject({
      projects: [calm, busy],
      tasks: [
        task({ id: "a", projectId: calm.id, status: "running", updatedAt: "2026-09-13T12:00:00Z" }),
        task({ id: "b", projectId: busy.id, status: "needs-attention", updatedAt: "2026-09-13T09:00:00Z" }),
      ],
    });
    expect(groups[0]?.project.label).toBe("busy");
  });

  it("pins first, then orders by recency, and never loses an orphaned task", () => {
    const groups = groupByProject({
      projects: [project()],
      tasks: [
        task({ id: "old", updatedAt: "2026-09-01T00:00:00Z" }),
        task({ id: "new", updatedAt: "2026-09-13T00:00:00Z" }),
        task({ id: "pinned", pinned: true, updatedAt: "2026-08-01T00:00:00Z" }),
        // Its project is not in the list (removed on another client, or on an unpaired host).
        task({ id: "orphan", projectId: "workstation::/srv/site", hostId: "workstation" }),
      ],
    });
    expect(groups[0]?.rows.map((row) => row.task.id)).toEqual(["pinned", "new", "old"]);
    const orphan = groups.find((group) => group.project.label === "Unknown project");
    expect(orphan?.rows[0]?.task.id).toBe("orphan");
  });

  it("hides archived work unless asked, and can focus one project", () => {
    const projects = [project(), project({ id: "local::/repo/b", label: "b", path: "/repo/b" })];
    const tasks = [
      task({ id: "live" }),
      task({ id: "archived", archivedAt: "2026-09-12T00:00:00Z" }),
      task({ id: "other", projectId: "local::/repo/b" }),
    ];
    expect(flattenRows(groupByProject({ projects, tasks })).map((r) => r.task.id)).toEqual([
      "live",
      "other",
    ]);
    expect(
      flattenRows(groupByProject({ projects, tasks, includeArchived: true })).length,
    ).toBe(3);
    expect(
      flattenRows(groupByProject({ projects, tasks, onlyProjectId: "local::/repo/b" })).map(
        (r) => r.task.id,
      ),
    ).toEqual(["other"]);
  });
});

describe("search", () => {
  it("matches the title, the project label and the path — people search for any of the three", () => {
    const groups = groupByProject({
      projects: [project({ label: "payments" })],
      tasks: [
        task({ id: "t", title: "Idempotency keys" }),
        task({ id: "p", title: "unrelated", cwd: "/repo/payments-api" }),
      ],
    });
    expect(filterRows(groups, { text: "idempotency" }).flatMap((g) => g.rows).map((r) => r.task.id)).toEqual(["t"]);
    expect(filterRows(groups, { text: "payments" }).flatMap((g) => g.rows).length).toBe(2);
    expect(filterRows(groups, { text: "nothing here" })).toEqual([]);
  });

  it("filters by status, agent and host without touching the tree's shape", () => {
    const groups = groupByProject({
      projects: [project()],
      tasks: [
        task({ id: "r", status: "running" }),
        task({ id: "f", status: "failed", harness: "codex" }),
      ],
    });
    expect(filterRows(groups, { statuses: ["failed"] }).flatMap((g) => g.rows)[0]?.task.id).toBe("f");
    expect(filterRows(groups, { harnesses: ["codex"] }).flatMap((g) => g.rows)[0]?.task.id).toBe("f");
    expect(filterRows(groups, { hostIds: ["elsewhere"] })).toEqual([]);
  });
});

describe("attention", () => {
  it("counts what needs a human, newest first, in one place", () => {
    const summary = attentionSummary([
      task({ id: "a", status: "needs-attention", updatedAt: "2026-09-13T10:00:00Z" }),
      task({ id: "b", status: "needs-attention", updatedAt: "2026-09-13T11:00:00Z" }),
      task({ id: "c", status: "failed" }),
      task({ id: "d", status: "running" }),
    ]);
    expect(summary.badge).toBe(3);
    expect(summary.needsAttention.map((w) => w.id)).toEqual(["b", "a"]);
    expect(summary.failed.map((w) => w.id)).toEqual(["c"]);
  });

  it("counts active and finished work per project", () => {
    expect(
      countStatuses([
        task({ status: "queued" }),
        task({ status: "running" }),
        task({ status: "done" }),
        task({ status: "failed" }),
      ]),
    ).toEqual({ total: 4, active: 2, needsAttention: 1, done: 1, failed: 1 });
  });

  it("says a status in words a user reads, not in the internal bucket's words", () => {
    expect(statusLabel("needs-attention")).toBe("Needs your answer");
    expect(statusLabel("failed")).toBe("Stopped with an error");
    expect(statusLabel("running")).toBe("Working");
  });
});

describe("naming a task from its first prompt", () => {
  it("takes the first line, because that is the request", () => {
    expect(taskTitleFromPrompt("Fix the failing test\n\nIt broke when I rebased.")).toBe(
      "Fix the failing test",
    );
  });

  it("collapses whitespace rather than keeping a ragged row", () => {
    expect(taskTitleFromPrompt("  add   a   health check \n")).toBe("add a health check");
  });

  it("cuts long prompts on a word boundary, and hard when there is none", () => {
    const long =
      "Refactor the authentication middleware so that every provider shares one session store";
    const title = taskTitleFromPrompt(long, 60);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(title)).toBe(true);
    expect(title.endsWith(" ")).toBe(false);
    // A single unbroken token cannot be cut on a space, so it is cut rather than left at full length.
    expect(taskTitleFromPrompt("x".repeat(100), 60)).toHaveLength(60);
  });

  it("returns nothing for a prompt that is nothing", () => {
    // The caller leaves the task untitled, which the rail renders as this app's word for "unnamed"
    // rather than an empty row.
    expect(taskTitleFromPrompt("   \n  ")).toBe("");
  });
});
