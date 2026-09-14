/**
 * The third settings scope, from the sidebar row to the daemon.
 *
 * ## What this proves that the pane's own tests cannot
 *
 * `settings-language.test.tsx` renders `SettingsPane` directly, with a project handed to it. That
 * proves the pane can render a project's defaults; it cannot prove the scope is *reachable*, and it
 * cannot prove the pane is looking at the **live** project rather than a copy of it taken when the
 * button was clicked. Both are shell-level facts, so both are asserted through `CoderApp`.
 *
 * The second one is not hypothetical. `Project.defaults` **replace** rather than merge
 * (`daemon/store.ts:293-308`: a patch carrying only a model would otherwise leave the project's agent
 * undefined, so the whole object is written), which means the pane has to send the values it is *not*
 * changing along with the one it is. Storing the project object the sidebar handed over meant those
 * values came from a snapshot: change the model, then the agent, and the model was written away by the
 * second edit — with the pane still showing the first as if it had stuck. The id is what fixes it, and
 * the "carries the values it does not touch" test below is the one that fails on the snapshot.
 *
 * ## Why the fixture re-renders instead of mocking
 *
 * `updateProject` is a round trip: the daemon stores the defaults and the window refetches. The mock
 * action here answers `{ok: true}` and does nothing, so the test rerenders with the state the daemon
 * *would* have produced. That is the honest shape — the assertion is about what the second edit sends
 * after the first has landed, and a test that never let the first land would pass on the snapshot bug.
 */

/** @vitest-environment jsdom */
import type { JSX } from "react";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

/** Two agents, so the scope's agent picker has something to switch between. */
const harnesses: CoderState["harnesses"] = (["envoy-harness", "deepseek-harness"] as const).map((id) => ({
  id,
  label: id === "envoy-harness" ? "Envoy Harness" : "DeepSeek Harness",
  tier: id === "envoy-harness" ? ("built-in" as const) : ("catalogued" as const),
  summary: "…",
  modes: [],
  models: {
    kind: "listed" as const,
    options: [
      { id: "deepseek/deepseek-chat", label: "deepseek-chat", provider: "deepseek", model: "deepseek-chat" },
    ],
    source: "…",
  },
  thinking: { kind: "none" as const, options: [], source: "…" },
  capabilities: {
    resume: true,
    cancel: true,
    approvals: true,
    structuredTools: true,
    streaming: true,
    images: false,
    agentMode: true,
    model: true,
    thinking: true,
    approvalPolicy: true,
  },
  available: true,
  evidence: "…",
}));

function stateWith(over: Partial<CoderState> = {}): CoderState {
  return {
    connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
    resolved: undefined,
    hello: undefined,
    projects: [project],
    tasks: [],
    tasksKnown: true,
    settings,
    harnesses,
    mesh: { kind: "no-node", reason: "" },
    runs: {},
    loaded: true,
    error: undefined,
    notes: [],
    ...over,
  };
}

/** Render the shell, and hand back the two things a scope test needs: the view and the writer. */
function show(over: Partial<CoderState> = {}): {
  updateProject: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
  removeProject: ReturnType<typeof vi.fn>;
  rerender: (next: Partial<CoderState>) => void;
} {
  const updateProject = vi.fn(async () => ({ ok: true as const, project }));
  const updateSettings = vi.fn(async () => ({ ok: true as const }));
  const removeProject = vi.fn(async (): Promise<unknown> => ({ ok: true }));
  const actions = {
    createTask: vi.fn(),
    startRun: vi.fn(),
    updateTask: vi.fn(async () => ({ ok: true as const })),
    addProject: vi.fn(),
    removeProject,
    archiveTask: vi.fn(),
    updateProject,
    openTask: vi.fn(),
    sendToRun: vi.fn(),
    cancelRun: vi.fn(),
    answerApproval: vi.fn(),
    updateSettings,
    clearError: vi.fn(),
  } as unknown as CoderStore;

  const view = (next: Partial<CoderState>): JSX.Element => (
    <I18nProvider preference="en">
      <CoderApp state={stateWith(next)} actions={actions} />
    </I18nProvider>
  );
  const { rerender: rerenderRaw } = render(view(over));
  return {
    updateProject,
    updateSettings,
    removeProject,
    rerender: (next) => rerenderRaw(view({ ...over, ...next })),
  };
}

/**
 * Reach one project's defaults the way a user does now: the row's `…`, then "Project settings".
 *
 * It used to be one click — the `⋯` **was** project settings, which is why its accessible name said so.
 * The row's button is a menu these days and the item is inside it, so the assertions below are about the
 * same journey, one leg longer. What they still prove is unchanged: the scope is reachable from the
 * project's own row, and the pane it opens is looking at the *live* project rather than a snapshot.
 */
const openProject = (label: string): void => {
  fireEvent.click(screen.getByLabelText(`Actions for ${label}`));
  const menu = screen.getByRole("menu", { name: `Actions for ${label}` });
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Project settings" }));
};

describe("a project's settings on the project's own row", () => {
  it("opens the project's defaults, not this machine's", () => {
    // The defect this replaces: the button was labelled "Project settings for api" and opened the app
    // pane, with the project dropped on the floor. Asserted on the pane's *title*, which is built from
    // the project's label, and on a row only the project scope has.
    show();
    openProject("api");

    expect(screen.getByRole("heading", { name: "Project settings for api" })).toBeTruthy();
    expect(screen.getByLabelText("The agent new tasks here start with")).toBeTruthy();
    // And the app scope is not what is on screen: its own heading group is absent.
    expect(screen.queryByRole("heading", { name: "Safety" })).toBeNull();
  });

  it("writes the chosen agent through to the daemon, with the project's id", async () => {
    const { updateProject } = show();
    openProject("api");

    fireEvent.change(screen.getByLabelText("The agent new tasks here start with"), {
      target: { value: "deepseek-harness" },
    });

    await vi.waitFor(() => expect(updateProject).toHaveBeenCalled());
    expect(updateProject).toHaveBeenCalledWith({
      id: project.id,
      defaults: { harness: "deepseek-harness" },
    });
  });

  it("carries the values it does not touch, because a project's defaults replace", async () => {
    // **The snapshot bug, which is what this file exists for.** A project already running on a chosen
    // model, then the user changes the agent. The write must carry the model, or the daemon — which
    // replaces the whole `defaults` object — stores a project with no model at all, and the next task
    // in it silently starts on the agent's own default instead.
    const { updateProject } = show({
      projects: [{ ...project, defaults: { model: "deepseek/deepseek-chat" } }],
    });
    openProject("api");

    // The model row shows what the project holds — the scope reads the project, not a default.
    const model = screen.getByLabelText("The model new tasks here start on") as HTMLSelectElement;
    expect(model.value).toBe("deepseek/deepseek-chat");

    fireEvent.change(screen.getByLabelText("The agent new tasks here start with"), {
      target: { value: "deepseek-harness" },
    });

    await vi.waitFor(() => expect(updateProject).toHaveBeenCalled());
    expect(updateProject).toHaveBeenCalledWith({
      id: project.id,
      defaults: { model: "deepseek/deepseek-chat", harness: "deepseek-harness" },
    });
  });

  it("sends the second edit with the first one's value once the daemon has stored it", async () => {
    // The same property with a round trip between the two edits, which is what a user actually does:
    // pick a model, watch it save, then pick an agent. The pane is looking at `state.projects`, so the
    // value the first edit stored is what the second edit carries. A pane holding the object it was
    // handed at click time sends only `{harness}` here and silently drops the model.
    const { updateProject, rerender } = show();
    openProject("api");

    fireEvent.change(screen.getByLabelText("The model new tasks here start on"), {
      target: { value: "deepseek/deepseek-chat" },
    });
    await vi.waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1));

    // What the daemon would now hold, and therefore what the window would refetch.
    rerender({ projects: [{ ...project, defaults: { model: "deepseek/deepseek-chat" } }] });

    fireEvent.change(screen.getByLabelText("The agent new tasks here start with"), {
      target: { value: "deepseek-harness" },
    });

    await vi.waitFor(() => expect(updateProject).toHaveBeenCalledTimes(2));
    expect(updateProject).toHaveBeenLastCalledWith({
      id: project.id,
      defaults: { model: "deepseek/deepseek-chat", harness: "deepseek-harness" },
    });
  });

  it("falls back to this machine when the project is removed from its own row", async () => {
    // The same fallback, reached deliberately instead of from another window — and the half the daemon
    // cannot do for us. `coder.removeProject` drops the row and archives that project's tasks; which pane
    // is open is the window's own business, and a pane still titled "Project settings for api" for a
    // project that no longer exists is exactly what this asserts is not rendered.
    const { removeProject, rerender } = show();
    openProject("api");
    expect(screen.getByRole("heading", { name: "Project settings for api" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Actions for api"));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Actions for api" })).getByRole("menuitem", {
        name: "Remove project",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Remove this project" })).getByRole("button", {
        name: "Remove project",
      }),
    );

    await vi.waitFor(() => expect(removeProject).toHaveBeenCalledWith(project.id));
    // The fallback happens on the *answer*, not on the refetch: `state.projects` still holds this project
    // at this point, and the pane is already this machine's — which is what keeps the window from
    // spending a frame on a project that no longer exists.
    await vi.waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Project settings for api" })).toBeNull(),
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();

    rerender({ projects: [] });
    expect(screen.queryByRole("heading", { name: "Project settings for api" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("falls back to this machine's settings when the project is gone", () => {
    // Removed in another window while this one had the pane open. The pane is titled "Settings" and
    // its rows are this machine's — nothing claims to be editing a project that no longer exists, and
    // a row that wrote to it would fail with "no such project" for a button the user never pressed.
    const { rerender } = show();
    openProject("api");
    expect(screen.getByRole("heading", { name: "Project settings for api" })).toBeTruthy();

    rerender({ projects: [] });

    expect(screen.queryByRole("heading", { name: "Project settings for api" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  });
});
