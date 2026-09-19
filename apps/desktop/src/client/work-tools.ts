/**
 * Terminal and Browser, as the window asks the shell for them.
 *
 * Both live in the shell, not the daemon. A terminal is a process the window's process can reap
 * when the app quits; a browser is a child webview, which only the shell can create. The Vite page
 * has no shell — callers show a sentence instead of a button that fails.
 *
 * Declared rather than pulled from `@tauri-apps/api`: the shell runs with `withGlobalTauri`, and a
 * second copy of that package is what the clipboard path already refused.
 */

interface TauriGlobal {
  core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
  event?: {
    listen?: (
      event: string,
      handler: (event: { payload: unknown }) => void,
    ) => Promise<() => void>;
  };
}

export type ToolFailure = { ok: false; detail: string };
export type ToolOk = { ok: true };

function bridge(): TauriGlobal | undefined {
  const candidate = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return candidate?.core?.invoke ? candidate : undefined;
}

/** True when this window can ask the shell for a terminal or a browser. */
export function hasWorkTools(): boolean {
  return bridge() !== undefined;
}

function detailOf(error: unknown): string {
  if (typeof error === "string" && error.trim() !== "") return error;
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return "Something went wrong.";
}

async function ask(command: string, args: Record<string, unknown>): Promise<ToolOk | ToolFailure> {
  const invoke = bridge()?.core?.invoke;
  if (!invoke) return { ok: false, detail: "" };
  try {
    await invoke(command, args);
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: detailOf(error) };
  }
}

/** A tab id the shell will accept: a letter, then hex. */
export function toolId(kind: "t" | "b"): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${kind}${hex}`;
}

export function openTerminal(id: string, cwd: string): Promise<ToolOk | ToolFailure> {
  return ask("terminal_open", { id, cwd });
}

export function writeTerminal(id: string, data: string): Promise<ToolOk | ToolFailure> {
  return ask("terminal_write", { id, data });
}

export function resizeTerminal(id: string, rows: number, cols: number): Promise<ToolOk | ToolFailure> {
  return ask("terminal_resize", { id, rows, cols });
}

export function closeTerminal(id: string): Promise<ToolOk | ToolFailure> {
  return ask("terminal_close", { id });
}

/**
 * Shell output for one terminal.
 *
 * Listen *before* `openTerminal`: the prompt is written as soon as the shell starts, and a
 * listener that arrives second misses it.
 */
export async function listenTerminal(id: string, onData: (data: string) => void): Promise<() => void> {
  const listen = bridge()?.event?.listen;
  if (!listen) return () => {};
  return listen("terminal-output", (event) => {
    const payload = event.payload as { id?: unknown; data?: unknown } | null;
    if (!payload || payload.id !== id || typeof payload.data !== "string") return;
    onData(payload.data);
  });
}

export function openBrowser(
  id: string,
  url: string,
  frame: { x: number; y: number; width: number; height: number },
): Promise<ToolOk | ToolFailure> {
  return ask("browser_open", { id, url, ...frame });
}

export function placeBrowser(
  id: string,
  frame: { x: number; y: number; width: number; height: number; visible: boolean },
): Promise<ToolOk | ToolFailure> {
  return ask("browser_frame", { id, ...frame });
}

export function navigateBrowser(id: string, url: string): Promise<ToolOk | ToolFailure> {
  return ask("browser_navigate", { id, url });
}

export function closeBrowser(id: string): Promise<ToolOk | ToolFailure> {
  return ask("browser_close", { id });
}

/** `https://` when the user left the scheme off. Anything else is not a page we will open. */
export function webAddress(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
