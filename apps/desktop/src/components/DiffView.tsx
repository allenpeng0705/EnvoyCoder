/**
 * One file's change, drawn the way a diff is read: old line, new line, then the code.
 *
 * Added rows and removed rows keep their own background. The code itself is colored with the
 * same highlighter the chat already uses. A hunk header is the only git line that stays.
 */

import type { JSX } from "react";
import { useMemo } from "react";

import { highlightCode } from "./markdown/highlight.js";
import { parseUnifiedDiff, type DiffRowKind } from "./diff-model.js";

const LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  dart: "dart",
  sql: "sql",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
};

function languageFor(name: string): string | undefined {
  const ext = name.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  return LANG[ext];
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paint(text: string, language: string | undefined): string {
  const highlighted = highlightCode(text, language);
  return highlighted.ok ? highlighted.html : escapeHtml(text);
}

function sign(kind: DiffRowKind): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "−";
  return "";
}

export function DiffView(props: { name: string; text: string }): JSX.Element {
  const language = languageFor(props.name);
  const model = useMemo(() => parseUnifiedDiff(props.text), [props.text]);
  const html = useMemo(
    () => model.rows.map((row) => (row.kind === "hunk" ? "" : paint(row.text, language))),
    [language, model.rows],
  );

  return (
    <div className="diff-view">
      <p className="diff-view__summary">
        <span className="diff-view__stat diff-view__stat--add">+{model.additions}</span>
        <span className="diff-view__stat diff-view__stat--remove">−{model.deletions}</span>
      </p>
      {model.rows.map((row, index) =>
        row.kind === "hunk" ? (
          <div key={index} className="diff-view__hunk">
            {row.text}
          </div>
        ) : (
          <div key={index} className={`diff-view__row diff-view__row--${row.kind}`}>
            <span className="diff-view__no">{row.oldLine ?? ""}</span>
            <span className="diff-view__no">{row.newLine ?? ""}</span>
            <span className={`diff-view__sign diff-view__sign--${row.kind}`}>{sign(row.kind)}</span>
            <code className="diff-view__code" dangerouslySetInnerHTML={{ __html: html[index] ?? "" }} />
          </div>
        ),
      )}
    </div>
  );
}
