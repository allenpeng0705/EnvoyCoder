/**
 * Moving the window from its own top bar.
 *
 * ## Why the declarative way was not enough
 *
 * Tauri drags a window when a `mousedown` happens on an element carrying `data-tauri-drag-region` — **the
 * element itself**, not an ancestor of it. So putting the attribute on the bar's `<header>` moves nothing:
 * the bar is almost entirely covered by its children (the title, the spacer, the connection chip), and a
 * press lands on one of those, which carries no attribute. The window could not be dragged anywhere except
 * the few pixels of bare header between controls.
 *
 * The attribute stays (it is the documented mechanism, and it costs nothing on the bare patches), but the
 * drag itself is asked for explicitly here, from the same `mousedown`, which does not care what was pressed
 * — except for the one thing it must care about: a control that was pressed must get its click.
 *
 * ## Why feature detection rather than a dependency
 *
 * The shell runs with `withGlobalTauri`, so the window API is on `globalThis.__TAURI__` — the same channel
 * `folder-picker.ts` already reads for `core.invoke`. In a browser (the Vite dev server, the served build)
 * there is no shell, `canDragWindow()` is false, and the handler is inert instead of throwing on every press
 * of the bar. A missing API is not an error here: it means "this window is not our shell".
 */

/** The slice of `__TAURI__` this needs, typed the way `folder-picker.ts` types its own. */
interface TauriWindowGlobal {
  window?: { getCurrentWindow?: () => { startDragging?: () => Promise<void> } };
}

function currentWindow(): { startDragging?: () => Promise<void> } | undefined {
  const candidate = (globalThis as { __TAURI__?: TauriWindowGlobal }).__TAURI__;
  return candidate?.window?.getCurrentWindow?.();
}

/** Whether pressing this window's chrome can move it — false in a plain browser. */
export function canDragWindow(): boolean {
  return currentWindow()?.startDragging !== undefined;
}

/**
 * The interactive things a press must reach instead of dragging.
 *
 * Deliberately a selector list rather than a class check: a control added later inherits the protection by
 * being a control, which is the property that keeps a new button in this bar from becoming a dead patch.
 */
const INTERACTIVE = "button, a, input, select, textarea, label, [role='button'], [role='menuitem']";

/**
 * Start moving the window, unless the press was aimed at a control.
 *
 * Returns whether a drag was started, so a caller (and a test) can tell "moved the window" from "left the
 * click alone" — a boolean nobody reads is how this kind of handler quietly stops working.
 */
export function startWindowDrag(event: { target: EventTarget | null; button?: number }): boolean {
  if (event.button !== undefined && event.button !== 0) return false;
  // Duck-typed rather than `instanceof Element`: this runs in a webview, but a Node test has no `Element`,
  // and a guard that cannot be exercised outside a browser is a guard nobody checks.
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (typeof target?.closest === "function" && target.closest(INTERACTIVE) != null) return false;
  const start = currentWindow()?.startDragging;
  if (!start) return false;
  void start();
  return true;
}
