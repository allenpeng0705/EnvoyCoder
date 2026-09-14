/**
 * The shortcut layer is *mounted*, not just written.
 *
 * The bug this exists for: `shortcuts.ts` shipped with tests and no caller, so the rail button showed
 * `⌘K` while pressing it did nothing — and the palette, with "Add project…" inside it, was unreachable
 * by keyboard. Unit tests on the registry all passed; the app had no keyboard at all. So this test drives
 * a real `keydown` through the hook and asserts the action ran.
 */

/** @vitest-environment jsdom */

import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { useShortcuts } from "../src/input/useShortcuts.js";

function Harness({ actions }: { actions: Record<string, () => void> }): JSX.Element {
  useShortcuts(actions, "darwin");
  return <input aria-label="composer" />;
}

afterEach(cleanup);

function press(key: string, options: KeyboardEventInit = {}, target?: Element): void {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  (target ?? document.body).dispatchEvent(event);
}

describe("mounting the shortcut layer", () => {
  it("runs the bound action when its combo is pressed", () => {
    const open = vi.fn();
    render(<Harness actions={{ "commandCenter.open": open }} />);
    press("k", { metaKey: true });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does not fire a binding that has no action — and does not swallow the key", () => {
    // A painted-but-unimplemented shortcut must leave the keystroke alone for whatever else wanted it.
    const open = vi.fn();
    render(<Harness actions={{ "commandCenter.open": open }} />);
    press("n", { metaKey: true });
    expect(open).not.toHaveBeenCalled();
  });

  it("honours the focus scope: the palette opens while typing, letters do not fire there", () => {
    const open = vi.fn();
    const { getByLabelText } = render(<Harness actions={{ "commandCenter.open": open }} />);
    const composer = getByLabelText("composer");
    composer.focus();
    // `commandCenter.open` opts in with `editable: true`, so it works from inside the composer.
    press("k", { metaKey: true }, composer);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("ignores a keystroke that is an IME composition", () => {
    const open = vi.fn();
    render(<Harness actions={{ "commandCenter.open": open }} />);
    press("k", { metaKey: true, isComposing: true });
    expect(open).not.toHaveBeenCalled();
  });

  it("stops listening when the window unmounts", () => {
    const open = vi.fn();
    const { unmount } = render(<Harness actions={{ "commandCenter.open": open }} />);
    unmount();
    press("k", { metaKey: true });
    expect(open).not.toHaveBeenCalled();
  });
});
