/**
 * Shell toast store — outlives pane unmount; replaces previous toast.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dismissShellToast,
  getShellToast,
  showShellToast,
  subscribeShellToast,
} from "../src/state/shell-toast.js";

afterEach(() => {
  dismissShellToast();
  vi.useRealTimers();
});

describe("shell-toast", () => {
  it("publishes a toast and notifies subscribers", () => {
    const seen: string[] = [];
    const unsub = subscribeShellToast(() => {
      seen.push(getShellToast()?.message ?? "");
    });
    showShellToast("Invite copied.");
    expect(getShellToast()?.message).toBe("Invite copied.");
    expect(getShellToast()?.tone).toBe("ok");
    expect(seen).toContain("Invite copied.");
    unsub();
  });

  it("auto-dismisses after ttl", () => {
    vi.useFakeTimers();
    showShellToast("Gone soon", { ttlMs: 1000 });
    expect(getShellToast()?.message).toBe("Gone soon");
    vi.advanceTimersByTime(1000);
    expect(getShellToast()).toBeUndefined();
  });

  it("ignores empty messages", () => {
    expect(showShellToast("   ")).toBe("");
    expect(getShellToast()).toBeUndefined();
  });
});
