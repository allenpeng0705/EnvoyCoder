/**
 * The git service, over a **real repository** and through the daemon's own handler table.
 *
 * Three things are worth proving here rather than by reading the code:
 *
 *   * **the wiring** — `coder.gitStatus`/`gitBranches`/`gitCheckout`/`gitCreateBranch` are in the table a
 *     client actually reaches, not merely in a module;
 *   * **the refusals**, because they are what a user reads: a folder git does not track, a name that cannot
 *     be a branch, a project that is gone, git that is not installed, and an agent working in the folder —
 *     each carries the key this build's catalogue has, *and* the English sentence the catalogue renders, byte
 *     for byte. That second half is asserted here rather than in `daemon-errors-i18n.test.ts` because it
 *     needs a real project and a real repository to reach, and this file has both;
 *   * **the one asymmetry** — a read is never refused while a run is live, and a write always is.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";
import {
  ENVOYDEV_ERRORS,
  coderError,
  coderErrorCode,
  coderErrorMessage,
  coderErrorRef,
} from "@envoydev/protocol";

import { createGitHandlers } from "../src/daemon/git.js";
import { ref } from "../src/daemon/messages.js";
import { createCoderHandlers, type CoderHandler } from "../src/daemon/service.js";
import { CoderStore } from "../src/daemon/store.js";
import { createTranslator } from "../src/i18n/translate.js";
import { en, isMessageKey } from "../src/i18n/messages/en.js";

const git = spawnSync("git", ["--version"], { encoding: "utf8" });
const itGit = git.status === 0 ? it : it.skip;

const english = createTranslator("en", en).t;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(root: string, args: readonly string[]): void {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

/** A repository whose first branch is `main` and whose HEAD is on `work`. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "envoydev-gitsvc-"));
  roots.push(root);
  run(root, ["init", "-q"]);
  run(root, ["config", "user.email", "t@t"]);
  run(root, ["config", "user.name", "T"]);
  writeFileSync(join(root, "a.txt"), "one\n");
  run(root, ["add", "."]);
  run(root, ["commit", "-qm", "one"]);
  run(root, ["branch", "-m", "main"]);
  run(root, ["checkout", "-qb", "work"]);
  return root;
}

/**
 * A repository with **no** author identity and no guessing allowed.
 *
 * `user.useConfigOnly` is the interesting half, and it was measured rather than assumed: git without an
 * identity **invents one** from the username and hostname ("Your name and email address were configured
 * automatically…") and the commit succeeds. Only a repository that forbids the guess refuses — which is the
 * configuration a user who cares about their history sets, and the one whose refusal names the fix.
 */
/**
 * A repository with a **real remote**: a bare repository and two clones, so fetch and pull are measured
 * against a remote rather than stubbed. A `file://` remote needs no credentials, which is the point — the
 * network half of the story is about the user's own git, and this proves the plumbing without inventing one.
 */
function withRemote(): { desktop: string; other: string } {
  const base = mkdtempSync(join(tmpdir(), "envoydev-gitsvc-remote-"));
  roots.push(base);
  const bare = join(base, "origin.git");
  spawnSync("git", ["init", "--bare", "-q", bare], { encoding: "utf8" });

  const desktop = join(base, "desktop");
  spawnSync("git", ["clone", "-q", bare, desktop], { encoding: "utf8" });
  run(desktop, ["config", "user.email", "t@t"]);
  run(desktop, ["config", "user.name", "T"]);
  writeFileSync(join(desktop, "a.txt"), "one\n");
  run(desktop, ["add", "."]);
  run(desktop, ["commit", "-qm", "one"]);
  run(desktop, ["push", "-q", "-u", "origin", "HEAD"]);

  const other = join(base, "other");
  spawnSync("git", ["clone", "-q", bare, other], { encoding: "utf8" });
  run(other, ["config", "user.email", "t@t"]);
  run(other, ["config", "user.name", "T"]);
  return { desktop, other };
}

function repositoryWithoutIdentity(): string {
  const root = mkdtempSync(join(tmpdir(), "envoydev-gitsvc-noid-"));
  roots.push(root);
  run(root, ["init", "-q"]);
  run(root, ["config", "user.useConfigOnly", "true"]);
  writeFileSync(join(root, "a.txt"), "one\n");
  run(root, ["add", "."]);
  return root;
}

function plainDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "envoydev-plain-"));
  roots.push(root);
  return root;
}

interface Bench {
  handlers: Record<string, CoderHandler>;
  store: CoderStore;
  home: string;
}

/**
 * A **conflicting** pair of branches: `work` and the current branch both changed `a.txt`.
 *
 * The fixture every merge test needs, and it is built the way a person's repository gets there rather than by
 * writing conflict markers by hand — so what the daemon meets is what git actually leaves.
 */
function withConflict(): string {
  const root = repository();
  writeFileSync(join(root, "a.txt"), "theirs\n");
  run(root, ["commit", "-qam", "theirs"]);
  run(root, ["checkout", "-q", "main"]);
  writeFileSync(join(root, "a.txt"), "ours\n");
  run(root, ["commit", "-qam", "ours"]);
  return root;
}

/** The daemon's real handler table, over a throwaway home. */
async function bench(
  options: {
    gitCommand?: string;
    env?: () => NodeJS.ProcessEnv;
    /** The agent runtime, when a test needs one. Absent means a daemon that cannot run anything. */
    startRun?: (input: { taskId: string; prompt: string }) => Promise<unknown>;
  } = {},
): Promise<Bench> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-gitsvc-home-"));
  const paths = coderPaths(home);
  const store = await CoderStore.open({ paths });
  roots.push(home);
  const handlers = createCoderHandlers({
    store,
    paths,
    instance: {
      instanceId: "git-test",
      version: "0.1.0",
      startedAt: "2026-09-20T00:00:00.000Z",
      connectionCount: () => 1,
    },
    mesh: () => ({ kind: "no-node", reason: "not attached in this test" }),
    ...(options.gitCommand !== undefined ? { gitCommand: options.gitCommand } : {}),
    ...(options.env !== undefined ? { gitEnv: options.env } : {}),
  }) as Record<string, CoderHandler>;
  return { handlers, store, home };
}

/** Add a project for a folder, and answer its id. */
async function addProject(bench: Bench, path: string): Promise<string> {
  const added = (await bench.handlers["coder.addProject"]?.({ path }, { session: undefined })) as {
    project: { id: string };
  };
  return added.project.id;
}

/** Call a handler — the params a `CoderHandler` is given carry no session in these tests. */
function call(
  handlers: Record<string, CoderHandler>,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return handlers[method]?.(params, { session: undefined }) as Promise<unknown>;
}

/** The failure a handler throws, which is what the transport would serialize. */
async function refusalOf(
  handlers: Record<string, CoderHandler>,
  method: string,
  params: Record<string, unknown> = {},
): Promise<string> {
  try {
    await call(handlers, method, params);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`${method} did not refuse — this test needs a refusal to inspect`);
}

/**
 * The refusal contract, in one place: a code, a key this build has, and an English sentence identical to
 * what the catalogue renders for that key and those values.
 */
function expectRefusal(message: string, key: string): void {
  const ref = coderErrorRef(message);
  expect(ref?.key).toBe(key);
  expect(isMessageKey(key)).toBe(true);
  expect(coderErrorCode(message)).not.toBeNull();
  expect(coderErrorMessage(message)).not.toContain("envoydev.key");
  expect(coderErrorMessage(message)).toBe(english(key as never, ref?.values ?? {}));
}

describe("the branch actions, over a real repository", () => {
  itGit("reads the branch, the upstream and the tree through the handler table", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);

    const status = (await call(b.handlers, "coder.gitStatus", { projectId })) as Record<string, unknown>;
    expect(status).toEqual({
      kind: "git",
      branch: "work",
      detached: false,
      ahead: 0,
      behind: 0,
      dirty: 0,
      conflicted: false,
    });

    run(repo, ["branch", "--set-upstream-to=main", "work"]);
    writeFileSync(join(repo, "b.txt"), "two\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "two"]);

    expect(await call(b.handlers, "coder.gitStatus", { projectId })).toMatchObject({
      upstream: "main",
      ahead: 1,
      behind: 0,
      dirty: 0,
    });
  });

  itGit("lists the branches, with the current one marked", async () => {
    const b = await bench();
    const projectId = await addProject(b, repository());
    const listed = (await call(b.handlers, "coder.gitBranches", { projectId })) as {
      branches: { name: string; current: boolean }[];
      detached: boolean;
    };
    expect(listed.branches).toEqual([
      { name: "main", current: false },
      { name: "work", current: true },
    ]);
    expect(listed.detached).toBe(false);
  });

  itGit("creates a branch, switches, and answers with the state it left behind", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);

    const created = (await call(b.handlers, "coder.gitCreateBranch", {
      projectId,
      name: "feature/thing",
    })) as { branch?: string };
    expect(created.branch).toBe("feature/thing");

    const switched = (await call(b.handlers, "coder.gitCheckout", {
      projectId,
      branch: "main",
    })) as { branch?: string };
    expect(switched.branch).toBe("main");
    // The switch is real: the repository says so, not only the answer.
    expect(spawnSync("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout.trim()).toBe("main");
  });

  itGit("records what kind of folder a project is, so a list does not have to ask", async () => {
    const b = await bench();
    const repoId = await addProject(b, repository());
    const plainId = await addProject(b, plainDirectory());

    expect(b.store.findProject(repoId)?.vcs).toEqual({ kind: "git" });
    expect(b.store.findProject(plainId)?.vcs).toEqual({ kind: "none" });
  });

  itGit("calls a folder git does not track a **state**, not a failure", async () => {
    // `coder.gitStatus` is what a rail calls for every project it shows, so "not a repository" has to be an
    // answer: a refusal here would put an error on a project that is merely not tracked by git.
    const b = await bench();
    const projectId = await addProject(b, plainDirectory());
    expect(await call(b.handlers, "coder.gitStatus", { projectId })).toMatchObject({
      kind: "none",
      detached: false,
      dirty: 0,
    });
  });
});

describe("the refusals a user can read", () => {
  itGit("refuses branch work on a folder git does not track", async () => {
    const b = await bench();
    const projectId = await addProject(b, plainDirectory());
    for (const [method, params] of [
      ["coder.gitBranches", { projectId }],
      ["coder.gitCheckout", { projectId, branch: "main" }],
      ["coder.gitCreateBranch", { projectId, name: "main" }],
    ] as const) {
      expectRefusal(await refusalOf(b.handlers, method, params), "error.gitNotARepository");
    }
  });

  itGit("refuses a name that cannot be a branch, per reason", async () => {
    const b = await bench();
    const projectId = await addProject(b, repository());

    expectRefusal(
      await refusalOf(b.handlers, "coder.gitCreateBranch", { projectId, name: "   " }),
      "error.gitBranchEmpty",
    );
    expectRefusal(
      await refusalOf(b.handlers, "coder.gitCheckout", { projectId, branch: "-f" }),
      "error.gitBranchInvalid",
    );
    expectRefusal(
      await refusalOf(b.handlers, "coder.gitCreateBranch", { projectId, name: "a..b" }),
      "error.gitBranchInvalid",
    );
    expectRefusal(
      await refusalOf(b.handlers, "coder.gitCreateBranch", { projectId, name: "x".repeat(256) }),
      "error.gitBranchTooLong",
    );
  });

  itGit("refuses a project that is not there, with the project's own key", async () => {
    const b = await bench();
    expectRefusal(
      await refusalOf(b.handlers, "coder.gitStatus", { projectId: "local::/nope" }),
      "error.projectNotFound",
    );
  });

  itGit("says git is not installed, rather than that the repository is broken", async () => {
    const b = await bench({ gitCommand: "/nonexistent/envoydev-no-such-git" });
    const projectId = await addProject(b, repository());
    expectRefusal(await refusalOf(b.handlers, "coder.gitStatus", { projectId }), "error.gitMissing");
  });

  itGit("refuses git's own refusal as git worded it, with our key around it", async () => {
    // A branch that does not exist: only git knows the difference between a typo and a branch it cannot
    // create, and its sentence says which — so it is the *detail*, and our sentence is the frame.
    const b = await bench();
    const projectId = await addProject(b, repository());
    const message = await refusalOf(b.handlers, "coder.gitCheckout", { projectId, branch: "no-such" });
    expectRefusal(message, "error.gitFailed");
    expect(coderErrorMessage(message)).toContain("no-such");
  });
});

describe("staging and committing", () => {
  itGit("stages a path, commits it, and answers with the repository it left behind", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);
    writeFileSync(join(repo, "a.txt"), "changed\n");

    const staged = (await call(b.handlers, "coder.gitStage", { projectId, paths: ["a.txt"] })) as {
      changes: { path: string; staged: boolean; unstaged: boolean }[];
    };
    // The file is in the index and the working tree matches it — two facts, and this is the interesting one.
    expect(staged.changes).toEqual([
      { path: "a.txt", kind: "modified", staged: true, unstaged: false },
    ]);

    const committed = (await call(b.handlers, "coder.gitCommit", {
      projectId,
      message: "change the note",
    })) as { sha: string; status: { dirty: number }; changes: unknown[] };
    expect(committed.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(committed.changes).toEqual([]);
    expect(committed.status.dirty).toBe(0);

    // And it is a real commit, with the message the user typed.
    const log = spawnSync("git", ["-C", repo, "log", "-1", "--format=%s"], { encoding: "utf8" });
    expect(log.stdout.trim()).toBe("change the note");
  });

  itGit("unstages a path without touching what is on disk", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);
    writeFileSync(join(repo, "a.txt"), "changed\n");
    await call(b.handlers, "coder.gitStage", { projectId, paths: ["a.txt"] });

    const unstaged = (await call(b.handlers, "coder.gitUnstage", { projectId, paths: ["a.txt"] })) as {
      changes: { path: string; staged: boolean; unstaged: boolean }[];
    };
    expect(unstaged.changes).toEqual([
      { path: "a.txt", kind: "modified", staged: false, unstaged: true },
    ]);
    // The edit survives: unstaging is a statement about the index, not about the file.
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("changed\n");
  });

  itGit("commits the first commit of a repository that has none, and can unstage it again", async () => {
    // **The shape a project made in EnvoyDev actually has**: `git init`, files, no commit. `git reset HEAD`
    // cannot unstage anything here (there is no HEAD), which is why unstaging has a second form.
    const b = await bench();
    const repo = repositoryWithoutIdentity();
    const projectId = await addProject(b, repo);

    await call(b.handlers, "coder.gitStage", { projectId, paths: ["a.txt"] });
    const unstaged = (await call(b.handlers, "coder.gitUnstage", { projectId, paths: ["a.txt"] })) as {
      changes: { path: string; staged: boolean; unstaged: boolean }[];
    };
    expect(unstaged.changes).toEqual([
      { path: "a.txt", kind: "untracked", staged: false, unstaged: true },
    ]);

    // With an identity (the repository has none, so this run brings one), the first commit lands.
    await call(b.handlers, "coder.gitStage", { projectId, paths: ["a.txt"] });
    const committed = (await call(b.handlers, "coder.gitCommit", {
      projectId,
      message: "first",
    })) as { sha: string };
    expect(committed.sha).toMatch(/^[0-9a-f]{7,}$/);
  });

  itGit("stages in a project that is a subdirectory of a larger repository", async () => {
    // **The case `gitRoot` exists for.** `git -C sub status` answers with paths relative to the *repository*
    // (`sub/a.txt`), so a write that ran in the project folder would look for `sub/sub/a.txt`. Measured here
    // rather than reasoned about, because the paths and the directory have to agree or nothing stages.
    const b = await bench();
    const repo = repository();
    const nested = join(repo, "sub");
    mkdirSync(nested);
    writeFileSync(join(nested, "a.txt"), "one\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "sub"]);
    writeFileSync(join(nested, "a.txt"), "changed\n");

    const projectId = await addProject(b, nested);
    const listed = (await call(b.handlers, "coder.gitStatus", { projectId })) as { kind: string };
    expect(listed.kind).toBe("git");

    const staged = (await call(b.handlers, "coder.gitStage", { projectId, paths: ["sub/a.txt"] })) as {
      changes: { path: string; staged: boolean }[];
    };
    expect(staged.changes).toEqual([
      { path: "sub/a.txt", kind: "modified", staged: true, unstaged: false },
    ]);
  });

  itGit("refuses an empty index, in the user's language rather than git's", async () => {
    const b = await bench();
    const projectId = await addProject(b, repository());
    expectRefusal(
      await refusalOf(b.handlers, "coder.gitCommit", { projectId, message: "nothing to say" }),
      "error.gitNothingStaged",
    );
  });

  itGit("refuses a message that is only whitespace", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);
    writeFileSync(join(repo, "a.txt"), "changed\n");
    await call(b.handlers, "coder.gitStage", { projectId, paths: ["a.txt"] });

    expectRefusal(
      await refusalOf(b.handlers, "coder.gitCommit", { projectId, message: "   " }),
      "error.gitCommitEmpty",
    );
  });

  itGit("relays git's own refusal when the repository will not accept a guessed identity", async () => {
    // **Measured, not assumed:** with no identity configured git *invents* one from the username and hostname
    // and commits anyway. A repository that forbids the guess (`user.useConfigOnly`) refuses — and its
    // sentence names the exact `git config` to run, which is why it is the *detail* rather than a paraphrase.
    const b = await bench({
      env: () => ({ ...process.env, HOME: plainDirectory(), GIT_CONFIG_GLOBAL: "/dev/null" }),
    });
    const repo = repositoryWithoutIdentity();
    const projectId = await addProject(b, repo);
    await call(b.handlers, "coder.gitStage", { projectId, paths: ["a.txt"] });

    const message = await refusalOf(b.handlers, "coder.gitCommit", { projectId, message: "first" });
    expectRefusal(message, "error.gitFailed");
    expect(coderErrorMessage(message)).toMatch(/identity|who you are/i);
  });
});

describe("merging", () => {
  itGit("merges a branch into the one the project is on, and says which", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);

    // Work on `work`, then go back to `main` and merge it in — the workflow this exists for.
    writeFileSync(join(repo, "feature.txt"), "from the branch\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "the work"]);
    await call(b.handlers, "coder.gitCheckout", { projectId, branch: "main" });

    const merged = (await call(b.handlers, "coder.gitMerge", { projectId, branch: "work" })) as {
      sha: string;
      into?: string;
      status: { branch?: string; dirty: number };
      changes: unknown[];
    };
    expect(merged.into).toBe("main");
    expect(merged.status.branch).toBe("main");
    expect(merged.status.dirty).toBe(0);
    expect(merged.changes).toEqual([]);
    // A fast-forward moved the branch, so the file is on disk in `main` without a merge commit.
    expect(readFileSync(join(repo, "feature.txt"), "utf8")).toBe("from the branch\n");
    expect(spawnSync("git", ["-C", repo, "log", "-1", "--format=%s"], { encoding: "utf8" }).stdout.trim()).toBe(
      "the work",
    );
  });

  itGit("makes a merge commit when both sides moved", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);
    // One commit on each side, or the merge is a fast-forward and proves nothing about a merge commit.
    await call(b.handlers, "coder.gitCheckout", { projectId, branch: "main" });
    writeFileSync(join(repo, "mine.txt"), "main side\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "main side"]);

    await call(b.handlers, "coder.gitCheckout", { projectId, branch: "work" });
    writeFileSync(join(repo, "theirs.txt"), "work side\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "work side"]);
    await call(b.handlers, "coder.gitCheckout", { projectId, branch: "main" });

    await call(b.handlers, "coder.gitMerge", { projectId, branch: "work" });
    // Git's own default message, because `--no-edit` is what keeps an editor from opening: the exact wording
    // varies by git version ("Merge branch 'work'" here, "…into main" elsewhere), so the assertion is about
    // *a merge commit having been made* rather than about git's phrasing.
    expect(
      spawnSync("git", ["-C", repo, "log", "-1", "--format=%s"], { encoding: "utf8" }).stdout.trim(),
    ).toMatch(/^Merge branch 'work'/);
  });

  itGit("**undoes** a conflicted merge, refuses with the files, and leaves no trace of it", async () => {
    // The assertion this whole design is built around. A window that cannot resolve a conflict must not leave
    // one behind: `MERGE_HEAD` in the folder, a half-applied merge, and no surface here to finish it.
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);

    writeFileSync(join(repo, "a.txt"), "work side\n");
    run(repo, ["commit", "-qam", "work side"]);
    await call(b.handlers, "coder.gitCheckout", { projectId, branch: "main" });
    writeFileSync(join(repo, "a.txt"), "main side\n");
    run(repo, ["commit", "-qam", "main side"]);

    const before = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    const message = await refusalOf(b.handlers, "coder.gitMerge", { projectId, branch: "work" });
    expectRefusal(message, "error.gitMergeConflict");
    expect(coderErrorMessage(message)).toContain("a.txt");

    // Nothing moved: the same HEAD, the same file on disk, and no unmerged entry left in the index.
    expect(spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim()).toBe(before);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("main side\n");
    expect(spawnSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).stdout.trim()).toBe("");
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
  });

  itGit("relays git's refusal when a local change would be overwritten", async () => {
    // Not a conflict: git refuses before starting, and its sentence names the file. Aborting something that
    // never started would fail in turn, so the two cases are told apart by the *measurement* (unmerged
    // entries), never by reading git's localised message.
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);
    writeFileSync(join(repo, "feature.txt"), "committed\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "theirs"]);
    await call(b.handlers, "coder.gitCheckout", { projectId, branch: "main" });
    // An uncommitted change in the very file the merge would bring.
    writeFileSync(join(repo, "feature.txt"), "local edit\n");

    const message = await refusalOf(b.handlers, "coder.gitMerge", { projectId, branch: "work" });
    expectRefusal(message, "error.gitFailed");
  });
});

describe("fetch and pull", () => {
  itGit("fetches what another machine pushed, and leaves the working tree alone", async () => {
    const b = await bench();
    const { desktop, other } = withRemote();
    const projectId = await addProject(b, desktop);

    writeFileSync(join(other, "b.txt"), "from the other machine\n");
    run(other, ["add", "."]);
    run(other, ["commit", "-qm", "other"]);
    run(other, ["push", "-q"]);

    const fetched = (await call(b.handlers, "coder.gitFetch", { projectId })) as {
      status: { behind: number };
      summary: string;
    };
    expect(fetched.status.behind).toBe(1);
    expect(fetched.summary).not.toBe("");
    // A fetch changes nothing in the working tree: the file is not here yet.
    expect(existsSync(join(desktop, "b.txt"))).toBe(false);
  });

  itGit("pulls a branch that is only behind, fast-forwarding the working tree", async () => {
    const b = await bench();
    const { desktop, other } = withRemote();
    const projectId = await addProject(b, desktop);
    writeFileSync(join(other, "b.txt"), "from the other machine\n");
    run(other, ["add", "."]);
    run(other, ["commit", "-qm", "other"]);
    run(other, ["push", "-q"]);

    const pulled = (await call(b.handlers, "coder.gitPull", { projectId })) as {
      status: { behind: number; ahead: number };
      changes: unknown[];
    };
    expect(pulled.status.behind).toBe(0);
    expect(pulled.status.ahead).toBe(0);
    expect(readFileSync(join(desktop, "b.txt"), "utf8")).toBe("from the other machine\n");
  });

  itGit("refuses a pull when the histories have diverged, and names the choice", async () => {
    const b = await bench();
    const { desktop, other } = withRemote();
    const projectId = await addProject(b, desktop);
    // The other machine pushes one commit; this one makes another, without fetching.
    writeFileSync(join(other, "theirs.txt"), "theirs\n");
    run(other, ["add", "."]);
    run(other, ["commit", "-qm", "theirs"]);
    run(other, ["push", "-q"]);
    writeFileSync(join(desktop, "mine.txt"), "mine\n");
    run(desktop, ["add", "."]);
    run(desktop, ["commit", "-qm", "mine"]);

    const message = await refusalOf(b.handlers, "coder.gitPull", { projectId });
    expectRefusal(message, "error.gitPullDiverged");
    // And the branch is exactly where it was: `--ff-only` refusing is not a half-done pull.
    expect(spawnSync("git", ["-C", desktop, "log", "-1", "--format=%s"], { encoding: "utf8" }).stdout.trim()).toBe(
      "mine",
    );
  });

  itGit("fetches a repository with no remote at all: nothing to bring, and not a failure", async () => {
    // **Measured rather than assumed:** `git fetch --prune` in a repository with no remotes exits 0 and says
    // nothing. A refusal here would be a lie about the user's machine, so the honest answer is an empty
    // summary — and the *UI* is what says "nothing new" in the user's language.
    const b = await bench();
    const projectId = await addProject(b, repository());
    const fetched = (await call(b.handlers, "coder.gitFetch", { projectId })) as { summary: string };
    expect(fetched.summary).toBe("");
  });

  itGit("relays git's own refusal when there is nothing to pull from", async () => {
    // A branch with no upstream: git names the two ways to fix it (`git pull <remote> <branch>`, or
    // `--set-upstream-to`), which is why its sentence is the detail rather than a paraphrase.
    const b = await bench();
    const projectId = await addProject(b, repository());
    const message = await refusalOf(b.handlers, "coder.gitPull", { projectId });
    expectRefusal(message, "error.gitFailed");
    expect(coderErrorMessage(message)).toMatch(/tracking information|upstream/i);
  });
});

describe("stash", () => {
  itGit("sets the whole tree aside — untracked files included — and puts it back", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);
    writeFileSync(join(repo, "a.txt"), "half a fix\n");
    writeFileSync(join(repo, "notes.txt"), "an untracked file\n");

    const pushed = (await call(b.handlers, "coder.gitStashPush", { projectId })) as {
      status: { dirty: number };
      changes: unknown[];
      stashes: { message: string; ref: string }[];
    };

    // Nothing is left in the tree, and the untracked file went with it: "stash my work" means the new file
    // too, which is the whole reason the argv carries `-u`.
    expect(pushed.status.dirty).toBe(0);
    expect(pushed.changes).toEqual([]);
    expect(existsSync(join(repo, "notes.txt"))).toBe(false);
    expect(pushed.stashes).toHaveLength(1);
    // Git labels it, and the label names the branch the work sat on — no message crossed the wire.
    expect(pushed.stashes[0]?.message).toMatch(/^WIP on work: /);
    expect(pushed.stashes[0]?.ref).toBe("stash@{0}");

    const popped = (await call(b.handlers, "coder.gitStashPop", { projectId, index: 0 })) as {
      status: { dirty: number };
      stashes: unknown[];
    };
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("half a fix\n");
    expect(readFileSync(join(repo, "notes.txt"), "utf8")).toBe("an untracked file\n");
    expect(popped.stashes).toEqual([]);
    expect(popped.status.dirty).toBe(2);
  });

  itGit("calls a clean tree nothing to stash, rather than a success", async () => {
    // `git stash push` on a clean tree exits **0** and creates nothing. A caller that trusted the exit code
    // would tell a user their work was safe when nothing had happened.
    const b = await bench();
    const projectId = await addProject(b, repository());
    const message = await refusalOf(b.handlers, "coder.gitStashPush", { projectId });
    expectRefusal(message, "error.gitNothingToStash");
  });

  itGit("refuses to put a stash back onto a tree with changes, and keeps it", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);
    writeFileSync(join(repo, "a.txt"), "set aside\n");
    run(repo, ["stash", "push", "-u", "-m", "set aside"]);
    writeFileSync(join(repo, "b.txt"), "unsaved work\n");

    const message = await refusalOf(b.handlers, "coder.gitStashPop", { projectId, index: 0 });
    expectRefusal(message, "error.gitStashDirty");
    // The refusal is a statement about *this* attempt: the unsaved work is untouched and the stash is there.
    expect(readFileSync(join(repo, "b.txt"), "utf8")).toBe("unsaved work\n");
    const listed = (await call(b.handlers, "coder.gitStashList", { projectId })) as { stashes: unknown[] };
    expect(listed.stashes).toHaveLength(1);
  });

  itGit("takes back a pop that conflicts: the tree is as it was, and the stash is kept", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);
    writeFileSync(join(repo, "a.txt"), "set aside\n");
    writeFileSync(join(repo, "notes.txt"), "an untracked file\n");
    run(repo, ["stash", "push", "-u", "-m", "set aside"]);
    // The branch moves on, so putting the stash back cannot be clean.
    writeFileSync(join(repo, "a.txt"), "moved on\n");
    run(repo, ["commit", "-qam", "moved on"]);

    const message = await refusalOf(b.handlers, "coder.gitStashPop", { projectId, index: 0 });
    expectRefusal(message, "error.gitStashConflict");
    expect(coderErrorMessage(message)).toContain("a.txt");

    // **The part that is easy to get wrong**: the conflicted attempt is undone — including the untracked
    // file the pop had already written — and the stash is still there to try again with.
    const status = (await call(b.handlers, "coder.gitStatus", { projectId })) as {
      dirty: number;
      conflicted: boolean;
    };
    expect(status).toMatchObject({ dirty: 0, conflicted: false });
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("moved on\n");
    expect(existsSync(join(repo, "notes.txt"))).toBe(false);
    const listed = (await call(b.handlers, "coder.gitStashList", { projectId })) as {
      stashes: { message: string }[];
    };
    expect(listed.stashes).toHaveLength(1);
  });

  itGit("discards one stash and leaves the working tree alone", async () => {
    const b = await bench();
    const repo = repository();
    const projectId = await addProject(b, repo);
    writeFileSync(join(repo, "a.txt"), "set aside\n");
    run(repo, ["stash", "push", "-u", "-m", "set aside"]);
    writeFileSync(join(repo, "b.txt"), "work in progress\n");

    const dropped = (await call(b.handlers, "coder.gitStashDrop", { projectId, index: 0 })) as {
      stashes: unknown[];
      changes: { path: string }[];
    };
    expect(dropped.stashes).toEqual([]);
    // Discarding a stash is not discarding the tree: the file the user had open is still there.
    expect(dropped.changes.map((change) => change.path)).toEqual(["b.txt"]);
    expect(readFileSync(join(repo, "b.txt"), "utf8")).toBe("work in progress\n");
  });

  itGit("lets git refuse a stash number that does not exist", async () => {
    // The client sends a number, never a ref, so the worst case is a number no stash has — and git names the
    // ref it could not resolve, which is more use than anything this layer could invent.
    const b = await bench();
    const projectId = await addProject(b, repository());
    const message = await refusalOf(b.handlers, "coder.gitStashDrop", { projectId, index: 9 });
    expectRefusal(message, "error.gitFailed");
    expect(coderErrorMessage(message)).toMatch(/stash@\{9\}/);
  });

  itGit("calls a folder git does not track a state, for every stash action", async () => {
    const b = await bench();
    const projectId = await addProject(b, plainDirectory());
    const message = await refusalOf(b.handlers, "coder.gitStashList", { projectId });
    expectRefusal(message, "error.gitNotARepository");
  });
});

describe("one writer at a time", () => {
  itGit("refuses a write while a run is live in the project, and allows every read", async () => {
    // The repo's own scenario: an agent mid-edit and a checkout in the same working tree. The run is stubbed
    // rather than started — what is under test is the daemon's rule, not an agent's behaviour.
    const home = await mkdtemp(join(tmpdir(), "envoydev-gitsvc-busy-"));
    roots.push(home);
    const store = await CoderStore.open({ paths: coderPaths(home) });
    const repo = repository();
    const project = await store.addProject({ path: repo, vcs: { kind: "git" } });
    const task = await store.createTask({ projectId: project.project.id, title: "fix the tests" });

    let live = true;
    const handlers = createGitHandlers({
      store,
      runs: { liveFor: (taskId: string) => (live && taskId === task?.id ? ({ id: "r1", taskId } as never) : undefined) },
    }) as Record<string, CoderHandler>;

    // Reads are never refused: looking at a repository is not the dangerous half.
    await expect(call(handlers, "coder.gitStatus", { projectId: project.project.id })).resolves.toBeDefined();
    await expect(call(handlers, "coder.gitBranches", { projectId: project.project.id })).resolves.toBeDefined();

    // Every write, not just the branch one: a commit under a working agent is the same hazard.
    for (const [method, params] of [
      ["coder.gitCheckout", { branch: "main" }],
      ["coder.gitStage", { paths: ["a.txt"] }],
      ["coder.gitUnstage", { paths: ["a.txt"] }],
      ["coder.gitCommit", { message: "from the phone" }],
      ["coder.gitMerge", { branch: "work" }],
      ["coder.gitPull", {}],
      // The stash actions that rewrite the tree are writes too — and the *order* matters: a push is refused
      // as "busy" rather than as "nothing to stash", and a pop as "busy" rather than as "your tree is dirty".
      ["coder.gitStashPush", {}],
      ["coder.gitStashPop", { index: 0 }],
    ] as const) {
      const refusal = await Promise.resolve(
        call(handlers, method, { projectId: project.project.id, ...params }),
      ).then(
        () => "did not refuse",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      // The sentence names the *task*, because "something is running" is not something a user can act on.
      expectRefusal(refusal, "error.gitBusy");
      expect(coderErrorMessage(refusal)).toContain("fix the tests");
    }

    // And the write is allowed again the moment the run is not live.
    live = false;
    expect(await call(handlers, "coder.gitCheckout", { projectId: project.project.id, branch: "main" }))
      .toMatchObject({ branch: "main" });
  });

  itGit("allows the stash actions that move no file or branch while a run is live", async () => {
    /**
     * The criterion, in one test: a command that would move the working tree or a branch waits for the run,
     * and one that moves neither does not. A fetch is the original case; listing stashes and discarding one
     * are the same shape — `refs/stash` and its reflog, no file, no branch — so a user tidying up does not
     * have to stop their agent to do it.
     */
    const home = await mkdtemp(join(tmpdir(), "envoydev-gitsvc-stashbusy-"));
    roots.push(home);
    const store = await CoderStore.open({ paths: coderPaths(home) });
    const repo = repository();
    writeFileSync(join(repo, "a.txt"), "set aside\n");
    run(repo, ["stash", "push", "-u", "-m", "set aside"]);
    const project = await store.addProject({ path: repo, vcs: { kind: "git" } });
    const task = await store.createTask({ projectId: project.project.id, title: "editing" });

    const handlers = createGitHandlers({
      store,
      runs: { liveFor: (taskId: string) => (taskId === task?.id ? ({ id: "r3", taskId } as never) : undefined) },
    }) as Record<string, CoderHandler>;

    await expect(call(handlers, "coder.gitStashList", { projectId: project.project.id })).resolves.toBeDefined();
    expect(await call(handlers, "coder.gitStashDrop", { projectId: project.project.id, index: 0 }))
      .toMatchObject({ stashes: [] });
  });

  itGit("does not refuse a write for a run in another project", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-gitsvc-other-"));
    roots.push(home);
    const store = await CoderStore.open({ paths: coderPaths(home) });
    const mine = await store.addProject({ path: repository(), vcs: { kind: "git" } });
    const other = await store.addProject({ path: repository(), vcs: { kind: "git" } });
    const otherTask = await store.createTask({ projectId: other.project.id, title: "elsewhere" });

    const handlers = createGitHandlers({
      store,
      runs: {
        liveFor: (taskId: string) => (taskId === otherTask?.id ? ({ id: "r2", taskId } as never) : undefined),
      },
    }) as Record<string, CoderHandler>;

    expect(await call(handlers, "coder.gitCheckout", { projectId: mine.project.id, branch: "main" }))
      .toMatchObject({ branch: "main" });
  });
});

/**
 * The git handlers **alone**, with a runtime that is only what the resolve path asks for.
 *
 * `coder.gitMergeResolve` needs one thing from a run manager — "start this task with this prompt" — and the
 * stub is the point: what is under test is *what the daemon hands an agent*, and whether it cleans up after
 * itself when that hand-off fails. How a run actually behaves is `runs.test.ts`'s subject, with a real child
 * process; repeating it here would prove nothing about git and would make every test below need an agent CLI.
 */
function gitOnly(
  store: CoderStore,
  options: { start?: (input: { taskId: string; prompt: string }) => Promise<unknown> } = {},
): Record<string, CoderHandler> {
  return createGitHandlers({
    store,
    runs: {
      liveFor: () => undefined,
      ...(options.start !== undefined
        ? { start: options.start as unknown as (input: never) => Promise<never> }
        : {}),
    },
  }) as Record<string, CoderHandler>;
}

describe("a conflicting merge, resolved by an agent", () => {
  itGit("merges without a task when there is nothing to resolve", async () => {
    // The same method, and the branch git can merge by itself: no conflict means no agent, and the answer says
    // so rather than leaving a client to guess from a task that does not exist.
    const b = await bench();
    const repo = repository();
    writeFileSync(join(repo, "work.txt"), "work side\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "work side"]);
    run(repo, ["checkout", "-q", "main"]);
    writeFileSync(join(repo, "other.txt"), "main side\n");
    run(repo, ["add", "."]);
    run(repo, ["commit", "-qm", "main side"]);
    const projectId = await addProject(b, repo);

    // A runtime *is* required (the method refuses without one, tested below) but is never asked to do
    // anything when git resolves the merge by itself.
    const started: string[] = [];
    const answer = (await call(
      gitOnly(b.store, {
        start: async (input) => {
          started.push(input.taskId);
          return { id: "r-never" };
        },
      }),
      "coder.gitMergeResolve",
      { projectId, branch: "work" },
    )) as { outcome: string; into?: string; status: { conflicted: boolean; merge?: unknown } };

    expect(answer.outcome).toBe("merged");
    expect(answer.into).toBe("main");
    expect(answer.status.conflicted).toBe(false);
    expect(answer.status.merge).toBeUndefined();
    expect(started).toEqual([]);
    expect(b.store.tasks({ projectId })).toEqual([]);
  });

  itGit("leaves the conflict, creates the task and hands the files to a run", async () => {
    const b = await bench();
    const repo = withConflict();
    const projectId = await addProject(b, repo);
    const started: { taskId: string; prompt: string }[] = [];
    const handlers = gitOnly(b.store, {
      start: async (input) => {
        started.push(input);
        return { id: "r-merge", taskId: input.taskId };
      },
    });

    const answer = (await call(handlers, "coder.gitMergeResolve", { projectId, branch: "work" })) as {
      outcome: string;
      files: string[];
      merge: { branch: string; into?: string };
      task: { id: string; title: string; cwd: string; harness: string };
      status: { conflicted: boolean; merge?: { branch?: string } };
    };

    expect(answer.outcome).toBe("resolving");
    expect(answer.files).toEqual(["a.txt"]);
    expect(answer.merge).toEqual({ branch: "work", into: "main" });
    expect(answer.task.title).toBe("Resolve the merge of work");
    // The **repository root**, because that is what the paths in the prompt are relative to. `realpath`
    // because git answers with the resolved path (`/private/var/...` for a temp directory on macOS) while the
    // fixture holds the one it was handed.
    expect(answer.task.cwd).toBe(realpathSync(repo));
    // A newly created task starts on the project's default agent.
    expect(answer.task.harness).toBe("envoy-harness");

    expect(started).toHaveLength(1);
    expect(started[0]?.taskId).toBe(answer.task.id);
    const prompt = started[0]?.prompt ?? "";
    expect(prompt).toContain('"work"');
    expect(prompt).toContain("a.txt");
    // The two rules the agent must keep for the surfaces to agree about the repository.
    expect(prompt).toContain("git add");
    expect(prompt).toContain("Do not run `git commit`");

    // **The merge is still in progress**: that is what makes the conflict resolvable at all, and what the
    // status has to say for a window to offer Finish and Abort.
    expect(answer.status.conflicted).toBe(true);
    expect(answer.status.merge).toEqual({ branch: "work" });
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toContain("<<<<<<<");
  });

  itGit("takes the merge back when the agent cannot be started", async () => {
    const b = await bench();
    const repo = withConflict();
    const projectId = await addProject(b, repo);
    const handlers = gitOnly(b.store, {
      start: async () => {
        throw coderError(
          ENVOYDEV_ERRORS.harnessFailed,
          "deepseek-harness has no model configured.",
          ref("error.modelRequired"),
        );
      },
    });

    const message = await refusalOf(handlers, "coder.gitMergeResolve", { projectId, branch: "work" });
    expectRefusal(message, "error.gitMergeResolveFailed");
    // The agent's own sentence is the part a person can act on, and it arrives whole.
    expect(coderErrorMessage(message)).toContain("has no model configured");

    // **Nothing moved**: no `MERGE_HEAD`, no conflict, and the branch where it was.
    const status = (await call(handlers, "coder.gitStatus", { projectId })) as {
      conflicted: boolean;
      dirty: number;
      merge?: unknown;
    };
    expect(status).toMatchObject({ conflicted: false, dirty: 0 });
    expect(status.merge).toBeUndefined();
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("ours\n");
    // And no stray task in the rail: the row existed for a moment and its premise is gone.
    expect(b.store.tasks({ projectId })).toEqual([]);
    expect(b.store.tasks({ projectId, includeArchived: true })).toHaveLength(1);
  });

  itGit("refuses before merging when this daemon has no agent runtime", async () => {
    // The ordering is the promise: with nothing to hand a conflict to, the merge must not be started at all.
    const b = await bench();
    const repo = withConflict();
    const projectId = await addProject(b, repo);

    const message = await refusalOf(gitOnly(b.store), "coder.gitMergeResolve", {
      projectId,
      branch: "work",
    });
    expectRefusal(message, "error.noRunRuntime");
    const status = (await call(gitOnly(b.store), "coder.gitStatus", { projectId })) as {
      conflicted: boolean;
      merge?: unknown;
    };
    expect(status.conflicted).toBe(false);
    expect(status.merge).toBeUndefined();
  });

  itGit("refuses to finish while files are unresolved, and records the merge once they are", async () => {
    const b = await bench();
    const repo = withConflict();
    const projectId = await addProject(b, repo);
    const handlers = gitOnly(b.store, { start: async () => ({ id: "r-merge" }) });
    await call(handlers, "coder.gitMergeResolve", { projectId, branch: "work" });

    // The measurement, not git's `Committing is not possible because you have unmerged files`.
    const unresolved = await refusalOf(handlers, "coder.gitMergeContinue", { projectId });
    expectRefusal(unresolved, "error.gitMergeUnresolved");
    expect(coderErrorMessage(unresolved)).toContain("a.txt");

    // What the agent would have done — and the merge is recorded with git's own message.
    writeFileSync(join(repo, "a.txt"), "theirs and ours\n");
    run(repo, ["add", "a.txt"]);
    const finished = (await call(handlers, "coder.gitMergeContinue", { projectId })) as {
      sha: string;
      status: { conflicted: boolean; merge?: unknown };
      changes: unknown[];
    };
    expect(finished.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(finished.status).toMatchObject({ conflicted: false });
    expect(finished.status.merge).toBeUndefined();
    expect(finished.changes).toEqual([]);
    expect(spawnSync("git", ["-C", repo, "log", "-1", "--format=%s"], { encoding: "utf8" }).stdout.trim()).toBe(
      "Merge branch 'work'",
    );
  });

  itGit("aborts a merge in progress, and says so when there is none", async () => {
    const b = await bench();
    const repo = withConflict();
    const projectId = await addProject(b, repo);
    const handlers = gitOnly(b.store, { start: async () => ({ id: "r-merge" }) });
    await call(handlers, "coder.gitMergeResolve", { projectId, branch: "work" });

    const aborted = (await call(handlers, "coder.gitMergeAbort", { projectId })) as {
      status: { conflicted: boolean; dirty: number; merge?: unknown };
      changes: unknown[];
    };
    expect(aborted.status).toMatchObject({ conflicted: false, dirty: 0 });
    expect(aborted.status.merge).toBeUndefined();
    expect(aborted.changes).toEqual([]);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("ours\n");

    // A second abort is a *state*, not a failure of git's: there is nothing to take back.
    const again = await refusalOf(handlers, "coder.gitMergeAbort", { projectId });
    expectRefusal(again, "error.gitMergeNone");
  });

  itGit("refuses the actions git would allow, or word badly, while a merge is unfinished", async () => {
    const b = await bench();
    const projectId = await addProject(b, withConflict());
    const handlers = gitOnly(b.store, { start: async () => ({ id: "r-merge" }) });
    await call(handlers, "coder.gitMergeResolve", { projectId, branch: "work" });

    // `checkout -b` is the one git **allows** here, carrying the half-finished merge onto a new branch; the
    // others git refuses with a sentence about the index. All of them get one answer from us.
    for (const [method, params] of [
      ["coder.gitCreateBranch", { name: "somewhere-else" }],
      ["coder.gitCheckout", { branch: "main" }],
      ["coder.gitMerge", { branch: "work" }],
      ["coder.gitMergeResolve", { branch: "work" }],
      ["coder.gitPull", {}],
      ["coder.gitStashPush", {}],
    ] as const) {
      const refusal = await refusalOf(handlers, method, { projectId, ...params });
      expectRefusal(refusal, "error.gitMergeUnresolved");
      expect(coderErrorMessage(refusal)).toContain("a.txt");
    }
    // And nothing was started by any of them.
    expect(spawnSync("git", ["-C", b.store.findProject(projectId)!.path, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim()).toBe("main");
  });

  itGit("names conflicts that no merge explains, rather than pointing at its own controls", async () => {
    // A rebase or a cherry-pick stopped in the user's terminal: the state is real, but EnvoyDev has no control
    // that could finish or undo it — so the sentence says where the way out is instead of offering one here.
    const b = await bench();
    const repo = withConflict();
    const projectId = await addProject(b, repo);
    const handlers = gitOnly(b.store, { start: async () => ({ id: "r-merge" }) });
    await call(handlers, "coder.gitMergeResolve", { projectId, branch: "work" });
    // What is left when the operation in progress is not a merge: the unmerged index stays, `MERGE_HEAD` does
    // not. (This is the state a rebase leaves, reproduced without running one.)
    rmSync(join(repo, ".git", "MERGE_HEAD"));

    const status = (await call(handlers, "coder.gitStatus", { projectId })) as {
      conflicted: boolean;
      merge?: unknown;
    };
    expect(status.conflicted).toBe(true);
    expect(status.merge).toBeUndefined();

    const refusal = await refusalOf(handlers, "coder.gitCheckout", { projectId, branch: "main" });
    expectRefusal(refusal, "error.gitConflicted");
    expect(coderErrorMessage(refusal)).toContain("a.txt");
  });

  itGit("refuses to throw away a merge whose conflicts are already resolved", async () => {
    /**
     * The state an agent leaves behind, and the hole the review measured: with every conflict staged the tree is
     * **clean**, so git allows `checkout`, `checkout -b` and `stash push` — and every one of them deletes
     * `MERGE_HEAD`, silently discarding the resolution nobody has recorded yet. It is also the state in which
     * the panel says "All conflicts are resolved. Finish the merge to record it."
     */
    const b = await bench();
    const repo = withConflict();
    const projectId = await addProject(b, repo);
    const handlers = gitOnly(b.store, { start: async () => ({ id: "r-merge" }) });
    await call(handlers, "coder.gitMergeResolve", { projectId, branch: "work" });
    // What the agent does: resolve the file and stage it — so there are **no unmerged entries left**, while the
    // merge itself is still open. (A resolution that keeps ours *entirely* leaves the tree clean as well; that
    // state is the next test.)
    writeFileSync(join(repo, "a.txt"), "theirs and ours\n");
    run(repo, ["add", "a.txt"]);
    expect(spawnSync("git", ["-C", repo, "status", "--porcelain=v1"], { encoding: "utf8" }).stdout).toBe(
      "M  a.txt\n",
    );

    // The status still says a merge is in progress — the fact the whole flow depends on.
    const status = (await call(handlers, "coder.gitStatus", { projectId })) as {
      conflicted: boolean;
      merge?: { branch?: string };
    };
    expect(status.conflicted).toBe(false);
    expect(status.merge).toEqual({ branch: "work" });

    for (const [method, params] of [
      ["coder.gitCreateBranch", { name: "somewhere-else" }],
      ["coder.gitCheckout", { branch: "main" }],
      ["coder.gitMerge", { branch: "work" }],
      // The second resolve must not abort the merge it did not start (it used to: no unmerged entries meant
      // "nothing was started", and the abort took the staged resolution with it).
      ["coder.gitMergeResolve", { branch: "work" }],
      ["coder.gitPull", {}],
      ["coder.gitStashPush", {}],
    ] as const) {
      const refusal = await refusalOf(handlers, method, { projectId, ...params });
      // The staged case gets the window's own sentence for the state, not one about conflicts that are gone.
      expectRefusal(refusal, "git.merge.resolved");
    }

    // **Nothing moved**: the merge is still open and the resolution is still on disk.
    expect(spawnSync("git", ["-C", repo, ...["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]], {
      encoding: "utf8",
    }).status).toBe(0);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("theirs and ours\n");

    // And the way out still works: finish it, which records the agent's resolution.
    const finished = (await call(handlers, "coder.gitMergeContinue", { projectId })) as { sha: string };
    expect(finished.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(spawnSync("git", ["-C", repo, ...["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]], {
      encoding: "utf8",
    }).status).not.toBe(0);
  });

  itGit("can finish a merge that leaves the tree clean", async () => {
    // Resolving by keeping one side entirely (`--ours`) leaves `git status` empty with `MERGE_HEAD` present —
    // a state this product's own prompt invites. The status must still report the merge, or neither Finish nor
    // Abort is reachable and the user is stuck in a merge EnvoyDev cannot see.
    const b = await bench();
    const repo = withConflict();
    const projectId = await addProject(b, repo);
    const handlers = gitOnly(b.store, { start: async () => ({ id: "r-merge" }) });
    await call(handlers, "coder.gitMergeResolve", { projectId, branch: "work" });
    run(repo, ["checkout", "--ours", "a.txt"]);
    run(repo, ["add", "a.txt"]);
    expect(spawnSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).stdout).toBe("");

    const status = (await call(handlers, "coder.gitStatus", { projectId })) as { merge?: unknown };
    expect(status.merge).toBeDefined();
    const finished = (await call(handlers, "coder.gitMergeContinue", { projectId })) as { sha: string };
    expect(finished.sha).toMatch(/^[0-9a-f]{7,}$/);
  });
});
