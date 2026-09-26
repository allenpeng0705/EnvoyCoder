/**
 * Route peer RPC to LAN WebSocket, SSH local-forward, or mesh CLIENT_PROXY.
 *
 * Collab handlers pass `hostHints` / `originWs` as the `url`. Off-LAN hints
 * (`ssh:…`, `/p2p/…`) are resolved here so callers stay transport-agnostic.
 */

import {
  CLIENT_PROXY_PROTOCOL,
  callMeshHostRpc,
  type MeshStreamDial,
} from "@envoydev/host-bridge";

import { callPeerDaemon, type PeerRpcCall, type PeerRpcOutcome, type PeerWsConnect } from "./peer-rpc.js";
import { extractWsFromMeshHint } from "./member-dial.js";
import { openSshMemberTunnel, parseSshMemberHint } from "./ssh-member-tunnel.js";

export type MemberPeerCall = <T = unknown>(call: PeerRpcCall) => Promise<PeerRpcOutcome<T>>;

function teamTokenFromParams(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const row = params as Record<string, unknown>;
  if (typeof row.teamToken === "string" && row.teamToken.length > 0) return row.teamToken;
  // Heartbeats use `token` rather than `teamToken`.
  if (typeof row.token === "string" && row.token.length > 0) return row.token;
  return undefined;
}

function meshMultiaddrOf(hint: string): string | undefined {
  const trimmed = hint.trim();
  if (trimmed.startsWith("mesh:") && !trimmed.startsWith("mesh:ws")) {
    const rest = trimmed.slice(5);
    if (rest.includes("/p2p/")) return rest;
  }
  if (trimmed.includes("/p2p/") && !extractWsFromMeshHint(trimmed)) {
    return trimmed.startsWith("mesh:") ? trimmed.slice(5) : trimmed;
  }
  return undefined;
}

/**
 * Build a peer caller that opens SSH tunnels and mesh streams when the hint demands it.
 */
export function createMemberPeerCall(options: {
  connect?: PeerWsConnect;
  meshDial?: MeshStreamDial;
  /** Prefer this token when params omit one (rare). */
  defaultMeshToken?: () => Promise<string | undefined>;
  openSsh?: typeof openSshMemberTunnel;
}): MemberPeerCall {
  const openSsh = options.openSsh ?? openSshMemberTunnel;

  return async function memberPeerCall<T = unknown>(call: PeerRpcCall): Promise<PeerRpcOutcome<T>> {
    const hint = call.url.trim();

    if (parseSshMemberHint(hint)) {
      try {
        const tunnel = await openSsh(hint);
        return callPeerDaemon<T>(
          { ...call, url: tunnel.localWsUrl },
          options.connect ? { connect: options.connect } : {},
        );
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : `SSH tunnel failed: ${String(error)}`,
        };
      }
    }

    const multiaddr = meshMultiaddrOf(hint);
    if (multiaddr) {
      if (!options.meshDial) {
        return { ok: false, message: "Mesh dial is not available on this daemon." };
      }
      const token =
        teamTokenFromParams(call.params) ?? (await options.defaultMeshToken?.());
      if (!token) {
        return { ok: false, message: "Mesh member RPC needs a team token." };
      }
      return callMeshHostRpc<T>({
        multiaddr,
        protocol: CLIENT_PROXY_PROTOCOL,
        dial: options.meshDial,
        token,
        method: call.method,
        params: call.params,
        timeoutMs: call.timeoutMs,
      });
    }

    // Mesh hints that embed a WS hop were already extractable as ws:// — dial as LAN.
    const embedded = extractWsFromMeshHint(hint);
    if (embedded) {
      return callPeerDaemon<T>(
        { ...call, url: embedded },
        options.connect ? { connect: options.connect } : {},
      );
    }

    return callPeerDaemon<T>(call, options.connect ? { connect: options.connect } : {});
  };
}
