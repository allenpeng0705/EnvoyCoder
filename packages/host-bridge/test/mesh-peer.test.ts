/**
 * EnvoyDev's own mesh peer: identity, hints, status honesty, lifecycle, and the per-connection shape.
 *
 * Everything here runs against an injected node factory — no libp2p dial, no relay, no listener.
 * That is the point of the seam: the decisions worth testing (which key, which relays, when we may
 * say `hosting`, what a failure maps to, whether connection state can leak) are exactly the ones a
 * real dial would obscure. A separate smoke leg covers the part only a real network can prove.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { privateKeyToProtobuf } from "@libp2p/crypto/keys"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { EnvoyMeshOptions } from "@envoymesh/network"

import {
  CODER_MESH_RELAY_HINTS,
  coderMeshOptions,
  coderPaths,
  createCoderMeshPeer,
  meshIdentityPath,
  type CoderMeshPeerNode,
} from "../src/index.js"

/**
 * The family's shipped relays, copied verbatim from
 * `../EnvoyMesh/packages/api/src/default-bootstrap.ts:16-21`.
 *
 * Hardcoded rather than imported: importing the same constant the module imports would make the
 * assertion a tautology, and the fact worth pinning is that these two addresses — the cn and us
 * community relays — are what a phone will be told to dial.
 */
const CN_RELAY =
  "/ip4/47.93.11.212/tcp/4001/p2p/12D3KooWLNR4WYWHBswe8ux5zWsy6cuGywnYPJbdbaAbbpmJMjbo"
const US_RELAY =
  "/ip4/47.251.91.97/tcp/4001/p2p/12D3KooWAWiVSpsCjpjauz83ijLugxwScRJi89N4PA1VQ1Czsncb"
const CLIENT_PROXY = "/envoymesh/client-proxy/0.1.0"

/**
 * A real, isolated home on disk — not the literal `/home/dev/.envoymesh` a fake path used to be.
 *
 * `start()` now loads (or creates and persists) the peer's key, so every test that starts a peer
 * writes `secrets/mesh-identity.json`. A made-up path would either be unwritable or leave stray
 * state behind; a per-run temp directory is neither, and it is the same shape the daemon uses.
 */
let HOME: string
beforeAll(async () => {
  HOME = await mkdtemp(join(tmpdir(), "envoydev-mesh-peer-unit-"))
})
afterAll(async () => {
  await rm(HOME, { recursive: true, force: true })
})

interface FakeNode extends CoderMeshPeerNode {
  stops: number
  captured?: { protocol: string; handler: (stream: unknown, connection: unknown) => Promise<void> }
}

/**
 * The smallest node that satisfies the structural contract — and captures what registration passed.
 *
 * `getRelayAdvertisedMultiaddrs` deliberately returns a circuit address that `multiaddrs` does not,
 * so a status carrying the circuit proves the peer asked for the relay-aware list.
 */
function fakeNode(overrides: Partial<CoderMeshPeerNode> = {}): FakeNode {
  const node: FakeNode = {
    stops: 0,
    start: async () => undefined,
    stop: async () => {
      node.stops += 1
    },
    peerId: "12D3KooWEnvoyDevPeer",
    multiaddrs: ["/ip4/192.168.1.20/tcp/4001/p2p/12D3KooWEnvoyDevPeer"],
    getRelayAdvertisedMultiaddrs: () => [`${CN_RELAY}/p2p-circuit`],
    getConnectedPeerIds: () => ["12D3KooWPairedPhone"],
    handleRawProtocol: async (protocol, handler) => {
      node.captured = { protocol, handler }
    },
    ...overrides,
  }
  return node
}

const SESSIONS: Record<string, { deviceId: string }> = {
  t1: { deviceId: "d1" },
  t2: { deviceId: "d2" },
}

/** The ports the daemon injects in production (`coderSessionIdentity` / `createCoderDispatcher` shapes). */
function proxyPorts() {
  return {
    sessionIdentity: {
      localScopeKey: "product:EnvoyDev",
      resolveSession: async (token: string) =>
        SESSIONS[token]
          ? {
              scopeKey: "product:EnvoyDev",
              ownerId: "envoy:owner:abc",
              isOwnerScope: false,
              deviceId: SESSIONS[token].deviceId,
              caller: undefined,
            }
          : null,
    },
    dispatch: async () => ({ ok: true }),
  }
}

/**
 * One scripted mesh connection: sends its handshake, answers `proxy-accept`, then stays open until
 * `end()` or `close()` releases the pending read. Enough of `FramedDuplex` for the real transport.
 */
function scriptedDuplex(token: string) {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const written: string[] = []
  let closed = false
  let handshakeSent = false
  let release: () => void = () => undefined
  const ended = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    written,
    isClosed: () => closed,
    end: () => release(),
    stream: {},
    duplex: {
      write: (frame: Uint8Array) => {
        written.push(decoder.decode(frame))
      },
      read: async (): Promise<Uint8Array | undefined> => {
        if (!handshakeSent) {
          handshakeSent = true
          return encoder.encode(`${JSON.stringify({ type: "proxy-connect", token })}\n`)
        }
        await ended
        return undefined
      },
      close: () => {
        closed = true
        release()
      },
    },
  }
}

describe("the peer's own identity", () => {
  it("lives in the product's secrets dir, and is never the family profile's key", () => {
    const paths = coderPaths(HOME)
    const identity = meshIdentityPath(paths)
    expect(identity).toBe(join(paths.secretsDir, "mesh-identity.json"))
    expect(identity.startsWith(paths.stateDir)).toBe(true)
    // The family node's key is `<home>/profile/libp2p-private.key`
    // (`../EnvoyMesh/apps/node/src/index.ts:1232`). Two processes with one identity is corruption,
    // and a phone paired with the node's peer id would be pairing with the wrong app.
    expect(identity.startsWith(join(HOME, "profile"))).toBe(false)
    expect(identity).not.toContain("libp2p-private.key")
  })

  it("is the same key on a second start, and the file is written", async () => {
    // The regression this file exists for: `mesh-peer.ts` used to pass `libp2pPrivateKeyPath`, an
    // option the network package declared but never read, so this file was never written and every
    // process start minted a new peer id. This is the ungated half of the proof; the E2E leg
    // (`mesh-peer-e2e.test.ts`) asserts the *peer id* is stable over two real libp2p starts.
    const paths = coderPaths(HOME)
    const handed: EnvoyMeshOptions["libp2pPrivateKey"][] = []
    const startOnce = async () => {
      const peer = createCoderMeshPeer({
        paths,
        ...proxyPorts(),
        createNode: (options) => {
          handed.push(options.libp2pPrivateKey)
          return fakeNode()
        },
      })
      await peer.start()
      await peer.stop()
    }

    await startOnce()
    await startOnce()

    const [first, second] = handed
    expect(first, "the first start handed the node no identity").toBeDefined()
    expect(second, "the second start handed the node no identity").toBeDefined()
    expect((await readFile(meshIdentityPath(paths))).byteLength).toBeGreaterThan(0)
    if (!first || !second) return
    expect(Array.from(privateKeyToProtobuf(second))).toEqual(Array.from(privateKeyToProtobuf(first)))
  })
})

describe("the relay hints", () => {
  it("are the family's shared cn + us community relays, static and complete", () => {
    const options = coderMeshOptions()
    expect(options.configuredRelayAddrs).toEqual([CN_RELAY, US_RELAY])
    // `bootstrapPeers` is deliberately **empty**: it is the DHT/bootstrap path, and the relay
    // connection the circuit reservation rides is already made by `configuredRelayAddrs`. A future
    // edit that refills it from the hints would re-join the public swarm (see the pinning test below).
    expect(options.bootstrapPeers).toEqual([])
    expect(options.enableRelay).toBe(true)
    // No identity argument, no key: an ephemeral node is a caller's explicit choice, never a
    // default. `start()` supplies the persisted key, which the tests above and below assert.
    expect(options.libp2pPrivateKey).toBeUndefined()
    expect(CODER_MESH_RELAY_HINTS).toEqual([CN_RELAY, US_RELAY])
  })

  /**
   * **The pin against re-enabling the swarm.** Measured before this landed: with the family defaults
   * (DHT + mDNS + AutoNAT on, `bootstrapPeers` = the relays) the peer sat at 17 connected peers — two
   * relays plus fifteen unknown members of the public DHT swarm — for +89.3 MB RSS, against 2 peers
   * and +9.0 MB with the options below. The phone was told exactly where this machine is by the QR
   * code, so none of those fifteen were ever dialled by the product. This test fails the moment a
   * later edit turns any of them back on, which is the whole point of writing the number down in
   * `coderMeshOptions`.
   */
  it("keeps the public swarm off and the phone's relay route on", async () => {
    const options = coderMeshOptions()
    // Off — discovery for peers nobody named.
    expect(options.enableDht).toBe(false)
    expect(options.dhtClientMode).toBe(false)
    expect(options.enableMdns).toBe(false)
    expect(options.enableAutoNat).toBe(false)
    expect(options.bootstrapPeers).toEqual([])
    // On — the route a paired phone actually takes.
    expect(options.enableRelay).toBe(true)
    expect(options.enableDcutr).toBe(true)
    expect(options.configuredRelayAddrs).toEqual([CN_RELAY, US_RELAY])

    // The relay circuit is still *advertised*: a phone that scanned the QR is handed the circuit
    // address, so switching the swarm off must not have cost the reachable route. The fake node
    // returns a circuit from `getRelayAdvertisedMultiaddrs` and a bare LAN address from `multiaddrs`;
    // the peer preferring the former is what puts `/p2p-circuit` in the pairing payload.
    const node = fakeNode()
    const peer = createCoderMeshPeer({
      paths: coderPaths(HOME),
      ...proxyPorts(),
      createNode: () => node,
    })
    try {
      await peer.start()
      expect(peer.multiaddrs).toContain(`${CN_RELAY}/p2p-circuit`)
      expect(peer.multiaddrs.some((addr) => addr.includes("/p2p-circuit"))).toBe(true)
      expect(peer.relayHints).toEqual([CN_RELAY, US_RELAY])
    } finally {
      await peer.stop()
    }
  })

  it("reach the node through the injected factory, carrying the persisted key", async () => {
    let seen: EnvoyMeshOptions | undefined
    const node = fakeNode()
    const peer = createCoderMeshPeer({
      paths: coderPaths(HOME),
      ...proxyPorts(),
      createNode: (options) => {
        seen = options
        return node
      },
    })
    try {
      await peer.start()
      expect(seen?.configuredRelayAddrs).toEqual([CN_RELAY, US_RELAY])
      // The honoured option, not the trap that used to sit here: `libp2pPrivateKey` is a value
      // `EnvoyMesh` actually reads (`network/src/index.ts:839,855`), so the peer id is the identity
      // on disk rather than whatever libp2p happened to generate this process.
      expect(seen?.libp2pPrivateKey).toBeDefined()
    } finally {
      await peer.stop()
    }
  })
})

describe("starting the peer", () => {
  it("reports hosting with the real peer id, the dialable addresses and the relay hints", async () => {
    const node = fakeNode()
    const peer = createCoderMeshPeer({
      paths: coderPaths(HOME),
      ...proxyPorts(),
      createNode: () => node,
    })
    try {
      const status = await peer.start()
      expect(status).toEqual({
        kind: "hosting",
        peerId: "12D3KooWEnvoyDevPeer",
        // The relay-aware list, not the bare LAN address: this is what a phone can dial from anywhere.
        multiaddrs: [`${CN_RELAY}/p2p-circuit`],
        relayHints: [CN_RELAY, US_RELAY],
        peerCount: 1,
      })
      expect(node.captured?.protocol).toBe(CLIENT_PROXY)
      expect(peer.status()).toEqual(status)
      expect(peer.peerId).toBe("12D3KooWEnvoyDevPeer")
      expect(peer.multiaddrs).toEqual([`${CN_RELAY}/p2p-circuit`])
      expect(peer.relayHints).toEqual([CN_RELAY, US_RELAY])
    } finally {
      await peer.stop()
    }
  })

  it("refuses, never claims hosting, when the node itself will not start", async () => {
    const node = fakeNode({
      start: async () => {
        throw new Error("listen EADDRINUSE")
      },
    })
    const peer = createCoderMeshPeer({
      paths: coderPaths(HOME),
      ...proxyPorts(),
      createNode: () => node,
    })
    const status = await peer.start()
    expect(status.kind).toBe("refused")
    if (status.kind !== "refused") return
    expect(status.code).toBe("mesh-start-failed")
    expect(status.reason).toContain("EADDRINUSE")
    expect(peer.peerId).toBeUndefined()
    expect(node.stops).toBe(1)
  })

  it("refuses when the peer starts but has no peer id to put in a pairing code", async () => {
    const node = fakeNode({ peerId: "" })
    const peer = createCoderMeshPeer({
      paths: coderPaths(HOME),
      ...proxyPorts(),
      createNode: () => node,
    })
    const status = await peer.start()
    expect(status.kind).toBe("refused")
    if (status.kind !== "refused") return
    expect(status.code).toBe("mesh-unusable")
    expect(node.stops).toBe(1)
  })

  it("refuses when the client-proxy protocol cannot be registered, and tears the node down", async () => {
    const node = fakeNode({
      handleRawProtocol: async () => {
        throw new Error("protocol already registered")
      },
    })
    const peer = createCoderMeshPeer({
      paths: coderPaths(HOME),
      ...proxyPorts(),
      createNode: () => node,
    })
    const status = await peer.start()
    expect(status.kind).toBe("refused")
    if (status.kind !== "refused") return
    // The peer is listening, but nobody can call `coder.*` on it — a capability claim the protocol
    // does not provide, so `hosting` would be a lie and the half-open node is not kept.
    expect(status.code).toBe("mesh-protocol-failed")
    expect(status.reason).toContain(CLIENT_PROXY)
    expect(peer.peerId).toBeUndefined()
    expect(node.stops).toBe(1)
  })
})

describe("stopping the peer", () => {
  it("is safe twice, and safe when no start ever succeeded", async () => {
    const peer = createCoderMeshPeer({
      paths: coderPaths(HOME),
      ...proxyPorts(),
      createNode: () => fakeNode(),
    })
    await expect(peer.stop()).resolves.toBeUndefined()
    await expect(peer.stop()).resolves.toBeUndefined()
    expect(peer.status().kind).toBe("no-node")
  })

  it("is safe twice after a successful start, and stops the node exactly once", async () => {
    const node = fakeNode()
    const peer = createCoderMeshPeer({
      paths: coderPaths(HOME),
      ...proxyPorts(),
      createNode: () => node,
    })
    await peer.start()
    await peer.stop()
    await peer.stop()
    expect(node.stops).toBe(1)
    expect(peer.status().kind).toBe("no-node")
    expect(peer.peerId).toBeUndefined()
  })

  it("does not reject when the node's own stop throws, and says it may still be listening", async () => {
    const node = fakeNode({
      stop: async () => {
        throw new Error("transport busy")
      },
    })
    const peer = createCoderMeshPeer({
      paths: coderPaths(HOME),
      ...proxyPorts(),
      createNode: () => node,
    })
    await peer.start()
    await expect(peer.stop()).resolves.toBeUndefined()
    const status = peer.status()
    expect(status.kind).toBe("refused")
    if (status.kind !== "refused") return
    expect(status.code).toBe("mesh-stop-failed")
  })
})

describe("the coder.* surface over the mesh", () => {
  it("registers the client-proxy protocol and builds fresh options per connection", async () => {
    const a = scriptedDuplex("t1")
    const b = scriptedDuplex("t2")
    const node = fakeNode()
    const peer = createCoderMeshPeer({
      paths: coderPaths(HOME),
      ...proxyPorts(),
      createNode: () => node,
      // The production default is `meshStreamAsDuplex`, which needs a real libp2p stream. The seam
      // lets this test drive the *registered* handler with the scripted duplexes instead.
      toDuplex: (stream) => (stream === a.stream ? a.duplex : b.duplex),
    })
    try {
      await peer.start()
      expect(node.captured?.protocol).toBe(CLIENT_PROXY)

      const handler = node.captured?.handler
      expect(handler).toBeTypeOf("function")
      if (!handler) return

      const runA = handler(a.stream, {})
      const runB = handler(b.stream, {})
      await vi.waitFor(() => {
        expect(a.written.join("")).toContain("proxy-accept")
        expect(b.written.join("")).toContain("proxy-accept")
      })

      // Connection A leaves first. Its cleanup must release only A's registration…
      a.end()
      await runA

      // …so `d2` still names B. With one shared options object — the leak the per-connection factory
      // exists to prevent — A's unsubscribe would have run B's unregister and this would be 0.
      expect(peer.closeStreamsForDevice("d2")).toBe(1)
      expect(b.isClosed()).toBe(true)
      expect(peer.closeStreamsForDevice("d1")).toBe(0)
      expect(peer.closeStreamsForDevice("d2")).toBe(0)

      await runB
    } finally {
      await peer.stop()
    }
  })
})
