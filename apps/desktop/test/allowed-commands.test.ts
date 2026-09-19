import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  allowChoiceId,
  choiceAllows,
  isCommandAllowed,
  permissionMemoryKey,
  rememberCommand,
} from "../src/daemon/allowed-commands.js"

describe("a command the person already allowed", () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it("names a command, and a file write, and nothing it cannot tell apart", () => {
    expect(permissionMemoryKey({ toolName: "bash", args: { command: "  npm   test  " } })).toBe(
      "command\tnpm test",
    )
    expect(permissionMemoryKey({ toolName: "bash", args: { command: "npm test --watch" } })).not.toBe(
      permissionMemoryKey({ toolName: "bash", args: { command: "npm test" } }),
    )
    expect(permissionMemoryKey({ toolName: "write_file", args: { path: "src/a.ts", content: "x" } })).toBe(
      "file\twrite_file\tsrc/a.ts",
    )
    expect(permissionMemoryKey({ toolName: "bash", args: {} })).toBeUndefined()
  })

  it("remembers the command for that project only", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "envoydev-allowed-"))
    dirs.push(stateDir)
    const key = "command\tnpm test"
    expect(await isCommandAllowed(stateDir, "/repo", key)).toBe(false)
    await rememberCommand(stateDir, "/repo", key)
    expect(await isCommandAllowed(stateDir, "/repo", key)).toBe(true)
    expect(await isCommandAllowed(stateDir, "/other", key)).toBe(false)
    expect(await isCommandAllowed(stateDir, "/repo", "command\tnpm run build")).toBe(false)
  })

  it("treats Allow once as allow, and Reject as not", () => {
    const options = [
      { optionId: "allow-once", kind: "allow_once" },
      { optionId: "reject-once", kind: "reject_once" },
    ]
    expect(allowChoiceId(options)).toBe("allow-once")
    expect(choiceAllows(options, "allow-once")).toBe(true)
    expect(choiceAllows(options, "reject-once")).toBe(false)
    expect(allowChoiceId(undefined)).toBe("allow")
    expect(choiceAllows(undefined, "deny")).toBe(false)
  })
})
