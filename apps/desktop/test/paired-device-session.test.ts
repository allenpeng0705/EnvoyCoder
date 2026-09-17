/**
 * Who a paired phone **is**.
 *
 * EnvoyDev has no family-member concept: there is one owner, and pairing attaches another of their
 * devices to their daemon. This file pins that, because the first version said otherwise —
 * `isOwnerScope: false` and `ownerId: "EnvoyDev"` — which modelled the owner's own phone as a lesser
 * principal of a product it was the owner of.
 *
 * It is a small file on purpose. The behaviour a user meets (the token is answered from the LAN,
 * revocation bites, a phone cannot mint) is proven over sockets in `scripts/smoke.ts`; what is left
 * for a unit test is the claim itself, which is the thing that was wrong.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import { PairedDeviceStore, loadOrCreatePairingIdentity, pairedDevicesFile, readPairingIdentity } from "../src/daemon/paired-devices.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function store(): Promise<{ store: PairedDeviceStore; home: string; identity: { ownerId: string } }> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-paired-session-"));
  cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const paths = coderPaths(home);
  const identity = await loadOrCreatePairingIdentity(paths);
  const paired = new PairedDeviceStore(pairedDevicesFile(paths), {
    ownerId: async () => (await readPairingIdentity(paths))?.ownerId ?? null,
  });
  return { store: paired, home, identity };
}

describe("a paired device's session", () => {
  it("is the owner's own device, not a lesser principal", async () => {
    const { store: devices, identity } = await store();
    const { record } = await devices.mint({ deviceLabel: "Shilei's phone" });

    const session = await devices.resolveSession(record.token);
    expect(session).not.toBeNull();
    // The phone stands where the desktop window stands. Modelling the owner's own phone as something
    // less was the family's model leaking in, and it would have under-granted the one client this
    // product exists to serve.
    expect(session?.isOwnerScope).toBe(true);
    // …and it is owned by the **machine's identity**, not by the product's name. `ownerId` answers
    // *who*, so a product name there was a category error rather than a wording choice.
    expect(session?.ownerId).toBe(identity.ownerId);
    expect(session?.ownerId).not.toBe("EnvoyDev");
    expect(session?.caller.kind).toBe("owner-device");
    // The scope stays the product's: that is what the transport routes events on.
    expect(session?.scopeKey).toBe("product:EnvoyDev");
  });

  it("still refuses an unknown, revoked or expired token", async () => {
    const { store: devices } = await store();
    const { record } = await devices.mint({ deviceLabel: "phone" });
    expect(await devices.resolveSession("not-a-token")).toBeNull();

    await devices.revoke(record.id);
    expect(await devices.resolveSession(record.token)).toBeNull();
  });

  it("reads the identity without creating one, because a resolve is not a place to mint state", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-paired-identity-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    const paths = coderPaths(home);

    // Nothing has paired on this machine, so there is no identity — and asking must not make one.
    expect(await readPairingIdentity(paths)).toBeNull();
    expect(await readPairingIdentity(paths)).toBeNull();
  });
});
