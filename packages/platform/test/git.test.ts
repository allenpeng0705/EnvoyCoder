/**
 * The git parsers and the two argv this product runs — against a **real repository**, not the manual.
 *
 * The formats here are the load-bearing part of the branch feature, and they are the kind of thing that
 * is easy to believe wrongly: whether untracked files appear in `--porcelain=v2`, whether a detached HEAD
 * shows up as a branch, whether `git checkout <name>` picks the branch or a directory of the same name.
 * Every one of those is asserted below by running git and reading what it said.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
} from "../src/git.js";

const git = spawnSync("git", ["--version"], { encoding: "utf8" });
const itGit = git.status === 0 ? it : it.skip;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A repository whose first branch is called `main` and whose HEAD is on `work`. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "envoydev-git-"));
  roots.push(root);
  run(root, ["init", "-q"]);
  run(root, ["config", "user.email", "t@t"]);
  run(root, ["config", "user.name", "T"]);
  writeFileSync(join(root, "a.txt"), "one\n");
  run(root, ["add", "."]);
  run(root, ["commit", "-qm", "one"]);
  // Deterministic whatever the machine's `init.defaultBranch` is.
  run(root, ["branch", "-m", "main"]);
  run(root, ["checkout", "-qb", "work"]);
  return root;
}

function run(root: string, args: readonly string[]): void {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

/** What git printed for one of the two argv this module owns. */
function gitOut(root: string, args: readonly string[]): string {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8" }).stdout ?? "";
}

const statusOf = (root: string) => parseGitStatus(gitOut(root, GIT_STATUS_ARGS));

describe("parseGitStatus", () => {
  itGit("reads a clean tree, with the branch from the same answer", () => {
    const status = statusOf(repository());
    expect(status).toEqual({
      kind: "git",
      branch: "work",
      detached: false,
      ahead: 0,
      behind: 0,
      dirty: 0,
      conflicted: false,
    });
  });

  itGit("counts staged, modified and untracked entries as dirty, and ignored files as nothing", () => {
    const root = repository();
    writeFileSync(join(root, "a.txt"), "changed\n");
    writeFileSync(join(root, "new.txt"), "untracked\n");
    writeFileSync(join(root, ".gitignore"), "secret.env\n");
    writeFileSync(join(root, "secret.env"), "s3cret\n");
    run(root, ["add", "a.txt"]);

    // Three: the staged modification, the untracked file, and the untracked `.gitignore` itself. The
    // ignored file is *not* a change — which is what `--untracked-files=normal` plus the `!` skip means.
    expect(statusOf(root).dirty).toBe(3);
  });

  itGit("reports how far the branch is from its upstream", () => {
    const root = repository();
    run(root, ["branch", "--set-upstream-to=main", "work"]);
    expect(statusOf(root)).toMatchObject({ upstream: "main", ahead: 0, behind: 0 });

    writeFileSync(join(root, "b.txt"), "two\n");
    run(root, ["add", "."]);
    run(root, ["commit", "-qm", "two"]);
    expect(statusOf(root)).toMatchObject({ upstream: "main", ahead: 1, behind: 0 });
  });

  itGit("marks a detached HEAD, and leaves the branch absent rather than invented", () => {
    const root = repository();
    run(root, ["checkout", "-q", "--detach"]);
    const status = statusOf(root);
    expect(status.detached).toBe(true);
    expect(status.branch).toBeUndefined();
  });

  itGit("marks an unmerged tree, because whose work survives is a question for a person", () => {
    const root = repository();
    writeFileSync(join(root, "a.txt"), "work\n");
    run(root, ["commit", "-qam", "work"]);
    run(root, ["checkout", "-q", "main"]);
    writeFileSync(join(root, "a.txt"), "main\n");
    run(root, ["commit", "-qam", "main"]);
    const merge = spawnSync("git", ["-C", root, "merge", "work"], { encoding: "utf8" });
    expect(merge.status).not.toBe(0); // the conflict this test is about

    expect(statusOf(root)).toMatchObject({ conflicted: true, dirty: 1 });
  });

  it("treats output it does not recognise as nothing rather than as a count", () => {
    const status = parseGitStatus("");
    expect(status).toMatchObject({ dirty: 0, ahead: 0, behind: 0, conflicted: false });
    expect(status.branch).toBeUndefined();
  });
});

describe("parseGitBranches", () => {
  itGit("lists branches with the current one marked and its upstream named", () => {
    const root = repository();
    run(root, ["branch", "--set-upstream-to=main", "work"]);

    const branches = parseGitBranches(gitOut(root, GIT_BRANCHES_ARGS));
    expect(branches).toEqual([
      { name: "main", current: false },
      { name: "work", current: true, upstream: "main" },
    ]);
  });

  itGit("skips the detached pseudo-entry, so no branch claims to be current", () => {
    const root = repository();
    run(root, ["checkout", "-q", "--detach"]);
    const branches = parseGitBranches(gitOut(root, GIT_BRANCHES_ARGS));
    expect(branches.map((branch) => branch.name).sort()).toEqual(["main", "work"]);
    expect(branches.some((branch) => branch.current)).toBe(false);
  });
});

describe("the argv, measured against a real repository", () => {
  itGit("switches to the branch even when a directory of the same name exists", () => {
    // The reason `checkout` is enough and `switch` (git 2.23+) is not required: git resolves the *ref*
    // first. Asserted rather than assumed, because the failure mode would be silently checking out a path.
    const root = repository();
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "note.md"), "x\n");
    run(root, ["add", "."]);
    run(root, ["commit", "-qm", "docs"]);
    run(root, ["branch", "docs"]);

    run(root, ["checkout", "main"]);
    run(root, gitCheckoutBranchArgs("docs"));

    expect(gitOut(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("docs");
  });

  itGit("creates a branch at HEAD and switches to it", () => {
    const root = repository();
    run(root, gitCreateBranchArgs("feature/thing"));
    const status = statusOf(root);
    expect(status.branch).toBe("feature/thing");
    expect(parseGitBranches(gitOut(root, GIT_BRANCHES_ARGS)).map((b) => b.name)).toContain("feature/thing");
  });
});

describe("branchNameRefusal", () => {
  it("accepts the shapes a person types", () => {
    for (const name of ["main", "feature/thing", "fix-1", "release/2026.09", "a.b"]) {
      expect(branchNameRefusal(name)).toBeUndefined();
    }
  });

  it("refuses what git would refuse, and what git would read as an option", () => {
    expect(branchNameRefusal("")).toBe("empty");
    expect(branchNameRefusal("   ")).toBe("empty");
    expect(branchNameRefusal("-f")).toBe("looks-like-an-option");
    expect(branchNameRefusal("a..b")).toBe("not-a-ref");
    expect(branchNameRefusal("a b")).toBe("not-a-ref");
    expect(branchNameRefusal("a~1")).toBe("not-a-ref");
    expect(branchNameRefusal("a^")).toBe("not-a-ref");
    expect(branchNameRefusal("a: b")).toBe("not-a-ref");
    expect(branchNameRefusal("a?")).toBe("not-a-ref");
    expect(branchNameRefusal("a*")).toBe("not-a-ref");
    expect(branchNameRefusal("a[b")).toBe("not-a-ref");
    expect(branchNameRefusal("a\\b")).toBe("not-a-ref");
    expect(branchNameRefusal("@")).toBe("not-a-ref");
    expect(branchNameRefusal("/leading")).toBe("not-a-ref");
    expect(branchNameRefusal("trailing/")).toBe("not-a-ref");
    expect(branchNameRefusal("double//slash")).toBe("not-a-ref");
    expect(branchNameRefusal("ends.")).toBe("not-a-ref");
    expect(branchNameRefusal("part/.hidden")).toBe("not-a-ref");
    expect(branchNameRefusal("branch.lock")).toBe("not-a-ref");
    expect(branchNameRefusal("x".repeat(256))).toBe("too-long");
  });
});

describe("gitEnv", () => {
  it("never lets a git child ask a question, and keeps a read out of the index lock", () => {
    const read = gitEnv({ PATH: "/usr/bin" }, { read: true });
    expect(read).toMatchObject({
      PATH: "/usr/bin",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      GIT_OPTIONAL_LOCKS: "0",
    });
    // A checkout *is* a write: it wants the lock, and must not be told to skip it.
    expect(gitEnv({}, { read: false }).GIT_OPTIONAL_LOCKS).toBeUndefined();
  });
});

describe("detectVcsKind", () => {
  it("names git when git said so, jj only when git said no, and none otherwise", () => {
    const root = mkdtempSync(join(tmpdir(), "envoydev-vcs-"));
    roots.push(root);
    expect(detectVcsKind(root, { gitRepository: false })).toBe("none");
    expect(detectVcsKind(root, { gitRepository: true })).toBe("git");

    mkdirSync(join(root, ".jj"));
    expect(detectVcsKind(root, { gitRepository: false })).toBe("jj");
    // A colocated repository answers git: that is the interface this product drives.
    expect(detectVcsKind(root, { gitRepository: true })).toBe("git");
  });
});
