/**
 * One browser tab: an address bar in the page, the page itself a child webview.
 *
 * The webview is not in the DOM. It is positioned over `.browser__frame`, and hidden whenever
 * this tab is not the one on screen — a native view ignores z-index, so a menu opening over it
 * would be unreachable if we left it up. `suspended` is that case (the new-tab menu).
 *
 * Closing the tab must tell the shell immediately. The page is a native view: if it stays up it
 * covers the window and nothing underneath can be clicked. A resize that was already in flight
 * must not show it again after that.
 */

import type { JSX } from "react";

import { useEffect, useRef, useState } from "react";

import {
  closeBrowser,
  hasWorkTools,
  navigateBrowser,
  openBrowser,
  placeBrowser,
  webAddress,
} from "../client/work-tools.js";
import { useT } from "../i18n/context.js";

export function BrowserView(props: { id: string; active: boolean; suspended: boolean }): JSX.Element {
  const t = useT();
  const frameRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const opening = useRef(false);
  const alive = useRef(true);
  const [live, setLive] = useState(false);
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    alive.current = true;
    const id = props.id;
    return () => {
      alive.current = false;
      if (opened.current || opening.current) void closeBrowser(id);
    };
  }, [props.id]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !live || !alive.current) return;
    const id = props.id;
    const place = (): void => {
      if (!alive.current) return;
      const rect = frame.getBoundingClientRect();
      void placeBrowser(id, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        visible: props.active && !props.suspended && rect.width >= 1 && rect.height >= 1,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(frame);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [props.id, props.active, props.suspended, live]);

  async function go(): Promise<void> {
    const url = webAddress(address);
    if (!url) {
      setProblem(t("work.browser.badAddress"));
      return;
    }
    if (!hasWorkTools()) {
      setProblem(t("work.tool.needsApp"));
      return;
    }
    setProblem(undefined);
    setAddress(url);
    const frame = frameRef.current?.getBoundingClientRect();
    const box = {
      x: frame?.x ?? 0,
      y: frame?.y ?? 0,
      width: frame?.width ?? 1,
      height: frame?.height ?? 1,
    };
    opening.current = true;
    const result = opened.current
      ? await navigateBrowser(props.id, url)
      : await openBrowser(props.id, url, box);
    opening.current = false;
    if (!alive.current) {
      void closeBrowser(props.id);
      return;
    }
    if (!result.ok) {
      setProblem(result.detail === "" ? t("work.tool.needsApp") : t("work.tool.failed", { detail: result.detail }));
      return;
    }
    opened.current = true;
    setLive(true);
  }

  return (
    <div className="browser">
      <form
        className="browser__bar"
        onSubmit={(event) => {
          event.preventDefault();
          void go();
        }}
      >
        <input
          className="browser__address"
          type="text"
          value={address}
          placeholder={t("work.browser.placeholder")}
          aria-label={t("work.browser.address")}
          spellCheck={false}
          onChange={(event) => setAddress(event.target.value)}
        />
        <button type="submit" className="button button--secondary button--small">
          {t("work.browser.open")}
        </button>
      </form>
      {problem ? (
        <p className="browser__problem" role="status">
          {problem}
        </p>
      ) : null}
      <div className="browser__frame" ref={frameRef} />
    </div>
  );
}
