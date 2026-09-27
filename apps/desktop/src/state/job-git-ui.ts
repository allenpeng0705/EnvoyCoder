/**
 * Git content-bus copy shared by Team job create + Job pane Start gate.
 *
 * One mapping so create sheet and Job pane never disagree on “why Git blocked Start”.
 */

import type { MessageKey } from "../i18n/messages/en.js";

export const GIT_UI_POLICIES = [
  "checking",
  "ok",
  "path-missing",
  "not-a-git-repo",
  "no-git-remote",
  "git-missing",
  "cwd-missing",
] as const;

export type GitUiPolicy = (typeof GIT_UI_POLICIES)[number];

const ASSESS_POLICIES = [
  "path-missing",
  "not-a-git-repo",
  "no-git-remote",
  "git-missing",
] as const satisfies ReadonlyArray<Exclude<GitUiPolicy, "checking" | "ok" | "cwd-missing">>;

export type GitAssessPolicy = (typeof ASSESS_POLICIES)[number];

export function isGitUiReady(policy: GitUiPolicy): boolean {
  return policy === "ok";
}

/** i18n key for a Git readiness line (create sheet + Job pane Fix crew). */
export function gitUiMessageKey(policy: GitUiPolicy): MessageKey {
  switch (policy) {
    case "checking":
      return "teamJob.git.checking";
    case "ok":
      return "teamJob.git.ok";
    case "path-missing":
      return "teamJob.git.pathMissing";
    case "not-a-git-repo":
      return "teamJob.git.notARepo";
    case "no-git-remote":
      return "teamJob.git.noRemote";
    case "git-missing":
      return "teamJob.git.missing";
    case "cwd-missing":
      return "job.pane.crew.gitBlocked";
    default: {
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }
}

function isAssessPolicy(value: string): value is GitAssessPolicy {
  return (ASSESS_POLICIES as readonly string[]).includes(value);
}

/** Map an `assessGitContentBus` answer onto UI policy (RPC refusal → git-missing). */
export function gitUiFromAssess(
  result:
    | { ok: true }
    | { ok: false; policy?: string }
    | { ok: false; message: string },
): Exclude<GitUiPolicy, "checking" | "cwd-missing"> {
  if (result.ok === true) return "ok";
  if ("policy" in result && typeof result.policy === "string" && isAssessPolicy(result.policy)) {
    return result.policy;
  }
  return "git-missing";
}
