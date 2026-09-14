/**
 * "+ New" opens a chat, it does not open a form.
 *
 * Paseo's model, in the user's words: *"new workspace is to start a new chat session and it gave the
 * chatting UI directly"*. This drives the shell itself — the button in the rail's project header — because
 * the difference between "asks for a prompt" and "opens the chat" lives in `CoderApp`'s wiring and is
 * invisible from the palette's own tests.
 *
 * The state is a fixture, so the new task cannot appear in it; what is asserted is the *decision*: a task
 * is created with no title, nothing is started, and no palette is opened. The rest of the flow — the
 * daemon accepting an empty title, the rail showing it, the first message starting and naming it — is
 * covered by `scripts/smoke.ts` against a real daemon and by `task-model`'s naming tests.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings, Project } from "@envoycoder/protocol";

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

function stateWith(over: Partial<CoderState> = {}): CoderState {
  return {
    connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
    resolved: undefined,
    hello: undefined,
    projects: [project],
    tasks: [],
    tasksKnown: true,
    settings,
    harnesses: [],
    providers: [],
    mesh: { kind: "no-node", reason: "" },
    runs: {},
    loaded: true,
    error: undefined,
    notes: [],
    ...over,
  };
}

function show(over: Partial<CoderState> = {}): {
  createTask: ReturnType<typeof vi.fn>;
  startRun: ReturnType<typeof vi.fn>;
} {
  const createTask = vi.fn(async () => ({
    ok: true as const,
    task: {
      id: "local::/work/api::task::20260914120000",
      projectId: project.id,
      title: "",
      cwd: project.path,
      harness: "envoy-harness" as const,
      status: "idle" as const,
      createdAt: "2026-09-14T12:00:00.000Z",
      updatedAt: "2026-09-14T12:00:00.000Z",
      hostId: "local",
    },
  }));
  const startRun = vi.fn(async () => ({ ok: true as const, run: { id: "run-1" } }));
  const actions = {
    createTask,
    startRun,
    updateTask: vi.fn(async () => ({ ok: true as const })),
    addProject: vi.fn(),
    removeProject: vi.fn(),
    openTask: vi.fn(),
    sendToRun: vi.fn(),
    cancelRun: vi.fn(),
    answerApproval: vi.fn(),
    updateSettings: vi.fn(),
    clearError: vi.fn(),
  } as unknown as CoderStore;

  render(
    <I18nProvider preference="en">
      <CoderApp state={stateWith(over)} actions={actions} />
    </I18nProvider>,
  );
  return { createTask, startRun };
}

describe("starting a task from the rail", () => {
  it("creates it and opens the chat, without asking for a prompt", async () => {
    const { createTask, startRun } = show();
    // The project header's action, which is what a user clicks to start work in a project.
    fireEvent.click(screen.getByText("+ New"));

    await vi.waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask).toHaveBeenCalledWith({ projectId: project.id, title: "" });
    // **Nothing runs yet.** A task that starts on creation would be an agent working on an empty prompt.
    expect(startRun).not.toHaveBeenCalled();
    // And no palette: the chat is the form. The composer itself is asserted in `task-pane.test.tsx`
    // ("starts the run from the first message"), which is where a selected task with no run is rendered.
    expect(document.querySelector(".palette")).toBeNull();
  });

  it("reuses the empty chat it already opened, instead of leaving a second unnamed row", () => {
    // Pressing "+ New" twice is what a user does when the first press looks like nothing happened; the
    // draft is the answer to that, and the task they have already talked to is work, not a draft.
    const { createTask } = show({
      tasks: [
        {
          id: "draft-1",
          projectId: project.id,
          title: "",
          cwd: project.path,
          harness: "envoy-harness",
          status: "idle",
          createdAt: "2026-09-14T12:00:00.000Z",
          updatedAt: "2026-09-14T12:00:00.000Z",
          hostId: "local",
        },
      ],
    });
    fireEvent.click(screen.getByText("+ New"));
    expect(createTask).not.toHaveBeenCalled();
  });

  it("shows the untitled task as this app's word for it, not an empty row", () => {
    show({
      tasks: [
        {
          id: "t1",
          projectId: project.id,
          title: "",
          cwd: project.path,
          harness: "envoy-harness",
          status: "idle",
          createdAt: "2026-09-14T12:00:00.000Z",
          updatedAt: "2026-09-14T12:00:00.000Z",
          hostId: "local",
        },
      ],
    });
    expect(screen.getAllByText("Untitled").length).toBeGreaterThan(0);
  });
});
