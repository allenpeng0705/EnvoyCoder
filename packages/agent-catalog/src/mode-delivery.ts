/**
 * How a permission level reaches the agent — separate from `session/set_mode`.
 *
 * Read only, Workspace change, and Full access are the same three postures on DeepSeek Harness
 * and on Envoy Harness. They are not a collaboration mode (`default` / `plan` / `review`).
 * DeepSeek has no `session/set_mode`; it reads `DSH_PERMISSION_MODE` when the process starts.
 * Envoy Harness keeps those three on `session/set_mode`, and takes a sandbox through
 * `session/set_policy`. Sending a permission id as a mode is how a run fails with
 * `mode must be default|plan|review`.
 */

import type { AgentMode, HarnessId } from "@envoydev/protocol"

export const PERMISSION_MODE_IDS = ["read-only", "workspace-write", "danger-full-access"] as const

export type PermissionModeId = (typeof PERMISSION_MODE_IDS)[number]

export function isPermissionModeId(id: string): id is PermissionModeId {
  return (PERMISSION_MODE_IDS as readonly string[]).includes(id)
}

/**
 * The three levels, in the order a person names them.
 *
 * `preferredId` is the one a new task should show when nothing has been stored. DeepSeek's process
 * starts in `workspace-write`; listing Read only first must not change that.
 */
export function permissionModes(preferredId?: PermissionModeId): AgentMode[] {
  const modes: AgentMode[] = [
    {
      id: "read-only",
      label: "Read only",
      labelKey: "task.agentMode.readOnly.label",
      description: "Read files. Do not change them.",
      descriptionKey: "task.agentMode.readOnly.description",
    },
    {
      id: "workspace-write",
      label: "Workspace change",
      labelKey: "task.agentMode.workspace.label",
      description: "Change files in this project. Ask before going further.",
      descriptionKey: "task.agentMode.workspace.description",
    },
    {
      id: "danger-full-access",
      label: "Full access",
      labelKey: "task.agentMode.fullAccess.label",
      description: "The whole computer, without asking each turn.",
      descriptionKey: "task.agentMode.fullAccess.description",
      unattended: true,
    },
  ]
  if (preferredId === undefined) return modes
  return modes.map((mode) => (mode.id === preferredId ? { ...mode, preferred: true } : mode))
}

/**
 * The id `session/set_mode` should receive.
 *
 * A permission level is not a collaboration mode. Returning it here would ask Envoy Harness for a
 * mode it refuses, and would ask DeepSeek for a method it does not have.
 */
export function sessionSetModeId(modeId: string | undefined): string | undefined {
  if (modeId === undefined || isPermissionModeId(modeId)) return undefined
  return modeId
}

/** Launch environment for a DeepSeek permission level. Anything else is not this channel. */
export function modeLaunchEnv(
  harness: HarnessId,
  modeId: string | undefined,
): Record<string, string> | undefined {
  if (harness !== "deepseek-harness" || modeId === undefined || !isPermissionModeId(modeId)) {
    return undefined
  }
  return { DSH_PERMISSION_MODE: modeId }
}

export interface PermissionPolicy {
  sandbox: PermissionModeId
  approval: "on-request" | "never"
  autoRun?: "off"
}

/**
 * `session/set_policy` for an Envoy Harness permission level.
 *
 * Workspace change is sandbox `workspace-write` with approval still on. It is not the preset
 * `ask-all`: that preset confirms every tool, which is the opposite of being allowed to edit the
 * project. Full access is the one that stops asking (`approval: never`, `autoRun: off`).
 */
export function envoyPermissionPolicy(
  harness: HarnessId,
  modeId: string | undefined,
): PermissionPolicy | undefined {
  if (harness !== "envoy-harness" || modeId === undefined || !isPermissionModeId(modeId)) {
    return undefined
  }
  if (modeId === "danger-full-access") {
    return { sandbox: modeId, approval: "never", autoRun: "off" }
  }
  return { sandbox: modeId, approval: "on-request" }
}
