/**
 * Team job create sheet — Git guidance, Copy invite, draft submit (§13 / §11.6).
 */

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@envoydev/protocol";

import { TeamJobCreateSheet } from "../src/components/TeamJobCreateSheet.js";
import { I18nProvider } from "../src/i18n/context.js";
import { stubAgentActions } from "./fixtures/agent-actions.js";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});

const project: Project = {
  id: "local::/work/api",
  path: "/work/api",
  label: "api",
  hostId: "local",
  addedAt: "2026-09-01T09:00:00.000Z",
};

const soloTeam = {
  id: "team-1",
  label: "api team",
  members: [
    {
      id: "local",
      label: "desk",
      connection: { status: "online", transport: "lan" },
    },
  ],
};

describe("TeamJobCreateSheet", () => {
  it("shows policy-specific Git copy and blocks submit while checking", async () => {
    let resolveGit: (v: unknown) => void = () => undefined;
    const gitPending = new Promise((resolve) => {
      resolveGit = resolve;
    });
    const agents = stubAgentActions({
      listTeams: vi.fn(async () => ({ ok: true as const, teams: [soloTeam] })),
      assessGitContentBus: vi.fn(() => gitPending as Promise<{ ok: true; path: string }>),
    });
    render(
      <I18nProvider preference="en">
        <TeamJobCreateSheet
          project={project}
          agents={agents}
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          onOpenTeams={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("team-job-git").getAttribute("data-git")).toBe("checking"));
    fireEvent.change(screen.getByTestId("team-job-title"), { target: { value: "Wire attach" } });
    fireEvent.change(screen.getByTestId("team-job-goal"), { target: { value: "Ship it" } });
    expect((screen.getByTestId("team-job-submit") as HTMLButtonElement).disabled).toBe(true);

    resolveGit({ ok: false, policy: "no-git-remote" });
    await waitFor(() => expect(screen.getByTestId("team-job-git").getAttribute("data-git")).toBe("no-git-remote"));
    expect(screen.getByTestId("team-job-git").textContent).toMatch(/remote/i);
    // Draft still allowed once Git check settles (Start is gated later).
    expect((screen.getByTestId("team-job-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("copies invite for a solo team via getTeamToken", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const agents = stubAgentActions({
      listTeams: vi.fn(async () => ({ ok: true as const, teams: [soloTeam] })),
      assessGitContentBus: vi.fn(async () => ({ ok: true as const, path: project.path })),
      getTeamToken: vi.fn(async () => ({
        ok: true as const,
        teamId: soloTeam.id,
        token: "invite-secret-token",
      })),
    });
    render(
      <I18nProvider preference="en">
        <TeamJobCreateSheet
          project={project}
          agents={agents}
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          onOpenTeams={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect((screen.getByTestId("team-job-copy-invite") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("team-job-copy-invite"));
    await waitFor(() => expect(agents.getTeamToken).toHaveBeenCalledWith(soloTeam.id));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("invite-secret-token"));
    expect(screen.getByText(/Invite copied/i)).toBeTruthy();
  });

  it("creates a draft job with project cwd and opens the pane", async () => {
    const onCreated = vi.fn();
    const agents = stubAgentActions({
      listTeams: vi.fn(async () => ({ ok: true as const, teams: [soloTeam] })),
      assessGitContentBus: vi.fn(async () => ({ ok: true as const, path: project.path })),
      createJob: vi.fn(async () => ({
        ok: true as const,
        job: { id: "job-9", title: "Wire", goal: "Ship", teamId: soloTeam.id },
      })),
    });
    render(
      <I18nProvider preference="en">
        <TeamJobCreateSheet
          project={project}
          agents={agents}
          onCreated={onCreated}
          onCancel={vi.fn()}
          onOpenTeams={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("team-job-git").getAttribute("data-git")).toBe("ok"));
    fireEvent.change(screen.getByTestId("team-job-title"), { target: { value: "Wire" } });
    fireEvent.change(screen.getByTestId("team-job-goal"), { target: { value: "Ship" } });
    expect((screen.getByTestId("team-job-submit") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("team-job-submit"));
    await waitFor(() => expect(agents.createJob).toHaveBeenCalled());
    expect(agents.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: soloTeam.id,
        projectId: project.id,
        title: "Wire",
        goal: "Ship",
        steps: [
          expect.objectContaining({
            role: "developer",
            cwdHint: project.path,
            worktreeKey: `${project.id}:main`,
          }),
        ],
      }),
    );
    expect(onCreated).toHaveBeenCalledWith("job-9");
  });

  it("ignores a second Create team click while the first is in flight", async () => {
    let resolveCreate: (v: unknown) => void = () => undefined;
    const createPending = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    const createTeam = vi.fn(() => createPending as Promise<{
      ok: true;
      team: { id: string; label: string; members: typeof soloTeam.members };
      token: string;
      invite: string;
    }>);
    const agents = stubAgentActions({
      listTeams: vi.fn(async () => ({ ok: true as const, teams: [] })),
      assessGitContentBus: vi.fn(async () => ({ ok: true as const, path: project.path })),
      createTeam,
    });
    render(
      <I18nProvider preference="en">
        <TeamJobCreateSheet
          project={project}
          agents={agents}
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          onOpenTeams={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("team-job-no-team")).toBeTruthy());
    const button = screen.getByRole("button", { name: /Create team/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(createTeam).toHaveBeenCalledTimes(1);
    expect(createTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "api",
        memberLabel: "Orchestrator · api",
      }),
    );

    resolveCreate({
      ok: true,
      team: { id: "team-new", label: "api", members: soloTeam.members },
      token: "tok",
      invite: "invite-uri",
    });
    await waitFor(() => expect(screen.getByTestId("team-job-invite")).toBeTruthy());
    expect(createTeam).toHaveBeenCalledTimes(1);
  });

  it("prefills the job title from the project and keeps it editable", async () => {
    const agents = stubAgentActions({
      listTeams: vi.fn(async () => ({ ok: true as const, teams: [soloTeam] })),
      assessGitContentBus: vi.fn(async () => ({ ok: true as const, path: project.path })),
    });
    render(
      <I18nProvider preference="en">
        <TeamJobCreateSheet
          project={project}
          agents={agents}
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          onOpenTeams={vi.fn()}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("team-job-title")).toBeTruthy());
    const title = screen.getByTestId("team-job-title") as HTMLInputElement;
    expect(title.value).toBe("api");
    fireEvent.change(title, { target: { value: "Ship attach" } });
    expect(title.value).toBe("Ship attach");
  });

  it("dissolves a provisional team when Cancel is pressed before Create draft", async () => {
    const dissolveTeam = vi.fn(async () => ({ ok: true as const, dissolved: true as const }));
    const createdTeam = {
      id: "team-new",
      label: "api",
      members: soloTeam.members,
    };
    const listTeams = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, teams: [] })
      .mockResolvedValue({ ok: true as const, teams: [createdTeam] });
    const agents = stubAgentActions({
      listTeams,
      assessGitContentBus: vi.fn(async () => ({ ok: true as const, path: project.path })),
      createTeam: vi.fn(async () => ({
        ok: true as const,
        team: createdTeam,
        token: "tok",
        invite: "invite-uri",
      })),
      dissolveTeam,
    });
    const onCancel = vi.fn();
    render(
      <I18nProvider preference="en">
        <TeamJobCreateSheet
          project={project}
          agents={agents}
          onCreated={vi.fn()}
          onCancel={onCancel}
          onOpenTeams={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("team-job-no-team")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Create team/i }));
    await waitFor(() => expect(screen.getByTestId("team-job-invite")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    await waitFor(() => expect(dissolveTeam).toHaveBeenCalledWith("team-new"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("dissolves a provisional team when the sheet unmounts without Cancel", async () => {
    const dissolveTeam = vi.fn(async () => ({ ok: true as const, dissolved: true as const }));
    const createdTeam = {
      id: "team-orphan",
      label: "api",
      members: soloTeam.members,
    };
    const listTeams = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, teams: [] })
      .mockResolvedValue({ ok: true as const, teams: [createdTeam] });
    const agents = stubAgentActions({
      listTeams,
      assessGitContentBus: vi.fn(async () => ({ ok: true as const, path: project.path })),
      createTeam: vi.fn(async () => ({
        ok: true as const,
        team: createdTeam,
        token: "tok",
        invite: "invite-uri",
      })),
      dissolveTeam,
    });
    const view = render(
      <I18nProvider preference="en">
        <TeamJobCreateSheet
          project={project}
          agents={agents}
          onCreated={vi.fn()}
          onCancel={vi.fn()}
          onOpenTeams={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("team-job-no-team")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Create team/i }));
    await waitFor(() => expect(screen.getByTestId("team-job-invite")).toBeTruthy());
    view.unmount();
    await waitFor(() => expect(dissolveTeam).toHaveBeenCalledWith("team-orphan"));
  });
});
