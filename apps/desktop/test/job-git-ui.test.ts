/**
 * Shared Git UI policy mapping for Team jobs.
 */

import { describe, expect, it } from "vitest";

import {
  gitUiFromAssess,
  gitUiMessageKey,
  isGitUiReady,
} from "../src/state/job-git-ui.js";

describe("job-git-ui", () => {
  it("maps assess answers to Start-gate policies", () => {
    expect(gitUiFromAssess({ ok: true })).toBe("ok");
    expect(gitUiFromAssess({ ok: false, policy: "not-a-git-repo" })).toBe("not-a-git-repo");
    expect(gitUiFromAssess({ ok: false, policy: "no-git-remote" })).toBe("no-git-remote");
    expect(gitUiFromAssess({ ok: false, message: "daemon down" })).toBe("git-missing");
  });

  it("only treats ok as ready", () => {
    expect(isGitUiReady("ok")).toBe(true);
    expect(isGitUiReady("checking")).toBe(false);
    expect(isGitUiReady("no-git-remote")).toBe(false);
  });

  it("uses the same message keys as the create sheet", () => {
    expect(gitUiMessageKey("checking")).toBe("teamJob.git.checking");
    expect(gitUiMessageKey("no-git-remote")).toBe("teamJob.git.noRemote");
    expect(gitUiMessageKey("cwd-missing")).toBe("job.pane.crew.gitBlocked");
  });
});
