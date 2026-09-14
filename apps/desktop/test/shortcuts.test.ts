/**
 * The shortcut layer: one `Mod`, and conflicts that are reported.
 *
 * These are the two places we deliberately differ from Paseo, so they are the two things worth pinning:
 * a `Mod` binding must mean Cmd on macOS and Ctrl elsewhere (their pane and window bindings are mac-only
 * because they spelled `Cmd` and never used `Mod`), and a duplicated combo must be *findable* rather than
 * silently resolved by declaration order.
 */

import { describe, expect, it } from "vitest";

import {
  SHELL_BINDINGS,
  bindingApplies,
  comboMatches,
  createShortcutRegistry,
  findConflicts,
  parseCombo,
  platformOf,
} from "../src/input/shortcuts.js";

const mac = { platform: "mac" } as const;
const other = { platform: "other" } as const;

describe("combo matching", () => {
  it("turns Mod into Cmd on macOS and Ctrl everywhere else", () => {
    expect(comboMatches("Mod+K", { key: "k", metaKey: true }, "mac")).toBe(true);
    expect(comboMatches("Mod+K", { key: "k", ctrlKey: true }, "mac")).toBe(false);
    expect(comboMatches("Mod+K", { key: "k", ctrlKey: true }, "other")).toBe(true);
    expect(comboMatches("Mod+K", { key: "k", metaKey: true }, "other")).toBe(false);
  });

  it("accepts the explicit spelling too, so a mac-only binding can be written down", () => {
    expect(comboMatches("Cmd+K", { key: "k", metaKey: true }, "mac")).toBe(true);
    expect(comboMatches("Ctrl+K", { key: "k", ctrlKey: true }, "other")).toBe(true);
  });

  it("does not fire when the other platform's modifier is also held", () => {
    // Cmd+Ctrl+K is not Mod+K: a binding that ignores that is a binding that fires when a user is
    // reaching for something else.
    expect(comboMatches("Mod+K", { key: "k", metaKey: true, ctrlKey: true }, "mac")).toBe(false);
  });

  it("requires shift and alt to match exactly", () => {
    expect(comboMatches("Mod+Shift+K", { key: "k", metaKey: true, shiftKey: true }, "mac")).toBe(true);
    expect(comboMatches("Mod+Shift+K", { key: "k", metaKey: true }, "mac")).toBe(false);
    expect(comboMatches("Mod+K", { key: "k", metaKey: true, shiftKey: true }, "mac")).toBe(false);
  });

  it("matches character keys case-insensitively and named keys by name", () => {
    expect(comboMatches("Mod+K", { key: "K", metaKey: true }, "mac")).toBe(true);
    expect(comboMatches("Escape", { key: "Escape" }, "mac")).toBe(true);
    expect(comboMatches("Shift+?", { key: "?", shiftKey: true }, "mac")).toBe(true);
  });

  it("refuses a combo it cannot parse rather than guessing", () => {
    expect(parseCombo("Hyper+K")).toBeNull();
    expect(comboMatches("Hyper+K", { key: "k" }, "mac")).toBe(false);
    expect(parseCombo("")).toBeNull();
  });
});

describe("when a binding applies", () => {
  it("keeps letters away from text fields unless the binding opts in", () => {
    const nav = { id: "newTask", combos: ["Mod+N"], label: "New task" };
    const palette = { id: "commandCenter.open", combos: ["Mod+K"], label: "Palette", when: { editable: true } };
    expect(bindingApplies(nav, { ...mac, scope: "editable" })).toBe(false);
    expect(bindingApplies(palette, { ...mac, scope: "editable" })).toBe(true);
  });

  it("keeps almost everything away from a terminal", () => {
    // The agent reads those keys; a shell shortcut that steals them is worse than a missing shortcut.
    const interrupt = { id: "run.interrupt", combos: ["Escape"], label: "Stop", when: { terminal: true } };
    expect(bindingApplies(interrupt, { ...mac, scope: "terminal" })).toBe(true);
    expect(bindingApplies(SHELL_BINDINGS.find((b) => b.id === "sidebar.toggle")!, { ...mac, scope: "terminal" }))
      .toBe(false);
  });

  it("honours a platform restriction, which is how a mac-only binding stays mac-only", () => {
    const macOnly = { id: "x", combos: ["Mod+1"], label: "x", when: { platform: "mac" as const } };
    expect(bindingApplies(macOnly, { ...mac, scope: "other" })).toBe(true);
    expect(bindingApplies(macOnly, { ...other, scope: "other" })).toBe(false);
  });
});

describe("the registry", () => {
  const registry = createShortcutRegistry(SHELL_BINDINGS, mac);

  it("returns the binding that handled the event, or null", () => {
    expect(registry.handle({ key: "k", metaKey: true }, "other")?.id).toBe("commandCenter.open");
    expect(registry.handle({ key: "z", metaKey: true }, "other")).toBeNull();
  });

  it("never fires during an IME composition", () => {
    // Composing Chinese, Japanese or Korean text must not trigger a shortcut mid-character.
    expect(registry.handle({ key: "k", metaKey: true, isComposing: true }, "other")).toBeNull();
    expect(registry.handle({ key: "Process", metaKey: true }, "other")).toBeNull();
  });

  it("reports a conflict instead of letting declaration order decide silently", () => {
    const clashing = [
      { id: "a", combos: ["Mod+J"], label: "A" },
      { id: "b", combos: ["Mod+J"], label: "B" },
    ];
    expect(findConflicts(clashing)).toEqual([{ combo: "mod+j", ids: ["a", "b"] }]);
    // The shipping set has none — this is the assertion that keeps it that way.
    expect(createShortcutRegistry(SHELL_BINDINGS, mac).conflicts).toEqual([]);
  });

  it("shows the platform's own symbols", () => {
    expect(registry.display("commandCenter.open")).toContain("K");
    expect(createShortcutRegistry(SHELL_BINDINGS, other).display("commandCenter.open")).toBe("Ctrl+K");
  });

  it("gives every shell binding a label and a group, so the help sheet can be generated", () => {
    for (const binding of SHELL_BINDINGS) {
      expect(binding.label.length, binding.id).toBeGreaterThan(0);
      expect(binding.group, binding.id).toBeDefined();
      expect(binding.combos.length, binding.id).toBeGreaterThan(0);
    }
  });

  it("recognises the platform strings a runtime actually hands us", () => {
    expect(platformOf("darwin")).toBe("mac");
    expect(platformOf("win32")).toBe("other");
    expect(platformOf("linux")).toBe("other");
  });
});
