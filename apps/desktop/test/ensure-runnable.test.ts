/**
 * Auto-Add: choosing a catalogue id materialises a provider before it is stored on a task.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import { createCoderHandlers } from "../src/daemon/service.js";
import { ensureRunnableAgent, findRunnableProvider } from "../src/daemon/runnable-agent.js";
import { CoderStore } from "../src/daemon/store.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function openStore(): Promise<CoderStore> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-ensure-"));
  cleanups.push(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return CoderStore.open({ paths: coderPaths(home) });
}

describe("ensureRunnableAgent", () => {
  it("auto-Adds a catalogue recipe the first time it is chosen", async () => {
    const store = await openStore();
    expect(findRunnableProvider(store, "goose")).toBeUndefined();
    await ensureRunnableAgent(store, "goose");
    const provider = findRunnableProvider(store, "goose");
    expect(provider?.id).toBe("goose");
    expect(provider?.catalogEntryId).toBe("goose");
    expect(provider?.command).toBe("goose");
  });

  it("is a no-op when the provider already exists under a legacy id", async () => {
    const store = await openStore();
    await store.addProvider({
      id: "goose-acp",
      label: "goose",
      command: "goose",
      args: ["acp"],
      env: [],
      transport: "acp",
      catalogEntryId: "goose",
    });
    await ensureRunnableAgent(store, "goose");
    expect(store.providers().map((p) => p.id)).toEqual(["goose-acp"]);
  });

  it("refuses an id that is neither shipped nor catalogued", async () => {
    const store = await openStore();
    await expect(ensureRunnableAgent(store, "not-a-real-agent")).rejects.toThrow(/not an agent/);
  });

  it("materialises through updateProject when the default names a catalogue id", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-ensure-rpc-"));
    cleanups.push(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });
    const { project } = await store.addProject({ path: "/tmp/ensure-proj", label: "p" });
    const handlers = createCoderHandlers({
      store,
      paths,
      instance: {
        instanceId: "t",
        version: "0",
        startedAt: new Date().toISOString(),
        connectionCount: () => 1,
      },
      mesh: () => ({ kind: "no-node", reason: "test" }),
      isDirectory: async () => true,
    });
    await handlers["coder.updateProject"]?.(
      { id: project.id, defaults: { harness: "goose" } },
      { session: undefined },
    );
    expect(findRunnableProvider(store, "goose")?.id).toBe("goose");
  });
});
