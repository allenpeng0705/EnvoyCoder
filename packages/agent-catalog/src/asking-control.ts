/**
 * How Settings → “Ask before risky steps” reaches an agent.
 *
 * Two real wires, never invented:
 *   * `policy` — `session/set_policy` / `autoRun` (Envoy Harness).
 *   * `unattended-mode` — a catalogue mode marked `unattended` that this build can deliver
 *     (`session/set_mode`, or DeepSeek’s `DSH_PERMISSION_MODE` env).
 *
 * Window-safe: no probe / spawn imports. Kept aligned with `HARNESS_CATALOG` by
 * `test/asking-control.test.ts`.
 */

import type { HarnessId } from "@envoydev/protocol"

export type AskingControl = "policy" | "unattended-mode" | "none"

/**
 * Which mechanism Settings Off uses for this shipped agent.
 *
 * `policy` wins when both exist (Envoy Harness also lists Full access as unattended): Off only
 * flips `autoRun`, and leaves the sandbox the user picked.
 */
export function askingControl(harness: HarnessId): AskingControl {
  switch (harness) {
    case "envoy-harness":
      return "policy"
    case "deepseek-harness":
    case "claudecode":
    case "codex":
      return "unattended-mode"
    case "copilot":
    case "opencode":
    case "cursor":
    case "pi":
    case "omp":
      return "none"
  }
}

/** Whether Settings can change how often this agent asks. */
export function agentCanControlAsking(harness: HarnessId): boolean {
  return askingControl(harness) !== "none"
}

/**
 * Mode id Settings Off selects for agents without `approvalPolicy`.
 *
 * Undefined for `policy` agents — they keep the chosen mode and only change `autoRun`.
 */
export function modeForAskingOff(harness: HarnessId): string | undefined {
  if (askingControl(harness) !== "unattended-mode") return undefined
  return unattendedModeId(harness)
}

/**
 * Catalogue unattended mode id, when the agent publishes one.
 *
 * **Metadata, not a delivery guarantee.** Copilot/OMP list modes here while `askingControl` is
 * `none` (no `agentMode` / env path this build can drive). Prefer `modeForAskingOff` for Settings.
 */
export function unattendedModeId(harness: HarnessId): string | undefined {
  switch (harness) {
    case "envoy-harness":
    case "deepseek-harness":
      return "danger-full-access"
    case "claudecode":
      return "bypassPermissions"
    case "codex":
      return "agent-full-access"
    case "copilot":
      return "allow-all"
    case "omp":
      return "full"
    case "opencode":
    case "cursor":
    case "pi":
      return undefined
  }
}

/** End-user label for the unattended mode Settings Off would pick. */
export function modeLabelForAskingOff(harness: HarnessId): string | undefined {
  const id = modeForAskingOff(harness)
  if (id === undefined) return undefined
  switch (id) {
    case "danger-full-access":
      return "Full access"
    case "bypassPermissions":
      return "Bypass permissions"
    case "agent-full-access":
      return "Full Access"
    case "allow-all":
      return "Allow all"
    case "full":
      return "Full access"
    default:
      return id
  }
}
