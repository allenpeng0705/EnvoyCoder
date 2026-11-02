/**
 * createJobFromSource — idempotent claim by sourceRef.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createJobFromSource } from "../src/daemon/jobs.js";
import { createTeam } from "../src/daemon/teams.js";

describe("createJobFromSource", () => {
  it("returns the same open job on a second call with the same sourceRef", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envoydev-jsource-"));
    const teamsFile = join(dir, "teams.json");
    const jobsFile = join(dir, "jobs.json");
    const team = await createTeam(teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const sourceRef = "github:acme/app#7";
    const first = await createJobFromSource(
      jobsFile,
      {
        teamId: team.team.id,
        sourceRef,
        title: "Fix login",
        goal: "Make sign-in reliable",
      },
      teamsFile,
    );
    expect(first.created).toBe(true);
    const second = await createJobFromSource(
      jobsFile,
      {
        teamId: team.team.id,
        sourceRef,
        title: "Different title",
        goal: "Different goal",
      },
      teamsFile,
    );
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.sourceRef).toBe(sourceRef);
    expect(second.job.title).toBe("Fix login");
  });
});
