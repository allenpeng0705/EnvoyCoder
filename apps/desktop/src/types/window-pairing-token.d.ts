/**
 * Vite alias to EnvoyMesh's pairing-token codec (browser-safe gzip decode).
 * See `apps/desktop/vite.config.ts` → `@envoydev/window-pairing-token`.
 */
declare module "@envoydev/window-pairing-token" {
  export function decodePairingTokenAsync(token: string): Promise<{
    wsUrl: string;
    token: string;
    ownerId: string;
    lanWsUrl?: string;
    app?: string;
    homeNodePeerId?: string;
    bootstrapPeers?: string[];
    relayWsUrl?: string;
    relayWsUrls?: string[];
    relayPeerId?: string;
  }>;
}
