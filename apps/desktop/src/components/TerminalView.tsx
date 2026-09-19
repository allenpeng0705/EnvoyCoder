/**
 * One terminal tab: xterm in the window, the shell in the project folder.
 *
 * `data-terminal` is the shortcut layer's signal that this pane owns the keys — Escape is the
 * shell's, not "stop the agent". The listener is attached before the shell is started so the
 * first prompt is not missed.
 */

import type { JSX } from "react";

import { useEffect, useRef, useState } from "react";

import {
  closeTerminal,
  hasWorkTools,
  listenTerminal,
  openTerminal,
  resizeTerminal,
  writeTerminal,
} from "../client/work-tools.js";
import { useT } from "../i18n/context.js";

export function TerminalView(props: { id: string; cwd: string }): JSX.Element {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | undefined>(
    hasWorkTools() ? undefined : t("work.tool.needsApp"),
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hasWorkTools()) return;
    let dead = false;
    const pending: string[] = [];
    let term: { write(data: string): void; rows: number; cols: number; dispose(): void } | undefined;
    let stopListen: (() => void) | undefined;
    let fit: { fit(): void } | undefined;

    void (async () => {
      try {
        stopListen = await listenTerminal(props.id, (data) => {
          if (term) term.write(data);
          else pending.push(data);
        });
      } catch (error) {
        if (!dead) setProblem(error instanceof Error ? error.message : t("work.tool.needsApp"));
        return;
      }
      if (dead) {
        stopListen();
        return;
      }
      const opened = await openTerminal(props.id, props.cwd);
      if (dead) {
        void closeTerminal(props.id);
        return;
      }
      if (!opened.ok) {
        setProblem(opened.detail === "" ? t("work.tool.needsApp") : t("work.tool.failed", { detail: opened.detail }));
        return;
      }
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/xterm/css/xterm.css"),
      ]);
      if (dead) {
        void closeTerminal(props.id);
        return;
      }
      const next = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        theme: { background: "#181b1a", foreground: "#e7e5e4", cursor: "#e7e5e4" },
      });
      const nextFit = new FitAddon();
      next.loadAddon(nextFit);
      next.open(host);
      nextFit.fit();
      next.onData((data: string) => {
        void writeTerminal(props.id, data);
      });
      term = next;
      fit = nextFit;
      for (const chunk of pending.splice(0)) next.write(chunk);
      void resizeTerminal(props.id, next.rows, next.cols);
      next.focus();
    })();

    const observer = new ResizeObserver(() => {
      if (!term || !fit) return;
      fit.fit();
      void resizeTerminal(props.id, term.rows, term.cols);
    });
    observer.observe(host);

    return () => {
      dead = true;
      observer.disconnect();
      stopListen?.();
      term?.dispose();
      void closeTerminal(props.id);
    };
  }, [props.id, props.cwd, t]);

  return (
    <div className="term" data-terminal="">
      {problem ? (
        <p className="term__problem" role="status">
          {problem}
        </p>
      ) : null}
      <div className="term__host" ref={hostRef} />
    </div>
  );
}
