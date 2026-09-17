/**
 * Open another EnvoyDev window on the same daemon — Paseo's "Open in new window".
 *
 * ## Why this lives in the shell
 *
 * One daemon already serves every window (and the phone). Creating a *second* window is a
 * shell job: Tauri owns window labels and capabilities, and the window asks `new_window`
 * rather than inventing a BrowserWindow of its own. The optional `projectId` is recorded
 * against the new window's label; that window pulls it once via `take_pending_project`.
 *
 * ## Browser / no shell
 *
 * The Vite dev server has no Tauri bridge. Callers hide the menu item when
 * `canOpenProjectInNewWindow()` is false — the same branch Paseo uses for `getIsElectron()`.
 */

/** The Tauri bridge, as this window uses it. Declared rather than pulled from a package. */
interface TauriGlobal {
  core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
}

function tauri(): TauriGlobal | undefined {
  const candidate = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return candidate?.core?.invoke ? candidate : undefined;
}

/** True when this window can ask the shell to open another. */
export function canOpenProjectInNewWindow(): boolean {
  return tauri() !== undefined;
}

export type OpenNewWindowResult = { ok: true } | { ok: false; reason: string };

/**
 * Open a new window that lands on `projectId` (the project's own tasks, not a blank shell).
 */
export async function openProjectInNewWindow(projectId: string): Promise<OpenNewWindowResult> {
  const bridge = tauri();
  if (!bridge?.core?.invoke) {
    return { ok: false, reason: "This window has no shell to ask for another window." };
  }
  const trimmed = projectId.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "No project to open." };
  }
  try {
    await bridge.core.invoke("new_window", { projectId: trimmed });
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

/**
 * The project this window was opened for, if any — taken once.
 *
 * Outside the shell there is never a pending project; that is not an error.
 */
export async function takePendingProject(): Promise<string | undefined> {
  const bridge = tauri();
  if (!bridge?.core?.invoke) return undefined;
  try {
    const answer = await bridge.core.invoke("take_pending_project");
    if (typeof answer === "string" && answer.trim().length > 0) return answer.trim();
    return undefined;
  } catch {
    return undefined;
  }
}
