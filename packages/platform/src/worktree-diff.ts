/**
 * The change for one file the Changes list already named.
 *
 * A click there opens this, not the file. A deleted file is gone, and a modified file is the
 * difference, not the text that is there now. The comparison is against the last commit. A file
 * git does not track yet is compared with nothing. The path has to stay inside the repository.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { resolveHomeFsDirectory } from "./home-fs.js";

const MAX_BYTES = 2_000_000;

export type WorktreeDiffKind = "text" | "binary" | "tooLarge" | "empty";

export interface WorktreeDiff {
  path: string;
  name: string;
  kind: WorktreeDiffKind;
  size: number;
  content?: string;
}

function runGit(target: string, args: string[]): string {
  const result = spawnSync("git", ["-C", target, ...args], {
    encoding: "utf8",
    timeout: 8000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("Git is not available on this machine.");
    if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new Error("This change is too large to open here.");
    }
    throw new Error(result.error.message);
  }
  const status = result.status ?? 1;
  if (status !== 0 && status !== 1) {
    const detail = (result.stderr ?? "").trim();
    throw new Error(detail.length > 0 ? detail : "Could not open this change.");
  }
  return result.stdout ?? "";
}

function safeRelative(value: string): string {
  const raw = value.trim();
  if (!raw || raw.includes("\0") || path.isAbsolute(raw)) {
    throw new Error("Pick a file in this folder.");
  }
  return raw;
}

function inside(root: string, abs: string): boolean {
  const base = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return abs === root || abs.startsWith(base);
}

function classify(rel: string, stdout: string): WorktreeDiff {
  const name = rel.split(/[/\\]/).pop() || rel;
  const size = Buffer.byteLength(stdout);
  if (size === 0) return { path: rel, name, kind: "empty", size: 0 };
  if (size > MAX_BYTES) return { path: rel, name, kind: "tooLarge", size };
  if (stdout.includes("\0") || /^Binary files /m.test(stdout) || stdout.includes("GIT binary patch")) {
    return { path: rel, name, kind: "binary", size };
  }
  return { path: rel, name, kind: "text", size, content: stdout };
}

/** One file's uncommitted change, as unified diff text when it can be shown. */
export function readWorktreeDiff(directory: string, relativePath: string, from?: string): WorktreeDiff {
  const target = resolveHomeFsDirectory(directory);
  if (!target) throw new Error(`Path is missing or is not a directory: ${directory}`);
  const rel = safeRelative(relativePath);
  const previous = from === undefined || from.length === 0 ? undefined : safeRelative(from);

  const root = realpathSync(path.resolve(runGit(target, ["rev-parse", "--show-toplevel"]).trim()));
  const base = realpathSync(target);
  if (!inside(root, path.resolve(base, rel))) throw new Error("Pick a file in this folder.");
  if (previous !== undefined && !inside(root, path.resolve(base, previous))) {
    throw new Error("Pick a file in this folder.");
  }

  const paths = previous === undefined ? [rel] : [previous, rel];
  let stdout = runGit(target, ["diff", "--no-ext-diff", "--find-renames", "HEAD", "--", ...paths]);
  if (stdout.length === 0) {
    try {
      stdout = runGit(target, ["diff", "--no-ext-diff", "--no-index", "--", "/dev/null", rel]);
    } catch {
      stdout = "";
    }
  }
  return classify(rel, stdout);
}
