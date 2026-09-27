/**
 * Job pane reassign candidate naming (§11.5).
 */

import { describe, expect, it } from "vitest";

import type { MemberStatus } from "@envoydev/protocol";

import { suggestReassignMember } from "../src/components/JobPane.js";

function member(
  partial: Partial<MemberStatus> & Pick<MemberStatus, "memberId" | "label" | "rolesOffered">,
): MemberStatus {
  return {
    connection: { status: "online", transport: "lan" },
    ...partial,
  };
}

describe("suggestReassignMember", () => {
  it("picks the next online peer that offers the step role", () => {
    const board = [
      member({ memberId: "local", label: "This machine", rolesOffered: ["developer"] }),
      member({ memberId: "peer-a", label: "laptop", rolesOffered: ["developer", "tester"] }),
      member({
        memberId: "peer-b",
        label: "desk",
        rolesOffered: ["review"],
        connection: { status: "offline", transport: "none" },
      }),
    ];
    const next = suggestReassignMember(board, { role: "developer", assigneeMemberId: "local" });
    expect(next?.label).toBe("laptop");
  });

  it("returns undefined when nobody else is eligible", () => {
    const board = [
      member({ memberId: "local", label: "This machine", rolesOffered: ["developer"] }),
      member({
        memberId: "peer-a",
        label: "laptop",
        rolesOffered: ["review"],
        connection: { status: "online", transport: "lan" },
      }),
    ];
    expect(suggestReassignMember(board, { role: "developer", assigneeMemberId: "local" })).toBeUndefined();
  });

  it("skips degraded peers unless allowDegradedAssignees", () => {
    const board = [
      member({ memberId: "local", label: "This machine", rolesOffered: ["developer"] }),
      member({
        memberId: "peer-a",
        label: "laptop",
        rolesOffered: ["developer"],
        connection: { status: "degraded", transport: "mesh" },
      }),
    ];
    expect(
      suggestReassignMember(board, { role: "developer", assigneeMemberId: "local" }),
    ).toBeUndefined();
    expect(
      suggestReassignMember(board, { role: "developer", assigneeMemberId: "local" }, {
        allowDegradedAssignees: true,
      })?.label,
    ).toBe("laptop");
  });
});
