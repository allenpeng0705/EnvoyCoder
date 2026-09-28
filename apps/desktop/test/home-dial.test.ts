/**
 * Paired-home dial walk — LAN first, skip libp2p, relay when direct fails.
 */

import { describe, expect, it } from "vitest";

import { dialPairedHome } from "../src/state/home-dial.js";
import type { PairedHomeRecord } from "../src/state/paired-homes.js";
import type { WebSocketLike } from "../src/client/connection.js";

const homePeer = "12D3KooWhome";
const directAddr = `/ip4/192.168.1.9/tcp/4001/p2p/${homePeer}`;

function record(partial: Partial<PairedHomeRecord> = {}): PairedHomeRecord {
  return {
    id: "h1",
    label: "desk",
    host: "192.168.1.9",
    port: 4770,
    path: "/ws",
    token: "tok",
    addedAt: "2026-01-01T00:00:00.000Z",
    lanWsUrl: "ws://192.168.1.9:4770/ws",
    homeNodePeerId: homePeer,
    bootstrapPeers: [directAddr],
    ...partial,
  };
}

function fakeSocket(handlers: {
  onOpen?: () => void;
  fail?: boolean;
}): WebSocketLike {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const socket: WebSocketLike = {
    readyState: 0,
    send() {},
    close() {
      socket.readyState = 3;
    },
    addEventListener(type, listener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
  };
  queueMicrotask(() => {
    if (handlers.fail) {
      for (const l of listeners.get("error") ?? []) l({});
      for (const l of listeners.get("close") ?? []) l({});
      return;
    }
    socket.readyState = 1;
    for (const l of listeners.get("open") ?? []) l({});
    handlers.onOpen?.();
  });
  return socket;
}

describe("dialPairedHome", () => {
  it("prefers the LAN WebSocket when it probes open", async () => {
    const result = await dialPairedHome(record(), {
      timeoutMs: 200,
      probe: async (url) => url.includes("192.168.1.9"),
      socketFactory: () => fakeSocket({}),
    });
    expect(result.route).toBe("lan");
    expect(result.endpoint.host).toBe("192.168.1.9");
    expect(result.tried[0]).toBe("lan");
  });

  it("skips libp2p multiaddrs and continues to community-relay", async () => {
    const probed: string[] = [];
    const result = await dialPairedHome(record(), {
      timeoutMs: 200,
      probe: async (url) => {
        probed.push(url);
        return false;
      },
      socketFactory: (url) => {
        // Client-proxy probe opens a socket; accept community-relay only.
        if (url.includes("47.93.11.212") && url.includes("target=")) {
          const socket = fakeSocket({});
          // Simulate proxy-accept after open for the client-proxy wrapper path —
          // openClientProxySocket sends proxy-connect; our fake ignores that and fires open
          // immediately, which the probe treats as success only after proxy handshake.
          // For this unit test we short-circuit: dialPairedHome's probeClientProxy waits for
          // the *wrapper* open, which fires after proxy-accept. Drive that by having the raw
          // socket echo proxy-accept on first send.
          const rawListeners = new Map<string, Set<(e: unknown) => void>>();
          const raw: WebSocketLike = {
            readyState: 0,
            send(data: string) {
              if (data.includes("proxy-connect")) {
                queueMicrotask(() => {
                  for (const l of rawListeners.get("message") ?? []) {
                    l({ data: JSON.stringify({ type: "proxy-accept" }) });
                  }
                });
              }
            },
            close() {
              raw.readyState = 3;
            },
            addEventListener(type, listener) {
              let set = rawListeners.get(type);
              if (!set) {
                set = new Set();
                rawListeners.set(type, set);
              }
              set.add(listener);
              if (type === "open") {
                queueMicrotask(() => {
                  raw.readyState = 1;
                  listener({});
                });
              }
            },
          };
          return raw;
        }
        return fakeSocket({ fail: true });
      },
    });

    expect(result.tried).toContain("p2p-direct");
    expect(result.tried).toContain("p2p-cn-relay");
    expect(result.route).toBe("community-relay");
    expect(probed.every((u) => !u.startsWith("/"))).toBe(true);
  });

  it("falls back to the stored host when every probe fails", async () => {
    const result = await dialPairedHome(record({ bootstrapPeers: undefined, homeNodePeerId: undefined }), {
      timeoutMs: 50,
      probe: async () => false,
      socketFactory: () => fakeSocket({ fail: true }),
    });
    expect(result.route).toBe("direct-fallback");
    expect(result.endpoint.host).toBe("192.168.1.9");
  });

  it("skips a loopback lanWsUrl on exhausted-ladder fallback", async () => {
    const result = await dialPairedHome(
      record({
        lanWsUrl: "ws://127.0.0.1:4770/ws",
        wsUrl: "ws://192.168.1.9:4770/ws",
        bootstrapPeers: undefined,
        homeNodePeerId: undefined,
      }),
      {
        timeoutMs: 50,
        probe: async () => false,
        socketFactory: () => fakeSocket({ fail: true }),
      },
    );
    expect(result.route).toBe("direct-fallback");
    expect(result.endpoint.host).toBe("192.168.1.9");
  });
});
