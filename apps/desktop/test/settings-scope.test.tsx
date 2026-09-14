/**
 * The settings navigation model, from the rail to the daemon — **three levels in one pane**.
 *
 * ## What this proves that the pane's own tests cannot
 *
 * `settings-language.test.tsx` renders `SettingsPane` directly, with a scope handed to it. That
 * proves the pane can render each level; it cannot prove the levels are *reachable from each other*,
 * and it cannot prove the pane is looking at the **live** project rather than a copy of it taken when
 * the row was pressed. Both are shell-level facts, so both are asserted through `CoderApp`.
 *
 * The second one is not hypothetical. `Project.defaults` **replace** rather than merge
 * (`daemon/store.ts:293-308`: a patch carrying only a model would otherwise leave the project's agent
 * undefined, so the whole object is written), which means the pane has to send the values it is *not*
 * changing along with the one it is. Storing the project object the sidebar handed over meant those
 * values came from a snapshot: change the model, then the agent, and the model was written away by the
 * second edit — with the pane still showing the first as if it had stuck. The **id** is what fixes it —
 * today the scope holds it and `settings-scope.ts`'s `scopeProject` resolves it against `state.projects`
 * on every render — and the "carries the values it does not touch" test below is the one that fails on
 * the snapshot. It was re-broken deliberately, by resolving the project once in a `useState`, to check
 * that it still catches it (the mutation table is in the commit that added this restructure).
 *
 * ## The three levels, and the journey each test walks
 *
 * | | title | arrived at by | leaves by |
 * |---|---|---|---|
 * | 1 | *Settings* | the rail's footer button (⌘, is bound to the same function) | — it is the root |
 * | 2 | *Projects* | the **Projects** row at level 1 | *← All settings* |
 * | 3 | *Project settings for api* | a row of level 2, or the rail's project `…` menu | *← Projects* |
 *
 * Every test below starts at the rail's footer button rather than at `CoderApp`'s initial state,
 * because that is the only entry the owner's brief names, and a journey that starts halfway is a
 * journey that can be broken at the first step without a test noticing.
 *
 * ## What moved when the list became a page, and what did not
 *
 * The app scope's *Projects* section is now one navigable row carrying the count, and the list it held
 * is level 2. So the assertions that lived in `describe("the Projects section in the app scope")` are
 * here, at the level they now describe — **none were deleted**: "lists every project it was given" and
 * its path assertions moved to the page, the empty state moved with them (and is now reached *through*
 * the row, which is what makes the row's presence with no projects a fact worth asserting), "opens the
 * settings of the row that was pressed, by id" moved, and the old "goes back to this machine's settings"
 * became the *new* level-2 back control — the same control, one level up, now with a first leg to walk.
 * Level 3's back control is new because its destination is new, and it is asserted separately: the whole
 * point of the pair is that they must not say the same thing.
 *
 * The two fallback tests changed **destination**, not shape: a project that goes away while its settings
 * are open now lands on the projects page rather than on this machine's settings. That is the decision
 * this restructure makes, and `settings-scope.ts`'s module doc is the argument — the short version is
 * that the fallback now does whatever the level-3 back control would have done, which is the one
 * sentence a user already knows.
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
import {
  APP_SCOPE,
  PROJECTS_SCOPE,
  projectScope,
  resolveScope,
  scopeProjectId,
} from "../src/state/settings-scope.js";

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

/**
 * A second project, and it is here for one reason: with two, "the row opened a project's settings" and
 * "the row opened *that* project's settings" are different claims, and the second is the one a list of
 * rows can get wrong while passing a test written against a single-project fixture.
 */
const otherProject: Project = {
  id: "local::/work/web",
  path: "/work/web",
  label: "web",
  hostId: "local",
  addedAt: "2026-09-02T09:00:00.000Z",
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
 * Reach one project's defaults from the rail, the way a user did before the list existed: the row's
 * `…`, then "Project settings".
 *
 * It used to be one click — the `⋯` **was** project settings, which is why its accessible name said so.
 * The row's button is a menu these days and the item is inside it, so the assertions below are about the
 * same journey, one leg longer. What they still prove is unchanged: the scope is reachable from the
 * project's own row, and the pane it opens is looking at the *live* project rather than a snapshot.
 * This is also one of the two routes into level 3, and the tests that walk both compare the two — a
 * route that skipped a level would land somewhere else.
 */
const openProject = (label: string): void => {
  fireEvent.click(screen.getByLabelText(`Actions for ${label}`));
  const menu = screen.getByRole("menu", { name: `Actions for ${label}` });
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Project settings" }));
};

/** The projects page's row for one project, named with the words of the pane it opens. */
const rowFor = (label: string): HTMLElement =>
  screen.getByRole("button", { name: `Project settings for ${label}` });

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
    // handed at click time sends only `{harness}` here and silently drops the model — which is the
    // mutation this test was checked against.
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

  it("falls back to the projects page when the project is removed from its own row", async () => {
    // The same fallback, reached deliberately instead of from another window — and the half the daemon
    // cannot do for us. `coder.removeProject` drops the row and archives that project's tasks; which
    // level is open is the window's own business, and a pane still titled "Project settings for api" for
    // a project that no longer exists is exactly what this asserts is not rendered.
    //
    // **Where it lands changed in this restructure, and the assertion changed with it.** It used to land
    // on this machine's settings; it lands on the projects page now, because that is what level 3's back
    // control does and a fallback that disagrees with its own back control is a second, silent rule.
    const { removeProject, rerender } = show({ projects: [project, otherProject] });
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
    // at this point, and the pane is already the projects page — which is what keeps the window from
    // spending a frame on a project that no longer exists.
    await vi.waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Project settings for api" })).toBeNull(),
    );
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();

    rerender({ projects: [otherProject] });
    expect(screen.queryByRole("heading", { name: "Project settings for api" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    // …and the page is a *live* one: the project that is still there is the one it lists.
    expect(rowFor("web")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Project settings for api" })).toBeNull();
  });

  it("falls back to the projects page when the project is gone", () => {
    // Removed in another window while this one had the pane open. Nothing claims to be editing a project
    // that no longer exists — and a row that wrote to it would fail with "no such project" for a button
    // the user never pressed.
    const { rerender } = show({ projects: [project, otherProject] });
    openProject("api");
    expect(screen.getByRole("heading", { name: "Project settings for api" })).toBeTruthy();

    rerender({ projects: [otherProject] });

    expect(screen.queryByRole("heading", { name: "Project settings for api" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(rowFor("web")).toBeTruthy();
  });
});

/**
 * Level 1 → level 2, and what the page holds.
 *
 * This is the half of the navigation model the rail's row menu cannot provide: a user reading this pane
 * has no reason to go looking at the rail for the project they are thinking about, and the pane's own
 * history is a list of controls that promised a scope they did not have. So each claim is asserted where
 * it can fail — the count row opens *the page*, the page renders what it was given, a row opens **that**
 * project's scope (the id, not "some project"), each back control lands on its own level, and an empty
 * list teaches instead of rendering an empty box.
 */
describe("the projects page, and the count row that opens it", () => {
  /**
   * Reach this machine's settings the way the owner's brief describes them: the entry at the **bottom of
   * the rail** (the footer's Settings button — ⌘, is bound to the same function). Every test below starts
   * here, which is the point: the Projects row is inside the app scope and the list is one level below
   * it, so this is a two-step journey a test cannot assume.
   */
  const openAppSettings = (): void => {
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  };

  /** Level 1's one navigation row — named with the words of the page it opens, which are its own title. */
  const projectsRow = (): HTMLElement => screen.getByRole("button", { name: "Projects" });

  /** Level 2, the way a user reaches it: the row at level 1. */
  const openProjectsPage = (): void => {
    openAppSettings();
    fireEvent.click(projectsRow());
  };

  /**
   * The pane's own column, and the reason assertions about the pane are scoped to it: the rail is on
   * screen beside the pane and draws the same facts — every project's label as its own header, and "No
   * projects yet" when there are none. An unscoped `queryByText("api")` would be asserting about the rail
   * and passing for the wrong reason.
   */
  const inPane = (): ReturnType<typeof within> => within(screen.getByRole("main"));

  /** Pick an agent in whichever project scope is open, and wait for the write to the daemon. */
  const writeAgent = async (updateProject: ReturnType<typeof vi.fn>): Promise<void> => {
    fireEvent.change(screen.getByLabelText("The agent new tasks here start with"), {
      target: { value: "deepseek-harness" },
    });
    await vi.waitFor(() => expect(updateProject).toHaveBeenCalled());
  };

  it("counts the projects on the app scope and opens the page from there", () => {
    // Level 1 carries **one** row where the list used to be: the count is its second band, and pressing
    // it opens the list rather than any particular project. Both halves are asserted, because a row that
    // counts correctly and goes nowhere is the defect class this pane was rebuilt to remove — and a row
    // that went straight into the first project's settings would pass a test that only checked the count.
    show({ projects: [project, otherProject] });
    openAppSettings();

    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    const row = projectsRow();
    expect(row.tagName).toBe("BUTTON");
    expect(within(row).getByText("2 projects")).toBeTruthy();
    // Nothing of the list is here: no project's name, and so no project's path either.
    expect(inPane().queryByText("api")).toBeNull();
    expect(inPane().queryByText("/work/api")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Project settings for / })).toBeNull();

    fireEvent.click(row);

    // The page: its own title, in the header, and the two rows it was given.
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(rowFor("api")).toBeTruthy();
    expect(rowFor("web")).toBeTruthy();
  });

  it("says how many, in the singular and the plural both", () => {
    // Three forms rather than one template: "1 projects" is what a `{count} projects` string produces,
    // and it is the form every language gets wrong. Zero is a sentence of its own as well, which is the
    // same decision the empty state makes one level down.
    show({ projects: [project] });
    openAppSettings();
    expect(within(projectsRow()).getByText("1 project")).toBeTruthy();

    cleanup();
    show({ projects: [project, otherProject] });
    openAppSettings();
    expect(within(projectsRow()).getByText("2 projects")).toBeTruthy();

    cleanup();
    show({ projects: [] });
    openAppSettings();
    // And with nothing to list the row is still there — which is what keeps the teaching page reachable
    // for a user who has not added a project yet. That is the reason this third case is worth asserting
    // rather than "the row hides": a hidden row is a dead end with no way to learn what a project is.
    expect(within(projectsRow()).getByText("No projects")).toBeTruthy();
  });

  it("lists every project it was given, each with its own path", () => {
    // Two projects, and each row is asserted to carry *its own* path: a single-project fixture passes on
    // a list that draws the same row twice, which is what this catches.
    show({ projects: [project, otherProject] });
    openProjectsPage();

    const api = rowFor("api");
    const web = rowFor("web");
    expect(within(api).getByText("/work/api")).toBeTruthy();
    expect(within(api).queryByText("/work/web")).toBeNull();
    expect(within(web).getByText("/work/web")).toBeTruthy();
    expect(within(web).queryByText("/work/api")).toBeNull();
    // The row *is* the control, so it is keyboard reachable by being a button rather than by a tabindex.
    expect(api.tagName).toBe("BUTTON");
    expect(web.tagName).toBe("BUTTON");
  });

  it("lists all of them, however many there are — no cap and no windowing", () => {
    // The restructure's own answer to "many projects" is a plain list in a scrolling body, so what this
    // asserts is the *testable* half of that: every project is in the DOM, in order, each with its own
    // path. A virtual list would fail here, which is the point — `docs/settings-parity.md` §7.5 records
    // the decision, and the scrolling half of it is measured in a real window (jsdom has no layout to
    // measure, so asserting "it scrolls" in here would be asserting nothing).
    const many: Project[] = Array.from({ length: 40 }, (_, index) => ({
      ...project,
      id: `local::/work/p${index}`,
      path: `/work/p${index}`,
      label: `p${index}`,
    }));
    show({ projects: many });
    openProjectsPage();

    const rows = screen.getAllByRole("button", { name: /^Project settings for / });
    expect(rows).toHaveLength(40);
    expect(rows[0]?.getAttribute("aria-label")).toBe("Project settings for p0");
    expect(rows[39]?.getAttribute("aria-label")).toBe("Project settings for p39");
    expect(within(rows[39]!).getByText("/work/p39")).toBeTruthy();
  });

  it("opens the settings of the row that was pressed, by id", async () => {
    const { updateProject } = show({ projects: [project, otherProject] });
    openProjectsPage();

    fireEvent.click(rowFor("web"));

    // The pane names the project the row named, not the first in the list.
    expect(screen.getByRole("heading", { name: "Project settings for web" })).toBeTruthy();
    // And the id is the assertion that cannot be satisfied by accident: the write from this pane carries
    // `local::/work/web`, because the pane resolved the row's project against `state.projects`.
    await writeAgent(updateProject);
    expect(updateProject).toHaveBeenCalledWith({
      id: otherProject.id,
      defaults: { harness: "deepseek-harness" },
    });
  });

  it("gives each back control its own level, and each one names it", () => {
    // **The reason the two labels must differ.** Level 3's back control returns to the *list*, so it says
    // "Projects"; level 2's returns to this machine's settings, so it says "All settings". A single
    // control labelled "All settings" that landed on the list would be a lie of exactly the kind this
    // pane was rebuilt to remove, and the assertion below is written so that either control taking the
    // other's label — or the other's destination — fails here.
    show({ projects: [project, otherProject] });
    openProjectsPage();
    fireEvent.click(rowFor("web"));
    expect(screen.getByRole("heading", { name: "Project settings for web" })).toBeTruthy();

    // Level 3 → level 2. It says where it goes (the page's own title), and it is a button, so Enter and
    // Space reach it exactly as they reach Close beside it.
    const backToProjects = screen.getByRole("button", { name: "Projects" });
    expect(backToProjects.tagName).toBe("BUTTON");
    expect(screen.queryByRole("button", { name: "All settings" })).toBeNull();
    fireEvent.click(backToProjects);

    // Landed on the list, not on the root: this is the assertion that fails if level 3's back control is
    // wired to the app scope "because that is where back went before".
    expect(screen.queryByRole("heading", { name: "Project settings for web" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(rowFor("web")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Safety" })).toBeNull();

    // Level 2 → level 1, and only that control says "All settings".
    const backToApp = screen.getByRole("button", { name: "All settings" });
    expect(backToApp.tagName).toBe("BUTTON");
    fireEvent.click(backToApp);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Safety" })).toBeTruthy();
    // The section heading at level 1, and beside it the count row that is now the way back down — which is
    // the whole round trip: the row that was pressed at level 2 is two levels down and one press away, and
    // no *project* row is here, because projects are what level 2 is for.
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    expect(projectsRow()).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Project settings for / })).toBeNull();
  });

  it("says it could not read the list, rather than saying there is nothing in it", () => {
    // **The rail's own historical defect, in the new copy.** A window that never managed to read the
    // project list holds an empty array for a reason that is not "you have no projects" — and a count is a
    // claim about that list. `CoderApp` computes the sentence once (`projectsUnavailable`) and hands it to
    // the rail and to this pane, so the two cannot disagree about the same list; the assertion below is
    // that the pane uses it at both levels, in the two places a count or an empty state would otherwise
    // lie.
    //
    // `loaded: false` with a disconnected connection is one of the two shapes the shell covers (the other
    // is a refused call, which keeps `state.error`); both end up as the same reason string.
    const offline = {
      loaded: false,
      connection: { state: "disconnected" as const, reason: "The daemon closed the connection." },
    };
    show({ projects: [], ...offline });
    openAppSettings();

    expect(within(projectsRow()).getByText("Could not be read")).toBeTruthy();
    // Not the zero form: this window does not know that there are none.
    expect(within(projectsRow()).queryByText("No projects")).toBeNull();

    fireEvent.click(projectsRow());

    // And the page does not teach what a project is — that answers "why is this empty?", and the honest
    // answer is "it is not empty, it is unknown". The rail's two sentences plus the reason it gave.
    //
    // Scoped to the pane, and that scoping is itself the proof that the reason is *shared*: the rail is
    // rendering the same three sentences about the same list, from the same value (`projectsUnavailable`),
    // because an unscoped `getByText` finds them twice.
    const pane = inPane();
    expect(pane.getByText("Could not read your projects")).toBeTruthy();
    expect(pane.getByText(/This list is unknown, not empty/)).toBeTruthy();
    expect(pane.getByText("The daemon closed the connection.")).toBeTruthy();
    expect(pane.queryByText(/No projects yet\. A project is a folder on this machine/)).toBeNull();
    // …and the rail is saying it too, from the same value: one sentence, two readers, so a user cannot be
    // told "no projects" by one half of the window while the other half says it could not read them.
    expect(screen.getAllByText("Could not read your projects")).toHaveLength(2);
    // Still leavable, because a failure is not a dead end either.
    expect(screen.getByRole("button", { name: "All settings" })).toBeTruthy();
  });

  it("teaches how a project gets added when there are none", () => {
    show({ projects: [] });
    openProjectsPage();

    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
    // Design law 6: the page says how a project gets here rather than rendering an empty box. The
    // sentence interpolates the rail's own Add-project label, so it cannot end up pointing at a word that
    // is not on screen — which is what the second assertion pins.
    expect(screen.getByText(/No projects yet\. A project is a folder on this machine/)).toBeTruthy();
    expect(screen.getByText(/add one with Add project at the bottom of the rail/)).toBeTruthy();
    // And nothing to list means no list: not an empty box, and no rows.
    expect(screen.queryByRole("button", { name: /^Project settings for / })).toBeNull();
    // The page is still somewhere you can leave, with no projects to choose from.
    expect(screen.getByRole("button", { name: "All settings" })).toBeTruthy();
  });

  it("lists and navigates without putting a project's own controls on either page", () => {
    // The list is navigation. A project's own rows — the ones this pane draws when a project is selected
    // — must not be on the page above it, or a control would be labelled with a scope it does not have.
    // Asserted on the project-only *wording* ("here"), which is what tells them apart, and asserted at
    // both levels because the restructure moved the list and could have moved a control with it.
    show({ projects: [project, otherProject] });
    openAppSettings();

    // Level 1: this machine's settings, and no project's.
    expect(screen.queryByLabelText("The agent new tasks here start with")).toBeNull();
    expect(screen.queryByLabelText("The model new tasks here start on")).toBeNull();
    expect(screen.getByLabelText("The agent new tasks start with")).toBeTruthy();

    fireEvent.click(projectsRow());

    // Level 2: the same, one level down — and level 1's own settings are not here either. This page is a
    // list; a page that carried the app scope's rows as well would be a second settings page wearing a
    // list's title, which is the failure the assertion below catches.
    expect(screen.queryByLabelText("The agent new tasks here start with")).toBeNull();
    expect(screen.queryByLabelText("The model new tasks here start on")).toBeNull();
    expect(screen.queryByText("Folder")).toBeNull();
    expect(screen.queryByLabelText("The agent new tasks start with")).toBeNull();
    expect(screen.queryByLabelText("Language")).toBeNull();
  });

  it("opens the same scope from the rail's menu and from the list", async () => {
    // **The two routes, asserted against each other** rather than each on its own. Two entry points that
    // are only ever tested separately can come to mean two things — and this repo has the receipts: the
    // rail's button once opened *app* settings with the project dropped on the floor. So the same journey
    // is walked twice, once per route, and the destinations compared: the pane's title, and the id the
    // write from that pane carries.
    //
    // The two routes are now different depths — the menu enters level 3 directly, the list enters it
    // through level 2 — which is exactly why this comparison is worth keeping: one of them could
    // reasonably have kept the app scope as its parent, and the assertion is that neither does.
    const viaMenu = show({ projects: [project, otherProject] });
    openProject("web");
    await writeAgent(viaMenu.updateProject);
    const fromTheMenu = viaMenu.updateProject.mock.calls[0]?.[0];

    cleanup();
    const viaList = show({ projects: [project, otherProject] });
    openProjectsPage();
    fireEvent.click(rowFor("web"));
    await writeAgent(viaList.updateProject);
    const fromTheList = viaList.updateProject.mock.calls[0]?.[0];

    expect(fromTheList).toEqual(fromTheMenu);
    expect(fromTheList).toEqual({
      id: otherProject.id,
      defaults: { harness: "deepseek-harness" },
    });
  });
});

/**
 * The scope model itself, without a pane in the way.
 *
 * The fallback is asserted through `CoderApp` above — which is where it matters — and again here,
 * because these three functions are the whole of the rule and a rule that only works when a shell
 * happens to pass the right arguments is not a rule. It matters that `resolveScope` is *live* rather
 * than forgiving: a scope naming a project that is not in the list resolves to the projects page even
 * when the caller has no idea anything was removed.
 */
describe("the scope as data", () => {
  it("passes the two fixed levels through untouched, as the same object", () => {
    expect(resolveScope(APP_SCOPE, [])).toBe(APP_SCOPE);
    expect(resolveScope(PROJECTS_SCOPE, [])).toBe(PROJECTS_SCOPE);
    expect(scopeProjectId(PROJECTS_SCOPE, [project])).toBeUndefined();
    expect(scopeProjectId(APP_SCOPE, [project])).toBeUndefined();
  });

  it("resolves a project scope against the live list, and falls back to the projects page", () => {
    const scope = projectScope(project.id);
    expect(resolveScope(scope, [project, otherProject])).toBe(scope);
    expect(scopeProjectId(scope, [project])).toBe(project.id);
    // The project is gone: the scope lands on the page its own back control goes to.
    expect(resolveScope(scope, [otherProject])).toBe(PROJECTS_SCOPE);
    expect(resolveScope(scope, [])).toBe(PROJECTS_SCOPE);
    // Which means a write can never be addressed to a project that is not there.
    expect(scopeProjectId(scope, [otherProject])).toBeUndefined();
  });

  it("is a union a switch has to exhaust, not a boolean with a payload", () => {
    // The property that the previous shape could not have: `undefined` project meant "the app scope",
    // and there was no value at all that meant "the projects page" — so the third level could not be
    // expressed, and a caller that wanted it would have rendered the first one instead. Asserted as a
    // compile-time fact with a runtime witness, because the type is the guard.
    const scopes = [APP_SCOPE, PROJECTS_SCOPE, projectScope("local::/work/api")] as const;
    const levels = scopes.map((scope) => scope.kind);
    expect(levels).toEqual(["app", "projects", "project"]);
    // And the third one carries an id rather than a project: an object here is the snapshot bug.
    const held = projectScope(project.id);
    expect(Object.keys(held)).toEqual(["kind", "id"]);
  });
});
