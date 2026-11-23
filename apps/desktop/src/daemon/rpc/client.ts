/**
 * Pi-family JSONL RPC agent client (OMP `rpc-ui`, Pi `rpc`).
 *
 * Duck-types the AcpClient surface RunManager needs: prompt / cancel / stop /
 * sessionId / sessionConfigOptions / applySession* / compact / recentStderr.
 *
 * Stability rules for multi-round use:
 *   * One prompt in flight; any `prompt_result` or `agent_end` ends it.
 *   * `extension_ui_request` is serialized so `live.approval` is never stomped.
 *   * `cancel` finishes the turn and gates the next `prompt` on abort completing.
 */

import type { AcpLaunch, AcpPermissionRequest, AcpSessionPolicy, AcpUpdate } from "../acp/client.js"
import {
  JSONL_RPC_DEFAULT_TIMEOUT_MS,
  JSONL_RPC_NO_TIMEOUT,
  JsonlRpcProcess,
  supportsJsonlRpcProtocolV2,
  type JsonlRpcLaunch,
} from "./jsonl-rpc-process.js"
import {
  extensionUiResponseFromOption,
  mapExtensionUiToPermission,
  type ExtensionUiRequest,
  type MappedOmpPermission,
} from "./permission-mapper.js"

const READY_TIMEOUT_MS = 20_000

export interface JsonlRpcClientOptions {
  launch: AcpLaunch
  /** When true, wait for OMP `ready` and optionally negotiate protocol v2. */
  negotiateOmp?: boolean
  onUpdate?: (update: AcpUpdate) => void
  onPermissionRequest?: (request: AcpPermissionRequest) => Promise<string | null>
  onStderr?: (line: string) => void
  handshakeTimeoutMs?: number
  requestTimeoutMs?: number
  /** Ignored — RPC has no ACP session configs; kept for call-site parity. */
  sessionConfigs?: readonly { configId: string; value: string }[]
  sessionPolicy?: AcpSessionPolicy
  agentModeId?: string
  resumeSessionId?: string
}

export class JsonlRpcAgentClient {
  private sessionIdValue: string | undefined
  /** True when `sessionId` came from `get_state.sessionFile` (safe for `--session` resume). */
  private sessionFileVerified = false
  private stopping: Promise<void> | undefined
  private readonly pendingPermissions = new Map<string, MappedOmpPermission>()
  private turnSettle: ((result: { stopReason: string }) => void) | undefined
  private turnFail: ((error: Error) => void) | undefined
  private turnPromptId: string | undefined
  /** agent_end / prompt_result / cancel that arrived before the settle waiter was attached. */
  private earlyStopReason: string | undefined
  /** Serialize tool/UI permission cards — one `live.approval` slot in RunManager. */
  private uiChain: Promise<void> = Promise.resolve()
  /** In-flight abort so the next prompt waits for the agent to stop the previous turn. */
  private aborting: Promise<void> | null = null

  private constructor(
    private readonly process: JsonlRpcProcess,
    private readonly options: JsonlRpcClientOptions,
  ) {
    process.onMessage((message) => this.onMessage(message))
    process.onExit(({ error }) => {
      if (this.turnFail) {
        this.turnFail(error)
        this.clearTurn()
      }
    })
  }

  static async start(options: JsonlRpcClientOptions): Promise<JsonlRpcAgentClient> {
    const launch: JsonlRpcLaunch = {
      command: options.launch.command,
      args: options.launch.args,
      cwd: options.launch.cwd,
      ...(options.launch.env ? { env: options.launch.env } : {}),
    }
    const process = new JsonlRpcProcess({
      launch,
      diagnosticName: options.negotiateOmp === false ? "Pi RPC" : "OMP RPC",
      defaultRequestTimeoutMs: options.handshakeTimeoutMs ?? JSONL_RPC_DEFAULT_TIMEOUT_MS,
      onWarn: (_message, detail) => {
        if (detail instanceof Error) options.onStderr?.(detail.message)
      },
    })
    const client = new JsonlRpcAgentClient(process, options)
    try {
      if (options.negotiateOmp !== false) {
        await client.establishOmpProtocol()
      } else {
        await client.waitForReady()
      }
      // Prefer the agent's session file path so `--session` resumeArgs are real; fall back for fixtures.
      const sessionFile = await client.readSessionFile()
      if (sessionFile !== undefined) {
        client.sessionIdValue = sessionFile
        client.sessionFileVerified = true
      } else {
        client.sessionIdValue =
          options.resumeSessionId ?? `rpc-${Date.now().toString(36)}`
        // A prior run's verified path is still honest to resume; a synthetic `rpc-…` id is not.
        client.sessionFileVerified = options.resumeSessionId !== undefined
      }
      return client
    } catch (error) {
      await client.stop().catch(() => undefined)
      throw error
    }
  }

  /** OMP/Pi `get_state.sessionFile` — the path `--session` resumes. */
  private async readSessionFile(): Promise<string | undefined> {
    try {
      const state = (await this.process.request(
        { type: "get_state" },
        this.options.handshakeTimeoutMs ?? JSONL_RPC_DEFAULT_TIMEOUT_MS,
      )) as { sessionFile?: unknown } | undefined
      return typeof state?.sessionFile === "string" && state.sessionFile !== ""
        ? state.sessionFile
        : undefined
    } catch {
      return undefined
    }
  }

  get sessionId(): string | undefined {
    return this.sessionIdValue
  }

  /**
   * Whether `--session` with {@link sessionId} is expected to work. False for the synthetic
   * `rpc-…` fallback so the UI does not offer Resume that will fail at next spawn.
   */
  get sessionResumable(): boolean {
    return this.sessionFileVerified
  }

  sessionConfigOptions(): readonly unknown[] {
    return []
  }

  recentStderr(): readonly string[] {
    const text = this.process.recentStderr()
    return text ? text.split("\n").filter(Boolean) : []
  }

  async applySessionPolicy(_policy: AcpSessionPolicy): Promise<void> {
    // OMP Asking Off is launch argv; mid-run uses host sessionAutoAllow.
  }

  async applySessionMode(_mode: string): Promise<void> {
    // Mode → `--approval-mode` at next spawn.
  }

  async compact(_options?: { keep?: number; budget?: number; summarize?: boolean }): Promise<void> {
    try {
      await this.process.request({ type: "compact" }, JSONL_RPC_NO_TIMEOUT)
    } catch {
      // Method may be absent on older binaries.
    }
  }

  async prompt(
    text: string,
    images?: readonly { mimeType: string; data: string }[],
  ): Promise<{ stopReason: string }> {
    // Do not start the next turn while abort is still draining the previous one.
    if (this.aborting) await this.aborting.catch(() => undefined)

    const timeoutMs = this.options.requestTimeoutMs ?? 30 * 60_000
    this.earlyStopReason = undefined
    const imagesPayload = images?.map((image) => ({
      type: "image" as const,
      data: image.data,
      mimeType: image.mimeType,
    }))

    // Attach settle *before* sending so cancel / prompt_result / agent_end in the ack window
    // cannot land with turnOpen false or only earlyStopReason that nobody re-reads.
    return await new Promise<{ stopReason: string }>((resolve, reject) => {
      let closed = false
      const close = (result: { stopReason: string } | Error): void => {
        if (closed) return
        closed = true
        clearTimeout(timer)
        this.clearTurn()
        if (result instanceof Error) reject(result)
        else resolve(result)
      }
      const timer = setTimeout(() => {
        close(new Error("JSONL RPC turn timed out waiting for agent_end / prompt_result"))
      }, timeoutMs)
      this.turnSettle = (result) => close(result)
      this.turnFail = (error) => close(error)

      const { id, promise: ack } = this.process.startRequest(
        {
          type: "prompt",
          message: text,
          ...(imagesPayload?.length ? { images: imagesPayload } : {}),
        },
        timeoutMs,
      )
      this.turnPromptId = id

      // Cancel / end may have finished the turn while startRequest ran synchronously.
      if (this.earlyStopReason !== undefined) {
        close({ stopReason: this.earlyStopReason })
        return
      }

      void ack.then(
        () => {
          // Prompt accepted — still waiting for agent_end / prompt_result / cancel via turnSettle.
          if (this.earlyStopReason !== undefined && !closed) {
            close({ stopReason: this.earlyStopReason })
          }
        },
        (error) => {
          close(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
  }

  cancel(): void {
    if (!this.aborting) {
      this.aborting = this.process
        .requestStopWork({ type: "abort" })
        .catch(() => undefined)
        .finally(() => {
          this.aborting = null
        })
    }
    this.finishTurn("cancelled")
  }

  private clearTurn(): void {
    this.turnSettle = undefined
    this.turnFail = undefined
    this.turnPromptId = undefined
    this.earlyStopReason = undefined
  }

  private finishTurn(stopReason: string): void {
    if (this.turnSettle) {
      this.turnSettle({ stopReason })
      return
    }
    // Turn opening (settle not yet assigned) or already cleared — stash for the opener.
    this.earlyStopReason = stopReason
  }

  private turnOpen(): boolean {
    return this.turnPromptId !== undefined || this.turnSettle !== undefined
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopping = this.process.close(new Error("The agent was stopped."))
    return this.stopping
  }

  private async establishOmpProtocol(): Promise<void> {
    const ready = await this.waitForReady()
    if (!supportsJsonlRpcProtocolV2(ready)) return
    const response = (await this.process.request(
      { type: "negotiate_protocol", protocolVersion: 2 },
      this.options.handshakeTimeoutMs ?? JSONL_RPC_DEFAULT_TIMEOUT_MS,
    )) as { protocolVersion?: unknown } | undefined
    if (response?.protocolVersion !== 2) {
      throw new Error("OMP did not accept RPC protocol v2")
    }
  }

  private waitForReady(): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let settled = false
      let unsubMessage = (): void => undefined
      let unsubExit = (): void => undefined
      const timer = setTimeout(() => {
        finish(new Error("Timed out waiting for JSONL RPC agent to become ready"))
      }, this.options.handshakeTimeoutMs ?? READY_TIMEOUT_MS)
      const finish = (result: Record<string, unknown> | Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubMessage()
        unsubExit()
        if (result instanceof Error) reject(result)
        else resolve(result)
      }
      unsubMessage = this.process.onMessage((message) => {
        if (message.type === "ready") finish(message)
      })
      unsubExit = this.process.onExit(({ error }) => finish(error))
    })
  }

  private onMessage(message: Record<string, unknown>): void {
    switch (message.type) {
      case "message_update": {
        const assistant = message.assistantMessageEvent as
          | { type?: string; delta?: string; text?: string }
          | undefined
        if (assistant?.type === "text_delta") {
          const text = assistant.delta ?? assistant.text ?? ""
          if (text) {
            this.options.onUpdate?.({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text },
            })
          }
        }
        return
      }
      case "agent_end": {
        this.finishTurn("end_turn")
        return
      }
      case "prompt_result": {
        // One prompt in flight: any result ends the turn. Matching id is preferred; some binaries
        // omit or rewrite ids — waiting only for a match (and no agent_end) hung follow-ups.
        if (!this.turnOpen()) return
        this.finishTurn(message.success === false ? "refusal" : "end_turn")
        return
      }
      case "extension_ui_request": {
        const event = message as unknown as ExtensionUiRequest
        this.uiChain = this.uiChain
          .then(() => this.handleExtensionUi(event))
          .catch(() => undefined)
        return
      }
      default:
        return
    }
  }

  private async handleExtensionUi(event: ExtensionUiRequest): Promise<void> {
    if (typeof event.id !== "string") return
    const sessionId = this.sessionIdValue ?? "rpc"
    const mapped = mapExtensionUiToPermission(event, sessionId)
    if (!mapped) {
      // Unknown UI shape — still surface a card so the turn is not silently refused.
      await this.handleGenericExtensionUi(event, sessionId)
      return
    }
    this.pendingPermissions.set(event.id, mapped)
    try {
      const optionId =
        (await this.options.onPermissionRequest?.(mapped.request)) ?? null
      const response = extensionUiResponseFromOption(optionId, mapped)
      this.process.send({ type: "extension_ui_response", id: event.id, ...response })
    } catch {
      this.process.send({ type: "extension_ui_response", id: event.id, cancelled: true })
    } finally {
      this.pendingPermissions.delete(event.id)
    }
  }

  /**
   * Non–Approve/Deny extension UI: ask the user with a generic card, then answer OMP with
   * confirmed / cancelled (or the first option value when it is a select).
   */
  private async handleGenericExtensionUi(
    event: ExtensionUiRequest,
    sessionId: string,
  ): Promise<void> {
    const title =
      typeof event.title === "string" && event.title.trim() !== ""
        ? event.title
        : "The agent is asking for confirmation."
    const request: AcpPermissionRequest = {
      sessionId,
      toolCall: { toolCallId: event.id, title: title.split(/\r?\n/, 1)[0] ?? "Agent request", kind: "other" },
      toolName: "agent-ui",
      description: title,
      options: [
        { optionId: "deny", name: "Deny", kind: "reject_once" },
        { optionId: "approve", name: "Approve", kind: "allow_once" },
      ],
    }
    try {
      const optionId = (await this.options.onPermissionRequest?.(request)) ?? null
      if (optionId === null || optionId === "deny") {
        this.process.send({ type: "extension_ui_response", id: event.id, cancelled: true })
        return
      }
      const options = Array.isArray(event.options) ? event.options : []
      const first =
        options.find((entry) => typeof entry === "string" && entry !== "Deny") ??
        (typeof options[0] === "string" ? options[0] : undefined)
      if (typeof first === "string") {
        this.process.send({ type: "extension_ui_response", id: event.id, value: first })
      } else {
        this.process.send({ type: "extension_ui_response", id: event.id, confirmed: true })
      }
    } catch {
      this.process.send({ type: "extension_ui_response", id: event.id, cancelled: true })
    }
  }
}

/** OMP uses negotiate; alias for call sites. */
export const OmpRpcClient = JsonlRpcAgentClient
