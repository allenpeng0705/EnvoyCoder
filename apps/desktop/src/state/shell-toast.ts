/**
 * Shell toast — ephemeral success/failure that outlives Settings / sheets.
 *
 * Lives outside any pane’s local state so closing a panel does not swallow “Invite copied”.
 * Refusals stay on the banner strip; form validation stays in-place (`docs/envoydev-ui-polish.md` §3).
 */

export type ShellToastTone = "ok" | "error";

export type ShellToast = {
  id: string;
  message: string;
  tone: ShellToastTone;
  /** Auto-dismiss after this many ms; 0 = stay until dismissed. */
  ttlMs: number;
};

type Listener = () => void;

let current: ShellToast | undefined;
let seq = 0;
const listeners = new Set<Listener>();
let dismissTimer: ReturnType<typeof setTimeout> | undefined;

function emit(): void {
  for (const listener of listeners) listener();
}

export function getShellToast(): ShellToast | undefined {
  return current;
}

export function subscribeShellToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissShellToast(id?: string): void {
  if (id !== undefined && current?.id !== id) return;
  if (dismissTimer !== undefined) {
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }
  current = undefined;
  emit();
}

/** Show a toast. Replaces any previous one. */
export function showShellToast(
  message: string,
  options?: { tone?: ShellToastTone; ttlMs?: number },
): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "";
  if (dismissTimer !== undefined) {
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }
  const id = `toast-${++seq}`;
  const ttlMs = options?.ttlMs ?? 4000;
  current = {
    id,
    message: trimmed,
    tone: options?.tone ?? "ok",
    ttlMs,
  };
  emit();
  if (ttlMs > 0) {
    dismissTimer = setTimeout(() => {
      dismissTimer = undefined;
      if (current?.id === id) {
        current = undefined;
        emit();
      }
    }, ttlMs);
  }
  return id;
}
