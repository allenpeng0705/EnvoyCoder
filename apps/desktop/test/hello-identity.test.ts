/**
 * The hello path records who is calling — the seam that makes the pairing fix reachable.
 *
 * The store's own rules are tested in `paired-devices-token.test.ts`; what this pins is the *wiring*: a paired
 * session's device id plus the client block from `coder.hello` reach the store, and the owner's own window (no
 * session) records nothing. It exists because the previous two commits built a door nothing knocked on — the
 * pairing store was reachable from the pairing family and nowhere else — and "a guard that cannot see the caller"
 * is the failure this file's subject already cost this codebase once.
 *
 * @vitest-environment node
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import { createCoderHandlers, type CoderHandler } from "../src/daemon/service.js";
import { CoderStore } from "../src/daemon/store.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function handlers(
  identify: (deviceId: string, client: unknown) => Promise<void>,
): Promise<Record<string, CoderHandler>> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-hello-id-"));
  cleanups.push(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const paths = coderPaths(home);
  const store = await CoderStore.open({ paths });
  return createCoderHandlers({
    store,
    paths,
    instance: {
      instanceId: "hello-id",
      version: "0.1.0",
      startedAt: new Date().toISOString(),
      connectionCount: () => 1,
    },
    mesh: () => ({ kind: "no-node", reason: "not attached in this test" }),
    paired: { identify } as never,
  }) as Record<string, CoderHandler>;
}

describe("coder.hello records the caller", () => {
  it("hands a paired device's id and client block to the pairing store", async () => {
    const identify = vi.fn(async () => undefined);
    const table = await handlers(identify);

    await table["coder.hello"]?.(
      { client: { id: "install-abc", name: "Shi's iPhone", platform: "ios", version: "0.4.0" } },
      { session: { deviceId: "pad_123", caller: { kind: "owner-device", deviceId: "pad_123", label: "Phone" } } },
    );

    expect(identify).toHaveBeenCalledWith("pad_123", {
      id: "install-abc",
      name: "Shi's iPhone",
      platform: "ios",
      version: "0.4.0",
    });
  });

  it("records nothing for the owner's own window, which has no device", async () => {
    const identify = vi.fn(async () => undefined);
    const table = await handlers(identify);

    await table["coder.hello"]?.({ client: { name: "EnvoyDev window" } }, { session: undefined });
    // …and a paired client that sends no `client` block at all is not an error either.
    await table["coder.hello"]?.({}, { session: { deviceId: "pad_123" } });

    expect(identify).not.toHaveBeenCalled();
  });

  it("does not let a failing bookkeeping write break the greeting", async () => {
    // Hello is how a window learns the daemon's identity; a store write failing behind it must not turn into a
    // refused handshake, which is why the call is not awaited. The assertion is that the answer still arrives.
    const table = await handlers(async () => {
      throw new Error("the store is read-only today");
    });

    const answer = (await table["coder.hello"]?.(
      { client: { id: "install-abc", name: "Shi's iPhone" } },
      { session: { deviceId: "pad_123" } },
    )) as { product: string; instanceId: string };
    expect(answer.instanceId).toBe("hello-id");
  });
});
