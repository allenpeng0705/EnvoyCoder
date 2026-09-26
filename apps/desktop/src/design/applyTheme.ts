/**
 * Apply the Appearance theme preference to the document root.
 *
 * ## Why three values, and why `system` clears the attribute
 *
 * `tokens.css` and `styles.css` both define light and dark palettes under
 * `:root[data-theme="…"]`, and both also follow the OS via
 * `@media (prefers-color-scheme: …)` when **no** explicit `data-theme` is set (or when the
 * attribute is the opposite of the media query's carve-out). So:
 *
 *   * `"light"` / `"dark"` — write the attribute; the media queries must not win.
 *   * `"system"` — **remove** the attribute so the OS preference paints the window.
 *
 * The product default is `"dark"` (`docs/design-tokens.md`): a light desktop must not change what
 * the app looks like until the user asks for System or Light.
 */

export type ThemePreference = "light" | "dark" | "system";

export function applyTheme(preference: ThemePreference, root: HTMLElement = document.documentElement): void {
  if (preference === "system") {
    delete root.dataset.theme;
    return;
  }
  root.dataset.theme = preference;
}

/**
 * Whether the window is currently painted dark — for surfaces that cannot read CSS variables
 * (Mermaid's own theme enum).
 *
 * When the preference is `"system"`, `data-theme` is absent; fall through to the OS media query
 * rather than assuming light (the old Mermaid path treated missing as light and got it wrong on a
 * dark desktop).
 */
export function isDarkTheme(root: HTMLElement = document.documentElement): boolean {
  const attr = root.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return true;
}
