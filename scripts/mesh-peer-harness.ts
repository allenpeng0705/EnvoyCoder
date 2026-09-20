/**
 * The desktop's mesh peer, as a **process**, for the cross-language relay proof.
 *
 * ## Why a process and not a vitest
 *
 * `packages/host-bridge/test/mesh-peer-e2e.test.ts` proves a *TypeScript* second peer can reach this
 * daemon's `coder.*` surface, including through a relay. The claim this harness exists for is
 * different: the **Dart** phone (`apps/mobile`, wrapping the family's `Libp2pNode`) reaching this
 * TypeScript peer over a `/p2p-circuit/` path. That needs both languages in one experiment, and a
 * Dart test cannot import TypeScript — so the TypeScript half runs as a child process that prints
 * one machine-readable line and then serves.
 *
 * ## What it actually starts
 *
 * The real `createCoderMeshPeer` with its **default node factory** — i.e. a real `EnvoyMesh` built
 * from `coderMeshOptions(identity)`, which means `configuredRelayAddrs` is the family's shipped
 * community relay list (cn + us, `@envoymesh/api/core`). Nothing about the reach is narrowed: this is
 * the peer the desktop daemon runs, reserving a circuit on public shared infrastructure. That is the
 * route a real user depends on when a direct connection is impossible.
 *
 * The node is captured through `createNode` only so the harness can *report* what the peer sees
 * (`getConnectedRelayPeerIds`, the reservation state) — the options still come from
 * `coderMeshOptions`, unmodified, and the object is still `new EnvoyMesh(...)`.
 *
 * ## The contract with the caller
 *
 *   * **stdout** — ordinary product/libp2p chatter, plus exactly one line
 *     `@@ENVOYDEV_MESH_HARNESS@@{json}`. The prefix keeps the parse honest even though the network
 *     package logs to stdout.
 *   * **stderr** — progress, so a hung run says *where* it hung.
 *   * The JSON carries `peerId`, `circuitAddrs` (the `/p2p-circuit/` addresses to dial), `relayHints`
 *     and the session `token` the paired phone would present. `ok:false` with `reason` when no
 *     reservation ever landed — the caller must fail on that rather than dial nothing.
 *
 * It then keeps serving until SIGTERM/SIGINT (peer stopped first) or stdin EOF.
 *
 * Usage (normally spawned by `apps/mobile/test/libp2p_relay_e2e_test.dart`):
 *
 * ```
 * ENVOYDEV_HARNESS_HOME=/tmp/whatever npx tsx scripts/mesh-peer-harness.ts
 * ```
 */

import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"

import { EnvoyMesh, type EnvoyMeshOptions } from "@envoymesh/network"
import {
  coderPaths,
  coderSessionIdentity,
  createCoderDispatcher,
  createCoderMeshPeer,
  type CoderMeshPeer,
} from "@envoydev/host-bridge"

/** The one line a parent process parses. */
const SENTINEL = "@@ENVOYDEV_MESH_HARNESS@@"

/** A token no real pairing minted: the harness is the authority on it, exactly like the daemon. */
const TOKEN = process.env.ENVOYDEV_HARNESS_TOKEN ?? "envoydev-cross-language-relay-token"
const DEVICE_ID = "dart-phone-under-test"
const PROBE = "hello-from-the-dart-phone"

const HOME =
  process.env.ENVOYDEV_HARNESS_HOME ?? join(tmpdir(), `envoydev-mesh-harness-${process.pid}`)
const WAIT_MS = Number(process.env.ENVOYDEV_HARNESS_WAIT_MS ?? 150_000)

/** An optional override for focused experiments; unset means "the product's own options". */
const RELAY_OVERRIDE = process.env.ENVOYDEV_HARNESS_RELAYS?.trim()

function log(message: string): void {
  process.stderr.write(`[mesh-harness] ${message}\n`)
}

function emit(payload: Record<string, unknown>): void {
  process.stdout.write(`${SENTINEL}${JSON.stringify(payload)}\n`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const paths = coderPaths(HOME)
  await mkdir(paths.secretsDir, { recursive: true })

  // The node the product builds, captured so the harness can *observe* it. The options are the ones
  // `createCoderMeshPeer` derived (default `coderMeshOptions(identity)`); an override here is only
  // for experiments and is never the path the caller's green run uses.
  let node: EnvoyMesh | undefined
  const relays =
    RELAY_OVERRIDE === undefined
      ? undefined
      : RELAY_OVERRIDE === ""
        ? []
        : RELAY_OVERRIDE.split(",").map((entry) => entry.trim()).filter(Boolean)

  const peer: CoderMeshPeer = createCoderMeshPeer({
    paths,
    sessionIdentity: coderSessionIdentity({
      resolveSession: async (token: string) =>
        token === TOKEN
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
        // The product's own method name and answer shape (`apps/desktop/src/daemon/service.ts:751`
        // returns `{ mesh: deps.mesh() }`), so a green answer is a real `coder.*` answer and not a
        // test-only echo. `connections` is the harness's extra evidence: what this peer sees of the
        // *caller*, read at the moment the call is being served.
        "coder.meshStatus": async () => ({
          mesh: peer.status(),
          connections: {
            connectedPeerIds: node?.getConnectedPeerIds() ?? [],
            circuitPeerIds: node?.getConnectedRelayPeerIds() ?? [],
          },
        }),
        // The handshake a real phone sends first. Answered so the client reaches `coder.subscribe`
        // and the run exercises the walk *and* the session the way the app does; a refusal here
        // would be swallowed by `HostClient._announceOnline` and make a partial run look complete.
        "coder.hello": async () => ({
          product: "EnvoyDev",
          version: "harness",
          instanceId: "mesh-peer-harness",
          home: HOME,
          stateDir: paths.stateDir,
          startedAt: new Date().toISOString(),
          windowCount: 1,
          methods: [],
          mesh: peer.status(),
          notes: [],
        }),
        // The project list an off-LAN phone actually opens on. Not read from a store: this harness
        // has none, and the claim under test is that the *client's own walk* carries a real
        // `coder.listProjects` over whichever rung won — not that a particular directory exists.
        // The shape is `ProjectSchema` (`packages/protocol/src/rpc.ts:347`), minus the optional
        // fields, so the phone's decoder sees exactly what a real daemon would send.
        "coder.listProjects": async () => ({
          projects: [
            {
              id: "harness-project",
              path: "/tmp/envoydev-mesh-harness-project",
              label: "Relay-proof project",
              hostId: "harness-host",
              addedAt: "2026-01-01T00:00:00.000Z",
              vcs: { kind: "none" },
            },
          ],
        }),
      },
    }),
    createNode: (options: EnvoyMeshOptions) => {
      const built = new EnvoyMesh(
        relays === undefined
          ? options
          : { ...options, bootstrapPeers: relays, configuredRelayAddrs: relays },
      )
      node = built
      return built
    },
  })

  log(`starting the peer; home=${HOME}`)
  const status = await peer.start()
  if (status.kind !== "hosting") {
    emit({ ok: false, reason: `the peer did not host: ${JSON.stringify(status)}` })
    log(`start refused: ${JSON.stringify(status)}`)
    process.exitCode = 1
    return
  }
  log(`hosting as ${status.peerId}; waiting for a circuit reservation`)

  const deadline = Date.now() + WAIT_MS
  const startedAt = Date.now()
  let circuitAddrs: string[] = []
  let lastState = "unknown"
  let nextReport = 0
  while (Date.now() < deadline) {
    const current = peer.status()
    if (current.kind === "hosting") {
      circuitAddrs = current.multiaddrs.filter(
        (addr) => addr.includes("/p2p-circuit/p2p/") && addr.includes(status.peerId),
      )
      if (circuitAddrs.length > 0) break
    }
    if (node) {
      try {
        const relay = node.getRelayReservationStatus()
        const connected = node.getConnectedPeerIds().length
        const circuits = node.getConnectedRelayPeerIds().length
        lastState = `${relay.state} live=${relay.liveRelayPeerIds.length}/${relay.relayPeerIds.length} peers=${connected} circuitPeers=${circuits} err=${relay.lastError ?? "-"}`
      } catch {
        /* a status read must never be why this harness dies */
      }
    }
    // A reservation that never lands is the failure this harness exists to report, so say *where*
    // it got to as it goes rather than only at the end.
    const elapsed = Date.now() - startedAt
    if (elapsed >= nextReport) {
      nextReport = elapsed + 10_000
      log(`waiting for a circuit (${Math.round(elapsed / 1000)}s): ${lastState}`)
    }
    await sleep(1_000)
  }

  emit({
    ok: circuitAddrs.length > 0,
    ...(circuitAddrs.length > 0 ? {} : { reason: `no circuit address after ${WAIT_MS}ms (last reservation state: ${lastState})` }),
    peerId: status.peerId,
    circuitAddrs,
    multiaddrs: status.multiaddrs,
    relayHints: status.relayHints,
    token: TOKEN,
    probe: PROBE,
    deviceId: DEVICE_ID,
  })
  log(
    circuitAddrs.length > 0
      ? `circuit ready: ${circuitAddrs.join(", ")}`
      : `no circuit after ${WAIT_MS}ms — last state ${lastState}`,
  )

  const shutdown = async (why: string): Promise<void> => {
    log(`shutting down (${why})`)
    try {
      await peer.stop()
    } finally {
      process.exit(0)
    }
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
  process.on("SIGINT", () => void shutdown("SIGINT"))
  // Keep the event loop alive; stdin EOF is the caller's "we are done" signal.
  process.stdin.resume()
  process.stdin.on("end", () => void shutdown("stdin end"))
}

main().catch((error: unknown) => {
  emit({ ok: false, reason: error instanceof Error ? error.message : String(error) })
  log(`harness failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exit(1)
})
