/**
 * RunManager + OMP JSONL RPC (fake-omp-rpc) — multi-turn stability that unit tests cannot cover:
 * queue delivery, approval+queue, cancel mid-turn, refuse send after Stop, resume session id.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

import type { RunEvent } from "@envoydev/protocol"
import { coderPaths } from "@envoydev/host-bridge"

import { RunManager } from "../src/daemon/runs.js"
import { CoderStore } from "../src/daemon/store.js"

const here = dirname(fileURLToPath(import.meta.url))
const FAKE_OMP = join(here, "fixtures", "fake-omp-rpc.mjs")

interface Bench {
  manager: RunManager
  store: CoderStore
  events: RunEvent[]
  taskId: string
  until: (predicate: (events: RunEvent[]) => boolean, label: string) => Promise<void>
}

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function ompBench(agentEnv: Record<string, string> = {}): Promise<Bench> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-omp-"))
  const paths = coderPaths(home)
  const store = await CoderStore.open({ paths })
  const project = await store.addProject({ path: join(home, "repo") })
  const task = await store.createTask({
    projectId: project.project.id,
    title: "omp task",
    harness: "omp",
  })

  const events: RunEvent[] = []
  const manager = new RunManager({
    paths,
    store,
    onEvent: (event) => events.push(event),
    resolveLaunch: (input) => ({
      command: process.execPath,
      args: [FAKE_OMP],
      cwd: home,
      env: { ...agentEnv, ...input.extraEnv },
    }),
  })

  cleanups.push(async () => {
    await manager.stopAll()
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  return {
    manager,
    store,
    events,
    taskId: task!.id,
    async until(predicate, label) {
      const deadline = Date.now() + 12_000
      while (Date.now() < deadline) {
        if (predicate(events)) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error(
        `timed out waiting for ${label}. Events so far: ${events.map((e) => e.kind).join(", ")}`,
      )
    },
  }
}

const kinds = (events: readonly RunEvent[], kind: RunEvent["kind"]): RunEvent[] =>
  events.filter((event) => event.kind === kind)

describe("RunManager + fake Pi RPC (ready-only handshake)", () => {
  it("drives a turn without OMP protocol negotiate", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-pi-"))
    const paths = coderPaths(home)
    const store = await CoderStore.open({ paths })
    const project = await store.addProject({ path: join(home, "repo") })
    const task = await store.createTask({
      projectId: project.project.id,
      title: "pi task",
      harness: "pi",
    })
    const events: RunEvent[] = []
    const manager = new RunManager({
      paths,
      store,
      onEvent: (event) => events.push(event),
      resolveLaunch: () => ({
        command: process.execPath,
        args: [FAKE_OMP],
        cwd: home,
      }),
    })
    cleanups.push(async () => {
      await manager.stopAll()
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    })
    await manager.start({ taskId: task!.id, prompt: "pi-hi" })
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline) {
      if (kinds(events, "run.ended").length === 1) break
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(kinds(events, "run.ended")).toHaveLength(1)
    expect(
      kinds(events, "run.output").some(
        (e) => e.kind === "run.output" && e.text.includes("reply:pi-hi"),
      ),
    ).toBe(true)
  })
})

describe("RunManager + fake OMP (multi-turn)", () => {
  it("streams a turn and records the session file for resume", async () => {
    const b = await ompBench()
    const run = await b.manager.start({ taskId: b.taskId, prompt: "hello" })
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end")

    expect(said(b.events, "reply:hello")).toBe(true)
    const session = kinds(b.events, "run.session")[0]
    expect(session && session.kind === "run.session" ? session.sessionId : "").toBe(
      "/tmp/fake-omp-session.jsonl",
    )
    expect(b.manager.isLive(run.id)).toBe(false)
  })

  it("queues a follow-up and delivers it as the next turn (steer coerces to queue)", async () => {
    const b = await ompBench({ FAKE_OMP_SLOW_MS: "400" })
    const run = await b.manager.start({ taskId: b.taskId, prompt: "first" })
    await b.until((events) => said(events, "reply:first"), "first chunk")

    // OMP must queue — followUpMustQueue — even if the UI asks to steer.
    expect(await b.manager.send(run.id, "second", "steer")).toBe("queued")
    await b.until((events) => said(events, "reply:second"), "queued follow-up")
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end")

    const message = kinds(b.events, "run.message").find(
      (event) => event.kind === "run.message" && event.text === "second",
    )
    expect(message?.kind === "run.message" ? message.mode : "").toBe("queue")
    expect(message?.kind === "run.message" ? message.delivered : "").toBe("queued")
  })

  it("queues behind an approval card, then delivers after Allow", async () => {
    const b = await ompBench({ FAKE_OMP_ASK: "1" })
    const run = await b.manager.start({ taskId: b.taskId, prompt: "need tool" })
    await b.until(
      (events) => kinds(events, "run.approval-requested").length === 1,
      "the approval card",
    )

    expect(await b.manager.send(run.id, "after allow", "queue")).toBe("queued")

    const requested = kinds(b.events, "run.approval-requested")[0] as Extract<
      RunEvent,
      { kind: "run.approval-requested" }
    >
    // Always allow → host sessionAutoAllow; the follow-up turn's tool ask is answered silently.
    await b.manager.answerApproval(requested.runId, requested.requestId, "allow_always")
    await b.until((events) => said(events, "reply:after allow"), "queued follow-up after allow")
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end")
  })

  it("surfaces unmapped extension_ui as a generic approval card", async () => {
    const b = await ompBench({ FAKE_OMP_UNMAPPED_UI: "1" })
    await b.manager.start({ taskId: b.taskId, prompt: "confirm please" })
    await b.until(
      (events) => kinds(events, "run.approval-requested").length === 1,
      "generic UI card",
    )
    const requested = kinds(b.events, "run.approval-requested")[0] as Extract<
      RunEvent,
      { kind: "run.approval-requested" }
    >
    expect(requested.question).toMatch(/agent-ui/i)
    expect(requested.options.some((o) => o.id === "approve")).toBe(true)
    await b.manager.answerApproval(requested.runId, requested.requestId, "approve")
    await b.until((events) => kinds(events, "run.ended").length === 1, "the run to end")
  })

  it("cancels mid-turn as cancelled and refuses a later send", async () => {
    const b = await ompBench({ FAKE_OMP_SLOW_MS: "2000" })
    const run = await b.manager.start({ taskId: b.taskId, prompt: "slow" })
    await b.until((events) => said(events, "reply:slow"), "first chunk")

    expect(await b.manager.cancel(run.id)).toBe(true)
    await expect(b.manager.send(run.id, "ghost", "queue")).rejects.toThrow(/stopping|finished/i)
    await b.until((events) => kinds(events, "run.ended").length === 1, "cancel to end")

    const ended = kinds(b.events, "run.ended")[0]
    expect(ended && ended.kind === "run.ended" ? ended.status : "").toBe("cancelled")
    expect(said(b.events, "reply:ghost")).toBe(false)
  })

  it("ends the turn on bare prompt_result without agent_end", async () => {
    const b = await ompBench({
      FAKE_OMP_NO_AGENT_END: "1",
      FAKE_OMP_PROMPT_RESULT_BARE: "1",
    })
    await b.manager.start({ taskId: b.taskId, prompt: "bare" })
    await b.until((events) => kinds(events, "run.ended").length === 1, "bare prompt_result end")
    expect(said(b.events, "reply:bare")).toBe(true)
  })

  it("cancels during handshake without running the first turn", async () => {
    const b = await ompBench({ FAKE_OMP_SLOW_READY_MS: "400" })
    const run = await b.manager.start({ taskId: b.taskId, prompt: "never" })
    expect(await b.manager.cancel(run.id)).toBe(true)
    await b.until((events) => kinds(events, "run.ended").length === 1, "cancel during handshake")
    const ended = kinds(b.events, "run.ended")[0]
    expect(ended && ended.kind === "run.ended" ? ended.status : "").toBe("cancelled")
    expect(said(b.events, "reply:never")).toBe(false)
  })

  it("notes dropped queue when handshake fails", async () => {
    const b = await ompBench({ FAKE_OMP_NO_READY: "1" })
    const run = await b.manager.start({ taskId: b.taskId, prompt: "open" })
    // Connect still in flight — follow-up is accepted into the queue.
    expect(await b.manager.send(run.id, "queued-while-connecting", "queue")).toBe("queued")
    await b.until((events) => kinds(events, "run.ended").length === 1, "handshake fail")
    const ended = kinds(b.events, "run.ended")[0]
    expect(ended && ended.kind === "run.ended" ? ended.status : "").toBe("failed")
    const status = kinds(b.events, "run.status").find(
      (event) => event.kind === "run.status" && event.status === "failed",
    )
    expect(status && status.kind === "run.status" ? status.note : "").toMatch(
      /queued follow-up.*not sent/i,
    )
    expect(said(b.events, "reply:queued-while-connecting")).toBe(false)
  })

  it("marks the session non-resumable when get_state has no sessionFile", async () => {
    const b = await ompBench({ FAKE_OMP_NO_SESSION_FILE: "1" })
    await b.manager.start({ taskId: b.taskId, prompt: "synthetic" })
    await b.until((events) => kinds(events, "run.ended").length === 1, "run end")
    const session = kinds(b.events, "run.session")[0]
    expect(session && session.kind === "run.session" ? session.resumable : true).toBe(false)
    expect(session && session.kind === "run.session" ? session.sessionId : "").toMatch(/^rpc-/)
  })

  it("does not resume a synthetic rpc- session id on the next run", async () => {
    const b = await ompBench({ FAKE_OMP_NO_SESSION_FILE: "1" })
    await b.manager.start({ taskId: b.taskId, prompt: "first" })
    await b.until((events) => kinds(events, "run.ended").length === 1, "first run end")
    const firstId =
      kinds(b.events, "run.session")[0]?.kind === "run.session"
        ? kinds(b.events, "run.session")[0].sessionId
        : ""
    expect(firstId).toMatch(/^rpc-/)

    b.events.length = 0
    await b.manager.start({ taskId: b.taskId, prompt: "second", resume: true })
    await b.until((events) => kinds(events, "run.ended").length === 1, "second run end")
    const second = kinds(b.events, "run.session")[0]
    expect(second && second.kind === "run.session" ? second.resumed : true).toBe(false)
    expect(second && second.kind === "run.session" ? second.sessionId : "").not.toBe(firstId)
  })
})

function said(events: readonly RunEvent[], needle: string): boolean {
  return kinds(events, "run.output").some(
    (event) => event.kind === "run.output" && event.text.includes(needle),
  )
}
