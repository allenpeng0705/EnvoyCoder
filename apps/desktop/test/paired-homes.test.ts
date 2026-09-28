/**
 * Paired EnvoyDev homes — parse, store, registry, and thin-client session substrate.
 *
 * Normative design: `docs/envoydev-paired-homes.md`.
 */

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { coderPaths, coderSessionIdentity, createCoderDaemonHost } from "@envoydev/host-bridge";
import { checkPairingCode } from "@envoydev/host-bridge/pairing-code";

import { startCoderDaemon, type StartedCoderDaemon } from "../src/daemon/serve.js";
import {
  HomeRegistry,
  resetHomeRegistryForTests,
} from "../src/state/home-registry.js";
import {
  LOCAL_HOME_ID,
  PairedHomeStore,
  homeFromPairingUri,
  memoryPairedHomesStorage,
} from "../src/state/paired-homes.js";

afterEach(() => {
  resetHomeRegistryForTests();
});

function legacyUri(opts: {
  wsUrl: string;
  lanWsUrl?: string;
  token: string;
  ownerId?: string;
  app?: string;
  homeNodePeerId?: string;
  bootstrapPeers?: string[];
}): string {
  const params = new URLSearchParams({
    wsUrl: opts.wsUrl,
    token: opts.token,
    ownerPublicKey: "KEY",
    ownerId: opts.ownerId ?? "envoy:owner:abc",
    app: opts.app ?? "EnvoyDev",
  });
  if (opts.lanWsUrl) params.set("lanWsUrl", opts.lanWsUrl);
  if (opts.homeNodePeerId) params.set("homeNodePeerId", opts.homeNodePeerId);
  if (opts.bootstrapPeers?.length) params.set("bootstrapPeers", opts.bootstrapPeers.join(","));
  return `envoy://pair?${params.toString()}`;
}

describe("homeFromPairingUri", () => {
  it("reads lanWsUrl, token, and a label from the legacy query form", async () => {
    const uri = legacyUri({
      wsUrl: "ws://10.0.0.2:4770/ws",
      lanWsUrl: "ws://192.168.1.20:4770/ws",
      token: "secret-token",
    });
    const parsed = await homeFromPairingUri(uri, "office");
    expect(parsed).toMatchObject({
      host: "192.168.1.20",
      port: 4770,
      path: "/ws",
      token: "secret-token",
      label: "office",
      lanWsUrl: "ws://192.168.1.20:4770/ws",
      wsUrl: "ws://10.0.0.2:4770/ws",
    });
  });

  it("falls back to wsUrl when lanWsUrl is absent", async () => {
    const parsed = await homeFromPairingUri(
      legacyUri({ wsUrl: "ws://10.0.0.9:4771/ws", token: "tokentok" }),
    );
    expect(parsed).toMatchObject({ host: "10.0.0.9", port: 4771, path: "/ws", token: "tokentok" });
    if ("error" in parsed) return;
    expect(parsed.label.length).toBeGreaterThan(0);
  });

  it("reads the compressed pairing= form the home mints for QR", async () => {
    const host = createCoderDaemonHost({
      port: 0,
      sessionIdentity: coderSessionIdentity(),
      dispatch: async () => undefined,
    });
    try {
      const uri = await host.pairingUri({
        token: "compressed1",
        ownerPublicKey: "KEY",
        ownerId: "envoy:owner:abc",
        host: "10.0.0.5",
      });
      expect(uri.startsWith("envoy://pair?pairing=")).toBe(true);
      const parsed = await homeFromPairingUri(uri, "qr-home");
      expect(parsed).toMatchObject({
        host: "10.0.0.5",
        port: host.port,
        path: "/ws",
        token: "compressed1",
        label: "qr-home",
      });
    } finally {
      host.stop();
    }
  });

  it("refuses another app's code", async () => {
    const uri = legacyUri({
      wsUrl: "ws://10.0.0.1:4770/ws",
      token: "secret99",
      app: "EnvoyMesh",
    });
    const parsed = await homeFromPairingUri(uri);
    expect("error" in parsed).toBe(true);
    if (!("error" in parsed)) return;
    expect(parsed.error).toMatch(/EnvoyMesh|EnvoyDev/);
  });

  it("refuses a link that only has a loopback address", async () => {
    const parsed = await homeFromPairingUri(
      legacyUri({ wsUrl: "ws://127.0.0.1:4770/ws", token: "localonly1" }),
    );
    expect("error" in parsed).toBe(true);
    if (!("error" in parsed)) return;
    expect(parsed.error).toMatch(/loopback|127\.0\.0\.1|LAN/i);
  });

  it("prefers a non-loopback wsUrl when lanWsUrl is loopback", async () => {
    const parsed = await homeFromPairingUri(
      legacyUri({
        wsUrl: "ws://10.0.0.8:4770/ws",
        lanWsUrl: "ws://127.0.0.1:4770/ws",
        token: "preferlan1",
      }),
    );
    expect(parsed).toMatchObject({ host: "10.0.0.8", port: 4770, token: "preferlan1" });
    if ("error" in parsed) return;
    // Loopback lanWsUrl must not be kept — the dial ladder prefers it and would stick on localhost.
    expect(parsed.lanWsUrl).toBeUndefined();
    expect(parsed.wsUrl).toBe("ws://10.0.0.8:4770/ws");
  });

  it("keeps wss when rebuilding wsUrl after scrubbing a loopback primary", async () => {
    const parsed = await homeFromPairingUri(
      legacyUri({
        wsUrl: "ws://127.0.0.1:4770/ws",
        lanWsUrl: "wss://10.0.0.8:443/ws",
        token: "keepwss01",
      }),
    );
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.host).toBe("10.0.0.8");
    expect(parsed.port).toBe(443);
    expect(parsed.lanWsUrl).toBe("wss://10.0.0.8:443/ws");
    expect(parsed.wsUrl).toMatch(/^wss:\/\//);
  });

  it("keeps homeNodePeerId and bootstrapPeers for the dial ladder", async () => {
    const peer = "12D3KooWHomePeer";
    const addr = `/ip4/10.0.0.9/tcp/4001/p2p/${peer}`;
    const parsed = await homeFromPairingUri(
      legacyUri({
        wsUrl: "ws://10.0.0.9:4770/ws",
        token: "meshfields1",
        homeNodePeerId: peer,
        bootstrapPeers: [addr],
      }),
    );
    expect(parsed).toMatchObject({
      host: "10.0.0.9",
      homeNodePeerId: peer,
      bootstrapPeers: [addr],
    });
  });

  it("refuses a link without a token", async () => {
    expect(await homeFromPairingUri("envoy://pair?wsUrl=ws://10.0.0.1:4770/ws&ownerPublicKey=K")).toEqual({
      error: expect.stringMatching(/pairing code|token|read/i),
    });
  });
});

describe("PairedHomeStore", () => {
  it("persists add and forget with a stable clientId", async () => {
    const storage = memoryPairedHomesStorage();
    const store = new PairedHomeStore(storage);
    await store.load();
    const clientId = store.clientId();
    expect(clientId.length).toBeGreaterThan(8);
    const home = await store.add({
      label: "server",
      host: "10.0.0.9",
      port: 4770,
      path: "/ws",
      token: "tok",
    });
    expect(store.list()).toHaveLength(1);
    const again = new PairedHomeStore(storage);
    await again.load();
    expect(again.clientId()).toBe(clientId);
    expect(again.list()[0]?.id).toBe(home.id);
    await again.forget(home.id);
    expect(again.list()).toHaveLength(0);
  });

  it("updates token and label when re-adding the same endpoint", async () => {
    const store = new PairedHomeStore(memoryPairedHomesStorage());
    await store.load();
    const first = await store.add({
      label: "old",
      host: "10.0.0.1",
      port: 4770,
      path: "/ws",
      token: "old-token",
    });
    const second = await store.add({
      label: "renamed",
      host: "10.0.0.1",
      port: 4770,
      path: "/ws",
      token: "new-token",
      sshHop: "user@jump:22",
    });
    expect(second.id).toBe(first.id);
    expect(store.list()).toHaveLength(1);
    expect(store.get(first.id)).toMatchObject({
      label: "renamed",
      token: "new-token",
      sshHop: "user@jump:22",
    });
  });

  it("renames a home and ignores an empty name", async () => {
    const store = new PairedHomeStore(memoryPairedHomesStorage());
    await store.load();
    const home = await store.add({
      label: "lab",
      host: "127.0.0.1",
      port: 1,
      path: "/ws",
      token: "t",
    });
    await store.rename(home.id, "  lab-2  ");
    expect(store.get(home.id)?.label).toBe("lab-2");
    await store.rename(home.id, "   ");
    expect(store.get(home.id)?.label).toBe("lab-2");
  });

  it("recovers from corrupt storage", async () => {
    const storage = memoryPairedHomesStorage("{not-json");
    const store = new PairedHomeStore(storage);
    await store.load();
    expect(store.list()).toEqual([]);
    expect(store.clientId().startsWith("envoydev-desktop-")).toBe(true);
  });

  it("notifies subscribers on persist", async () => {
    const store = new PairedHomeStore(memoryPairedHomesStorage());
    await store.load();
    let ticks = 0;
    const unsub = store.subscribe(() => {
      ticks += 1;
    });
    await store.add({ label: "a", host: "1.1.1.1", port: 9, path: "/ws", token: "t" });
    expect(ticks).toBeGreaterThan(0);
    unsub();
  });
});

describe("thin-client session against a real daemon", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function bootDaemon(): Promise<{ daemon: StartedCoderDaemon; port: number }> {
    const home = await mkdtemp(join(tmpdir(), "envoy-paired-home-"));
    cleanups.push(async () => {
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const daemon = await startCoderDaemon({
      port: 0,
      home,
      paths: coderPaths(home),
      skipMeshAttach: true,
      isDirectory: async (path) => path.startsWith(home) || path.startsWith(tmpdir()),
    });
    cleanups.push(async () => {
      await daemon.stop();
    });
    return { daemon, port: daemon.port };
  }

  function openWs(port: number, token?: string): Promise<WebSocket> {
    const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws${suffix}`);
    return new Promise((resolve, reject) => {
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });
  }

  function rpc(socket: WebSocket): {
    call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  } {
    let nextId = 1;
    return {
      call(method, params = {}) {
        const id = String(nextId++);
        return new Promise((resolve, reject) => {
          const onMessage = (raw: WebSocket.RawData): void => {
            const msg = JSON.parse(String(raw)) as {
              id?: string | number;
              result?: unknown;
              error?: { message?: string };
            };
            if (msg.id !== id && msg.id !== Number(id)) return;
            socket.off("message", onMessage);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          };
          socket.on("message", onMessage);
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
    };
  }

  it("mints on home A; laptop session lists projects with hello client id", async () => {
    const { port } = await bootDaemon();
    const windowSocket = await openWs(port);
    cleanups.push(async () => {
      windowSocket.close();
    });
    const window = rpc(windowSocket);
    await window.call("coder.hello", { client: { name: "test-window" } });
    const minted = (await window.call("coder.mintPairing", {
      deviceLabel: "Laptop",
    })) as { uri: string; device: { id: string } };
    expect(minted.uri).toContain("envoy://pair?");
    windowSocket.close();

    const code = await checkPairingCode(minted.uri);
    expect(code.ok).toBe(true);
    if (!code.ok) throw new Error(code.message);

    const fromUri = await homeFromPairingUri(minted.uri, "home-a");
    if ("error" in fromUri) throw new Error(fromUri.error);
    expect(fromUri.token).toBe(code.token);

    const thinSocket = await openWs(port, fromUri.token);
    cleanups.push(async () => {
      thinSocket.close();
    });
    const thin = rpc(thinSocket);
    const hello = (await thin.call("coder.hello", {
      client: {
        name: "home-a",
        platform: "linux",
        id: "envoydev-desktop-test-client-1",
      },
    })) as { product: string };
    expect(hello.product).toBe("EnvoyDev");

    const projects = (await thin.call("coder.listProjects", {})) as { projects: unknown[] };
    expect(Array.isArray(projects.projects)).toBe(true);

    const window2 = await openWs(port);
    cleanups.push(async () => {
      window2.close();
    });
    const devices = (await rpc(window2).call("coder.listPairedDevices", {})) as {
      devices: { id: string; clientPlatform?: string; clientName?: string; deviceLabel?: string }[];
    };
    const row = devices.devices.find((d) => d.id === minted.device.id);
    expect(row?.deviceLabel).toBe("home-a");
    expect(row?.clientPlatform).toBe("linux");
    expect(row?.clientName).toBe("home-a");
  }, 30_000);

  it("revoking the device on the home refuses the thin client's next call", async () => {
    const { port } = await bootDaemon();
    const windowSocket = await openWs(port);
    cleanups.push(async () => {
      windowSocket.close();
    });
    const window = rpc(windowSocket);
    await window.call("coder.hello", { client: { name: "owner-window" } });
    const minted = (await window.call("coder.mintPairing", {
      deviceLabel: "Thin laptop",
    })) as { uri: string; device: { id: string } };
    const code = await checkPairingCode(minted.uri);
    if (!code.ok) throw new Error(code.message);

    const thinSocket = await openWs(port, code.token);
    cleanups.push(async () => {
      thinSocket.close();
    });
    const thin = rpc(thinSocket);
    await thin.call("coder.hello", {
      client: { name: "thin", platform: "darwin", id: "thin-client-revoke-1" },
    });
    await thin.call("coder.listProjects", {});

    const closed = new Promise<void>((resolve) => {
      thinSocket.once("close", () => resolve());
    });
    await window.call("coder.revokePairedDevice", { id: minted.device.id });
    await closed;

    const again = await openWs(port, code.token);
    cleanups.push(async () => {
      again.close();
    });
    await expect(
      rpc(again).call("coder.hello", { client: { name: "thin", platform: "darwin", id: "thin-client-revoke-1" } }),
    ).rejects.toThrow(/UNAUTHORIZED|unauthorized|Authentication/i);
  }, 30_000);
});

describe("HomeRegistry", () => {
  it("joins from a URI and switches active home", async () => {
    const storage = memoryPairedHomesStorage();
    const homes = new PairedHomeStore(storage);
    await homes.load();
    const registry = new HomeRegistry(homes);
    const uri = legacyUri({ wsUrl: "ws://10.0.0.7:4770/ws", token: "abc12345" });
    const joined = await registry.joinFromUri(uri, "lab");
    expect("error" in joined).toBe(false);
    if ("error" in joined) {
      throw new Error(joined.error);
    }
    expect(registry.activeHomeIdValue()).toBe(joined.id);
    expect(registry.getSnapshot().homes).toHaveLength(1);
    registry.setActiveHome(LOCAL_HOME_ID);
    expect(registry.activeHomeIdValue()).toBe(LOCAL_HOME_ID);
    expect(registry.localStore()).toBe(registry.storeFor(LOCAL_HOME_ID));
    registry.retryHome(joined.id);
    await registry.forgetHome(joined.id);
    expect(registry.getSnapshot().homes).toHaveLength(0);
    expect(registry.activeHomeIdValue()).toBe(LOCAL_HOME_ID);
    registry.dispose();
  });

  it("stores an optional SSH hop and renames through the registry", async () => {
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const registry = new HomeRegistry(homes);
    const joined = await registry.joinFromUri(
      legacyUri({ wsUrl: "ws://10.0.0.8:4770/ws", token: "ssh-token1" }),
      "office",
      "user@bastion:22",
    );
    if ("error" in joined) throw new Error(joined.error);
    expect(joined.sshHop).toBe("user@bastion:22");
    await registry.renameHome(joined.id, "office-linux");
    expect(registry.pairedHomeStore().get(joined.id)?.label).toBe("office-linux");
    registry.dispose();
  });

  it("keeps two homes and refuses setActiveHome for unknown ids", async () => {
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const registry = new HomeRegistry(homes);
    const a = await registry.joinFromUri(
      legacyUri({ wsUrl: "ws://10.0.0.1:4770/ws", token: "token-aaa" }),
      "a",
    );
    const b = await registry.joinFromUri(
      legacyUri({ wsUrl: "ws://10.0.0.2:4770/ws", token: "token-bbb" }),
      "b",
    );
    if ("error" in a || "error" in b) throw new Error("join failed");
    expect(registry.getSnapshot().homes).toHaveLength(2);
    expect(registry.activeHomeIdValue()).toBe(b.id);
    registry.setActiveHome(a.id);
    expect(registry.activeHomeIdValue()).toBe(a.id);
    registry.setActiveHome("no-such-home");
    expect(registry.activeHomeIdValue()).toBe(a.id);
    registry.dispose();
  });

  it("returns an error for a bad pairing URI without mutating the store", async () => {
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const registry = new HomeRegistry(homes);
    const result = await registry.joinFromUri("not-a-pairing-uri");
    expect(result).toEqual({ error: expect.any(String) });
    expect(homes.list()).toHaveLength(0);
    registry.dispose();
  });

  it("returns a stable snapshot identity between emits (useSyncExternalStore)", async () => {
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const registry = new HomeRegistry(homes);
    const a = registry.getSnapshot();
    const b = registry.getSnapshot();
    expect(a).toBe(b);
    registry.setActiveHome(LOCAL_HOME_ID);
    // setActiveHome always emits — identity may change even if the id is unchanged.
    const c = registry.getSnapshot();
    expect(c.activeHomeId).toBe(LOCAL_HOME_ID);
    expect(registry.getSnapshot()).toBe(c);
    registry.dispose();
  });
});
