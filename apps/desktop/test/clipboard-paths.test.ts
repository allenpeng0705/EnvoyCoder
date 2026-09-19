/**
 * **The Copy control's three paths, and the wiring that has to exist for the third one to work.**
 *
 * ## What is actually under test
 *
 * `clipboard.ts` tries three ways to put a command on the clipboard, in an order that is a *decision* rather than
 * an accident (`docs/settings-parity.md` §7.29):
 *
 *   1. `navigator.clipboard.writeText` — first, and synchronously, because WebKit rejects the write with
 *      `NotAllowedError` unless the user's click is still the live gesture;
 *   2. the shell's own `copy_text` — second, because its `invoke` is **not** gated on transient activation, so it
 *      catches exactly the cases the first path drops (WebKitGTK with clipboard access off, a refused permission);
 *   3. `document.execCommand("copy")` — last, deprecated, and off by default under WebKitGTK.
 *
 * The instrument is jsdom, which has neither a real clipboard nor a Tauri bridge, so each leg stages the
 * environment it is about: a `globalThis.__TAURI__` with a recording `invoke`, a `navigator.clipboard` that
 * resolves or rejects, and a `document.execCommand`. What the legs assert is the **order** — which path was used,
 * and that a later one is not consulted after a success — because the order is the whole fix.
 *
 * ## The second half: the shell has to *expose* the command
 *
 * A Tauri v2 command is not callable until a capability grants it — `invoke_handler!` registration alone leaves the
 * window's promise rejected — so three files have to agree, and if one is missing the build succeeds, the app
 * starts, and the copy fails at runtime with a rejection the control renders as *Could not copy*, which is
 * indistinguishable from a machine with no clipboard. Rust is not reachable from vitest, so the three places are
 * pinned here: the command in `main.rs` (defined **and** registered), the permission file that names it, and the
 * capability that grants that permission. Same shape as `check-workspace-wiring.mjs`'s "adding a package means
 * declaring it in seven places", and for the same reason: the mistake is silent.
 *
 * What the command *does* is a Rust test's job, and it is a real one: `a_hostile_command_lands_on_the_clipboard_verbatim`
 * writes a command containing quotes, `&&`, `$HOME` and a newline, reads it back with the platform's own reader, and
 * puts the developer's clipboard back afterwards.
 */

/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canCopyText, copyText } from "../src/components/settings/clipboard.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const COMMAND = "npm install -g @github/copilot";

/** What the shell's `invoke` was called with, if it was called at all. */
interface Shell {
  calls: { command: string; args: Record<string, unknown> }[];
  invoke: ReturnType<typeof vi.fn>;
}

/** Stage a Tauri window. `refuse` makes the plugin reject, which is what a missing capability looks like. */
function withShell(refuse = false): Shell {
  const calls: Shell["calls"] = [];
  const invoke = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (refuse) throw new Error("clipboard-manager.write_text not allowed");
    return null;
  });
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
  return { calls, invoke };
}

/** Stage the webview's own API. `undefined` is WebKitGTK before 2.40, where it does not exist at all. */
function withModernClipboard(outcome: "resolve" | "reject" | "absent"): ReturnType<typeof vi.fn> | undefined {
  if (outcome === "absent") return undefined;
  const writeText =
    outcome === "resolve" ? vi.fn(async () => undefined) : vi.fn(async () => Promise.reject(new Error("NotAllowedError")));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

/** Stage the deprecated path, whose return value is the answer. */
function withExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const exec = vi.fn(() => result);
  Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
  return exec;
}

afterEach(() => {
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  Object.defineProperty(document, "execCommand", { value: undefined, configurable: true });
});

describe("the three ways to reach the clipboard, in the order that matters", () => {
  it("writes through the webview first, and does not touch the shell when that lands", async () => {
    // The gesture rule: this path is only reliable **before** anything is awaited, so it is tried first and a
    // success ends the attempt. A mutation that moves the shell first would still pass a "did it copy" leg — which
    // is why this one asserts the *shell was never called*, not merely that the copy worked.
    const shell = withShell();
    const modern = withModernClipboard("resolve");

    await expect(copyText(COMMAND)).resolves.toBe(true);
    expect(modern).toHaveBeenCalledWith(COMMAND);
    expect(shell.invoke).not.toHaveBeenCalled();
  });

  it("falls to the shell when the webview refuses — the case WebKitGTK and a denied permission both produce", async () => {
    // `navigator.clipboard` exists but rejects: WebKitGTK with `javascript-can-access-clipboard` off, or a user
    // who denied the permission. The shell needs no gesture, so the write still lands.
    const shell = withShell();
    withModernClipboard("reject");

    await expect(copyText(COMMAND)).resolves.toBe(true);
    expect(shell.calls).toEqual([{ command: "copy_text", args: { text: COMMAND } }]);
  });

  it("uses the shell when the webview has no clipboard API at all", async () => {
    // WebKitGTK before 2.40: `navigator.clipboard` is `undefined`, which is why `canCopyText()` must be true for a
    // window whose only path is the shell — otherwise the Copy control is not rendered at all, and a Linux user
    // reads an install command they have to retype.
    const shell = withShell();
    withModernClipboard("absent");

    expect(canCopyText()).toBe(true);
    await expect(copyText(COMMAND)).resolves.toBe(true);
    expect(shell.calls).toHaveLength(1);
  });

  it("tries the legacy path when both modern paths fail, and reports what it says", async () => {
    withShell(true);
    withModernClipboard("reject");
    const exec = withExecCommand(true);

    await expect(copyText(COMMAND)).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");

    // …and the same path's `false` is the function's answer: a legacy runtime that refuses must not be reported as
    // a copy that happened.
    withExecCommand(false);
    await expect(copyText(COMMAND)).resolves.toBe(false);
  });

  it("answers false when there is no clipboard path at all, rather than throwing", async () => {
    // A window with no shell, no `navigator.clipboard` and no `execCommand`. `false` is what the Copy control
    // renders as *Could not copy*, which is the honest outcome — and `canCopyText()` is false, so the control is
    // not drawn in the first place.
    withModernClipboard("absent");

    expect(canCopyText()).toBe(false);
    await expect(copyText(COMMAND)).resolves.toBe(false);
  });
});

describe("the three files that have to agree for the shell's clipboard to exist", () => {
  // **Why these are assertions and not a comment.** A build that forgets any of the three compiles, starts, and
  // refuses the write at runtime — with a rejection the Copy control renders as *Could not copy*.
  const main = readFileSync(join(root, "apps/desktop/src-tauri/src/main.rs"), "utf8");
  const permission = readFileSync(join(root, "apps/desktop/src-tauri/permissions/copy-text.toml"), "utf8");
  const capability = readFileSync(join(root, "apps/desktop/src-tauri/capabilities/default.json"), "utf8");

  it("defines the command, registers it, names it in a permission, and grants that permission", () => {
    // **Anchored to the start of a line**, not `toContain`: commenting a definition out is the quietest way to
    // remove it (the string is still in the file) and a substring check passes on it happily.
    expect(main, "the command is not defined").toMatch(/^fn copy_text\(/m);
    // The optional comma is the handler list's separator, not part of the name: `copy_text` was registered
    // without one until `new_window` was added after it (`424ed71`), and the anchored match must survive the
    // punctuation a list grows without losing the "a commented-out line does not count" property.
    expect(main, "the command is not registered").toMatch(/^\s*copy_text,?$/m);
    expect(permission, "the permission does not name the command").toMatch(/commands\.allow = \["copy_text"\]/);
    const granted = JSON.parse(capability) as { permissions: string[] };
    expect(granted.permissions).toContain("allow-copy-text");
    // **No reading, anywhere.** The only clipboard command is the writer — a `read_text` beside it would be a
    // capability nobody asked for, and this product never looks at what is already on the clipboard. (`pbpaste`
    // does appear in `main.rs`: in the Rust *test*, as the instrument that reads back what the command wrote.)
    expect(main).not.toMatch(/fn (read|paste)_(text|clipboard)/);
  });
});
