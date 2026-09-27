/**
 * Git content-bus readiness for Team jobs (§6.1 / content bus).
 *
 * Path must exist, be a git work tree, and have at least one remote — otherwise
 * peers cannot share commits. Policies are named for refuse / Start copy.
 *
 * Kept free of `jobs.ts` imports so Start/offer can call it without a cycle.
 */

import { access, constants, stat } from "node:fs/promises";

import { ENVOYDEV_ERRORS, coderError } from "@envoydev/protocol";

import { runGit, type GitRunDeps } from "./git-runner.js";
import { ref } from "./messages.js";

export const GIT_CONTENT_BUS_POLICIES = [
  "path-missing",
  "not-a-git-repo",
  "no-git-remote",
  "git-missing",
] as const;

export type GitContentBusPolicy = (typeof GIT_CONTENT_BUS_POLICIES)[number];

export type GitContentBusResult =
  | { ok: true; path: string }
  | { ok: false; policy: GitContentBusPolicy };

function isGitMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === ENVOYDEV_ERRORS.gitMissing
  );
}

/**
 * Measure whether `cwdHint` can be used as a Team job content bus root.
 */
async function resolveDir(cwdHint: string): Promise<{ ok: true; path: string } | { ok: false }> {
  try {
    const s = await stat(cwdHint);
    if (!s.isDirectory()) return { ok: false };
    await access(cwdHint, constants.R_OK);
    return { ok: true, path: cwdHint };
  } catch {
    return { ok: false };
  }
}

export async function assessGitContentBus(
  cwdHint: string,
  deps: GitRunDeps = {},
): Promise<GitContentBusResult> {
  const resolved = await resolveDir(cwdHint);
  if (!resolved.ok) return { ok: false, policy: "path-missing" };

  try {
    const inside = await runGit(deps, resolved.path, ["rev-parse", "--is-inside-work-tree"], {
      read: true,
    });
    if (!(inside.code === 0 && inside.text.trim() === "true")) {
      return { ok: false, policy: "not-a-git-repo" };
    }
    const remotes = await runGit(deps, resolved.path, ["remote"], { read: true });
    if (remotes.code !== 0) return { ok: false, policy: "not-a-git-repo" };
    if (remotes.text.trim() === "") return { ok: false, policy: "no-git-remote" };
    return { ok: true, path: resolved.path };
  } catch (error) {
    if (isGitMissingError(error)) return { ok: false, policy: "git-missing" };
    throw error;
  }
}

/** User-facing English for a policy (daemon refusal + i18n key fallback). */
export function gitContentBusMessage(policy: GitContentBusPolicy): string {
  switch (policy) {
    case "path-missing":
      return "That folder is missing on this machine. Clone the project and open it, then try again.";
    case "not-a-git-repo":
      return "That folder is not a Git repository. Team jobs share work through Git — initialize or clone a repo.";
    case "no-git-remote":
      return "This Git repository has no remote. Add origin (or another remote) so teammates can pull and push.";
    case "git-missing":
      return "Git is not installed (or not on PATH) on this machine. Install Git before accepting a Team job step.";
    default: {
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }
}

const POLICY_KEYS = {
  "path-missing": "error.job.pathMissing",
  "not-a-git-repo": "error.job.git.notARepo",
  "no-git-remote": "error.job.git.noRemote",
  "git-missing": "error.job.git.missing",
} as const satisfies Record<GitContentBusPolicy, Parameters<typeof ref>[0]>;

export function throwGitContentBus(policy: GitContentBusPolicy): never {
  throw coderError(ENVOYDEV_ERRORS.badRequest, gitContentBusMessage(policy), ref(POLICY_KEYS[policy]));
}

export function gitContentBusRef(policy: GitContentBusPolicy): Parameters<typeof ref>[0] {
  return POLICY_KEYS[policy];
}
