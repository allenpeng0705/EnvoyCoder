/**
 * EnvoyDev's **own** mesh peer — the daemon as a peer, not a product attached to somebody else's node.
 *
 * When the desktop and the phone are in use there is no EnvoyMesh process anywhere: the daemon
 * reuses the family's network layer (`@envoymesh/network`) to *be* a peer, and the phone dials this
 * daemon's `coder.*` surface over the same host transport the WebSocket host serves locally
 * (`docs/envoydev-mesh-transport.md`). Attaching to a *local* EnvoyMesh node is a separate, optional
 * feature that lives beside this one (`attachToMeshNode`) and is never the phone's route.
 *
 * ## What is injected, and why this file imports no app
 *
 * `host-bridge` is the family-layer boundary; `apps/desktop` must not be a dependency of it. So the
 * two ports this peer needs — the session identity resolver and the dispatcher — arrive as
 * parameters, exactly as they do for `createCoderDaemonHost` (`apps/desktop/src/daemon/serve.ts:338`).
 * The *node factory* is injectable too, defaulting to the real `new EnvoyMesh(...)`: a unit test can
 * then assert the options we derive and the status we map without a single libp2p dial, which is the
 * only way to test the failure branches honestly.
 */

import { DEFAULT_ENVOY_COMMUNITY_RELAY_BOOTSTRAP_ADDRS } from "@envoymesh/api/core"
import {
  CLIENT_PROXY_PROTOCOL,
  EnvoyMesh,
  meshStreamAsDuplex,
  type EnvoyMeshOptions,
} from "@envoymesh/network"
import {
  type FramedDuplex,
  type HostRpcDispatcher,
  type SessionIdentityResolver,
  createMeshHostTransport,
  createProxyCloseRegistry,
} from "@envoymesh/reuse-host"
import type { CoderMeshStatus } from "@envoydev/protocol"

// Type-only, so there is no runtime cycle: `index.ts` re-exports this module, and this import is
// erased. `paths` is required rather than defaulted for the same reason — resolving the shared home
// is a policy this package already put in one place (`coderPaths`), and re-running it here would let
// a caller's temporary test home disagree with the daemon's live one.
import type { CoderPaths } from "./index.js"
// The identity's path policy and its fs-backed loader live together in their own module (this file
// owns the peer's lifecycle and the options it is built with, and both are expected to stay under
// ~500 lines). The loader is the *honoured* half: `EnvoyMesh` reads `libp2pPrivateKey`, never a path.
import {
  loadOrCreateMeshIdentity,
  meshIdentityPath,
  type CoderMeshPrivateKey,
} from "./mesh-identity.js"

/**
 * The family's shared CN + US community relays, as a static hint list.
 *
 * Static here is deliberate, and it is the same choice EnvoyMesh's own node makes with
 * `configuredRelayAddrs` (`../EnvoyMesh/apps/node/src/index.ts:1251`). The roster *document*
 * (`relay-roster-feed.ts`) is a live fetch: it can fail at boot, and a phone-facing daemon that
 * refused to start because a weather report was unavailable would be a worse product than one whose
 * hints are a release old. The roster is read from `@envoymesh/api/core`
 * (`../EnvoyMesh/packages/api/src/default-bootstrap.ts:24`) — never copied.
 */
export const CODER_MESH_RELAY_HINTS: readonly string[] = DEFAULT_ENVOY_COMMUNITY_RELAY_BOOTSTRAP_ADDRS

/**
 * The options our peer is built with — a **phone-facing host, not a member of the public swarm**.
 *
 * The phone learns everything it needs from the pairing QR (`serve.ts` sends `meshPeerId`,
 * `meshMultiaddrs` and `meshRelayHints`), so discovery mechanisms for peers nobody named are pure
 * cost. In the owner's words: *"The mobile scans the QR code and knows the details of home node, no
 * needs for home node to continue to keep trying connecting with some unknowing items."*
 *
 * That is why `enableDht`, `dhtClientMode`, `enableMdns` and `enableAutoNat` are `false` and
 * `bootstrapPeers` is empty. **Measured at rest** (real `EnvoyMesh`, isolated home, ~60 s):
 *
 *   * the family defaults that were here before — DHT + mDNS + AutoNAT on, `bootstrapPeers` = the
 *     community relays — reached **17 peers (2 relays + 15 unknown)** for **+89.3 MB RSS**;
 *   * these options reached **2 peers (exactly the two configured relays)** for **+9.0 MB RSS**.
 *
 * That is the rejected alternative, written down so a future reader does not "helpfully" turn the
 * DHT back on. Nothing the product does needs those strangers, and every one of them is somebody
 * else's connection, CPU and memory on the owner's machine.
 *
 * `configuredRelayAddrs` is the load-bearing option that keeps the WAN route: the network package
 * makes each a `<relay>/p2p-circuit` **listen** address and dials the relay while setting it up
 * (`../EnvoyMesh/packages/network/src/index.ts:798-813`). A reservation does **not** require the
 * DHT — it is negotiated over that connection — and a `reserved/live/everReserved` circuit plus an
 * authenticated `coder.meshStatus` over `/p2p-circuit` were measured with the options below.
 * `bootstrapPeers` is empty because it is the libp2p *bootstrap/DHT* path, duplicating a connection
 * `configuredRelayAddrs` already makes; the pairing payload is unaffected, since its
 * `bootstrapPeers` is `meshPeer.multiaddrs ∪ meshPeer.relayHints` and `relayHints` is the constant
 * `CODER_MESH_RELAY_HINTS` below.
 *
 * `enableRelay` stays: it registers the circuit-relay transport the `/p2p-circuit` listen address
 * needs. `enableDcutr` stays because it only ever dials back the peer that just connected through
 * the relay — the phone — to upgrade that circuit to direct; with the swarm gone there is nobody
 * else to dial.
 *
 * `identity` is the peer's persisted Ed25519 key, loaded by `start()` from
 * `meshIdentityPath(paths)` and passed as the honoured `libp2pPrivateKey`. Without it libp2p mints a
 * new key per process, so the peer id a pairing code carried goes stale on the next daemon restart —
 * a failure that looks like a flaky network, not a stale identity. It is optional only so a caller
 * (the unit tests' fake node) can ask for an ephemeral node on purpose.
 */
export function coderMeshOptions(identity?: CoderMeshPrivateKey): EnvoyMeshOptions {
  return {
    listen: ["/ip4/0.0.0.0/tcp/0"],
    // Discovery for peers nobody named: the QR already named this one.
    enableMdns: false,
    enableDht: false,
    dhtClientMode: false,
    bootstrapPeers: [],
    enableAutoNat: false,
    // The direct route, the relay circuit, and the phone's DCUtR upgrade of that circuit.
    enableRelay: true,
    configuredRelayAddrs: [...DEFAULT_ENVOY_COMMUNITY_RELAY_BOOTSTRAP_ADDRS],
    enableDcutr: true,
    ...(identity ? { libp2pPrivateKey: identity } : {}),
  }
}

/* ────────────────────────────── the node, structurally ───────────────────────────── */

/**
 * The subset of `EnvoyMesh` this module uses.
 *
 * Declared instead of imported as `EnvoyMesh` so the factory seam is a real seam: a test supplies an
 * object with these members and nothing libp2p-shaped is constructed. The two optional methods are
 * exactly that — present on the real class (`getRelayAdvertisedMultiaddrs`, `getConnectedPeerIds`)
 * and absent on the smallest useful fake.
 */
export interface CoderMeshPeerNode {
  start(): Promise<void>
  stop(): Promise<void>
  readonly peerId: string
  readonly multiaddrs: string[]
  handleRawProtocol(
    protocol: string,
    handler: (stream: unknown, connection: unknown) => Promise<void>,
  ): Promise<void>
  /** Dialable addresses including relay circuits; preferred over `multiaddrs` when present. */
  getRelayAdvertisedMultiaddrs?(): string[]
  /** How many peers are connected right now; the honest source for `peerCount`. */
  getConnectedPeerIds?(): string[]
}

/** Defaults to `(options) => new EnvoyMesh(options)`; a test supplies a fake and captures `options`. */
export type CoderMeshNodeFactory = (options: EnvoyMeshOptions) => CoderMeshPeerNode

/* ────────────────────────────── refusal codes ────────────────────────────── */

/**
 * Why `start()` could not produce a `hosting` status. Small on purpose: the daemon maps these onto
 * end-user wording, and a long tail of codes nobody renders is a long tail nobody tests.
 *
 *   * `mesh-start-failed`     — the node itself never came up (bad listen address, port exhaustion).
 *   * `mesh-protocol-failed`  — it came up, but `CLIENT_PROXY_PROTOCOL` could not be registered, so
 *                               the `coder.*` surface is unreachable. Treated as a failure and torn
 *                               down: reporting `hosting` here would be a capability claim the
 *                               protocol does not deliver.
 *   * `mesh-unusable`         — it started but has no peer id, so no pairing payload could name it.
 *   * `mesh-stop-failed`      — `stop()` threw; the peer may still be listening.
 */
export type CoderMeshPeerErrorCode =
  | "mesh-start-failed"
  | "mesh-protocol-failed"
  | "mesh-unusable"
  | "mesh-stop-failed"

/* ────────────────────────────── the coder.* surface over the mesh ────────────────────────────── */

/**
 * The two ports `createCoderDaemonHost` already takes, plus the per-connection event push.
 *
 * `subscribe` is passed through to the transport's per-connection `subscribe` port, which is what a
 * phone on the mesh needs to receive run events; the WebSocket path reaching the same bus is the
 * daemon's business, not this module's (the handover's trap note: a mesh client that never sees an
 * event is a phone that can answer approvals into silence).
 */
export interface CoderMeshProxyPorts {
  sessionIdentity: SessionIdentityResolver<unknown>
  dispatch: HostRpcDispatcher<unknown>
  subscribe?: (send: (event: string, data: unknown) => void) => () => void
}

type ProxyCloseRegistry = ReturnType<typeof createProxyCloseRegistry>

/**
 * The transport's options, built **per connection**.
 *
 * `createMeshHostTransport` takes a factory rather than an options object precisely because a shared
 * object shares every closure — caller identity, the unregister handle, the subscription — which is a
 * silent cross-device leak (`../EnvoyMesh/packages/host-connect/src/mesh-host-transport.ts:89-99`).
 * The reference implementation wraps its per-connection `resolveSession` for the same reason
 * (`../EnvoyMesh/apps/node/src/client-proxy-handler.ts:79`). What we add per connection is the close
 * registration: revocation closes live streams, and a revoked phone must not keep a stream open
 * (`createProxyCloseRegistry` docs).
 */
function createProxyServe(
  ports: CoderMeshProxyPorts,
  registry: ProxyCloseRegistry,
): (duplex: FramedDuplex) => Promise<void> {
  return createMeshHostTransport<unknown>((duplex) => {
    // Per-connection state. `unregister` is assigned once this connection's session is resolved; a
    // shared options object would leave every connection pointing at the last one's handle.
    let unregister: () => void = () => undefined

    return {
      sessionIdentity: {
        localScopeKey: ports.sessionIdentity.localScopeKey,
        resolveSession: async (token) => {
          const session = await ports.sessionIdentity.resolveSession(token)
          if (!session) return null
          // Scope the close to the device the product identified. `register` is a no-op for an
          // undefined device id, which is the honest outcome for a session with no device.
          unregister = registry.register(session.deviceId, () => {
            void duplex.close()
          })
          return session
        },
      },
      dispatch: ports.dispatch,
      // Always supplied, even when the product publishes no events: the transport only calls the
      // returned cleanup when `subscribe` is present, and that cleanup is what releases this
      // connection's registry slot. Without it a closed connection would stay "revocable" forever
      // and the registry would grow one dead duplex per connection.
      subscribe: (send) => {
        const unsubscribe = ports.subscribe?.(send) ?? (() => undefined)
        return () => {
          unsubscribe()
          unregister()
        }
      },
    }
  })
}

/* ────────────────────────────── the peer ────────────────────────────── */

export interface CoderMeshPeerOptions extends CoderMeshProxyPorts {
  /** Where this product's state lives — the caller's decision, so a test home stays a test home. */
  paths: CoderPaths
  /** Defaults to the real `new EnvoyMesh(...)`. Injected so option derivation is testable. */
  createNode?: CoderMeshNodeFactory
  /** Defaults to the real libp2p adapter; injected so the registered handler is testable. */
  toDuplex?: (stream: unknown) => FramedDuplex
}

/**
 * A started (or startable) peer, plus the ingredients a pairing payload needs.
 *
 * `peerId`, `multiaddrs` and `relayHints` are accessors rather than a snapshot so a caller can mint a
 * code *after* the relay reservation lands and get the circuit address. They are empty/undefined
 * until `start()` succeeds — a pairing payload built from a hopeful value would send a phone to a
 * peer that does not exist.
 */
export interface CoderMeshPeer {
  /** Idempotent: a second call while hosting returns the same status without a second node. */
  start(): Promise<CoderMeshStatus>
  /** Idempotent, and safe before `start()` or after a failed one. Never rejects. */
  stop(): Promise<void>
  /** The current truth — recomputed while hosting so `peerCount` and addresses are not stale. */
  status(): CoderMeshStatus
  readonly peerId: string | undefined
  readonly multiaddrs: string[]
  readonly relayHints: string[]
  /** Close this device's live mesh streams (revocation); returns how many were closed. */
  closeStreamsForDevice(deviceId: string): number
}

/**
 * Create EnvoyDev's own mesh peer.
 *
 * Lifecycle is owned here: the node is constructed on `start()` (never at module import, so a
 * process that never needs the mesh never touches the network) and `stop()` is total — calling it
 * twice, or without a start that ever worked, is an ordinary no-op, because a daemon shutdown path
 * calls it unconditionally.
 */
export function createCoderMeshPeer(options: CoderMeshPeerOptions): CoderMeshPeer {
  const relayHints = [...DEFAULT_ENVOY_COMMUNITY_RELAY_BOOTSTRAP_ADDRS]
  const createNode =
    options.createNode ?? ((meshOptions: EnvoyMeshOptions) => new EnvoyMesh(meshOptions))
  const toDuplex = options.toDuplex ?? ((stream: unknown) => meshStreamAsDuplex(stream as never))
  const registry = createProxyCloseRegistry()
  const serve = createProxyServe(options, registry)

  let node: CoderMeshPeerNode | undefined
  /**
   * Guards a `stop()` that races a `start()` still awaiting the network. `stop()` bumps it; `start()`
   * checks it after each await and tears its half-built node down instead of publishing it. Without
   * this, a daemon shutting down during boot would leave a peer listening after "stopped".
   */
  let generation = 0
  let lastStatus: CoderMeshStatus = {
    kind: "no-node",
    reason: "The daemon's own mesh peer has not been started.",
  }

  const readPeerId = (target: CoderMeshPeerNode): string | undefined => {
    try {
      const id = target.peerId
      return typeof id === "string" && id.length > 0 ? id : undefined
    } catch {
      // `EnvoyMesh.peerId` throws before the node is up (`requireNode()`); an unknown peer id is a
      // state, not a crash, and the caller gets `undefined` rather than an exception.
      return undefined
    }
  }

  const advertisedAddrs = (): string[] => {
    if (!node) return []
    try {
      // The relay-aware getter strips circuits whose hop is not a configured relay and rewrites
      // private hop views onto the public relay base (`network/src/index.ts:1113`). That is the list
      // a phone can actually dial; the raw `multiaddrs` is only the fallback for a fake node.
      const relayed = node.getRelayAdvertisedMultiaddrs?.()
      const addrs = relayed && relayed.length > 0 ? relayed : node.multiaddrs
      return [...new Set(addrs)]
    } catch {
      return []
    }
  }

  const countPeers = (): number | undefined => {
    if (!node?.getConnectedPeerIds) return undefined
    try {
      return node.getConnectedPeerIds().length
    } catch {
      return undefined
    }
  }

  const hostingStatus = (): Extract<CoderMeshStatus, { kind: "hosting" }> | undefined => {
    if (!node) return undefined
    const peerId = readPeerId(node)
    if (!peerId) return undefined
    const peers = countPeers()
    return {
      kind: "hosting",
      peerId,
      multiaddrs: advertisedAddrs(),
      relayHints: [...relayHints],
      ...(peers !== undefined ? { peerCount: peers } : {}),
    }
  }

  const refused = (code: CoderMeshPeerErrorCode, reason: string): CoderMeshStatus => ({
    kind: "refused",
    code,
    reason,
  })

  return {
    get peerId() {
      return node ? readPeerId(node) : undefined
    },
    get multiaddrs() {
      return advertisedAddrs()
    },
    get relayHints() {
      // A copy: the pairing payload is built from this, and a caller that sorted it in place would
      // reorder the hints for everyone else.
      return [...relayHints]
    },

    async start() {
      // Deliberately not `this.status()`: a caller may pass `start` around unbound, and a lifecycle
      // method that only works when called as a property is a trap.
      if (node) return hostingStatus() ?? lastStatus
      const mine = ++generation

      let created: CoderMeshPeerNode
      try {
        // The identity is loaded (or created and persisted) *before* the node is constructed:
        // `libp2pPrivateKey` is only read when `EnvoyMesh.start` builds libp2p, so this is the one
        // moment the peer's identity can be chosen. An unreadable key fails here and is reported as
        // a start failure, never silently replaced with a fresh identity.
        const identity = await loadOrCreateMeshIdentity(meshIdentityPath(options.paths))
        // A `stop()` may have arrived while the key was being read; do not build a node nobody owns.
        if (mine !== generation) return lastStatus
        created = createNode(coderMeshOptions(identity))
      } catch (error) {
        lastStatus = refused(
          "mesh-start-failed",
          `The mesh peer could not be created: ${messageOf(error)}.`,
        )
        return lastStatus
      }

      try {
        await created.start()
      } catch (error) {
        await stopQuietly(created)
        lastStatus = refused(
          "mesh-start-failed",
          `The mesh peer did not start: ${messageOf(error)}. The daemon works on the local network only until it does.`,
        )
        return lastStatus
      }
      if (mine !== generation) {
        await stopQuietly(created)
        return lastStatus
      }

      const peerId = readPeerId(created)
      if (!peerId) {
        await stopQuietly(created)
        lastStatus = refused(
          "mesh-unusable",
          "The mesh peer started but reported no peer id, so a pairing code could not name it.",
        )
        return lastStatus
      }

      try {
        await created.handleRawProtocol(CLIENT_PROXY_PROTOCOL, async (stream) => {
          await serve(toDuplex(stream))
        })
      } catch (error) {
        // The node is listening, but nobody can call `coder.*` on it. Tearing it down and saying
        // `refused` is the honest pair of actions; `hosting` here would claim a surface the protocol
        // handshake cannot reach.
        await stopQuietly(created)
        lastStatus = refused(
          "mesh-protocol-failed",
          `The mesh peer started but ${CLIENT_PROXY_PROTOCOL} could not be registered: ${messageOf(error)}. The daemon does not answer coder.* over the mesh.`,
        )
        return lastStatus
      }
      if (mine !== generation) {
        await stopQuietly(created)
        return lastStatus
      }

      node = created
      const hosting = hostingStatus()
      if (!hosting) {
        node = undefined
        await stopQuietly(created)
        lastStatus = refused(
          "mesh-unusable",
          "The mesh peer started but reported no peer id, so a pairing code could not name it.",
        )
        return lastStatus
      }
      lastStatus = hosting
      return lastStatus
    },

    async stop() {
      // Bump first: a `start()` suspended on the network sees this and will not publish its node.
      generation += 1
      const current = node
      node = undefined
      // No node is not a failure: this is the "never started", "start failed" and "already stopped"
      // paths, and a shutdown must not have to know which one it is in.
      if (!current) return
      try {
        await current.stop()
        lastStatus = {
          kind: "no-node",
          reason: "The daemon's own mesh peer is stopped.",
        }
      } catch (error) {
        lastStatus = refused(
          "mesh-stop-failed",
          `Stopping the mesh peer failed: ${messageOf(error)}. It may still be listening.`,
        )
      }
    },

    status() {
      // While hosting, re-derive: addresses and the peer count change after start, and a cached
      // answer would be the stale value the phone's pairing payload must not carry.
      if (lastStatus.kind === "hosting") return hostingStatus() ?? lastStatus
      return lastStatus
    },

    closeStreamsForDevice(deviceId: string): number {
      return registry.closeForDevice(deviceId)
    },
  }
}

/* ────────────────────────────── small shared helpers ───────────────────────────── */

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Stop a node whose start we are abandoning, and swallow the result.
 *
 * The caller is already reporting *why* it is abandoning it; letting a stop failure replace that
 * sentence (or throw out of `start()`) would hide the cause the user needs.
 */
async function stopQuietly(target: CoderMeshPeerNode): Promise<void> {
  try {
    await target.stop()
  } catch {
    /* the original failure is the one worth reporting */
  }
}
