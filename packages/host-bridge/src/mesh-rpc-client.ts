/**
 * One-shot `coder.*` JSON-RPC over a mesh duplex (CLIENT_PROXY framing).
 *
 * Team members authenticate with a team token via `{type:"proxy-connect", token}` —
 * the same handshake a paired phone uses. The product's `resolveSession` decides
 * whether that token is a pairing credential or a team credential; this client
 * does not care which.
 */

import { meshStreamAsDuplex } from "@envoymesh/network"
import type { FramedDuplex } from "@envoymesh/reuse-host"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type MeshRpcOutcome<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; message: string; code?: string }

export type MeshStreamDial = (multiaddr: string, protocol: string) => Promise<unknown>

/**
 * Dial a peer's CLIENT_PROXY stream, authenticate, call one method, close.
 */
export async function callMeshHostRpc<T = unknown>(options: {
  multiaddr: string
  protocol: string
  dial: MeshStreamDial
  token: string
  method: string
  params?: unknown
  timeoutMs?: number
  toDuplex?: (stream: unknown) => FramedDuplex
}): Promise<MeshRpcOutcome<T>> {
  const timeoutMs = options.timeoutMs ?? 12_000
  const toDuplex = options.toDuplex ?? ((stream: unknown) => meshStreamAsDuplex(stream as never))
  const id = `mesh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  let duplex: FramedDuplex | undefined
  let buffer = ""

  const readFrame = async (): Promise<Record<string, unknown> | undefined> => {
    for (;;) {
      const newline = buffer.indexOf("\n")
      if (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.trim() === "") continue
        return JSON.parse(line) as Record<string, unknown>
      }
      const chunk = await duplex!.read()
      if (chunk === undefined) return undefined
      buffer += decoder.decode(chunk)
    }
  }

  try {
    const stream = await Promise.race([
      options.dial(options.multiaddr, options.protocol),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Mesh dial timed out after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
    duplex = toDuplex(stream)
    await duplex.write(encoder.encode(`${JSON.stringify({ type: "proxy-connect", token: options.token })}\n`))
    const handshake = await readFrame()
    if (!handshake || handshake.type !== "proxy-accept") {
      const reason =
        typeof handshake?.reason === "string" ? handshake.reason : "mesh proxy rejected the token"
      return { ok: false, message: reason }
    }

    await duplex.write(
      encoder.encode(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: options.method,
          params: options.params ?? {},
        })}\n`,
      ),
    )

    const deadline = Date.now() + timeoutMs
    for (;;) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return { ok: false, message: `Mesh RPC timed out after ${timeoutMs} ms` }
      const frame = await Promise.race([
        readFrame(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), remaining)),
      ])
      if (!frame) return { ok: false, message: `Mesh RPC timed out after ${timeoutMs} ms` }
      if (frame.id !== id && String(frame.id) !== id) continue
      if (frame.error && typeof frame.error === "object") {
        const err = frame.error as { message?: string; code?: string | number }
        const message = typeof err.message === "string" ? err.message : "Mesh peer refused the call"
        const code = typeof err.code === "string" ? err.code : undefined
        return { ok: false, message, ...(code ? { code } : {}) }
      }
      return { ok: true, result: frame.result as T }
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    try {
      await duplex?.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Reachability probe: open CLIENT_PROXY, authenticate, close without an RPC.
 * Success means the multiaddr answers and the token is accepted.
 */
export async function probeMeshHost(options: {
  multiaddr: string
  protocol: string
  dial: MeshStreamDial
  token: string
  timeoutMs?: number
  toDuplex?: (stream: unknown) => FramedDuplex
}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 4_000
  const toDuplex = options.toDuplex ?? ((stream: unknown) => meshStreamAsDuplex(stream as never))
  let duplex: FramedDuplex | undefined
  let buffer = ""
  try {
    const stream = await Promise.race([
      options.dial(options.multiaddr, options.protocol),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs)
      }),
    ])
    duplex = toDuplex(stream)
    await duplex.write(encoder.encode(`${JSON.stringify({ type: "proxy-connect", token: options.token })}\n`))
    for (;;) {
      const newline = buffer.indexOf("\n")
      if (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.trim() === "") continue
        const parsed = JSON.parse(line) as { type?: string }
        return parsed.type === "proxy-accept"
      }
      const chunk = await Promise.race([
        duplex.read(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
      ])
      if (chunk === undefined) return false
      buffer += decoder.decode(chunk)
    }
  } catch {
    return false
  } finally {
    try {
      await duplex?.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Transport-only reachability: dial the protocol stream and close.
 * Used when member dial has no team token yet (assign-time probe).
 */
export async function probeMeshDial(options: {
  multiaddr: string
  protocol: string
  dial: MeshStreamDial
  timeoutMs?: number
  toDuplex?: (stream: unknown) => FramedDuplex
}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 4_000
  const toDuplex = options.toDuplex ?? ((stream: unknown) => meshStreamAsDuplex(stream as never))
  let duplex: FramedDuplex | undefined
  try {
    const stream = await Promise.race([
      options.dial(options.multiaddr, options.protocol),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs)
      }),
    ])
    duplex = toDuplex(stream)
    return true
  } catch {
    return false
  } finally {
    try {
      await duplex?.close()
    } catch {
      /* ignore */
    }
  }
}
