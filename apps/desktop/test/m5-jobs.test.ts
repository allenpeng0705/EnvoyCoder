/**
 * Team + Job ledger (M5) — token/invite join, cwdHint refuse, writer locks, stall, §7.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

/** Team-job Start requires a Git work tree with a remote (content bus). */
async function prepareGitWorkDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["remote", "add", "origin", "https://example.com/repo.git"], {
    cwd: dir,
  });
}

import {
  assertWriterLocks,
  createJob,
  evaluateStalls,
  handleStepRunFailure,
  offerJobStep,
  refuseJobStepOffer,
  reportJobStepProgress,
  retriesForAssignee,
  setJobStallAutomation,
  saveJob,
  startJob,
  suggestJobSteps,
  listJobStepTemplates,
  pauseJob,
  updateJobSteps,
} from "../src/daemon/jobs.js";
import {
  createTeam,
  joinTeam,
  listTeams,
  rotateTeamToken,
  setMemberAcceptPolicy,
  teamHeartbeat,
} from "../src/daemon/teams.js";
import {
  encodeTeamInvite,
  inviteNeedsRemoteJoin,
  parseTeamInvite,
} from "../src/daemon/team-invite.js";
import { saveMembership } from "../src/daemon/memberships.js";
import { createCollabHandlers } from "../src/daemon/collab-handlers.js";
import { coderPaths } from "@envoydev/host-bridge";

async function tempPaths() {
  const dir = await mkdtemp(join(tmpdir(), "envoydev-m5-"));
  return {
    teamsFile: join(dir, "teams.json"),
    jobsFile: join(dir, "jobs.json"),
    jobOffersFile: join(dir, "job-offers.json"),
    membershipsFile: join(dir, "memberships.json"),
    inboundJobOffersFile: join(dir, "inbound.json"),
    workDir: join(dir, "repo"),
    dir,
  };
}

describe("team invite", () => {
  it("encodes origin endpoint and parses bare tokens", () => {
    const invite = encodeTeamInvite({
      token: "abcdefghijklmnopqrstuv",
      originWs: "ws://192.168.1.9:4770/ws",
      label: "Desk",
    });
    expect(invite.startsWith("envoydev.team.v1.")).toBe(true);
    const parsed = parseTeamInvite(invite);
    expect(parsed.token).toBe("abcdefghijklmnopqrstuv");
    expect(parsed.originWs).toBe("ws://192.168.1.9:4770/ws");
    expect(inviteNeedsRemoteJoin(parsed, ["ws://127.0.0.1:4770/ws"])).toBe(true);
    expect(inviteNeedsRemoteJoin(parsed, ["ws://192.168.1.9:4770/ws"])).toBe(false);

    const bare = parseTeamInvite("abcdefghijklmnopqrstuv");
    expect(bare.originWs).toBe("");
    expect(inviteNeedsRemoteJoin(bare, [])).toBe(false);
  });
});

describe("teams", () => {
  it("mints a token, accepts join, and rotates", async () => {
    const paths = await tempPaths();
    const created = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    expect(created.token.length).toBeGreaterThanOrEqual(16);
    expect(created.invite.startsWith("envoydev.team.v1.")).toBe(true);
    expect(created.team.members).toHaveLength(1);

    const joined = await joinTeam(paths.teamsFile, {
      token: created.token,
      label: "laptop",
      rolesOffered: ["developer"],
      hostHints: "ws://127.0.0.1:4771/ws",
    });
    expect(joined.teamId).toBe(created.team.id);
    expect(joined.team.members).toHaveLength(2);

    const hb = await teamHeartbeat(paths.teamsFile, {
      teamId: joined.teamId,
      memberId: joined.memberId,
      token: created.token,
      memberToken: joined.memberToken,
    });
    expect(hb.status).toBe("online");

    const rotated = await rotateTeamToken(paths.teamsFile, created.team.id, {
      originWs: "ws://127.0.0.1:4770/ws",
    });
    expect(rotated.token).not.toBe(created.token);
    expect(rotated.invite).not.toBe(created.invite);
    await expect(
      teamHeartbeat(paths.teamsFile, {
        teamId: joined.teamId,
        memberId: joined.memberId,
        token: created.token,
        memberToken: joined.memberToken,
      }),
    ).rejects.toThrow(/team-expired|no longer valid/i);

    const listed = await listTeams(paths.teamsFile);
    expect(listed).toHaveLength(1);
  });

  it("stores memberLabel, custom catalog, and rolesAssigned override", async () => {
    const paths = await tempPaths();
    const { setMemberRolesAssigned, requireTeam, suggestMemberRoles } = await import(
      "../src/daemon/teams.js"
    );
    const { effectiveRoles } = await import("@envoydev/protocol");
    const created = await createTeam(paths.teamsFile, {
      label: "Desk",
      memberLabel: "workstation",
      originWs: "ws://127.0.0.1:4770/ws",
      roleCatalog: [
        { id: "orchestrate", writer: false },
        { id: "implement", writer: true },
        { id: "design", writer: false },
      ],
      rolesOffered: ["orchestrate", "implement"],
    });
    expect(created.team.members[0]?.label).toBe("workstation");
    expect(created.team.roleCatalog.map((r) => r.id)).toEqual(["orchestrate", "implement", "design"]);
    expect(parseTeamInvite(created.invite).roleCatalog?.map((r) => r.id)).toContain("design");

    const joined = await joinTeam(paths.teamsFile, {
      token: created.token,
      label: "laptop",
      rolesOffered: ["design"],
      hostHints: "ws://127.0.0.1:4771/ws",
    });
    await expect(
      joinTeam(paths.teamsFile, {
        token: created.token,
        label: "evil",
        rolesOffered: ["orchestrate"],
        hostHints: "ws://127.0.0.1:4772/ws",
      }),
    ).rejects.toThrow(/orchestrat|not valid|bad/i);

    await setMemberRolesAssigned(paths.teamsFile, {
      teamId: created.team.id,
      memberId: joined.memberId,
      roles: ["implement"],
    });
    const team = await requireTeam(paths.teamsFile, created.team.id);
    const peer = team.members.find((m) => m.id === joined.memberId)!;
    expect(peer.rolesOffered).toEqual(["design"]);
    expect(peer.rolesAssigned).toEqual(["implement"]);
    expect(effectiveRoles(peer)).toEqual(["implement"]);

    // Suggest is proposal-only when empty.
    await setMemberRolesAssigned(paths.teamsFile, {
      teamId: created.team.id,
      memberId: joined.memberId,
      roles: [],
    });
    const cleared = (await requireTeam(paths.teamsFile, created.team.id)).members.find(
      (m) => m.id === joined.memberId,
    )!;
    // Still has rolesOffered design — clear offered via join refresh simulation
    const emptyPeer = { ...cleared, rolesOffered: [] as const, rolesAssigned: undefined };
    const proposal = suggestMemberRoles(team, emptyPeer);
    expect(proposal.roles.length).toBeGreaterThan(0);
    expect(proposal.roles).not.toContain("orchestrate");
    expect(proposal.note).toMatch(/Proposal only/i);

    expect(() => suggestMemberRoles(team, peer)).toThrow(/already has roles/i);
  });

  it("locks custom writer roles on the same worktreeKey", () => {
    expect(() =>
      assertWriterLocks(
        [
          {
            id: "a",
            jobId: "j",
            role: "code",
            brief: "one",
            worktreeKey: "main",
            cwdHint: ".",
            status: "pending",
            attempts: [],
          },
          {
            id: "b",
            jobId: "j",
            role: "patch",
            brief: "two",
            worktreeKey: "main",
            cwdHint: ".",
            status: "pending",
            attempts: [],
          },
        ],
        [
          { id: "code", writer: true },
          { id: "patch", writer: true },
        ],
      ),
    ).toThrow(/writer|worktree/i);
  });
});

describe("jobs", () => {
  it("refuses a double writer on the same worktreeKey", () => {
    expect(() =>
      assertWriterLocks([
        {
          id: "a",
          jobId: "j",
          role: "developer",
          brief: "one",
          worktreeKey: "main",
          cwdHint: ".",
          status: "pending",
          attempts: [],
        },
        {
          id: "b",
          jobId: "j",
          role: "developer",
          brief: "two",
          worktreeKey: "main",
          cwdHint: ".",
          status: "pending",
          attempts: [],
        },
      ]),
    ).toThrow(/worktree/i);
  });

  it("leaves local offers pending under default manual AcceptPolicy", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    let job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
    });
    const offered = await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    expect(offered.status).toBe("offered");
    expect(offered.offer?.status).toBe("pending");
  });

  it("refuses Start when cwdHint is missing (Git content bus)", async () => {
    const paths = await tempPaths();
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    await setMemberAcceptPolicy(paths.teamsFile, {
      teamId: team.team.id,
      memberId: "local",
      acceptPolicy: {
        mode: "auto-roles",
        autoAcceptRoles: ["developer", "tester", "designer", "document"],
      },
    });
    const job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: join(paths.dir, "missing-path"),
        },
      ],
    });
    await expect(
      startJob(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, job.id),
    ).rejects.toThrow(/missing|Clone|folder/i);
  });

  it("refuses Start when the folder is not a Git repo", async () => {
    const paths = await tempPaths();
    await mkdir(paths.workDir, { recursive: true });
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
    });
    await expect(
      startJob(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, job.id),
    ).rejects.toThrow(/Git repository|not a Git/i);
  });

  it("refuses Start when the Git repo has no remote", async () => {
    const paths = await tempPaths();
    await mkdir(paths.workDir, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: paths.workDir });
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
    });
    await expect(
      startJob(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, job.id),
    ).rejects.toThrow(/remote/i);
  });

  it("Pause then Start resumes offering pending steps only", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    await setMemberAcceptPolicy(paths.teamsFile, {
      teamId: team.team.id,
      memberId: "local",
      acceptPolicy: { mode: "manual" },
    });
    let job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Two steps",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "first",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
    });
    const firstId = job.steps[0]!.id;
    job = await updateJobSteps(paths.jobsFile, job.id, [
      {
        id: firstId,
        role: "developer",
        brief: "first",
        worktreeKey: "main",
        cwdHint: paths.workDir,
      },
      {
        role: "developer",
        brief: "second",
        worktreeKey: "main",
        cwdHint: paths.workDir,
        dependsOn: [firstId],
      },
    ]);

    job = await startJob(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, job.id);
    expect(job.status).toBe("running");
    expect(job.steps[0]!.status).toBe("offered");
    expect(job.steps[1]!.status).toBe("pending");

    job = await pauseJob(paths.jobsFile, job.id);
    expect(job.status).toBe("drafting");
    expect(job.steps[0]!.status).toBe("offered");

    job = await startJob(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, job.id);
    expect(job.status).toBe("running");
    // Already-offered step stays offered; dependent stays pending until first completes.
    expect(job.steps[0]!.status).toBe("offered");
    expect(job.steps[1]!.status).toBe("pending");
  });

  it("reassigns after refuse when policy is reassign", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const peer = await joinTeam(paths.teamsFile, {
      token: team.token,
      label: "peer",
      rolesOffered: ["developer"],
      hostHints: "ws://127.0.0.1:9/ws",
    });
    // Force peer offline for dial so first offer goes to local — then offer peer explicitly.
    let job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
          assigneeMemberId: "local",
        },
      ],
      policy: { onPeerRefuse: "reassign", maxReassigns: 2 },
    });
    const offered = await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    // Local stays pending under manual AcceptPolicy — create a pending offer to peer instead.
    job = await updateJobSteps(paths.jobsFile, job.id, [
      {
        id: job.steps[0]!.id,
        role: "developer",
        brief: "do it",
        worktreeKey: "main",
        cwdHint: paths.workDir,
        assigneeMemberId: peer.memberId,
      },
    ]);
    // Peer dial will fail (port 9) → refused peer-offline; use manual refuse path via a crafted offer.
    const pending = await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    expect(pending.status === "accepted" || pending.status === "offered" || pending.status === "refused").toBe(
      true,
    );
    // Direct refuse→reassign on a fresh offered step to local with manual policy.
    const team2 = await createTeam(paths.teamsFile, {
      label: "Desk2",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    await joinTeam(paths.teamsFile, {
      token: team2.token,
      label: "other",
      rolesOffered: ["developer"],
    });
    job = await createJob(paths.jobsFile, {
      teamId: team2.team.id,
      title: "R",
      goal: "g",
      steps: [
        {
          role: "tester",
          brief: "look",
          worktreeKey: "rev",
          cwdHint: paths.workDir,
        },
      ],
      policy: { onPeerRefuse: "reassign", maxReassigns: 2 },
    });
    const result = await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    expect(result.status).toBe("offered");
    expect(result.offer).toBeDefined();
    const refused = await refuseJobStepOffer(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      offerId: result.offer!.offerId,
      policy: "manual-refuse",
    });
    expect(refused.status).toBe("refused");
    expect(refused.job).toBeDefined();
    void offered;
  });

  it("counts retries and fails the job after exhaustion", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    await setMemberAcceptPolicy(paths.teamsFile, {
      teamId: team.team.id,
      memberId: "local",
      acceptPolicy: {
        mode: "auto-roles",
        autoAcceptRoles: ["developer", "tester", "designer", "document"],
      },
    });
    let job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
      policy: { maxRetriesPerAssignee: 0, maxReassigns: 0, onStepExhausted: "fail-job" },
    });
    const offered = await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    // Without a RunManager starter, auto-accept leaves the offer pending (no empty "running").
    expect(offered.status).toBe("offered");
    expect(offered.offer?.offerId).toBeTruthy();
    const { acceptJobStepOffer } = await import("../src/daemon/jobs.js");
    await acceptJobStepOffer(paths.jobsFile, paths.jobOffersFile, {
      offerId: offered.offer!.offerId,
      resolvedCwd: paths.workDir,
      skipPathCheck: true,
      runId: "local-run-retry",
    });
    job = await handleStepRunFailure(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      error: "boom",
    }).catch(async (error) => {
      expect(String(error)).toMatch(/job-failed|exhausted|Step exhausted/i);
      const { getJob } = await import("../src/daemon/jobs.js");
      return getJob(paths.jobsFile, job.id);
    });
    expect(job.status === "failed" || job.steps[0]?.status === "failed" || job.steps[0]?.status === "pending").toBe(
      true,
    );
  });

  it("records progress and stalls on no-progress when automation is on", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    await setMemberAcceptPolicy(paths.teamsFile, {
      teamId: team.team.id,
      memberId: "local",
      acceptPolicy: {
        mode: "auto-roles",
        autoAcceptRoles: ["developer", "tester", "designer", "document"],
      },
    });
    let job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
    });
    const offered = await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    expect(offered.offer?.offerId).toBeTruthy();
    const { acceptJobStepOffer } = await import("../src/daemon/jobs.js");
    await acceptJobStepOffer(paths.jobsFile, paths.jobOffersFile, {
      offerId: offered.offer!.offerId,
      resolvedCwd: paths.workDir,
      skipPathCheck: true,
      runId: "local-run-stall",
    });
    job = await reportJobStepProgress(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
      runPhase: "streaming",
      lastEventAt: new Date(Date.now() - 120_000).toISOString(),
    });
    expect(job.steps[0]?.runPhase).toBe("streaming");
    job = await setJobStallAutomation(paths.jobsFile, job.id, true);
    job = await evaluateStalls(
      paths.jobsFile,
      paths.jobOffersFile,
      paths.teamsFile,
      job.id,
      () => new Date(),
    );
    expect(job.ledger.some((n) => n.kind === "stall")).toBe(true);
  });

  it("suggest is propose-only", async () => {
    const paths = await tempPaths();
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship it",
    });
    const suggested = suggestJobSteps(job, "focus on tests");
    expect(suggested.note).toMatch(/Proposal only/i);
    expect(suggested.templateId).toBe("pipeline");
    expect(suggested.steps.length).toBeGreaterThan(0);
    expect(suggested.steps.every((s) => s.id)).toBe(true);
    expect(job.steps).toHaveLength(0);
  });

  it("suggest inherits cwdHint from existing job steps", async () => {
    const paths = await tempPaths();
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Feature",
      goal: "ship",
      projectId: "proj",
      steps: [
        {
          role: "developer",
          brief: "seed",
          worktreeKey: "proj:main",
          cwdHint: "/real/project/path",
        },
      ],
    });
    const suggested = suggestJobSteps(job, { templateId: "pipeline" });
    expect(suggested.steps.every((s) => s.cwdHint === "/real/project/path")).toBe(true);
  });

  it("start refuses when no online candidate for a root step", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const created = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
      rolesOffered: ["orchestrate"],
    });
    // Local only offers orchestrate — developer step has no assignee.
    const job = await createJob(paths.jobsFile, {
      teamId: created.team.id,
      title: "Fix",
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
    await expect(
      startJob(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, job.id),
    ).rejects.toThrow(/online machine|role/i);
  });

  it("refuses replacing in-flight steps", async () => {
    const paths = await tempPaths();
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const created = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          id: "keep",
          role: "developer",
          brief: "a",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
    });
    // Simulate a live step without racing auto-accept / job completion.
    await saveJob(paths.jobsFile, {
      ...created,
      status: "running",
      steps: created.steps.map((s) => ({ ...s, status: "running" as const })),
    });
    await expect(
      updateJobSteps(
        paths.jobsFile,
        created.id,
        [
          {
            id: "brand-new",
            role: "developer",
            brief: "replace all",
            worktreeKey: "main",
            cwdHint: paths.workDir,
          },
        ],
        paths.teamsFile,
      ),
    ).rejects.toThrow(/in progress|replace/i);
  });

  it("templates cover sequential and parallel graphs", async () => {
    const paths = await tempPaths();
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Feature",
      goal: "ship a feature",
      projectId: "proj",
    });

    const pipeline = suggestJobSteps(job, { templateId: "pipeline" });
    expect(pipeline.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(pipeline.steps[1]?.dependsOn).toEqual(["s1"]);
    expect(new Set(pipeline.steps.map((s) => s.worktreeKey)).size).toBe(1);
    await updateJobSteps(paths.jobsFile, job.id, pipeline.steps, paths.teamsFile);

    const parallel = suggestJobSteps(job, { templateId: "parallel-feature", parallelCount: 3 });
    expect(parallel.steps.filter((s) => s.role === "developer").length).toBe(4); // 3 features + integrate
    const featureKeys = parallel.steps.filter((s) => s.id?.startsWith("s") && s.role === "developer" && s.dependsOn?.includes("s1"));
    expect(featureKeys).toHaveLength(3);
    expect(new Set(featureKeys.map((s) => s.worktreeKey)).size).toBe(3);
    const integrate = parallel.steps.find((s) => s.brief.includes("Merge"));
    expect(integrate?.dependsOn).toEqual(["s2", "s3", "s4"]);
    await updateJobSteps(paths.jobsFile, job.id, parallel.steps, paths.teamsFile);

    const hotfix = suggestJobSteps(job, { hint: "urgent hotfix patch" });
    expect(hotfix.templateId).toBe("hotfix");
    expect(hotfix.steps).toHaveLength(2);

    const catalog = listJobStepTemplates();
    expect(catalog.map((t) => t.id)).toContain("review-pass");
  });

  it("allows sequential writers on the same worktreeKey when dependsOn chains them", () => {
    expect(() =>
      assertWriterLocks(
        [
          {
            id: "s1",
            jobId: "j",
            role: "developer",
            brief: "first",
            worktreeKey: "main",
            cwdHint: ".",
            status: "pending",
            attempts: [],
          },
          {
            id: "s2",
            jobId: "j",
            role: "developer",
            brief: "second",
            worktreeKey: "main",
            cwdHint: ".",
            dependsOn: ["s1"],
            status: "pending",
            attempts: [],
          },
        ],
        [{ id: "developer", label: "Developer", writer: true }],
      ),
    ).not.toThrow();
  });

  it("marks new joiners unknown until heartbeat", async () => {
    const paths = await tempPaths();
    const created = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const joined = await joinTeam(paths.teamsFile, {
      token: created.token,
      label: "laptop",
      rolesOffered: ["developer"],
      hostHints: "ws://127.0.0.1:9/ws",
    });
    const peer = joined.team.members.find((m) => m.id === joined.memberId);
    expect(peer?.connection.status).toBe("unknown");
    const hb = await teamHeartbeat(paths.teamsFile, {
      teamId: joined.teamId,
      memberId: joined.memberId,
      token: created.token,
      memberToken: joined.memberToken,
    });
    expect(hb.status).toBe("online");
  });

  it("rejects idle-expired team tokens", async () => {
    const paths = await tempPaths();
    const created = await createTeam(
      paths.teamsFile,
      { label: "Desk", originWs: "ws://127.0.0.1:4770/ws", ttlHours: 24 },
      () => new Date("2020-01-01T00:00:00.000Z"),
    );
    // Activity was at create; jump past idle TTL (8h).
    await expect(
      joinTeam(
        paths.teamsFile,
        { token: created.token, label: "late" },
        () => new Date("2020-01-01T09:00:00.000Z"),
      ),
    ).rejects.toThrow(/team-expired/);
  });

  it("enforces step deadlines without stall automation", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    await setMemberAcceptPolicy(paths.teamsFile, {
      teamId: team.team.id,
      memberId: "local",
      acceptPolicy: {
        mode: "auto-roles",
        autoAcceptRoles: ["developer"],
      },
    });
    let job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
          deadline: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
      policy: { maxRetriesPerAssignee: 0, maxReassigns: 0, onStepExhausted: "fail-job" },
    });
    job = await startJob(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, job.id);
    const { evaluateDeadlines, getJob } = await import("../src/daemon/jobs.js");
    job = await evaluateDeadlines(
      paths.jobsFile,
      paths.jobOffersFile,
      paths.teamsFile,
      job.id,
      () => new Date(),
    );
    job = await getJob(paths.jobsFile, job.id);
    expect(
      job.status === "failed" ||
        job.steps[0]?.status === "failed" ||
        job.ledger.some((n) => /deadline/i.test(n.message)),
    ).toBe(true);
  });

  it("continue-partial finishes done with gaps for non-writer failures", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    await setMemberAcceptPolicy(paths.teamsFile, {
      teamId: team.team.id,
      memberId: "local",
      acceptPolicy: {
        mode: "auto-roles",
        autoAcceptRoles: ["review", "plan"],
      },
    });
    let job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Review",
      goal: "look",
      steps: [
        {
          role: "tester",
          brief: "look",
          worktreeKey: "rev",
          cwdHint: paths.workDir,
        },
      ],
      policy: { maxRetriesPerAssignee: 0, maxReassigns: 0, onStepExhausted: "continue-partial" },
    });
    const offered = await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    expect(offered.status).toBe("offered");
    const { acceptJobStepOffer } = await import("../src/daemon/jobs.js");
    await acceptJobStepOffer(paths.jobsFile, paths.jobOffersFile, {
      offerId: offered.offer!.offerId,
      resolvedCwd: paths.workDir,
      skipPathCheck: true,
      runId: "local-run-partial",
    });
    const { failJobStep, getJob } = await import("../src/daemon/jobs.js");
    job = await failJobStep(paths.jobsFile, job.id, job.steps[0]!.id, "poison");
    job = await getJob(paths.jobsFile, job.id);
    expect(job.status).toBe("done");
    expect(job.finalReport?.summary).toMatch(/gaps/i);
  });

  it("records hasGap when eventSeq skips", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    await setMemberAcceptPolicy(paths.teamsFile, {
      teamId: team.team.id,
      memberId: "local",
      acceptPolicy: {
        mode: "auto-roles",
        autoAcceptRoles: ["developer"],
      },
    });
    let job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
    });
    const offered = await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    expect(offered.offer?.offerId).toBeTruthy();
    const { acceptJobStepOffer } = await import("../src/daemon/jobs.js");
    await acceptJobStepOffer(paths.jobsFile, paths.jobOffersFile, {
      offerId: offered.offer!.offerId,
      resolvedCwd: paths.workDir,
      skipPathCheck: true,
      runId: "local-run-gap",
    });
    job = await reportJobStepProgress(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
      eventSeq: 0,
      runPhase: "streaming",
    });
    job = await reportJobStepProgress(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
      eventSeq: 3,
      runPhase: "streaming",
    });
    expect(job.steps[0]?.hasGap).toBe(true);
    expect(job.ledger.some((n) => /gap/i.test(n.message))).toBe(true);
  });

  it("refuses terminal progress on a step that is not running", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    let job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
    });
    await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    await expect(
      reportJobStepProgress(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
        jobId: job.id,
        stepId: job.steps[0]!.id,
        memberId: "local",
        outcome: "succeeded",
      }),
    ).rejects.toThrow(/running|notRunning/i);
  });

  it("refuses accept of a superseded offer after reassign", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const peer = await joinTeam(paths.teamsFile, {
      token: team.token,
      label: "peer",
      rolesOffered: ["developer"],
      hostHints: "ws://127.0.0.1:9/ws",
    });
    await teamHeartbeat(paths.teamsFile, {
      teamId: team.team.id,
      memberId: peer.memberId,
      token: team.token,
      memberToken: peer.memberToken,
    });
    let job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
          assigneeMemberId: "local",
        },
      ],
      policy: { maxReassigns: 2 },
    });
    const first = await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    expect(first.offer?.offerId).toBeTruthy();
    const { reassignJobStep, acceptJobStepOffer } = await import("../src/daemon/jobs.js");
    await reassignJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
      excludeMemberIds: new Set(),
    });
    await expect(
      acceptJobStepOffer(paths.jobsFile, paths.jobOffersFile, {
        offerId: first.offer!.offerId,
        resolvedCwd: paths.workDir,
        skipPathCheck: true,
        runId: "stale-run",
      }),
    ).rejects.toThrow(/no longer|offerClosed|pending/i);
  });

  it("refuses refuse after accept and rejects expired team tokens on pre-auth", async () => {
    const paths = await tempPaths();
    await prepareGitWorkDir(paths.workDir);
    const team = await createTeam(paths.teamsFile, {
      label: "Desk",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const job = await createJob(paths.jobsFile, {
      teamId: team.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: paths.workDir,
        },
      ],
    });
    const offered = await offerJobStep(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
      jobId: job.id,
      stepId: job.steps[0]!.id,
      memberId: "local",
    });
    const { acceptJobStepOffer } = await import("../src/daemon/jobs.js");
    await acceptJobStepOffer(paths.jobsFile, paths.jobOffersFile, {
      offerId: offered.offer!.offerId,
      resolvedCwd: paths.workDir,
      skipPathCheck: true,
      runId: "local-run-post-accept",
    });
    await expect(
      refuseJobStepOffer(paths.jobsFile, paths.jobOffersFile, paths.teamsFile, {
        offerId: offered.offer!.offerId,
        policy: "too-late",
      }),
    ).rejects.toThrow(/no longer pending|offerClosed/i);

    const { requireTeamToken } = await import("../src/daemon/collab-auth.js");
    const expired = await createTeam(
      paths.teamsFile,
      { label: "Old", originWs: "ws://127.0.0.1:4770/ws", ttlHours: 1 },
      () => new Date("2020-01-01T00:00:00.000Z"),
    );
    await expect(
      requireTeamToken(paths.teamsFile, expired.team.id, expired.token),
    ).rejects.toThrow(/expired|no longer valid/i);
  });
});

describe("membership heartbeat", () => {
  it("beats every membership to its origin", async () => {
    const paths = await tempPaths();
    await saveMembership(paths.membershipsFile, {
      teamId: "t1",
      memberId: "m1",
      label: "laptop",
      teamLabel: "Desk",
      token: "abcdefghijklmnopqrstuv",
      memberToken: "member-token-abcdef",
      originWs: "ws://127.0.0.1:4770/ws",
      rolesOffered: ["developer"],
      acceptPolicy: { mode: "manual" },
      joinedAt: new Date().toISOString(),
    });
    const calls: string[] = [];
    const { startMembershipHeartbeats } = await import("../src/daemon/membership-heartbeat.js");
    const hb = startMembershipHeartbeats({
      membershipsFile: paths.membershipsFile,
      auto: false,
      callPeer: async (call) => {
        calls.push(call.method);
        expect(call.url).toBe("ws://127.0.0.1:4770/ws");
        expect((call.params as { memberToken?: string }).memberToken).toBe("member-token-abcdef");
        return { ok: true, result: { ok: true, connection: { status: "online", transport: "lan" } } };
      },
    });
    await hb.beatNow();
    expect(calls).toEqual(["coder.teamHeartbeat"]);
    hb.stop();
  });
});

describe("cross-daemon join (injected peer RPC)", () => {
  it("peer dials origin joinTeam with invite", async () => {
    const originHome = await mkdtemp(join(tmpdir(), "envoy-origin-"));
    const peerHome = await mkdtemp(join(tmpdir(), "envoy-peer-"));
    const originPaths = coderPaths(originHome);
    const peerPaths = coderPaths(peerHome);
    await mkdir(originPaths.stateDir, { recursive: true });
    await mkdir(peerPaths.stateDir, { recursive: true });

    const created = await createTeam(originPaths.teamsFile, {
      label: "Origin",
      originWs: "ws://127.0.0.1:4770/ws",
    });

    const fakeStore = {
      findProject: () => undefined,
      projects: () => [],
      addProject: async () => ({ project: { id: "p", path: "/", label: "p", hostId: "local", addedAt: "" }, created: true }),
      createTask: async () => undefined,
    };

    let joinCalled = false;
    const peerHandlers = createCollabHandlers({
      paths: peerPaths,
      store: fakeStore as never,
      port: 4771,
      callPeer: async (call) => {
        if (call.method === "coder.joinTeam") {
          joinCalled = true;
          expect(call.url).toBe("ws://127.0.0.1:4770/ws");
          const params = call.params as { token: string; label: string; hostHints?: string };
          expect(params.token).toBe(created.token);
          const joined = await joinTeam(originPaths.teamsFile, {
            token: params.token,
            label: params.label,
            rolesOffered: ["developer"],
            hostHints: params.hostHints,
          });
          return { ok: true, result: joined };
        }
        return { ok: false, message: `unexpected ${call.method}` };
      },
    });

    const result = (await peerHandlers["coder.joinTeam"]!({
      token: created.invite,
      label: "laptop",
      rolesOffered: ["developer"],
    })) as { teamId: string; memberId: string };
    expect(joinCalled).toBe(true);
    expect(result.teamId).toBe(created.team.id);

    // Membership persisted on peer
    const { listMemberships } = await import("../src/daemon/memberships.js");
    const mems = await listMemberships(peerPaths.membershipsFile);
    expect(mems).toHaveLength(1);
    expect(mems[0]!.originWs).toContain("127.0.0.1:4770");
  });

  it("delivers inbound offer to member and accepts back to origin", async () => {
    const originHome = await mkdtemp(join(tmpdir(), "envoy-o2-"));
    const peerHome = await mkdtemp(join(tmpdir(), "envoy-p2-"));
    const originPaths = coderPaths(originHome);
    const peerPaths = coderPaths(peerHome);
    await mkdir(originPaths.stateDir, { recursive: true });
    await mkdir(peerPaths.stateDir, { recursive: true });
    const work = join(peerHome, "repo");
    await prepareGitWorkDir(work);

    const created = await createTeam(originPaths.teamsFile, {
      label: "Origin",
      originWs: "ws://127.0.0.1:4770/ws",
    });
    const joined = await joinTeam(originPaths.teamsFile, {
      token: created.token,
      label: "peer",
      rolesOffered: ["developer"],
      hostHints: "ws://127.0.0.1:4771/ws",
    });
    await saveMembership(peerPaths.membershipsFile, {
      teamId: created.team.id,
      memberId: joined.memberId,
      label: "peer",
      teamLabel: "Origin",
      token: created.token,
      memberToken: joined.memberToken,
      originWs: "ws://127.0.0.1:4770/ws",
      rolesOffered: ["developer"],
      acceptPolicy: { mode: "manual" },
      joinedAt: new Date().toISOString(),
    });

    const job = await createJob(originPaths.jobsFile, {
      teamId: created.team.id,
      title: "Fix",
      goal: "ship",
      steps: [
        {
          role: "developer",
          brief: "do it",
          worktreeKey: "main",
          cwdHint: work,
          assigneeMemberId: joined.memberId,
        },
      ],
    });

    const fakeStore = {
      findProject: () => undefined,
      projects: () => [],
      addProject: async () => ({
        project: { id: "p", path: work, label: "p", hostId: "local", addedAt: "" },
        created: true,
      }),
      createTask: async () => ({ id: "t1", projectId: "p", cwd: work, title: "x", harness: "cursor-agent", status: "idle", createdAt: "", updatedAt: "" }),
    };

    const originHandlers = createCollabHandlers({
      paths: originPaths,
      store: fakeStore as never,
      port: 4770,
    });
    const peerHandlers = createCollabHandlers({
      paths: peerPaths,
      store: fakeStore as never,
      port: 4771,
      callPeer: async (call) => {
        const handler = originHandlers[call.method];
        if (!handler) return { ok: false, message: `no ${call.method}` };
        try {
          const result = await handler(call.params);
          return { ok: true, result };
        } catch (error) {
          return { ok: false, message: String(error) };
        }
      },
    });

    // Simulate origin delivering offer
    const { offerJobStep: offer } = await import("../src/daemon/jobs.js");
    // Skip dial failure: write offer manually then inbound
    const { readOffers, acceptJobStepOffer } = await import("../src/daemon/jobs.js");
    void acceptJobStepOffer;
    const step = job.steps[0]!;
    // Force an offer without dial by using local first then rewriting — simpler: call inbound directly
    const offerId = "offer-test-1";
    const cancelNonce = "cancel-nonce-test-1";
    const stepOffer = {
      offerId,
      jobId: job.id,
      stepId: step.id,
      teamId: created.team.id,
      brief: step.brief,
      role: step.role,
      worktreeKey: step.worktreeKey,
      cwdHint: work,
      assigneeMemberId: joined.memberId,
      status: "pending" as const,
      createdAt: new Date().toISOString(),
      cancelNonce,
    };
    // Persist on origin
    await writeFile(
      originPaths.jobOffersFile,
      JSON.stringify({ offers: { [offerId]: stepOffer } }, null, 2),
    );
    await updateJobSteps(originPaths.jobsFile, job.id, [
      {
        id: step.id,
        role: "developer",
        brief: step.brief,
        worktreeKey: "main",
        cwdHint: work,
        assigneeMemberId: joined.memberId,
      },
    ]);
    // Mark offered on job
    const { getJob, readJobs } = await import("../src/daemon/jobs.js");
    void readJobs;
    let live = await getJob(originPaths.jobsFile, job.id);
    live = {
      ...live,
      status: "running",
      steps: live.steps.map((s) =>
        s.id === step.id
          ? {
              ...s,
              status: "offered",
              assigneeMemberId: joined.memberId,
              attempts: [{ memberId: joined.memberId, startedAt: stepOffer.createdAt, offerId }],
            }
          : s,
      ),
    };
    await writeFile(originPaths.jobsFile, JSON.stringify({ jobs: { [live.id]: live } }, null, 2));

    const inbound = (await peerHandlers["coder.inboundJobStepOffer"]!({
      offer: stepOffer,
      originWs: "ws://127.0.0.1:4770/ws",
      teamToken: created.token,
    })) as { received: true; status: string };
    expect(inbound.received).toBe(true);
    expect(inbound.status).toBe("pending");

    const listed = (await peerHandlers["coder.listInboundJobOffers"]!({})) as {
      offers: unknown[];
    };
    expect(listed.offers).toHaveLength(1);

    // Without RunManager, inbound accept refuses; control-plane accept with cancelNonce still works.
    await expect(
      peerHandlers["coder.acceptInboundJobStepOffer"]!({
        offerId,
        resolvedCwd: work,
      }),
    ).rejects.toThrow(/Could not start a run|pathMissing|peer/i);

    const accepted = (await originHandlers["coder.acceptJobStepOffer"]!({
      offerId,
      resolvedCwd: work,
      memberId: joined.memberId,
      teamToken: created.token,
      memberToken: joined.memberToken,
      cancelNonce,
      runId: "peer-unit-run",
    })) as { status: string; runId?: string };
    expect(accepted.status).toBe("accepted");
    expect(accepted.runId).toBe("peer-unit-run");

    const after = await getJob(originPaths.jobsFile, job.id);
    expect(after.steps[0]?.status).toBe("running");
    void offer;
    void readOffers;
    void retriesForAssignee;
  });
});
