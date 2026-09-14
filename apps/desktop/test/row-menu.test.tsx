/**
 * The row menus, from the click to the daemon call.
 *
 * ## Why this file exists next to `sidebar.test.tsx`
 *
 * That file proves the menu *behaves* — it opens, it lists the right items, the arrows move, Escape
 * closes, the destructive item asks before it does anything. This one proves the other half, which its
 * stubs cannot: that the item a user actually chooses reaches `CoderStore` with the right id and the
 * right arguments, through `CoderApp`, and that what the daemon does next is rendered.
 *
 * The distinction is the repo's own lesson (`AGENTS.md`, "Tests and the bundle are different proofs"): a
 * menu whose items call `props.onRemove(…)` that nothing ever passes is a menu that looks finished and
 * removes nothing. `removeProject` and `archiveTask` are the two calls this feature exists to reach.
 *
 * ## Why the removal is asserted in two steps rather than one
 *
 * The delete itself is the daemon's: it drops the project row and archives that project's tasks, and
 * archives one task. What the window owns is (a) asking with the argument the daemon needs, and (b)
 * rendering what comes back — including a refusal, which must reach the user rather than vanish. So the
 * fixtures below answer the mock action and then rerender with the state the daemon would have produced,
 * on `settings-scope.test.tsx`'s rule: a test that never lets the answer land cannot see the difference.
 */

/** @vitest-environment jsdom */
import type { JSX } from "react";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings, Project, Task } from "@envoycoder/protocol";

import { CoderApp } from "../src/components/CoderApp.js";
import { I18nProvider } from "../src/i18n/context.js";
import type { CoderState, CoderStore } from "../src/state/coderStore.js";

afterEach(cleanup);

const settings: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "en",
};

const project: Project = {
  id: "local::/work/api",
  path: "/work/api",
  label: "api",
  hostId: "local",
  addedAt: "2026-09-01T09:00:00.000Z",
};

const task: Task = {
  id: "local::/work/api::task::1",
  projectId: project.id,
  cwd: project.path,
  title: "Add idempotency keys",
  harness: "envoy-harness",
  status: "idle",
  createdAt: "2026-09-14T12:00:00.000Z",
  updatedAt: "2026-09-14T12:00:00.000Z",
  hostId: "local",
};

function stateWith(over: Partial<CoderState> = {}): CoderState {
  return {
    connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
    resolved: undefined,
    hello: undefined,
    projects: [project],
    tasks: [task],
    tasksKnown: true,
    settings,
    harnesses: [],
    mesh: { kind: "no-node", reason: "" },
    runs: {},
    loaded: true,
    error: undefined,
    notes: [],
    ...over,
  };
}

/** Render the shell and hand back the two actions this file exists to watch. */
function show(over: Partial<CoderState> = {}): {
  removeProject: ReturnType<typeof vi.fn>;
  archiveTask: ReturnType<typeof vi.fn>;
  updateTask: ReturnType<typeof vi.fn>;
  rerender: (next: Partial<CoderState>) => void;
} {
  // `Promise<unknown>` on purpose: one test below answers with a refusal, and a mock typed to the success
  // shape would make the refusal unwritable — which is how a refusal path ends up untested.
  const removeProject = vi.fn(async (): Promise<unknown> => ({ ok: true }));
  const archiveTask = vi.fn(async (): Promise<unknown> => ({ ok: true, task }));
  const updateTask = vi.fn(async (): Promise<unknown> => ({ ok: true, task }));
  const actions = {
    createTask: vi.fn(),
    startRun: vi.fn(),
    updateTask,
    addProject: vi.fn(),
    removeProject,
    archiveTask,
    updateProject: vi.fn(),
    openTask: vi.fn(),
    sendToRun: vi.fn(),
    cancelRun: vi.fn(),
    answerApproval: vi.fn(),
    updateSettings: vi.fn(),
    clearError: vi.fn(),
  } as unknown as CoderStore;

  const view = (next: Partial<CoderState>): JSX.Element => (
    <I18nProvider preference="en">
      <CoderApp state={stateWith(next)} actions={actions} />
    </I18nProvider>
  );
  const { rerender: rerenderRaw } = render(view(over));
  return {
    removeProject,
    archiveTask,
    updateTask,
    rerender: (next) => rerenderRaw(view({ ...over, ...next })),
  };
}

/** Open a row's menu and take one of its items, the way the two clicks do. */
function choose(label: string, item: string): void {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(within(screen.getByRole("menu", { name: label })).getByRole("menuitem", { name: item }));
}

/** Answer the question the destructive item asks. */
function confirmRemoval(ariaLabel: string, cta: string): void {
  const card = screen.getByRole("alertdialog", { name: ariaLabel });
  fireEvent.click(within(card).getByRole("button", { name: cta }));
}

describe("removing a project, from its row to the daemon", () => {
  it("calls coder.removeProject with that project's id, and the rail drops the row", async () => {
    const { removeProject, rerender } = show();

    choose("Actions for api", "Remove project");
    confirmRemoval("Remove this project", "Remove project");

    await vi.waitFor(() => expect(removeProject).toHaveBeenCalledWith(project.id));
    // The daemon removes the row and archives the project's tasks, and the window refetches. What the
    // rail must then show is a rail with neither the project nor its task — an archived row that stayed
    // on screen would make the confirmation a lie.
    rerender({ projects: [], tasks: [] });
    expect(screen.queryByText("api")).toBeNull();
    expect(screen.queryByText("Add idempotency keys")).toBeNull();
    // The rail's own empty state, scoped to the rail: the work area shows the same words when there is
    // nothing to work on, and an unscoped `getByText` would find both.
    expect(within(screen.getByTestId("task-list")).getByText("No projects yet")).toBeTruthy();
  });

  it("says so when the daemon refuses, rather than looking like it worked", async () => {
    // A row that silently stayed put after the user said "remove" reads as a broken button. The refusal
    // carries the daemon's own sentence, and the strip is where refusals go.
    const { removeProject } = show();
    removeProject.mockResolvedValueOnce({ ok: false as const, message: "No such project: local::/work/api." });

    choose("Actions for api", "Remove project");
    confirmRemoval("Remove this project", "Remove project");

    await vi.waitFor(() => expect(removeProject).toHaveBeenCalled());
    expect(await screen.findByText("No such project: local::/work/api.")).toBeTruthy();
    expect(screen.getByText("api")).toBeTruthy();
  });
});

describe("removing a task, from its row to the daemon", () => {
  it("archives it — not deletes it — and the pane it was open in falls back", async () => {
    const { archiveTask, rerender } = show();
    // Open the task first, so what the removal does to the *pane* is on screen to be asserted. The
    // testid is the one the rail has always carried — `task-` plus the id — because it names the control
    // that *selects* the task, which is the assertion two files over as well.
    fireEvent.click(screen.getByTestId(`task-${task.id}`));
    // The click has to have *selected* the task, or the second half of this test would pass for the wrong
    // reason: a pane that was never open is also a pane that shows "No task open" afterwards.
    expect(screen.getByLabelText("Message the agent")).toBeTruthy();

    choose("Actions for Add idempotency keys", "Remove task");
    confirmRemoval("Remove this task", "Remove");

    // `archiveTask(id, true)` and not a delete: the daemon hides the task, and the folder, the files and
    // the transcript on disk are untouched — which is what the question the user just answered said.
    await vi.waitFor(() => expect(archiveTask).toHaveBeenCalledWith(task.id, true));
    rerender({ tasks: [] });
    expect(screen.queryByText("Add idempotency keys")).toBeNull();
    // Nothing is open any more, and the work area says which of the three reasons applies.
    expect(screen.getByText("No task open")).toBeTruthy();
  });
});

describe("renaming a task, from its row to the daemon", () => {
  it("sends the new title on coder.updateTask", async () => {
    const { updateTask } = show();

    choose("Actions for Add idempotency keys", "Rename");
    const field = screen.getByLabelText("New name for this task");
    fireEvent.change(field, { target: { value: "Add idempotency keys to refunds" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await vi.waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith({ id: task.id, title: "Add idempotency keys to refunds" }),
    );
  });
});
