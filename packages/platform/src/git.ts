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

/** One stash, as a list shows it. */
export interface GitStash {
  /** The number a client sends back to put this stash back or discard it — never a ref it made up. */
  index: number;
  /** `stash@{n}`, as git wrote it. Shown rather than sent: a client names a stash by its number. */
  ref: string;
  /**
   * Git's own subject for the entry — `On <branch>: <what the user typed>`, or `WIP on <branch>: …`.
   *
   * **Not a sentence of ours, and not translated**: git writes it when the stash is made, and a reworded
   * copy here would be a claim about someone else's words. The time next to it is what makes it readable.
   */
  message: string;
  /** When the stash was made, as ISO 8601. Absent when git's answer could not be read. */
  at?: string;
}

/**
 * `git stash list -z --format=…`, records separated by NUL and fields by US (`\x1f`).
 *
 * Two separators because the first field git writes is the *reflog selector* and the last is a bare
 * timestamp: with `-z` alone a record would be a run of fields with nothing to count them by, and a
 * newline-separated parse would split on a message that contained one. `%s` is the subject, so a
 * multi-line message arrives as its first line rather than as two records.
 */
export const GIT_STASH_LIST_ARGS: readonly string[] = [
  "stash",
  "list",
  "-z",
  "--format=%gd%x1f%s%x1f%ct",
];

/**
 * Parse `GIT_STASH_LIST_ARGS`' output.
 *
 * A record whose selector is not `stash@{n}` is skipped rather than guessed at: that is the shape only a
 * stash has, and a line that lacks it is not one this build knows how to name.
 */
export function parseGitStashList(raw: string): GitStash[] {
  const stashes: GitStash[] = [];
  for (const record of raw.split("\0")) {
    if (record === "") continue;
    const [ref = "", message = "", seconds = ""] = record.split("\u001f");
    const selector = /^stash@\{(\d+)\}$/.exec(ref);
    if (selector === null) continue;
    const at = Number.parseInt(seconds, 10);
    stashes.push({
      index: Number.parseInt(selector[1] ?? "", 10),
      ref,
      message,
      ...(Number.isFinite(at) ? { at: new Date(at * 1000).toISOString() } : {}),
    });
  }
  return stashes;
}

/**
 * `stash@{n}`, built from a **number**.
 *
 * The client sends an index, never a ref: `git stash pop` takes any commit-ish, so a caller free to name the
 * revision could put back a commit, a tag, or another repository's object. A number can only be a stash, and
 * a number that is not a whole one is a programming error rather than something a user could type.
 */
export function stashRef(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`a stash index is a whole number that is not negative, not ${String(index)}`);
  }
  return `stash@{${index}}`;
}

/**
 * Set the working tree aside.
 *
 * **`-u` is not optional here.** "Stash my work" from a phone means the new file too, and a stash that
 * silently left untracked files behind would answer the next status read with a tree that still had work in
 * it — which is the one thing a user asked it not to. Ignored files are still left alone (`-u`, not `-a`): a
 * build directory is not work.
 *
 * **No `-m`**, and that is a decision rather than an omission: git's own subject names the branch and the
 * commit the work sat on (`WIP on work: 3c3a2b9 one`), which is what the list needs to tell two stashes
 * apart, and it costs a text field that no surface here has room for. A user who wants their own words has
 * a commit message for that.
 */
export const GIT_STASH_PUSH_ARGS: readonly string[] = ["stash", "push", "-u"];

/** Put one stash back. Which one is a number, and `stashRef` is what turns it into a ref. */
export function gitStashPopArgs(index: number): string[] {
  return ["stash", "pop", stashRef(index)];
}

/** Discard one stash, without touching the working tree. */
export function gitStashDropArgs(index: number): string[] {
  return ["stash", "drop", stashRef(index)];
}

/**
 * Taking back a stash that would not go on cleanly — the two commands that undo an attempted pop.
 *
 * **These are the only destructive commands this product runs, and the guard is elsewhere: a pop is only
 * attempted on a working tree the daemon has just measured as clean.** Given that, everything a conflicted
 * pop left behind came from the pop itself, so `reset --hard` (the tracked half) followed by `clean -qfd`
 * (the untracked files `-u` restores) puts the tree back exactly as it was — and the stash is *kept*, because
 * git does not drop one whose application conflicted. The alternative is a half-applied stash in a
 * repository this window cannot finish, which is the state the merge code refuses to leave too.
 */
export const GIT_STASH_POP_UNDO_ARGS: readonly string[] = ["reset", "--hard"];
export const GIT_STASH_POP_UNDO_CLEAN_ARGS: readonly string[] = ["clean", "-qfd"];

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

/**
 * Stage exactly these paths — what `git add` would pick up.
 *
 * `--` first, so a path that begins with a dash is a path rather than an option. Paths are **not** validated
 * here beyond that: git refuses a path outside the repository with its own sentence, and that refusal names
 * the file, which is more useful than anything this layer could invent. What a caller may not do is send a
 * command line — the paths are argv elements, never a string a shell sees.
 */
export function gitStageArgs(paths: readonly string[]): string[] {
  return ["add", "--", ...paths];
}

/**
 * Unstage exactly these paths — and git has two shapes for it, which is the interesting part.
 *
 * `git reset HEAD -- <paths>` is the statement, and it means "the index goes back to what `HEAD` has". A
 * repository with **no commits yet** has no `HEAD` to go back to, so that command fails with `fatal: Failed
 * to resolve 'HEAD'` — and the first commit of a project made in EnvoyDev is exactly that repository. There
 * the honest undo is `git rm --cached`, which drops the entry from the index and leaves the file on disk
 * (the whole point of `--cached`).
 */
export function gitUnstageArgs(paths: readonly string[], options: { hasHead: boolean }): string[] {
  return options.hasHead
    ? ["reset", "-q", "HEAD", "--", ...paths]
    : ["rm", "--cached", "-q", "--", ...paths];
}

/**
 * Merge `branch` into the branch HEAD is on.
 *
 * Two flags, and both are about never waiting for a person:
 *
 *   * **`--no-edit`** — a merge commit wants a message, and git's default behaviour is to open an *editor*
 *     for it. An editor no one is sitting in front of is a process that hangs until the deadline, so the
 *     message is git's own default (`Merge branch 'x' into y`) unless a caller supplies one.
 *   * **no `--ff-only`** — a merge that can fast-forward does, and one that cannot gets a merge commit,
 *     which is what "merge back to main" means. A caller that wants only the fast-forward case has
 *     `gitPullArgs`, where that is the point.
 */
export function gitMergeArgs(branch: string, options: { message?: string } = {}): string[] {
  return options.message !== undefined && options.message.trim() !== ""
    ? ["merge", "--no-edit", "-m", options.message, branch]
    : ["merge", "--no-edit", branch];
}

/**
 * Take the merge back.
 *
 * Two callers, and they are the two halves of this product's answer to a conflict. `coder.gitMerge` — the
 * merge a person asked for directly — aborts and refuses, because that refusal is a *statement about an
 * attempt*: nothing moved, and here is what would have to be resolved. `coder.gitMergeResolve` leaves the
 * conflict in place instead, so an agent can work in it, and then this is what the user's **Abort** press
 * runs. (The third caller is `gitMergeResolve` itself, taking its own conflict back when the agent could not
 * be started.) A repository may therefore be found mid-merge — which is why `GIT_MERGE_HEAD_ARGS` exists, why
 * the status says so, and why every surface has a way out.
 */
export const GIT_MERGE_ABORT_ARGS: readonly string[] = ["merge", "--abort"];

/**
 * Is a merge in progress? `MERGE_HEAD` exists exactly while one is, and it is the thing that makes
 * `git commit` a *merge* commit rather than an ordinary one.
 *
 * Asked by exit code like `GIT_HAS_HEAD_ARGS`, and only when the tree already shows conflicts: a status read
 * for a clean repository must not pay for a second spawn. It is the difference between "a merge stopped here,
 * and there is a way to finish it" and "some other operation left conflicts" — two states with different
 * advice, and `git status`'s own long format says which in a *localised* sentence this build cannot read.
 */
export const GIT_MERGE_HEAD_ARGS: readonly string[] = ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"];

/**
 * The branch a merge is bringing in, when it can be named.
 *
 * `name-rev --name-only MERGE_HEAD` rather than the branch name git writes into `MERGE_MSG`
 * (`Merge branch 'work' into main`), because that message is generated by whichever git *made the merge*,
 * in whatever language it ran in — so reading it would be a parser for somebody else's prose. `name-rev`
 * answers from the commit graph and is locale-free. Two shapes are not names: a commit no ref reaches
 * answers the literal `undefined` (exit 0, so the code cannot be trusted), and a diagnostic line contains
 * spaces. Both are dropped by [mergeBranchName] rather than shown.
 */
export const GIT_MERGE_HEAD_BRANCH_ARGS: readonly string[] = ["name-rev", "--name-only", "MERGE_HEAD"];

/**
 * Finish a merge whose conflicts are resolved.
 *
 * `--no-edit` for the reason every other command here has it: git's default is to open an *editor* for the
 * merge message, and an editor nobody is sitting in front of is a process held until the deadline. The
 * message is then git's own (`Merge branch 'work'`), which is what a user's terminal would have written.
 *
 * Run only when the index has **no unmerged entries**: git refuses otherwise (`Committing is not possible
 * because you have unmerged files`), and that refusal reads as a complaint about work the user is still
 * doing rather than as an instruction.
 */
export const GIT_MERGE_CONTINUE_ARGS: readonly string[] = ["commit", "--no-edit"];

/**
 * One line of `name-rev` output, as a branch name or nothing.
 *
 * A value with a space in it is not a ref (git forbids them in ref names), so it is a diagnostic such as
 * `Could not get sha1 for MERGE_HEAD. Skipping.` — shown to nobody. A distance suffix (`work~1`) is kept:
 * it is what the merge actually brought in, and a user who merged a commit rather than a branch tip is
 * better served by that than by a blank.
 */
export function mergeBranchName(raw: string): string | undefined {
  const name = raw.trim();
  if (name === "" || name === "undefined") return undefined;
  if (/\s/.test(name)) return undefined;
  return name;
}


/**
 * Fetch, and pull.
 *
 * **`pull` is `--ff-only`, and that is a decision rather than a default.** "Bring me up to date" and "combine
 * two histories" are different operations with different failure modes: a fast-forward cannot conflict, so a
 * pull either succeeds or says the histories have diverged and leaves the branch alone — and combining them
 * is `coder.gitMerge`, which refuses *with the file list* and undoes itself. A pull that silently merged
 * would be the one place a user could be surprised by a conflict they cannot see from the phone.
 */
export const GIT_FETCH_ARGS: readonly string[] = ["fetch", "--prune"];
export const GIT_PULL_ARGS: readonly string[] = ["pull", "--ff-only"];

/** Commit what is staged, with this message. Nothing else is inferred: no `--all`, no `--amend`, no hooks off. */
export function gitCommitArgs(message: string): string[] {
  return ["commit", "-m", message];
}

/**
 * Is there anything staged? By **exit code**: 0 means nothing, 1 means something, anything else is a failure.
 *
 * Asked before the commit so the refusal can be a sentence in the user's language rather than git's English
 * `nothing added to commit`. `--quiet` because the answer is the code, not the diff.
 */
export const GIT_HAS_STAGED_ARGS: readonly string[] = ["diff", "--cached", "--quiet"];

/** Does this repository have a commit at all? Asked only where it changes the command (unstaging). */
export const GIT_HAS_HEAD_ARGS: readonly string[] = ["rev-parse", "--verify", "--quiet", "HEAD"];

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
export function gitEnv(
  base: NodeJS.ProcessEnv,
  options: {
    read: boolean;
    /**
     * The `PATH` the daemon measured, already joined for this platform.
     *
     * **This is what makes "git is not installed" an honest sentence.** A window launched from Finder (or a
     * Windows shortcut, or a desktop file) hands its child a minimal `PATH`, and a `git` the user installed
     * somewhere else — Homebrew, `~/.local/bin`, Scoop — is then invisible to the daemon while their own
     * terminal runs it happily. The daemon already solves exactly this for agent binaries by asking the
     * login shell (`currentSearchPath`); a git child gets the same list, so the program the probe found is
     * the program this runs. Absent when nothing could be measured, in which case the inherited `PATH`
     * stands rather than a guess.
     */
    path?: string;
    /**
     * The ssh agent socket the user's login shell named, when this process does not have one.
     *
     * The other half of "a GUI process is not a terminal": `SSH_AUTH_SOCK` is what ssh finds your keys
     * through, and a bundled app may start without it. It is a *path*, not a secret — the socket's own file
     * permissions are what guard it — so passing the one the login shell named is not a credential decision,
     * it is the same "ask the shell what world the user is in" rule as `PATH`.
     */
    sshAuthSock?: string;
  },
): NodeJS.ProcessEnv {
  return {
    ...base,
    ...(options.path !== undefined && options.path !== "" ? { PATH: options.path } : {}),
    ...(base.SSH_AUTH_SOCK === undefined && options.sshAuthSock !== undefined && options.sshAuthSock !== ""
      ? { SSH_AUTH_SOCK: options.sshAuthSock }
      : {}),
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
