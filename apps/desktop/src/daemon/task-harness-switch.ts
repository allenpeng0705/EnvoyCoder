/**
 * What changes on a task when its agent becomes a different harness.
 *
 * Shared by `coder.updateTask({ harness })` and by project-default migration: switching Envoy → DeepSeek
 * (or the reverse) must clear a mode / model / thinking level the new agent cannot honour, or every later
 * run refuses with a sentence about a choice made for a *different* agent.
 */

import {
  canApplyThinking,
  harnessDefinition,
  resolveModelChoice,
} from "@envoydev/agent-catalog";
import type { HarnessId, Task } from "@envoydev/protocol";
import { statusIsActive } from "@envoydev/protocol";

/** Fields to write when moving a task onto `nextHarness`. */
export interface HarnessSwitchPatch {
  harness: HarnessId;
  agentModeId?: string;
  clearAgentMode: boolean;
  model?: string;
  clearModel: boolean;
  thinkingLevel?: string;
  clearThinkingLevel: boolean;
}

/**
 * Idle (and finished) tasks may follow a project agent change; an active run keeps its harness until it
 * stops — migrating mid-run would contradict the process already on disk.
 */
export function taskMayFollowProjectHarness(task: Task): boolean {
  return task.archivedAt === undefined && !statusIsActive(task.status);
}

/**
 * Compute the patch that moves `task` onto `nextHarness`.
 *
 * `preferredModel` is the project's default model (when set): used when the stored model is dropped or
 * absent and the new harness can take that preferred id — so Envoy does not land model-less after a
 * switch that cleared an incompatible DeepSeek free-text id.
 */
export function harnessSwitchPatch(
  task: Pick<Task, "agentModeId" | "model" | "thinkingLevel">,
  nextHarness: HarnessId,
  preferredModel?: string,
): HarnessSwitchPatch {
  const next = harnessDefinition(nextHarness);

  let clearAgentMode = false;
  let agentModeId = task.agentModeId;
  if (agentModeId !== undefined && !next.modes.some((mode) => mode.id === agentModeId)) {
    agentModeId = undefined;
    clearAgentMode = true;
  }

  let clearModel = false;
  let model = task.model;
  if (model !== undefined && model !== "" && !resolveModelChoice(nextHarness, model).ok) {
    model = undefined;
    clearModel = true;
  }

  const preferred =
    preferredModel !== undefined && preferredModel !== "" ? preferredModel : undefined;
  if ((model === undefined || model === "") && preferred !== undefined) {
    if (resolveModelChoice(nextHarness, preferred).ok) {
      model = preferred;
      clearModel = false;
    }
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
    updatedAt,
  };
}
