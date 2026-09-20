/**
 * Git changes in a folder the daemon already trusts as a directory.
 *
 * The explorer sidebar asks "what changed here?". The answer is `git status` in porcelain v1
 * with NUL separators, so a path with a space or a newline is still one record. The folder is
 * checked the same way a directory listing is (`resolveHomeFsDirectory`): absolute, existing,
 * a directory. Nothing the user typed is passed to a shell.
 *
 * Not being a repository is a normal answer (`repo: false`), not a failure. A missing `git`
 * binary, or a status that failed for another reason, throws — the daemon turns that into a
 * refusal the sidebar shows beside the list, not in the window's banner.
 */

import { spawnSync } from "node:child_process";

import { resolveHomeFsDirectory } from "./home-fs.js";

export type WorktreeChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export interface WorktreeChange {
  path: string;
  kind: WorktreeChangeKind;
  /** The previous path, when git reports a rename or a copy. */
  from?: string;
  /**
   * True when the **index** holds something for this path — what `git commit` would record.
   *
   * A file can be both staged and changed again afterwards, which is why this and [unstaged] are two facts
   * rather than one state: a UI that collapsed them would tell a user their work is committed when half of
   * it is still in the working tree.
   */
  staged: boolean;
  /** True when the **working tree** differs from the index — what `git add` would pick up next. */
  unstaged: boolean;
}

export interface ListWorktreeChangesResult {
  path: string;
  /** False when this folder is not inside a git repository. */
  repo: boolean;
  changes: WorktreeChange[];
}

function kindOf(xy: string): WorktreeChangeKind | undefined {
  if (xy === "??") return "untracked";
  if (xy === "!!") return undefined;
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "conflict";
  if (xy.includes("R")) return "renamed";
  if (xy.includes("D")) return "deleted";
  if (xy.includes("A") || xy.includes("C")) return "added";
  return "modified";
}

function takesTwoPaths(xy: string): boolean {
  return xy.includes("R") || xy.includes("C");
}

/**
 * Which of the two sides of `git status`'s `XY` carry a change.
 *
 * `X` is the index (HEAD → index, i.e. what a commit would record) and `Y` is the working tree
 * (index → file). `??` is untracked: nothing in the index, and the file itself is the change. `!!` never
 * reaches here — ignored entries are dropped above.
 */
function stagedness(xy: string): { staged: boolean; unstaged: boolean } {
  if (xy === "??") return { staged: false, unstaged: true };
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  return { staged: x !== " ", unstaged: y !== " " };
}

/**
 * Parse `git status --porcelain=v1 -z`.
 *
 * Records are NUL-terminated. A rename or copy is two records: the old path, then the new one.
 * Ignored files (`!!`) are dropped — they are not changes.
 */
export function parsePorcelain(raw: string): WorktreeChange[] {
  if (raw.length === 0) return [];
  const parts = raw.split("\0");
  const changes: WorktreeChange[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const head = parts[i];
    if (head === undefined || head.length < 3) continue;
    const xy = head.slice(0, 2);
    const kind = kindOf(xy);
    const first = head.slice(3);
    if (takesTwoPaths(xy)) {
      const second = parts[i + 1];
      i += 1;
      if (kind === undefined || second === undefined || second.length === 0) continue;
      const change: WorktreeChange = { path: second, kind, ...stagedness(xy) };
      if (first.length > 0) change.from = first;
      changes.push(change);
      continue;
    }
    if (kind === undefined || first.length === 0) continue;
    changes.push({ path: first, kind, ...stagedness(xy) });
  }
  return changes;
}

export function listWorktreeChanges(cwd: string): ListWorktreeChangesResult {
  const target = resolveHomeFsDirectory(cwd);
  if (!target) {
    throw new Error(`Path is missing or is not a directory: ${cwd}`);
  }

  const inside = spawnSync("git", ["-C", target, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
  });
  if (inside.error) {
    const code = (inside.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("Git is not available on this machine.");
    throw new Error(inside.error.message);
  }
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return { path: target, repo: false, changes: [] };
  }

  const status = spawnSync(
    "git",
    ["-C", target, "status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    { encoding: "utf8", timeout: 8000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
  );
  if (status.error) throw new Error(status.error.message);
  if (status.status !== 0) {
    const detail = (status.stderr ?? "").trim();
    throw new Error(detail.length > 0 ? detail : "Could not read changes in this folder.");
  }
  return { path: target, repo: true, changes: parsePorcelain(status.stdout ?? "") };
}
