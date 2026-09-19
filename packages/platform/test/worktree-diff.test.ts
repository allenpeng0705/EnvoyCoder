/**
 * A Changes click reads the difference, including a new file and a deleted one.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { readWorktreeDiff } from "../src/worktree-diff.js";

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "git failed");
}

describe("readWorktreeDiff", () => {
  const available = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
  const itGit = available ? it : it.skip;

  itGit("shows a modification, a new file, and a deletion", () => {
    const root = mkdtempSync(join(tmpdir(), "envoydev-diff-"));
    const repo = join(root, "repo");
    spawnSync("git", ["init", repo], { encoding: "utf8" });
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "note.txt"), "hi\n");
    git(repo, ["add", "note.txt"]);
    git(repo, ["commit", "-m", "init"]);

    writeFileSync(join(repo, "note.txt"), "hi\nthere\n");
    const modified = readWorktreeDiff(repo, "note.txt");
    expect(modified.kind).toBe("text");
    expect(modified.content).toContain("+there");

    writeFileSync(join(repo, "new.txt"), "fresh\n");
    const added = readWorktreeDiff(repo, "new.txt");
    expect(added.kind).toBe("text");
    expect(added.content).toContain("+fresh");

    rmSync(join(repo, "note.txt"));
    const deleted = readWorktreeDiff(repo, "note.txt");
    expect(deleted.kind).toBe("text");
    expect(deleted.content).toContain("-hi");
  });

  itGit("refuses a path outside the repository", () => {
    const root = mkdtempSync(join(tmpdir(), "envoydev-diff-"));
    const repo = join(root, "repo");
    spawnSync("git", ["init", repo], { encoding: "utf8" });
    writeFileSync(join(root, "secret.txt"), "nope");
    expect(() => readWorktreeDiff(repo, "../secret.txt")).toThrow(/Pick a file/);
  });
});
