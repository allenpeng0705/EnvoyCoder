/**
 * Origin-client auth + Team job Start readiness (phone may orchestrate jobs).
 */

import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createCollabHandlers } from "../src/daemon/collab-handlers.js";
import { assessTeamJobReadiness } from "../src/daemon/job-start-readiness.js";
import { createJob } from "../src/daemon/jobs.js";
import { requireOriginClient, requireOwnerWindow } from "../src/daemon/pairing.js";
import { createTeam, setMemberRolesOffered } from "../src/daemon/teams.js";
import { coderPaths } from "@envoydev/host-bridge";

const execFileAsync = promisify(execFile);

const PHONE = {
  session: {
    scopeKey: "product:EnvoyDev",
    ownerId: "owner",
    isOwnerScope: true as const,
    deviceId: "phone-1",
    caller: { kind: "owner-device" as const, deviceId: "phone-1", label: "Phone" },
  },
};

async function prepareGit(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["remote", "add", "origin", "https://example.com/repo.git"], {
    cwd: dir,
  });
}

async function tempPaths() {
  const dir = await mkdtemp(join(tmpdir(), "envoydev-readiness-"));
  const paths = coderPaths(dir);
  return {
    ...paths,
    workDir: join(dir, "repo"),
    dir,
  };
}

describe("requireOriginClient", () => {
  it("allows the owner window and a paired phone", () => {
    expect(() => requireOriginClient(undefined, "coder.startJob")).not.toThrow();
    expect(() => requireOriginClient({ session: undefined }, "coder.startJob")).not.toThrow();
    expect(() => requireOriginClient(PHONE, "coder.startJob")).not.toThrow();
  });

  it("refuses a non-owner session", () => {
    expect(() =>
      requireOriginClient({ session: { isOwnerScope: false } }, "coder.startJob"),
    ).toThrow(/paired|phone|machine/i);
  });

  it("still blocks team admin from the phone via requireOwnerWindow", () => {
    expect(() => requireOwnerWindow(PHONE, "coder.createTeam")).toThrow(/machine itself/i);
  });
});

describe("assessTeamJobReadiness", () => {
  it("reports missing roles so Mobile can show why Start is blocked", async () => {
    const paths = await tempPaths();
    await prepareGit(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
      // Origin only offers developer — tester step cannot Start.
      rolesOffered: ["developer", "orchestrate"],
    });
    await setMemberRolesOffered(paths.teamsFile, {
      teamId: team.team.id,
      memberId: "local",
      rolesOffered: ["developer", "orchestrate"],
    });
    const job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Need tester",
      goal: "ship",
      steps: [
        {
          role: "tester",
          brief: "test",
          worktreeKey: "test",
          cwdHint: paths.workDir,
        },
      ],
    });
    const r = await assessTeamJobReadiness({ teamsFile: paths.teamsFile, job });
    expect(r.canStart).toBe(false);
    expect(r.blockKind).toBe("missing-roles");
    expect(r.missingRoles).toContain("tester");
    expect(r.messageKey).toBe("job.pane.crew.missingRoles");
    expect(r.message).toMatch(/tester/i);
  });

  it("allows Start when local covers developer and Git is ready", async () => {
    const paths = await tempPaths();
    await prepareGit(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Solo",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "code",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
    });
    const r = await assessTeamJobReadiness({ teamsFile: paths.teamsFile, job });
    expect(r.canStart).toBe(true);
    expect(r.message).toBe("");
  });

  it("allows Start when a later dependsOn role is offline (only pending roots count)", async () => {
    const paths = await tempPaths();
    await prepareGit(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
      rolesOffered: ["developer", "orchestrate"],
    });
    await setMemberRolesOffered(paths.teamsFile, {
      teamId: team.team.id,
      memberId: "local",
      rolesOffered: ["developer", "orchestrate"],
    });
    const job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Pipeline",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "code",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
        {
          role: "tester",
          brief: "test",
          worktreeKey: "test",
          cwdHint: paths.workDir,
          dependsOn: [], // filled after create — update via second create shape
        },
      ],
    });
    // Wire dependsOn: tester waits on developer (re-create steps via update would be heavier —
    // mutate the stored job through a second assess on a hand-built Job is enough).
    const withDeps = {
      ...job,
      steps: [
        job.steps[0]!,
        { ...job.steps[1]!, dependsOn: [job.steps[0]!.id] },
      ],
    };
    const r = await assessTeamJobReadiness({ teamsFile: paths.teamsFile, job: withDeps });
    expect(r.canStart).toBe(true);
  });

  it("lets a paired phone call assessTeamJobReadiness and createJob, not createTeam", async () => {
    const paths = await tempPaths();
    await prepareGit(paths.workDir);
    const handlers = createCollabHandlers({
      paths,
    });
    const created = (await handlers["coder.createTeam"]!(
      { label: "Desk" },
      { session: undefined },
    )) as { team: { id: string } };

    await expect(handlers["coder.createTeam"]!({ label: "Nope" }, PHONE)).rejects.toThrow(
      /machine itself/i,
    );

    const jobResult = (await handlers["coder.createJob"]!(
      {
        teamId: created.team.id,
        title: "From phone",
        goal: "ship",
        steps: [
          {
            role: "developer",
            brief: "code",
            worktreeKey: "main",
            cwdHint: paths.workDir,
          },
        ],
      },
      PHONE,
    )) as { job: { id: string } };

    const readiness = await handlers["coder.assessTeamJobReadiness"]!(
      { jobId: jobResult.job.id },
      PHONE,
    );
    expect(readiness).toMatchObject({ canStart: true });
  });
});
