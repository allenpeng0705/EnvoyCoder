/**
 * Git porcelain, and the one question the explorer asks of it.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { listWorktreeChanges, parsePorcelain } from "../src/worktree-changes.js";

describe("parsePorcelain", () => {
  it("reads ordinary records and drops ignored files", () => {
    const raw = " M src/a.ts\0A  added.ts\0D  gone.ts\0?? new.ts\0!! secret.env\0";
    expect(parsePorcelain(raw)).toEqual([
      { path: "src/a.ts", kind: "modified" },
      { path: "added.ts", kind: "added" },
      { path: "gone.ts", kind: "deleted" },
      { path: "new.ts", kind: "untracked" },
    ]);
  });

  it("keeps both paths of a rename, including spaces", () => {
    const raw = "R  old name.ts\0new name.ts\0";
    expect(parsePorcelain(raw)).toEqual([
      { path: "new name.ts", kind: "renamed", from: "old name.ts" },
    ]);
  });

  it("treats an unmerged record as a conflict", () => {
    expect(parsePorcelain("UU both.ts\0")).toEqual([{ path: "both.ts", kind: "conflict" }]);
  });
});

describe("listWorktreeChanges", () => {
  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  const itGit = git.status === 0 ? it : it.skip;

  itGit("lists an untracked file, and reports a folder that is not a repository", () => {
    const root = mkdtempSync(join(tmpdir(), "envoydev-wt-"));
    const repo = join(root, "repo");
    const plain = join(root, "plain");
    spawnSync("git", ["init", repo], { encoding: "utf8" });
    writeFileSync(join(repo, "note.txt"), "hi");
    mkdirSync(plain);

    const listed = listWorktreeChanges(repo);
    expect(listed.repo).toBe(true);
    expect(listed.changes).toContainEqual({ path: "note.txt", kind: "untracked" });

    const none = listWorktreeChanges(plain);
    expect(none.repo).toBe(false);
    expect(none.changes).toEqual([]);
  });

  it("refuses a path that is not a directory", () => {
    expect(() => listWorktreeChanges(join(tmpdir(), "envoydev-wt-missing"))).toThrow(/not a directory/);
  });
});
