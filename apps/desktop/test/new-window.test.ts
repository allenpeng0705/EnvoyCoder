/**
 * The shell's "Open in new window" client — invoke wiring without a real Tauri bridge.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canOpenProjectInNewWindow,
  openProjectInNewWindow,
  takePendingProject,
} from "../src/client/new-window.js";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function installBridge(invoke: Invoke): void {
  (globalThis as { __TAURI__?: { core: { invoke: Invoke } } }).__TAURI__ = {
    core: { invoke },
  };
}

afterEach(() => {
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
});

describe("new-window client", () => {
  it("hides the affordance when there is no shell", () => {
    expect(canOpenProjectInNewWindow()).toBe(false);
  });

  it("opens a window with the project id the menu passed", async () => {
    const invoke = vi.fn(async () => undefined);
    installBridge(invoke);
    expect(canOpenProjectInNewWindow()).toBe(true);
    await expect(openProjectInNewWindow("proj-1")).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("new_window", { projectId: "proj-1" });
  });

  it("refuses an empty project id without calling the shell", async () => {
    const invoke = vi.fn(async () => undefined);
    installBridge(invoke);
    await expect(openProjectInNewWindow("  ")).resolves.toEqual({
      ok: false,
      reason: "No project to open.",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("surfaces a shell refusal as a failed open", async () => {
    installBridge(async () => {
      throw new Error("permission denied");
    });
    await expect(openProjectInNewWindow("proj-1")).resolves.toEqual({
      ok: false,
      reason: "permission denied",
    });
  });

  it("takes the pending project once from the shell", async () => {
    const invoke = vi.fn(async () => "proj-landing");
    installBridge(invoke);
    await expect(takePendingProject()).resolves.toBe("proj-landing");
    expect(invoke).toHaveBeenCalledWith("take_pending_project");
  });

  it("returns nothing outside the shell", async () => {
    await expect(takePendingProject()).resolves.toBeUndefined();
  });
});
