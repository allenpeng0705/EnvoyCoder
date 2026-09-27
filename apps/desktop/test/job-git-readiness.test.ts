/**
 * Git content-bus readiness for Team jobs.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { assessGitContentBus } from "../src/daemon/job-git-readiness.js";

const execFileAsync = promisify(execFile);

describe("assessGitContentBus", () => {
  it("refuses a missing path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envoydev-gitbus-"));
    const r = await assessGitContentBus(join(dir, "nope"));
    expect(r).toEqual({ ok: false, policy: "path-missing" });
  });

  it("refuses a plain folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envoydev-gitbus-"));
    await mkdir(join(dir, "plain"), { recursive: true });
    const r = await assessGitContentBus(join(dir, "plain"));
    expect(r).toEqual({ ok: false, policy: "not-a-git-repo" });
  });

  it("refuses a repo with no remotes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envoydev-gitbus-"));
    const repo = join(dir, "repo");
    await mkdir(repo, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: repo });
    const r = await assessGitContentBus(repo);
    expect(r).toEqual({ ok: false, policy: "no-git-remote" });
  });

  it("accepts a repo with a remote", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envoydev-gitbus-"));
    const repo = join(dir, "repo");
    await mkdir(repo, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: repo });
    await execFileAsync("git", ["remote", "add", "origin", "https://example.com/r.git"], {
      cwd: repo,
    });
    const r = await assessGitContentBus(repo);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.path).toBe(repo);
  });
});
