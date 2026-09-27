/**
 * Crew readiness for Team job Start (§11.6 / §13).
 */

import { describe, expect, it } from "vitest";

import type { MemberStatus } from "@envoydev/protocol";

import { assessCrewReadiness } from "../src/daemon/job-crew.js";

function member(
  partial: Partial<MemberStatus> & Pick<MemberStatus, "memberId" | "label" | "rolesOffered">,
): MemberStatus {
  return {
    connection: { status: "online", transport: "lan" },
    ...partial,
  };
}

describe("assessCrewReadiness", () => {
  it("refuses start with no steps", () => {
    const r = assessCrewReadiness(
      [member({ memberId: "local", label: "desk", rolesOffered: ["developer"] })],
      [],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("no-steps");
  });

  it("refuses when the board is empty", () => {
    const r = assessCrewReadiness([], ["developer"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("no-members");
  });

  it("refuses when everyone is offline", () => {
    const r = assessCrewReadiness(
      [
        member({
          memberId: "a",
          label: "laptop",
          rolesOffered: ["developer"],
          connection: { status: "offline", transport: "none" },
        }),
      ],
      ["developer"],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("all-offline");
      expect(r.offlineLabels).toContain("laptop");
    }
  });

  it("names missing roles when online peers cannot cover steps", () => {
    const r = assessCrewReadiness(
      [member({ memberId: "local", label: "desk", rolesOffered: ["developer"] })],
      ["developer", "tester"],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("missing-roles");
      expect(r.missingRoles).toEqual(["tester"]);
    }
  });

  it("treats degraded as offline unless allowDegradedAssignees", () => {
    const board = [
      member({ memberId: "local", label: "desk", rolesOffered: ["developer"] }),
      member({
        memberId: "b",
        label: "laptop",
        rolesOffered: ["tester"],
        connection: { status: "degraded", transport: "mesh" },
      }),
    ];
    const blocked = assessCrewReadiness(board, ["developer", "tester"]);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.kind).toBe("missing-roles");
      expect(blocked.missingRoles).toEqual(["tester"]);
    }

    const allowed = assessCrewReadiness(board, ["developer", "tester"], {
      allowDegradedAssignees: true,
    });
    expect(allowed).toEqual({ ok: true });
  });

  it("allows start when online members cover every role", () => {
    const r = assessCrewReadiness(
      [
        member({ memberId: "local", label: "desk", rolesOffered: ["developer"] }),
        member({
          memberId: "b",
          label: "laptop",
          rolesOffered: ["tester"],
          connection: { status: "online", transport: "mesh" },
        }),
      ],
      ["developer", "tester"],
    );
    expect(r).toEqual({ ok: true });
  });
});
