import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import {
  DEFAULT_PAIRING_TTL_MS,
  PairedDeviceStore,
  pairedDevicesFile,
} from "../src/daemon/paired-devices.js";

describe("PairedDeviceStore.mint tokens", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function store(): Promise<PairedDeviceStore> {
    const home = await mkdtemp(join(tmpdir(), "envoydev-pair-token-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    return new PairedDeviceStore(pairedDevicesFile(coderPaths(home)), {
      ownerId: async () => "envoy:owner:test",
    });
  }

  it("mints a long random token when none is supplied (QR path)", async () => {
    const devices = await store();
    const { record } = await devices.mint({ deviceLabel: "Phone" });
    expect(record.token.length).toBeGreaterThan(16);
    const ttl = Date.parse(record.expiresAt) - Date.parse(record.createdAt);
    expect(ttl).toBe(DEFAULT_PAIRING_TTL_MS);
  });

  it("stores a user-chosen short token with the same long TTL as QR", async () => {
    const devices = await store();
    const { record } = await devices.mint({ token: "MyPhone99" });
    expect(record.token).toBe("MyPhone99");
    const ttl = Date.parse(record.expiresAt) - Date.parse(record.createdAt);
    expect(ttl).toBe(DEFAULT_PAIRING_TTL_MS);
  });

  it("refuses a duplicate active user token", async () => {
    const devices = await store();
    await devices.mint({ token: "SameToken1" });
    await expect(devices.mint({ token: "SameToken1" })).rejects.toThrow(/already in use/i);
  });

  it("refuses an invalid user token", async () => {
    const devices = await store();
    await expect(devices.mint({ token: "short" })).rejects.toThrow(/8–10|characters/i);
    await expect(devices.mint({ token: "bad-token!" })).rejects.toThrow(/letters and digits/i);
  });
});
