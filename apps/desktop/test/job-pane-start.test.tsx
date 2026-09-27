/**
 * Job pane Start gate — crew + Git via assessTeamJobReadiness (§11.6).
 */

/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FAILURE_POLICY,
  DEFAULT_STALL_POLICY,
  type Job,
  type MemberStatus,
} from "@envoydev/protocol";

import { JobPane } from "../src/components/JobPane.js";
import { I18nProvider } from "../src/i18n/context.js";
import { stubAgentActions } from "./fixtures/agent-actions.js";

afterEach(cleanup);

function draftJob(over: Partial<Job> = {}): Job {
  const id = over.id ?? "job-1";
  return {
    id,
    teamId: "team-1",
    projectId: "local::/work/api",
    title: "Wire attach",
    goal: "Ship",
    status: "drafting",
    steps: [
      {
        id: "s1",
        jobId: id,
        role: "developer",
        brief: "implement",
        worktreeKey: "main",
        cwdHint: "/work/api",
        status: "pending",
        attempts: [],
      },
    ],
    policy: { ...DEFAULT_FAILURE_POLICY },
    stallPolicy: { ...DEFAULT_STALL_POLICY },
    ledger: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function member(
  partial: Partial<MemberStatus> & Pick<MemberStatus, "memberId" | "label" | "rolesOffered">,
): MemberStatus {
  return {
    connection: { status: "online", transport: "lan" },
    ...partial,
  };
}

function readyAnswer(job: Job, board: readonly MemberStatus[]) {
  return {
    ok: true as const,
    canStart: true,
    jobStatus: job.status,
    message: "",
    missingRoles: [] as const,
    offlineLabels: [] as const,
    git: { ok: true as const },
    board,
  };
}

function startButton(): HTMLButtonElement {
  return screen.getByTestId("job-start") as HTMLButtonElement;
}

describe("JobPane Start gate", () => {
  it("enables Start when assessTeamJobReadiness says canStart", async () => {
    const job = draftJob();
    const board = [member({ memberId: "local", label: "desk", rolesOffered: ["developer"] })];
    const agents = stubAgentActions({
      getJob: vi.fn(async () => ({ ok: true as const, job })),
      assessTeamJobReadiness: vi.fn(async () => readyAnswer(job, board)),
      teamStatus: vi.fn(async () => ({
        ok: true as const,
        team: { members: [{ id: "local", acceptPolicy: { mode: "manual" } }] },
        board,
      })),
      listJobOffers: vi.fn(async () => ({ ok: true as const, offers: [] })),
      listJobStepTemplates: vi.fn(async () => ({
        ok: true as const,
        templates: [{ id: "pipeline", title: "Pipeline", detail: "" }],
      })),
    });
    render(
      <I18nProvider preference="en">
        <JobPane jobId={job.id} agents={agents} onClose={vi.fn()} onOpenTeams={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(startButton().disabled).toBe(false));
    expect(screen.queryByTestId("job-crew-guidance")).toBeNull();
  });

  it("shows Checking Git while readiness is in flight, then policy-specific block", async () => {
    let resolveReady: (v: unknown) => void = () => undefined;
    const readyPending = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const job = draftJob();
    const board = [member({ memberId: "local", label: "desk", rolesOffered: ["developer"] })];
    const agents = stubAgentActions({
      getJob: vi.fn(async () => ({ ok: true as const, job })),
      assessTeamJobReadiness: vi.fn(() => readyPending as Promise<ReturnType<typeof readyAnswer>>),
      teamStatus: vi.fn(async () => ({
        ok: true as const,
        team: { members: [{ id: "local", acceptPolicy: { mode: "manual" } }] },
        board,
      })),
      listJobOffers: vi.fn(async () => ({ ok: true as const, offers: [] })),
      listJobStepTemplates: vi.fn(async () => ({
        ok: true as const,
        templates: [{ id: "pipeline", title: "Pipeline", detail: "" }],
      })),
    });
    render(
      <I18nProvider preference="en">
        <JobPane jobId={job.id} agents={agents} onClose={vi.fn()} onOpenTeams={vi.fn()} />
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("job-crew-guidance").getAttribute("data-git")).toBe("checking"),
    );
    expect(startButton().disabled).toBe(true);
    expect(screen.getByTestId("job-crew-guidance").textContent).toMatch(/Checking Git/i);

    resolveReady({
      ok: true,
      canStart: false,
      jobStatus: "drafting",
      message: "This project is not a Git repository. Team jobs need Git to share files.",
      messageKey: "teamJob.git.notARepo",
      blockKind: "git",
      missingRoles: [],
      offlineLabels: [],
      git: { ok: false, policy: "not-a-git-repo" },
      board,
    });
    await waitFor(() =>
      expect(screen.getByTestId("job-crew-guidance").getAttribute("data-git")).toBe("not-a-git-repo"),
    );
    expect(screen.getByTestId("job-crew-guidance").textContent).toMatch(/not a Git repository/i);
    expect(startButton().disabled).toBe(true);
  });

  it("blocks Start for missing roles from readiness (parallel steps, not dependsOn)", async () => {
    const job = draftJob({
      steps: [
        {
          id: "s1",
          jobId: "job-1",
          role: "developer",
          brief: "code",
          worktreeKey: "a",
          cwdHint: "/work/api",
          status: "pending",
          attempts: [],
        },
        {
          id: "s2",
          jobId: "job-1",
          role: "tester",
          brief: "test",
          worktreeKey: "b",
          cwdHint: "/work/api",
          status: "pending",
          attempts: [],
        },
      ],
    });
    const board = [member({ memberId: "local", label: "desk", rolesOffered: ["developer"] })];
    const agents = stubAgentActions({
      getJob: vi.fn(async () => ({ ok: true as const, job })),
      assessTeamJobReadiness: vi.fn(async () => ({
        ok: true as const,
        canStart: false,
        jobStatus: "drafting",
        message: "No online machine offers: tester.",
        messageKey: "job.pane.crew.missingRoles",
        messageValues: { roles: "tester" },
        blockKind: "missing-roles",
        missingRoles: ["tester"] as const,
        offlineLabels: [] as const,
        git: { ok: true as const },
        board,
      })),
      teamStatus: vi.fn(async () => ({
        ok: true as const,
        team: { members: [{ id: "local", acceptPolicy: { mode: "manual" } }] },
        board,
      })),
      listJobOffers: vi.fn(async () => ({ ok: true as const, offers: [] })),
      listJobStepTemplates: vi.fn(async () => ({
        ok: true as const,
        templates: [{ id: "pipeline", title: "Pipeline", detail: "" }],
      })),
    });
    render(
      <I18nProvider preference="en">
        <JobPane jobId={job.id} agents={agents} onClose={vi.fn()} onOpenTeams={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("job-crew-guidance")).toBeTruthy());
    expect(startButton().disabled).toBe(true);
    expect(screen.getByTestId("job-crew-guidance").textContent).toMatch(/tester/i);
    expect(screen.getByText(/Open Teams/i)).toBeTruthy();
  });

  it("keeps the last board when teamStatus fails on a later reload", async () => {
    const job = draftJob();
    let statusOk = true;
    const board = [member({ memberId: "local", label: "desk", rolesOffered: ["developer"] })];
    const teamStatus = vi.fn(async () =>
      statusOk
        ? {
            ok: true as const,
            team: { members: [{ id: "local", acceptPolicy: { mode: "manual" } }] },
            board,
          }
        : { ok: false as const, message: "blip" },
    );
    const base = {
      getJob: vi.fn(async () => ({ ok: true as const, job })),
      assessTeamJobReadiness: vi.fn(async () => readyAnswer(job, board)),
      teamStatus,
      listJobOffers: vi.fn(async () => ({ ok: true as const, offers: [] })),
      listJobStepTemplates: vi.fn(async () => ({
        ok: true as const,
        templates: [{ id: "pipeline", title: "Pipeline", detail: "" }],
      })),
    };
    const { rerender } = render(
      <I18nProvider preference="en">
        <JobPane jobId={job.id} agents={stubAgentActions(base)} onClose={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(startButton().disabled).toBe(false));

    statusOk = false;
    rerender(
      <I18nProvider preference="en">
        <JobPane jobId={job.id} agents={stubAgentActions(base)} onClose={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/Could not refresh the team board/i)).toBeTruthy(),
    );
    expect(startButton().disabled).toBe(false);
  });
});
