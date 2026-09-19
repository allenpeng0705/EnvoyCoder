/**
 * The tab row's plus: Task, Terminal, Browser.
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@xterm/xterm", () => {
  class Terminal {
    rows = 24;
    cols = 80;
    open(): void {}
    loadAddon(): void {}
    onData(): { dispose(): void } {
      return { dispose() {} };
    }
    dispose(): void {}
    write(): void {}
    focus(): void {}
  }
  return { Terminal };
});

vi.mock("@xterm/addon-fit", () => {
  class FitAddon {
    fit(): void {}
  }
  return { FitAddon };
});

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { WorkArea } from "../src/components/WorkArea.js";

afterEach(() => {
  cleanup();
});

function renderArea(onNewTask?: () => void) {
  return render(
    <WorkArea openRequest={undefined} cwd="/repo" onViewingFile={() => {}} {...(onNewTask ? { onNewTask } : {})}>
      <p>the chat</p>
    </WorkArea>,
  );
}

describe("the new-tab menu", () => {
  it("offers Task, Terminal and Browser", () => {
    const onNewTask = vi.fn();
    renderArea(onNewTask);
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(screen.getByRole("menuitem", { name: "Task" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Terminal" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Browser" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Task" }));
    expect(onNewTask).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("adds a terminal tab and a browser tab", () => {
    renderArea();
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Terminal" }));
    expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Browser" }));
    expect(screen.getByRole("tab", { name: "Browser" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Web address" })).toBeTruthy();
  });
});
