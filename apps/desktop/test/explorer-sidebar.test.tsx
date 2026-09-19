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
import type { ChangeListing, DirectoryListing } from "../src/components/ExplorerSidebar.js";

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
  } = {},
): void {
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
          changes: [{ path: "src/main.ts", kind: "modified" as const }],
        }))
      }
      onSend={vi.fn()}
      onAnswer={vi.fn()}
      onStart={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

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
          changes: [{ path: "src/main.ts", kind: "modified" as const }],
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
});
