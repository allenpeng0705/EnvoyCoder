/**
 * **The daemon as its own libp2p peer, proven by a second peer dialing it.**
 *
 * ## Why this is a gated E2E test and not another unit test
 *
 * `mesh-peer.test.ts` starts the peer with an injected fake node: it proves the options we derive,
 * the status we map and the handler we register — and it proves none of them over a wire. A green
 * unit suite in this repo has already shipped a broken import path (`AGENTS.md`), so "the units
 * pass" is not evidence for the claim that matters here:
 *
 * > a paired phone reaches this daemon's `coder.*` surface directly over libp2p, with no EnvoyMesh
 * > node process on the machine.
 *
 * The only way to test that is to start the real `CoderMeshPeer`, stand up a second independent
 * libp2p peer, dial `CLIENT_PROXY_PROTOCOL`, authenticate with a session token and assert the
 * answer that comes back. A dial that opens and answers nothing does not prove the phone can use
 * it, so the request/response is asserted — not just the connection.
 *
 * ## What is running — and what is not
 *
 * Two libp2p nodes, both constructed **inside this vitest process**:
 *
 *   * the daemon's own peer — `createCoderMeshPeer` with its default node factory, i.e. a real
 *     `EnvoyMesh` from `@envoymesh/network`;
 *   * an independent second `EnvoyMesh` that plays the phone.
 *
 * There is **no `@envoymesh/node` process**, no `envoy-node` binary, no `apps/node` entrypoint and
 * no EnvoyMesh app of any kind in the tree: `assertNoEnvoyMeshNodeInProcessTree()` greps this
 * test's own process ancestry *and* descendancy for the node app and fails if one appears. That is
 * the narrow, checkable claim — the broader "the user has no EnvoyMesh anywhere" is not something
 * one process can assert about a machine, so this test does not.
 *
 * The home node is narrowed to loopback with the community relay hints cleared: this leg proves the
 * direct dial, and dialing the family's shared relays would make an offline machine fail for a
 * reason that is not the thing under test. `coderMeshOptions(identity)` is still the base the real
 * node is built from, so the options the product derives stay in the path.
 *
 * ## The relay leg, proven without the internet
 *
 * The second `describeWhen` below runs a **local circuit relay** in this same process
 * (`EnvoyMesh` with `enableRelayServer: true` on loopback), points the peer's
 * `configuredRelayAddrs` at it, and dials the peer's `<relay>/p2p-circuit/p2p/<peerId>` address
 * with a third node that has the relay transport enabled. No community relay, no internet. The
 * circuit round-trip completes, which is the leg a phone on a different network depends on.
 *
 * Two things were learned while making it work, and both are why the test is shaped this way:
 * the dialer must have the circuit-relay transport registered (`enableRelay: true`) or libp2p
 * answers `The dial request has no valid addresses for peer` for a `/p2p-circuit` address; and the
 * peer reserves its slot from the configured circuit listen address alone — no explicit
 * `requestRelayReservation` call is needed, which matters because `CoderMeshPeer` exposes no such
 * method.
 *
 * ## Gated
 *
 * Real libp2p costs a second or two and touches sockets, so this leg needs `RUN_E2E=1` and is
 * skipped in the ordinary suite (the same gate `apps/desktop/test/settings-row-anatomy.e2e.test.ts`
 * uses). Run it with:
 *
 * ```
 * RUN_E2E=1 npx vitest run packages/host-bridge/test/mesh-peer-e2e.test.ts
 * ```
 */

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CLIENT_PROXY_PROTOCOL,
  EnvoyMesh,
  meshStreamAsDuplex,
  type EnvoyMeshOptions,
} from "@envoymesh/network"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  coderPaths,
  coderSessionIdentity,
  createCoderDispatcher,
  createCoderMeshPeer,
  meshIdentityPath,
  type CoderMeshPeer,
  type CoderPaths,
} from "../src/index.js"

const enabled = process.env.RUN_E2E === "1"
if (!enabled) {
  console.log(
    "· mesh-peer-e2e: not run — set RUN_E2E=1 to dial a real libp2p peer. " +
      "The direct-dial claim is unverified by this run.",
  )
}
const describeWhen = enabled ? describe : describe.skip

/** The token a paired phone would present; anything else must be refused. */
const VALID_TOKEN = "paired-phone-token-under-test"
const DEVICE_ID = "phone-under-test"
/** A distinctive payload, so a response that happens to be `{}` cannot pass as the answer. */
const PROBE = "hello-from-the-second-peer"

/* ────────────────────────────── the client's half of the wire ────────────────────────────── */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * The client side of the family's framing: **newline-delimited UTF-8 JSON**.
 *
 * The server's half is `@envoymesh/host-connect`'s `splitFrames`. This reader buffers chunks and
 * splits on `\n` itself rather than assuming one read is one frame — the assumption the family
 * removed on purpose, and a client that puts it back tests a coincidence instead of the contract.
 */
function frameClient(duplex: ReturnType<typeof meshStreamAsDuplex>) {
  let buffer = ""
  return {
    async send(payload: unknown): Promise<void> {
      await duplex.write(encoder.encode(`${JSON.stringify(payload)}\n`))
    },
    async next(): Promise<Record<string, unknown>> {
      for (;;) {
        const newline = buffer.indexOf("\n")
        if (newline >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (line.trim() === "") continue
          return JSON.parse(line) as Record<string, unknown>
        }
        const chunk = await duplex.read()
        if (chunk === undefined) {
          throw new Error("the mesh stream ended before a whole frame arrived")
        }
        buffer += decoder.decode(chunk)
      }
    },
    close: () => duplex.close(),
  }
}

/* ────────────────────────────── the daemon's own ports ────────────────────────────── */

/**
 * The two ports the daemon injects in production, built from the *same* exported functions
 * (`apps/desktop/src/daemon/serve.ts:341-344`): `coderSessionIdentity` for "who is calling" and
 * `createCoderDispatcher` for "what may be called". Only the token table and the one handler body
 * are test data — the authentication gate and the method catalogue are the product's own.
 */
function coderPorts(record?: { method: string; session: unknown }[]) {
  return {
    sessionIdentity: coderSessionIdentity({
      resolveSession: async (token: string) =>
        token === VALID_TOKEN
          ? {
              scopeKey: "product:EnvoyDev",
              ownerId: "envoy:owner:under-test",
              isOwnerScope: false,
              deviceId: DEVICE_ID,
              caller: undefined,
            }
          : null,
    }),
    dispatch: createCoderDispatcher({
      handlers: {
        "coder.meshStatus": async (params, { session }) => {
          record?.push({ method: "coder.meshStatus", session });
          return {
            kind: "hosting",
            answeredBy: "coder-mesh-peer",
            echo: params,
            deviceId: (session as { deviceId?: string } | undefined)?.deviceId ?? null,
          };
        },
      },
    }),
  }
}

/**
 * A real `EnvoyMesh`, narrowed to loopback.
 *
 * `createNode` is injected only to change the *reach*: the default `coderMeshOptions(identity)`
 * still carries the family's community relays (it no longer enables DHT, mDNS or AutoNAT — see
 * `mesh-peer.ts`), and dialing the public relays would make this leg depend on the internet. The
 * node is still a real `EnvoyMesh`, the protocol handler is still the one `createCoderMeshPeer`
 * registers, and the dial is still a real libp2p dial.
 */
function loopbackNode(options: EnvoyMeshOptions): EnvoyMesh {
  const nodeOptions: EnvoyMeshOptions = {
    ...options,
    listen: ["/ip4/127.0.0.1/tcp/0"],
    enableMdns: false,
    enableDht: false,
    bootstrapPeers: [],
    configuredRelayAddrs: [],
    enableRelay: false,
    enableAutoNat: false,
    enableDcutr: false,
  }
  return new EnvoyMesh(nodeOptions)
}

/* ────────────────────────────── "no EnvoyMesh process" is a checked claim ────────────────────────────── */

interface ProcessRow {
  pid: number
  ppid: number
  command: string
}

function processTable(): ProcessRow[] {
  // `-ww` prints the full command line; without it `ps` truncates and the grep would be blind.
  const output = execFileSync("ps", ["-ax", "-ww", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
  const rows: ProcessRow[] = []
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (match?.[1] && match[2] && match[3] !== undefined) {
      rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] })
    }
  }
  return rows
}

/**
 * Fail if the EnvoyMesh node app is anywhere in **this test's** process tree.
 *
 * Both directions, because either one would falsify the claim: an ancestor that launched the node
 * app, or a descendant this test spawned. The pattern is the app's own entrypoint path
 * (`../EnvoyMesh/apps/node`), never the library this test imports — importing `@envoymesh/network`
 * makes this process link the family's *code*, which is exactly what "the daemon reuses the
 * family's network library" means, and is not a node process.
 */
function assertNoEnvoyMeshNodeInProcessTree(): void {
  const rows = processTable()
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const inTree = new Set<number>([process.pid])

  for (let current = byPid.get(process.pid); current && current.ppid !== 0; current = byPid.get(current.ppid)) {
    if (inTree.has(current.ppid)) break
    inTree.add(current.ppid)
  }
  for (let grew = true; grew; ) {
    grew = false
    for (const row of rows) {
      if (inTree.has(row.ppid) && !inTree.has(row.pid)) {
        inTree.add(row.pid)
        grew = true
      }
    }
  }

  const tree = rows.filter((row) => inTree.has(row.pid))
  const offenders = tree.filter((row) => /EnvoyMesh\/apps\/node/.test(row.command))
  const summary = tree.map((row) => `  ${row.pid} ${row.command}`).join("\n")
  expect(
    offenders.map((row) => row.command),
    `an EnvoyMesh node app is in this test's process tree, so the "no EnvoyMesh running" claim ` +
      `would be false:\n${summary}`,
  ).toEqual([])
}

/* ────────────────────────────── teardown, proven rather than promised ────────────────────────────── */

/** The loopback port an advertised multiaddr names, so the socket can be probed after stop. */
function loopbackPort(multiaddr: string): number {
  const match = /\/ip4\/127\.0\.0\.1\/tcp\/(\d+)/.exec(multiaddr)
  if (!match?.[1]) throw new Error(`no loopback TCP port in ${multiaddr}`)
  return Number(match[1])
}

/** `refused` is the honest result: a listening socket that is gone refuses a connection. */
function probePort(port: number): Promise<"open" | "refused" | "timeout"> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port })
    socket.setTimeout(1_000)
    socket.once("connect", () => {
      socket.destroy()
      resolve("open")
    })
    socket.once("error", () => {
      socket.destroy()
      resolve("refused")
    })
    socket.once("timeout", () => {
      socket.destroy()
      resolve("timeout")
    })
  })
}

/* ────────────────────────────── the test ────────────────────────────── */

describeWhen("the daemon's own mesh peer, dialled by a second real libp2p peer", () => {
  let home: string
  let paths: CoderPaths
  let peer: CoderMeshPeer
  let second: EnvoyMesh | undefined
  /** Every dispatch that landed, so a refused connection can be proven to have reached nothing. */
  let calls: { method: string; session: unknown }[]

  beforeAll(async () => {
    // The isolated home: never the user's real one. `coderPaths` is the product's own resolver, so
    // this is the same shape the daemon uses, pointed at a temp directory.
    home = await mkdtemp(join(tmpdir(), "envoydev-mesh-peer-e2e-"))
    paths = coderPaths(home)
    await mkdir(paths.secretsDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(home, { recursive: true, force: true })
  })

  beforeEach(async () => {
    calls = []
    peer = createCoderMeshPeer({ paths, ...coderPorts(calls), createNode: loopbackNode })
    const status = await peer.start()
    expect(status.kind, JSON.stringify(status)).toBe("hosting")
  })

  afterEach(async () => {
    await peer.stop()
    await second?.stop().catch(() => undefined)
    second = undefined
  })

  function hostingStatus() {
    const status = peer.status()
    expect(status.kind, JSON.stringify(status)).toBe("hosting")
    if (status.kind !== "hosting") throw new Error("the peer did not report hosting")
    return status
  }

  async function dialHome() {
    const status = hostingStatus()
    // A dialable address, and it is the peer's own identity on the other end: a multiaddr without
    // the peer id is an address a phone could reach but not authenticate.
    const address = status.multiaddrs.find((addr) => addr.includes("/ip4/127.0.0.1/tcp/"))
    expect(status.multiaddrs.length).toBeGreaterThanOrEqual(1)
    expect(status.multiaddrs.some((addr) => addr.includes(`/p2p/${status.peerId}`))).toBe(true)
    expect(address, `no dialable loopback multiaddr in ${JSON.stringify(status.multiaddrs)}`).toBeDefined()

    second = new EnvoyMesh({ listen: ["/ip4/127.0.0.1/tcp/0"], enableMdns: false })
    await second.start()
    const stream = await second.dialProtocol(address as string, CLIENT_PROXY_PROTOCOL)
    return { status, address: address as string, client: frameClient(meshStreamAsDuplex(stream)) }
  }

  it("reports hosting with a real peer id, and answers an authenticated coder.* call", async () => {
    const before = hostingStatus()

    // 1. A real libp2p identity, not a string this test put there.
    expect(before.peerId).toMatch(/^12D3KooW[A-Za-z0-9]+$/)
    // The family's shared relays are still what a pairing payload would carry.
    expect(before.relayHints.length).toBeGreaterThan(0)

    const { address, client } = await dialHome()
    const port = loopbackPort(address)

    // 2. The handshake a paired phone performs, with the token the resolver knows.
    await client.send({ type: "proxy-connect", token: VALID_TOKEN })
    expect(await client.next()).toEqual({ type: "proxy-accept" })

    // 3. A real request, and the payload the host actually answered with.
    await client.send({ id: "e2e-1", method: "coder.meshStatus", params: { probe: PROBE } })
    expect(await client.next()).toEqual({
      id: "e2e-1",
      result: {
        kind: "hosting",
        answeredBy: "coder-mesh-peer",
        echo: { probe: PROBE },
        deviceId: DEVICE_ID,
      },
    })

    // The host counts the peer it is talking to: the connection is real, not a local shortcut.
    expect(hostingStatus().peerCount).toBe(1)

    // 4. What is running, checked rather than asserted in prose.
    assertNoEnvoyMeshNodeInProcessTree()

    await client.close()

    // 5. Deterministic teardown: the peer stops, and the socket it was listening on is gone.
    await peer.stop()
    expect(peer.status().kind).toBe("no-node")
    await second?.stop()
    second = undefined
    expect(await probePort(port)).toBe("refused")
  })

  it("refuses a request whose token is not a paired session", async () => {
    const { client } = await dialHome()

    await client.send({ type: "proxy-connect", token: "not-a-paired-token" })
    const reply = await client.next()
    // Refused at the handshake, before any coder.* method can run — the reason the transport gives
    // is deliberately identical for wrong, expired and revoked tokens.
    expect(reply.type).toBe("proxy-reject")
    expect(String(reply.reason)).toMatch(/invalid|expired/)
    // The property the sample above only implies: the request that follows a refused handshake
    // reaches nothing. `calls` is the real dispatcher's own record.
    expect(calls).toEqual([])

    await client.close()
  })

  it("refuses a request sent with no handshake at all, and never dispatches it", async () => {
    const { client } = await dialHome()

    // The shape an unauthenticated peer on the shared network would send: a plain JSON-RPC request
    // as the first frame. The transport reads the first frame as the handshake, finds no token, and
    // closes — so `coder.meshStatus` is never dispatched, on this connection or any later frame.
    await client.send({ id: "atk-direct", method: "coder.meshStatus", params: { probe: PROBE } })
    const reply = await client.next()
    expect(reply.type).toBe("proxy-reject")
    expect(String(reply.reason)).toBe("no token")
    expect(calls).toEqual([])

    // The stream is closed rather than left waiting for a better-shaped frame.
    await expect(client.next()).rejects.toThrow(/ended before a whole frame/)
  })

  it("refuses a bad token followed by a well-formed request, and dispatches nothing", async () => {
    const { client } = await dialHome()

    await client.send({ type: "proxy-connect", token: "wrong" })
    // Sent immediately after, before reading the rejection: a gate that answered per *frame* rather
    // than per *connection* would dispatch this one behind the refusal.
    await client.send({ id: "atk-second", method: "coder.meshStatus", params: { probe: PROBE } })

    expect((await client.next()).type).toBe("proxy-reject")
    await expect(client.next()).rejects.toThrow(/ended before a whole frame/)
    expect(calls).toEqual([])
  })

  /**
   * The one shape that makes the transport throw rather than answer, over a real dial.
   *
   * `JSON.parse("null")` succeeds, so the handshake parser reaches `parsed.type` on `null` and throws
   * a `TypeError` before writing `proxy-reject` (`../EnvoyMesh/packages/host-connect/src/
   * mesh-host-transport.ts:124`). The transport's own doc says it "never throws for a peer's
   * misbehaviour", so the interesting question is not the throw but its blast radius: does one peer's
   * malformed frame take the daemon's mesh surface down? libp2p catches a rejected stream handler and
   * aborts that stream (`node_modules/libp2p/dist/src/connection.js:190-192`), so the measured answer
   * is no — asserted here rather than inferred, and reported as a doc/robustness defect.
   */
  it("survives a `null` handshake that makes the transport throw, and still serves a paired phone", async () => {
    const { address } = await dialHome()
    // A second stream on the same peer node, so `afterEach` still owns exactly one node to stop.
    const attacker = frameClient(meshStreamAsDuplex(await second!.dialProtocol(address, CLIENT_PROXY_PROTOCOL)))
    await attacker.send(null)
    // Measured: libp2p aborts the stream, so the peer sees a reset — not a `proxy-reject`, and not an
    // open stream waiting for a better frame. That is the containment this test exists to check.
    await expect(attacker.next()).rejects.toThrow(/stream has been reset/)
    expect(calls).toEqual([])
    expect(hostingStatus().kind).toBe("hosting")

    // An independent stream is unaffected: the node is still serving the protocol.
    const client = frameClient(meshStreamAsDuplex(await second!.dialProtocol(address, CLIENT_PROXY_PROTOCOL)))
    await client.send({ type: "proxy-connect", token: VALID_TOKEN })
    expect(await client.next()).toEqual({ type: "proxy-accept" })
    await client.send({ id: "after-null", method: "coder.meshStatus", params: { probe: PROBE } })
    expect(await client.next()).toEqual({
      id: "after-null",
      result: {
        kind: "hosting",
        answeredBy: "coder-mesh-peer",
        echo: { probe: PROBE },
        deviceId: DEVICE_ID,
      },
    })
    // Exactly one dispatch happened, and it was the authenticated one.
    expect(calls.map((call) => call.method)).toEqual(["coder.meshStatus"])
    // The dispatcher was handed the resolved session, never `undefined` — the fact
    // `requireOwnerWindow`'s `session === undefined` rule depends on.
    expect(calls[0]?.session).toMatchObject({ deviceId: DEVICE_ID, isOwnerScope: false })

    await client.close()
  })
})

/* ────────────────────────────── the relay leg, with a local relay ────────────────────────────── */

describeWhen("the daemon's peer reached through a relay when there is no direct route", () => {
  let home: string
  let paths: CoderPaths
  let relay: EnvoyMesh
  let peer: CoderMeshPeer
  let dialer: EnvoyMesh | undefined

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "envoydev-mesh-relay-e2e-"))
    paths = coderPaths(home)
    await mkdir(paths.secretsDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(home, { recursive: true, force: true })
  })

  afterEach(async () => {
    await peer?.stop()
    await dialer?.stop().catch(() => undefined)
    dialer = undefined
    await relay?.stop().catch(() => undefined)
  })

  /**
   * The local relay, and a peer that reserves a circuit on it.
   *
   * `configuredRelayAddrs` is what makes the peer listen on `<relay>/p2p-circuit` and reserve a
   * slot, and `enableRelay: true` is what gives a node the circuit-relay transport at all. The
   * second peer below needs that transport to dial a circuit address; without it libp2p reports
   * "no valid addresses for peer" for the target, which is the failure this leg was built through.
   */
  it(
    "dials the peer's /p2p-circuit address and exchanges the same authenticated call",
    async () => {
      relay = new EnvoyMesh({
        listen: ["/ip4/127.0.0.1/tcp/0"],
        enableMdns: false,
        enableRelayServer: true,
      })
      await relay.start()
      const relayAddress = relay.multiaddrs.find((addr) => addr.includes("/ip4/127.0.0.1/tcp/"))
      expect(relayAddress, "the local relay exposed no loopback address").toBeDefined()
      const relayPort = loopbackPort(relayAddress as string)

      peer = createCoderMeshPeer({
        paths,
        ...coderPorts(),
        createNode: (options) =>
          new EnvoyMesh({
            ...options,
            listen: ["/ip4/127.0.0.1/tcp/0"],
            enableMdns: false,
            enableDht: false,
            bootstrapPeers: [],
            configuredRelayAddrs: [relayAddress as string],
            enableRelay: true,
            enableAutoNat: false,
            enableDcutr: false,
          }),
      })
      const status = await peer.start()
      expect(status.kind, JSON.stringify(status)).toBe("hosting")
      if (status.kind !== "hosting") throw new Error("the peer did not report hosting")

      // The peer genuinely dialled the relay — that connection is what a reservation is granted on.
      await vi.waitFor(
        () => expect(relay.getConnectedPeerIds()).toContain(status.peerId),
        { timeout: 15_000, interval: 250 },
      )

      // The canonical circuit address a phone builds from the pairing payload: the relay base
      // followed by `/p2p-circuit/p2p/<the daemon's peer id>`.
      const circuitAddress = `${relayAddress as string}/p2p-circuit/p2p/${status.peerId}`

      dialer = new EnvoyMesh({
        listen: ["/ip4/127.0.0.1/tcp/0"],
        enableMdns: false,
        enableRelay: true,
        configuredRelayAddrs: [relayAddress as string],
        enableDht: false,
      })
      await dialer.start()
      // Nothing has told this node where the peer lives directly, so the circuit is the only route
      // it can take — which is the situation the phone is in on another network.
      expect(dialer.getConnectedPeerIds()).not.toContain(status.peerId)

      // The reservation lands asynchronously after the relay connection; retry the dial rather than
      // pretending a fixed sleep is deterministic.
      let stream: Awaited<ReturnType<EnvoyMesh["dialProtocol"]>> | undefined
      await vi.waitFor(
        async () => {
          stream = await dialer!.dialProtocol(circuitAddress, CLIENT_PROXY_PROTOCOL)
        },
        { timeout: 20_000, interval: 500 },
      )
      expect(stream, "the circuit dial never succeeded").toBeDefined()

      const client = frameClient(meshStreamAsDuplex(stream as never))
      await client.send({ type: "proxy-connect", token: VALID_TOKEN })
      expect(await client.next()).toEqual({ type: "proxy-accept" })

      await client.send({
        id: "e2e-relay-1",
        method: "coder.meshStatus",
        params: { probe: PROBE, route: "relay" },
      })
      expect(await client.next()).toEqual({
        id: "e2e-relay-1",
        result: {
          kind: "hosting",
          answeredBy: "coder-mesh-peer",
          echo: { probe: PROBE, route: "relay" },
          deviceId: DEVICE_ID,
        },
      })

      // The connection exists only now, and only via the circuit.
      expect(dialer.getConnectedPeerIds()).toContain(status.peerId)
      await client.close()

      // Deterministic teardown, including the relay's listening socket.
      await peer.stop()
      expect(peer.status().kind).toBe("no-node")
      await dialer.stop()
      dialer = undefined
      await relay.stop()
      expect(await probePort(relayPort)).toBe("refused")
    },
    60_000,
  )
})

/* ────────────────────────── the identity survives a restart ────────────────────────── */

/**
 * The bug this leg exists for, proven over a real libp2p identity rather than a key object.
 *
 * `mesh-peer.ts` used to pass `libp2pPrivateKeyPath`, an option the network package declared but
 * never read (`../EnvoyMesh/packages/network/src/index.ts`), so EnvoyDev wrote no key file and
 * libp2p minted a fresh Ed25519 identity on every process start. The peer id in a pairing code then
 * became a stale address the phone could not dial — an outage that looks like a flaky network, not
 * a stale identity.
 *
 * The two legs above could not catch it: each starts a fresh peer against a fresh temp home, which
 * an ephemeral id satisfies. Here the **same** paths are started twice and the real peer ids are
 * compared. The negatives are what make the positive meaningful — a hardcoded or ephemeral id would
 * only pass "same on restart" if two different homes and a deleted key file *also* produced the
 * same id, which is asserted below.
 */
describeWhen("the daemon's identity is persisted, not ephemeral", () => {
  const homes: string[] = []

  afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
  })

  async function tempHome(): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), "envoydev-mesh-identity-e2e-"))
    homes.push(home)
    return home
  }

  /** One process's lifetime: start a real peer on `paths`, read its peer id, stop it. */
  async function startAndReadPeerId(paths: CoderPaths): Promise<string> {
    const peer = createCoderMeshPeer({ paths, ...coderPorts(), createNode: loopbackNode })
    try {
      const status = await peer.start()
      expect(status.kind, JSON.stringify(status)).toBe("hosting")
      if (status.kind !== "hosting") throw new Error("the peer did not report hosting")
      return status.peerId
    } finally {
      await peer.stop()
    }
  }

  it("writes the key file, and a second start on the same home is the same peer id", async () => {
    const paths = coderPaths(await tempHome())

    const first = await startAndReadPeerId(paths)
    expect(existsSync(meshIdentityPath(paths)), "the key file was never written").toBe(true)

    const second = await startAndReadPeerId(paths)
    expect(second).toBe(first)
  }, 60_000)

  it("gives a different peer id for a different home", async () => {
    const first = await startAndReadPeerId(coderPaths(await tempHome()))
    const second = await startAndReadPeerId(coderPaths(await tempHome()))
    expect(second).not.toBe(first)
  }, 60_000)

  it("gives a different peer id when the key file is removed between starts", async () => {
    const paths = coderPaths(await tempHome())

    const first = await startAndReadPeerId(paths)
    await rm(meshIdentityPath(paths))

    const second = await startAndReadPeerId(paths)
    expect(second).not.toBe(first)
  }, 60_000)
})
