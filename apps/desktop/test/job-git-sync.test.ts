/**
 * Team job Git sync helpers — policy defaults and branch refusal path.
 */

import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { GitRunDeps } from "../src/daemon/git-runner.js";
import {
  prepareStepWorkingTree,
  shouldPullOnAccept,
  shouldPushOnSuccess,
} from "../src/daemon/job-git-sync.js";

describe("job git sync policy", () => {
  it("defaults pull on accept to true and push on success to false", () => {
    expect(shouldPullOnAccept(undefined)).toBe(true);
    expect(shouldPullOnAccept({})).toBe(true);
    expect(shouldPullOnAccept({ pullOnAccept: false })).toBe(false);

    expect(shouldPushOnSuccess(undefined)).toBe(false);
    expect(shouldPushOnSuccess({})).toBe(false);
    expect(shouldPushOnSuccess({ pushOnSuccess: true })).toBe(true);
  });
});

describe("prepareStepWorkingTree", () => {
  it("refuses an invalid branch name before touching git", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envoydev-jgsync-"));
    const cwd = join(dir, "repo");
    await mkdir(cwd, { recursive: true });

    const deps: GitRunDeps = {
      runGit: async () => {
        throw new Error("runGit should not be called for invalid branch names");
      },
      statusOf: async () => ({ dirty: 0, conflicted: false, behind: 0, ahead: 0 }),
    };

    const result = await prepareStepWorkingTree({
      cwd,
      branch: "bad..name",
      pullOnAccept: false,
      deps,
    });
    expect(result).toEqual({
      ok: false,
      policy: "branch-invalid",
      message: expect.stringContaining("not valid"),
    });
  });
});
