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
  GIT_STATUS_ARGS,
  branchNameRefusal,
  detectVcsKind,
  gitCheckoutBranchArgs,
  gitCreateBranchArgs,
  gitEnv,
  parseGitBranches,
  parseGitStatus,
  type BranchNameRefusal,
  type VcsKind,
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

/** Run git in `dir`, bounded, with the environment that keeps it from asking a question. */
async function runGit(
  deps: GitDeps,
  dir: string,
  args: readonly string[],
  options: { read: boolean },
): Promise<BoundedOutput> {
  const output = await runBounded(deps.command ?? "git", ["-C", dir, ...args], {
    env: gitEnv(process.env, { read: options.read }),
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
  };
}
