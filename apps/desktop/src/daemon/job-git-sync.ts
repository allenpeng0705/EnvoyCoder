/**
 * Team job Git handoff — pull / branch / push around a step on the content bus.
 *
 * Kept separate from `job-git-readiness.ts` (path+remote checks) and from the
 * project-scoped `coder.git*` handlers so accept/complete paths can call it
 * with a resolved cwd without a project id.
 */

import {
  GIT_FETCH_ARGS,
  GIT_PULL_ARGS,
  branchNameRefusal,
  gitCheckoutBranchArgs,
  gitCreateBranchArgs,
  gitPushArgs,
} from "@envoydev/platform";

import type { MessageKey } from "../i18n/messages/en.js";
import { runGit, statusOf, type GitRunDeps } from "./git-runner.js";

export const JOB_GIT_SYNC_POLICIES = [
  "dirty",
  "pull-diverged",
  "pull-failed",
  "branch-invalid",
  "branch-failed",
  "push-failed",
  "git-missing",
] as const;

export type JobGitSyncPolicy = (typeof JOB_GIT_SYNC_POLICIES)[number];

export type JobGitSyncResult =
  | { ok: true; summary?: string }
  | { ok: false; policy: JobGitSyncPolicy; message: string };

function isGitMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code: unknown }).code).includes("git-missing")
  );
}

export function jobGitSyncMessage(policy: JobGitSyncPolicy): string {
  switch (policy) {
    case "dirty":
      return "This folder has uncommitted changes. Commit or stash them before accepting the Team job step.";
    case "pull-diverged":
      return "Local and remote branches have both changed, so a fast-forward pull cannot bring them together.";
    case "pull-failed":
      return "Git pull failed. Check the remote and your credentials, then try again.";
    case "branch-invalid":
      return "That branch name is not valid for Git.";
    case "branch-failed":
      return "Could not check out or create the step branch.";
    case "push-failed":
      return "Git push failed. Check the remote and your credentials, then try again.";
    case "git-missing":
      return "Git is not installed (or not on PATH) on this machine.";
    default: {
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }
}

/** Catalogue key for a sync refusal — never map all policies to no-remote. */
export function jobGitSyncRef(policy: JobGitSyncPolicy): MessageKey {
  switch (policy) {
    case "dirty":
      return "error.job.git.syncDirty";
    case "pull-diverged":
      return "error.job.git.syncDiverged";
    case "pull-failed":
      return "error.job.git.syncPullFailed";
    case "branch-invalid":
      return "error.job.git.syncBranchInvalid";
    case "branch-failed":
      return "error.job.git.syncBranchFailed";
    case "push-failed":
      return "error.job.git.syncPushFailed";
    case "git-missing":
      return "error.job.git.missing";
    default: {
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }
}

/** Whether the job policy asks for a pull (default true). */
export function shouldPullOnAccept(contentBus: { pullOnAccept?: boolean } | undefined): boolean {
  return contentBus?.pullOnAccept !== false;
}

/** Whether the job policy asks for a push after success (default false). */
export function shouldPushOnSuccess(contentBus: { pushOnSuccess?: boolean } | undefined): boolean {
  return contentBus?.pushOnSuccess === true;
}

/**
 * Prepare the working tree for a step: refuse dirty, fetch when pulling,
 * check out / create the step branch, then fast-forward that branch when possible.
 */
export async function prepareStepWorkingTree(input: {
  cwd: string;
  branch?: string;
  pullOnAccept: boolean;
  deps?: GitRunDeps;
}): Promise<JobGitSyncResult> {
  const deps = input.deps ?? {};
  try {
    const branch = input.branch?.trim();
    if (branch) {
      const refusal = branchNameRefusal(branch);
      if (refusal) {
        return { ok: false, policy: "branch-invalid", message: jobGitSyncMessage("branch-invalid") };
      }
    }

    const before = await statusOf(deps, input.cwd);
    if (before.dirty > 0 || before.conflicted) {
      return { ok: false, policy: "dirty", message: jobGitSyncMessage("dirty") };
    }

    if (input.pullOnAccept) {
      const fetched = await runGit(deps, input.cwd, GIT_FETCH_ARGS, { read: false });
      if (fetched.code !== 0) {
        // Fetch can fail offline; only hard-fail when we later cannot pull an existing upstream.
      }
    }

    if (branch) {
      const remoteTip = await runGit(
        deps,
        input.cwd,
        ["rev-parse", "--verify", `refs/remotes/origin/${branch}`],
        { read: true },
      );
      const checkout = await runGit(deps, input.cwd, gitCheckoutBranchArgs(branch), { read: false });
      if (checkout.code !== 0) {
        if (remoteTip.code === 0) {
          const track = await runGit(
            deps,
            input.cwd,
            ["checkout", "--track", "-b", branch, `origin/${branch}`],
            { read: false },
          );
          if (track.code !== 0) {
            return { ok: false, policy: "branch-failed", message: jobGitSyncMessage("branch-failed") };
          }
        } else {
          const created = await runGit(deps, input.cwd, gitCreateBranchArgs(branch), { read: false });
          if (created.code !== 0) {
            return { ok: false, policy: "branch-failed", message: jobGitSyncMessage("branch-failed") };
          }
        }
      }
    }

    if (input.pullOnAccept) {
      const upstream = await runGit(
        deps,
        input.cwd,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        { read: true },
      );
      if (upstream.code === 0) {
        const pulled = await runGit(deps, input.cwd, GIT_PULL_ARGS, { read: false });
        if (pulled.code !== 0) {
          const after = await statusOf(deps, input.cwd);
          if (after.behind > 0 && after.ahead > 0) {
            return { ok: false, policy: "pull-diverged", message: jobGitSyncMessage("pull-diverged") };
          }
          return { ok: false, policy: "pull-failed", message: jobGitSyncMessage("pull-failed") };
        }
      }
      // New local branch with no upstream yet: pull is a no-op — accept proceeds.
    }

    return { ok: true };
  } catch (error) {
    if (isGitMissingError(error)) {
      return { ok: false, policy: "git-missing", message: jobGitSyncMessage("git-missing") };
    }
    throw error;
  }
}

/** Push current HEAD to the remote (default origin). */
export async function pushStepWorkingTree(input: {
  cwd: string;
  remote?: string;
  refspec?: string;
  deps?: GitRunDeps;
}): Promise<JobGitSyncResult> {
  const deps = input.deps ?? {};
  try {
    const pushed = await runGit(
      deps,
      input.cwd,
      gitPushArgs(input.remote ?? "origin", input.refspec ?? "HEAD"),
      { read: false },
    );
    if (pushed.code !== 0) {
      return { ok: false, policy: "push-failed", message: jobGitSyncMessage("push-failed") };
    }
    return { ok: true, summary: pushed.text.trim().slice(0, 500) };
  } catch (error) {
    if (isGitMissingError(error)) {
      return { ok: false, policy: "git-missing", message: jobGitSyncMessage("git-missing") };
    }
    throw error;
  }
}
