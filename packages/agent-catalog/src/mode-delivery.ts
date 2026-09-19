/**
 * How a permission level reaches the agent — separate from `session/set_mode`.
 *
 * Read only, Project change, and Full access are the same three postures on DeepSeek Harness
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
      description: "Read files. Do not change them, and do not ask before each read.",
      descriptionKey: "task.agentMode.readOnly.description",
    },
    {
      id: "workspace-write",
      label: "Project change",
      labelKey: "task.agentMode.workspace.label",
      description: "Change files in this project. Ask only before a command or a change outside it.",
      descriptionKey: "task.agentMode.workspace.description",
    },
    {
      id: "danger-full-access",
      label: "Full access",
      labelKey: "task.agentMode.fullAccess.label",
      description: "The whole computer, without asking.",
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

/**
 * The collaboration mode to send with this choice.
 *
 * A permission level is not itself a mode. Leaving Plan still has to, or the agent keeps drafting
 * after the person picked Project change. `default` is that "do the work" mode, and it is not shown
 * in the menu: Project change is the same choice.
 */
export function collaborationModeToSet(
  harness: HarnessId,
  modeId: string | undefined,
  planMode?: boolean,
): string | undefined {
  const direct = sessionSetModeId(modeId)
  if (direct !== undefined) return direct
  if (harness !== "envoy-harness") return undefined
  // Plan is the working mode, chosen on its own control. It wins over the permission level: the
  // sandbox stays what they picked, and the agent only looks and proposes until they switch back.
  if (planMode === true) return "plan"
  if (modeId !== undefined && isPermissionModeId(modeId)) return "default"
  return undefined
}

/**
 * Modes the menu used to list and no longer does.
 *
 * Default and Plan were the same work as Project change once Plan moved to its own control. Review was
 * the same limit as Read only. A task that still stores the old id keeps that meaning.
 */
export function mapRetiredEnvoyMode(modeId: string): string {
  if (modeId === "default" || modeId === "plan") return "workspace-write"
  if (modeId === "review") return "read-only"
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
  /** How often the live hook stops for a person. Not `approval`: that setter drops the host's handler. */
  autoRun: "safe-only" | "off"
}

/**
 * `session/set_policy` for an Envoy Harness permission level.
 *
 * Read only and Workspace change ask only for a command or a write (`safe-only`). Reads and a
 * single safe lookup do not stop the turn. Full access is the one that stops asking.
 *
 * `approval` is deliberately absent. The harness's `setApprovalPolicy` replaces the host handler
 * that receives Allow, so a card the person answered still came back denied. The sandbox is what
 * stops a write in Read only; the hook is what decides whether to ask.
 */
export function envoyPermissionPolicy(
  harness: HarnessId,
  modeId: string | undefined,
): PermissionPolicy | undefined {
  if (harness !== "envoy-harness" || modeId === undefined || !isPermissionModeId(modeId)) {
    return undefined
  }
  if (modeId === "danger-full-access") {
    return { sandbox: modeId, autoRun: "off" }
  }
  return { sandbox: modeId, autoRun: "safe-only" }
}
