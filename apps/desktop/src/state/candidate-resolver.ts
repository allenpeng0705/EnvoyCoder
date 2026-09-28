/**
 * Family dial candidates — LAN → public → P2P → bootstrap → relay last.
 *
 * Port of `envoy_thin_client`'s `CandidateResolver` (Dart). There is no shared TypeScript twin in
 * EnvoyMesh yet; this keeps the same order and naming so a phone and a laptop walk the same ladder
 * from the same pairing fields. Pure libp2p multiaddrs are still emitted (`p2p-*`); the dialer skips
 * them until the window has a libp2p transport.
 *
 * Normative order: `apps/mobile/README.md` and the family's CandidateResolver.
 */

export interface StoredHomeNode {
  id: string;
  name: string;
  ownerId: string;
  /** Home peer id, or "" when the dialer must not offer peer-routed rungs. */
  homePeerId: string;
  /** Direct daemon address — full `ws(s)://…` or host(/path). Family LAN slot. */
  lanIp?: string;
  publicHost?: string;
  publicPort?: number;
  relayWsUrl?: string;
  bootstrapPeers: string[];
}

export interface HomeRemoteCandidate {
  name: string;
  url: string;
  homePeerId?: string | null;
  sessionToken?: string | null;
  /** When set, this rung is a libp2p dial (multiaddr), not a WebSocket. */
  libp2pRelayAddr?: string;
}

const COMMUNITY_RELAY_HOST = "47.93.11.212";
const COMMUNITY_RELAY_WS_PORT = 15432;
const COMMUNITY_RELAY_LIBP2P =
  "/ip4/47.93.11.212/tcp/4001/p2p/12D3KooWLNR4WYWHBswe8ux5zWsy6cuGywnYPJbdbaAbbpmJMjbo";

let communityHomePeerId: string | null | undefined;

export class CandidateResolver {
  constructor(readonly communityRelayRequiresPeerId = false) {}

  static setCommunityHomePeerId(peerId: string | null | undefined): void {
    communityHomePeerId = peerId;
  }

  static resolveBootstrapPresets(presets: string[]): string[] {
    const result: string[] = [];
    for (const preset of presets) {
      switch (preset) {
        case "public-libp2p-am6":
          result.push(
            "/dnsaddr/am6.bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6LccNBoMmrjUqFq",
          );
          break;
        case "public-libp2p-am7":
          result.push(
            "/dnsaddr/am7.bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA7W8R4Hk6x4pJ8Yf",
          );
          break;
        case "public-libp2p":
          result.push(
            "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
            "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
            "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6LccNBoMmrjUqFq",
            "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA7W8R4Hk6x4pJ8Yf",
          );
          break;
        case "cn-relay":
          result.push(COMMUNITY_RELAY_LIBP2P);
          break;
        default:
          break;
      }
    }
    return result;
  }

  resolve(
    node: StoredHomeNode,
    options: { sessionToken?: string; isOnWifi?: boolean } = {},
  ): HomeRemoteCandidate[] {
    const token = options.sessionToken;
    const p2pCap = options.isOnWifi ? 3 : 2;
    return [
      ...this.buildLanCandidates(node, token),
      ...this.buildPublicCandidates(node, token),
      ...this.limitLibp2p(this.buildLibp2pCandidates(node, token), p2pCap),
      ...this.buildBootstrapPeerCandidates(node, token),
      ...this.buildRelayWsCandidates(node, token),
    ];
  }

  private buildLanCandidates(node: StoredHomeNode, sessionToken?: string): HomeRemoteCandidate[] {
    if (!node.lanIp?.trim()) return [];
    let url = node.lanIp.trim();
    const hasScheme = url.startsWith("ws://") || url.startsWith("wss://");
    const hasPath = hasScheme ? url.includes("/", url.indexOf("://") + 3) : url.includes("/");
    if (!hasScheme) url = hasPath ? `ws://${url}` : `ws://${url}/ws`;
    else if (!hasPath) url = `${url}/ws`;
    if (sessionToken) url += `${url.includes("?") ? "&" : "?"}token=${sessionToken}`;
    return [{ name: "lan", url, homePeerId: null, sessionToken: null }];
  }

  private buildPublicCandidates(node: StoredHomeNode, sessionToken?: string): HomeRemoteCandidate[] {
    if (!node.publicHost?.trim()) return [];
    const port = node.publicPort ?? 80;
    let url = `ws://${node.publicHost}:${port}/ws`;
    if (sessionToken) url += `?token=${sessionToken}`;
    return [{ name: "public", url, homePeerId: null, sessionToken: null }];
  }

  private buildRelayWsCandidates(node: StoredHomeNode, sessionToken?: string): HomeRemoteCandidate[] {
    const result: HomeRemoteCandidate[] = [];
    const bases: string[] = [];
    const lanBase = stripTokenParam(node.lanIp ?? "");

    const addBase = (raw: string | undefined) => {
      if (!raw?.trim()) return;
      const base = stripTokenParam(raw.trim());
      if (!base || base.includes(COMMUNITY_RELAY_HOST)) return;
      if (lanBase && base === lanBase) return;
      if (!bases.includes(base)) bases.push(base);
    };

    addBase(node.relayWsUrl);
    for (const peer of node.bootstrapPeers) {
      if (peer.startsWith("/")) continue;
      addBase(peer);
    }

    const homePeerId = node.homePeerId.trim();
    for (let i = 0; i < bases.length; i++) {
      const relayBase = bases[i]!;
      let relayUrl = relayBase;
      if (homePeerId) {
        relayUrl = `${relayBase}?target=${homePeerId}`;
        if (sessionToken) relayUrl += `&token=${sessionToken}`;
      } else if (sessionToken) {
        relayUrl = `${relayBase}${relayBase.includes("?") ? "&" : "?"}token=${sessionToken}`;
      }
      result.push({
        name: i === 0 ? "relay" : `relay-${i}`,
        url: relayUrl,
        homePeerId,
        sessionToken,
      });
    }

    result.push(...this.buildCommunityRelayCandidates(sessionToken));
    return result;
  }

  private buildCommunityRelayCandidates(sessionToken?: string): HomeRemoteCandidate[] {
    if (
      this.communityRelayRequiresPeerId &&
      (communityHomePeerId == null || communityHomePeerId === "")
    ) {
      return [];
    }
    const wsUrl = `ws://${COMMUNITY_RELAY_HOST}:${COMMUNITY_RELAY_WS_PORT}/ws`;
    if (communityHomePeerId) {
      let url = `${wsUrl}?target=${communityHomePeerId}`;
      if (sessionToken) url += `&token=${sessionToken}`;
      return [
        {
          name: "community-relay",
          url,
          homePeerId: communityHomePeerId,
          sessionToken,
        },
      ];
    }
    let relayUrl = wsUrl;
    if (sessionToken) relayUrl += `?token=${sessionToken}`;
    return [
      {
        name: "community-relay",
        url: relayUrl,
        homePeerId: communityHomePeerId,
        sessionToken,
      },
    ];
  }

  private buildLibp2pCandidates(node: StoredHomeNode, sessionToken?: string): HomeRemoteCandidate[] {
    const homePeerId = node.homePeerId.trim();
    if (!homePeerId) return [];

    const result: HomeRemoteCandidate[] = [];
    const directAddrs: string[] = [];
    const advertisedCircuits = new Map<string, string>();
    const relayMultiaddrs = new Map<string, string>([["cn-relay", COMMUNITY_RELAY_LIBP2P]]);

    for (const peer of node.bootstrapPeers) {
      if (peer.startsWith("/")) {
        if (peer.includes("/p2p-circuit/")) {
          const relayPeerId = circuitRelayPeer(peer);
          if (relayPeerId && addressedPeer(peer) === homePeerId) {
            if (!advertisedCircuits.has(relayPeerId)) advertisedCircuits.set(relayPeerId, peer);
          }
          continue;
        }
        if (addressedPeer(peer) === homePeerId) {
          if (!directAddrs.includes(peer)) directAddrs.push(peer);
          continue;
        }
        if (![...relayMultiaddrs.values()].includes(peer)) {
          relayMultiaddrs.set(extractRelayName(peer), peer);
        }
      } else if (!peer.includes(":") && peer.length > 0) {
        for (const addr of CandidateResolver.resolveBootstrapPresets([peer])) {
          if (![...relayMultiaddrs.values()].includes(addr)) {
            relayMultiaddrs.set(peer, addr);
          }
        }
      }
    }

    for (let i = 0; i < directAddrs.length; i++) {
      const addr = directAddrs[i]!;
      result.push({
        name: i === 0 ? "p2p-direct" : `p2p-direct-${i}`,
        url: addr,
        homePeerId,
        sessionToken,
        libp2pRelayAddr: addr,
      });
    }

    const advertisedNames = new Set<string>();
    for (const addr of advertisedCircuits.values()) {
      const relayName = extractRelayName(circuitRelayPrefix(addr));
      advertisedNames.add(relayName);
      result.push({
        name: `p2p-${relayName}`,
        url: addr,
        homePeerId,
        sessionToken,
        libp2pRelayAddr: addr,
      });
    }

    for (const [relayName, relayMultiaddr] of relayMultiaddrs) {
      const p2pIndex = relayMultiaddr.lastIndexOf("/p2p/");
      if (p2pIndex < 0) continue;
      const relayPeerId = relayMultiaddr.slice(p2pIndex + 5);
      if (!relayPeerId) continue;
      if (advertisedCircuits.has(relayPeerId) || advertisedNames.has(relayName)) continue;
      const circuitAddr = `/p2p/${relayPeerId}/p2p-circuit/p2p/${homePeerId}`;
      result.push({
        name: `p2p-${relayName}`,
        url: circuitAddr,
        homePeerId,
        sessionToken,
        libp2pRelayAddr: relayMultiaddr,
      });
    }

    return result;
  }

  private buildBootstrapPeerCandidates(
    node: StoredHomeNode,
    sessionToken?: string,
  ): HomeRemoteCandidate[] {
    const result: HomeRemoteCandidate[] = [];
    for (const peer of node.bootstrapPeers) {
      if (peer.startsWith("/")) continue;
      if (peer.startsWith("ws://") || peer.startsWith("wss://") || peer.includes(":")) continue;
      let url = peer;
      if (sessionToken && !url.includes("token=")) {
        url += `${url.includes("?") ? "&" : "?"}token=${sessionToken}`;
      }
      result.push({
        name: "bootstrap",
        url,
        homePeerId: node.homePeerId,
        sessionToken,
      });
    }
    return result;
  }

  private limitLibp2p(all: HomeRemoteCandidate[], max: number): HomeRemoteCandidate[] {
    if (all.length <= max) return all;
    const publicDirect: HomeRemoteCandidate[] = [];
    const lanDirect: HomeRemoteCandidate[] = [];
    const loopbackDirect: HomeRemoteCandidate[] = [];
    const relays: HomeRemoteCandidate[] = [];
    for (const candidate of all) {
      if (!candidate.name.startsWith("p2p-direct")) {
        relays.push(candidate);
        continue;
      }
      if (isLoopbackMultiaddr(candidate.url)) loopbackDirect.push(candidate);
      else if (multiaddrIsLanOnly(candidate.url)) lanDirect.push(candidate);
      else publicDirect.push(candidate);
    }
    const preferred = relays.filter((c) => c.name.includes("cn-relay"));
    const other = relays.filter((c) => !c.name.includes("cn-relay"));
    return [...publicDirect, ...preferred, ...other, ...lanDirect, ...loopbackDirect].slice(0, max);
  }
}

function stripTokenParam(url: string): string {
  const qIdx = url.indexOf("?");
  if (qIdx < 0) return url;
  const base = url.slice(0, qIdx);
  const params = url
    .slice(qIdx + 1)
    .split("&")
    .filter((p) => !p.startsWith("token="));
  if (params.length === 0) return base;
  return `${base}?${params.join("&")}`;
}

function addressedPeer(multiaddr: string): string | undefined {
  const p2pIndex = multiaddr.lastIndexOf("/p2p/");
  return p2pIndex < 0 ? undefined : multiaddr.slice(p2pIndex + 5);
}

function circuitRelayPeer(multiaddr: string): string | undefined {
  const circuitIndex = multiaddr.indexOf("/p2p-circuit/");
  if (circuitIndex < 0) return undefined;
  const p2pIndex = multiaddr.lastIndexOf("/p2p/", circuitIndex);
  return p2pIndex < 0 ? undefined : multiaddr.slice(p2pIndex + 5, circuitIndex);
}

function circuitRelayPrefix(multiaddr: string): string {
  const circuitIndex = multiaddr.indexOf("/p2p-circuit/");
  return circuitIndex < 0 ? multiaddr : multiaddr.slice(0, circuitIndex);
}

function extractRelayName(multiaddr: string): string {
  if (multiaddr.includes("am6.bootstrap")) return "am6";
  if (multiaddr.includes("am7.bootstrap")) return "am7";
  if (multiaddr.includes("bootstrap.libp2p.io")) return "bootstrap-libp2p";
  if (multiaddr.includes("47.93.11.212")) return "cn-relay";
  const p2pIdx = multiaddr.lastIndexOf("/p2p/");
  if (p2pIdx >= 0) {
    const peerId = multiaddr.slice(p2pIdx + 5);
    return peerId.length > 8 ? peerId.slice(0, 8) : peerId;
  }
  return "relay";
}

function isLoopbackMultiaddr(multiaddr: string): boolean {
  return multiaddr.startsWith("/ip4/127.") || multiaddr.startsWith("/ip6/::1/");
}

function multiaddrIsLanOnly(multiaddr: string): boolean {
  const match = /^\/ip4\/(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\//.exec(multiaddr);
  if (!match) return isLoopbackMultiaddr(multiaddr);
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}
