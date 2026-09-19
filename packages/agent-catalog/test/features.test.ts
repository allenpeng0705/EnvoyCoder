import { describe, expect, it } from "vitest";

import { composerFeatures, featureSessionConfigs } from "../src/features.js";

describe("composer feature toggles", () => {
  it("gives Codex Plan always, and Fast only for a model that accepts it", () => {
    expect(composerFeatures("codex", undefined).map((feature) => feature.id)).toEqual(["plan_mode"]);
    expect(composerFeatures("codex", "openai/gpt-5.5").map((feature) => feature.id)).toEqual([
      "fast_mode",
      "plan_mode",
    ]);
    expect(composerFeatures("codex", "gpt-4.1").map((feature) => feature.id)).toEqual(["plan_mode"]);
  });

  it("gives Claude Fast only for Opus, and never a second Plan control", () => {
    expect(composerFeatures("claudecode", "claude-opus-4-6").map((feature) => feature.id)).toEqual([
      "fast_mode",
    ]);
    expect(composerFeatures("claudecode", "claude-sonnet-4-6")).toEqual([]);
    expect(composerFeatures("envoy-harness", "gpt-5.5")).toEqual([]);
  });

  it("sends Codex plan as collaboration_mode, and does not invent a Fast config", () => {
    expect(
      featureSessionConfigs("codex", "gpt-5.5", { planMode: true, fastMode: true }),
    ).toEqual([{ configId: "collaboration_mode", value: "plan" }]);
    expect(featureSessionConfigs("codex", "gpt-5.5", { planMode: false })).toEqual([
      { configId: "collaboration_mode", value: "default" },
    ]);
    expect(featureSessionConfigs("codex", "gpt-5.5", {})).toEqual([]);
    expect(featureSessionConfigs("envoy-harness", "gpt-5.5", { planMode: true })).toEqual([]);
  });
});
