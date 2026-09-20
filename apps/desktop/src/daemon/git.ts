/**
 * The git methods a client calls — the daemon side of `coder.git*`.
 *
 * ## The property, taken from the one other place this product runs something for a user
 *
 * `coder.runFix` states it: **the client sends a name, never a command.** Here the name is a branch, a path,
 * a project id, a stash number, or nothing at all, and the argv is built from `@envoydev/platform`'s builders.
 * There is no field in any request that could carry a command line, so a window — or a phone, or a mesh peer,
 * or a buggy client — cannot turn this into a shell. The parsers are that module's too, pure and pinned against
 * a real repository; what starts the children and measures a repository is `git-runner.ts` next door, which is
 * also where the two refusals about *starting* git (`gitMissing`, `gitTimedOut`) come from.
 *
 * ## Two rules, and they are not the same rule
 *
 * **One writer at a time.** An agent mid-edit and a `checkout` in the same working tree is how a user loses
 * work, and neither program can see the other: the agent holds file handles the daemon knows nothing about,
 * and git only knows that the tree is dirty. So **a command that would move the working tree or a branch is
 * refused while a run is live anywhere in the project** (a run's own folder is inside it), and the refusal
 * names the task, because "something is running" is not something a user can act on.
 *
 *   * refused while a run is live: `gitCheckout`, `gitCreateBranch`, `gitMerge`, `gitMergeResolve`,
 *     `gitMergeContinue`, `gitMergeAbort`, `gitPull`, `gitStage`, `gitUnstage`, `gitCommit`, `gitStashPush`
 *     and `gitStashPop`;
 *   * allowed: `gitStatus`, `gitBranches`, `gitStashList`, `gitFetch`, `gitStashDrop` and the diff read
 *     (`coder.readWorktreeDiff`, served by `service.ts`) — looking is not the dangerous half, a fetch moves
 *     only remote-tracking refs, and dropping a stash moves no branch and no file.
 *
 * **An unfinished operation is finished or taken back first**, and that rule keys on the *merge*, not on
 * conflicts: with every conflict staged git allows `checkout`, `checkout -b` and `stash push`, and each of them
 * deletes `MERGE_HEAD`, so a resolution nobody has recorded disappears. `gitStage`, `gitUnstage`, `gitCommit`,
 * `gitMergeContinue` (once nothing is unmerged) and `gitMergeAbort` are deliberately exempt: they are how a
 * person, or an agent, finishes the job.
 *
 * ## The one method that leaves a repository mid-operation
 *
 * `gitMergeResolve` keeps a conflict on purpose so an agent can resolve it, which is honest only because
 * `gitMergeContinue` and `gitMergeAbort` are the two ways out, `GitStatus.merge` says so on every surface, and
 * the method refuses *before* merging when there is no runtime to hand the conflict to. `gitMerge` is its
 * opposite: the merge a person asked for directly aborts on conflict and refuses, so its refusal is a
 * statement about an attempt rather than a repository left behind.
 *
 * ## What is deliberately absent
 *
 * No force-push, no rebase, no `push`, and no `reset --hard` as a *user* action: the first three destroy work
 * git cannot get back, and each needs a confirmation that names what is about to be lost — which is a
 * conversation, not a method. The one `reset --hard` the daemon runs is not a user action at all: it is
 * `gitStashPop` taking back a *pop it just made onto a tree it measured as clean*, and `platform/git.ts`
 * records why that is exact. Credentials are not this file's business either: a `fetch`/`pull` runs with the
 * user's own git and helper, which is the whole credential story this product has.
 */

import {
  GIT_BRANCHES_ARGS,
  GIT_FETCH_ARGS,
  GIT_MERGE_ABORT_ARGS,
  GIT_MERGE_CONTINUE_ARGS,
  GIT_PULL_ARGS,
  GIT_STASH_PUSH_ARGS,
  GIT_STASH_POP_UNDO_ARGS,
  GIT_STASH_POP_UNDO_CLEAN_ARGS,
  branchNameRefusal,
  gitCheckoutBranchArgs,
  gitCommitArgs,
  gitCreateBranchArgs,
  gitMergeArgs,
  gitStageArgs,
  gitStashDropArgs,
  gitStashPopArgs,
  gitUnstageArgs,
  parseGitBranches,
  type BranchNameRefusal,
} from "@envoydev/platform";
import {
  ENVOYDEV_ERRORS,
  coderError,
  coderErrorMessage,
  parseRpcParams,
  type GitStatus,
  type RpcMethod,
} from "@envoydev/protocol";

import type { BoundedOutput } from "./bounded-process.js";
import {
  changesOf,
  conflictsOf,
  gitFailed,
  gitRoot,
  hasHead,
  hasStaged,
  invalidBranch,
  listOf,
  measureProjectVcs,
  readStatus,
  runGit,
  resolvePrompt,
  stashAnswer,
  statusOf,
  stashesOf,
  summaryOf,
  type GitRunDeps,
} from "./git-runner.js";
import { ref } from "./messages.js";

/**
 * The English sentences, byte-identical to the catalogue's.
 *
 * Duplicated on purpose, exactly as `service.ts` duplicates its own: the sentence is the wire's fallback and
 * the log line, and `daemon-errors-i18n.test.ts` compares the two so they cannot drift. The two the *runner*
 * raises (`gitMissing`, `gitTimedOut`) travel with it, because they are about starting a child rather than
 * about a method.
 */
const NOTHING_STAGED_SENTENCE =
  "Nothing is staged, so there is nothing to commit. Stage a file first — or stage everything and commit that.";
const COMMIT_EMPTY_SENTENCE = "A commit needs a message.";
const PULL_DIVERGED_SENTENCE =
  "The branch on the computer and the one on the remote have both changed, so a pull cannot bring them together. Merge them, or push your branch.";
const NOTHING_TO_STASH_SENTENCE =
  "There is nothing to stash — no file in this folder has uncommitted changes.";
const STASH_DIRTY_SENTENCE =
  "Putting a stash back needs a clean working tree. Commit or stash the changes in this folder first.";
import { notFound } from "./not-found.js";
import type { RunManager } from "./runs.js";
import type { CoderHandler } from "./service.js";
import type { CoderStore } from "./store.js";

// Re-exported because this is the module a caller reaches for: the runner and the measurements are the
// implementation of these methods, not a second thing to know about.
export { measureProjectVcs } from "./git-runner.js";

/** A read. `git status` on a very large repository is the slow case, and it is still a read. */
export interface GitHandlerDeps extends GitRunDeps {
  store: CoderStore;
  /**
   * The runs, so a write can refuse while an agent is working in the same folder — and, for
   * `coder.gitMergeResolve`, so an agent can be *started* on a conflict.
   *
   * `liveFor` is what every daemon with a runtime has; `start` is optional because the two facts are
   * different: a daemon built without any runtime has no `runs` at all (and `gitMergeResolve` refuses by
   * name), while the tests that only exercise the busy rule hand in a `liveFor` and nothing else. Structural
   * rather than the whole manager, which is what the read side needs and no more.
   */
  runs?: Pick<RunManager, "liveFor"> & { start?: RunManager["start"] };
  // The injected spawn, program, environment and deadlines are `GitRunDeps`, which the runner publishes:
  // this interface adds the two things only a *handler* needs — where projects live, and what is running.
}

export type GitDeps = Omit<GitHandlerDeps, "store" | "runs">;

/**
 * Refuse anything a **conflicted** repository must not do, naming the files and the way out.
 *
 * Two situations, because the advice differs and the difference is measurable:
 *
 *   * a **merge** is in progress (`MERGE_HEAD`) — this product can finish it or abort it, so the sentence
 *     points at those;
 *   * conflicts without one — a rebase or cherry-pick somebody started in their terminal. EnvoyDev has no
 *     control that could finish or undo that, and saying otherwise would be offering a button that is not
 *     there.
 *
 * The rule needs stating because git's own behaviour is **not** uniform: `git checkout` and `git merge` refuse
 * on their own, but **`git checkout -b <name>` succeeds**, carrying the half-finished merge onto a branch the
 * user never asked for it on. That is the case this exists for; the others get a sentence in the user's
 * language instead of git's `you need to resolve your current index first`.
 */
function refuseWhileConflicted(status: GitStatus, files: readonly string[]): void {
  const list = files.join(", ");
  const shown = listOf(files);
  if (status.merge !== undefined) {
    /**
     * **A merge in progress is refused what would throw it away, whether or not its conflicts are resolved.**
     * With every conflict staged `git status` is clean, and git then *allows* `checkout`, `checkout -b` and
     * `stash push` — and each of them **deletes `MERGE_HEAD`**, so a resolution nobody has recorded disappears
     * without a word. It is also the state in which the user is about to press *Finish*, which is why it gets
     * the sentence the window's own block shows rather than the one about conflicts.
     */
    throw coderError(
      ENVOYDEV_ERRORS.gitMergeUnresolved,
      files.length === 0
        ? "All conflicts are resolved. Finish the merge to record it."
        : `A merge is not finished: ${list} still has conflicts. Resolve them and finish the merge, or abort it.`,
      files.length === 0 ? ref("git.merge.resolved") : ref("error.gitMergeUnresolved", { files: shown }),
    );
  }
  if (!status.conflicted) return;
  throw coderError(
    ENVOYDEV_ERRORS.gitConflicted,
    `This repository has unresolved conflicts in ${list}, from an operation EnvoyDev did not start. Finish or undo it there before doing anything else here.`,
    ref("error.gitConflicted", { files: shown }),
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

  /**
   * The unfinished-operation rule, with the paths measured only when there is something to name.
   *
   * **The gate is the merge, not the conflicts.** Keying it on `conflicted` was the hole two reviewers measured
   * independently: with every conflict staged, `conflicted` is false while `MERGE_HEAD` is still there, and git
   * then allows the three actions that silently delete it.
   */
  const refuseConflict = (dir: string, status: GitStatus): void => {
    if (!status.conflicted && status.merge === undefined) return;
    refuseWhileConflicted(status, conflictsOf(dir));
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
      // Git refuses a switch with a conflicted index on its own, but with `you need to resolve your current
      // index first` — a sentence about an index rather than about the merge the user has to finish.
      refuseConflict(project.path, await statusOf(deps, project.path));

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
      /**
       * **This one git would allow**, and that is the whole reason the check is here: `git checkout -b <name>`
       * succeeds in a repository with a conflicted index, so a merge part-way through would follow the user
       * onto a new branch — a branch they never asked to carry it, with `MERGE_HEAD` intact and the conflicted
       * files staged against the old one.
       */
      refuseConflict(project.path, await statusOf(deps, project.path));

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

      // The branch being merged *into*, measured before the merge for the sentence that names it — and the
      // measurement that also refuses a merge while another one is unfinished.
      const before = await statusOf(deps, root);
      refuseConflict(root, before);
      const into = before.branch;

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

    /**
     * The merge a person asks for **only if an agent can resolve a conflict**: the one place in this product
     * that knowingly leaves a repository mid-operation.
     *
     * Everything about the order below is a promise to the user:
     *
     *   1. a merge already in progress is refused before anything is run — the way out of one is `Continue` or
     *      `Abort`, not a second merge;
     *   2. **the agent runtime is checked before the merge is started**, so this can never leave a conflicted
     *      repository with nobody to hand it to;
     *   3. a merge that goes through cleanly is *not* a resolution: the answer says `merged`, and no task is
     *      created for work that does not exist;
     *   4. a conflict creates the task and starts the run, and if the agent cannot be started the merge is
     *      **taken back** and the refusal says so — the press changed nothing.
     */
    "coder.gitMergeResolve": async (params) => {
      const input = parseRpcParams("coder.gitMergeResolve", params) as {
        projectId: string;
        branch: string;
      };
      const project = projectFor(input.projectId);

      const refusal = branchNameRefusal(input.branch);
      if (refusal !== undefined) throw invalidBranch(input.branch, refusal);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);
      const root = await gitRoot(deps, project.path);

      const before = await statusOf(deps, root);
      refuseConflict(root, before);

      // **Before the merge, not after it.** A daemon without an agent runtime cannot resolve anything, and
      // the honest moment to say so is while there is still nothing to clean up.
      const runs = deps.runs;
      if (runs?.start === undefined) {
        throw coderError(
          ENVOYDEV_ERRORS.harnessFailed,
          "This daemon was started without an agent runtime, so it cannot run tasks.",
          ref("error.noRunRuntime"),
        );
      }

      const merged = await runGit(deps, root, gitMergeArgs(input.branch), { read: false });
      if (merged.code === 0) {
        const sha = await runGit(deps, root, ["rev-parse", "HEAD"], { read: true });
        return {
          outcome: "merged" as const,
          sha: sha.text.trim(),
          ...(before.branch !== undefined ? { into: before.branch } : {}),
          status: await statusOf(deps, root),
          changes: changesOf(root),
        };
      }

      const files = conflictsOf(root);
      if (files.length === 0) {
        /**
         * Nothing was started — a local change the merge would overwrite, a branch that is not there. Anything
         * half-done is taken back first, because this answer promises a repository that did not move — **but
         * only a merge this call started**: the rule above refuses an open merge, so `before.merge` is
         * `undefined` here, and the guard keeps that true if the rule is ever relaxed. Aborting a merge
         * somebody else's work is sitting in would destroy it, which is the one thing an abort must not do.
         */
        if (before.merge === undefined) {
          await runGit(deps, root, GIT_MERGE_ABORT_ARGS, { read: false });
        }
        throw gitFailed(merged);
      }

      /**
       * The task is created **first**, and it is an ordinary task in the project: it follows the project's own
       * agent setting, it appears in the rail beside the user's other work, and its run can be watched,
       * steered and answered like any other. A resolution that happened in a hidden mechanism would be a
       * second, less trustworthy kind of run.
       *
       * Its folder is the **repository root** rather than the project's directory, because that is where the
       * conflicted paths in the prompt are relative to, and the merge itself runs there.
       */
      const task = await deps.store.createTask({
        projectId: project.id,
        title: `Resolve the merge of ${input.branch}`,
        cwd: root,
      });
      if (task === undefined) {
        await runGit(deps, root, GIT_MERGE_ABORT_ARGS, { read: false });
        throw gitFailed(merged);
      }

      let run;
      try {
        run = await runs.start({
          taskId: task.id,
          prompt: resolvePrompt({
            branch: input.branch,
            ...(before.branch !== undefined ? { into: before.branch } : {}),
            files,
          }),
        });
      } catch (error) {
        /**
         * **The merge is taken back when no agent would take it.** The alternative — leaving a conflict behind
         * with nobody working on it — is a repository the user has to notice and clean up, for a press whose
         * whole point was that an agent would handle it. The refusal carries the agent's own sentence, which is
         * the part a person can act on (a model that is not configured, a CLI that is not installed).
         */
        await runGit(deps, root, GIT_MERGE_ABORT_ARGS, { read: false });
        // The task was created a moment ago for a merge that no longer exists, so it is archived rather than
        // left in the rail: its title would send a user (or a later run) looking for a conflict that is gone.
        await deps.store.archiveTask(task.id);
        const detail = error instanceof Error ? coderErrorMessage(error.message) : String(error);
        throw coderError(
          ENVOYDEV_ERRORS.gitMergeResolveFailed,
          `The agent could not be started, so the merge was taken back and nothing changed: ${detail}`,
          ref("error.gitMergeResolveFailed", { detail }),
        );
      }

      return {
        outcome: "resolving" as const,
        files,
        merge: { branch: input.branch, ...(before.branch !== undefined ? { into: before.branch } : {}) },
        task,
        run,
        status: await statusOf(deps, root),
        changes: changesOf(root),
      };
    },

    /**
     * Record a resolved merge — the commit, which is git's own (`Merge branch 'x'`).
     *
     * Only when the index has **no unmerged entries**: that is the fact `git commit` refuses on, and it is
     * measured here so the refusal names the files rather than relaying `Committing is not possible because you
     * have unmerged files` — a complaint about work the user may believe they finished.
     */
    "coder.gitMergeContinue": async (params) => {
      const input = parseRpcParams("coder.gitMergeContinue", params) as { projectId: string };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);
      const root = await gitRoot(deps, project.path);

      const before = await statusOf(deps, root);
      if (before.merge === undefined) {
        throw coderError(
          ENVOYDEV_ERRORS.gitMergeNone,
          "No merge is in progress, so there is nothing to finish or abort.",
          ref("error.gitMergeNone"),
        );
      }
      /**
       * **Only the unresolved half refuses here.** Finishing a merge whose conflicts are all staged is exactly
       * what this method is for, so it is exempt from the "a merge is open" rule that guards the actions which
       * would throw one away — and it still refuses, with the file list, while the index has unmerged entries.
       */
      if (before.conflicted) refuseWhileConflicted(before, conflictsOf(root));

      const committed = await runGit(deps, root, GIT_MERGE_CONTINUE_ARGS, { read: false });
      // A failing hook, a signing key, a missing identity: git names what to fix.
      if (committed.code !== 0) throw gitFailed(committed);

      const sha = await runGit(deps, root, ["rev-parse", "HEAD"], { read: true });
      return {
        sha: sha.text.trim(),
        status: await statusOf(deps, root),
        changes: changesOf(root),
      };
    },

    /** Take a merge in progress back — the way out, and the only one for a conflict nobody resolved. */
    "coder.gitMergeAbort": async (params) => {
      const input = parseRpcParams("coder.gitMergeAbort", params) as { projectId: string };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);
      const root = await gitRoot(deps, project.path);

      const before = await statusOf(deps, root);
      if (before.merge === undefined) {
        throw coderError(
          ENVOYDEV_ERRORS.gitMergeNone,
          "No merge is in progress, so there is nothing to finish or abort.",
          ref("error.gitMergeNone"),
        );
      }

      const aborted = await runGit(deps, root, GIT_MERGE_ABORT_ARGS, { read: false });
      if (aborted.code !== 0) throw gitFailed(aborted);
      return { status: await statusOf(deps, root), changes: changesOf(root) };
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
      refuseConflict(root, await statusOf(deps, root));

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

    "coder.gitStashList": async (params) => {
      const input = parseRpcParams("coder.gitStashList", params) as { projectId: string };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      // A read: allowed while a run is live, like every other listing here.
      return { stashes: await stashesOf(deps, project.path) };
    },

    "coder.gitStashPush": async (params) => {
      const input = parseRpcParams("coder.gitStashPush", params) as { projectId: string };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);
      const root = await gitRoot(deps, project.path);

      /**
       * **Set nothing aside is a state, not a success.**
       *
       * `git stash push` on a clean tree exits *0* and prints `No local changes to save`, so a caller that
       * trusted the exit code would tell a user their work was safe when nothing had happened. Asked here of
       * our own status read rather than of git's output, which is localised and versioned.
       */
      const before = await statusOf(deps, root);
      refuseConflict(root, before);
      if (before.dirty === 0 && !before.conflicted) {
        throw coderError(
          ENVOYDEV_ERRORS.gitNothingToStash,
          NOTHING_TO_STASH_SENTENCE,
          ref("error.gitNothingToStash"),
        );
      }

      // The whole tree, untracked files included; git's own refusal is the detail if it will not go.
      const pushed = await runGit(deps, root, GIT_STASH_PUSH_ARGS, { read: false });
      if (pushed.code !== 0) throw gitFailed(pushed);
      return await stashAnswer(deps, root);
    },

    "coder.gitStashPop": async (params) => {
      const input = parseRpcParams("coder.gitStashPop", params) as { projectId: string; index: number };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      refuseWhileRunning(project.id);
      const root = await gitRoot(deps, project.path);

      /**
       * **A pop is only attempted onto a tree measured as clean**, and that precondition is what makes the
       * undo below exact rather than destructive: with nothing else in the tree, everything a conflicted pop
       * wrote came from the pop. It is also the honest answer in its own right — a user with unsaved work and
       * a stash to put back has to decide which of the two matters, and this code cannot decide for them.
       */
      const before = await statusOf(deps, root);
      // Before the clean-tree rule, so a conflicted repository gets the sentence about the merge rather than
      // the one advising a user to commit or stash work they cannot commit or stash yet.
      refuseConflict(root, before);
      if (before.dirty > 0) {
        throw coderError(ENVOYDEV_ERRORS.gitStashDirty, STASH_DIRTY_SENTENCE, ref("error.gitStashDirty"));
      }

      const popped = await runGit(deps, root, gitStashPopArgs(input.index), { read: false });
      if (popped.code !== 0) {
        /**
         * A conflicted pop is **taken back and refused with the files**, exactly as a conflicted merge is —
         * and the stash survives it, because git does not drop one whose application conflicted. Measured
         * rather than read out of git's message, which is localised: our own parser calls an unmerged entry
         * `conflict`.
         */
        const conflicted = changesOf(root).filter((change) => change.kind === "conflict");
        if (conflicted.length > 0) {
          const files = conflicted.map((change) => change.path);
          // The tracked half, then the untracked files `-u` restores. Both are no-ops on a tree that was
          // clean a moment ago, which is the whole reason the precondition above exists.
          await runGit(deps, root, GIT_STASH_POP_UNDO_ARGS, { read: false });
          await runGit(deps, root, GIT_STASH_POP_UNDO_CLEAN_ARGS, { read: false });
          throw coderError(
            ENVOYDEV_ERRORS.gitStashConflict,
            `This stash cannot be put back cleanly. These files conflict: ${files.join(", ")}. Nothing was changed, and the stash is still there.`,
            ref("error.gitStashConflict", { files: listOf(files) }),
          );
        }
        // A number no stash has, most likely: git names the ref it could not resolve.
        throw gitFailed(popped);
      }
      return await stashAnswer(deps, root);
    },

    "coder.gitStashDrop": async (params) => {
      const input = parseRpcParams("coder.gitStashDrop", params) as { projectId: string; index: number };
      const project = projectFor(input.projectId);
      await repositoryFor(project.path);
      // **Allowed while a run is live**, by the same criterion that allows a fetch: this moves no branch and
      // no file, only the stash's own ref and reflog. A user tidying up does not have to stop their agent.
      const root = await gitRoot(deps, project.path);

      const dropped = await runGit(deps, root, gitStashDropArgs(input.index), { read: false });
      // Git's own sentence names the ref when there is no such stash, which is more use than a guess here.
      if (dropped.code !== 0) throw gitFailed(dropped);
      return await stashAnswer(deps, root);
    },
  };
}
