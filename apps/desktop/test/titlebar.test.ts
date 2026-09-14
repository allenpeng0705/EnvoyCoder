/**
 * The window's own top bar, guarded at the level the bugs actually live.
 *
 * Three defects were reported together and came from two mechanisms being confused: the bar used
 * **`-webkit-app-region: drag`**, which is Electron's way and which Tauri ignores — so the window could not
 * be moved by its own bar, and on engines that *do* honour that rule a drag region swallows the mouse events
 * of everything inside it, which is why the controls in the row could not be tapped either. And the shell asks
 * for an **overlay** title bar (`tauri.conf.json`), so macOS draws its window buttons *over* the webview: a bar
 * starting at x=0 puts the app's mark and name under them.
 *
 * A rendering test cannot see any of that — jsdom has no window, no traffic lights and no drag. So this reads
 * the two sources that decide it and asserts the mechanisms: the Tauri attribute is present, the Electron rule
 * is absent, and the macOS inset exists. It is a citation, not a proof; the proof is dragging the real window.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canDragWindow, startWindowDrag } from "../src/client/window-drag.js";

const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const app = readFileSync(join(root, "src/components/CoderApp.tsx"), "utf8");
const main = readFileSync(join(root, "src/main.tsx"), "utf8");
const capability = readFileSync(join(root, "src-tauri/capabilities/default.json"), "utf8");
const drag = readFileSync(join(root, "src/client/window-drag.ts"), "utf8");

describe("the title bar", () => {
  it("is a drag region the way Tauri reads one", () => {
    expect(app).toMatch(/<header[\s\S]{0,200}?className="titlebar"[\s\S]{0,200}?data-tauri-drag-region/);
  });

  it("never goes back to Electron's mechanism, which Tauri ignores", () => {
    // Not "no mention": a comment explaining the removal is welcome. What must not come back is a *rule*.
    expect(css).not.toMatch(/^\s*-webkit-app-region:\s*(drag|no-drag)/m);
  });

  it("leaves room for macOS's window buttons, which are drawn over the webview", () => {
    expect(css).toMatch(/:root\[data-os="macos"\] \.titlebar\s*\{[^}]*padding-left/);
    // …which needs the platform signal to exist at all, or the rule above is dead code that looks alive.
    expect(main).toMatch(/dataset\.os\s*=/);
  });
});

describe("moving the window from its own bar", () => {
  afterEach(() => {
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  });

  /** A press target: `hasControl` decides whether it sits inside an interactive element. */
  function target(hasControl: boolean): EventTarget {
    return { closest: () => (hasControl ? {} : null) } as unknown as EventTarget;
  }

  function withShell(): ReturnType<typeof vi.fn> {
    const startDragging = vi.fn(async () => undefined);
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
      window: { getCurrentWindow: () => ({ startDragging }) },
    };
    return startDragging;
  }

  it("drags when the press lands on the bar itself", () => {
    const startDragging = withShell();
    expect(startWindowDrag({ target: target(false), button: 0 })).toBe(true);
    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("leaves a control's click alone", () => {
    // The reason this is a behaviour rather than an attribute: a bar whose controls are also a drag region
    // is a bar whose buttons cannot be pressed.
    const startDragging = withShell();
    expect(startWindowDrag({ target: target(true), button: 0 })).toBe(false);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("ignores a press that is not the primary button", () => {
    const startDragging = withShell();
    expect(startWindowDrag({ target: target(false), button: 2 })).toBe(false);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("is inert in a window that is not our shell", () => {
    // The browser dev server and the served build have no `__TAURI__`; a handler that threw here would
    // break every press of the bar in the place this app is developed.
    expect(canDragWindow()).toBe(false);
    expect(startWindowDrag({ target: target(false), button: 0 })).toBe(false);
  });

  it("carries the attribute on the children a press actually lands on", () => {
    // Tauri's own handler fires only for the pressed element, and this bar is covered by its children —
    // the bug that made the first fix look right and do nothing.
    expect(app).toMatch(/className="titlebar__title" data-tauri-drag-region/);
    expect(app).toMatch(/className="titlebar__spacer" data-tauri-drag-region/);
    expect(app).toMatch(/onMouseDown=\{\(event\) => startWindowDrag\(event\)\}/);
  });
});

describe("the shell's side of the drag", () => {
  it("allows the command both drag mechanisms go through", () => {
    // The failure this exists for: the attribute was on the right element and the API call was correct, and
    // the window still would not move, because Tauri v2 refuses `start_dragging` unless the capability grants
    // it — silently. Capabilities are compiled into the binary, so nothing in the frontend could reveal it.
    expect(capability).toContain("core:window:allow-start-dragging");
  });

  it("keeps that permission tied to a bar that actually drags", () => {
    // The other direction: the permission is only here because this app draws its own title bar. If the drag
    // is ever removed, the grant should go with it rather than linger as a capability nobody can explain.
    const drags = /data-tauri-drag-region/.test(app) || /startWindowDrag/.test(drag);
    expect(drags).toBe(true);
    expect(capability).toContain("core:window:allow-start-dragging");
  });
});
