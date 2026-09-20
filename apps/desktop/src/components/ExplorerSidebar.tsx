/**
 * Folders, files, and git changes for the task that is open.
 *
 * Two tabs. Files are a tree of the task's folder. A file opens as a tab in the content area —
 * text, a picture, a PDF, or a sentence when the file cannot be shown. `node_modules` and `.git`
 * stay hidden. Other names that start with a dot follow the hide-hidden control. Changes are
 * `git status` in this folder. Not a repository is a sentence, not an error.
 *
 * A failed listing stays in this sidebar. The window's banner is for what the window could not
 * do, and a folder that would not open is not that.
 */

import type { JSX } from "react";

import { useEffect, useRef, useState } from "react";

import { useT } from "../i18n/context.js";
import { localize, type Notice, type Refusal } from "../i18n/notice.js";
import {
  FileIcon,
  FolderIcon,
  FilePlusIcon,
  FolderPlusIcon,
  EyeIcon,
  EyeOffIcon,
  IndexAddIcon,
  IndexRemoveIcon,
  RefreshIcon,
} from "./icons.js";

export interface ExplorerEntry {
  name: string;
  kind: "dir" | "file";
  path: string;
  size?: number;
  modifiedAt?: string;
}

export type ExplorerChangeKind = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflict";

export interface ExplorerChange {
  path: string;
  kind: ExplorerChangeKind;
  from?: string;
  /** The index holds something for this path — what a commit would record. */
  staged: boolean;
  /** The working tree differs from the index — what staging again would pick up. */
  unstaged: boolean;
}

export type DirectoryListing = { ok: true; entries: readonly ExplorerEntry[] } | Refusal;
export type ChangeListing =
  | { ok: true; repo: boolean; changes: readonly ExplorerChange[] }
  | Refusal;

const HIDDEN = new Set(["node_modules", ".git"]);

export type ExplorerSort = "name" | "modified" | "size";

const SORT_KEY = {
  name: "explorer.sort.name",
  modified: "explorer.sort.modified",
  size: "explorer.sort.size",
} as const;

function present(
  entries: readonly ExplorerEntry[],
  showHidden: boolean,
  sort: ExplorerSort,
): ExplorerEntry[] {
  const visible = entries.filter((entry) => {
    if (HIDDEN.has(entry.name)) return false;
    if (!showHidden && entry.name.startsWith(".")) return false;
    return true;
  });
  const dirs = visible.filter((entry) => entry.kind === "dir");
  const files = visible.filter((entry) => entry.kind === "file");
  const by = (left: ExplorerEntry, right: ExplorerEntry): number => {
    if (sort === "size") return (right.size ?? 0) - (left.size ?? 0);
    if (sort === "modified") return (right.modifiedAt ?? "").localeCompare(left.modifiedAt ?? "");
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  };
  return [...dirs.sort(by), ...files.sort(by)];
}

const KIND_KEY = {
  added: "explorer.kind.added",
  modified: "explorer.kind.modified",
  deleted: "explorer.kind.deleted",
  renamed: "explorer.kind.renamed",
  untracked: "explorer.kind.untracked",
  conflict: "explorer.kind.conflict",
} as const;

export function ExplorerSidebar(props: {
  cwd: string;
  onListDirectory: (path: string) => Promise<DirectoryListing>;
  onListChanges: (path: string) => Promise<ChangeListing>;
  onOpenFile?: (entry: ExplorerEntry) => void;
  /** A file in Changes. The window opens the difference, not the file. */
  onOpenChange?: (change: ExplorerChange) => void;
  onCreateEntry?: (
    directory: string,
    name: string,
    kind: "file" | "dir",
  ) => Promise<{ ok: true; path: string } | Refusal>;
  /**
   * The three git writes, and every one of them answers with the refreshed list.
   *
   * Present only when the window can reach them: a sidebar without them (a test, an older daemon) shows the
   * changes and offers no controls, rather than buttons whose press comes back "method not found".
   */
  onStage?: (paths: readonly string[]) => Promise<{ ok: true; changes: readonly ExplorerChange[] } | Refusal>;
  onUnstage?: (paths: readonly string[]) => Promise<{ ok: true; changes: readonly ExplorerChange[] } | Refusal>;
  onCommit?: (message: string) => Promise<{ ok: true; sha: string; changes: readonly ExplorerChange[] } | Refusal>;
}): JSX.Element {
  const t = useT();
  const listDir = useRef(props.onListDirectory);
  const listChanges = useRef(props.onListChanges);
  listDir.current = props.onListDirectory;
  listChanges.current = props.onListChanges;

  const [tab, setTab] = useState<"files" | "changes">("files");
  /** The commit message being typed, and what the last write said. */
  const [commitMessage, setCommitMessage] = useState("");
  const [writeNotice, setWriteNotice] = useState<string | undefined>(undefined);
  const [writeFailure, setWriteFailure] = useState<string | undefined>(undefined);
  const [writing, setWriting] = useState(false);
  const [rootEntries, setRootEntries] = useState<readonly ExplorerEntry[] | undefined>(undefined);
  const [children, setChildren] = useState<Record<string, readonly ExplorerEntry[]>>({});
  const [openDirs, setOpenDirs] = useState<ReadonlySet<string>>(new Set());
  const [fileNotice, setFileNotice] = useState<Notice | undefined>(undefined);
  const [filesLoading, setFilesLoading] = useState(true);
  const [changeState, setChangeState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; notice: Notice }
    | { status: "ready"; repo: boolean; changes: readonly ExplorerChange[] }
  >({ status: "idle" });
  const generation = useRef(0);
  const cwdSeen = useRef<string | undefined>(undefined);
  const openDirsRef = useRef<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<ExplorerSort>("name");
  const [showHidden, setShowHidden] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [draft, setDraft] = useState<"file" | "dir" | undefined>(undefined);
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    const gen = ++generation.current;
    const cwdChanged = cwdSeen.current !== props.cwd;
    cwdSeen.current = props.cwd;
    if (cwdChanged) {
      const closed = new Set<string>();
      openDirsRef.current = closed;
      setRootEntries(undefined);
      setChildren({});
      setOpenDirs(closed);
      setDraft(undefined);
      setFileNotice(undefined);
      setFilesLoading(true);
    } else {
      setRefreshing(true);
    }
    const dirs = cwdChanged ? [] : [...openDirsRef.current];
    void listDir.current(props.cwd).then((result) => {
      if (generation.current !== gen) return;
      setFilesLoading(false);
      setRefreshing(false);
      if (!result.ok) {
        setFileNotice(result);
        setRootEntries([]);
        return;
      }
      setRootEntries(result.entries);
    });
    for (const path of dirs) {
      void listDir.current(path).then((result) => {
        if (generation.current !== gen || !result.ok) return;
        setChildren((current) => ({ ...current, [path]: result.entries }));
      });
    }
  }, [props.cwd, refreshTick]);

  useEffect(() => {
    if (tab !== "changes") return;
    let cancelled = false;

    setChangeState({ status: "loading" });
    void listChanges.current(props.cwd).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setChangeState({ status: "error", notice: result });
        return;
      }
      setChangeState({ status: "ready", repo: result.repo, changes: result.changes });
    });
    return () => {
      cancelled = true;
    };
  }, [tab, props.cwd]);

  /**
   * Run one of the three writes, then trust its answer.
   *
   * **The daemon's answer is the list**, measured after the write, so the tab and the branch chip agree with
   * the repository without a second round trip — and a failure lands here, next to the control that caused it,
   * rather than in the window's banner.
   */
  const write = async (
    run: () => Promise<{ ok: true; changes: readonly ExplorerChange[] } | Refusal>,
  ): Promise<void> => {
    setWriting(true);
    setWriteFailure(undefined);
    const result = await run();
    setWriting(false);
    if (result.ok === false) {
      setWriteFailure(localize(t, result) ?? t("explorer.changes.failed"));
      return;
    }
    setChangeState({ status: "ready", repo: true, changes: result.changes });
  };

  const stage = (paths: readonly string[]): void => {
    if (props.onStage === undefined) return;
    setWriteNotice(undefined);
    void write(() => props.onStage!(paths));
  };

  const unstage = (paths: readonly string[]): void => {
    if (props.onUnstage === undefined) return;
    setWriteNotice(undefined);
    void write(() => props.onUnstage!(paths));
  };

  const commit = (): void => {
    if (props.onCommit === undefined) return;
    const message = commitMessage.trim();
    if (message === "") return;
    setWriting(true);
    setWriteFailure(undefined);
    void props.onCommit(message).then((result) => {
      setWriting(false);
      if (result.ok === false) {
        setWriteFailure(localize(t, result) ?? t("explorer.changes.failed"));
        return;
      }
      setCommitMessage("");
      setChangeState({ status: "ready", repo: true, changes: result.changes });
      setWriteNotice(t("explorer.commit.done", { sha: result.sha.slice(0, 7) }));
    });
  };

  function toggleDir(path: string): void {
    const willOpen = !openDirs.has(path);
    const gen = generation.current;
    setOpenDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      openDirsRef.current = next;
      return next;
    });
    if (!willOpen || children[path] !== undefined) return;
    void listDir.current(path).then((result) => {
      if (generation.current !== gen) return;
      if (!result.ok) {
        setFileNotice(result);
        return;
      }
      setChildren((current) => ({ ...current, [path]: result.entries }));
    });
  }

  const shown = rootEntries === undefined ? [] : present(rootEntries, showHidden, sort);

  function beginDraft(kind: "file" | "dir"): void {
    setTab("files");
    setDraft(kind);
    setDraftName("");
  }

  function submitDraft(): void {
    const name = draftName.trim();
    const kind = draft === "dir" ? "dir" : "file";
    if (!draft || name === "" || !props.onCreateEntry) {
      setDraft(undefined);
      return;
    }
    void props.onCreateEntry(props.cwd, name, kind).then((result) => {
      if (!result.ok) {
        setFileNotice(result);
        return;
      }
      setDraft(undefined);
      setDraftName("");
      setRefreshTick((tick) => tick + 1);
      if (kind === "file") props.onOpenFile?.({ name, kind: "file", path: result.path });
    });
  }

  return (
    <aside className="explorer" aria-label={t("explorer.aria")} data-testid="explorer-sidebar">
      <div className="explorer__tabs" role="tablist" aria-label={t("explorer.aria")}>
        <button
          type="button"
          className="explorer__tab"
          role="tab"
          aria-selected={tab === "files"}
          onClick={() => setTab("files")}
        >
          {t("explorer.tab.files")}
        </button>
        <button
          type="button"
          className="explorer__tab"
          role="tab"
          aria-selected={tab === "changes"}
          onClick={() => setTab("changes")}
        >
          {t("explorer.tab.changes")}
        </button>
      </div>
      <div className="explorer__body" role="tabpanel">
        {tab === "files" ? (
          <>
            <div className="explorer__tools">
              <button
                type="button"
                className="explorer__sort"
                aria-label={t(SORT_KEY[sort])}
                onClick={() => {
                  const order: ExplorerSort[] = ["name", "modified", "size"];
                  const index = order.indexOf(sort);
                  const next = order[(index + 1) % order.length] ?? "name";
                  setSort(next);
                }}
              >
                {t(SORT_KEY[sort])}
              </button>
              <button type="button" className="button button--ghost button--icon has-hint" aria-label={t("explorer.newFile")} data-hint={t("explorer.newFile")} onClick={() => beginDraft("file")}>
                <FilePlusIcon />
              </button>
              <button type="button" className="button button--ghost button--icon has-hint" aria-label={t("explorer.newFolder")} data-hint={t("explorer.newFolder")} onClick={() => beginDraft("dir")}>
                <FolderPlusIcon />
              </button>
              <button
                type="button"
                className="button button--ghost button--icon has-hint"
                aria-label={showHidden ? t("explorer.hideHidden") : t("explorer.showHidden")}
                data-hint={showHidden ? t("explorer.hideHidden") : t("explorer.showHidden")}
                aria-pressed={!showHidden}
                onClick={() => setShowHidden((shownNow) => !shownNow)}
              >
                {showHidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              <button
                type="button"
                className="button button--ghost button--icon has-hint"
                aria-label={refreshing ? t("explorer.loading") : t("explorer.refresh")}
                data-hint={t("explorer.refresh")}
                disabled={refreshing}
                onClick={() => setRefreshTick((tick) => tick + 1)}
              >
                <RefreshIcon />
              </button>
            </div>
            {draft ? (
              <form
                className="explorer__draft"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitDraft();
                }}
              >
                <input
                  className="explorer__draft-input"
                  autoFocus
                  aria-label={draft === "dir" ? t("explorer.draft.folder") : t("explorer.draft.file")}
                  placeholder={draft === "dir" ? t("explorer.draft.folder") : t("explorer.draft.file")}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setDraft(undefined);
                  }}
                />
              </form>
            ) : null}
            {filesLoading ? (
              <p className="explorer__status">{t("explorer.loading")}</p>
            ) : fileNotice !== undefined && shown.length === 0 ? (
              <p className="explorer__status" role="status">
                {localize(t, fileNotice) ?? t("explorer.files.failed")}
              </p>
            ) : shown.length === 0 ? (
              <p className="explorer__status">{t("explorer.files.empty")}</p>
            ) : (
              <>
                {fileNotice === undefined ? null : (
                  <p className="explorer__status" role="status">
                    {localize(t, fileNotice) ?? t("explorer.files.failed")}
                  </p>
                )}
                <FileTree
                  entries={shown}
                  depth={0}
                  showHidden={showHidden}
                  sort={sort}
                  openDirs={openDirs}
                  childrenByPath={children}
                  onToggle={toggleDir}
                  onOpenFile={props.onOpenFile}
                />
              </>
            )}
          </>
        ) : changeState.status === "loading" || changeState.status === "idle" ? (
          <p className="explorer__status">{t("explorer.loading")}</p>
        ) : changeState.status === "error" ? (
          <p className="explorer__status" role="status">
            {localize(t, changeState.notice) ?? t("explorer.changes.failed")}
          </p>
        ) : !changeState.repo ? (
          <p className="explorer__status">{t("explorer.changes.notRepo")}</p>
        ) : (
          <>
            {/* **The commit box belongs to the repository, not to the list.** It was inside the "there are
                changes" branch, so committing everything made the box — and the sentence saying the commit
                landed — disappear at exactly the moment a user looks for it. */}
            {props.onStage !== undefined && props.onCommit !== undefined ? (
              <div className="explorer__commit">
                <input
                  className="explorer__commit-message"
                  type="text"
                  value={commitMessage}
                  placeholder={t("explorer.commit.message")}
                  aria-label={t("explorer.commit.message")}
                  disabled={writing}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                  }}
                />
                <div className="explorer__commit-actions">
                  {/* **Stage all is a press, not a default.** A commit takes the index, and filling the index
                      for a user who wanted one file would be us deciding what their commit contains. */}
                  {props.onStage !== undefined && changeState.changes.some((change) => change.unstaged) ? (
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={writing}
                      onClick={() => stage(changeState.changes.filter((c) => c.unstaged).map((c) => c.path))}
                    >
                      {t("explorer.commit.stageAll")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button"
                    // Enabled by the two facts the daemon checks anyway, so a press that cannot work is not
                    // offered: a message, and something in the index.
                    disabled={writing || commitMessage.trim() === "" || !changeState.changes.some((c) => c.staged)}
                    onClick={commit}
                  >
                    {t("explorer.commit.cta")}
                  </button>
                </div>
                {writeNotice !== undefined ? (
                  <p className="explorer__status">{writeNotice}</p>
                ) : null}
                {writeFailure !== undefined ? (
                  <p className="explorer__status explorer__change-write-error" role="alert">
                    {writeFailure}
                  </p>
                ) : null}
              </div>
            ) : null}
            {changeState.changes.length === 0 ? (
              <p className="explorer__status">{t("explorer.changes.empty")}</p>
            ) : null}
            <ul className="explorer__list">
              {changeState.changes.map((change) => (
                <li key={`${change.kind}:${change.from ?? ""}:${change.path}`} className="explorer__change-row">
                  <button
                    type="button"
                    className="explorer__change"
                    title={change.from ? `${change.from} → ${change.path}` : change.path}
                    onClick={() => props.onOpenChange?.(change)}
                  >
                    <span className="explorer__kind">{t(KIND_KEY[change.kind])}</span>
                    <span className="explorer__path">
                      {change.from ? `${change.from} → ${change.path}` : change.path}
                    </span>
                  </button>
                  {/* Two controls at most, and each is only drawn when it would do something: a file can be
                      staged *and* changed again, which is exactly when both are useful. */}
                  <span className="explorer__change-actions">
                    {props.onStage !== undefined && change.unstaged ? (
                      <button
                        type="button"
                        className="explorer__change-action"
                        title={t("explorer.stage", { path: change.path })}
                        aria-label={t("explorer.stage", { path: change.path })}
                        disabled={writing}
                        onClick={() => stage([change.path])}
                      >
                        <IndexAddIcon size={13} />
                      </button>
                    ) : null}
                    {props.onUnstage !== undefined && change.staged ? (
                      <button
                        type="button"
                        className="explorer__change-action"
                        title={t("explorer.unstage", { path: change.path })}
                        aria-label={t("explorer.unstage", { path: change.path })}
                        disabled={writing}
                        onClick={() => unstage([change.path])}
                      >
                        <IndexRemoveIcon size={13} />
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}

function FileTree(props: {
  entries: readonly ExplorerEntry[];
  depth: number;
  showHidden: boolean;
  sort: ExplorerSort;
  openDirs: ReadonlySet<string>;
  childrenByPath: Readonly<Record<string, readonly ExplorerEntry[]>>;
  onToggle: (path: string) => void;
  onOpenFile?: (entry: ExplorerEntry) => void;
}): JSX.Element {
  return (
    <ul className="explorer__list">
      {props.entries.map((entry) => {
        const open = props.openDirs.has(entry.path);
        const nested = props.childrenByPath[entry.path];
        return (
          <li key={entry.path}>
            {entry.kind === "dir" ? (
              <>
                <button
                  type="button"
                  className="explorer__row"
                  style={{ paddingLeft: 8 + props.depth * 12 }}
                  aria-expanded={open}
                  onClick={() => props.onToggle(entry.path)}
                >
                  <FolderIcon size={14} />
                  <span>{entry.name}</span>
                </button>
                {open && nested !== undefined ? (
                  <FileTree
                    entries={present(nested, props.showHidden, props.sort)}
                    depth={props.depth + 1}
                    showHidden={props.showHidden}
                    sort={props.sort}
                    openDirs={props.openDirs}
                    childrenByPath={props.childrenByPath}
                    onToggle={props.onToggle}
                    onOpenFile={props.onOpenFile}
                  />
                ) : null}
              </>
            ) : (
              <button
                type="button"
                className="explorer__row"
                style={{ paddingLeft: 8 + props.depth * 12 }}
                onClick={() => props.onOpenFile?.(entry)}
              >
                <FileIcon size={14} />
                <span>{entry.name}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
