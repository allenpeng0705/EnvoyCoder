/**
 * Relay WebSocket transport — client-proxy handshake + newline-framed outbound RPC.
 *
 * Twin of `envoy_thin_client`'s `ClientProxyTransport`. The family has no shared TypeScript client
 * yet; this is the minimum the desktop window needs to walk the relay rung the same way the phone
 * does. After `proxy-accept`, JSON-RPC rides the socket like a direct daemon connection, except
 * outbound frames must end with `\n` (the home's mesh host splits on that delimiter).
 */

import type { WebSocketLike } from "../client/connection.js";

const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;

export type SocketFactory = (url: string) => WebSocketLike;

/**
 * Open a client-proxy session to `homePeerId` through `relayWsUrl`.
 *
 * Fires the returned socket's `open` only after `proxy-accept` (or a home-tunnel `connected`), so
 * `CoderConnection` can treat it like any other WebSocket.
 */
export function openClientProxySocket(
  input: {
    relayWsUrl: string;
    homePeerId: string;
    sessionToken: string;
    handshakeTimeoutMs?: number;
  },
  socketFactory?: SocketFactory,
): WebSocketLike {
  const timeoutMs = input.handshakeTimeoutMs ?? 20_000;
  const baseUrl = input.relayWsUrl.includes("?")
    ? input.relayWsUrl.slice(0, input.relayWsUrl.indexOf("?"))
    : input.relayWsUrl;
  const encodedPeerId = encodeURIComponent(input.homePeerId);
  const url = input.sessionToken
    ? `${baseUrl}?target=${encodedPeerId}&token=${encodeURIComponent(input.sessionToken)}`
    : `${baseUrl}?target=${encodedPeerId}`;

  const factory =
    socketFactory ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
  const raw = factory(url);

  const listeners = {
    open: new Set<(event: unknown) => void>(),
    message: new Set<(event: unknown) => void>(),
    close: new Set<(event: unknown) => void>(),
    error: new Set<(event: unknown) => void>(),
  };

  let readyState = CONNECTING;
  let handshakeDone = false;
  let settled = false;

  const finishReject = () => {
    if (settled) return;
    settled = true;
    readyState = CLOSED;
    try {
      raw.close();
    } catch {
      /* ignore */
    }
    for (const listener of listeners.error) listener({});
    for (const listener of listeners.close) listener({});
  };

  const timer = setTimeout(finishReject, timeoutMs);

  const proxy: WebSocketLike = {
    get readyState() {
      return readyState;
    },
    send(data: string) {
      if (readyState !== OPEN) return;
      // Frame delimiter: home mesh transport splits on `\n`; bare JSON hangs forever.
      const framed = data.endsWith("\n") ? data : `${data}\n`;
      raw.send(framed);
    },
    close() {
      readyState = CLOSED;
      clearTimeout(timer);
      raw.close();
    },
    addEventListener(type: string, listener: (event: unknown) => void) {
      const set = listeners[type as keyof typeof listeners];
      if (set) set.add(listener);
    },
  };

  raw.addEventListener("open", () => {
    try {
      raw.send(`${JSON.stringify({ type: "proxy-connect", token: input.sessionToken })}\n`);
    } catch {
      finishReject();
    }
  });

  raw.addEventListener("message", (event) => {
    const text = String((event as { data?: unknown } | undefined)?.data ?? "");
    if (!handshakeDone) {
      try {
        const msg = JSON.parse(text) as { type?: string; event?: string; reason?: string };
        if (msg.type === "proxy-reject") {
          finishReject();
          return;
        }
        if (
          msg.type === "proxy-accept" ||
          msg.event === "connected" ||
          msg.event === "tunnel-up"
        ) {
          handshakeDone = true;
          settled = true;
          clearTimeout(timer);
          readyState = OPEN;
          for (const listener of listeners.open) listener({});
          return;
        }
      } catch {
        /* ignore non-JSON during handshake */
      }
      return;
    }
    for (const listener of listeners.message) listener(event);
  });

  raw.addEventListener("error", () => {
    if (!handshakeDone) finishReject();
    else for (const listener of listeners.error) listener({});
  });

  raw.addEventListener("close", () => {
    clearTimeout(timer);
    readyState = CLOSED;
    if (!handshakeDone && !settled) {
      settled = true;
      for (const listener of listeners.error) listener({});
    }
    for (const listener of listeners.close) listener({});
  });

  return proxy;
}

/** Whether this candidate URL is a peer-routed relay (`?target=`). */
export function isRelayTargetUrl(url: string): boolean {
  return /[?&]target=/.test(url);
}

/** Strip query from a candidate URL to get the relay base. */
export function relayBaseFromCandidateUrl(url: string): string {
  const q = url.indexOf("?");
  return q < 0 ? url : url.slice(0, q);
}
