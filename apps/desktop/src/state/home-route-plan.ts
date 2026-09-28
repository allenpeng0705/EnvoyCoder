/**
 * Map a paired-home record onto the family's candidate walk.
 *
 * Same job as the phone's `route_plan.dart`: no ordering here — `CandidateResolver` owns that.
 * This file only decides which pairing fields fill which StoredHomeNode slots.
 */

import {
  CandidateResolver,
  type HomeRemoteCandidate,
  type StoredHomeNode,
} from "./candidate-resolver.js";
import { isLoopbackHost } from "./home-ssh-forward.js";
import type { PairedHomeRecord } from "./paired-homes.js";

/** Build `ws(s)://host:port/path` from the record's primary endpoint. */
export function directWsUrl(record: Pick<PairedHomeRecord, "host" | "port" | "path">): string {
  const path = record.path.startsWith("/") ? record.path : `/${record.path}`;
  return `ws://${record.host}:${record.port}${path}`;
}

/**
 * Peer id only when the payload also named an address — same rule as the phone.
 * A bare peer id would dial shared community infrastructure with nothing to route to.
 */
function dialablePeerId(record: PairedHomeRecord): string {
  const id = record.homeNodePeerId?.trim() ?? "";
  if (!id) return "";
  const addrs = record.bootstrapPeers ?? [];
  if (addrs.length === 0) return "";
  return id;
}

function peerListFor(record: PairedHomeRecord): string[] {
  const seen = new Set<string>();
  const peers: string[] = [];
  for (const entry of [...(record.bootstrapPeers ?? []), ...(record.relayWsUrls ?? [])]) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    peers.push(trimmed);
  }
  return peers;
}

export function storedNodeFor(record: PairedHomeRecord): StoredHomeNode {
  // Prefer an explicit non-loopback LAN URL; else primary / host:port. Never invent a publicHost —
  // the family's public builder hardcodes `ws://` and would downgrade `wss://`.
  const lanIp = pickDirectWsUrl(record);
  return {
    id: record.id,
    name: record.label,
    ownerId: record.id,
    homePeerId: dialablePeerId(record),
    lanIp,
    relayWsUrl: record.relayWsUrl,
    bootstrapPeers: peerListFor(record),
  };
}

/** Prefer lan / ws / host:port, skipping loopback so dial never sticks on this laptop. */
export function pickDirectWsUrl(record: PairedHomeRecord): string {
  const candidates = [record.lanWsUrl, record.wsUrl, directWsUrl(record)];
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    try {
      const host = new URL(trimmed).hostname;
      if (!isLoopbackHost(host)) return trimmed;
    } catch {
      /* try next */
    }
  }
  return directWsUrl(record);
}

/**
 * Ordered candidates for this home, family priority, with family names.
 *
 * `communityRelayRequiresPeerId: true` matches the phone: no peer id → no community-relay rung.
 */
export function candidatesFor(
  record: PairedHomeRecord,
  options: { token?: string; isOnWifi?: boolean } = {},
): HomeRemoteCandidate[] {
  const node = storedNodeFor(record);
  const peerId = node.homePeerId.trim();
  CandidateResolver.setCommunityHomePeerId(peerId.length === 0 ? null : peerId);
  const resolver = new CandidateResolver(true);
  return resolver.resolve(node, {
    sessionToken: options.token ?? record.token,
    isOnWifi: options.isOnWifi ?? false,
  });
}
