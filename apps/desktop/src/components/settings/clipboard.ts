/**
 * **Putting a command on the clipboard, on all three webviews — and saying so honestly when it fails.**
 *
 * ## Why this is not one line of `navigator.clipboard.writeText`
 *
 * Three runtimes, three different answers, and the research behind this file is `docs/settings-parity.md` §7.29:
 *
 *   * **The webview's own API needs a *live gesture*, not merely a secure context.** The packaged origins are all
 *     secure (`tauri://localhost` on macOS and Linux, `http://tauri.localhost` on Windows), so `navigator.clipboard`
 *     is defined — but WebKit's `Clipboard::writeText` **rejects with `NotAllowedError`** unless the write is
 *     reachable from transient user activation. A synchronous call inside the click handler resolves; anything
 *     after an `await` does not. That is why the modern path is tried **first and synchronously**, and why a
 *     fallback after it cannot be assumed to work.
 *   * **On Linux the legacy path is off by default.** WebKitGTK disables `document.execCommand("copy")` unless the
 *     webview is built with `enable_clipboard_access()`, which this shell does not do (it would also grant JS
 *     *paste* access, which this product never uses). So the pre-`navigator.clipboard` fallback is a last resort
 *     that may fail on Linux — and it is attempted anyway, because on an older WebKitGTK it is the only thing
 *     left.
 *   * **The shell can always do it, and needs no gesture.** `copy_text` (`src-tauri/src/main.rs`) is an `invoke`:
 *     a message to the Rust half, which writes the text through the platform's own clipboard tool. It is not gated
 *     on transient activation, so it works even though the user's click is long over by the time we get here. That
 *     is why it sits *between* the two webview paths: the fast path keeps the gesture, and the one that cannot lose
 *     it catches whatever the fast path drops.
 *
 * ## Why a command and not `tauri-plugin-clipboard-manager`
 *
 * The plugin is the supported route and was written first; it could not be built on the machine this was developed
 * on, because `cargo` cannot reach the registry through this environment's network — so the new dependency made the
 * whole shell unbuildable, including the running `tauri dev`, which then sat on the package-cache lock. A
 * dependency that cannot be fetched is worse than the tool already in the box, and `src-tauri` already shells out
 * for its folder dialogs for the same reason. Swapping back to the plugin is a `Cargo.toml` line, a capability, and
 * this constant — recorded in §7.29 rather than left as a surprise for whoever reads the Rust side first.
 *
 * ## What it returns, and why a boolean rather than a throw
 *
 * `false` is a real answer here: a user pressing Copy on a machine with no working clipboard should be told
 * it did not work rather than shown a tick. A thrown error would make every caller write the same `catch`,
 * and a caller that forgot would render a *Copied* label over a command that is not on the clipboard —
 * which is the one outcome this product has a rule against (a control that lies about what it did).
 *
 * The same honesty governs whether the control exists at all: `canCopyText()` is asked **before** the button
 * is rendered, so a machine with no clipboard path shows the command and no button, rather than a button
 * that cannot work. EnvoyMesh's Social app copies pairing codes and device ids the same way (its own
 * `navigator.clipboard` calls, with a transient confirmation), so a user meets one behaviour in both apps.
 */

/**
 * The Tauri bridge, as this module uses it.
 *
 * Declared rather than pulled from a package, exactly as `client/folder-picker.ts` does: the shell runs with
 * `withGlobalTauri`, so `invoke` is on `globalThis.__TAURI__.core`, and a dependency on `@tauri-apps/api` would
 * be a second version of a channel the shell already provides.
 */
interface TauriGlobal {
  core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
}

/**
 * The shell's clipboard command, by the name `invoke_handler!` registers it under.
 *
 * A plain command rather than a plugin's `plugin:…|write_text`: the plugin's JS wrapper adds nothing but a string
 * and a `label` argument this app does not use, and its `.d.ts` would have to be kept aligned with
 * `@tauri-apps/api` — a second version of that package is exactly what `withGlobalTauri` exists to avoid.
 */
const SHELL_WRITE_TEXT = "copy_text";

function shellInvoke(): ((command: string, args?: Record<string, unknown>) => Promise<unknown>) | undefined {
  const candidate = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return candidate?.core?.invoke;
}

function modernClipboard(): { writeText(text: string): Promise<void> } | undefined {
  const modern = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  return modern !== undefined && typeof modern.writeText === "function" ? modern : undefined;
}

function hasExecCommand(): boolean {
  return (
    typeof document !== "undefined" && typeof (document as { execCommand?: unknown }).execCommand === "function"
  );
}

/** Is there any way to put text on the clipboard here — the shell's, the webview's, or the legacy path? */
export function canCopyText(): boolean {
  return shellInvoke() !== undefined || modernClipboard() !== undefined || hasExecCommand();
}

/**
 * Copy `text`, and report whether it landed.
 *
 * Never rejects: see the module doc. A caller renders the result; nothing here decides what a failure looks
 * like. The three attempts are tried in the order the module doc argues for, and the **first that lands wins** —
 * a later path is never consulted after a success, so a machine with two working paths makes one write.
 */
export async function copyText(text: string): Promise<boolean> {
  // **1. The webview's own API, called in the same tick as the click.** WebKit wants a live gesture, so this has
  // to happen before any `await` — which is why it is first, and why the two slower paths follow rather than
  // precede it.
  const modern = modernClipboard();
  if (modern !== undefined) {
    try {
      await modern.writeText(text);
      return true;
    } catch {
      // A denied permission, or WebKitGTK with clipboard access off. The shell below answers both.
    }
  }

  // **2. The shell, which needs no gesture at all.** A refusal here is a real answer — an older shell without the
  // command, or one whose capability does not grant it — and it falls through rather than throwing.
  const invoke = shellInvoke();
  if (invoke !== undefined) {
    try {
      await invoke(SHELL_WRITE_TEXT, { text });
      return true;
    } catch {
      // Same rule: try what is left, and let the caller report the truth if everything failed.
    }
  }

  // **3. The pre-`navigator.clipboard` path.** Deprecated, still implemented, and off by default under WebKitGTK —
  // so it is attempted rather than trusted, and its answer is the function's answer.
  return legacyCopy(text);
}

/**
 * The legacy path: select a throwaway textarea and ask the document to copy it.
 *
 * `execCommand` is deprecated and is still the only thing that works in every webview this product ships in.
 * The textarea is placed off-screen rather than `display: none` — an element that is not rendered cannot be
 * selected, and one that is rendered in place would flash a box inside the row the user is reading.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const exec = (document as { execCommand?: unknown }).execCommand;
  if (typeof exec !== "function") return false;

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.left = "-1000px";
  document.body.appendChild(area);
  try {
    area.select();
    return (exec as (command: string) => boolean).call(document, "copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
