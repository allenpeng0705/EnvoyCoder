/**
 * How Settings → “Ask before risky steps” reaches an agent.
 *
 * Five real wires, never invented:
 *   * `policy` — `session/set_policy` / `autoRun` (Envoy Harness).
 *   * `unattended-mode` — a catalogue mode marked `unattended` that this build can deliver
 *     (`session/set_mode`, or DeepSeek’s `DSH_PERMISSION_MODE` env).
 *   * `launch-force` — root CLI `--force` before the ACP subcommand (Cursor).
 *   * `session-auto` — host auto-answers `session/request_permission` for the run (OpenCode ACP:
 *     allow once/always only; no YOLO mode / `set_policy`).
 *   * `launch-approval` — OMP `--approval-mode yolo` at spawn (Paseo `resolveOmpLaunchMode`).
 *
 * Window-safe: no probe / spawn imports. Kept aligned with `HARNESS_CATALOG` by
 * `test/asking-control.test.ts`.
 */

import { familyAskingControl } from "@envoymesh/agent-catalog"
import type { HarnessId } from "@envoydev/protocol"

export type AskingControl =
  | "policy"
  | "unattended-mode"
  | "launch-force"
  | "session-auto"
  | "launch-approval"
  | "none"

/**
 * Which mechanism Settings Off uses for this shipped agent.
 *
 * `policy` wins when both exist (Envoy Harness also lists Full access as unattended): Off only
 * flips `autoRun`, and leaves the sandbox the user picked.
 */
/** Family contract slice (FH-P2-A) — shared featured ids only. */
function familyAskingOverride(harness: HarnessId): AskingControl | undefined {
  const family = familyAskingControl(harness)
  if (family === "catalog-acp") return undefined
  return family as AskingControl
}

export function askingControl(harness: HarnessId): AskingControl {
  const override = familyAskingOverride(harness)
  if (override !== undefined) return override
  switch (harness) {
    case "envoy-harness":
      return "policy"
    case "deepseek-harness":
    case "claudecode":
    case "codex":
      return "unattended-mode"
    case "cursor":
      return "launch-force"
    case "opencode":
      return "session-auto"
    case "omp":
      return "launch-approval"
    case "copilot":
    case "pi":
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
 * Undefined when Off does not flip a catalogue mode (policy / launch / session-auto wires).
 * OMP Full access is delivered as `--approval-mode yolo`, not as this mode id on the run.
 */
export function modeForAskingOff(harness: HarnessId): string | undefined {
  if (askingControl(harness) !== "unattended-mode") return undefined
  return unattendedModeId(harness)
}

/**
 * Argv tokens Settings Off adds at launch.
 *
 * Cursor: `--force` before `acp`. OMP: `--approval-mode yolo` (with `rpc-ui` from buildArgs).
 */
export function askingOffLaunchArgs(harness: HarnessId): readonly string[] {
  const via = askingControl(harness)
  if (via === "launch-force" && harness === "cursor") return ["--force"]
  if (via === "launch-approval" && harness === "omp") return ["--approval-mode", "yolo"]
  return []
}

/**
 * Catalogue unattended / Full mode id, when the agent publishes one.
 *
 * **Metadata for Copilot** while `askingControl` is `none`. Prefer `modeForAskingOff` for Settings.
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

/** End-user label for the unattended / Full mode Settings Off would pick. */
export function modeLabelForAskingOff(harness: HarnessId): string | undefined {
  const via = askingControl(harness)
  const id =
    via === "unattended-mode" || via === "launch-approval"
      ? unattendedModeId(harness)
      : undefined
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

/**
 * Whether a live follow-up may **steer** (cancel the turn in flight).
 *
 * Only the two ACP surfaces we own end-to-end — Envoy Harness and DeepSeek’s ACP profile —
 * have a cancel path we treat as safe for redirect.
 */
export function canSteerFollowUp(harnessId: string | undefined): boolean {
  return harnessId === "envoy-harness" || harnessId === "deepseek-harness"
}

/** Inverse of {@link canSteerFollowUp} — follow-ups wait for the turn to finish. */
export function followUpMustQueue(harnessId: string | undefined): boolean {
  return !canSteerFollowUp(harnessId)
}

/** OMP approval argv for a catalogue mode id (Paseo `resolveOmpLaunchMode`). */
export function ompApprovalLaunchArgs(modeId: string | undefined): readonly string[] {
  switch (modeId ?? "full") {
    case "full":
      return ["--approval-mode", "yolo"]
    case "write":
      return ["--approval-mode", "write"]
    case "ask":
      return ["--approval-mode", "always-ask"]
    default:
      return ["--approval-mode", "always-ask"]
  }
}
