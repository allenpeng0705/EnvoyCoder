import { describe, expect, it, vi } from "vitest";

import { HomeRegistry, resetHomeRegistryForTests } from "../src/state/home-registry.js";
import { isLoopbackHost, parseSshHop } from "../src/state/home-ssh-forward.js";
import { PairedHomeStore, memoryPairedHomesStorage } from "../src/state/paired-homes.js";

describe("home SSH hop helpers", () => {
  it("parses user@host:port", () => {
    expect(parseSshHop("me@bastion:2222")).toEqual({ user: "me", host: "bastion", port: 2222 });
    expect(parseSshHop("bastion")).toEqual({ host: "bastion", port: 22 });
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
  });
});

describe("HomeRegistry SSH dial", () => {
  it("opens a local-forward before dialling a loopback daemon with sshHop", async () => {
    resetHomeRegistryForTests();
    const openSshForward = vi.fn(async () => ({
      host: "127.0.0.1",
      port: 54321,
      path: "/ws",
    }));
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const record = await homes.add({
      label: "via-ssh",
      host: "127.0.0.1",
      port: 4770,
      path: "/ws",
      token: "secrettok",
      sshHop: "me@bastion:22",
    });
    const registry = new HomeRegistry(homes, { openSshForward });
    // ensureRemote runs on joinFromSsh/commit — call retry to resolve endpoint path.
    registry.retryHome(record.id);
    const store = registry.storeFor(record.id);
    // start() kicks resolveEndpoint; give the mock a tick.
    await vi.waitFor(() => expect(openSshForward).toHaveBeenCalled());
    expect(openSshForward).toHaveBeenCalledWith("me@bastion:22", 4770, "/ws");
    store.dispose();
    registry.dispose();
    resetHomeRegistryForTests();
  });
});

describe("PairedHomeStore.load rewrite", () => {
  it("does not rewrite the file when clientId already exists on disk", async () => {
    const writes: string[] = [];
    const initial = JSON.stringify({
      version: 1,
      clientId: "envoydev-desktop-stable",
      homes: [],
    });
    let text: string | undefined = initial;
    const storage = {
      async read() {
        return text;
      },
      async write(next: string) {
        writes.push(next);
        text = next;
      },
    };
    const store = new PairedHomeStore(storage);
    await store.load();
    expect(store.clientId()).toBe("envoydev-desktop-stable");
    expect(writes).toHaveLength(0);
  });

  it("persists once when minting a fresh clientId", async () => {
    const writes: string[] = [];
    const storage = {
      async read() {
        return undefined;
      },
      async write(next: string) {
        writes.push(next);
      },
    };
    const store = new PairedHomeStore(storage);
    await store.load();
    expect(writes).toHaveLength(1);
    expect(store.clientId().startsWith("envoydev-desktop-")).toBe(true);
  });
});
