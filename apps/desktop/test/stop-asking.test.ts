/**
 * Whether the permission card offers “don't ask again” — catalogue policy wire only.
 * Custom providers and unattended-mode agents never get the button: the daemon only
 * flips Settings for shipped `askingControl === "policy"` agents.
 */

import { describe, expect, it } from "vitest";

import { canStopAskingApprovals } from "../src/composer/stop-asking.js";

describe("canStopAskingApprovals", () => {
  it("is true for Envoy Harness even when the live harness list is empty", () => {
    expect(
      canStopAskingApprovals({
        harnessId: "envoy-harness",
        requireApproval: true,
      }),
    ).toBe(true);
  });

  it("stays false when Settings already turned asking off", () => {
    expect(
      canStopAskingApprovals({
        harnessId: "envoy-harness",
        requireApproval: false,
      }),
    ).toBe(false);
  });

  it("is false for agents that only have an unattended mode, not set_policy", () => {
    expect(
      canStopAskingApprovals({
        harnessId: "claudecode",
        requireApproval: true,
      }),
    ).toBe(false);
    expect(
      canStopAskingApprovals({
        harnessId: "deepseek-harness",
        requireApproval: true,
      }),
    ).toBe(false);
  });

  it("is false for custom providers — the daemon has no Settings Off path for them", () => {
    expect(
      canStopAskingApprovals({
        harnessId: "my-custom-agent",
        requireApproval: true,
      }),
    ).toBe(false);
  });

  it("is false for shipped agents with askingControl none (Copilot, OMP, …)", () => {
    expect(
      canStopAskingApprovals({
        harnessId: "copilot",
        requireApproval: true,
      }),
    ).toBe(false);
    expect(
      canStopAskingApprovals({
        harnessId: "omp",
        requireApproval: true,
      }),
    ).toBe(false);
  });
});
