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
import { CommandCenter, type CommandContribution } from "../src/components/CommandCenter.js";

afterEach(cleanup);

function show(contributions: CommandContribution[], onClose = vi.fn()): void {
  render(
    <CommandCenter open onClose={onClose} contributions={contributions} />,
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
