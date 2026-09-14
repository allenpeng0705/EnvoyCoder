/**
 * Keyboard shortcuts — the mechanism, with the two things Paseo's own layer lacks.
 *
 * The component owner wires this; the app today has **no key handler at all** (the Command Center button
 * *displays* `⌘K` with nothing behind it), so this file is the missing layer rather than a duplicate of
 * one. Every binding in the sidebar, the composer and the palette should go through it, because a
 * shortcut layer is exactly the thing that rots when each component listens for itself.
 *
 * ## What is copied from Paseo's design
 *
 * `Mod` (Cmd on macOS, Ctrl elsewhere), the four interaction axes (`mac`, `desktop`, `editable`,
 * `terminal`), focus scopes so a global binding cannot fire while someone is typing, and a help sheet
 * that renders *the bindings themselves* rather than a hand-written list that drifts.
 *
 * ## The two things we do differently, on purpose
 *
 *   1. **`Mod` is the normal spelling.** Paseo declares `Cmd+…` and `Ctrl+…` separately for all 76
 *      bindings and never uses its own `Mod` token — which is how their pane split/focus/move/close
 *      bindings ended up mac-only, leaving Windows and Linux users with no keyboard route to any of it
 *      (`keyboard-shortcuts.ts:712-835`). We are React + Tauri, not mac-first: `Mod+K` means what the
 *      platform says, and `Cmd+K`/`Ctrl+K` are still accepted for clarity.
 *   2. **Conflicts are reported, not silently resolved.** Paseo's first declaration wins
 *      (`:1419-1421`), so a user override can shadow a default with no warning. Here a duplicate combo in
 *      the same scope is a finding the shell can show.
 */

/** The platforms this app runs on. `mac` is the only one where `Mod` means Cmd. */
export type ShortcutPlatform = "mac" | "other";

export function platformOf(platform: string): ShortcutPlatform {
  return platform === "darwin" || platform === "macos" || platform === "mac" ? "mac" : "other";
}

/** Where focus is, so a global binding never steals a keystroke from a text field. */
export type FocusScope = "editable" | "terminal" | "other";

export interface ShortcutWhen {
  /** Only on macOS / only off it. Omit for both — which is the default we want people to use. */
  platform?: ShortcutPlatform;
  /** May the binding fire while a text field has focus? `false` is the usual answer for letters. */
  editable?: boolean;
  /** May it fire while a terminal has focus? Almost never: the agent needs those keys. */
  terminal?: boolean;
}

export interface KeyBinding {
  /** Stable id, also the key a user override is stored under. Never rename one: overrides are saved by id. */
  id: string;
  /** One or more combos, any of which fires the binding. First is the one shown in help. */
  combos: readonly string[];
  /** What a user reads in the help sheet. */
  label: string;
  /** The group it belongs to in the help sheet, most-reached-for first. */
  group?: string;
  when?: ShortcutWhen;
}

interface ParsedCombo {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

/**
 * Parse one combo: `Mod+Shift+K`, `Cmd+K`, `Ctrl+\``, `Escape`, `?`.
 *
 * Deliberately small — a shortcut grammar that grows features grows bugs, and everything we need is a
 * key plus the four modifiers.
 */
export function parseCombo(combo: string): ParsedCombo | null {
  const parts = combo.split("+").map((part) => part.trim());
  const key = parts.pop();
  if (!key) return null;
  const parsed: ParsedCombo = { key, mod: false, shift: false, alt: false };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod" || lower === "cmd" || lower === "ctrl" || lower === "meta") parsed.mod = true;
    else if (lower === "shift") parsed.shift = true;
    else if (lower === "alt" || lower === "option") parsed.alt = true;
    else return null; // an unknown modifier is a typo, and silently ignoring it changes the binding
  }
  return parsed;
}

/** Does this combo describe this event, on this platform? */
export function comboMatches(
  combo: string,
  event: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  platform: ShortcutPlatform,
): boolean {
  const parsed = parseCombo(combo);
  if (!parsed) return false;
  const modPressed =
    platform === "mac" ? event.metaKey === true : event.ctrlKey === true;
  // `Mod` means exactly one of Cmd/Ctrl for this platform; anything else must not be held, or
  // `Mod+K` would fire on Cmd+Ctrl+K.
  const otherModPressed =
    platform === "mac" ? event.ctrlKey === true : event.metaKey === true;

  const keyMatches =
    event.key.length === 1
      ? event.key.toLowerCase() === parsed.key.toLowerCase()
      : event.key.toLowerCase() === parsed.key.toLowerCase();

  return (
    keyMatches &&
    modPressed === parsed.mod &&
    otherModPressed === false &&
    (event.shiftKey === true) === parsed.shift &&
    (event.altKey === true) === parsed.alt
  );
}

/** Is this binding allowed to fire in the current context? */
export function bindingApplies(
  binding: KeyBinding,
  context: { platform: ShortcutPlatform; scope: FocusScope },
): boolean {
  // The scope checks apply whether or not a binding declares `when` — `when` *loosens* the defaults, it
  // does not switch them off. An earlier version returned early for a binding with no `when`, which made
  // every plain letter binding fire while someone was typing in the composer.
  const when = binding.when ?? {};
  if (when.platform && when.platform !== context.platform) return false;
  if (context.scope === "editable" && when.editable !== true) return false;
  if (context.scope === "terminal" && when.terminal !== true) return false;
  return true;
}

export interface ShortcutConflict {
  combo: string;
  ids: readonly string[];
}

/**
 * Combos claimed more than once, within the same platform axis.
 *
 * Two bindings that cannot both be available at the same time are not a conflict (one mac-only, one
 * non-mac-only); anything else is, and the first declared one is what would win.
 */
export function findConflicts(bindings: readonly KeyBinding[]): ShortcutConflict[] {
  // Per platform axis first: two bindings that cannot both be available at once (one mac-only, one
  // non-mac-only) are not a conflict, and that is the whole reason this is not a naive group-by-combo.
  const byAxis = new Map<string, string[]>();
  for (const binding of bindings) {
    for (const combo of binding.combos) {
      const axes = binding.when?.platform === undefined ? ["mac", "other"] : [binding.when.platform];
      for (const axis of axes) {
        const key = `${axis}\u0000${combo.toLowerCase()}`;
        byAxis.set(key, [...(byAxis.get(key) ?? []), binding.id]);
      }
    }
  }

  // Then merged by combo: the same pair clashing on both axes is one finding, not two, because a user
  // sees one shortcut, not one per platform.
  const merged = new Map<string, Set<string>>();
  for (const [key, ids] of byAxis) {
    if (ids.length < 2) continue;
    const combo = key.split("\u0000")[1];
    const existing = merged.get(combo) ?? new Set<string>();
    for (const id of ids) existing.add(id);
    merged.set(combo, existing);
  }

  return [...merged].map(([combo, ids]) => ({ combo, ids: [...ids].sort() }));
}

/**
 * The registry: one handler for the whole window.
 *
 * Returns the binding that handled the event, or `null`. The caller decides whether to
 * `preventDefault()` — some keys (Escape, Enter in a dialog) belong to whatever already has focus, and
 * Paseo gets that right: its interrupt binding deliberately neither prevents default nor stops
 * propagation.
 */
export function createShortcutRegistry(
  bindings: readonly KeyBinding[],
  context: { platform: ShortcutPlatform },
): {
  handle: (
    event: {
      key: string;
      metaKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
      isComposing?: boolean;
    },
    scope: FocusScope,
  ) => KeyBinding | null;
  conflicts: ShortcutConflict[];
  /** The combos to display for a binding, resolving `Mod` to what this platform does. */
  display: (id: string) => string | null;
} {
  const conflicts = findConflicts(bindings);

  return {
    conflicts,
    handle: (event, scope) => {
      // An IME composition owns every key it sees. Composing Chinese, Japanese or Korean text must not
      // trigger `Mod+K`, and Paseo learned this too (`overlay-root.ts:165-166`).
      if (event.isComposing === true || event.key === "Process") return null;
      for (const binding of bindings) {
        if (!bindingApplies(binding, { platform: context.platform, scope })) continue;
        if (binding.combos.some((combo) => comboMatches(combo, event, context.platform))) return binding;
      }
      return null;
    },
    display: (id) => {
      const binding = bindings.find((entry) => entry.id === id);
      const combo = binding?.combos[0];
      if (!combo) return null;
      return context.platform === "mac"
        ? combo.replace(/\bMod\b/g, "⌘").replace(/\bShift\b/g, "⇧").replace(/\+?(?=⌘|⇧)/g, "")
        : combo.replace(/\bMod\b/g, "Ctrl");
    },
  };
}

/** The bindings the sidebar and shell need, in one place so the help sheet can be generated from them. */
export const SHELL_BINDINGS: readonly KeyBinding[] = [
  { id: "commandCenter.open", combos: ["Mod+K"], label: "Open the command center", group: "General", when: { editable: true } },
  { id: "newTask", combos: ["Mod+N"], label: "New task", group: "Projects & tasks" },
  { id: "search.find", combos: ["Mod+P"], label: "Search files and tasks", group: "General" },
  { id: "window.new", combos: ["Mod+Shift+N"], label: "New window", group: "Layout" },
  { id: "sidebar.toggle", combos: ["Mod+B"], label: "Toggle the sidebar", group: "Layout", when: { editable: true } },
  { id: "settings.open", combos: ["Mod+,"], label: "Settings", group: "General", when: { editable: true } },
  { id: "help.shortcuts", combos: ["Shift+?"], label: "Keyboard shortcuts", group: "General" },
  { id: "run.interrupt", combos: ["Escape"], label: "Stop the agent", group: "Agent input", when: { editable: true, terminal: true } },
];
