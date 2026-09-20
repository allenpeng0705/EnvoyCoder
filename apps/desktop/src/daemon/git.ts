/**
 * Branch actions on a project's own folder — the daemon side of `coder.git*`.
 *
 * ## The property, taken from the one other place this product runs something for a user
 *
 * `coder.runFix` states it: **the client sends a name, never a command.** Here the name is a branch, a
 * project id, or nothing at all, and the argv is built in this file from `@envoydev/platform`'s builders.
 * There is no field in any request that could carry a command line, so a window — or a phone, or a mesh
 * peer, or a buggy client — cannot turn this into a shell. Reads are `../packages/platform/src/git.ts`'s
 * parsers, pure and pinned against a real repository.
 *
 * ## Why a live run refuses a write, and never a read
 *
 * An agent mid-edit and a `checkout` in the same working tree is how a user loses work, and neither
 * program can see the other: the agent is holding file handles the daemon knows nothing about, and git
 * only knows that the tree is dirty. So `coder.gitCheckout` and `coder.gitCreateBranch` refuse while a run
 * is live **anywhere in the project** — a run's own folder is inside it — and the refusal names the task,
 * because "something is running" is not something a user can act on. Reads are never refused: looking at a
 * repository is not the dangerous half, and a picker that cannot be opened during a run is a picker nobody
 * trusts.
 *
 * ## What is deliberately absent
 *
 * No `reset --hard`, no `clean -fd`, no force-push, no rebase: each of them destroys work that git cannot
 * get back, and each of them needs a confirmation that names what is about to be lost — which is a
 * conversation, not a method. No `fetch`/`pull`/`push` either: those need credentials, and a credential
 * story that is honest about ssh and the user's own helper is the next slice rather than this one.
 */

import { spawn as nodeSpawn } from "node:child_process";

import {
  GIT_BRANCHES_ARGS,
  GIT_FETCH_ARGS,
  GIT_HAS_HEAD_ARGS,
  GIT_HAS_STAGED_ARGS,
  GIT_MERGE_ABORT_ARGS,
  GIT_PULL_ARGS,
  GIT_STATUS_ARGS,
  branchNameRefusal,
  currentSearchPath,
  detectVcsKind,
  gitCheckoutBranchArgs,
  gitCommitArgs,
  gitCreateBranchArgs,
  gitEnv,
  gitMergeArgs,
  gitStageArgs,
  gitUnstageArgs,
  listWorktreeChanges,
  parseGitBranches,
  parseGitStatus,
  type BranchNameRefusal,
  type VcsKind,
  type WorktreeChange,
} from "@envoydev/platform";
import {
  ENVOYDEV_ERRORS,
  coderError,
  parseRpcParams,
  type GitStatus,
  type RpcMethod,
} from "@envoydev/protocol";

import { runBounded, tailText, type BoundedOutput } from "./bounded-process.js";
import { ref } from "./messages.js";
import { notFound } from "./not-found.js";
import type { RunManager } from "./runs.js";
import type { CoderHandler } from "./service.js";
import type { CoderStore } from "./store.js";

/** A read. `git status` on a very large repository is the slow case, and it is still a read. */
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
const NOTHING_STAGED_SENTENCE =
  "Nothing is staged, so there is nothing to commit. Stage a file first — or stage everything and commit that.";
const COMMIT_EMPTY_SENTENCE = "A commit needs a message.";
const PULL_DIVERGED_SENTENCE =
  "The branch on the computer and the one on the remote have both changed, so a pull cannot bring them together. Merge them, or push your branch.";

export interface GitHandlerDeps {
  store: CoderStore;
  /**
   * The runs, so a write can refuse while an agent is working in the same folder.
   *
   * Structural rather than the whole manager: this file needs one question answered ("is this task
   * running") and nothing else, and a daemon built without a runtime simply has nothing running.
   */
  runs?: Pick<RunManager, "liveFor">;
  /** Injectable for tests; the daemon passes the real `spawn`. */
  spawn?: typeof nodeSpawn;
  /** The program to run. `git`, and injectable so a test can prove what "not installed" says. */
  command?: string;
  /**
   * The environment the git children start from — this daemon's own, unless a test says otherwise.
   *
   * Injected for the one case that cannot be arranged any other way: **a machine with no author identity**.
   * Git refuses a commit then, with a sentence naming the `git config` to run, and that refusal is one a
   * fresh install really meets — so it is proven here with an empty `HOME` rather than assumed.
   */
  env?: () => NodeJS.ProcessEnv;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
}

export type GitDeps = Omit<GitHandlerDeps, "store" | "runs">;

/** The refusal for a failed command, with git's own sentence as the detail. */
function gitFailed(output: BoundedOutput): Error {
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
export async function measureProjectVcs(deps: GitDeps, dir: string): Promise<VcsKind> {
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
function gitChildEnv(deps: GitDeps, read: boolean): NodeJS.ProcessEnv {
  const search = currentSearchPath();
  return gitEnv(deps.env?.() ?? process.env, {
    read,
    ...(search.searchable ? { path: search.path } : {}),
    ...(search.sshAuthSock !== undefined ? { sshAuthSock: search.sshAuthSock } : {}),
  });
}

/** Run git in `dir`, bounded, with the environment that keeps it from asking a question. */
async function runGit(
  deps: GitDeps,
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

/** The repository's state. Not being a repository is a *state*, not a refusal. */
async function readStatus(deps: GitDeps, dir: string): Promise<GitStatus> {
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
  return parseGitStatus(status.text, { kind: "git" });
}

/** One shape for the three answers that leave a repository whose state the caller must now render. */
async function statusOf(deps: GitDeps, dir: string): Promise<GitStatus> {
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
function invalidBranch(name: string, refusal: BranchNameRefusal): Error {
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
async function gitRoot(deps: GitDeps, dir: string): Promise<string> {
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
function listOf(names: readonly string[]): string {
  const shown = names.slice(0, 5);
  return names.length > shown.length ? `${shown.join(", ")} …` : shown.join(", ");
}

/** Git's own one-line summary, tailed: what a fetch or a pull actually brought. */
function summaryOf(output: BoundedOutput): string {
  const lines = output.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("From "));
  return tailText(lines.slice(-3).join(" · "), 300);
}

/** The changed files, as every staging answer reports them. */
function changesOf(dir: string): WorktreeChange[] {
  return listWorktreeChanges(dir).changes;
}

/** Does the repository have a commit? Only unstaging needs the answer. */
async function hasHead(deps: GitDeps, dir: string): Promise<boolean> {
  const head = await runGit(deps, dir, GIT_HAS_HEAD_ARGS, { read: true });
  return head.code === 0;
}

/** Is anything staged? By exit code: 0 nothing, 1 something, anything else a failure. */
async function hasStaged(deps: GitDeps, dir: string): Promise<boolean> {
  const staged = await runGit(deps, dir, GIT_HAS_STAGED_ARGS, { read: true });
  if (staged.code === 0) return false;
  if (staged.code === 1) return true;
  throw gitFailed(staged);
}

/** One handler table, ready to spread into the daemon's. */
export function createGitHandlers(deps: GitHandlerDeps): Partial<Record<RpcMethod, CoderHandler>> {
  const projectFor = (projectId: string) => {
    const project = deps.store.findProject(projectId);
    if (!project) throw notFound("project", projectId);
    return project;
  };

  /** The repository, or the refusal that says why there is nothing to do. */
  const repositoryFor = async (path: string): Promise<void> => {
    const status = await statusOf(deps, path);
    if (status.kind === "git") return;
    throw coderError(
      ENVOYDEV_ERRORS.gitNotARepository,
      `"${path}" is not a git repository. Branches exist only for folders git tracks.`,
      ref("error.gitNotARepository", { path }),
    );
  };

  /**
   * Refuse a write while an agent is working anywhere in this project.
   *
   * The task's *title* is the value, not its id: the sentence is for a person deciding whether to stop it.
   */
  const refuseWhileRunning = (projectId: string): void => {
    for (const task of deps.store.tasks({ projectId })) {
      if (deps.runs?.liveFor(task.id) === undefined) continue;
      throw coderError(
        ENVOYDEV_ERRORS.gitBusy,
        `"${task.title}" is running in this project. Finish or stop it before changing branches — a checkout under a working agent loses work.`,
        ref("error.gitBusy", { title: task.title }),
      );
    }
  };

  return {
    "coder.gitStatus": async (params) => {
      const input = parseRpcParams("coder.gitStatus", params) as { projectId: string };
      return await statusOf(deps, projectFor(input.projectId).path);
    },

    "coder.gitBranches": async (params) => {
      const input = parseRpcParams("coder.gitBranches", params) as { projectId: string };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);

      const listed = await runGit(deps, project.path, GIT_BRANCHES_ARGS, { read: true });
      if (listed.code !== 0) throw gitFailed(listed);
      const branches = parseGitBranches(listed.text);
      // Detached HEAD lists a pseudo-entry marked current, which the parser drops — so "nothing is current"
      // is exactly the state a client needs named.
      return { branches, detached: !branches.some((branch) => branch.current) };
    },

    "coder.gitCheckout": async (params) => {
      const input = parseRpcParams("coder.gitCheckout", params) as {
        projectId: string;
        branch: string;
      };
      const project = projectFor(input.projectId);

      const refusal = branchNameRefusal(input.branch);
      if (refusal !== undefined) throw invalidBranch(input.branch, refusal);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);

      const switched = await runGit(deps, project.path, gitCheckoutBranchArgs(input.branch), {
        read: false,
      });
      // Git's own refusal is the honest one here: only git knows whether the switch would overwrite an
      // uncommitted change, and it says which file.
      if (switched.code !== 0) throw gitFailed(switched);
      return await statusOf(deps, project.path);
    },

    "coder.gitStage": async (params) => {
      const input = parseRpcParams("coder.gitStage", params) as {
        projectId: string;
        paths: readonly string[];
      };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);
      const root = await gitRoot(deps, project.path);

      const staged = await runGit(deps, root, gitStageArgs(input.paths), { read: false });
      // A path outside the repository, a path that no longer exists: git names the file, and that sentence is
      // more useful than anything this layer could invent about it.
      if (staged.code !== 0) throw gitFailed(staged);
      return { changes: changesOf(project.path) };
    },

    "coder.gitUnstage": async (params) => {
      const input = parseRpcParams("coder.gitUnstage", params) as {
        projectId: string;
        paths: readonly string[];
      };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);
      const root = await gitRoot(deps, project.path);

      // Two shapes, and which one is right is a fact about the repository: `reset HEAD` needs a HEAD, and the
      // first commit of a project made here has none (see `gitUnstageArgs`).
      const unstaged = await runGit(
        deps,
        root,
        gitUnstageArgs(input.paths, { hasHead: await hasHead(deps, root) }),
        { read: false },
      );
      if (unstaged.code !== 0) throw gitFailed(unstaged);
      return { changes: changesOf(project.path) };
    },

    "coder.gitCommit": async (params) => {
      const input = parseRpcParams("coder.gitCommit", params) as { projectId: string; message: string };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);
      // The paths the index is relative to, and the directory the commit runs in.
      const root = await gitRoot(deps, project.path);

      // **The message is checked here, in the user's language**, rather than by letting git say
      // "Aborting commit due to empty commit message" — which is a sentence about an internal step.
      if (input.message.trim() === "") {
        throw coderError(ENVOYDEV_ERRORS.gitCommitEmpty, COMMIT_EMPTY_SENTENCE, ref("error.gitCommitEmpty"));
      }
      // And an empty index is a state to name, not a failure to relay: git's own words for it read as a
      // complaint about the work.
      if (!(await hasStaged(deps, root))) {
        throw coderError(
          ENVOYDEV_ERRORS.gitNothingStaged,
          NOTHING_STAGED_SENTENCE,
          ref("error.gitNothingStaged"),
        );
      }

      const committed = await runGit(deps, root, gitCommitArgs(input.message), { read: false });
      // A missing author identity, a failing pre-commit hook, a signing key: git's own sentence is the detail,
      // and it names the exact `git config` or key a person has to fix.
      if (committed.code !== 0) throw gitFailed(committed);

      const sha = await runGit(deps, root, ["rev-parse", "HEAD"], { read: true });
      return {
        sha: sha.text.trim(),
        status: await statusOf(deps, project.path),
        changes: changesOf(project.path),
      };
    },

    "coder.gitCreateBranch": async (params) => {
      const input = parseRpcParams("coder.gitCreateBranch", params) as {
        projectId: string;
        name: string;
      };
      const project = projectFor(input.projectId);

      const refusal = branchNameRefusal(input.name);
      if (refusal !== undefined) throw invalidBranch(input.name, refusal);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);

      const created = await runGit(deps, project.path, gitCreateBranchArgs(input.name), {
        read: false,
      });
      if (created.code !== 0) throw gitFailed(created);
      return await statusOf(deps, project.path);
    },
    "coder.gitMerge": async (params) => {
      const input = parseRpcParams("coder.gitMerge", params) as {
        projectId: string;
        branch: string;
        message?: string;
      };
      const project = projectFor(input.projectId);

      const refusal = branchNameRefusal(input.branch);
      if (refusal !== undefined) throw invalidBranch(input.branch, refusal);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);
      const root = await gitRoot(deps, project.path);

      // The branch being merged *into*, measured before the merge for the sentence that names it.
      const into = (await statusOf(deps, root)).branch;

      const merged = await runGit(
        deps,
        root,
        gitMergeArgs(input.branch, input.message !== undefined ? { message: input.message } : {}),
        { read: false },
      );

      if (merged.code !== 0) {
        /**
         * **A conflict is undone, and then refused with the files.**
         *
         * This window cannot resolve a conflict, so leaving one behind would leave a repository the user has
         * to finish somewhere else — `MERGE_HEAD` in the folder, a half-applied merge, and no surface here
         * that could finish or abandon it. Undoing it means the refusal is a *statement about an attempt*:
         * nothing moved, and here is what would have to be resolved.
         *
         * Whether it was a conflict at all is measured rather than read out of git's message (which is
         * localised and versioned): `git status` reports unmerged entries as `conflict`, and that is our own
         * parser.
         */
        const conflicted = changesOf(root).filter((change) => change.kind === "conflict");
        if (conflicted.length > 0) {
          const files = conflicted.map((change) => change.path);
          await runGit(deps, root, GIT_MERGE_ABORT_ARGS, { read: false });
          throw coderError(
            ENVOYDEV_ERRORS.gitMergeConflict,
            `${input.branch} cannot be merged automatically. These files conflict: ${files.join(", ")}. Nothing was changed — your branch and your working tree are exactly as they were.`,
            ref("error.gitMergeConflict", { branch: input.branch, files: listOf(files) }),
          );
        }
        // Nothing was started — a local change the merge would overwrite, a branch that is not there. Git's
        // own sentence names the file or the ref.
        throw gitFailed(merged);
      }

      const sha = await runGit(deps, root, ["rev-parse", "HEAD"], { read: true });
      return {
        sha: sha.text.trim(),
        ...(into !== undefined ? { into } : {}),
        status: await statusOf(deps, root),
        changes: changesOf(root),
      };
    },

    "coder.gitFetch": async (params) => {
      const input = parseRpcParams("coder.gitFetch", params) as { projectId: string };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      // **A read, as far as this project is concerned**: a fetch moves remote-tracking refs and leaves the
      // working tree alone, so it is allowed while a run is live — asking "is there anything new" is not a
      // reason to force a user to stop their agent.
      const root = await gitRoot(deps, project.path);

      const fetched = await runGit(deps, root, GIT_FETCH_ARGS, { read: false });
      // No credentials, no remote, no network: git says which, and its sentence names the remote. This is the
      // first action here that can need a credential at all, which is why it is the first that can fail for a
      // reason about the *user's* machine rather than about the repository.
      if (fetched.code !== 0) throw gitFailed(fetched);
      return { status: await statusOf(deps, root), summary: summaryOf(fetched) };
    },

    "coder.gitPull": async (params) => {
      const input = parseRpcParams("coder.gitPull", params) as { projectId: string };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      // A write: a fast-forward *moves the branch* and rewrites the working tree.
      refuseWhileRunning(project.id);
      const root = await gitRoot(deps, project.path);

      const pulled = await runGit(deps, root, GIT_PULL_ARGS, { read: false });
      if (pulled.code !== 0) {
        // **`--ff-only` refusing is not a failure**, it is the two histories having diverged — and the choice
        // that follows (merge, or push) belongs to the user, so the sentence says which situation this is
        // rather than relaying git's `Not possible to fast-forward, aborting.`
        const status = await statusOf(deps, root);
        if (status.behind > 0 && status.ahead > 0) {
          throw coderError(ENVOYDEV_ERRORS.gitPullDiverged, PULL_DIVERGED_SENTENCE, ref("error.gitPullDiverged"));
        }
        throw gitFailed(pulled);
      }
      return {
        status: await statusOf(deps, root),
        changes: changesOf(root),
        summary: summaryOf(pulled),
      };
    },
  };
}
