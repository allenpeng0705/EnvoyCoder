/**
 * Thin JSONL RPC child process for Pi-family agents (OMP / Pi).
 *
 * Requests are `{ type, id, … }` lines on stdin; responses are
 * `{ type: "response", id, success, data?, error? }`. Unsolicited frames go to subscribers.
 */

import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from "node:child_process"

import {
  JsonlFrameDecoder,
  ProviderStreamLimitError,
  supportsJsonlRpcProtocolV2,
} from "./frame-decoder.js"

export { supportsJsonlRpcProtocolV2 }

export const JSONL_RPC_DEFAULT_TIMEOUT_MS = 30_000
export const JSONL_RPC_NO_TIMEOUT = null

const STDERR_BUFFER_LIMIT = 8192
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 2_000
const FORCE_SHUTDOWN_TIMEOUT_MS = 1_000

export interface JsonlRpcLaunch {
  command: string
  args: readonly string[]
  cwd: string
  env?: Record<string, string>
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
}

export interface JsonlRpcExit {
  code: number | null
  signal: NodeJS.Signals | null
  error: Error
}

export interface JsonlRpcProcessOptions {
  launch: JsonlRpcLaunch
  diagnosticName?: string
  defaultRequestTimeoutMs?: number
  spawn?: (launch: JsonlRpcLaunch) => ChildProcessWithoutNullStreams
  onWarn?: (message: string, detail?: unknown) => void
}

function assertChildWithPipes(
  child: ChildProcess,
): asserts child is ChildProcessWithoutNullStreams {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("JSONL RPC process was spawned without stdio streams")
  }
}

function spawnJsonlRpcProcess(launch: JsonlRpcLaunch): ChildProcessWithoutNullStreams {
  const child = spawn(launch.command, [...launch.args], {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    stdio: ["pipe", "pipe", "pipe"],
  })
  assertChildWithPipes(child)
  return child
}

export class JsonlRpcProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly diagnosticName: string
  private readonly pending = new Map<string, PendingRequest>()
  private readonly messageSubscribers = new Set<(message: Record<string, unknown>) => void>()
  private readonly exitSubscribers = new Set<(exit: JsonlRpcExit) => void>()
  private stderrBuffer = ""
  private nextRequestId = 1
  private disposed = false
  private streamFailure: ProviderStreamLimitError | null = null
  private exited = false
  private closing: Promise<void> | null = null
  private readonly frameDecoder: JsonlFrameDecoder

  constructor(private readonly options: JsonlRpcProcessOptions) {
    this.diagnosticName = options.diagnosticName ?? "JSONL RPC"
    this.frameDecoder = new JsonlFrameDecoder({
      frame: (message) => this.dispatchFrame(message),
      problem: (problem, detail) => {
        if (problem === "line-too-large" && detail instanceof ProviderStreamLimitError) {
          this.streamFailure = detail
          void this.close(detail).catch(() => undefined)
          return
        }
        this.options.onWarn?.(`Ignoring invalid ${this.diagnosticName} frame`, { problem, detail })
      },
    })
    this.child = (options.spawn ?? spawnJsonlRpcProcess)(options.launch)
    this.child.stdout.on("data", (chunk) => this.frameDecoder.write(chunk))
    this.child.stderr.on("data", (chunk) => {
      this.stderrBuffer += chunk.toString()
      if (this.stderrBuffer.length > STDERR_BUFFER_LIMIT) {
        this.stderrBuffer = this.stderrBuffer.slice(-STDERR_BUFFER_LIMIT)
      }
    })
    this.child.stdin.on("error", (error) => this.handleStdinError(error))
    this.child.on("error", (error) => {
      this.failAll(error instanceof Error ? error : new Error(String(error)))
    })
    this.child.on("exit", (code, signal) => {
      this.exited = true
      const error =
        this.streamFailure ??
        new Error(
          `${this.diagnosticName} process exited with code ${code ?? "null"} and signal ${signal ?? "null"}\n${this.stderrBuffer}`.trim(),
        )
      const exit = { code, signal, error }
      for (const subscriber of this.exitSubscribers) subscriber(exit)
      this.failAll(error)
    })
  }

  recentStderr(): string {
    return this.stderrBuffer
  }

  onMessage(callback: (message: Record<string, unknown>) => void): () => void {
    this.messageSubscribers.add(callback)
    return () => {
      this.messageSubscribers.delete(callback)
    }
  }

  onExit(callback: (exit: JsonlRpcExit) => void): () => void {
    this.exitSubscribers.add(callback)
    return () => {
      this.exitSubscribers.delete(callback)
    }
  }

  startRequest(
    command: { type: string; [key: string]: unknown },
    timeoutMs?: number | null,
  ): { id: string; promise: Promise<unknown> } {
    if (this.disposed) {
      return {
        id: "",
        promise: Promise.reject(new Error(`${this.diagnosticName} process is closed`)),
      }
    }
    const id = `req_${this.nextRequestId}`
    this.nextRequestId += 1
    const requestTimeoutMs =
      timeoutMs === undefined
        ? (this.options.defaultRequestTimeoutMs ?? JSONL_RPC_DEFAULT_TIMEOUT_MS)
        : timeoutMs
    const startedAt = Date.now()
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer =
        requestTimeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id)
              reject(
                new Error(
                  `${this.diagnosticName} request timed out phase=${command.type} elapsedMs=${Date.now() - startedAt} timeoutMs=${requestTimeoutMs}\n${this.stderrBuffer}`.trim(),
                ),
              )
            }, requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ ...command, id })
    })
    return { id, promise }
  }

  request(
    command: { type: string; [key: string]: unknown },
    timeoutMs?: number | null,
  ): Promise<unknown> {
    return this.startRequest(command, timeoutMs).promise
  }

  async requestStopWork(
    command: { type: string; [key: string]: unknown },
    timeoutMs?: number | null,
  ): Promise<void> {
    if (this.exited) return
    try {
      await this.request(command, timeoutMs)
    } catch (error) {
      await this.closing?.catch(() => undefined)
      if (!this.exited) throw error
    }
  }

  send(message: Record<string, unknown>): void {
    if (this.disposed) return
    if (this.child.stdin.destroyed || !this.child.stdin.writable) {
      this.handleStdinError(new Error(`${this.diagnosticName} stdin is not writable`))
      return
    }
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`)
    } catch (error) {
      this.handleStdinError(error)
    }
  }

  async close(error = new Error(`${this.diagnosticName} process is closed`)): Promise<void> {
    if (this.disposed && this.closing) {
      await this.closing
      return
    }
    this.failAll(error)
    this.closing = this.terminate()
    await this.closing
  }

  private async terminate(): Promise<void> {
    try {
      this.child.stdin.end()
    } catch {
      // ignore
    }
    const exited = new Promise<void>((resolve) => {
      if (this.exited) {
        resolve()
        return
      }
      this.child.once("exit", () => resolve())
      this.child.once("close", () => resolve())
    })
    const graceful = await Promise.race([
      exited.then(() => true as const),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), GRACEFUL_SHUTDOWN_TIMEOUT_MS)),
    ])
    if (!graceful && !this.exited) {
      this.child.kill("SIGTERM")
      const forced = await Promise.race([
        exited.then(() => true as const),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), FORCE_SHUTDOWN_TIMEOUT_MS)),
      ])
      if (!forced && !this.exited) this.child.kill("SIGKILL")
    }
    await exited.catch(() => undefined)
  }

  private dispatchFrame(message: Record<string, unknown>): void {
    const pending =
      message.type === "response" && typeof message.id === "string"
        ? this.pending.get(message.id)
        : undefined
    if (pending) {
      this.settleRequest(pending, message as { id: string; success?: boolean; data?: unknown; error?: string; command?: string })
      return
    }
    for (const subscriber of this.messageSubscribers) subscriber(message)
  }

  private settleRequest(
    pending: PendingRequest,
    response: { id: string; success?: boolean; data?: unknown; error?: string; command?: string },
  ): void {
    if (pending.timer) clearTimeout(pending.timer)
    this.pending.delete(response.id)
    if (!response.success) {
      pending.reject(
        new Error(
          response.error ?? `${this.diagnosticName} ${response.command ?? "request"} failed`,
        ),
      )
      return
    }
    pending.resolve(response.data)
  }

  private handleStdinError(error: unknown): void {
    if (this.disposed) return
    const err = error instanceof Error ? error : new Error(String(error))
    this.options.onWarn?.(`${this.diagnosticName} stdin write failed`, err)
    void this.close(err)
  }

  private failAll(error: Error): void {
    if (this.disposed) return
    this.disposed = true
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
