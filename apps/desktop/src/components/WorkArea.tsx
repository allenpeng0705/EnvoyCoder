/**
 * The content area's tabs: the chat, each file, and each change the explorer opened.
 *
 * One path is one file tab. A change is a different tab from the file itself, because it shows
 * the difference, not the text that is there now. Opening either again selects the tab that is
 * already there. Closing a tab returns to the chat when that tab was the one on screen.
 */

import type { JSX, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { useT } from "../i18n/context.js";
import { localNotice, type Notice, type Refusal } from "../i18n/notice.js";
import { DiffView } from "./DiffView.js";
import { FileView, formatBytes, type OpenedFile } from "./FileView.js";
import { BrowserView } from "./BrowserView.js";
import { NewTabMenu } from "./NewTabMenu.js";
import { TerminalView } from "./TerminalView.js";
import { closeBrowser, toolId } from "../client/work-tools.js";

export interface OpenedDiff {
  path: string;
  name: string;
  kind: "text" | "binary" | "tooLarge" | "empty";
  size: number;
  content?: string;
}

export interface FileOpenRequest {
  path: string;
  name: string;
  nonce: number;
  view?: "file" | "diff";
  from?: string;
}

interface FileTab {
  id: string;
  path: string;
  name: string;
}

interface Slot {
  file?: OpenedFile;
  diffText?: string;
  diffName?: string;
  notice?: Notice;
  loading: boolean;
}

interface ToolTab {
  id: string;
  kind: "terminal" | "browser";
  /** 1-based, so the first tab is just "Terminal" and the next is "Terminal 2". */
  n: number;
  cwd?: string;
}

function tabId(request: FileOpenRequest): string {
  return request.view === "diff" ? `diff:${request.path}` : request.path;
}

function noticeForDiff(diff: OpenedDiff): Notice | undefined {
  if (diff.kind === "text") return undefined;
  if (diff.kind === "binary") return localNotice("explorer.diff.binary");
  if (diff.kind === "empty") return localNotice("explorer.diff.empty");
  return localNotice("explorer.diff.tooLarge", { size: formatBytes(diff.size) });
}

export function WorkArea(props: {
  openRequest: FileOpenRequest | undefined;
  /** The project folder a new terminal starts in. */
  cwd?: string;
  /** Start another conversation in this project. Absent in a pane rendered on its own. */
  onNewTask?: () => void;
  onReadFile?: (path: string) => Promise<{ ok: true; file: OpenedFile } | Refusal>;
  onReadDiff?: (path: string, from?: string) => Promise<{ ok: true; diff: OpenedDiff } | Refusal>;
  onViewingFile: (viewing: boolean) => void;
  children: ReactNode;
}): JSX.Element {
  const t = useT();
  const [tabs, setTabs] = useState<readonly FileTab[]>([]);
  const [tools, setTools] = useState<readonly ToolTab[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<string>("chat");
  const [opened, setOpened] = useState<Record<string, Slot>>({});

  const readRef = useRef(props.onReadFile);
  const readDiffRef = useRef(props.onReadDiff);
  readRef.current = props.onReadFile;
  readDiffRef.current = props.onReadDiff;

  useEffect(() => {
    props.onViewingFile(active !== "chat");
  }, [active, props.onViewingFile]);

  useEffect(() => {
    const request = props.openRequest;
    if (!request) return;
    const id = tabId(request);
    const isDiff = request.view === "diff";
    setTabs((current) =>
      current.some((tab) => tab.id === id) ? current : [...current, { id, path: request.path, name: request.name }],
    );
    setActive(id);
    const read = isDiff ? readDiffRef.current : readRef.current;
    if (!read) {
      setOpened((current) => ({
        ...current,
        [id]: {
          loading: false,
          notice: localNotice(isDiff ? "explorer.diff.failed" : "explorer.file.failed"),
        },
      }));
      return;
    }
    setOpened((current) => ({ ...current, [id]: { loading: true } }));
    let cancelled = false;
    const pending = isDiff
      ? readDiffRef.current?.(request.path, request.from)
      : readRef.current?.(request.path);
    void pending?.then((result) => {
      if (cancelled || result === undefined) return;
      if (!result.ok) {
        setOpened((current) => ({ ...current, [id]: { loading: false, notice: result } }));
        return;
      }
      if ("diff" in result) {
        const notice = noticeForDiff(result.diff);
        setOpened((current) => ({
          ...current,
          [id]: notice
            ? { loading: false, notice }
            : { loading: false, diffText: result.diff.content ?? "", diffName: result.diff.name },
        }));
        return;
      }
      setOpened((current) => ({ ...current, [id]: { loading: false, file: result.file } }));
    });
    return () => {
      cancelled = true;
    };
  }, [props.openRequest]);

  function closeTab(id: string): void {
    if (tools.some((tab) => tab.id === id && tab.kind === "browser")) void closeBrowser(id);
    setTabs((current) => current.filter((tab) => tab.id !== id));
    setTools((current) => current.filter((tab) => tab.id !== id));
    if (active === id) setActive("chat");
  }

  function addTool(kind: ToolTab["kind"]): void {
    const id = toolId(kind === "terminal" ? "t" : "b");
    setTools((current) => {
      const n = current.filter((tab) => tab.kind === kind).length + 1;
      return [
        ...current,
        {
          id,
          kind,
          n,
          ...(kind === "terminal" && props.cwd ? { cwd: props.cwd } : {}),
        },
      ];
    });
    setActive(id);
  }

  const tool = tools.find((tab) => tab.id === active);
  const slot = opened[active];

  return (
    <div className="work">
      <div className="work__tabs">
        <div className="work__tabs-row" role="tablist" aria-label={t("explorer.aria")}>
        <button
          type="button"
          className="work__tab"
          role="tab"
          aria-selected={active === "chat"}
          onClick={() => setActive("chat")}
        >
          {t("explorer.tab.chat")}
        </button>
        {tabs.map((tab) => (
          <div key={tab.id} className="work__tab-wrap">
            <button
              type="button"
              className="work__tab"
              role="tab"
              aria-selected={active === tab.id}
              title={tab.path}
              onClick={() => setActive(tab.id)}
            >
              {tab.name}
            </button>
            <button
              type="button"
              className="work__tab-close has-hint"
              aria-label={t("explorer.file.close")}
              data-hint={t("explorer.file.close")}
              onClick={() => closeTab(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
        {tools.map((tab) => (
          <div key={tab.id} className="work__tab-wrap">
            <button
              type="button"
              className="work__tab"
              role="tab"
              aria-selected={active === tab.id}
              onClick={() => setActive(tab.id)}
            >
              {tab.n === 1
                ? t(tab.kind === "terminal" ? "work.new.terminal" : "work.new.browser")
                : `${t(tab.kind === "terminal" ? "work.new.terminal" : "work.new.browser")} ${tab.n}`}
            </button>
            <button
              type="button"
              className="work__tab-close has-hint"
              aria-label={t("explorer.file.close")}
              data-hint={t("explorer.file.close")}
              onClick={() => closeTab(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
        </div>
        <NewTabMenu
          taskEnabled={props.onNewTask !== undefined}
          onOpenChange={setMenuOpen}
          onTask={() => props.onNewTask?.()}
          onTerminal={() => addTool("terminal")}
          onBrowser={() => addTool("browser")}
        />
      </div>
      {active === "chat" ? props.children : tool ? null : (
        <div className="file-view">
          {slot?.diffText !== undefined ? (
            <DiffView name={slot.diffName ?? ""} text={slot.diffText} />
          ) : (
            <FileView file={slot?.file} loading={slot?.loading === true} notice={slot?.notice} />
          )}
        </div>
      )}
      {tools.map((tab) => (
        <div key={tab.id} className="work__tool" hidden={active !== tab.id}>
          {tab.kind === "terminal" ? (
            tab.cwd ? (
              <TerminalView id={tab.id} cwd={tab.cwd} />
            ) : (
              <p className="term__problem" role="status">
                {t("work.tool.needsApp")}
              </p>
            )
          ) : (
            <BrowserView id={tab.id} active={active === tab.id} suspended={menuOpen} />
          )}
        </div>
      ))}
    </div>
  );
}
