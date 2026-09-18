/**
 * Ask the shell for a folder, so adding a project is a pick rather than a paste.
 *
 * A control plane should not ask a user to type an absolute path when the operating system has a folder
 * chooser: it is slower, it is error-prone, and it is the first thing anyone notices. The webview cannot
 * open one itself, so this asks the shell (`pick_folder` in `src-tauri/src/main.rs`), which opens a
 * native folder dialog parented to this window on macOS, Windows, and Linux.
 *
 * Three outcomes, and the third is the one that matters:
 *
 *   * `picked` — a real path.
 *   * `cancelled` — the user closed the dialog. Not an error, and not something to report.
 *   * `unavailable` — there is no shell to ask (the browser dev server). The caller falls back to
 *     asking for a path by hand and says why, rather than presenting a dead button.
 */

/** The Tauri bridge, as this window uses it. Declared rather than pulled from a package. */
interface TauriGlobal {
  core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
}

function tauri(): TauriGlobal | undefined {
  const candidate = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return candidate?.core?.invoke ? candidate : undefined;
}

/**
 * Why a window cannot offer a folder chooser, in words a user can act on.
 *
 * The English text of the `no-shell` cause, kept here rather than in the catalogue because this
 * module is also called by code with no translator (the smoke script, a future CLI). A window
 * renders `palette.noPicker` instead — the same sentence, in the user's language — and picks it by
 * `cause`, not by string comparison.
 */
export const NO_FOLDER_PICKER_REASON =
  "This window has no shell to ask, so paste the folder path instead.";

/**
 * Is there a shell to ask — **decided synchronously**.
 *
 * This exists because the asynchronous version could look like a dead click: a command that awaited the
 * picker before deciding to show its prompt did nothing visible for a moment, and in a browser it did
 * nothing visible at all until the promise resolved. A caller can now branch on this and show the prompt
 * in the same tick as the click, which is the difference between "it worked" and "nothing happened".
 */
export function hasShellPicker(): boolean {
  return tauri() !== undefined;
}

export type FolderPickResult =
  | { kind: "picked"; path: string }
  | { kind: "cancelled" }
  /**
   * No chooser here, and **two different reasons a caller tells apart by `cause`** — not by reading
   * `reason`, which is English text for callers that have no translator (a script, a CLI):
   *
   *   * `no-shell` — this window is not inside the desktop shell at all (the browser dev server), so
   *     there is nothing to ask. `reason` is the whole sentence; a window renders `palette.noPicker`
   *     instead, in the user's language.
   *   * `failed` — the shell is there and the dialog would not open. `reason` is the underlying
   *     message only, because a window supplies its own sentence around it
   *     (`palette.pickerFailed`, "…could not open: {detail}") and a prefix baked in here would be
   *     printed twice.
   */
  | { kind: "unavailable"; cause: "no-shell" | "failed"; reason: string };

/**
 * @param prompt The dialog's own title, which the platform shows. Callers that have a translator
 *   pass a translated one; the default is English for programmatic callers.
 */
export async function pickFolder(prompt = "Choose a project folder"): Promise<FolderPickResult> {
  const bridge = tauri();
  if (!bridge?.core?.invoke) {
    return {
      kind: "unavailable",
      cause: "no-shell",
      reason: NO_FOLDER_PICKER_REASON,
    };
  }

  try {
    const answer = await bridge.core.invoke("pick_folder", { prompt });
    if (typeof answer === "string" && answer.trim().length > 0) {
      return { kind: "picked", path: answer.trim() };
    }
    // `null` is the shell saying the dialog was closed, or that no picker exists on this system. The
    // shell cannot tell those apart for us, so the caller keeps the manual path available either way.
    return { kind: "cancelled" };
  } catch (error) {
    return {
      kind: "unavailable",
      cause: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
