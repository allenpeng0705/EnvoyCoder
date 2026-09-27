/**
 * Crew readiness for starting a Team job (§11.6 / §13).
 *
 * Pure: Job pane and tests share one answer for “can Start?” and what to fix.
 * Matches assign rules in `memberOnlineForAssign` (§4.4): online only, unless
 * `allowDegradedAssignees` is set.
 */

import type { JobRole, MemberStatus } from "@envoydev/protocol";

export type CrewIssueKind =
  | "no-steps"
  | "no-members"
  | "all-offline"
  | "missing-roles";

export type CrewAssessment =
  | { ok: true }
  | {
      ok: false;
      kind: CrewIssueKind;
      /** Roles required by steps that no assignable member covers. */
      missingRoles: readonly JobRole[];
      /** Offline / unknown / (when not allowed) degraded member labels. */
      offlineLabels: readonly string[];
    };

function isAssignable(status: string, allowDegraded: boolean): boolean {
  if (status === "online") return true;
  if (allowDegraded && status === "degraded") return true;
  return false;
}

/**
 * Whether the board can cover every needed step role right now.
 * Empty `neededRoles` with no steps → not startable (`no-steps`).
 */
export function assessCrewReadiness(
  board: readonly MemberStatus[],
  neededRoles: readonly JobRole[],
  options?: { allowDegradedAssignees?: boolean },
): CrewAssessment {
  const allowDegraded = options?.allowDegradedAssignees === true;

  if (neededRoles.length === 0) {
    return { ok: false, kind: "no-steps", missingRoles: [], offlineLabels: [] };
  }

  if (board.length === 0) {
    return { ok: false, kind: "no-members", missingRoles: [...neededRoles], offlineLabels: [] };
  }

  const offlineLabels = board
    .filter((m) => !isAssignable(m.connection.status, allowDegraded))
    .map((m) => m.label);

  const reachable = board.filter((m) => isAssignable(m.connection.status, allowDegraded));
  if (reachable.length === 0) {
    return {
      ok: false,
      kind: "all-offline",
      missingRoles: [...neededRoles],
      offlineLabels,
    };
  }

  const covered = new Set<JobRole>();
  for (const m of reachable) {
    for (const r of m.rolesOffered) covered.add(r);
  }
  const missingRoles = neededRoles.filter((r) => !covered.has(r));
  if (missingRoles.length > 0) {
    return { ok: false, kind: "missing-roles", missingRoles, offlineLabels };
  }

  return { ok: true };
}
