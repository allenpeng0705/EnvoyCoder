/**
 * Walk the family's candidate ladder for a paired home and open the first reachable rung.
 *
 * SSH local-forward (when configured for a loopback daemon) stays an alternate transport for the
 * home's own address — same story as the phone — and is tried before the network ladder.
 */

import type { DaemonEndpoint, WebSocketLike } from "../client/connection.js";
import {
  isRelayTargetUrl,
  openClientProxySocket,
  relayBaseFromCandidateUrl,
  type SocketFactory,
} from "./client-proxy-socket.js";
import type { HomeRemoteCandidate } from "./candidate-resolver.js";
import { candidatesFor, directWsUrl } from "./home-route-plan.js";
import {
  isLoopbackHost,
  type HomeSshForwardOpener,
} from "./home-ssh-forward.js";
import type { PairedHomeRecord } from "./paired-homes.js";

export type HomeDialProbe = (url: string, timeoutMs: number) => Promise<boolean>;

export interface HomeDialResult {
  endpoint: DaemonEndpoint;
  /** Family candidate name (`lan`, `relay`, `community-relay`, …) or `ssh`. */
  route: string;
  /**
   * Open (and re-open on reconnect) the winning transport. Ignores the URL CoderConnection would
   * build — the ladder already chose the address, including relay `?target=` and framing.
   */
  openSocket: () => WebSocketLike;
  /** Ordered names that were considered (for tests / diagnostics). */
  tried: readonly string[];
}

function endpointFromWsUrl(url: string): DaemonEndpoint | undefined {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === "wss:"
        ? 443
        : 80;
    if (!host || !Number.isFinite(port)) return undefined;
    const path = `${parsed.pathname || "/ws"}${parsed.search}`;
    return { host, port, path };
  } catch {
    return undefined;
  }
}

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

function defaultSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

function openDirectSocket(url: string, factory: SocketFactory): WebSocketLike {
  // Token is already on the candidate URL when present.
  return factory(url);
}

function openRelaySocket(candidate: HomeRemoteCandidate, factory: SocketFactory): WebSocketLike {
  const peerId = candidate.homePeerId?.trim();
  const token = candidate.sessionToken?.trim() ?? "";
  if (!peerId) {
    // Token-only relay fallback — rare for EnvoyDev (we require peer id).
    return factory(candidate.url);
  }
  return openClientProxySocket(
    {
      relayWsUrl: relayBaseFromCandidateUrl(candidate.url),
      homePeerId: peerId,
      sessionToken: token,
    },
    factory,
  );
}

/**
 * Dial a paired home: SSH (when loopback + hop) else family ladder.
 *
 * Libp2p multiaddr candidates are skipped (no window transport yet) — the walk continues to
 * bootstrap / relay. Inject `probe` / `socketFactory` in tests.
 */
export async function dialPairedHome(
  record: PairedHomeRecord,
  options: {
    openSshForward?: HomeSshForwardOpener;
    probe?: HomeDialProbe;
    socketFactory?: SocketFactory;
    timeoutMs?: number;
  } = {},
): Promise<HomeDialResult> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const probe = options.probe ?? defaultWsProbe;
  const factory = options.socketFactory ?? defaultSocketFactory;
  const tried: string[] = [];

  if (record.sshHop && isLoopbackHost(record.host) && options.openSshForward) {
    tried.push("ssh");
    const local = await options.openSshForward(record.sshHop, record.port, record.path);
    const localUrl = `ws://${local.host}:${local.port}${local.path.startsWith("/") ? local.path : `/${local.path}`}`;
    const token = record.token.trim();
    const withToken = token
      ? `${localUrl}${localUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : localUrl;
    const ok = await probe(withToken, timeoutMs);
    if (ok) {
      return {
        endpoint: { host: local.host, port: local.port, path: local.path },
        route: "ssh",
        tried,
        openSocket: () => openDirectSocket(withToken, factory),
      };
    }
  }

  const ladder = candidatesFor(record);
  for (const candidate of ladder) {
    tried.push(candidate.name);

    if (candidate.libp2pRelayAddr || candidate.url.startsWith("/")) {
      // Window has no libp2p dial yet — skip, continue to WS rungs (relay last).
      continue;
    }

    if (!candidate.url.startsWith("ws://") && !candidate.url.startsWith("wss://")) {
      continue;
    }

    if (isRelayTargetUrl(candidate.url) && candidate.homePeerId?.trim()) {
      // Proxy handshake needs the home to accept through the relay — longer than a LAN TCP probe.
      const relayTimeout = Math.max(timeoutMs, 8_000);
      const opened = await probeClientProxy(candidate, factory, relayTimeout);
      if (!opened) continue;
      const endpoint = endpointFromWsUrl(candidate.url);
      if (!endpoint) continue;
      return {
        endpoint,
        route: candidate.name,
        tried,
        openSocket: () => openRelaySocket(candidate, factory),
      };
    }

    const ok = await probe(candidate.url, timeoutMs);
    if (!ok) continue;
    const endpoint = endpointFromWsUrl(candidate.url);
    if (!endpoint) continue;
    // Strip token from path for the endpoint display; openSocket keeps the full URL.
    const pathOnly = endpoint.path.includes("?")
      ? endpoint.path.slice(0, endpoint.path.indexOf("?"))
      : endpoint.path;
    return {
      endpoint: { host: endpoint.host, port: endpoint.port, path: pathOnly || "/ws" },
      route: candidate.name,
      tried,
      openSocket: () => openDirectSocket(candidate.url, factory),
    };
  }

  // Nothing answered — fall back to the stored host:port so CoderConnection still dials something
  // and surfaces the usual unreachable state (same as today's single-shot dial).
  const fallbackUrl = (() => {
    const base = record.lanWsUrl?.trim() || record.wsUrl?.trim() || directWsUrl(record);
    const token = record.token.trim();
    if (!token) return base;
    if (base.includes("token=")) return base;
    return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  })();
  const endpoint = endpointFromWsUrl(fallbackUrl) ?? {
    host: record.host,
    port: record.port,
    path: record.path,
  };
  return {
    endpoint: {
      host: endpoint.host,
      port: endpoint.port,
      path: endpoint.path.includes("?")
        ? endpoint.path.slice(0, endpoint.path.indexOf("?"))
        : endpoint.path,
    },
    route: "direct-fallback",
    tried,
    openSocket: () => openDirectSocket(fallbackUrl, factory),
  };
}

function probeClientProxy(
  candidate: HomeRemoteCandidate,
  factory: SocketFactory,
  timeoutMs: number,
): Promise<boolean> {
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
    let socket: WebSocketLike;
    try {
      socket = openRelaySocket(candidate, factory);
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
