#!/usr/bin/env node
/**
 * Minimal OMP-shaped JSONL RPC fixture for EnvoyDev daemon tests.
 *
 * Speaks: ready → (optional negotiate) → prompt / abort / extension_ui_request.
 * Env:
 *   FAKE_OMP_ASK=1 — emit a bash tool approval before finishing the turn
 *   FAKE_OMP_UNMAPPED_UI=1 — emit a non–Approve/Deny select (generic card path)
 *   FAKE_OMP_NO_READY=1 — never send ready; exit soon so handshake fails fast
 *   FAKE_OMP_SLOW_READY_MS=N — delay the ready frame (cancel-during-handshake tests)
 *   FAKE_OMP_NO_AGENT_END=1 — end the turn with prompt_result only (no agent_end)
 *   FAKE_OMP_PROMPT_RESULT_BARE=1 — prompt_result without an id field
 *   FAKE_OMP_SLOW_ABORT_MS=N — delay abort response (next prompt must wait)
 *   FAKE_OMP_SLOW_MS=N — after the first text delta, wait N ms before ending the turn
 *   FAKE_OMP_NO_SESSION_FILE=1 — get_state omits sessionFile (synthetic resume id)
 */

import { createInterface } from "node:readline"

const ask = process.env.FAKE_OMP_ASK === "1"
const unmappedUi = process.env.FAKE_OMP_UNMAPPED_UI === "1"
const noReady = process.env.FAKE_OMP_NO_READY === "1"
const noAgentEnd = process.env.FAKE_OMP_NO_AGENT_END === "1"
const barePromptResult = process.env.FAKE_OMP_PROMPT_RESULT_BARE === "1"
const noSessionFile = process.env.FAKE_OMP_NO_SESSION_FILE === "1"
const slowAbortMs = Number(process.env.FAKE_OMP_SLOW_ABORT_MS ?? "0")
const slowMs = Number(process.env.FAKE_OMP_SLOW_MS ?? "0")
const slowReadyMs = Number(process.env.FAKE_OMP_SLOW_READY_MS ?? "0")

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

function sendReady() {
  send({
    type: "ready",
    supportedProtocolVersions: [1],
  })
}

if (noReady) {
  // Fail handshake after a short window so the test can queue a follow-up first.
  setTimeout(() => process.exit(1), 200)
} else if (slowReadyMs > 0) {
  setTimeout(sendReady, slowReadyMs)
} else {
  sendReady()
}

let aborted = false
const pendingUi = new Map()

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on("line", (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (!msg || typeof msg !== "object") return
  const id = msg.id
  const type = msg.type

  if (type === "negotiate_protocol") {
    send({ type: "response", id, success: true, data: { protocolVersion: msg.protocolVersion } })
    return
  }

  if (type === "get_state") {
    if (id) {
      send({
        type: "response",
        id,
        success: true,
        data: noSessionFile ? {} : { sessionFile: "/tmp/fake-omp-session.jsonl" },
      })
    }
    return
  }

  if (type === "abort") {
    aborted = true
    const reply = () => {
      if (id) send({ type: "response", id, success: true, data: {} })
    }
    if (slowAbortMs > 0) setTimeout(reply, slowAbortMs)
    else reply()
    return
  }

  if (type === "extension_ui_response") {
    pendingUi.get(msg.id)?.(msg)
    pendingUi.delete(msg.id)
    return
  }

  if (type === "prompt") {
    aborted = false
    if (id) send({ type: "response", id, success: true, data: { agentInvoked: true } })
    const userText = typeof msg.message === "string" ? msg.message : ""
    void (async () => {
      send({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: `reply:${userText}` },
      })
      if (slowMs > 0) {
        const end = Date.now() + slowMs
        while (Date.now() < end && !aborted) {
          await new Promise((r) => setTimeout(r, 20))
        }
      }
      if (ask && !aborted) {
        const uiId = `ui_${Date.now()}`
        await new Promise((resolve) => {
          pendingUi.set(uiId, resolve)
          send({
            type: "extension_ui_request",
            id: uiId,
            method: "select",
            title: "Allow tool: bash\nCommand: echo hi",
            options: ["Approve", "Deny"],
          })
        })
      }
      if (unmappedUi && !aborted) {
        const uiId = `ui_unmapped_${Date.now()}`
        await new Promise((resolve) => {
          pendingUi.set(uiId, resolve)
          send({
            type: "extension_ui_request",
            id: uiId,
            method: "confirm",
            title: "Continue with network access?",
            options: ["Yes", "No"],
          })
        })
      }
      if (aborted) {
        if (id && !barePromptResult) {
          send({ type: "prompt_result", id, success: true, data: { stopReason: "cancelled" } })
        } else if (barePromptResult) {
          send({ type: "prompt_result", success: true, data: { stopReason: "cancelled" } })
        }
        if (!noAgentEnd) send({ type: "agent_end" })
        return
      }
      if (barePromptResult) {
        send({ type: "prompt_result", success: true, data: {} })
      } else if (id) {
        send({ type: "prompt_result", id, success: true, data: {} })
      }
      if (!noAgentEnd) send({ type: "agent_end" })
    })()
    return
  }

  if (id) {
    send({ type: "response", id, success: true, data: {} })
  }
})
