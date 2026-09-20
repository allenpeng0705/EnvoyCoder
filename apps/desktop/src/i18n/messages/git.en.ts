/**
 * The **git** sentences of the English catalogue, one namespace of it.
 *
 * ## Why a namespace has its own file
 *
 * The catalogues reached the family's 800-line hard cap (`scripts/check-module-size.mjs`), and its allowlist
 * records what the fix is: split the key namespaces. Git is the largest coherent one and the one this product
 * keeps growing — S1 through S5 added branches, staging, commit, merge, fetch, pull and stash — so it is the
 * namespace that moved first. The base catalogue spreads it back into place, in the position it held before,
 * because a spread in the middle of the object keeps the file's own order readable.
 *
 * A fragment is a plain `as const` object of the same sentences the base file used to carry: `MessageKey`
 * is still `keyof typeof en`, and `i18n.test.ts` still proves the seven languages agree key for key.
 */

export const git = {
  "error.gitNothingStaged": "Nothing is staged, so there is nothing to commit. Stage a file first — or stage everything and commit that.",
  "error.gitMergeConflict": "{branch} cannot be merged automatically. These files conflict: {files}. Nothing was changed — your branch and your working tree are exactly as they were.",
  "error.gitPullDiverged": "The branch on the computer and the one on the remote have both changed, so a pull cannot bring them together. Merge them, or push your branch.",
  "error.gitNothingToStash": "There is nothing to stash — no file in this folder has uncommitted changes.",
  "error.gitStashDirty": "Putting a stash back needs a clean working tree. Commit or stash the changes in this folder first.",
  "error.gitStashConflict": "This stash cannot be put back cleanly. These files conflict: {files}. Nothing was changed, and the stash is still there.",
  "git.stash.title": "Stashes",
  "git.stash.cta": "Stash",
  "git.stash.done": "Stashed.",
  "git.stash.pop": "Put back",
  "git.stash.drop": "Discard",
  "git.stash.confirm": "Discard this stash?",
  "git.stash.empty": "Nothing stashed.",
  "git.merge.into": "Merge {branch} into {current}",
  "git.merge.cta": "Merge",
  "git.merge.done": "Merged {branch} into {into}.",
  "git.fetch.nothing": "Fetched. Nothing new.",
  "git.pull.nothing": "Pulled. Already up to date.",
  "git.fetch.cta": "Fetch",
  "git.fetch.done": "Fetched. {summary}",
  "git.pull.cta": "Pull",
  "git.pull.done": "Pulled. {summary}",
  "error.gitCommitEmpty": "A commit needs a message.",
  "error.gitTimedOut": "Git did not finish in time, so EnvoyDev stopped it. The repository may be very large, or git may be waiting for something.",
  "git.branches.title": "Branches",
  "git.branches.aria": "Branches for {project}",
  "git.branches.detachedChip": "No branch",
  "git.branches.detached": "This repository is on a detached HEAD, so no branch is current.",
  "git.branches.empty": "This repository has no branches yet.",
  "git.branches.new": "New branch",
  "git.branches.name": "Branch name",
  "git.branches.create": "Create and switch",
  "git.branches.switched": "Switched to {branch}.",
  "git.branches.created": "Created {branch} and switched to it.",
  "error.gitMissing": "Git is not installed on this machine, so EnvoyDev cannot read this repository. Install git and try again.",
  "error.gitNotARepository": "\"{path}\" is not a git repository. Branches exist only for folders git tracks.",
  "error.gitBusy": "\"{title}\" is running in this project. Finish or stop it before changing branches — a checkout under a working agent loses work.",
  "error.gitFailed": "Git could not do that: {detail}",
  "error.gitBranchInvalid": "\"{name}\" cannot be a branch name. Letters, digits, dots, dashes and slashes are allowed, and it cannot start with a dash.",
  "error.gitBranchTooLong": "A branch name can be at most {count} characters.",
  "error.gitBranchEmpty": "A branch needs a name.",
} as const;
