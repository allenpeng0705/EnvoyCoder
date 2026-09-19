import { describe, expect, it } from "vitest"

import {
  envoyPermissionPolicy,
  modeLaunchEnv,
  permissionModes,
  sessionSetModeId,
} from "../src/mode-delivery.js"

describe("permission levels", () => {
  it("lists Read only, Workspace change, then Full access", () => {
    expect(permissionModes().map((mode) => mode.id)).toEqual([
      "read-only",
      "workspace-write",
      "danger-full-access",
    ])
    expect(permissionModes().find((mode) => mode.id === "danger-full-access")?.unattended).toBe(true)
  })

  it("marks only the process default as preferred", () => {
    const modes = permissionModes("workspace-write")
    expect(modes.find((mode) => mode.preferred)?.id).toBe("workspace-write")
    expect(modes.filter((mode) => mode.preferred).map((mode) => mode.id)).toEqual(["workspace-write"])
  })

  it("does not send a permission level as session/set_mode", () => {
    expect(sessionSetModeId("plan")).toBe("plan")
    expect(sessionSetModeId("read-only")).toBeUndefined()
    expect(sessionSetModeId("workspace-write")).toBeUndefined()
    expect(sessionSetModeId("danger-full-access")).toBeUndefined()
    expect(sessionSetModeId(undefined)).toBeUndefined()
  })

  it("starts DeepSeek with DSH_PERMISSION_MODE and nobody else", () => {
    expect(modeLaunchEnv("deepseek-harness", "danger-full-access")).toEqual({
      DSH_PERMISSION_MODE: "danger-full-access",
    })
    expect(modeLaunchEnv("deepseek-harness", "plan")).toBeUndefined()
    expect(modeLaunchEnv("envoy-harness", "read-only")).toBeUndefined()
  })

  it("sends Envoy Harness a sandbox, and stops asking only for full access", () => {
    expect(envoyPermissionPolicy("envoy-harness", "read-only")).toEqual({
      sandbox: "read-only",
      approval: "on-request",
    })
    expect(envoyPermissionPolicy("envoy-harness", "workspace-write")).toEqual({
      sandbox: "workspace-write",
      approval: "on-request",
    })
    expect(envoyPermissionPolicy("envoy-harness", "danger-full-access")).toEqual({
      sandbox: "danger-full-access",
      approval: "never",
      autoRun: "off",
    })
    expect(envoyPermissionPolicy("envoy-harness", "plan")).toBeUndefined()
    expect(envoyPermissionPolicy("deepseek-harness", "read-only")).toBeUndefined()
  })
})
