/**
 * The palette's click path, exercised the way a user walks it.
 *
 * Written after "Add project… does nothing" was reported twice while the unit tests stayed green. The
 * lesson: a control can be *correct* and still look dead, so this drives the actual DOM — click the row,
 * read what the stage shows, type, confirm — rather than calling the handlers directly.
 */

/** @vitest-environment jsdom */

import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { pickFolder } from "../src/client/folder-picker.js";
import {
  CommandCenter,
  buildCommandContributions,
  type CommandContribution,
} from "../src/components/CommandCenter.js";
import { CATALOGUES } from "../src/i18n/catalogues.js";
import { createTranslator } from "../src/i18n/translate.js";

afterEach(cleanup);

function show(
  contributions: CommandContribution[],
  onClose = vi.fn(),
  intent: { initialCommandId?: string; initialIdPrefix?: string } = {},
): void {
  render(
    <CommandCenter open onClose={onClose} contributions={contributions} {...intent} />,
  );
}

const withNeeds = (over: Partial<CommandContribution> = {}): CommandContribution => ({
  id: "project.add",
  title: "Add project…",
  subtitle: "Register a directory you work in",
  group: "Projects",
  kind: "action",
  needs: { label: "Which directory? Paste its full path.", placeholder: "/Users/you/work/repo" },
  run: vi.fn(),
  ...over,
});

describe("a command that needs a value", () => {
  it("shows what it wants and a confirm button, instead of only a placeholder change", () => {
    show([withNeeds()]);
    fireEvent.click(screen.getByText("Add project…"));

    // The stage must be *visible*: this is the fix for a click that looked like it did nothing.
    // Queried by class because the same words also appear as the field's label and placeholder.
    const header = document.querySelector(".palette__stage-label");
    expect(header?.textContent).toBe("Which directory? Paste its full path.");
    const confirm = screen.getByRole("button", { name: "Add project" });
    expect(confirm).toBeTruthy();
    // Nothing typed yet, so it cannot be confirmed.
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it("runs the command with the typed value when confirmed", () => {
    const run = vi.fn();
    show([withNeeds({ run })]);
    fireEvent.click(screen.getByText("Add project…"));

    const field = screen.getByLabelText("Which directory? Paste its full path.");
    fireEvent.change(field, { target: { value: "/tmp/some-repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(run).toHaveBeenCalledWith("/tmp/some-repo");
  });

  it("falls through to the value stage when its picker is unavailable, and says so", async () => {
    // The browser case: no shell, so `pick` resolves null and the user must be told why they are being
    // asked to type instead of being shown a chooser.
    const run = vi.fn();
    show([withNeeds({ run, pick: async () => null })]);
    fireEvent.click(screen.getByText("Add project…"));

    const header = await vi.waitFor(() => {
      const found = document.querySelector(".palette__stage-label");
      expect(found?.textContent ?? "").toContain("no shell to ask");
      return found;
    });
    expect(header).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
  });

  it("runs immediately with the picked path when a shell is present, and closes the palette", async () => {
    // A shell in the window is what makes the picker reachable at all, so the test provides one: the
    // window asks `pick_folder` through `__TAURI__.core.invoke`, exactly as it does in the Tauri build.
    const invoke = vi.fn(async () => "/Users/someone/work/api");
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };

    try {
      const run = vi.fn();
      const onClose = vi.fn();
      // The row the product actually registers: its picker calls the real `pickFolder`, which talks to
      // the shell we just simulated. That is the whole path, not a stub of it.
      show(
        [
          withNeeds({
            run,
            pick: async () => {
              const picked = await pickFolder("Choose a project folder");
              return picked.kind === "picked" ? picked.path : null;
            },
          }),
        ],
        onClose,
      );
      fireEvent.click(screen.getByText("Add project…"));

      await vi.waitFor(() => expect(run).toHaveBeenCalledWith("/Users/someone/work/api"));
      expect(invoke).toHaveBeenCalledWith("pick_folder", expect.anything());
      expect(onClose).toHaveBeenCalled();
    } finally {
      delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    }
  });
});

/**
 * "New task" and "Add project" are workflows, not choices of workflow.
 *
 * Reported by the user as *"the new task or add task still open the dialog including all the things"*:
 * every task affordance in the window opened the same catalogue, and the row the button had already
 * named then had to be found and clicked. These tests drive the two ways the palette now opens — on one
 * command, and on a subset of them — because the difference is invisible in the code that passes an id.
 */
describe("a palette opened for one workflow", () => {
  const newTaskIn = (project: string): CommandContribution => ({
    id: `task.new.${project}`,
    title: `New task in ${project}`,
    subtitle: `/work/${project}`,
    group: "Tasks",
    kind: "action",
    needs: { label: "What should the agent do?", placeholder: "Describe the task" },
    run: vi.fn(),
  });

  it("goes straight to the value stage, with the catalogue never shown", () => {
    const run = vi.fn();
    show(
      [withNeeds(), newTaskIn("api"), { ...newTaskIn("site"), run }],
      vi.fn(),
      { initialCommandId: "task.new.site" },
    );

    // No rows: the user asked for this workflow, so the only thing on screen is its question.
    expect(screen.queryByText("Add project…")).toBeNull();
    expect(screen.queryByText("New task in api")).toBeNull();
    const header = document.querySelector(".palette__stage-label");
    expect(header?.textContent).toBe("What should the agent do?");

    const field = screen.getByLabelText("What should the agent do?");
    fireEvent.change(field, { target: { value: "fix the failing test" } });
    fireEvent.click(screen.getByRole("button", { name: "New task in site" }));
    expect(run).toHaveBeenCalledWith("fix the failing test");
  });

  it("offers only the projects as a chooser when several exist", () => {
    // With more than one project there is a real choice to make, and the choice *is* the list — the
    // rows are already titled "New task in {project}".
    show([withNeeds(), newTaskIn("api"), newTaskIn("site")], vi.fn(), { initialIdPrefix: "task.new." });

    expect(screen.getByText("New task in api")).toBeTruthy();
    expect(screen.getByText("New task in site")).toBeTruthy();
    expect(screen.queryByText("Add project…")).toBeNull();
  });

  it("keeps the restriction while the user types in the chooser", () => {
    // The search field is the user's and the subset is the shell's: typing must narrow what is offered,
    // never widen it back to the whole catalogue halfway through starting a task.
    show([withNeeds(), newTaskIn("api"), newTaskIn("site")], vi.fn(), { initialIdPrefix: "task.new." });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a" } });

    expect(screen.getByText("New task in api")).toBeTruthy();
    expect(screen.queryByText("Add project…")).toBeNull();
  });

  it("shows the whole catalogue when it is opened for nothing", () => {
    show([withNeeds(), newTaskIn("api")]);
    expect(screen.getByText("Add project…")).toBeTruthy();
    expect(screen.getByText("New task in api")).toBeTruthy();
  });
});

/**
 * The row the product actually registers, not a fixture.
 *
 * The tests above build their own contributions, and every one of them includes a `needs` — which is
 * precisely how "Add project" shipped without one. With a picker the user never notices; in a browser
 * window (`hasShellPicker()` false) the row fell through to `run("")` and answered *"No folder was
 * chosen, so nothing was added"* to a user who had been offered nothing to choose. A fixture more
 * capable than the product cannot fail that way, so this test builds the real catalogue.
 */
describe("the project row as the product registers it", () => {
  it("asks for a path when there is no shell to open a chooser", () => {
    const t = createTranslator("en", CATALOGUES.en).t;
    const onAddProject = vi.fn();
    const contributions = buildCommandContributions({
      t,
      projects: [],
      tasks: [],
      onAddProject,
      onNewTask: vi.fn(),
      onOpenSettings: vi.fn(),
      onPairPhone: vi.fn(),
      onToggleRail: vi.fn(),
      onRevealTask: vi.fn(),
    });

    // No `__TAURI__` in this environment: the browser case, which is where the report came from.
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    render(<CommandCenter open onClose={vi.fn()} contributions={contributions} />);
    fireEvent.click(screen.getByText("Add project…"));

    // It must reach the text stage rather than run with nothing.
    expect(document.querySelector(".palette__stage-label")?.textContent).toContain(
      "Which folder? Paste its full path.",
    );
    expect(onAddProject).not.toHaveBeenCalled();

    // The field's label carries the reason it is being asked for a path ("… (no shell to ask)"), so it
    // is matched on its prefix — the stage header above is what asserts the wording itself.
    const field = screen.getByLabelText(/^Which folder\? Paste its full path\./);
    fireEvent.change(field, { target: { value: "/Users/you/work/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(onAddProject).toHaveBeenCalledWith("/Users/you/work/repo");
  });
});
