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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoderSidebar } from "../src/components/CoderSidebar.js";
import type { Project, Task } from "@envoydev/protocol";

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
  const onOpenProjectSettings = vi.fn();
  const onRemoveProject = vi.fn();
  const onRenameTask = vi.fn();
  const onRemoveTask = vi.fn();
  render(
    <CoderSidebar
      projects={SAMPLE_PROJECTS}
      tasks={SAMPLE_TASKS}
      onSelect={onSelect}
      onNewTask={onNewTask}
      onAddProject={vi.fn()}
      onOpenProjectSettings={onOpenProjectSettings}
      onRemoveProject={onRemoveProject}
      onRenameTask={onRenameTask}
      onRemoveTask={onRemoveTask}
      onOpenCommandCenter={vi.fn()}
      onOpenSettings={vi.fn()}
      onShowPairing={vi.fn()}
      {...over}
    />,
  );
  return { onSelect, onNewTask, onOpenProjectSettings, onRemoveProject, onRenameTask, onRemoveTask };
}

/**
 * Open one row's `…` menu, by the name the trigger announces.
 *
 * By *name* rather than by position, because that name is half of what the menu has to get right: it
 * names the row it acts on (`sidebar.project.menu.aria` / `sidebar.task.menu.aria`), which is the only
 * way a screen-reader user can tell eleven "Actions" buttons apart.
 */
function openMenu(name: string): HTMLElement {
  const trigger = screen.getByLabelText(name);
  fireEvent.click(trigger);
  return trigger;
}

/** The menu that is open, by its accessible name — the same name as the trigger that opened it. */
function menu(name: string): HTMLElement {
  return screen.getByRole("menu", { name });
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

  it("does not claim a project has no tasks when the task list could not be read", () => {
    // Same principle one level down: the group header is real (that project exists), but the empty
    // line is a claim about a list nobody could fetch — the version-skew case, where projects answer
    // and tasks do not. The positive control is the line below it: the string the rail would otherwise
    // draw really is "No tasks here yet.", so its absence here is the assertion, not a typo.
    renderSidebar({ tasksUnknown: true, projects: [SAMPLE_PROJECTS[2]!], tasks: [] });
    expect(screen.getByTestId("project-site")).toBeTruthy();
    expect(screen.queryByText("No tasks here yet.")).toBeNull();
  });

  it("still says a project has no tasks when the list was read, and there are none", () => {
    renderSidebar({ projects: [SAMPLE_PROJECTS[2]!], tasks: [] });
    expect(screen.getByText("No tasks here yet.")).toBeTruthy();
  });

  it("reports a click on a task to the shell", async () => {
    const { onSelect } = renderSidebar();
    screen.getByTestId("task-w1").click();
    expect(onSelect).toHaveBeenCalledWith("w1");
  });
});

/**
 * The row menus — the `…` on each project row and each task row.
 *
 * ## What these tests are for, and why they are this long
 *
 * A menu is the kind of component that looks finished while being unusable: it renders, it lists the
 * right words, and it cannot be reached or left by keyboard, or it leaves focus on a panel that no
 * longer exists. So the tests below are not "the labels are right" — they are the four things a menu
 * must do that a screenshot cannot show: **open from its trigger and land somewhere sensible, move
 * between items with the arrow keys, close on Escape and on an outside press (returning focus where it
 * came from), and never act destructively before asking.**
 *
 * ## Removal, and the two assertions that moved here
 *
 * Removing a task used to be the pane header's button, with its own inline confirmation, asserted in
 * `task-pane.test.tsx` ("asks before it removes…" and "lets the user change their mind…"). The control
 * moved to the task's own row, so those two assertions moved with it rather than being dropped: *ask
 * before removing, and Cancel removes nothing* has to stay true wherever the control lives. The wording
 * did not move at all — the menu renders the same `task.remove.*` keys, so the question still says the
 * task leaves the rail and is archived and that the folder and its files are not touched.
 */

describe("a project's row menu", () => {
  it("opens on its own trigger and lists what can be done to that project", () => {
    renderSidebar();
    expect(screen.queryByRole("menu")).toBeNull();

    openMenu("Actions for payments-api");

    const list = menu("Actions for payments-api");
    expect(within(list).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Project settings",
      "New task",
      "Remove project",
    ]);
  });

  it("names the row each trigger acts on, so eleven of them are eleven different buttons", () => {
    // The defect this avoids is the one a bare "…" has: an accessible name of "Actions" announced once
    // per row with nothing to tell them apart. Asserted on all three fixture projects at once, because
    // the failure mode is two of them colliding rather than one being wrong.
    renderSidebar();
    for (const label of ["envoymesh", "payments-api", "site"]) {
      expect(screen.getByLabelText(`Actions for ${label}`)).toBeTruthy();
    }
  });

  it("opens project settings, which is what the bare ⋯ used to be", () => {
    // The old assertion, one click further in: the `⋯` was *only* project settings, so its accessible
    // name was the action. It is a menu item now, and the action still arrives carrying its project.
    const { onOpenProjectSettings } = renderSidebar();
    openMenu("Actions for payments-api");
    fireEvent.click(within(menu("Actions for payments-api")).getByRole("menuitem", { name: "Project settings" }));

    expect(onOpenProjectSettings).toHaveBeenCalledWith(SAMPLE_PROJECTS[1]);
  });

  it("offers Open in new window when the shell can create one", () => {
    const onOpenProjectInNewWindow = vi.fn();
    renderSidebar({ onOpenProjectInNewWindow });
    openMenu("Actions for payments-api");
    fireEvent.click(
      within(menu("Actions for payments-api")).getByRole("menuitem", { name: "Open in new window" }),
    );
    expect(onOpenProjectInNewWindow).toHaveBeenCalledWith(SAMPLE_PROJECTS[1]);
  });

  it("hides Open in new window when the shell cannot create one", () => {
    renderSidebar();
    openMenu("Actions for payments-api");
    expect(
      within(menu("Actions for payments-api")).queryByRole("menuitem", { name: "Open in new window" }),
    ).toBeNull();
  });

  it("starts a new task in that project", () => {
    const { onNewTask } = renderSidebar();
    openMenu("Actions for payments-api");
    fireEvent.click(within(menu("Actions for payments-api")).getByRole("menuitem", { name: "New task" }));

    expect(onNewTask).toHaveBeenCalledWith(SAMPLE_PROJECTS[1]!.id);
  });

  it("closes after an ordinary item, instead of leaving the panel over the row", () => {
    renderSidebar();
    openMenu("Actions for envoymesh");
    fireEvent.click(within(menu("Actions for envoymesh")).getByRole("menuitem", { name: "Project settings" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("asks before removing a project, and says what removing it actually does", () => {
    // Design law 3: the destructive colour exists only inside a confirmation, never on a row and never
    // in the menu. So there is no "Remove project" *button* before the question is asked — the menu item
    // is a `menuitem`, which is not one — and the question is the first thing wearing the red.
    const { onRemoveProject } = renderSidebar();
    openMenu("Actions for payments-api");
    expect(screen.queryByRole("button", { name: "Remove project" })).toBeNull();

    fireEvent.click(within(menu("Actions for payments-api")).getByRole("menuitem", { name: "Remove project" }));

    const card = screen.getByRole("alertdialog", { name: "Remove this project" });
    // The sentence has to be true, because it is the only thing telling the user what just happened to
    // their work: the row and its tasks leave the rail, and nothing on disk is deleted.
    expect(within(card).getByText(/Its tasks leave the rail and are archived/)).toBeTruthy();
    expect(within(card).getByText(/nothing on disk is deleted/)).toBeTruthy();
    // Asked, not done.
    expect(onRemoveProject).not.toHaveBeenCalled();
    expect(within(card).getByRole("button", { name: "Remove project" })).toBeTruthy();
  });

  it("removes the project only after the question is answered", () => {
    const { onRemoveProject } = renderSidebar();
    openMenu("Actions for payments-api");
    fireEvent.click(within(menu("Actions for payments-api")).getByRole("menuitem", { name: "Remove project" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Remove this project" })).getByRole("button", {
        name: "Remove project",
      }),
    );

    expect(onRemoveProject).toHaveBeenCalledWith(SAMPLE_PROJECTS[1]!.id);
  });

  it("removes nothing when the question is cancelled", () => {
    const { onRemoveProject } = renderSidebar();
    openMenu("Actions for payments-api");
    fireEvent.click(within(menu("Actions for payments-api")).getByRole("menuitem", { name: "Remove project" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onRemoveProject).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog", { name: "Remove this project" })).toBeNull();
    // …and the row is still there, which is the thing the user was actually asking for.
    expect(screen.getByText("payments-api")).toBeTruthy();
  });
});

describe("a task's row menu", () => {
  it("opens on the task's own trigger and lists what can be done to that task", () => {
    renderSidebar();
    openMenu("Actions for Review the migration diff");

    expect(
      within(menu("Actions for Review the migration diff"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Rename", "Remove task"]);
  });

  it("calls an unnamed task by this app's word for it, in the trigger's name too", () => {
    // A task created from "+ New" has no title. "Actions for " with a hole in it is not a name.
    renderSidebar({
      tasks: [{ ...SAMPLE_TASKS[0]!, id: "w9", title: "" }],
      projects: [SAMPLE_PROJECTS[0]!],
    });
    expect(screen.getByLabelText("Actions for Untitled")).toBeTruthy();
  });

  it("keeps the task id on the control that selects the task, now that a menu shares the row", () => {
    // The row is a `div` with a button inside it these days, because a nested button is invalid HTML and
    // the browser resolves that by dropping one of them. The testid had to move with the *selection*, so
    // that "click the row, the task opens" still means what it says — `sidebar.test.tsx`'s click test
    // above is the positive control.
    renderSidebar();
    const select = screen.getByTestId("task-w1");
    expect(select.tagName).toBe("BUTTON");
    expect(select.className).toContain("task-row__select");
  });

  it("asks before it removes, and the destructive button exists only inside the question", () => {
    // Moved here from `task-pane.test.tsx` with the control itself.
    const { onRemoveTask } = renderSidebar();
    openMenu("Actions for Review the migration diff");
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

    fireEvent.click(
      within(menu("Actions for Review the migration diff")).getByRole("menuitem", { name: "Remove task" }),
    );

    const card = screen.getByRole("alertdialog", { name: "Remove this task" });
    expect(within(card).getByText(/leaves the rail and is archived/)).toBeTruthy();
    expect(within(card).getByText(/the folder and its files are not touched/)).toBeTruthy();
    expect(onRemoveTask).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole("button", { name: "Remove" }));
    expect(onRemoveTask).toHaveBeenCalledWith("w2");
  });

  it("lets the user change their mind without removing anything", () => {
    // The second assertion that moved from `task-pane.test.tsx`.
    const { onRemoveTask } = renderSidebar();
    openMenu("Actions for Review the migration diff");
    fireEvent.click(
      within(menu("Actions for Review the migration diff")).getByRole("menuitem", { name: "Remove task" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onRemoveTask).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog", { name: "Remove this task" })).toBeNull();
    expect(screen.getByText("Review the migration diff")).toBeTruthy();
  });
});

describe("the menu's keyboard and dismissal behaviour", () => {
  it("is a real button, which is what makes Enter and Space work without a line of code", () => {
    // Enter and Space are the browser's own activation for a `<button>`, and the failure this guards is
    // the tempting shortcut: a `div` with an `onClick` renders identically and cannot be activated from
    // the keyboard at all. Asserted rather than simulated, because jsdom does not synthesise the click a
    // real Enter produces — so a test that "pressed Enter" would pass on the div.
    renderSidebar();
    const trigger = screen.getByLabelText("Actions for envoymesh");
    expect(trigger.tagName).toBe("BUTTON");
    expect((trigger as HTMLButtonElement).type).toBe("button");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // …and the same button closes it again. A trigger that only ever opens is a menu a user has to
    // dismiss by pressing somewhere else, which is not what the control looks like it does.
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens with ArrowDown and lands on the first item, so nothing has to be hunted for", () => {
    renderSidebar();
    const trigger = screen.getByLabelText("Actions for envoymesh");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const items = within(menu("Actions for envoymesh")).getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
  });

  it("moves through the items with the arrows, and cycles at the end", () => {
    renderSidebar();
    fireEvent.keyDown(screen.getByLabelText("Actions for envoymesh"), { key: "ArrowDown" });
    const items = within(menu("Actions for envoymesh")).getAllByRole("menuitem");

    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]);
    // Wrapping rather than stopping dead: a menu is a loop, and a dead end reads as "there is more
    // below" when there is not.
    fireEvent.keyDown(items[2]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
  });

  it("closes on Escape and puts focus back on the button it came from", () => {
    // Focus back on the trigger because that is where the user was: leaving focus on a popover that no
    // longer exists strands a keyboard user at the top of the document.
    renderSidebar();
    const trigger = openMenu("Actions for payments-api");
    const first = within(menu("Actions for payments-api")).getAllByRole("menuitem")[0]!;

    fireEvent.keyDown(first, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on an outside press, and does not close on a press inside itself", () => {
    renderSidebar();
    openMenu("Actions for envoymesh");
    // Inside first: a click that lands on the panel must not dismiss the panel it landed on, or no item
    // could ever be chosen with a mouse.
    fireEvent.mouseDown(menu("Actions for envoymesh"));
    expect(screen.queryByRole("menu")).not.toBeNull();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves Escape for the menu while it is open, rather than spending it on the running agent", () => {
    // The shell binds Escape globally to "stop the agent" (`input/useShortcuts.ts`), so dismissing a menu
    // must stop the keystroke reaching it. This asserts the *propagation* half of that contract: the
    // menu's own handler marks the event handled, which is what keeps `window`'s listener from firing.
    renderSidebar();
    openMenu("Actions for envoymesh");
    const first = within(menu("Actions for envoymesh")).getAllByRole("menuitem")[0]!;
    const seen: string[] = [];
    const spy = (event: KeyboardEvent): void => {
      seen.push(event.key);
    };
    window.addEventListener("keydown", spy);
    try {
      fireEvent.keyDown(first, { key: "Escape" });
    } finally {
      window.removeEventListener("keydown", spy);
    }
    expect(seen).toEqual([]);
  });
});

describe("renaming a task from its row", () => {
  it("edits the title in place and hands the new name to the shell", () => {
    const { onRenameTask } = renderSidebar();
    openMenu("Actions for Review the migration diff");
    fireEvent.click(
      within(menu("Actions for Review the migration diff")).getByRole("menuitem", { name: "Rename" }),
    );

    // Choosing an ordinary item closes the menu, exactly as the destructive one replaces it: a panel
    // still hanging over the row while the field behind it is being typed into is two things to look at.
    expect(screen.queryByRole("menu")).toBeNull();

    const field = screen.getByLabelText("New name for this task") as HTMLInputElement;
    // The name it has now, so the user edits what the row says rather than retyping it.
    expect(field.value).toBe("Review the migration diff");

    fireEvent.change(field, { target: { value: "Review the payments migration diff" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onRenameTask).toHaveBeenCalledWith("w2", "Review the payments migration diff");
    expect(screen.queryByLabelText("New name for this task")).toBeNull();
  });

  it("keeps the name it had when the edit is cancelled, even though the field then loses focus", () => {
    // Escape is "keep the name it had" — and the field unmounts, which is a blur. A blur that committed
    // would silently save the very text the user just cancelled, which is the bug this asserts against.
    const { onRenameTask } = renderSidebar();
    openMenu("Actions for Review the migration diff");
    fireEvent.click(
      within(menu("Actions for Review the migration diff")).getByRole("menuitem", { name: "Rename" }),
    );
    const field = screen.getByLabelText("New name for this task");
    fireEvent.change(field, { target: { value: "something else entirely" } });
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);

    expect(onRenameTask).not.toHaveBeenCalled();
    expect(screen.getByText("Review the migration diff")).toBeTruthy();
  });

  it("stores a name typed and then clicked away from, because that is still a name the user meant", () => {
    // `ModelChoice`'s rule, applied to a title: a value typed and then abandoned by clicking elsewhere is
    // a value. Only Escape means "no".
    const { onRenameTask } = renderSidebar();
    openMenu("Actions for Wire product attach into the new node service");
    fireEvent.click(
      within(menu("Actions for Wire product attach into the new node service")).getByRole("menuitem", {
        name: "Rename",
      }),
    );
    const field = screen.getByLabelText("New name for this task");
    fireEvent.change(field, { target: { value: "Wire the node service" } });
    fireEvent.blur(field);

    expect(onRenameTask).toHaveBeenCalledWith("w1", "Wire the node service");
  });

  it("does not store an emptied field, which is a field somebody cleared rather than a new name", () => {
    const { onRenameTask } = renderSidebar();
    openMenu("Actions for Review the migration diff");
    fireEvent.click(
      within(menu("Actions for Review the migration diff")).getByRole("menuitem", { name: "Rename" }),
    );
    const field = screen.getByLabelText("New name for this task");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onRenameTask).not.toHaveBeenCalled();
    // …and the row is still there under the name it had, rather than showing a blank title.
    expect(screen.getByText("Review the migration diff")).toBeTruthy();
  });
});
