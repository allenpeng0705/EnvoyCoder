/**
 * The two composer toggles Paseo draws beside mode, model, and thinking.
 *
 * They are agent features, not a fourth mode: Codex shows Plan always and Fast only for the models
 * that accept priority inference; Claude shows Fast only, and only for the Opus models that take it.
 * Every other agent shows neither — a toggle that does nothing is the bug the mode picker already
 * refuses. Envoy Harness is the exception that shows Plan as a working mode, not as a permission.
 *
 * Plan is the one this daemon can actually apply. Codex publishes `collaboration_mode` (`default` |
 * `plan`) and accepts it through `session/set_config_option`. Fast is a service tier on Codex's
 * app-server and a flag on Claude's own SDK; neither is an ACP option this build has observed, and
 * sending an unknown config id fails the run. The toggle is still remembered on the task.
 */

import type { HarnessId } from "@envoydev/protocol";

export type AgentFeatureId = "fast_mode" | "plan_mode";

export interface AgentFeatureToggle {
  id: AgentFeatureId;
  /** Yellow when Fast is on, blue when Plan is on. */
  highlight: "yellow" | "blue";
  /**
   * The session option the next run sets, when this agent accepts one.
   * Absent means the value is stored and not sent.
   */
  config?: { configId: string; on: string; off: string };
}

/** Codex models that accept Fast. Same set Paseo gates the toggle on. */
const CODEX_FAST_MODELS = new Set([
  "gpt-6-astra",
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
]);

/** Claude models that accept Fast. Opus only — Sonnet, Haiku, and Fable do not. */
const CLAUDE_FAST_MODELS = new Set([
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-8[1m]",
  "claude-opus-4-7",
  "claude-opus-4-7[1m]",
  "claude-opus-4-6",
  "claude-opus-4-6[1m]",
]);

function bareModelId(modelId: string | undefined): string {
  const trimmed = modelId?.trim() ?? "";
  if (trimmed === "") return "";
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** Which toggles this agent shows for this model, in toolbar order. */
export function composerFeatures(
  harness: HarnessId,
  modelId: string | undefined,
): readonly AgentFeatureToggle[] {
  if (harness === "codex") {
    const features: AgentFeatureToggle[] = [];
    if (CODEX_FAST_MODELS.has(bareModelId(modelId))) {
      features.push({ id: "fast_mode", highlight: "yellow" });
    }
    features.push({
      id: "plan_mode",
      highlight: "blue",
      config: { configId: "collaboration_mode", on: "plan", off: "default" },
    });
    return features;
  }
  if (harness === "claudecode" && CLAUDE_FAST_MODELS.has(bareModelId(modelId))) {
    return [{ id: "fast_mode", highlight: "yellow" }];
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
