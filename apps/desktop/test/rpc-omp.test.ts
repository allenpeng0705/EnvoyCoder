import { describe, expect, it } from "vitest"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import { JsonlRpcAgentClient } from "../src/daemon/rpc/client.js"
import {
  extensionUiResponseFromOption,
  mapExtensionUiToPermission,
} from "../src/daemon/rpc/permission-mapper.js"
import { askingControl, askingOffLaunchArgs, ompApprovalLaunchArgs } from "@envoydev/agent-catalog/asking"
import { harnessDefinition } from "@envoydev/agent-catalog"

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-omp-rpc.mjs")

describe("OMP asking / argv", () => {
  it("uses launch-approval and yolo argv", () => {
    expect(askingControl("omp")).toBe("launch-approval")
    expect(askingOffLaunchArgs("omp")).toEqual(["--approval-mode", "yolo"])
    expect(ompApprovalLaunchArgs("ask")).toEqual(["--approval-mode", "always-ask"])
    const launch = harnessDefinition("omp").launch
    expect(launch.kind).toBe("child-process")
    if (launch.kind !== "child-process") return
    expect(launch.transport).toBe("rpc-ui")
    expect(launch.buildArgs({ prompt: "x", cwd: "/tmp" })).toContain("rpc-ui")
  })
})

describe("OMP permission mapper", () => {
  it("maps bash Approve/Deny to ACP options", () => {
    const mapped = mapExtensionUiToPermission(
      {
        type: "extension_ui_request",
        id: "ui-1",
        method: "select",
        title: "Allow tool: bash\nCommand: ls",
        options: ["Approve", "Deny"],
      },
      "sess",
    )
    expect(mapped).not.toBeNull()
    expect(mapped!.request.toolName).toBe("bash")
    expect(mapped!.request.options?.map((o) => o.optionId)).toContain("approve")
    expect(extensionUiResponseFromOption("approve", mapped!).value).toBe("Approve")
    expect(extensionUiResponseFromOption("deny", mapped!).value).toBe("Deny")
    expect(extensionUiResponseFromOption(null, mapped!).cancelled).toBe(true)
  })
})

describe("JsonlRpcAgentClient + fake OMP", () => {
  it("handshakes, prompts, and ends a turn", async () => {
    const client = await JsonlRpcAgentClient.start({
      launch: { command: process.execPath, args: [fixture], cwd: process.cwd() },
      negotiateOmp: true,
      handshakeTimeoutMs: 5_000,
      requestTimeoutMs: 10_000,
    })
    try {
      expect(client.sessionId).toBeTruthy()
      const chunks: string[] = []
      // Re-bind update by starting again with onUpdate — use a second client for stream check.
      await client.stop()
    } finally {
      await client.stop().catch(() => undefined)
    }

    const texts: string[] = []
    const streaming = await JsonlRpcAgentClient.start({
      launch: { command: process.execPath, args: [fixture], cwd: process.cwd() },
      negotiateOmp: true,
      handshakeTimeoutMs: 5_000,
      requestTimeoutMs: 10_000,
      onUpdate: (update) => {
        if (update.sessionUpdate === "agent_message_chunk") {
          const content = update.content as { text?: string } | undefined
          if (content?.text) texts.push(content.text)
        }
      },
    })
    try {
      const result = await streaming.prompt("hi")
      expect(result.stopReason).toBe("end_turn")
      expect(texts.join("")).toContain("reply:hi")
    } finally {
      await streaming.stop()
    }
  })

  it("ends the turn on bare prompt_result without agent_end", async () => {
    const texts: string[] = []
    const client = await JsonlRpcAgentClient.start({
      launch: {
        command: process.execPath,
        args: [fixture],
        cwd: process.cwd(),
        env: { FAKE_OMP_NO_AGENT_END: "1", FAKE_OMP_PROMPT_RESULT_BARE: "1" },
      },
      negotiateOmp: true,
      handshakeTimeoutMs: 5_000,
      requestTimeoutMs: 10_000,
      onUpdate: (update) => {
        if (update.sessionUpdate === "agent_message_chunk") {
          const content = update.content as { text?: string } | undefined
          if (content?.text) texts.push(content.text)
        }
      },
    })
    try {
      const result = await client.prompt("bare")
      expect(result.stopReason).toBe("end_turn")
      expect(texts.join("")).toContain("reply:bare")
    } finally {
      await client.stop()
    }
  })

  it("resolves cancel that races the prompt ack window", async () => {
    const client = await JsonlRpcAgentClient.start({
      launch: {
        command: process.execPath,
        args: [fixture],
        cwd: process.cwd(),
        env: { FAKE_OMP_SLOW_MS: "2000" },
      },
      negotiateOmp: true,
      handshakeTimeoutMs: 5_000,
      requestTimeoutMs: 10_000,
    })
    try {
      const turn = client.prompt("race")
      // Cancel immediately — settle is attached before send, so this must not hang.
      client.cancel()
      await expect(turn).resolves.toMatchObject({ stopReason: "cancelled" })
    } finally {
      await client.stop()
    }
  })

  it("reports sessionResumable false without a session file", async () => {
    const client = await JsonlRpcAgentClient.start({
      launch: {
        command: process.execPath,
        args: [fixture],
        cwd: process.cwd(),
        env: { FAKE_OMP_NO_SESSION_FILE: "1" },
      },
      negotiateOmp: true,
      handshakeTimeoutMs: 5_000,
      requestTimeoutMs: 10_000,
    })
    try {
      expect(client.sessionResumable).toBe(false)
      expect(client.sessionId).toMatch(/^rpc-/)
    } finally {
      await client.stop()
    }
  })

  it("gates the next prompt until a slow abort finishes", async () => {
    const client = await JsonlRpcAgentClient.start({
      launch: {
        command: process.execPath,
        args: [fixture],
        cwd: process.cwd(),
        env: { FAKE_OMP_SLOW_MS: "2000", FAKE_OMP_SLOW_ABORT_MS: "150" },
      },
      negotiateOmp: true,
      handshakeTimeoutMs: 5_000,
      requestTimeoutMs: 10_000,
    })
    try {
      const first = client.prompt("slow")
      await new Promise((r) => setTimeout(r, 40))
      client.cancel()
      await expect(first).resolves.toMatchObject({ stopReason: "cancelled" })
      const second = await client.prompt("next")
      expect(second.stopReason).toBe("end_turn")
    } finally {
      await client.stop()
    }
  })

  it("surfaces unmapped extension_ui via onPermissionRequest", async () => {
    const seen: string[] = []
    const client = await JsonlRpcAgentClient.start({
      launch: {
        command: process.execPath,
        args: [fixture],
        cwd: process.cwd(),
        env: { FAKE_OMP_UNMAPPED_UI: "1" },
      },
      negotiateOmp: true,
      handshakeTimeoutMs: 5_000,
      requestTimeoutMs: 10_000,
      onPermissionRequest: async (request) => {
        seen.push(request.toolName ?? "")
        return "approve"
      },
    })
    try {
      const result = await client.prompt("confirm")
      expect(result.stopReason).toBe("end_turn")
      expect(seen).toContain("agent-ui")
    } finally {
      await client.stop()
    }
  })

  it("surfaces extension_ui as a permission request", async () => {
    const seen: string[] = []
    const client = await JsonlRpcAgentClient.start({
      launch: {
        command: process.execPath,
        args: [fixture],
        cwd: process.cwd(),
        env: { FAKE_OMP_ASK: "1" },
      },
      negotiateOmp: true,
      handshakeTimeoutMs: 5_000,
      requestTimeoutMs: 10_000,
      onPermissionRequest: async (request) => {
        seen.push(request.toolName ?? "")
        return "approve"
      },
    })
    try {
      const result = await client.prompt("do it")
      expect(result.stopReason).toBe("end_turn")
      expect(seen).toContain("bash")
    } finally {
      await client.stop()
    }
  })

  it("includes yolo when launch args say so", () => {
    const args = harnessDefinition("omp").launch
    if (args.kind !== "child-process") return
    const built = args.buildArgs({
      prompt: "",
      cwd: "/tmp",
      extraArgs: askingOffLaunchArgs("omp").join(" "),
    })
    expect(built).toEqual(
      expect.arrayContaining(["--mode", "rpc-ui", "--approval-mode", "yolo"]),
    )
  })

  it("records sessionFile from get_state for resume", async () => {
    const client = await JsonlRpcAgentClient.start({
      launch: { command: process.execPath, args: [fixture], cwd: process.cwd() },
      negotiateOmp: true,
      handshakeTimeoutMs: 5_000,
      requestTimeoutMs: 10_000,
    })
    try {
      expect(client.sessionId).toBe("/tmp/fake-omp-session.jsonl")
    } finally {
      await client.stop()
    }
  })
})
