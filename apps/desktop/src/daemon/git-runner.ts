/**
 * Running `git`, and measuring a repository — the daemon's half of the git plumbing.
 *
 * ## Why this is apart from the handler table
 *
 * `git.ts` holds the methods a client calls, which is the part worth reading in one piece: what each one
 * refuses, and why. This module holds the part that is the same for all of them — starting a bounded,
 * non-interactive `git` child, reading the status, finding the repository root, listing what changed — and it
 * was split out when the conflict flow took the handler module past the family's 800-line cap. The seam is the
 * one the file already had: everything here answers a question about a repository, and nothing here knows
 * which method asked or what a client will see.
 *
 * ## The property every function here keeps
 *
 * **A git child is never interactive and never unbounded.** `gitEnv` closes the doors git would ask a question
 * through (a credential prompt, an askpass helper, an ssh askpass), and `runBounded` gives each child a
 * deadline and a process *group* kill — because a `git` that is waiting for a password holds an RPC open
 * forever, and the timeout is the only thing that ends it. Both were measured rather than assumed; see
 * `packages/platform/src/git.ts` for the argv and the parsers, which are pure and pinned against a real
 * repository.
 */

import { spawn as nodeSpawn } from "node:child_process";

import {
  GIT_HAS_HEAD_ARGS,
  GIT_HAS_STAGED_ARGS,
  GIT_MERGE_HEAD_ARGS,
  GIT_MERGE_HEAD_BRANCH_ARGS,
  GIT_STASH_LIST_ARGS,
  GIT_STATUS_ARGS,
  currentSearchPath,
  detectVcsKind,
  gitEnv,
  listWorktreeChanges,
  mergeBranchName,
  parseGitStashList,
  parseGitStatus,
  type BranchNameRefusal,
  type GitStash,
  type VcsKind,
  type WorktreeChange,
} from "@envoydev/platform";
import { ENVOYDEV_ERRORS, coderError, type GitStatus } from "@envoydev/protocol";

import { runBounded, tailText, type BoundedOutput } from "./bounded-process.js";
import { ref } from "./messages.js";

/**
 * What running git needs from the daemon — the injected program, spawn, environment and deadlines.
 *
 * Structural rather than the handler table's own `GitHandlerDeps`, so this module cannot reach a store or a
 * run manager: nothing here needs one, and the type is what keeps it that way.
 */
export interface GitRunDeps {
  /** Injectable for tests; the daemon passes the real `spawn`. */
  spawn?: typeof nodeSpawn;
  /** The program to run. `git`, and injectable so a test can prove what "not installed" says. */
  command?: string;
  /**
   * The environment the git children start from — this daemon's own, unless a test says otherwise.
   *
   * Injected for the one case that cannot be arranged any other way: **a machine with no author identity**.
   * Git refuses a commit then, with a sentence naming the `git config` to run, and that refusal is one a
   * fresh install really meets — so it is proven with an empty `HOME` rather than assumed.
   */
  env?: () => NodeJS.ProcessEnv;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
}

export const GIT_READ_TIMEOUT_MS = 10_000;

/** A write. A checkout rewrites the working tree, and a filter (LFS, say) may have to fetch first. */
export const GIT_WRITE_TIMEOUT_MS = 60_000;

/** How much of git's own output is kept. Enough for the `fatal:` line, not enough to be a transcript. */
export const GIT_OUTPUT_LIMIT = 16 * 1024;

/** How much of it goes into the sentence a user reads. */
const GIT_DETAIL_LIMIT = 400;

/**
 * The English sentences, byte-identical to the catalogue's.
 *
 * Duplicated on purpose, exactly as `service.ts` duplicates its own: the sentence is the wire's fallback
 * and the log line, and `daemon-errors-i18n.test.ts` compares the two so they cannot drift.
 */
const MISSING_SENTENCE =
  "Git is not installed on this machine, so EnvoyDev cannot read this repository. Install git and try again.";
const TIMED_OUT_SENTENCE =
  "Git did not finish in time, so EnvoyDev stopped it. The repository may be very large, or git may be waiting for something.";

/** The refusal for a failed command, with git's own sentence as the detail. */
export function gitFailed(output: BoundedOutput): Error {
  const detail = tailText(output.text.trim(), GIT_DETAIL_LIMIT);
  return coderError(
    ENVOYDEV_ERRORS.gitFailed,
    `Git could not do that: ${detail}`,
    ref("error.gitFailed", { detail }),
  );
}

/**
 * What kind of version control this folder is — measured, for `Project.vcs`.
 *
 * The stored answer exists so a project **list** does not have to spawn git per row to know whether to
 * offer branches at all; the branch itself is never stored, because a branch moves under us and a cached
 * one is a lie the window has no way to notice.
 */
export async function measureProjectVcs(deps: GitRunDeps, dir: string): Promise<VcsKind> {
  const inside = await runGit(deps, dir, ["rev-parse", "--is-inside-work-tree"], { read: true });
  const isRepository = inside.code === 0 && inside.text.trim() === "true";
  return detectVcsKind(dir, { gitRepository: isRepository });
}

/**
 * The environment a git child runs in: the user's world, and never a question.
 *
 * Two things are taken from what the daemon has already measured rather than from its own environment, and
 * they are the same two things a bundled app gets wrong:
 *
 *   * **`PATH`** — the list the login shell named, which is the list the probes searched. Without it, a
 *     `git` installed outside `/usr/bin` is invisible to us and visible to the user's terminal, and the
 *     refusal we would produce ("git is not installed") would be a lie about their machine.
 *   * **`SSH_AUTH_SOCK`** — the agent socket the login shell named, only when this process has none. It is
 *     what makes an `ssh` remote work from an app that was not started in a terminal.
 *
 * Everything else in the environment is inherited, and `gitEnv` adds the parts that keep git from asking a
 * question it cannot get an answer to.
 */
function gitChildEnv(deps: GitRunDeps, read: boolean): NodeJS.ProcessEnv {
  const search = currentSearchPath();
  return gitEnv(deps.env?.() ?? process.env, {
    read,
    ...(search.searchable ? { path: search.path } : {}),
    ...(search.sshAuthSock !== undefined ? { sshAuthSock: search.sshAuthSock } : {}),
  });
}

/** Run git in `dir`, bounded, with the environment that keeps it from asking a question. */
export async function runGit(
  deps: GitRunDeps,
  dir: string,
  args: readonly string[],
  options: { read: boolean },
): Promise<BoundedOutput> {
  const output = await runBounded(deps.command ?? "git", ["-C", dir, ...args], {
    env: gitChildEnv(deps, options.read),
    timeoutMs:
      options.read
        ? (deps.readTimeoutMs ?? GIT_READ_TIMEOUT_MS)
        : (deps.writeTimeoutMs ?? GIT_WRITE_TIMEOUT_MS),
    outputLimit: GIT_OUTPUT_LIMIT,
    ...(deps.spawn !== undefined ? { spawn: deps.spawn } : {}),
  });
  if (output.spawnError?.code === "ENOENT") {
    throw coderError(ENVOYDEV_ERRORS.gitMissing, MISSING_SENTENCE, ref("error.gitMissing"));
  }
  if (output.timedOut) {
    throw coderError(ENVOYDEV_ERRORS.gitFailed, TIMED_OUT_SENTENCE, ref("error.gitTimedOut"));
  }
  return output;
}

/**
 * Is a *merge* what stopped here, and what is it bringing in?
 *
 * Asked only for a repository that already shows conflicts, so a clean status read never pays for it. The
 * distinction is not academic: `conflicted` alone means "some operation wants a person" — a rebase, a
 * cherry-pick, a stash pop that conflicted in a terminal — and only a merge is something this product can
 * finish or abort. `MERGE_HEAD` is the fact, asked by exit code rather than by reading the localised
 * sentence `git status` writes about it.
 */
async function mergeInProgress(
  deps: GitRunDeps,
  dir: string,
): Promise<{ branch?: string } | undefined> {
  const head = await runGit(deps, dir, GIT_MERGE_HEAD_ARGS, { read: true });
  if (head.code !== 0) return undefined;
  const named = await runGit(deps, dir, GIT_MERGE_HEAD_BRANCH_ARGS, { read: true });
  // `name-rev` answers the literal `undefined` for a commit no ref reaches, and a diagnostic line when it
  // cannot answer at all; neither is a branch name, so neither is shown.
  const branch = named.code === 0 ? mergeBranchName(named.text) : undefined;
  return branch !== undefined ? { branch } : {};
}

/** The repository's state. Not being a repository is a *state*, not a refusal. */
export async function readStatus(deps: GitRunDeps, dir: string): Promise<GitStatus> {
  const inside = await runGit(deps, dir, ["rev-parse", "--is-inside-work-tree"], { read: true });
  const isRepository = inside.code === 0 && inside.text.trim() === "true";
  const kind = detectVcsKind(dir, { gitRepository: isRepository });
  // `rev-parse` answering "no" is the normal answer for a folder git does not track; a *failed* answer for
  // any other reason is not, and the two must not be folded together.
  if (kind !== "git") {
    return { kind, detached: false, ahead: 0, behind: 0, dirty: 0, conflicted: false };
  }
  const status = await runGit(deps, dir, GIT_STATUS_ARGS, { read: true });
  if (status.code !== 0) throw gitFailed(status);
  const parsed = parseGitStatus(status.text, { kind: "git" });
  /**
   * **The merge question is asked of every repository, and the earlier "skip it when the tree is clean" was
   * wrong.** A clean tree can be mid-merge: resolving a conflict by keeping one side entirely
   * (`git checkout --ours <file> && git add <file>`) leaves `git status` empty while `MERGE_HEAD` is still
   * there — and that is a state this product's own resolve prompt invites, since it sanctions "keep one side
   * when the other is covered". With the question skipped, `GitStatus.merge` disappeared exactly then, and
   * `gitMergeContinue` and `gitMergeAbort` both answered `gitMergeNone`: the user could neither record nor take
   * back a merge they had just finished resolving.
   *
   * The cost is one `rev-parse --verify --quiet` per status read, which is milliseconds — and the fact is worth
   * more than the spawn: while a merge is open, a branch change or a stash would silently throw it away.
   */
  const merge = await mergeInProgress(deps, dir);
  return merge === undefined ? parsed : { ...parsed, merge };
}

/** One shape for the three answers that leave a repository whose state the caller must now render. */
export async function statusOf(deps: GitRunDeps, dir: string): Promise<GitStatus> {
  return await readStatus(deps, dir);
}

/**
 * The refusals a branch name can earn, worded per reason.
 *
 * Three sentences rather than one with a `{reason}` value: a user who typed nothing and a user who typed
 * something git cannot accept need different next actions, and a substituted reason reads as a machine
 * talking. `looks-like-an-option` shares the sentence about allowed characters, because that *is* the
 * advice for it.
 */
export function invalidBranch(name: string, refusal: BranchNameRefusal): Error {
  if (refusal === "empty") {
    return coderError(
      ENVOYDEV_ERRORS.gitBranchInvalid,
      "A branch needs a name.",
      ref("error.gitBranchEmpty"),
    );
  }
  if (refusal === "too-long") {
    return coderError(
      ENVOYDEV_ERRORS.gitBranchInvalid,
      "A branch name can be at most 255 characters.",
      ref("error.gitBranchTooLong", { count: 255 }),
    );
  }
  return coderError(
    ENVOYDEV_ERRORS.gitBranchInvalid,
    `"${name}" cannot be a branch name. Letters, digits, dots, dashes and slashes are allowed, and it cannot start with a dash.`,
    ref("error.gitBranchInvalid", { name }),
  );
}

/**
 * The **repository root**, which is where the changed paths are relative to.
 *
 * Measured rather than assumed, because it is not the same directory as the project: `git -C <subdir>
 * status --porcelain` answers with paths relative to the *repository* (`sub/a.txt`, not `a.txt`), so a
 * project that is itself a subdirectory of a larger repository would have every path resolved twice if the
 * write ran in the project folder. `--show-toplevel` names the directory that makes the paths mean what the
 * list says they mean.
 */
export async function gitRoot(deps: GitRunDeps, dir: string): Promise<string> {
  const root = await runGit(deps, dir, ["rev-parse", "--show-toplevel"], { read: true });
  const named = root.text.trim();
  return root.code === 0 && named !== "" ? named : dir;
}

/**
 * A list of names as a sentence value.
 *
 * The template is localised, so the *joining* rule has to be ours and language-neutral: a comma and a space is
 * what every one of the seven catalogues expects, and a list longer than a few names is truncated because a
 * refusal is read on a phone.
 */
export function listOf(names: readonly string[]): string {
  const shown = names.slice(0, 5);
  return names.length > shown.length ? `${shown.join(", ")} …` : shown.join(", ");
}

/** Git's own one-line summary, tailed: what a fetch or a pull actually brought. */
export function summaryOf(output: BoundedOutput): string {
  const lines = output.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("From "));
  return tailText(lines.slice(-3).join(" · "), 300);
}

/** The changed files, as every staging answer reports them. */
export function changesOf(dir: string): WorktreeChange[] {
  return listWorktreeChanges(dir).changes;
}

/** The conflicted paths, from the same measurement the Changes list is built from. */
export function conflictsOf(dir: string): string[] {
  return changesOf(dir)
    .filter((change) => change.kind === "conflict")
    .map((change) => change.path);
}


/** Does the repository have a commit? Only unstaging needs the answer. */
export async function hasHead(deps: GitRunDeps, dir: string): Promise<boolean> {
  const head = await runGit(deps, dir, GIT_HAS_HEAD_ARGS, { read: true });
  return head.code === 0;
}

/** Is anything staged? By exit code: 0 nothing, 1 something, anything else a failure. */
export async function hasStaged(deps: GitRunDeps, dir: string): Promise<boolean> {
  const staged = await runGit(deps, dir, GIT_HAS_STAGED_ARGS, { read: true });
  if (staged.code === 0) return false;
  if (staged.code === 1) return true;
  throw gitFailed(staged);
}

/** The stashes this repository is holding — a read, and the answer every stash write ends with. */
export async function stashesOf(deps: GitRunDeps, dir: string): Promise<GitStash[]> {
  const listed = await runGit(deps, dir, GIT_STASH_LIST_ARGS, { read: true });
  if (listed.code !== 0) throw gitFailed(listed);
  return parseGitStashList(listed.text);
}

/**
 * Everything a stash write answers with: what the repository is now, and what is still set aside.
 *
 * One shape for the three writes, because each of them leaves both a tree and a list a caller has to render
 * — and a client that had to re-read the list after a push would show the old one until it did.
 */
export async function stashAnswer(deps: GitRunDeps, root: string): Promise<{
  status: GitStatus;
  changes: WorktreeChange[];
  stashes: GitStash[];
}> {
  return {
    status: await statusOf(deps, root),
    changes: changesOf(root),
    stashes: await stashesOf(deps, root),
  };
}

/**
 * The instruction the resolving agent starts with.
 *
 * **English, and written for a program rather than for a person.** The window composes the prompts a user
 * sends; this one is the daemon's because the daemon is what knows which files conflicted and what must be
 * true when the agent stops. It is deliberately closed about what the agent may *not* do — no `commit`, no
 * `merge --abort`, no branch change — because the merge has to still be in progress when the user records it,
 * and an agent that finished the merge itself would leave the two surfaces disagreeing about the repository.
 *
 * The last line asks for the short account a person reads before recording the merge, which is the review
 * step this product exists for: the agent's work is in the working tree, and the diff is there to be read.
 */
export function resolvePrompt(input: {
  branch: string;
  into?: string;
  files: readonly string[];
}): string {
  return [
    `A merge of "${input.branch}" into "${input.into ?? "the current branch"}" stopped with conflicts in this repository. Resolve them.`,
    "",
    "Conflicted files:",
    ...input.files.map((file) => `- ${file}`),
    "",
    "For each file, read both sides of the conflict and keep the intent of both changes. A resolution that simply keeps one side is only right when the other side is already covered elsewhere — say so if that is what you did. Remove the conflict markers, then stage the file with `git add <file>` so git records the resolution.",
    "",
    "Do not run `git commit`, `git merge --abort`, `git checkout`, `git rebase` or `git stash`. The merge must still be in progress when you stop: EnvoyDev records it once every conflicted file is staged.",
    "",
    "Finish with a short paragraph: what you changed in each file, and anything a person should read before the merge is recorded.",
  ].join("\n");
}
