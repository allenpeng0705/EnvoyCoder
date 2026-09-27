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
  const excerpt =
    bucket === "searched" || bucket === "edited"
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
      <p className="row__tool-head">
        <span className={`dot dot--${tone}`} aria-hidden />
        <span className="row__tool-kind">{t(bucketKey(bucket))}</span>
        <span className="row__tool-name">{entry.name}</span>
        {path ? <span className="row__tool-path" title={path}>{path}</span> : null}
      </p>
      {command ? <pre className="row__code row__code--cmd">{command}</pre> : null}
      {excerpt && bucket !== "other" ? <pre className="row__code">{excerpt}</pre> : null}
      {bucket === "other" && entry.input !== undefined ? (
        <pre className="row__code">{summarize(entry.input)}</pre>
      ) : null}
      {bucket === "other" && entry.output !== undefined ? (
        <pre className="row__code">{summarize(entry.output)}</pre>
      ) : null}
      {bucket === "edited" && !excerpt && entry.input !== undefined && !path ? (
        <pre className="row__code">{summarize(entry.input)}</pre>
      ) : null}
    </li>
  );
}
