/**
 * Family candidate mapping for paired homes — order and field placement.
 */

import { describe, expect, it } from "vitest";

import { candidatesFor } from "../src/state/home-route-plan.js";
import type { PairedHomeRecord } from "../src/state/paired-homes.js";

const home = "12D3KooWhome";
const directAddr = `/ip4/192.168.1.9/tcp/4001/p2p/${home}`;

function record(partial: Partial<PairedHomeRecord> = {}): PairedHomeRecord {
  return {
    id: "h1",
    label: "desk",
    host: "192.168.1.9",
    port: 4770,
    path: "/ws",
    token: "tok",
    addedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("candidatesFor (paired-home route plan)", () => {
  it("walks family order with relay last", () => {
    const names = candidatesFor(
      record({
        lanWsUrl: "ws://192.168.1.9:4770/ws",
        homeNodePeerId: home,
        bootstrapPeers: [directAddr, "ws://relay-b.example/ws"],
        relayWsUrl: "wss://relay.example/ws",
        relayWsUrls: ["wss://relay-c.example/ws"],
      }),
    ).map((c) => c.name);

    expect(names).toEqual([
      "lan",
      "p2p-direct",
      "p2p-cn-relay",
      "relay",
      "relay-1",
      "relay-2",
      "community-relay",
      "community-relay-us",
    ]);
  });
  it("puts the primary address on the LAN rung when lanWsUrl is absent", () => {
    const first = candidatesFor(record()).at(0);
    expect(first?.name).toBe("lan");
    expect(first?.url).toBe("ws://192.168.1.9:4770/ws?token=tok");
  });

  it("does not offer community-relay without peer id and addresses", () => {
    const names = candidatesFor(record({ homeNodePeerId: home, bootstrapPeers: [] })).map(
      (c) => c.name,
    );
    expect(names.some((n) => n.startsWith("p2p-"))).toBe(false);
    expect(names).not.toContain("community-relay");
  });

  it("does not leak one home's peer id into the next resolve", () => {
    candidatesFor(
      record({ homeNodePeerId: home, bootstrapPeers: [directAddr] }),
    );
    const other = candidatesFor(record({ host: "10.0.0.5", id: "h2" })).filter(
      (c) => c.name === "community-relay",
    );
    expect(other).toEqual([]);
  });

  it("keeps a single token= on each WebSocket candidate", () => {
    const candidates = candidatesFor(
      record({
        lanWsUrl: "ws://192.168.1.9:4770/ws",
        relayWsUrl: "wss://relay.example/ws",
      }),
    );
    for (const candidate of candidates.filter((c) => c.url.startsWith("ws"))) {
      expect(candidate.url.match(/token=/g)?.length ?? 0).toBe(1);
    }
  });
});
