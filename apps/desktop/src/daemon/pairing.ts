/**
 * Pairing RPCs: mint a phone code, list who may call, revoke a device.
 *
 * ## Loopback-only, and now actually enforced
 *
 * A paired phone must not mint further phones. That sentence was in this file before it was true: the
 * dispatcher called `handler(params)` and never handed the session over, so nothing here could tell a
 * phone from the owner's window — and a phone holding a valid token could mint itself another one,
 * indefinitely, past the revocation of the first. The dispatcher now passes the caller, and
 * `requireOwnerWindow` below is the guard the sentence described.
 *
 * ## Why the guard is here and not on the transport
 *
 * `loopbackOnlyMethods` is the family's port for exactly this, and `createReuseHost` does not forward
 * it — the same silent drop as `eventDispositions` (`@envoydev/protocol`'s `CODER_EVENTS` documents
 * that one). Declaring it there would be a second sentence that is not true, so the rule is enforced
 * where it can be: against the session the dispatcher hands in.
 *
 * **`session === undefined` means the owner's window.** The transport refuses a tokenless caller that
 * is not on this machine, so a request arriving without a session came from loopback. A session means
 * a paired device.
 */

import { networkInterfaces } from "node:os";

import {
  ENVOYDEV_ERRORS,
  coderError,
  parseRpcParams,
  type RpcMethod,
} from "@envoydev/protocol";
import type { CoderDaemonHost } from "@envoydev/host-bridge";

import { ref } from "./messages.js";
import type { CoderCallContext, CoderHandler } from "./service.js";
import {
  loadOrCreatePairingIdentity,
  type PairedDeviceStore,
} from "./paired-devices.js";
import type { CoderPaths } from "@envoydev/host-bridge";

export interface PairingHandlerDeps {
  store: PairedDeviceStore;
  paths: CoderPaths;
  /** Bound after `createCoderDaemonHost` — mint needs the live port and `pairingUri`. */
  getHost: () => CoderDaemonHost;
  /**
   * Mesh-attached relay fields, when the daemon has them. Absent is fine: the phone still dials
   * direct / SSH first.
   *
   * **Legacy, and deliberately unfilled by the daemon.** Its shape is the *WebSocket* relay
   * (`relayPeerId` + `relayWsUrls`), which is a different mechanism from the libp2p relays this
   * daemon now uses. The replaced route is `mesh` below, which carries the family's contract fields
   * (`homeNodePeerId` / `bootstrapPeers`); feeding libp2p relay hints into this shape would name the
   * right concept with the wrong address, and a QR is the worst place to be approximately right.
   */
  relay?: () => { relayPeerId?: string; relayWsUrls?: readonly string[] };
  /**
   * This daemon's own libp2p identity, so a minted code can offer a direct peer route.
   *
   * A *function* rather than values because the peer is started after the host: minting happens long
   * after boot, and reading it at mint time is what lets the payload include a relay-circuit address
   * that only exists once the reservation has landed.
   */
  mesh?: () => { peerId?: string; multiaddrs: readonly string[]; relayHints: readonly string[] };
  /**
   * Cut a revoked device's **already-open** mesh stream, if this daemon has a live peer.
   *
   * `store.revoke` stops the *next* authentication only. A phone that was already connected keeps its
   * stream until it closes it itself, so without this a revoke leaves the connection it was meant to
   * end running — revocation in name only.
   *
   * Optional, and absence is an ordinary no-op rather than an error: a daemon booted with
   * `skipMeshAttach` (or an injected `mesh` status, which every test uses) has no peer at all, and
   * `serve.ts` reaches its `meshPeer` closure for the real one. The call is fire-and-forget because
   * how many streams closed is the peer's business, not the revoke's answer.
   */
  closeMeshStreams?: (deviceId: string) => void;
  /**
   * Cut a revoked device's **already-open WebSocket** sessions on the daemon host.
   *
   * Same security event as `closeMeshStreams`, for the LAN/`host:port` route. Optional for the same
   * reason: unit tests that never call `serve()` have no host sockets to close.
   */
  closeWsSessions?: (deviceId: string) => void;
  /**
   * Wait until this daemon's own mesh peer has finished starting (hosting or refused), or resolve
   * immediately when there is no peer to wait for (`skipMeshAttach` / injected status).
   *
   * Mint runs against a host that is already listening, while the peer starts *after* `serve()`.
   * Without this wait a code minted in that window silently omits libp2p fields even though the peer
   * is about to host — the phone would get WS/SSH only for no reason the user can see.
   */
  awaitMeshReady?: () => Promise<void>;
}

/** First non-loopback IPv4 address, or `null` when the machine has none. */
export function firstLanAddress(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      // `family` is a **string** in the Node types this repo builds against (`"IPv4" | "IPv6"`); it
      // was the number `4`/`6` in the API those types replaced. Comparing it as text means the same
      // thing whichever a runtime hands back: `!== 4` no longer type-checks, and writing only
      // `!== "IPv4"` would skip every interface on a Node old enough to still answer with numbers —
      // which surfaces as "this machine has no LAN address", the one bug this function exists to
      // avoid.
      const family = String(entry.family);
      if (family !== "IPv4" && family !== "4") continue;
      return entry.address;
    }
  }
  return null;
}

/**
 * Hostname (or bare IP) from a reach string that may include `:port`.
 *
 * `pairingUri` always appends the daemon's bound port, so a typed `203.0.113.7:4770` must not become
 * `ws://203.0.113.7:4770:4770/ws`. IPv6 in brackets is supported; a bare hostname is returned as-is.
 */
export function hostnameOfReach(raw: string): string {
  const text = raw.trim();
  if (text === "") return "";
  if (text.startsWith("[")) {
    const match = /^\[([^\]]+)](?::\d+)?$/.exec(text);
    return match?.[1] ?? text;
  }
  const colon = text.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(text.slice(colon + 1))) {
    return text.slice(0, colon);
  }
  return text;
}

/**
 * Refuse anything but a call made **at the machine itself**.
 *
 * Not an authority distinction. A paired phone is the owner's own device and stands where the desktop
 * window stands (`PairedSession` says so); what this refuses is *where* the call comes from, because a
 * pairing code is minted by the machine that will be paired — a physical-presence rule that would
 * apply to a second desktop window on another machine too.
 *
 * The wording is a sentence rather than a code because a phone that tries this is not a broken
 * client; it is asking for something only the machine can do, and the message says where to go.
 */
export function requireOwnerWindow(context: CoderCallContext, method: string): void {
  if (context.session === undefined) return;
  throw coderError(
    ENVOYDEV_ERRORS.unauthorized,
    `${method} can only be done at the machine itself. A paired device cannot pair another one — ` +
      "open EnvoyDev on the machine you want to pair with.",
    ref("error.ownerWindowOnly"),
  );
}

export function createPairingHandlers(deps: PairingHandlerDeps): Partial<Record<RpcMethod, CoderHandler>> {
  return {
    "coder.mintPairing": async (params, context) => {
      requireOwnerWindow(context, "coder.mintPairing");
      const input = parseRpcParams("coder.mintPairing", params) as {
        deviceLabel?: string;
        host?: string;
        lanHost?: string;
        token?: string;
        fresh?: boolean;
      };
      // Settle the peer before reading its addresses — see `awaitMeshReady` on the deps.
      await deps.awaitMeshReady?.();
      const host = deps.getHost();
      const lan = firstLanAddress();
      // User-supplied host wins (host:port typed route). Strip a trailing `:port` — pairingUri always
      // appends the daemon's bound port, so `203.0.113.7:4770` must become hostname `203.0.113.7`.
      const reach = hostnameOfReach(input.host?.trim() || "") || lan || "127.0.0.1";
      const lanHint = hostnameOfReach(input.lanHost?.trim() || "") || lan || undefined;
      const lanHost =
        lanHint && lanHint !== reach && lanHint !== "127.0.0.1" ? lanHint : undefined;
      const identity = await loadOrCreatePairingIdentity(deps.paths);
      let record: Awaited<ReturnType<PairedDeviceStore["mint"]>>["record"];
      let device: Awaited<ReturnType<PairedDeviceStore["mint"]>>["public"];
      try {
        const minted = await deps.store.mint({
          ...(input.deviceLabel ? { deviceLabel: input.deviceLabel } : {}),
          ...(input.token !== undefined ? { token: input.token } : {}),
          ...(input.fresh === true ? { fresh: true } : {}),
        });
        record = minted.record;
        device = minted.public;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already in use/i.test(message)) {
          throw coderError(
            ENVOYDEV_ERRORS.badRequest,
            "That token is already in use by another pairing code. Choose a different one.",
            ref("error.pairingTokenDuplicate"),
          );
        }
        if (/letters and digits/i.test(message)) {
          throw coderError(
            ENVOYDEV_ERRORS.badRequest,
            "The token must be letters and digits only (8–10 characters).",
            ref("error.pairingTokenCharset"),
          );
        }
        if (/must be \d/i.test(message) || /characters/i.test(message)) {
          throw coderError(
            ENVOYDEV_ERRORS.badRequest,
            "The token must be 8–10 characters.",
            ref("error.pairingTokenLength"),
          );
        }
        throw error;
      }
      const relay = deps.relay?.() ?? {};
      const mesh = deps.mesh?.() ?? { multiaddrs: [], relayHints: [] };
      const uri = await host.pairingUri(
        {
          token: record.token,
          ownerId: identity.ownerId,
          ownerPublicKey: identity.ownerPublicKey,
          host: reach,
          ...(lanHost ? { lanHost } : {}),
          ...(relay.relayPeerId ? { relayPeerId: relay.relayPeerId } : {}),
          ...(relay.relayWsUrls && relay.relayWsUrls.length > 0 ? { relayWsUrls: relay.relayWsUrls } : {}),
          ...(mesh.peerId && mesh.multiaddrs.length > 0
            ? {
                meshPeerId: mesh.peerId,
                meshMultiaddrs: mesh.multiaddrs,
                meshRelayHints: mesh.relayHints,
              }
            : {}),
        },
        // **The QR route compresses; the typed route does not.** A user-supplied short token means this
        // is the manual `host:port` route (`PairingSection`'s form), whose payload is short by
        // construction and which the window reads back synchronously with `readPairingLink` — the user
        // types those two fields into the phone, so nothing scans the URI. The QR route (no user token)
        // carries a long random secret and the mesh multiaddrs, and is the one a camera resolves: at the
        // family's 512 px render the measured legacy payload is a version-26 symbol at 4.10 px/module —
        // barely the 4 px/module floor — while the compressed `pairing=` form is version 18 at 5.51.
        { compressed: input.token === undefined },
      );
      return { uri, device };
    },

    "coder.listPairedDevices": async (params, context) => {
      requireOwnerWindow(context, "coder.listPairedDevices");
      parseRpcParams("coder.listPairedDevices", params);
      return { devices: await deps.store.list() };
    },

    "coder.revokePairedDevice": async (params, context) => {
      requireOwnerWindow(context, "coder.revokePairedDevice");
      const input = parseRpcParams("coder.revokePairedDevice", params) as { id: string };
      const device = await deps.store.revoke(input.id);
      if (!device) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          `There is no paired device called "${input.id}". It may already have been revoked.`,
          ref("error.pairedDeviceMissing", { id: input.id }),
        );
      }
      // The store has now *persisted* the revocation, and nothing here may undo or hide it. A daemon
      // with no peer is the `?.` no-op; a device with no live stream is `closeStreamsForDevice`
      // returning 0; and a transport that throws while closing a half-dead duplex is swallowed,
      // because the credential is already withdrawn and reporting the revoke as failed would be a
      // lie about the security event. `device.id` is the key the mesh registry registered — it is
      // `match.id` in `PairedDeviceStore.resolveSession`. The same id keys WebSocket sessions.
      try {
        deps.closeMeshStreams?.(device.id);
      } catch {
        /* the revocation succeeded; a stream that would not close must not turn that into an error */
      }
      try {
        deps.closeWsSessions?.(device.id);
      } catch {
        /* same rule as the mesh half */
      }
      return { device };
    },

    /**
     * Forget a **revoked** record — the cleanup half of revocation, and nothing else.
     *
     * `requireOwnerWindow` is the same guard as mint and revoke: deleting the row removes the evidence
     * that a token was withdrawn, which is at least as sensitive as withdrawing it. The store refuses an
     * active record, so the two-step ("revoke, then forget") cannot be collapsed from the wire either.
     *
     * **No stream close here, deliberately.** Forget is only reachable for a record that is already
     * `revoked`, and `coder.revokePairedDevice` is the only caller of `store.revoke` — so
     * `closeMeshStreams` / `closeWsSessions` have already run for this device and a second call would
     * be a no-op. Repeating it would also tell a future reader that *forget* is what cuts a live
     * connection, which is exactly the wrong belief. The one place a connection is closed is the
     * revoke handler above.
     */
    "coder.forgetPairedDevice": async (params, context) => {
      requireOwnerWindow(context, "coder.forgetPairedDevice");
      const input = parseRpcParams("coder.forgetPairedDevice", params) as { id: string };
      const outcome = await deps.store.forget(input.id);
      if (outcome.kind === "missing") {
        // The same key as revoke's refusal: a row reaches `missing` only after it was revoked and then
        // forgotten, so "it may already have been revoked" stays true and reuses one sentence.
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          `There is no paired device called "${input.id}". It may already have been revoked.`,
          ref("error.pairedDeviceMissing", { id: input.id }),
        );
      }
      if (outcome.kind === "not-revoked") {
        // The row still names a token that a phone could present, so removing it would destroy the only
        // record of a live credential. The sentence names the one action that makes the delete legitimate.
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          `"${input.id}" has not been revoked. Revoke it first — a record is only forgotten once the ` +
            "token is withdrawn.",
          ref("error.pairedDeviceNotRevoked", { id: input.id }),
        );
      }
      return { device: outcome.device };
    },
  };
}
