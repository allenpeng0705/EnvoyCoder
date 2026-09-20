/**
 * The explorer sidebar: folders, files, and changes for the open task.
 *
 * The toggle itself is the title bar's top-right button (`CoderApp`), not a control in this pane.
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@envoydev/protocol";

import { TaskPane } from "../src/components/TaskPane.js";
import type {
  ChangeListing,
  DirectoryListing,
  ExplorerChange,
} from "../src/components/ExplorerSidebar.js";
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

function renderExplorer(
  overrides: {
    explorerOpen?: boolean;
    onListDirectory?: (path: string) => Promise<DirectoryListing>;
    onListChanges?: (path: string) => Promise<ChangeListing>;
    /** What the Changes tab lists, when a test cares about stagedness. */
    changes?: readonly ExplorerChange[];
    onStage?: (paths: readonly string[]) => Promise<{ ok: true; changes: readonly ExplorerChange[] } | Refusal>;
    onUnstage?: (paths: readonly string[]) => Promise<{ ok: true; changes: readonly ExplorerChange[] } | Refusal>;
    onCommit?: (
      message: string,
    ) => Promise<{ ok: true; sha: string; changes: readonly ExplorerChange[] } | Refusal>;
  } = {},
): void {
  const changes = overrides.changes ?? [
    { path: "src/main.ts", kind: "modified" as const, staged: false, unstaged: true },
  ];
  render(
    <TaskPane
      task={task}
      project={undefined}
      events={[]}
      runLive={false}
      explorerOpen={overrides.explorerOpen ?? true}
      onListDirectory={
        overrides.onListDirectory ??
        (async () => ({
          ok: true as const,
          entries: [
            { name: "src", kind: "dir" as const, path: "/repo/src" },
            { name: "node_modules", kind: "dir" as const, path: "/repo/node_modules" },
            { name: "README.md", kind: "file" as const, path: "/repo/README.md" },
          ],
        }))
      }
      onListChanges={
        overrides.onListChanges ??
        (async () => ({
          ok: true as const,
          repo: true,
          changes,
        }))
      }
      {...(overrides.onStage !== undefined ? { onStage: overrides.onStage } : {})}
      {...(overrides.onUnstage !== undefined ? { onUnstage: overrides.onUnstage } : {})}
      {...(overrides.onCommit !== undefined ? { onCommit: overrides.onCommit } : {})}
      onSend={vi.fn()}
      onAnswer={vi.fn()}
      onStart={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

/** The Changes tab, with the three writes the daemon exposes. */
const CHANGES = [
  { path: "src/main.ts", kind: "modified" as const, staged: false, unstaged: true },
  { path: "src/new.ts", kind: "added" as const, staged: true, unstaged: false },
];

describe("the explorer sidebar", () => {
  it("stays closed until the window asks for it", () => {
    renderExplorer({ explorerOpen: false });
    expect(screen.queryByTestId("explorer-sidebar")).toBeNull();
  });

  it("lists folders and files, and hides node_modules", async () => {
    const onListDirectory = vi.fn(async (path: string): Promise<DirectoryListing> => {
      if (path === "/repo/src") {
        return { ok: true, entries: [{ name: "main.ts", kind: "file", path: "/repo/src/main.ts" }] };
      }
      return {
        ok: true,
        entries: [
          { name: "src", kind: "dir", path: "/repo/src" },
          { name: "node_modules", kind: "dir", path: "/repo/node_modules" },
          { name: ".git", kind: "dir", path: "/repo/.git" },
          { name: "README.md", kind: "file", path: "/repo/README.md" },
        ],
      };
    });
    renderExplorer({ onListDirectory });
    expect(await screen.findByText("README.md")).toBeTruthy();
    expect(screen.queryByText("node_modules")).toBeNull();
    expect(screen.queryByText(".git")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "src" }));
    expect(await screen.findByText("main.ts")).toBeTruthy();
  });

  it("opens a file as a tab in the content area", async () => {
    render(
      <TaskPane
        task={task}
        project={undefined}
        events={[]}
        runLive={false}
        explorerOpen
        onListDirectory={async () => ({
          ok: true as const,
          entries: [{ name: "README.md", kind: "file" as const, path: "/repo/README.md" }],
        })}
        onListChanges={async () => ({ ok: true as const, repo: true, changes: [] })}
        onReadFile={async () => ({
          ok: true as const,
          file: { path: "/repo/README.md", name: "README.md", kind: "text" as const, size: 5, content: "hello file" },
        })}
        onSend={vi.fn()}
        onAnswer={vi.fn()}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
    expect(await screen.findByText("hello file")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Chat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide hidden files" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh files" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Name" })).toBeTruthy();
  });

  it("lists changes, and says when the folder is not a git repository", async () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(await screen.findByText("src/main.ts")).toBeTruthy();
    expect(screen.getByText("Modified")).toBeTruthy();

    cleanup();
    renderExplorer({
      onListChanges: async () => ({ ok: true, repo: false, changes: [] }),
    });
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(await screen.findByText("This folder is not a git repository.")).toBeTruthy();
  });

  it("opens a change as a diff in the content area", async () => {
    render(
      <TaskPane
        task={task}
        project={undefined}
        events={[]}
        runLive={false}
        explorerOpen
        onListDirectory={async () => ({ ok: true as const, entries: [] })}
        onListChanges={async () => ({
          ok: true as const,
          repo: true,
          changes: [{ path: "src/main.ts", kind: "modified" as const, staged: false, unstaged: true }],
        })}
        onReadDiff={async () => ({
          ok: true as const,
          diff: {
            path: "src/main.ts",
            name: "main.ts",
            kind: "text" as const,
            size: 20,
            content: "@@ -1 +1 @@\n-old\n+new\n",
          },
        })}
        onSend={vi.fn()}
        onAnswer={vi.fn()}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    fireEvent.click(await screen.findByRole("button", { name: /src\/main\.ts/ }));
    expect(await screen.findByText("new")).toBeTruthy();
    expect(screen.getByText("old")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("stages one path, and only the control that would do something is drawn", async () => {
    const onStage = vi.fn(async () => ({
      ok: true as const,
      changes: [{ path: "src/main.ts", kind: "modified" as const, staged: true, unstaged: false }],
    }));
    renderExplorer({ changes: CHANGES, onStage, onUnstage: vi.fn(async () => ({ ok: true as const, changes: [] })) });

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    await screen.findByText("src/main.ts");

    // One file is unstaged (so it offers `+`), the other is staged (so it offers `−`) — and neither offers
    // the action that would do nothing.
    fireEvent.click(screen.getByRole("button", { name: "Stage src/main.ts" }));
    await vi.waitFor(() => expect(onStage).toHaveBeenCalledWith(["src/main.ts"]));
    expect(screen.getByRole("button", { name: "Unstage src/new.ts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stage src/new.ts" })).toBeNull();
  });

  it("commits what is staged, with the message, and reports the commit", async () => {
    const onCommit = vi.fn(async () => ({
      ok: true as const,
      sha: "abc1234def5678",
      changes: [],
    }));
    renderExplorer({ changes: CHANGES, onCommit, onStage: vi.fn() });

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    await screen.findByText("src/main.ts");

    // The button is off until both facts hold: a message, and something in the index.
    const commitButton = screen.getByRole("button", { name: "Commit" }) as HTMLButtonElement;
    expect(commitButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Commit message"), { target: { value: "add the keys" } });
    expect((screen.getByRole("button", { name: "Commit" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledWith("add the keys"));
    // The list came back from the write, and the sentence names the short sha rather than a wall of hex.
    expect(await screen.findByText("Committed abc1234.")).toBeTruthy();
  });

  it("stages every changed path from one press, as a decision the user makes", async () => {
    const onStage = vi.fn(async () => ({ ok: true as const, changes: [] }));
    renderExplorer({ changes: CHANGES, onStage, onCommit: vi.fn() });

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    await screen.findByText("src/main.ts");

    // Only the *unstaged* path: staging something already in the index again is a no-op, not an error.
    fireEvent.click(screen.getByRole("button", { name: "Stage all" }));
    await vi.waitFor(() => expect(onStage).toHaveBeenCalledWith(["src/main.ts"]));
  });

  it("shows the daemon's refusal beside the control that caused it", async () => {
    const onCommit = vi.fn(async (): Promise<{ ok: false; message: string } & Refusal> => ({
      ok: false as const,
      message: "Nothing is staged.",
      key: "error.gitNothingStaged",
    }));
    renderExplorer({ changes: CHANGES, onCommit, onStage: vi.fn() });

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    await screen.findByText("src/main.ts");
    fireEvent.change(screen.getByLabelText("Commit message"), { target: { value: "anything" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Nothing is staged");
    // And the message the user typed is still there to be edited.
    expect((screen.getByLabelText("Commit message") as HTMLInputElement).value).toBe("anything");
  });
});
