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

  it("reuses an unused QR code instead of stacking another Phone row", async () => {
    const devices = await store();
    const first = await devices.mint({ deviceLabel: "Phone" });
    const second = await devices.mint({ deviceLabel: "Phone" });
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.token).toBe(first.record.token);
    const listed = await devices.list();
    expect(listed).toHaveLength(1);
  });

  it("mints a new QR when fresh is set, and discards the unused predecessor", async () => {
    const devices = await store();
    const first = await devices.mint({ deviceLabel: "Phone" });
    const second = await devices.mint({ deviceLabel: "Phone", fresh: true });
    expect(second.record.id).not.toBe(first.record.id);
    const listed = await devices.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(second.record.id);
  });

  it("prunes a stack of unused QR codes when the list is read", async () => {
    const devices = await store();
    // Bypass reuse by forcing fresh each time — the bug the owner hit before reuse existed.
    await devices.mint({ fresh: true });
    await devices.mint({ fresh: true });
    await devices.mint({ fresh: true });
    // Before list prune, only the last fresh mint remains (mint already pruned). Confirm list stays at 1.
    expect(await devices.list()).toHaveLength(1);
  });

  it("keeps a used device and a user-chosen token when pruning unused QR codes", async () => {
    const devices = await store();
    const used = await devices.mint({ deviceLabel: "Real phone", fresh: true });
    await devices.resolveSession(used.record.token);
    await devices.mint({ token: "MyPhone99" });
    await devices.mint({ deviceLabel: "Phone", fresh: true });
    await devices.mint({ deviceLabel: "Phone", fresh: true });
    const listed = await devices.list();
    const labels = listed.map((d) => d.deviceLabel).sort();
    expect(labels).toContain("Real phone");
    expect(listed.some((d) => d.id === used.record.id && d.lastSeenAt)).toBe(true);
    expect(listed.filter((d) => !d.lastSeenAt && !d.revokedAt)).toHaveLength(2); // short token + one unused QR
  });
});
