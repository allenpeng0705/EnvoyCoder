/**
 * The shortcut layer: one `Mod`, and conflicts that are reported.
 *
 * These are the two places we deliberately differ from Paseo, so they are the two things worth pinning:
 * a `Mod` binding must mean Cmd on macOS and Ctrl elsewhere (their pane and window bindings are mac-only
 * because they spelled `Cmd` and never used `Mod`), and a duplicated combo must be *findable* rather than
 * silently resolved by declaration order.
 */

import { describe, expect, it } from "vitest";

import { isMessageKey } from "../src/i18n/messages/en.js";
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
    const nav = { id: "newTask", combos: ["Mod+N"], labelKey: "settings.shortcuts.binding.newTask" as const };
    const palette = {
      id: "commandCenter.open",
      combos: ["Mod+K"],
      labelKey: "settings.shortcuts.binding.commandCenter" as const,
      when: { editable: true },
    };
    expect(bindingApplies(nav, { ...mac, scope: "editable" })).toBe(false);
    expect(bindingApplies(palette, { ...mac, scope: "editable" })).toBe(true);
  });

  it("keeps almost everything away from a terminal", () => {
    // The agent reads those keys; a shell shortcut that steals them is worse than a missing shortcut.
    const interrupt = {
      id: "run.interrupt",
      combos: ["Escape"],
      labelKey: "settings.shortcuts.binding.interrupt" as const,
      when: { terminal: true },
    };
    expect(bindingApplies(interrupt, { ...mac, scope: "terminal" })).toBe(true);
    expect(bindingApplies(SHELL_BINDINGS.find((b) => b.id === "sidebar.toggle")!, { ...mac, scope: "terminal" }))
      .toBe(false);
  });

  it("honours a platform restriction, which is how a mac-only binding stays mac-only", () => {
    const macOnly = {
      id: "x",
      combos: ["Mod+1"],
      labelKey: "app.name" as const,
      when: { platform: "mac" as const },
    };
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
      { id: "a", combos: ["Mod+J"], labelKey: "app.name" as const },
      { id: "b", combos: ["Mod+J"], labelKey: "app.name" as const },
    ];
    expect(findConflicts(clashing)).toEqual([{ combo: "mod+j", ids: ["a", "b"] }]);
    // The shipping set has none — this is the assertion that keeps it that way.
    expect(createShortcutRegistry(SHELL_BINDINGS, mac).conflicts).toEqual([]);
  });

  it("shows the platform's own symbols", () => {
    expect(registry.display("commandCenter.open")).toContain("K");
    expect(createShortcutRegistry(SHELL_BINDINGS, other).display("commandCenter.open")).toBe("Ctrl+K");
  });

  it("gives every shell binding a catalogue key for its label and its group", () => {
    // **A key, not a sentence.** These were English strings nothing rendered; the settings pane renders
    // them now, so a hardcoded label would be an English row inside a German window. Asserted against the
    // catalogue rather than against "is a string": a key the catalogue does not have is a row the pane
    // would print as `settings.shortcuts.binding.something` for a user to read.
    for (const binding of SHELL_BINDINGS) {
      expect(isMessageKey(binding.labelKey), `${binding.id}: ${binding.labelKey}`).toBe(true);
      expect(binding.groupKey, binding.id).toBeDefined();
      expect(isMessageKey(binding.groupKey ?? ""), `${binding.id}: ${binding.groupKey}`).toBe(true);
      expect(binding.combos.length, binding.id).toBeGreaterThan(0);
    }
  });

  it("recognises the platform strings a runtime actually hands us", () => {
    expect(platformOf("darwin")).toBe("mac");
    expect(platformOf("win32")).toBe("other");
    expect(platformOf("linux")).toBe("other");
  });
});
