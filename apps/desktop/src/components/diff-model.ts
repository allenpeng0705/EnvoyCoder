/**
 * A unified diff, as rows a window can draw.
 *
 * Git writes the text. This only splits it: a hunk header, an added line, a removed line, or a
 * line that did not change. Line numbers follow the hunk, the same way a diff view counts them.
 */

export type DiffRowKind = "hunk" | "add" | "remove" | "context";

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface ParsedDiff {
  rows: DiffRow[];
  additions: number;
  deletions: number;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(raw: string): ParsedDiff {
  const body = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  const rows: DiffRow[] = [];
  let additions = 0;
  let deletions = 0;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of body.length === 0 ? [] : body.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), newLine });
      newLine += 1;
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "remove", text: line.slice(1), oldLine });
      oldLine += 1;
      deletions += 1;
      continue;
    }
    const text = line.startsWith(" ") ? line.slice(1) : line;
    rows.push({ kind: "context", text, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }

  return { rows, additions, deletions };
}
