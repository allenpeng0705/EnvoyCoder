/**
 * Line-oriented JSONL frame decoder for Pi-family RPC (OMP / Pi).
 *
 * Oversized lines are reported and skipped; invalid JSON is ignored. Protocol v2
 * chunked frames (`rpc_chunk`) are assembled when a ready handshake negotiated them.
 */

export const JSONL_PROVIDER_LINE_BYTES = 64 * 1024 * 1024

const V2_FRAME_BYTES = 1024 * 1024
const V2_REASSEMBLED_BYTES = 64 * 1024 * 1024
const V2_CHUNK_BYTES = 256 * 1024
const V2_BASE64_CHARS = Math.ceil(V2_CHUNK_BYTES / 3) * 4
const V2_MAX_CHUNKS = Math.ceil(V2_REASSEMBLED_BYTES / V2_CHUNK_BYTES)

export class ProviderStreamLimitError extends Error {
  readonly code = "PROVIDER_STREAM_LINE_TOO_LARGE"

  constructor(
    readonly limitBytes: number,
    readonly lineHead = "",
  ) {
    super(
      `Provider stdout line exceeds ${limitBytes} bytes. Start a new thread or reduce the provider response size.`,
    )
    this.name = "ProviderStreamLimitError"
  }
}

export type JsonlFrameProblem =
  | "line-too-large"
  | "invalid-json"
  | "invalid-chunk"
  | "invalid-base64"
  | "out-of-order-chunk"
  | "chunk-length-mismatch"
  | "invalid-chunk-payload"

export function supportsJsonlRpcProtocolV2(message: Record<string, unknown>): boolean {
  return (
    message.type === "ready" &&
    Array.isArray(message.supportedProtocolVersions) &&
    message.supportedProtocolVersions.includes(2) &&
    message.maxFrameBytes === V2_FRAME_BYTES &&
    message.maxReassembledFrameBytes === V2_REASSEMBLED_BYTES
  )
}

export class JsonlFrameDecoder {
  private buffer = ""
  private assembly: {
    id: string
    count: number
    byteLength: number
    parts: Buffer[]
    bytes: number
  } | null = null

  constructor(
    private readonly receiver: {
      frame(message: Record<string, unknown>): void
      problem(problem: JsonlFrameProblem, detail?: unknown): void
    },
  ) {}

  write(chunk: Buffer | string): void {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
    let newline: number
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      let line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (line.endsWith("\r")) line = line.slice(0, -1)
      if (!line.trim()) continue
      if (Buffer.byteLength(line, "utf8") > JSONL_PROVIDER_LINE_BYTES) {
        this.receiver.problem(
          "line-too-large",
          new ProviderStreamLimitError(JSONL_PROVIDER_LINE_BYTES, line.slice(0, 64)),
        )
        continue
      }
      this.consumeLine(line)
    }
  }

  private consumeLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      this.receiver.problem("invalid-json", { error, line })
      return
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
    const frame = parsed as Record<string, unknown>
    if (frame.type !== "rpc_chunk") {
      this.receiver.frame(frame)
      return
    }
    this.consumeChunk(frame)
  }

  private consumeChunk(frame: Record<string, unknown>): void {
    const { chunkId, index, count, byteLength, data } = frame
    if (
      typeof chunkId !== "string" ||
      typeof index !== "number" ||
      typeof count !== "number" ||
      typeof byteLength !== "number" ||
      typeof data !== "string" ||
      count < 2 ||
      count > V2_MAX_CHUNKS ||
      index < 0 ||
      index >= count ||
      data.length > V2_BASE64_CHARS
    ) {
      this.assembly = null
      this.receiver.problem("invalid-chunk", frame)
      return
    }
    const bytes = Buffer.from(data, "base64")
    if (bytes.byteLength > V2_CHUNK_BYTES) {
      this.assembly = null
      this.receiver.problem("invalid-base64")
      return
    }
    if (!this.assembly) {
      if (index !== 0) {
        this.receiver.problem("out-of-order-chunk")
        return
      }
      this.assembly = {
        id: chunkId,
        count,
        byteLength,
        parts: [],
        bytes: 0,
      }
    }
    const assembly = this.assembly
    if (
      assembly.id !== chunkId ||
      assembly.count !== count ||
      assembly.byteLength !== byteLength ||
      assembly.parts.length !== index
    ) {
      this.assembly = null
      this.receiver.problem("out-of-order-chunk")
      return
    }
    assembly.parts.push(bytes)
    assembly.bytes += bytes.byteLength
    if (assembly.parts.length < assembly.count) return
    this.assembly = null
    if (assembly.bytes !== assembly.byteLength) {
      this.receiver.problem("chunk-length-mismatch")
      return
    }
    try {
      const text = Buffer.concat(assembly.parts).toString("utf8")
      const inner = JSON.parse(text) as unknown
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        this.receiver.frame(inner as Record<string, unknown>)
      } else {
        this.receiver.problem("invalid-chunk-payload")
      }
    } catch (error) {
      this.receiver.problem("invalid-chunk-payload", error)
    }
  }
}
