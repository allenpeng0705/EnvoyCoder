/**
 * Reading a repository, and asking for the few things this product changes — the *pure* half of the git
 * service.
 *
 * ## Why the parsing is here and the spawning is not
 *
 * `worktree-changes.ts` next door does both, with `spawnSync`, because a sidebar listing can wait: a
 * `git status` in a normal repository is milliseconds. The branch actions here cannot, for a reason that
 * is about `git` rather than about speed — it **asks questions**. A credential prompt, a pager, an
 * editor for a merge message: any of them turns an RPC into a process nobody is talking to and holds it
 * until something kills it. So the caller must be able to enforce a deadline on the whole *process
 * group*, which is `bounded-process.ts`'s job in the daemon. Splitting the halves by what they need
 * leaves this file pure: the argv, the two parsers, and the ref check. Every claim in the parsers is
 * pinned by `test/git.test.ts` against output captured from a real repository rather than from the
 * documentation — including the two facts that decide the argv and are easy to get wrong:
 *
 *   * **`git checkout <name>` prefers a branch over a path of the same name** (verified with a branch
 *     and a directory both called `docs`), so switching branches does not need `git switch` and its
 *     git-2.23 floor;
 *   * **detached HEAD lists a pseudo-entry** (`* (HEAD detached at <sha>)`), which is why a client sees
 *     detachment as "no branch is current" rather than as a branch with a strange name.
 *
 * ## What a caller may and may not pass
 *
 * Nothing here builds a shell string: every argument is a separate argv element, so a branch name is a
 * value rather than syntax. Names are still *checked* before they are used ([branchNameRefusal]),
 * because git reads a leading `-` as an option — and because a refusal we can word in the user's language
 * beats git's `fatal:` line as the first thing they read. Git remains the authority: a name that passes
 * this check can still be refused by git, and that refusal is surfaced.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** The version controls this product knows how to name. `jj` is anticipated on the wire, not driven yet. */
export type VcsKind = "git" | "jj" | "none";

/** One branch, as a picker shows it. */
export interface GitBranch {
  name: string;
  /** True for the branch HEAD is on. */
  current: boolean;
  /** The tracking branch, when one is configured. */
  upstream?: string;
}

/** The repository's state, as far as a rail needs to say it. */
export interface GitStatus {
  kind: VcsKind;
  /** Absent when HEAD is detached, or when this folder is not a repository. */
  branch?: string;
  detached: boolean;
  upstream?: string;
  /** Commits this branch has that its upstream does not. */
  ahead: number;
  /** Commits the upstream has that this branch does not. */
  behind: number;
  /**
   * How many entries git reported — staged, modified **and untracked**.
   *
   * Untracked counts on purpose: the question this answers is "is there work here that a checkout could
   * disturb", and an untracked file is exactly that.
   */
  dirty: number;
  /** An unmerged entry exists: a merge, rebase or cherry-pick stopped here and wants a person. */
  conflicted: boolean;
}

/**
 * `git status --porcelain=v2 --branch -z`.
 *
 * v2 because the *branch* facts (head, upstream, ahead/behind) arrive in the same answer as the entries,
 * which is one process instead of three; `-z` because a path may contain a newline and a line-based parse
 * would then miscount. `--untracked-files=normal` keeps untracked entries in `dirty`; the ignored ones
 * (`!`) are still dropped, because they are not changes.
 */
export const GIT_STATUS_ARGS: readonly string[] = [
  "status",
  "--porcelain=v2",
  "--branch",
  "--untracked-files=normal",
  "-z",
];

/**
 * `git branch --list --format=…`, one line per branch, fields separated by NUL.
 *
 * `%(HEAD)` is `*` for the current branch, `%(refname:short)` the name, `%(upstream:short)` the tracking
 * branch (empty when there is none). A branch name cannot contain a newline or a NUL, so the two levels
 * of separation are unambiguous.
 */
export const GIT_BRANCHES_ARGS: readonly string[] = [
  "branch",
  "--list",
  "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)",
];

/** A count in `# branch.ab`, which git writes as `+3` / `-1`. Anything unreadable is zero. */
function count(value: string | undefined): number {
  if (value === undefined || value.length < 2) return 0;
  const parsed = Number.parseInt(value.slice(1), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Parse `GIT_STATUS_ARGS`' output.
 *
 * `kind` is passed in rather than inferred: whether this folder is a repository at all is the caller's
 * answer (it asked git), and a parser that guessed would be a second opinion about a fact already known.
 */
export function parseGitStatus(raw: string, options: { kind?: VcsKind } = {}): GitStatus {
  const status: GitStatus = {
    kind: options.kind ?? "git",
    detached: false,
    ahead: 0,
    behind: 0,
    dirty: 0,
    conflicted: false,
  };

  for (const record of raw.split("\0")) {
    if (record === "") continue;

    if (record.startsWith("# ")) {
      const space = record.indexOf(" ", 2);
      const field = space < 0 ? record.slice(2) : record.slice(2, space);
      const value = space < 0 ? "" : record.slice(space + 1);
      if (field === "branch.head") {
        if (value === "(detached)") status.detached = true;
        else if (value !== "") status.branch = value;
      } else if (field === "branch.upstream") {
        if (value !== "") status.upstream = value;
      } else if (field === "branch.ab") {
        const [ahead, behind] = value.split(" ");
        status.ahead = count(ahead);
        status.behind = count(behind);
      }
      // `# branch.oid` and any header a future git adds are read past rather than guessed at.
      continue;
    }

    switch (record[0]) {
      case "!":
        break; // ignored: not a change
      case "u":
        // **An unmerged entry.** This is the state a merge stopped in, and it is the one a control plane
        // must never render as an ordinary dirty tree: the next command a user runs decides whose work
        // survives.
        status.dirty += 1;
        status.conflicted = true;
        break;
      case "1":
      case "2":
      case "?":
        status.dirty += 1;
        break;
      default:
        break; // a record shape this build does not know: counted nowhere rather than guessed at
    }
  }

  return status;
}

/**
 * Parse `GIT_BRANCHES_ARGS`' output.
 *
 * In detached HEAD the list is a single pseudo-entry marked current, `(HEAD detached at <sha>)`; it is
 * skipped, so "no branch is current" is how a client sees detachment.
 */
export function parseGitBranches(raw: string): GitBranch[] {
  const branches: GitBranch[] = [];
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    const [head = "", name = "", upstream = ""] = line.split("\0");
    if (name === "" || name.startsWith("(")) continue;
    branches.push({
      name,
      current: head.trim() === "*",
      ...(upstream !== "" ? { upstream } : {}),
    });
  }
  return branches;
}

/** Why a name cannot be a branch, as a code the daemon words in the user's language. */
export type BranchNameRefusal = "empty" | "too-long" | "looks-like-an-option" | "not-a-ref";

/** Characters git forbids anywhere in a ref, whatever the position. */
const INVALID_REF_CHARS = /[\s~^:?*[\\\u0000-\u001f\u007f]/;

/**
 * The local half of git's `check-ref-format --branch`, which is deliberately **stricter than nothing and
 * looser than git**: it refuses what we can word ourselves, and leaves the rest to git, whose refusal is
 * surfaced rather than second-guessed. A name that gets through is still passed as a single argv element,
 * so the worst case is a refusal rather than a surprise.
 */
export function branchNameRefusal(name: string): BranchNameRefusal | undefined {
  if (name.trim() === "") return "empty";
  if (name.length > 255) return "too-long";
  // `git checkout -b -x` would read `-x` as an option; nothing legitimate starts with a dash.
  if (name.startsWith("-")) return "looks-like-an-option";
  if (INVALID_REF_CHARS.test(name)) return "not-a-ref";
  if (name === "@" || name.includes("..") || name.includes("@{")) return "not-a-ref";
  if (name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) return "not-a-ref";
  for (const part of name.split("/")) {
    if (part === "" || part.startsWith(".") || part.endsWith(".lock")) return "not-a-ref";
  }
  return undefined;
}

/** Switch to an existing branch. See the module doc for why `checkout` and not `switch`. */
export function gitCheckoutBranchArgs(branch: string): string[] {
  return ["checkout", branch];
}

/** Create a branch at HEAD and switch to it. */
export function gitCreateBranchArgs(name: string): string[] {
  return ["checkout", "-b", name];
}

/**
 * The environment a `git` child gets.
 *
 *   * **Never interactive.** A credential question becomes an EOF instead of an RPC held open until its
 *     deadline. `SSH_ASKPASS_REQUIRE=never` covers the ssh path on OpenSSH 8.4+; a `git fetch`/`push`
 *     over ssh will need more than this (batch mode), which is one of the things S3 owes.
 *   * **No optional locks on a read.** `git status` and `git branch` have no business taking the index
 *     lock while an agent is running git in the same folder. A checkout must *not* get this: it is a
 *     write, and it wants the lock.
 */
export function gitEnv(base: NodeJS.ProcessEnv, options: { read: boolean }): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    SSH_ASKPASS_REQUIRE: "never",
    ...(options.read ? { GIT_OPTIONAL_LOCKS: "0" } : {}),
  };
}

/**
 * What kind of version control this folder is, given git's own answer about the first half.
 *
 * `jj` is checked only when git said no: a colocated repository (`.jj` and `.git` together) answers `git`,
 * because that is the interface this product drives today. Being honest about `jj` matters more than
 * driving it — the alternative is offering git actions on a folder whose owner does not use git.
 */
export function detectVcsKind(dir: string, options: { gitRepository: boolean }): VcsKind {
  if (options.gitRepository) return "git";
  return existsSync(join(dir, ".jj")) ? "jj" : "none";
}
