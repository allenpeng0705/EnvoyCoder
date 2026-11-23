import { describe, expect, it } from "vitest"

import { ALL_HARNESSES, harnessDefinition } from "../src/index.js"
import {
  agentCanControlAsking,
  askingControl,
  askingOffLaunchArgs,
  canSteerFollowUp,
  followUpMustQueue,
  modeForAskingOff,
  ompApprovalLaunchArgs,
  unattendedModeId,
} from "../src/asking-control.js"
import { isPermissionModeId, modeLaunchEnv } from "../src/mode-delivery.js"

/** Same rules the daemon uses — the window-safe table must match. */
function expectedAskingControl(harness: (typeof ALL_HARNESSES)[number]) {
  // Launch / session wires — not inferable from modes / approvalPolicy alone.
  if (harness === "cursor") return "launch-force" as const
  if (harness === "opencode") return "session-auto" as const
  if (harness === "omp") return "launch-approval" as const
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
    expect(modeForAskingOff("opencode")).toBeUndefined()
    expect(modeForAskingOff("omp")).toBeUndefined()
    expect(modeForAskingOff("pi")).toBeUndefined()
  })

  it("maps Cursor Asking Off to --force before acp", () => {
    expect(askingControl("cursor")).toBe("launch-force")
    expect(askingOffLaunchArgs("cursor")).toEqual(["--force"])
    expect(askingOffLaunchArgs("envoy-harness")).toEqual([])
    const args = harnessDefinition("cursor").launch.buildArgs({
      prompt: "",
      cwd: "/tmp",
      extraArgs: "--force --trust",
    })
    expect(args[0]).toBe("--force")
    expect(args).toContain("acp")
    expect(args.indexOf("--force")).toBeLessThan(args.indexOf("acp"))
  })

  it("maps OpenCode Asking Off to session-auto (ACP host auto-allow)", () => {
    expect(askingControl("opencode")).toBe("session-auto")
    expect(askingOffLaunchArgs("opencode")).toEqual([])
    const launch = harnessDefinition("opencode").launch
    expect(launch.kind).toBe("child-process")
    if (launch.kind !== "child-process") return
    expect(launch.transport).toBe("acp")
    expect(launch.buildArgs({ prompt: "", cwd: "/tmp" })).toEqual(["acp"])
  })

  it("maps OMP Asking Off to --approval-mode yolo with rpc-ui", () => {
    expect(askingControl("omp")).toBe("launch-approval")
    expect(askingOffLaunchArgs("omp")).toEqual(["--approval-mode", "yolo"])
    expect(ompApprovalLaunchArgs("full")).toEqual(["--approval-mode", "yolo"])
    expect(ompApprovalLaunchArgs("write")).toEqual(["--approval-mode", "write"])
    expect(ompApprovalLaunchArgs("ask")).toEqual(["--approval-mode", "always-ask"])
    const launch = harnessDefinition("omp").launch
    expect(launch.kind).toBe("child-process")
    if (launch.kind !== "child-process") return
    expect(launch.transport).toBe("rpc-ui")
    const args = launch.buildArgs({
      prompt: "",
      cwd: "/tmp",
      extraArgs: "--approval-mode yolo",
    })
    expect(args).toContain("rpc-ui")
    expect(args).toContain("--approval-mode")
    expect(args).toContain("yolo")
    expect(launch.resumeArgs?.("/tmp/sess.jsonl")).toEqual(["--session", "/tmp/sess.jsonl"])
  })

  it("keeps Pi Asking Off unsupported", () => {
    expect(askingControl("pi")).toBe("none")
    expect(askingOffLaunchArgs("pi")).toEqual([])
    const launch = harnessDefinition("pi").launch
    expect(launch.kind).toBe("child-process")
    if (launch.kind !== "child-process") return
    expect(launch.transport).toBe("rpc-ui")
    expect(launch.buildArgs({ prompt: "", cwd: "/tmp" })[1]).toBe("rpc")
  })

  it("only Envoy Harness and DeepSeek may steer a live follow-up", () => {
    expect(canSteerFollowUp("envoy-harness")).toBe(true)
    expect(canSteerFollowUp("deepseek-harness")).toBe(true)
    for (const id of ALL_HARNESSES) {
      if (id === "envoy-harness" || id === "deepseek-harness") continue
      expect(followUpMustQueue(id), id).toBe(true)
    }
    expect(followUpMustQueue(undefined)).toBe(true)
  })

  it("keeps Copilot catalogue unattended id out of Settings Off delivery", () => {
    expect(unattendedModeId("copilot")).toBe("allow-all")
    expect(askingControl("copilot")).toBe("none")
    expect(modeForAskingOff("copilot")).toBeUndefined()
  })
})
