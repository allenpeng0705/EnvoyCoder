import { describe, expect, it } from "vitest"

import { ALL_HARNESSES, harnessDefinition } from "../src/index.js"
import {
  agentCanControlAsking,
  askingControl,
  modeForAskingOff,
  unattendedModeId,
} from "../src/asking-control.js"
import { isPermissionModeId, modeLaunchEnv } from "../src/mode-delivery.js"

/** Same rules the daemon uses — the window-safe table must match. */
function expectedAskingControl(harness: (typeof ALL_HARNESSES)[number]) {
  const def = harnessDefinition(harness)
  if (def.capabilities.approvalPolicy) return "policy" as const
  const mode = def.modes.find((entry) => entry.unattended === true)?.id
  if (mode === undefined) return "none" as const
  if (isPermissionModeId(mode) && modeLaunchEnv(harness, mode) !== undefined) {
    return "unattended-mode" as const
  }
  if (def.capabilities.agentMode) return "unattended-mode" as const
  return "none" as const
}

describe("askingControl", () => {
  it("matches HARNESS_CATALOG for every shipped agent", () => {
    for (const harness of ALL_HARNESSES) {
      expect(askingControl(harness), harness).toBe(expectedAskingControl(harness))
      expect(agentCanControlAsking(harness), harness).toBe(askingControl(harness) !== "none")
      expect(unattendedModeId(harness), harness).toBe(
        harnessDefinition(harness).modes.find((entry) => entry.unattended === true)?.id,
      )
    }
  })

  it("maps Settings Off to unattended modes only when policy is not the wire", () => {
    expect(modeForAskingOff("envoy-harness")).toBeUndefined()
    expect(modeForAskingOff("claudecode")).toBe("bypassPermissions")
    expect(modeForAskingOff("codex")).toBe("agent-full-access")
    expect(modeForAskingOff("deepseek-harness")).toBe("danger-full-access")
    expect(modeForAskingOff("cursor")).toBeUndefined()
  })

  it("keeps Copilot/OMP catalogue unattended ids out of Settings Off delivery", () => {
    // `unattendedModeId` is metadata; `askingControl` is the delivery gate.
    expect(unattendedModeId("copilot")).toBe("allow-all")
    expect(unattendedModeId("omp")).toBe("full")
    expect(askingControl("copilot")).toBe("none")
    expect(askingControl("omp")).toBe("none")
    expect(modeForAskingOff("copilot")).toBeUndefined()
    expect(modeForAskingOff("omp")).toBeUndefined()
  })
})
