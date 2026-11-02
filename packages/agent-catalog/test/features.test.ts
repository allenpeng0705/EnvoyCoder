import { describe, expect, it } from "vitest";

import { composerFeatures, featureSessionConfigs } from "../src/features.js";

describe("composerFeatures", () => {
  it("shows Plan for Codex and never a dead Fast toggle", () => {
    expect(composerFeatures("codex", undefined).map((feature) => feature.id)).toEqual(["plan_mode"]);
    expect(composerFeatures("codex", "openai/gpt-5.5").map((feature) => feature.id)).toEqual([
      "plan_mode",
    ]);
    expect(composerFeatures("codex", "gpt-4.1").map((feature) => feature.id)).toEqual(["plan_mode"]);
  });

  it("hides Fast for Claude until an ACP wire exists; Plan only on Envoy", () => {
    expect(composerFeatures("claudecode", "claude-opus-4-6")).toEqual([]);
    expect(composerFeatures("claudecode", "claude-sonnet-4-6")).toEqual([]);
    expect(composerFeatures("envoy-harness", "gpt-5.5").map((feature) => feature.id)).toEqual([
      "plan_mode",
    ]);
    expect(composerFeatures("envoy-harness", "gpt-5.5")[0]?.config).toBeUndefined();
  });

  it("emits Codex collaboration_mode configs from remembered Plan", () => {
    expect(
      featureSessionConfigs("codex", "gpt-5.5", { planMode: true }),
    ).toEqual([{ configId: "collaboration_mode", value: "plan" }]);
  });
});
