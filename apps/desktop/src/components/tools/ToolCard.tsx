/**
 * Typed tool presentation — read / edit / shell, with a generic fallback.
 * Derives from transcript ToolEntry only; drawing never invents session-log kinds.
 *
 * Default view is a one-liner (bucket, name, path / command / ±). Long payloads
 * sit behind a closed Details disclosure so the answer stays readable. Edit tools
 * also show a short inline mini-diff when old/new strings are present.
 */

import { useLayoutEffect, useMemo, useRef, type ReactElement } from "react";

import { useT } from "../../i18n/context.js";
import {
  pathFromToolInput,
  toolBucket,
  type ToolBucket,
} from "../../state/tool-buckets.js";
import type { ToolEntry } from "../../state/transcript.js";

function summarize(value: unknown, limit = 400): string {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}

function commandFromInput(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") {
    return typeof input === "string" ? input : undefined;
  }
  const record = input as Record<string, unknown>;
  for (const key of ["command", "cmd", "script", "code"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function excerptFromOutput(output: unknown, limit = 240): string | undefined {
  if (output === undefined) return undefined;
  return summarize(output, limit);
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

/** Old/new text for an edit/write tool, when the agent sent them. */
export function editTextsFromInput(input: unknown): { oldText?: string; newText?: string } {
  if (input === null || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  const oldText =
    typeof record.old_string === "string"
      ? record.old_string
      : typeof record.oldString === "string"
        ? record.oldString
        : typeof record.before === "string"
          ? record.before
          : undefined;
  const newText =
    typeof record.new_string === "string"
      ? record.new_string
      : typeof record.newString === "string"
        ? record.newString
        : typeof record.after === "string"
          ? record.after
          : typeof record.contents === "string"
            ? record.contents
            : undefined;
  return { oldText, newText };
}

/**
 * Diff-style summary for edit/write tools — path + +/- line counts when old/new
 * strings are present, else a short patch/diff excerpt from the input.
 */
export function editDiffSummary(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") {
    return typeof input === "string" && input.trim() !== ""
      ? summarize(input, 200)
      : undefined;
  }
  const { oldText, newText } = editTextsFromInput(input);
  if (oldText !== undefined || newText !== undefined) {
    const removed = oldText !== undefined ? lineCount(oldText) : 0;
    const added = newText !== undefined ? lineCount(newText) : 0;
    return `−${removed} / +${added}`;
  }
  const record = input as Record<string, unknown>;
  for (const key of ["diff", "patch", "edits"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return summarize(value, 200);
    if (Array.isArray(value) && value.length > 0) {
      return `${value.length} edit${value.length === 1 ? "" : "s"}`;
    }
  }
  return undefined;
}

export type MiniDiffLine =
  | { kind: "add" | "remove"; text: string }
  | { kind: "more"; direction: "removed" | "added"; count: number };

/** Compact preview lines for an edit (capped) — not a full LCS. “More” rows are localized at render. */
export function miniDiffLines(
  oldText: string | undefined,
  newText: string | undefined,
  maxEach = 4,
): MiniDiffLine[] {
  const lines: MiniDiffLine[] = [];
  const oldLines = oldText !== undefined ? oldText.split("\n") : [];
  const newLines = newText !== undefined ? newText.split("\n") : [];
  const showOld = oldLines.slice(0, maxEach);
  const showNew = newLines.slice(0, maxEach);
  for (const text of showOld) lines.push({ kind: "remove", text });
  if (oldLines.length > maxEach) {
    lines.push({ kind: "more", direction: "removed", count: oldLines.length - maxEach });
  }
  for (const text of showNew) lines.push({ kind: "add", text });
  if (newLines.length > maxEach) {
    lines.push({ kind: "more", direction: "added", count: newLines.length - maxEach });
  }
  return lines;
}

function bucketKey(
  bucket: ToolBucket,
): "task.tool.bucket.read" | "task.tool.bucket.edit" | "task.tool.bucket.shell" | "task.tool.bucket.other" {
  switch (bucket) {
    case "searched":
      return "task.tool.bucket.read";
    case "edited":
      return "task.tool.bucket.edit";
    case "ran":
      return "task.tool.bucket.shell";
    case "other":
      return "task.tool.bucket.other";
  }
}

function shortCommand(command: string, limit = 80): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  if (oneLine.length <= limit) return oneLine;
  return `${oneLine.slice(0, limit - 1)}…`;
}

/**
 * One-line headline for an unknown tool — prefer a human field over dumping JSON on the head.
 */
export function otherToolHeadline(input: unknown): string | undefined {
  if (input === null || typeof input === "undefined") return undefined;
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed === "" ? undefined : shortCommand(trimmed, 72);
  }
  if (typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["objective", "prompt", "message", "query", "title", "description", "reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return shortCommand(value, 72);
  }
  const tasks = record.tasks;
  if (Array.isArray(tasks) && tasks.length > 0) {
    const first = tasks[0];
    if (first !== null && typeof first === "object") {
      const objective = (first as Record<string, unknown>).objective;
      if (typeof objective === "string" && objective.trim() !== "") {
        return shortCommand(objective, 72);
      }
    }
    return `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
  }
  return undefined;
}

export type ToolOpenView = "file" | "diff";

export function ToolCard(props: {
  entry: ToolEntry;
  nested?: boolean;
  /** Open this path in WorkArea (file for reads, diff for edits). */
  onOpenPath?: (path: string, view: ToolOpenView) => void;
}): ReactElement {
  const t = useT();
  const { entry } = props;
  const nested = props.nested === true;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Outside Steps: open briefly while a tool runs so shell/read output is watchable, then
  // fold when it settles. Inside Steps the outer disclosure already owns the live view —
  // auto-opening every nested Details is what turns a turn into a wall of JSON.
  const wasRunning = useRef(false);
  useLayoutEffect(() => {
    if (nested) return;
    const running = entry.status === "running";
    const node = detailsRef.current;
    if (node === null) return;
    if (running && !wasRunning.current) node.open = true;
    if (!running && wasRunning.current) node.open = false;
    wasRunning.current = running;
  }, [entry.status, nested]);

  const bucket = toolBucket(entry.name);
  const path = pathFromToolInput(entry.input);
  const command = bucket === "ran" ? commandFromInput(entry.input) : undefined;
  const editSummary = bucket === "edited" ? editDiffSummary(entry.input) : undefined;
  const preview = useMemo(() => {
    if (bucket !== "edited") return [];
    const { oldText, newText } = editTextsFromInput(entry.input);
    return miniDiffLines(oldText, newText);
  }, [bucket, entry.input]);
  const otherHeadline = bucket === "other" ? otherToolHeadline(entry.input) : undefined;
  const excerpt =
    bucket === "searched"
      ? excerptFromOutput(entry.output)
      : bucket === "ran"
        ? excerptFromOutput(entry.output, 320)
        : undefined;

  const detailBlocks: string[] = [];
  if (excerpt) detailBlocks.push(excerpt);
  if (bucket === "other" && entry.input !== undefined) detailBlocks.push(summarize(entry.input));
  if (bucket === "other" && entry.output !== undefined) detailBlocks.push(summarize(entry.output));
  if (bucket === "edited" && !editSummary && !path && entry.input !== undefined) {
    detailBlocks.push(summarize(entry.input));
  }
  // Shell / read already surface a short command or path on the head; keep full
  // output (and long commands) behind Details.
  if (bucket === "ran" && command !== undefined && command.length > 80) {
    detailBlocks.unshift(command);
  }
  if (bucket === "searched" && entry.output !== undefined && !excerpt) {
    detailBlocks.push(summarize(entry.output));
  }

  const tone =
    entry.status === "running" ? "live" : entry.status === "failed" ? "danger" : "quiet";

  const openView: ToolOpenView = bucket === "edited" ? "diff" : "file";
  const canOpen = path !== undefined && props.onOpenPath !== undefined;

  return (
    <li
      className={`row row--tool row--tool-${entry.status} row--tool-${bucket}${
        nested ? " row--tool-nested" : ""
      }`}
      data-testid={`tool-card-${bucket}`}
    >
      <div className="row__tool-head">
        <span className={`dot dot--${tone}`} aria-hidden />
        <span className="row__tool-kind">{t(bucketKey(bucket))}</span>
        <span className="row__tool-name">{entry.name}</span>
        {path ? (
          canOpen ? (
            <button
              type="button"
              className="row__tool-path row__tool-path--link"
              title={path}
              aria-label={t("task.tool.openPath", { path })}
              data-testid="tool-card-open-path"
              onClick={() => props.onOpenPath?.(path, openView)}
            >
              {path}
            </button>
          ) : (
            <span className="row__tool-path" title={path}>
              {path}
            </span>
          )
        ) : null}
        {editSummary ? <span className="row__tool-diff">{editSummary}</span> : null}
        {command ? (
          <span className="row__tool-cmd" title={command}>
            {shortCommand(command)}
          </span>
        ) : null}
        {otherHeadline ? (
          <span className="row__tool-cmd" title={otherHeadline}>
            {otherHeadline}
          </span>
        ) : null}
      </div>
      {preview.length > 0 ? (
        <pre
          className="row__tool-mini-diff"
          data-testid="tool-card-mini-diff"
          aria-label={editSummary ? t("task.tool.miniDiff.aria", { summary: editSummary }) : t("task.tool.miniDiff.ariaPlain")}
        >
          {preview.map((line, index) => (
            <span
              key={`${line.kind}-${index}`}
              className={`row__tool-mini-diff-line row__tool-mini-diff-line--${line.kind}`}
            >
              {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
              {line.kind === "more"
                ? line.direction === "removed"
                  ? t("task.tool.miniDiff.moreRemoved", { count: line.count })
                  : t("task.tool.miniDiff.moreAdded", { count: line.count })
                : line.text}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : null}
      {detailBlocks.length > 0 ? (
        <details ref={detailsRef} className="row__tool-details">
          <summary>{t("task.tool.details")}</summary>
          {detailBlocks.map((block, index) => (
            <pre key={index} className="row__code">
              {block}
            </pre>
          ))}
        </details>
      ) : null}
    </li>
  );
}
