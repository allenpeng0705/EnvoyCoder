/**
 * The sidebar, rendered from fixtures.
 *
 * Two things are asserted that a pure-logic test cannot reach: that the tree actually *renders*
 * (a component that throws on a missing field passes every unit test in `task-model`), and
 * that the project → task relationship is visible — a group whose header names the agent its
 * children inherit, with the tasks under it.
 *
 * `jsdom` is configured per file so the rest of the suite stays on Node.
 */

/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoderSidebar } from "../src/components/CoderSidebar.js";
import type { Project, Task } from "@envoycoder/protocol";

/**
 * Fixtures, local to this test.
 *
 * They used to come from `src/data/sample.ts`, which is gone: the window renders what the daemon
 * says now, and a component test that imported the app's fixtures would have kept them alive for a
 * purpose nobody had. A test that needs specific rows should say which rows, which is also what
 * makes a failure readable.
 */
const SAMPLE_PROJECTS: readonly Project[] = [
  {
    id: "local::/Users/dev/work/envoymesh",
    path: "/Users/dev/work/envoymesh",
    label: "envoymesh",
    hostId: "local",
    addedAt: "2026-09-01T09:00:00.000Z",
    defaults: { harness: "envoy-harness" },
  },
  {
    id: "local::/Users/dev/work/payments-api",
    path: "/Users/dev/work/payments-api",
    label: "payments-api",
    hostId: "local",
    addedAt: "2026-09-05T11:30:00.000Z",
    defaults: { harness: "claudecode" },
  },
  // A project with nothing in it yet, and one whose tasks run elsewhere. Both are states a
  // happy-path fixture hides, and both are where the rail's layout breaks: an empty group with no
  // children, and a row whose machine has to be visible without a tooltip.
  {
    id: "workstation::/srv/site",
    path: "/srv/site",
    label: "site",
    hostId: "workstation",
    addedAt: "2026-09-09T08:15:00.000Z",
    defaults: { harness: "deepseek-harness" },
  },
];

const SAMPLE_TASKS: readonly Task[] = [
  {
    id: "w1",
    projectId: "local::/Users/dev/work/envoymesh",
    cwd: "/Users/dev/work/envoymesh",
    title: "Wire product attach into the new node service",
    harness: "envoy-harness",
    status: "running",
    createdAt: "2026-09-13T10:00:00.000Z",
    updatedAt: "2026-09-13T10:42:00.000Z",
  },
  {
    id: "w2",
    projectId: "local::/Users/dev/work/envoymesh",
    cwd: "/Users/dev/work/envoymesh",
    title: "Review the migration diff",
    harness: "envoy-harness",
    status: "needs-attention",
    createdAt: "2026-09-13T09:10:00.000Z",
    updatedAt: "2026-09-13T10:38:00.000Z",
  },
  {
    id: "w3",
    projectId: "local::/Users/dev/work/payments-api",
    cwd: "/Users/dev/work/payments-api",
    title: "Add idempotency keys to the refund endpoint",
    harness: "claudecode",
    model: "anthropic/claude-sonnet-4.5",
    status: "failed",
    createdAt: "2026-09-12T16:00:00.000Z",
    updatedAt: "2026-09-12T16:31:00.000Z",
  },
  {
    id: "w4",
    projectId: "workstation::/srv/site",
    cwd: "/srv/site",
    title: "Rebuild the marketing site on the workstation",
    harness: "deepseek-harness",
    status: "queued",
    hostId: "workstation",
    createdAt: "2026-09-13T10:30:00.000Z",
    updatedAt: "2026-09-13T10:30:00.000Z",
  },
];

// Testing-library only auto-cleans when vitest globals are enabled, which this repo does not do
// (an explicit import list is easier to read in a diff). Without this, each `render` leaves its DOM
// behind and the third test finds two of everything.
afterEach(cleanup);

function renderSidebar(over: Partial<Parameters<typeof CoderSidebar>[0]> = {}) {
  const onSelect = vi.fn();
  const onNewTask = vi.fn();
  render(
    <CoderSidebar
      projects={SAMPLE_PROJECTS}
      tasks={SAMPLE_TASKS}
      onSelect={onSelect}
      onNewTask={onNewTask}
      onAddProject={vi.fn()}
      onOpenProjectSettings={vi.fn()}
      onOpenCommandCenter={vi.fn()}
      onOpenSettings={vi.fn()}
      {...over}
    />,
  );
  return { onSelect, onNewTask };
}

describe("CoderSidebar", () => {
  it("renders a project as a place, with its default agent on the header", () => {
    renderSidebar();
    const group = screen.getByTestId("project-envoymesh");
    // The header names the agent new tasks inherit — the relationship the design is built on.
    // Asserted on the header badge specifically: the same label also appears on each row that
    // uses that agent, and `getByText` would find either.
    const headerBadge = within(group).getByTitle("The agent new tasks in this project start with");
    expect(headerBadge.textContent).toBe("Envoy Harness");
    expect(within(group).getByText("Tasks")).toBeTruthy();
    // …and the tasks under it.
    expect(within(group).getByText("Wire product attach into the new node service")).toBeTruthy();
    expect(within(group).getByText("Review the migration diff")).toBeTruthy();
  });

  it("shows every project, including one with no work in it yet", () => {
    renderSidebar();
    for (const label of ["envoymesh", "payments-api", "site"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("counts what needs a human, once, in the rail", () => {
    renderSidebar();
    // One needs-attention task plus one failed task in the fixtures.
    expect(screen.getByText("2 tasks need you")).toBeTruthy();
  });

  it("says a task on another machine is on another machine", () => {
    renderSidebar();
    expect(screen.getByText("workstation")).toBeTruthy();
  });

  it("shows the end-user wording for a status, not the internal bucket", () => {
    renderSidebar();
    expect(screen.getAllByText("Needs your answer").length).toBeGreaterThan(0);
    expect(screen.queryByText("needs-attention")).toBeNull();
  });

  it("tells a new user what to do when there are no projects", () => {
    renderSidebar({ projects: [], tasks: [] });
    expect(screen.getByText("No projects yet")).toBeTruthy();
    expect(screen.getByText(/Add a directory you work in/)).toBeTruthy();
  });

  it("does not claim there are no projects when it could not ask", () => {
    // The failure the user actually hit: the project was registered and on disk, the window could not
    // read the list, and the rail said "No projects yet" — which reads as "the app lost my work".
    // An unknown list and an empty list are different sentences, and the reason belongs on screen.
    renderSidebar({
      projects: [],
      tasks: [],
      unavailable:
        "The daemon this window is talking to is an older build: it does not know coder.listTasks.",
    });
    expect(screen.queryByText("No projects yet")).toBeNull();
    expect(screen.getByText("Could not read your projects")).toBeTruthy();
    expect(screen.getByText(/unknown, not empty/)).toBeTruthy();
    expect(screen.getByText(/does not know coder\.listTasks/)).toBeTruthy();
  });

  it("reports a click on a task to the shell", async () => {
    const { onSelect } = renderSidebar();
    screen.getByTestId("task-w1").click();
    expect(onSelect).toHaveBeenCalledWith("w1");
  });
});
