/**
 * Whether the permission card offers “don't ask again” — any deliverable asking wire
 * (policy or unattended-mode), plus catalogue YOLO providers.
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

  it("is true for unattended-mode agents (Claude / Codex / DeepSeek)", () => {
    expect(
      canStopAskingApprovals({
        harnessId: "claudecode",
        requireApproval: true,
      }),
    ).toBe(true);
    expect(
      canStopAskingApprovals({
        harnessId: "deepseek-harness",
        requireApproval: true,
      }),
    ).toBe(true);
    expect(
      canStopAskingApprovals({
        harnessId: "codex",
        requireApproval: true,
      }),
    ).toBe(true);
  });

  it("is true for catalogue YOLO providers (Gemini / Qwen)", () => {
    expect(
      canStopAskingApprovals({
        harnessId: "gemini-provider",
        requireApproval: true,
        catalogEntryId: "gemini",
      }),
    ).toBe(true);
    expect(
      canStopAskingApprovals({
        harnessId: "qwen-code",
        requireApproval: true,
        catalogEntryId: "qwen-code",
      }),
    ).toBe(true);
  });

  it("is false for custom providers without a catalogue YOLO mode", () => {
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
