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
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const app = readFileSync(join(root, "src/components/CoderApp.tsx"), "utf8");
const main = readFileSync(join(root, "src/main.tsx"), "utf8");

describe("the title bar", () => {
  it("is a drag region the way Tauri reads one", () => {
    expect(app).toMatch(/<header className="titlebar"[^>]*data-tauri-drag-region/);
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
