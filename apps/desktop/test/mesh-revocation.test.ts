/**
 * **Revocation must cut a live connection, not just the next handshake.**
 *
 * `CoderMeshPeer.closeStreamsForDevice` existed and was tested
 * (`packages/host-bridge/test/mesh-peer.test.ts`), but nothing in production called it:
 * `coder.revokePairedDevice` marked the store row revoked and stopped there, so a phone that was
 * already connected kept its stream open under a credential the owner had just withdrawn. This file
 * is the wiring's proof.
 *
 * It drives the **real** registry rather than a spy: a fake libp2p node captures the protocol handler
 * `createCoderMeshPeer` registers, a scripted duplex authenticates as a paired device through the
 * **real** `PairedDeviceStore.resolveSession`, and the registry is handed to the pairing handlers
 * exactly as `serve.ts` hands it the live `meshPeer`. A spy that only recorded a call would not prove
 * the stream a phone holds is actually closed, which is the claim.
 *
 * The no-op cases sit beside it, because "revocation must never fail" is the other half of the
 * contract: a daemon with **no peer** (`startCoderDaemon`'s `skipMeshAttach` / injected-status paths,
 * which every daemon test uses) and a device that **never opened a stream** both revoke successfully.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { ENVOYDEV_ERRORS, coderErrorCode } from "@envoydev/protocol"
import {
  coderPaths,
  coderSessionIdentity,
  createCoderDispatcher,
  createCoderMeshPeer,
  type CoderDaemonHost,
  type CoderMeshPeer,
  type CoderMeshPeerNode,
  type CoderPaths,
} from "@envoydev/host-bridge"

import { createPairingHandlers } from "../src/daemon/pairing.js"
import { PairedDeviceStore, pairedDevicesFile } from "../src/daemon/paired-devices.js"

/* ────────────────────────────── the scripted phone ────────────────────────────── */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * One mesh connection: sends the handshake, waits for `proxy-accept`, then stays open until
 * `close()` releases its pending read. The same shape `mesh-peer.test.ts` drives the real transport
 * with — here `close()` is the observable the revoke is asserted against.
 */
function scriptedDuplex(token: string) {
  const written: string[] = []
  let closed = false
  let handshakeSent = false
  let release: () => void = () => undefined
  const ended = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    /** A stand-in for "the libp2p stream object", used only as the `toDuplex` map key. */
    stream: {},
    written,
    isClosed: () => closed,
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

/* ────────────────────────────── the daemon's own wiring, one level down ────────────────────────────── */

interface Harness {
  peer: CoderMeshPeer
  dispatch: ReturnType<typeof createCoderDispatcher>
  /** Open a scripted phone connection; resolves once the handshake was accepted. */
  connect(token: string): Promise<ReturnType<typeof scriptedDuplex>>
}

/**
 * `serve.ts`'s wiring without booting the whole daemon: a real `CoderMeshPeer` whose close registry
 * is handed to the pairing handlers as `closeMeshStreams`.
 *
 * `withPeer: false` is the daemon that has no peer — the dep is **absent**, not a stub, which is
 * exactly the state `createPairingHandlers` is built in when `meshPeer` is `null`.
 */
async function harness(paths: CoderPaths, devices: PairedDeviceStore, withPeer = true): Promise<Harness> {
  let handler: ((stream: unknown, connection: unknown) => Promise<void>) | undefined
  const node: CoderMeshPeerNode = {
    start: async () => undefined,
    stop: async () => undefined,
    peerId: "12D3KooWRevocationTestPeer",
    multiaddrs: ["/ip4/192.168.1.20/tcp/4001/p2p/12D3KooWRevocationTestPeer"],
    getRelayAdvertisedMultiaddrs: () => [],
    handleRawProtocol: async (_protocol, next) => {
      handler = next
    },
  }
  const streams = new Map<object, ReturnType<typeof scriptedDuplex>>()
  const peer = createCoderMeshPeer({
    paths,
    sessionIdentity: coderSessionIdentity({ resolveSession: (token) => devices.resolveSession(token) }),
    dispatch: async () => ({ ok: true }),
    createNode: () => node,
    toDuplex: (stream) => streams.get(stream as object)!.duplex,
  })
  await peer.start()

  // The only use the pairing handlers make of the host is `pairingUri` at mint time, which none of
  // these tests reaches; a stub keeps this about revocation rather than a second boot of the daemon.
  const host = {
    pairingUri: () => "envoy://pair?test=1",
    port: 0,
    path: "/ws",
  } as unknown as CoderDaemonHost

  const dispatch = createCoderDispatcher({
    handlers: createPairingHandlers({
      store: devices,
      paths,
      getHost: () => host,
      ...(withPeer
        ? { closeMeshStreams: (deviceId: string) => void peer.closeStreamsForDevice(deviceId) }
        : {}),
    }),
  })

  return {
    peer,
    dispatch,
    async connect(token) {
      const scripted = scriptedDuplex(token)
      streams.set(scripted.stream, scripted)
      expect(handler, "the peer never registered the client-proxy protocol").toBeTypeOf("function")
      const run = handler!(scripted.stream, {})
      await vi.waitFor(() => expect(scripted.written.join("")).toContain("proxy-accept"))
      // The connection's read loop stays parked until the stream is closed; that resolution is what
      // the revoke (or the test's own teardown) releases. Swallow it so it is never unhandled.
      void run.catch(() => undefined)
      return scripted
    },
  }
}

/* ────────────────────────────── the tests ────────────────────────────── */

let home: string
let paths: CoderPaths

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "envoydev-mesh-revocation-"))
  paths = coderPaths(home)
})

afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/** A store per test, so one test's revoked rows cannot answer another's resolve. */
function freshStore(): PairedDeviceStore {
  return new PairedDeviceStore(pairedDevicesFile(paths), { ownerId: async () => "envoy:owner:test" })
}

describe("revoking a paired device cuts its live mesh stream", () => {
  it("closes the open stream, and still revokes a device that never had one", async () => {
    const devices = freshStore()
    const h = await harness(paths, devices)
    try {
      const live = (await devices.mint({ deviceLabel: "Live phone" })).record
      const idle = (await devices.mint({ deviceLabel: "Never connected" })).record

      const phone = await h.connect(live.token)
      expect(phone.isClosed(), "the stream should be open before the revoke").toBe(false)

      // The owner's window: no session. The revoke is what must reach into the peer.
      const revoked = (await h.dispatch("coder.revokePairedDevice", { id: live.id }, undefined as never)) as {
        device: { id: string; revokedAt?: string }
      }
      expect(revoked.device.id).toBe(live.id)
      expect(revoked.device.revokedAt).toBeTruthy()
      expect(phone.isClosed(), "the live stream survived the revoke").toBe(true)

      // A device that never opened a stream: the close is a no-op and the revoke still succeeds.
      const idleRevoked = (await h.dispatch("coder.revokePairedDevice", { id: idle.id }, undefined as never)) as {
        device: { id: string; revokedAt?: string }
      }
      expect(idleRevoked.device.id).toBe(idle.id)
      expect(idleRevoked.device.revokedAt).toBeTruthy()
    } finally {
      await h.peer.stop()
    }
  })

  it("revokes when the daemon has no mesh peer at all — absence is a no-op, never a failure", async () => {
    const devices = freshStore()
    const h = await harness(paths, devices, false)
    try {
      const device = (await devices.mint({ deviceLabel: "No peer" })).record
      const revoked = (await h.dispatch("coder.revokePairedDevice", { id: device.id }, undefined as never)) as {
        device: { id: string; revokedAt?: string }
      }
      expect(revoked.device.id).toBe(device.id)
      expect(revoked.device.revokedAt).toBeTruthy()
    } finally {
      await h.peer.stop()
    }
  })

  it("still refuses a paired phone — the owner-window rule runs before the store is touched", async () => {
    const devices = freshStore()
    const h = await harness(paths, devices)
    try {
      const device = (await devices.mint({ deviceLabel: "Phone tries to revoke" })).record
      const session = {
        scopeKey: "product:EnvoyDev",
        ownerId: "envoy:owner:test",
        isOwnerScope: true,
        deviceId: device.id,
        caller: { kind: "owner-device", deviceId: device.id, label: "Phone" },
      }

      let code: string | null = null
      try {
        await h.dispatch("coder.revokePairedDevice", { id: device.id }, session as never)
      } catch (error) {
        code = coderErrorCode(error instanceof Error ? error.message : String(error))
      }
      expect(code).toBe(ENVOYDEV_ERRORS.unauthorized)

      // The guard is first: the refusal did not revoke the row it refused to revoke.
      const listed = await devices.list()
      expect(listed.find((row) => row.id === device.id)?.revokedAt).toBeUndefined()
    } finally {
      await h.peer.stop()
    }
  })
})
