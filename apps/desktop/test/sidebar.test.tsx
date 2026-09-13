/**
 * The sidebar, rendered from fixtures.
 *
 * Two things are asserted that a pure-logic test cannot reach: that the tree actually *renders*
 * (a component that throws on a missing field passes every unit test in `workspace-model`), and
 * that the project → workspace relationship is visible — a group whose header names the agent its
 * children inherit, with the workspaces under it.
 *
 * `jsdom` is configured per file so the rest of the suite stays on Node.
 */

/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoderSidebar } from "../src/components/CoderSidebar.js";
import { SAMPLE_PROJECTS, SAMPLE_WORKSPACES } from "../src/data/sample.js";

// Testing-library only auto-cleans when vitest globals are enabled, which this repo does not do
// (an explicit import list is easier to read in a diff). Without this, each `render` leaves its DOM
// behind and the third test finds two of everything.
afterEach(cleanup);

function renderSidebar(over: Partial<Parameters<typeof CoderSidebar>[0]> = {}) {
  const onSelect = vi.fn();
  const onNewWorkspace = vi.fn();
  render(
    <CoderSidebar
      projects={SAMPLE_PROJECTS}
      workspaces={SAMPLE_WORKSPACES}
      onSelect={onSelect}
      onNewWorkspace={onNewWorkspace}
      onAddProject={vi.fn()}
      onOpenProjectSettings={vi.fn()}
      onOpenCommandCenter={vi.fn()}
      onOpenSettings={vi.fn()}
      {...over}
    />,
  );
  return { onSelect, onNewWorkspace };
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
    expect(within(group).getByText("Workspaces")).toBeTruthy();
    // …and the tasks under it.
    expect(within(group).getByText("Wire product attach into the new node service")).toBeTruthy();
    expect(within(group).getByText("Review the §5 migration diff")).toBeTruthy();
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
    renderSidebar({ projects: [], workspaces: [] });
    expect(screen.getByText("No projects yet")).toBeTruthy();
    expect(screen.getByText(/Add a directory you work in/)).toBeTruthy();
  });

  it("reports a click on a task to the shell", async () => {
    const { onSelect } = renderSidebar();
    screen.getByTestId("workspace-w1").click();
    expect(onSelect).toHaveBeenCalledWith("w1");
  });
});
