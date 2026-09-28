/**
 * Typed tool presentation — read / edit / shell, with a generic fallback.
 * Derives from transcript ToolEntry only; drawing never invents session-log kinds.
 */

import type { ReactElement } from "react";

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
  if (oldText !== undefined || newText !== undefined) {
    const removed = oldText !== undefined ? lineCount(oldText) : 0;
    const added = newText !== undefined ? lineCount(newText) : 0;
    return `−${removed} / +${added}`;
  }
  for (const key of ["diff", "patch", "edits"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return summarize(value, 200);
    if (Array.isArray(value) && value.length > 0) {
      return `${value.length} edit${value.length === 1 ? "" : "s"}`;
    }
  }
  return undefined;
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

export function ToolCard(props: { entry: ToolEntry; nested?: boolean }): ReactElement {
  const t = useT();
  const { entry } = props;
  const bucket = toolBucket(entry.name);
  const path = pathFromToolInput(entry.input);
  const command = bucket === "ran" ? commandFromInput(entry.input) : undefined;
  const editSummary = bucket === "edited" ? editDiffSummary(entry.input) : undefined;
  const excerpt =
    bucket === "searched"
      ? excerptFromOutput(entry.output)
      : bucket === "ran"
        ? excerptFromOutput(entry.output, 320)
        : undefined;

  const tone =
    entry.status === "running" ? "live" : entry.status === "failed" ? "danger" : "quiet";

  return (
    <li
      className={`row row--tool row--tool-${entry.status} row--tool-${bucket}${
        props.nested === true ? " row--tool-nested" : ""
      }`}
      data-testid={`tool-card-${bucket}`}
    >
      <div className="row__tool-head">
        <span className={`dot dot--${tone}`} aria-hidden />
        <span className="row__tool-kind">{t(bucketKey(bucket))}</span>
        <span className="row__tool-name">{entry.name}</span>
      </div>
      {path ? (
        <p className="row__tool-path" title={path}>
          {path}
        </p>
      ) : null}
      {editSummary ? <p className="row__tool-diff">{editSummary}</p> : null}
      {command ? <pre className="row__code row__code--cmd">{command}</pre> : null}
      {excerpt ? <pre className="row__code">{excerpt}</pre> : null}
      {bucket === "other" && entry.input !== undefined ? (
        <pre className="row__code">{summarize(entry.input)}</pre>
      ) : null}
      {bucket === "other" && entry.output !== undefined ? (
        <pre className="row__code">{summarize(entry.output)}</pre>
      ) : null}
      {bucket === "edited" && !editSummary && !path && entry.input !== undefined ? (
        <pre className="row__code">{summarize(entry.input)}</pre>
      ) : null}
    </li>
  );
}
