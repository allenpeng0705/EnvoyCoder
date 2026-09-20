/**
 * The stash panel, under the commit box in the Changes tab.
 *
 * Four operations and two of them are dangerous in different ways — a pop can conflict, a drop destroys
 * something git cannot recover — so the properties worth pinning are the *interactions*, not the markup:
 *
 *   * a push empties the tree, so the panel hands the daemon's refreshed change list back to the sidebar
 *     rather than leaving the tab describing files that are no longer there;
 *   * a drop asks first, **in the row**, and the question names the thing it is about;
 *   * a refusal lands beside the control that caused it, and the row it was about is still there;
 *   * no panel at all when the daemon does not serve the four methods — a surface that cannot list a stash
 *     must not offer to make one.
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@envoydev/protocol";

import type { ExplorerChange } from "../src/components/ExplorerSidebar.js";
import type { ExplorerStash, StashActions } from "../src/components/StashPanel.js";
import { TaskPane } from "../src/components/TaskPane.js";
import { en } from "../src/i18n/messages/en.js";
import type { Refusal } from "../src/i18n/notice.js";

afterEach(cleanup);

const task: Task = {
  id: "w1",
  projectId: "local::/repo",
  cwd: "/repo",
  title: "Add idempotency keys",
  harness: "deepseek-harness",
  model: "deepseek-official/deepseek-v4-flash",
  status: "idle",
  createdAt: "2026-09-13T10:00:00.000Z",
  updatedAt: "2026-09-13T10:01:00.000Z",
};

/** A stash made four minutes ago, so the row's reading is the same whenever the suite runs. */
function stash(index: number, message: string): ExplorerStash {
  return {
    index,
    ref: `stash@{${index}}`,
    message,
    at: new Date(Date.now() - 4 * 60_000).toISOString(),
  };
}

const CHANGES: readonly ExplorerChange[] = [
  { path: "src/main.ts", kind: "modified", staged: false, unstaged: true },
];

/** The four operations, with every answer a test does not override saying "nothing changed". */
function actions(overrides: Partial<StashActions> = {}): StashActions {
  return {
    list: async () => ({ ok: true as const, stashes: [stash(0, "WIP on main: 3c3a2b9 one")] }),
    push: async () => ({ ok: true as const, changes: [], stashes: [stash(0, "WIP on main: 3c3a2b9 one")] }),
    pop: async () => ({ ok: true as const, changes: CHANGES, stashes: [] }),
    drop: async () => ({ ok: true as const, stashes: [] }),
    ...overrides,
  };
}

function renderChanges(stashActions: StashActions | undefined, changes: readonly ExplorerChange[] = CHANGES): void {
  render(
    <TaskPane
      task={task}
      project={undefined}
      events={[]}
      runLive={false}
      explorerOpen
      onListDirectory={async () => ({ ok: true as const, entries: [] })}
      onListChanges={async () => ({ ok: true as const, repo: true, changes })}
      {...(stashActions !== undefined ? { stash: stashActions } : {})}
      onSend={vi.fn()}
      onAnswer={vi.fn()}
      onStart={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
}

describe("the stash panel", () => {
  it("lists what is set aside, with when it was made", async () => {
    renderChanges(actions());
    // Git's own subject, verbatim: it is not a sentence this product wrote.
    expect(await screen.findByText("WIP on main: 3c3a2b9 one")).toBeTruthy();
    expect(screen.getByText("4 minutes ago")).toBeTruthy();
    expect(screen.getByText("Stashes 1")).toBeTruthy();
  });

  it("stashes the tree, and hands the emptied change list back to the tab", async () => {
    const push = vi.fn(async () => ({
      ok: true as const,
      changes: [] as readonly ExplorerChange[],
      stashes: [stash(0, "WIP on main: 3c3a2b9 one")],
    }));
    renderChanges(actions({ push }));

    fireEvent.click(await screen.findByRole("button", { name: "Stash" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalled());

    // The daemon's answer is the list: the files it just set aside are gone from the tab too, and the row
    // telling the user where they went is there.
    expect(await screen.findByText("Stashed.")).toBeTruthy();
    expect(await screen.findByText("No changes in this folder.")).toBeTruthy();
    expect(screen.getByText("Stashes 1")).toBeTruthy();
  });

  it("offers no stash when the tree is clean, because the daemon would refuse it", async () => {
    renderChanges(actions(), []);
    const button = (await screen.findByRole("button", { name: "Stash" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // The list is still shown: a user with a clean tree is exactly the one looking for what they set aside.
    expect(await screen.findByText("WIP on main: 3c3a2b9 one")).toBeTruthy();
  });

  it("puts a stash back, and the files it brings are the tab's list again", async () => {
    const pop = vi.fn(async () => ({ ok: true as const, changes: CHANGES, stashes: [] }));
    renderChanges(actions({ pop }), []);

    // With a clean tree there is nothing to stash and one thing to put back.
    expect(await screen.findByText("No changes in this folder.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Put back" }));

    await vi.waitFor(() => expect(pop).toHaveBeenCalledWith(0));
    expect(await screen.findByText("src/main.ts")).toBeTruthy();
    expect(await screen.findByText("Nothing stashed.")).toBeTruthy();
  });

  it("asks before discarding, in the row the question is about", async () => {
    const drop = vi.fn(async () => ({ ok: true as const, stashes: [] }));
    renderChanges(actions({ drop }));

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    // The question, and the stash it is about by name — the row is the same width asking as not, so the
    // stash's own words move to the question's tooltip rather than pushing the buttons off a 280px sidebar.
    expect(await screen.findByText("Discard this stash?")).toBeTruthy();
    expect(screen.getByTitle("WIP on main: 3c3a2b9 one")).toBeTruthy();
    expect(drop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Discard this stash?")).toBeNull();
    expect(drop).not.toHaveBeenCalled();

    // And it is a *second* press that destroys it, not the first.
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await vi.waitFor(() => expect(drop).toHaveBeenCalledWith(0));
    expect(await screen.findByText("Nothing stashed.")).toBeTruthy();
  });

  it("shows the daemon's refusal beside the control, and keeps the stash", async () => {
    const pop = vi.fn(
      async (): Promise<{ ok: false; message: string; key: string } & Refusal> => ({
        ok: false as const,
        message: "Putting a stash back needs a clean working tree.",
        key: "error.gitStashDirty",
      }),
    );
    renderChanges(actions({ pop }));

    fireEvent.click(await screen.findByRole("button", { name: "Put back" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("clean working tree");
    // The refusal is about an attempt: the stash is still in the list, to be tried again.
    expect(screen.getByText("WIP on main: 3c3a2b9 one")).toBeTruthy();
  });

  it("offers no stash control at all when the daemon does not serve them", async () => {
    renderChanges(undefined);
    await screen.findByText("src/main.ts");
    expect(screen.queryByTestId("stash-panel")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stash" })).toBeNull();
  });

  it("does not call an unreadable list an empty one", async () => {
    // A daemon that is a build behind refuses the method. "Nothing stashed." would then be a claim about the
    // repository made out of a call that never happened, so the refusal is what the panel says instead.
    renderChanges(
      actions({
        // A real key, so the assertion is about the panel's rendering rather than about the fake's shape.
        list: async () => ({ ok: false as const, message: "The daemon's English.", key: "error.gitStashDirty" }),
      }),
    );
    expect(await screen.findByText(en["error.gitStashDirty"])).toBeTruthy();
    expect(screen.queryByText("Nothing stashed.")).toBeNull();
  });
});
