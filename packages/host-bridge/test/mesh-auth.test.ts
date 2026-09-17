/**
 * **The mesh auth gate, attacked method by method.**
 *
 * ## Why this file exists
 *
 * `mesh-peer-e2e.test.ts` proves that **one** method (`coder.meshStatus`) is refused for an invalid
 * token. That is a sample, not a property. The daemon's mesh peer is reachable by every peer on the
 * family's shared community network (the DHT swarm alone connects dozens), so the question an owner
 * actually asked — *"30 peers are connected and I paired nothing; is this risky?"* — needs the
 * property, not the sample:
 *
 * > **no method in `RPC_METHODS` is dispatched before the per-connection handshake resolves a
 * > session, and the session handed to the dispatcher is never `undefined`.**
 *
 * The second half is the load-bearing one. `apps/desktop/src/daemon/pairing.ts`'s `requireOwnerWindow`
 * decides "the owner's own window" from `context.session === undefined` — a rule that is only sound
 * because the WebSocket transport refuses a tokenless non-loopback caller *before* dispatch. The mesh
 * transport has no loopback concept at all, so this file asserts the stronger fact directly: a valid
 * token always produces a defined session here, and no token produces no dispatch.
 *
 * ## What it drives
 *
 * `createMeshHostTransport` — the exact function `mesh-peer.ts` hands to `libp2p` for
 * `CLIENT_PROXY_PROTOCOL` — over a scripted `FramedDuplex`. No libp2p: the framing, the handshake and
 * the gate are all above the socket, and a fake duplex can send shapes a polite client would not.
 * `packages/host-bridge/test/mesh-peer-e2e.test.ts` covers the same gate over a real dial.
 */

import { describe, expect, it } from "vitest"

import { RPC_METHODS } from "@envoydev/protocol"

import { createCoderDispatcher, createMeshHostTransport, type FramedDuplex } from "../src/index.js"

/* ────────────────────────────── the scripted wire ────────────────────────────── */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * A duplex that writes back the scripted frames and records every frame the transport wrote.
 *
 * `read()` returns one queued chunk per call, then `undefined` (a peer that closed). Chunks are what
 * a TCP-ish transport delivers, so an attacker can put several frames in one chunk — which is exactly
 * the shape that would bypass a gate written per *frame* rather than per *connection*.
 */
function scriptedDuplex(chunks: string[]): FramedDuplex & {
  written: string[]
  writes(): Record<string, unknown>[]
  closed: () => boolean
} {
  const queue = [...chunks]
  const written: string[] = []
  let closed = false
  return {
    written,
    writes: () =>
      written
        .join("")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    closed: () => closed,
    write: (frame: Uint8Array) => {
      written.push(decoder.decode(frame))
    },
    read: async () => (queue.length > 0 ? encoder.encode(queue.shift()) : undefined),
    close: () => {
      closed = true
    },
  }
}

const SESSION = {
  scopeKey: "product:EnvoyDev",
  ownerId: "envoy:owner:audit",
  isOwnerScope: true,
  deviceId: "audit-device",
  caller: { kind: "owner-device" },
}

const VALID_TOKEN = "paired-phone-token"

/** Every method, recorded; the transport is the only thing that can stop a call from landing here. */
function driven() {
  const dispatched: { method: string; session: unknown }[] = []
  const serve = createMeshHostTransport<unknown>(() => ({
    sessionIdentity: {
      localScopeKey: "product:EnvoyDev",
      resolveSession: async (token) => (token === VALID_TOKEN ? SESSION : null),
    },
    dispatch: createCoderDispatcher({
      handlers: Object.fromEntries(
        RPC_METHODS.map((method) => [
          method,
          async (_params: unknown, context: { session: unknown }) => {
            dispatched.push({ method, session: context.session })
            return { answered: method }
          },
        ]),
      ),
    }),
  }))
  return { dispatched, serve }
}

/** Every method name a dispatcher could ever be asked for, plus shapes that are not methods. */
const EVERY_METHOD = [...RPC_METHODS, "coder.notARealMethod", "__proto__", "constructor"]

/* ────────────────────────────── 1. no handshake at all ────────────────────────────── */

describe("a peer that never authenticates cannot reach any method", () => {
  it.each(EVERY_METHOD)(
    "refuses a bare request for %s sent as the first frame, before any dispatch",
    async (method) => {
      const { dispatched, serve } = driven()
      // The first frame a peer sends is read as the handshake. A request is not one: no `token`.
      const duplex = scriptedDuplex([`${JSON.stringify({ id: "atk", method, params: {} })}\n`])

      await serve(duplex)

      expect(duplex.writes()).toEqual([{ type: "proxy-reject", reason: "no token" }])
      expect(duplex.closed()).toBe(true)
      expect(dispatched).toEqual([])
    },
  )

  it.each(EVERY_METHOD)(
    "refuses a request for %s that arrives behind an invalid token, and never dispatches it",
    async (method) => {
      const { dispatched, serve } = driven()
      const duplex = scriptedDuplex([
        `${JSON.stringify({ type: "proxy-connect", token: "not-a-paired-token" })}\n`,
        `${JSON.stringify({ id: "atk", method, params: {} })}\n`,
      ])

      await serve(duplex)

      expect(duplex.writes()).toEqual([
        { type: "proxy-reject", reason: "invalid or expired token" },
      ])
      expect(duplex.closed()).toBe(true)
      expect(dispatched).toEqual([])
    },
  )

  it.each(EVERY_METHOD)(
    "refuses a request for %s coalesced into the same chunk as a bad handshake",
    async (method) => {
      // One write, two frames. `readOneFrame` takes the handshake out of the first chunk and only
      // the handshake; the request in the same chunk must not reach the request loop.
      const { dispatched, serve } = driven()
      const duplex = scriptedDuplex([
        `${JSON.stringify({ type: "proxy-connect", token: "nope" })}\n${JSON.stringify({ id: "atk", method })}\n`,
      ])

      await serve(duplex)

      expect(duplex.writes().every((frame) => frame.type === "proxy-reject")).toBe(true)
      expect(dispatched).toEqual([])
    },
  )
})

/* ────────────────────────────── 2. handshake shape fuzzing ────────────────────────────── */

describe("handshake shapes that are not a valid token are refused before dispatch", () => {
  const cases: { name: string; frame: unknown }[] = [
    { name: "not JSON at all", frame: "<html>hello</html>" },
    { name: "a JSON array", frame: [] },
    { name: "a bare number", frame: 7 },
    { name: "a bare string", frame: "proxy-connect" },
    { name: "an unknown handshake type", frame: { type: "proxy-accept", token: VALID_TOKEN } },
    { name: "a type-less frame with no token", frame: { id: "atk", method: "coder.listProjects" } },
    { name: "an empty token", frame: { type: "proxy-connect", token: "" } },
    { name: "a whitespace token", frame: { type: "proxy-connect", token: "   " } },
    { name: "a non-string token", frame: { type: "proxy-connect", token: 12345 } },
    { name: "a null token", frame: { type: "proxy-connect", token: null } },
    { name: "a nested token object", frame: { type: "proxy-connect", token: { toString: "x" } } },
    { name: "a method smuggled into the handshake", frame: { method: "coder.mintPairing" } },
  ]

  it.each(cases)("refuses $name", async ({ frame }) => {
    const { dispatched, serve } = driven()
    const body = typeof frame === "string" ? frame : JSON.stringify(frame)
    const duplex = scriptedDuplex([`${body}\n`])

    await serve(duplex)

    const frames = duplex.writes()
    expect(frames).toHaveLength(1)
    expect(frames[0]?.type).toBe("proxy-reject")
    expect(frames[0]).not.toHaveProperty("id")
    expect(dispatched).toEqual([])
  })

  /**
   * **The one input that makes the transport throw instead of answering.**
   *
   * `JSON.parse("null")` succeeds and returns `null`, so the `catch` around the parse never runs and
   * the next line — `parsed.type !== undefined` — throws `TypeError: Cannot read properties of null`
   * before any `proxy-reject` is written. That contradicts the module's own contract ("Never throws
   * for a peer's misbehaviour"): the peer gets a stream abort, not a refusal.
   *
   * It is **not** an auth bypass — the throw is above the session check, so nothing is dispatched,
   * which is what this test pins. Its blast radius is measured over a real dial in
   * `mesh-peer-e2e.test.ts`: libp2p catches the rejected handler and aborts that stream only. The
   * fix belongs in EnvoyMesh's `mesh-host-transport.ts` and is deliberately not made here.
   */
  it("throws on a bare `null` handshake — and still dispatches nothing", async () => {
    const { dispatched, serve } = driven()
    const duplex = scriptedDuplex(["null\n"])

    await expect(serve(duplex)).rejects.toThrow(TypeError)

    expect(duplex.writes()).toEqual([])
    expect(dispatched).toEqual([])
  })

  /**
   * The same defect on the *request* frame, reachable only by an already-authenticated peer.
   *
   * `handleFrame` guards `JSON.parse` but not the `null` it returns, so `request.method` throws. The
   * blast radius is that peer's own connection (a client can always close its own stream), so this is
   * a contract/robustness note rather than an auth issue — pinned here so the audit's claim about it
   * is measured, and so a fix in `mesh-host-transport.ts` has a failing-to-pass target.
   */
  it("throws on a `null` request frame after a valid handshake, and dispatches nothing", async () => {
    const { dispatched, serve } = driven()
    const duplex = scriptedDuplex([
      `${JSON.stringify({ type: "proxy-connect", token: VALID_TOKEN })}\n`,
      "null\n",
    ])

    await expect(serve(duplex)).rejects.toThrow(TypeError)

    expect(duplex.writes()).toEqual([{ type: "proxy-accept" }])
    expect(dispatched).toEqual([])
  })

  it("refuses a valid token sent under an unknown type (the type is checked, not ignored)", async () => {
    const { dispatched, serve } = driven()
    const duplex = scriptedDuplex([
      `${JSON.stringify({ type: "proxy-data", token: VALID_TOKEN })}\n`,
      `${JSON.stringify({ id: "atk", method: "coder.listProjects" })}\n`,
    ])

    await serve(duplex)

    expect(duplex.writes()).toEqual([{ type: "proxy-reject", reason: "unknown handshake type" }])
    expect(dispatched).toEqual([])
  })
})

/* ────────────────────────────── 3. the positive control, and what it proves ────────────────────────────── */

describe("the gate is per-connection, and a resolved session is never undefined", () => {
  it("dispatches a request only after `proxy-accept`, and hands the dispatcher a defined session", async () => {
    const seen: { method: string; session: unknown }[] = []
    const serve = createMeshHostTransport<unknown>(() => ({
      sessionIdentity: {
        localScopeKey: "product:EnvoyDev",
        resolveSession: async (token) => (token === VALID_TOKEN ? SESSION : null),
      },
      dispatch: async (method, _params, session) => {
        seen.push({ method, session })
        return { answered: method }
      },
    }))
    const duplex = scriptedDuplex([
      `${JSON.stringify({ type: "proxy-connect", token: VALID_TOKEN })}\n`,
      `${JSON.stringify({ id: "ok", method: "coder.mintPairing", params: {} })}\n`,
    ])

    await serve(duplex)

    expect(duplex.writes()).toEqual([
      { type: "proxy-accept" },
      { id: "ok", result: { answered: "coder.mintPairing" } },
    ])
    // The fact `requireOwnerWindow` rests on: a mesh dispatch always carries a session, so a
    // paired phone is refused `coder.mintPairing` by the *handler*, not by the transport.
    expect(seen).toEqual([{ method: "coder.mintPairing", session: SESSION }])
  })

  it("accepts the node's older token-only handshake shape, still with a resolved session", async () => {
    const seen: unknown[] = []
    const serve = createMeshHostTransport<unknown>(() => ({
      sessionIdentity: {
        localScopeKey: "product:EnvoyDev",
        resolveSession: async (token) => (token === VALID_TOKEN ? SESSION : null),
      },
      dispatch: async (_method, _params, session) => {
        seen.push(session)
        return {}
      },
    }))
    const duplex = scriptedDuplex([
      `${JSON.stringify({ token: VALID_TOKEN })}\n`,
      `${JSON.stringify({ id: "ok", method: "coder.hello" })}\n`,
    ])

    await serve(duplex)

    expect(duplex.writes()[0]).toEqual({ type: "proxy-accept" })
    expect(seen).toEqual([SESSION])
  })

  it("never dispatches for a peer that authenticates and then sends no request", async () => {
    const { dispatched, serve } = driven()
    const duplex = scriptedDuplex([
      `${JSON.stringify({ type: "proxy-connect", token: VALID_TOKEN })}\n`,
    ])

    await serve(duplex)

    expect(duplex.writes()).toEqual([{ type: "proxy-accept" }])
    expect(duplex.closed()).toBe(true)
    expect(dispatched).toEqual([])
  })

  it("answers an unknown method only after the token resolved — the dispatcher is not a pre-auth surface", async () => {
    const { serve } = driven()
    const duplex = scriptedDuplex([
      `${JSON.stringify({ type: "proxy-connect", token: "wrong" })}\n`,
      `${JSON.stringify({ id: "atk", method: "coder.notARealMethod" })}\n`,
    ])

    await serve(duplex)

    expect(duplex.writes()).toEqual([
      { type: "proxy-reject", reason: "invalid or expired token" },
    ])
  })
})
