/**
 * The two composer toggles Paseo draws beside mode, model, and thinking.
 *
 * They are agent features, not a fourth mode: Codex shows Plan always; Envoy Harness shows Plan
 * as a working mode. Fast used to appear for eligible Codex/Claude models, but neither vendor
 * documents an ACP config this build can send — a dead toggle lied about autonomy, so Fast stays
 * hidden until a real wire exists (Wave 3B).
 *
 * Plan is the one this daemon can actually apply. Codex publishes `collaboration_mode` (`default` |
 * `plan`) and accepts it through `session/set_config_option`. Envoy Plan is `session/set_mode`.
 */

import type { HarnessId } from "@envoydev/protocol";

export type AgentFeatureId = "fast_mode" | "plan_mode";

export interface AgentFeatureToggle {
  id: AgentFeatureId;
  /** Yellow when Fast is on, blue when Plan is on. */
  highlight: "yellow" | "blue";
  /**
   * The session option the next run sets, when this agent accepts one.
   * Absent means the value is stored and not sent (Envoy Plan uses set_mode instead).
   */
  config?: { configId: string; on: string; off: string };
}

/** Which toggles this agent shows for this model, in toolbar order. */
export function composerFeatures(
  harness: HarnessId,
  _modelId: string | undefined,
): readonly AgentFeatureToggle[] {
  if (harness === "codex") {
    return [
      {
        id: "plan_mode",
        highlight: "blue",
        config: { configId: "collaboration_mode", on: "plan", off: "default" },
      },
    ];
  }
  if (harness === "envoy-harness") {
    // Plan is a working mode, not a permission. It is sent as `session/set_mode`, not as a config
    // option, so this entry has no `config`.
    return [{ id: "plan_mode", highlight: "blue" }];
  }
  return [];
}

/**
 * Session options for a run, from the values the task remembers.
 *
 * A feature with no `config` is skipped: storing Fast is not the same as inventing a config id the
 * agent has never published. An unset value is also skipped, so a task nobody has toggled stays on
 * the agent's own default.
 */
export function featureSessionConfigs(
  harness: HarnessId,
  modelId: string | undefined,
  values: { fastMode?: boolean; planMode?: boolean },
): { configId: string; value: string }[] {
  const configs: { configId: string; value: string }[] = [];
  for (const feature of composerFeatures(harness, modelId)) {
    if (feature.config === undefined) continue;
    const stored = feature.id === "fast_mode" ? values.fastMode : values.planMode;
    if (stored === undefined) continue;
    configs.push({
      configId: feature.config.configId,
      value: stored ? feature.config.on : feature.config.off,
    });
  }
  return configs;
}
