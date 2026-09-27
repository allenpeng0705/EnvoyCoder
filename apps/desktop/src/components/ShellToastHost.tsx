/**
 * Renders the shell toast above the work area so it survives Settings / sheet unmount.
 */

import { useSyncExternalStore, type ReactElement } from "react";

import { useT } from "../i18n/context.js";
import {
  dismissShellToast,
  getShellToast,
  subscribeShellToast,
} from "../state/shell-toast.js";

export function ShellToastHost(): ReactElement | null {
  const t = useT();
  const toast = useSyncExternalStore(subscribeShellToast, getShellToast, getShellToast);
  if (!toast) return null;
  return (
    <div
      className={`shell-toast shell-toast--${toast.tone}`}
      role="status"
      data-testid="shell-toast"
    >
      <span className="shell-toast__message">{toast.message}</span>
      <button
        type="button"
        className="button button--ghost button--small"
        onClick={() => dismissShellToast(toast.id)}
      >
        {t("notice.dismiss")}
      </button>
    </div>
  );
}
