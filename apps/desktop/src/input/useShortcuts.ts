/**
 * Mount the shortcut layer, once, at the top of the window.
 *
 * `./shortcuts.ts` decides *whether* a keystroke is a binding; this decides *what it does*. The split is
 * the reason the layer is worth having: the table is data a help sheet can render, and the actions are
 * the shell's own state.
 *
 * **Why this file exists at all.** The layer shipped without a caller: the rail button displayed `⌘K`
 * and no `keydown` listener existed anywhere in the app, so pressing it did nothing and the palette —
 * and everything inside it, including "Add project…" — was unreachable by keyboard. A shortcut that is
 * only painted on a button is worse than none, because the user blames themselves.
 */

import { useEffect, useRef } from "react";

import { createShortcutRegistry, platformOf, SHELL_BINDINGS, type FocusScope } from "./shortcuts.js";

/** What each binding does. A binding with no action here simply does nothing — that is honest. */
export type ShortcutActions = Readonly<Record<string, (() => void) | undefined>>;

/** Where the keystroke is going, which decides whether a binding may fire. */
function scopeOf(target: EventTarget | null): FocusScope {
  const element = target as HTMLElement | null;
  if (!element) return "other";
  const tag = element.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return "editable";
  if (element.isContentEditable) return "editable";
  // A terminal pane will set this when it lands; until then nothing claims the scope.
  if (element.closest?.("[data-terminal]")) return "terminal";
  return "other";
}

/** The platform string a renderer reports, turned into the axis the bindings use. */
function currentPlatform(): string {
  const ua =
    typeof navigator === "undefined" ? "" : `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac|iphone|ipad/i.test(ua) ? "darwin" : "other";
}

export function useShortcuts(actions: ShortcutActions, platform: string = currentPlatform()): void {
  // The actions object is rebuilt on every render; a ref keeps the listener subscribed once instead of
  // re-attaching on every state change.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const registry = createShortcutRegistry(SHELL_BINDINGS, { platform: platformOf(platform) });

    const onKeyDown = (event: KeyboardEvent): void => {
      const binding = registry.handle(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          isComposing: event.isComposing,
        },
        scopeOf(event.target),
      );
      if (!binding) return;
      const action = actionsRef.current[binding.id];
      if (!action) return;
      // Only once something will actually happen: a binding that is displayed but unimplemented must not
      // swallow the keystroke from whatever else wanted it.
      event.preventDefault();
      action();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [platform]);
}
