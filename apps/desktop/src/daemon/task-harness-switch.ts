/**
 * What changes on a task when its agent becomes a different harness.
 *
 * Used by `coder.updateTask({ harness })`: switching Envoy → DeepSeek (or the reverse) must clear a
 * mode / model / thinking level the new agent cannot honour, or every later run refuses with a
 * sentence about a choice made for a *different* agent.
 */

import {
  canApplyThinking,
  harnessDefinition,
  resolveModelChoice,
} from "@envoydev/agent-catalog";
import type { AgentId, HarnessId, Task } from "@envoydev/protocol";
import { isHarnessId } from "@envoydev/protocol";

/** Fields to write when moving a task onto `nextHarness`. */
export interface HarnessSwitchPatch {
  harness: AgentId;
  agentModeId?: string;
  clearAgentMode: boolean;
  model?: string;
  clearModel: boolean;
  thinkingLevel?: string;
  clearThinkingLevel: boolean;
  /** Drop Mobile / Web domain preset when leaving envoy-harness. */
  clearDomainPreset: boolean;
}

/**
 * Compute the patch that moves `task` onto `nextHarness`.
 *
 * `preferredModel` is the project's default model when that project is for this same agent (caller
 * filters). Applied after the previous agent's model is cleared, when the new harness can take it.
 */
export function harnessSwitchPatch(
  task: Pick<Task, "agentModeId" | "model" | "thinkingLevel" | "domainPreset">,
  nextHarness: AgentId,
  preferredModel?: string,
): HarnessSwitchPatch {
  const clearDomainPreset =
    task.domainPreset !== undefined && nextHarness !== "envoy-harness";
  if (!isHarnessId(nextHarness)) {
    // No catalogue entry to ask. A mode, model or thinking level chosen for a different agent
    // would make the next run refuse, so they are dropped.
    return {
      harness: nextHarness,
      clearAgentMode: task.agentModeId !== undefined,
      clearModel: task.model !== undefined && task.model !== "",
      clearThinkingLevel: task.thinkingLevel !== undefined,
      clearDomainPreset: task.domainPreset !== undefined,
    };
  }
  const next = harnessDefinition(nextHarness);

  let clearAgentMode = false;
  let agentModeId = task.agentModeId;
  if (agentModeId !== undefined && !next.modes.some((mode) => mode.id === agentModeId)) {
    agentModeId = undefined;
    clearAgentMode = true;
  }

  // Always drop the previous agent's model on a harness change. DeepSeek is `free-text`: any
  // `provider/model` shape passes `resolveModelChoice`, so Envoy LLM ids (e.g. openai/MiniMax-M3)
  // would otherwise follow onto DeepSeek and fail only inside the agent.
  let clearModel = task.model !== undefined && task.model !== "";
  let model: string | undefined = undefined;

  const preferred =
    preferredModel !== undefined && preferredModel !== "" ? preferredModel : undefined;
  if (preferred !== undefined && resolveModelChoice(nextHarness, preferred).ok) {
    model = preferred;
    clearModel = false;
  }

  let clearThinkingLevel = false;
  let thinkingLevel = task.thinkingLevel;
  if (thinkingLevel !== undefined && !canApplyThinking(nextHarness)) {
    thinkingLevel = undefined;
    clearThinkingLevel = true;
  }

  return {
    harness: nextHarness,
    ...(agentModeId !== undefined ? { agentModeId } : {}),
    clearAgentMode,
    ...(model !== undefined ? { model } : {}),
    clearModel,
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    clearThinkingLevel,
    clearDomainPreset,
  };
}

/** Apply a switch patch onto a task record (store path — no UpdateTaskInput flags). */
export function applyHarnessSwitch(task: Task, patch: HarnessSwitchPatch, updatedAt: string): Task {
  return {
    ...task,
    harness: patch.harness,
    agentModeId: patch.clearAgentMode ? undefined : (patch.agentModeId ?? task.agentModeId),
    model: patch.clearModel ? undefined : (patch.model !== undefined ? patch.model : task.model),
    thinkingLevel: patch.clearThinkingLevel
      ? undefined
      : (patch.thinkingLevel !== undefined ? patch.thinkingLevel : task.thinkingLevel),
    domainPreset: patch.clearDomainPreset ? undefined : task.domainPreset,
    updatedAt,
  };
}
