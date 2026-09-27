/**
 * Combined Start readiness for a Team job — crew + Git content bus.
 *
 * One answer for desktop Job pane and Mobile: can Start now, and if not, why
 * (structured kind + user-facing message / messageRef). Daemon is the source of
 * truth so the phone never invents a second gate.
 */

import type { Job, JobRole, JobStep, MemberStatus } from "@envoydev/protocol";

import { assessCrewReadiness, type CrewAssessment } from "./job-crew.js";
import {
  assessGitContentBus,
  gitContentBusMessage,
  type GitContentBusPolicy,
} from "./job-git-readiness.js";
import {
  buildMemberStatusBoard,
  refreshConnectionStatuses,
  requireTeam,
} from "./teams.js";

/** Same rule as `dependenciesSatisfied` in jobs.ts — kept local to avoid a jobs ↔ readiness import. */
function depsOk(step: JobStep, steps: readonly JobStep[]): boolean {
  if (!step.dependsOn || step.dependsOn.length === 0) return true;
  const byId = new Map(steps.map((s) => [s.id, s]));
  return step.dependsOn.every((id) => byId.get(id)?.status === "succeeded");
}

/**
 * Roles Start must cover right now — pending roots only (same filter as `startJob`).
 * Including finished / blocked-on-deps steps would falsely block Mobile after a pause/resume path.
 */
export function rolesNeededToStart(job: Job): JobRole[] {
  const roots = job.steps.filter((s) => s.status === "pending" && depsOk(s, job.steps));
  return [...new Set(roots.map((s) => s.role))];
}

export type TeamJobBlockKind =
  | "no-steps"
  | "no-members"
  | "all-offline"
  | "missing-roles"
  | "git"
  | "not-drafting";

export type TeamJobReadiness =
  | {
      canStart: true;
      jobStatus: Job["status"];
      crew: { ok: true };
      git: { ok: true };
      /** Empty when ready. */
      message: "";
      messageKey?: undefined;
      messageValues?: undefined;
      blockKind?: undefined;
      missingRoles: readonly JobRole[];
      offlineLabels: readonly string[];
      board: readonly MemberStatus[];
    }
  | {
      canStart: false;
      jobStatus: Job["status"];
      crew: CrewAssessment;
      git: { ok: true } | { ok: false; policy: GitContentBusPolicy };
      message: string;
      messageKey: string;
      messageValues?: Record<string, string>;
      blockKind: TeamJobBlockKind;
      missingRoles: readonly JobRole[];
      offlineLabels: readonly string[];
      board: readonly MemberStatus[];
    };

function crewMessage(crew: Exclude<CrewAssessment, { ok: true }>): {
  message: string;
  messageKey: string;
  messageValues?: Record<string, string>;
} {
  switch (crew.kind) {
    case "no-steps":
      return {
        message: "Add steps before starting (use a step template).",
        messageKey: "job.pane.crew.noSteps",
      };
    case "no-members":
      return {
        message: "This team has no machines yet. Invite someone from Teams.",
        messageKey: "job.pane.crew.noMembers",
      };
    case "all-offline": {
      const machines = crew.offlineLabels.join(", ") || "—";
      return {
        message: `No machines online. Waiting for: ${machines}.`,
        messageKey: "job.pane.crew.allOffline",
        messageValues: { machines },
      };
    }
    case "missing-roles": {
      const roles = crew.missingRoles.join(", ");
      return {
        message: `No online machine offers: ${roles}. Fix roles on desktop Teams, or wait for the right peer.`,
        messageKey: "job.pane.crew.missingRoles",
        messageValues: { roles },
      };
    }
    default: {
      const _exhaustive: never = crew.kind;
      return _exhaustive;
    }
  }
}

function gitMessageKey(policy: GitContentBusPolicy): string {
  switch (policy) {
    case "path-missing":
      return "teamJob.git.pathMissing";
    case "not-a-git-repo":
      return "teamJob.git.notARepo";
    case "no-git-remote":
      return "teamJob.git.noRemote";
    case "git-missing":
      return "teamJob.git.missing";
    default: {
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }
}

/**
 * Measure whether `job` can Start right now on this origin.
 */
export async function assessTeamJobReadiness(options: {
  teamsFile: string;
  job: Job;
}): Promise<TeamJobReadiness> {
  const { job } = options;
  await refreshConnectionStatuses(options.teamsFile);
  const team = await requireTeam(options.teamsFile, job.teamId);
  const board = buildMemberStatusBoard(team, [job]);
  const neededRoles = rolesNeededToStart(job);
  const crew = assessCrewReadiness(board, neededRoles, {
    allowDegradedAssignees: job.policy.allowDegradedAssignees === true,
  });

  const cwds = [...new Set(job.steps.map((s) => s.cwdHint).filter((c) => c.trim() !== ""))];
  let git: { ok: true } | { ok: false; policy: GitContentBusPolicy } = { ok: true };
  if (cwds.length === 0) {
    git = { ok: false, policy: "path-missing" };
  } else {
    for (const cwd of cwds) {
      const assessed = await assessGitContentBus(cwd);
      if (!assessed.ok) {
        git = { ok: false, policy: assessed.policy };
        break;
      }
    }
  }

  const missingRoles = !crew.ok ? crew.missingRoles : [];
  const offlineLabels = !crew.ok ? crew.offlineLabels : [];

  if (job.status !== "drafting") {
    return {
      canStart: false,
      jobStatus: job.status,
      crew,
      git,
      message: "Only a drafting job can be started.",
      messageKey: "error.job.notDrafting",
      blockKind: "not-drafting",
      missingRoles,
      offlineLabels,
      board,
    };
  }

  if (!git.ok) {
    return {
      canStart: false,
      jobStatus: job.status,
      crew,
      git,
      message: gitContentBusMessage(git.policy),
      messageKey: gitMessageKey(git.policy),
      blockKind: "git",
      missingRoles,
      offlineLabels,
      board,
    };
  }

  if (!crew.ok) {
    const copy = crewMessage(crew);
    return {
      canStart: false,
      jobStatus: job.status,
      crew,
      git,
      message: copy.message,
      messageKey: copy.messageKey,
      ...(copy.messageValues ? { messageValues: copy.messageValues } : {}),
      blockKind: crew.kind,
      missingRoles: crew.missingRoles,
      offlineLabels: crew.offlineLabels,
      board,
    };
  }

  return {
    canStart: true,
    jobStatus: job.status,
    crew: { ok: true },
    git: { ok: true },
    message: "",
    missingRoles: [],
    offlineLabels: [],
    board,
  };
}
