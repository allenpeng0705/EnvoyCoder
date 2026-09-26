/**
 * Member channel dial — LAN first, then mesh, then SSH (`docs/envoydev-networking.md` §6).
 *
 * UI never chooses the transport. Agents never dial. Only EnvoyDev ↔ EnvoyDev.
 * Loopback (`local` / empty hints) skips the network and reports online · lan.
 */

import type { ConnectionDetail, ConnectionTransport } from "@envoydev/protocol";

import { openSshMemberTunnel, parseSshMemberHint } from "./ssh-member-tunnel.js";

export type MemberDialTransport = "lan" | "mesh" | "ssh" | "none";

export function preferMemberTransport(hints?: string): MemberDialTransport {
  if (hints?.startsWith("ws://") || hints?.startsWith("http://") || hints?.startsWith("wss://")) return "lan";
  if (hints?.includes("/p2p/") || hints?.startsWith("mesh:")) return "mesh";
  if (hints?.startsWith("ssh:")) return "ssh";
  return "lan";
}

export interface MemberDialTarget {
  memberId: string;
  hostHints?: string;
}

export interface MemberDialResult {
  connection: ConnectionDetail;
  /** True when a usable channel is ready for offers. */
  reachable: boolean;
  /** Ordered attempts that were considered. */
  tried: readonly MemberDialTransport[];
}

const DIAL_ORDER: readonly MemberDialTransport[] = ["lan", "mesh", "ssh"];

/**
 * Prefer order for a member: start from the hint's preferred transport, then try the rest
 * of LAN → mesh → ssh (never invent a transport the hint forbids when explicit).
 */
export function dialOrderFor(hints?: string): readonly MemberDialTransport[] {
  const preferred = preferMemberTransport(hints);
  if (preferred === "none") return ["lan", "mesh"];
  const rest = DIAL_ORDER.filter((t) => t !== preferred);
  return [preferred, ...rest];
}

function endpointFromHints(hints: string | undefined, transport: MemberDialTransport): string | undefined {
  if (!hints) return undefined;
  if (transport === "lan" && (hints.startsWith("ws://") || hints.startsWith("http://") || hints.startsWith("wss://"))) {
    return hints.replace(/^http/, "ws");
  }
  if (transport === "mesh") {
    // Prefer an embedded WebSocket URL when the mesh hint carries one (mesh:ws://… or multiaddr /ws).
    const extracted = extractWsFromMeshHint(hints);
    if (extracted) return extracted;
    if (hints.startsWith("mesh:")) return hints.slice(5);
    if (hints.includes("/p2p/")) return hints;
  }
  if (transport === "ssh" && hints.startsWith("ssh:")) {
    return hints.slice(4);
  }
  return undefined;
}

/**
 * Pull a dialable `ws://` / `wss://` URL out of a mesh hint when present.
 *
 * Pure `/p2p/…` multiaddrs without a WS layer are probed via `meshProbe` when the
 * daemon's mesh peer is hosting. Hints that embed a WS hop become reachable via
 * the same probe as LAN.
 */
export function extractWsFromMeshHint(hints: string): string | undefined {
  const trimmed = hints.trim();
  if (trimmed.startsWith("mesh:ws://") || trimmed.startsWith("mesh:wss://")) {
    return trimmed.slice("mesh:".length);
  }
  const direct = /(?:^|[^\w])(wss?:\/\/[^\s,/]+(?::\d+)?(?:\/[^\s]*)?)/.exec(trimmed);
  if (direct?.[1]) return direct[1].replace(/[,;].*$/, "");
  // Multiaddr fragments: /dns4/host/tcp/443/wss or /ip4/…/tcp/…/ws
  const wss = /\/(?:dns4|dns6|ip4|ip6)\/([^/]+)\/tcp\/(\d+)\/wss(?:\/|$)/.exec(trimmed);
  if (wss) return `wss://${wss[1]}:${wss[2]}/ws`;
  const ws = /\/(?:dns4|dns6|ip4|ip6)\/([^/]+)\/tcp\/(\d+)\/ws(?:\/|$)/.exec(trimmed);
  if (ws) return `ws://${ws[1]}:${ws[2]}/ws`;
  return undefined;
}

/**
 * Probe whether a LAN WebSocket endpoint accepts a TCP/WS handshake.
 * Injected in tests; production uses a short-lived WebSocket.
 */
export type WsProbe = (url: string, timeoutMs: number) => Promise<boolean>;

/**
 * Probe a pure `/p2p/` multiaddr (EnvoyMesh stream). Injected from serve when the
 * mesh peer is hosting. When `authToken` is provided, the probe should authenticate
 * (team token) so "online" is not a false positive before the first RPC.
 */
export type MeshProbe = (
  multiaddr: string,
  timeoutMs: number,
  authToken?: string,
) => Promise<boolean>;

/** Open an SSH local-forward and return the local ws URL. */
export type SshTunnelOpener = (hints: string) => Promise<{ localWsUrl: string }>;

async function defaultWsProbe(url: string, timeoutMs: number): Promise<boolean> {
  const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WS) return false;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    let socket: InstanceType<typeof WS>;
    try {
      socket = new WS(url);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      if (!settled) finish(false);
    });
  });
}

let defaultMeshProbe: MeshProbe | undefined;
let defaultSshOpener: SshTunnelOpener | undefined;

/**
 * Wire production dial seams from the daemon (`serve.ts`). Tests inject per-call instead.
 */
export function configureMemberDial(options: {
  meshProbe?: MeshProbe | null;
  openSshTunnel?: SshTunnelOpener | null;
}): void {
  defaultMeshProbe = options.meshProbe === null ? undefined : options.meshProbe ?? defaultMeshProbe;
  defaultSshOpener =
    options.openSshTunnel === null ? undefined : options.openSshTunnel ?? defaultSshOpener;
}

/**
 * Dial a team member's EnvoyDev. Local members are always reachable without a network hop.
 */
export async function dialMember(
  target: MemberDialTarget,
  options: {
    now?: () => Date;
    probe?: WsProbe;
    meshProbe?: MeshProbe;
    openSshTunnel?: SshTunnelOpener;
    /** Team token for authenticated mesh probe (assign-time). */
    meshAuthToken?: string;
    timeoutMs?: number;
  } = {},
): Promise<MemberDialResult> {
  const now = options.now ?? (() => new Date());
  const at = now().toISOString();
  const timeoutMs = options.timeoutMs ?? 2_000;
  const probe = options.probe ?? defaultWsProbe;
  const meshProbe = options.meshProbe ?? defaultMeshProbe;
  const openSsh = options.openSshTunnel ?? defaultSshOpener ?? ((h: string) => openSshMemberTunnel(h));
  const meshAuthToken = options.meshAuthToken;

  if (target.memberId === "local" || !target.hostHints) {
    return {
      reachable: true,
      tried: ["lan"],
      connection: {
        status: "online",
        transport: "lan",
        connectedAt: at,
        lastHeartbeatAt: at,
      },
    };
  }

  const order = dialOrderFor(target.hostHints);
  let lastError: string | undefined;

  for (const transport of order) {
    const endpoint = endpointFromHints(target.hostHints, transport);
    if (!endpoint) {
      lastError = `no-endpoint-for-${transport}`;
      continue;
    }

    if (transport === "lan") {
      const ok = await probe(endpoint, timeoutMs);
      if (ok) {
        return {
          reachable: true,
          tried: order,
          connection: {
            status: "online",
            transport: "lan",
            endpoint,
            connectedAt: at,
            lastHeartbeatAt: at,
          },
        };
      }
      lastError = `envoydev.daemon-unreachable:${transport}`;
      continue;
    }

    if (transport === "mesh") {
      const isWs = endpoint.startsWith("ws://") || endpoint.startsWith("wss://");
      if (isWs) {
        const ok = await probe(endpoint, timeoutMs);
        if (ok) {
          return {
            reachable: true,
            tried: order,
            connection: {
              status: "online",
              transport: "mesh",
              endpoint,
              connectedAt: at,
              lastHeartbeatAt: at,
            },
          };
        }
        lastError = "envoydev.daemon-unreachable:mesh";
        continue;
      }

      // Pure /p2p/ multiaddr — needs the mesh peer.
      if (meshProbe) {
        const ok = await meshProbe(endpoint, timeoutMs, meshAuthToken);
        if (ok) {
          return {
            reachable: true,
            tried: order,
            connection: {
              status: "online",
              transport: "mesh" as ConnectionTransport,
              endpoint,
              connectedAt: at,
              lastHeartbeatAt: at,
            },
          };
        }
        lastError = "envoydev.daemon-unreachable:mesh";
        continue;
      }

      return {
        reachable: false,
        tried: order,
        connection: {
          status: "connecting",
          transport: "mesh",
          endpoint,
          lastDialError: "mesh-dial-pending",
        },
      };
    }

    if (transport === "ssh") {
      if (!parseSshMemberHint(target.hostHints)) {
        lastError = "no-endpoint-for-ssh";
        continue;
      }
      try {
        const tunnel = await openSsh(target.hostHints);
        const ok = await probe(tunnel.localWsUrl, timeoutMs);
        if (ok) {
          return {
            reachable: true,
            tried: order,
            connection: {
              status: "online",
              transport: "ssh",
              // Keep the ssh: hint as the durable endpoint; peer-call reopens the tunnel.
              endpoint: target.hostHints,
              connectedAt: at,
              lastHeartbeatAt: at,
            },
          };
        }
        lastError = "envoydev.daemon-unreachable:ssh";
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : `ssh-tunnel-failed:${String(error)}`;
      }
      continue;
    }
  }

  return {
    reachable: false,
    tried: order,
    connection: {
      status: "offline",
      transport: "none",
      lastDialError: lastError ?? "envoydev.daemon-unreachable",
    },
  };
}
