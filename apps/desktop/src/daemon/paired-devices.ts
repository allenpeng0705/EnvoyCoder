/**
 * Paired phones (and other remote clients): tokens the daemon will accept from the network.
 *
 * ## Why this exists
 *
 * Loopback windows are trusted without a token (the family's desktop-UI model). A phone on the LAN
 * or over a tunnel must present a token, and until this store lands `coderSessionIdentity` resolved
 * every token to `null` — so the transport correctly refused every remote caller. M4 is the phone;
 * this is the half that lets a minted pairing code become a real session.
 *
 * ## What a record is
 *
 * The **token** in the pairing QR *is* the session credential (scoped to this product). Minting
 * writes it here; `resolveSession` looks it up; revoke / expiry make it stop working. The public
 * list never returns the token — only the id, label and timestamps a Settings page can show.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { type CoderPaths } from "@envoydev/host-bridge";
import { ENVOYDEV_PRODUCT_NAME } from "@envoydev/protocol";

import {
  USER_PAIRING_TOKEN_MAX_LEN,
  USER_PAIRING_TOKEN_MIN_LEN,
  normalizeUserPairingToken,
} from "../pairing-token.js";

export {
  USER_PAIRING_TOKEN_MAX_LEN,
  USER_PAIRING_TOKEN_MIN_LEN,
  normalizeUserPairingToken,
} from "../pairing-token.js";
export type { UserPairingTokenResult } from "../pairing-token.js";

/**
 * Minimal session shape the transport's `resolveSession` port expects.
 *
 * ## A paired device is the **owner's own** device
 *
 * EnvoyDev has no family-member concept: there is one owner, and pairing attaches another of *their*
 * devices to *their* daemon. So `isOwnerScope` is **true**, and the phone stands where the desktop
 * window stands — the token proves the ask came from the owner, not that it came from somebody with
 * fewer rights.
 *
 * The distinction this replaced (`false`) was copied from the family's model, where a "device" is
 * usually a family member and therefore a different principal. Modelling the owner's own phone as a
 * lesser principal would have been wrong twice over: it would under-grant the one client this product
 * exists to serve, and it would invite a permission model nobody asked for.
 *
 * What is still refused a phone is refused **because of where it is, not who it is** — minting a
 * pairing code happens at the machine that will be paired (`pairing.ts`), and that is a physical
 * presence rule that would apply to a second desktop window too.
 */
export interface PairedSession {
  scopeKey: string;
  /** The machine's pairing identity — the owner, never the product's name. */
  ownerId: string;
  isOwnerScope: true;
  deviceId: string;
  caller: { kind: "owner-device"; deviceId: string; label: string };
}

/** How long a newly minted pairing stays valid unless revoked. */
export const DEFAULT_PAIRING_TTL_MS = 1000 * 60 * 60 * 24 * 365;

export interface PairedDeviceRecord {
  id: string;
  token: string;
  deviceLabel: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
  /**
   * Who paired: an **install-stable id the client sends**, with the name and platform it reports.
   *
   * Without these, one phone pairing five times is five identical rows labelled "Phone" — which is not only a
   * useless list, it is five *live tokens* for one device, so revoking "the phone" left it authenticated by the
   * next row along. The id is the only thing that can tell "the same phone again" from "another phone", which is
   * why nothing here collapses rows that lack one.
   */
  clientId?: string;
  clientName?: string;
  clientPlatform?: string;
}

/** What Settings and `coder.listPairedDevices` may show — never the token. */
export interface PairedDevicePublic {
  id: string;
  deviceLabel: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
  /** The device's own name and platform, once it has identified itself. */
  clientName?: string;
  clientPlatform?: string;
}

export interface PairingIdentity {
  ownerId: string;
  ownerPublicKey: string;
}

interface StoreFile {
  devices: PairedDeviceRecord[];
}

/**
 * What a forget request answered.
 *
 * Three outcomes rather than `PairedDevicePublic | null`, because "there is no such record" and "that
 * record has not been revoked" are different sentences to the user: one says the row is already gone, the
 * other says revoke it first. The kind is named for the **guard** (not revoked), not for the UI's
 * *active* state: a minted code that no phone ever scanned is "unused" in the list and still refused
 * here, because it is a working token either way. Collapsing the outcomes into `null` would make the
 * refusal generic and would hide the deliberate two-step — revocation is the security event, forgetting
 * is only the cleanup.
 */
export type ForgetPairedDeviceOutcome =
  | { kind: "forgotten"; device: PairedDevicePublic }
  | { kind: "not-revoked" }
  | { kind: "missing" };

function publicOf(record: PairedDeviceRecord): PairedDevicePublic {
  return {
    id: record.id,
    deviceLabel: record.deviceLabel,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
    ...(record.lastSeenAt ? { lastSeenAt: record.lastSeenAt } : {}),
    // The name the phone reports, so a Settings row says which device it is rather than "Phone".
    ...(record.clientName ? { clientName: record.clientName } : {}),
    ...(record.clientPlatform ? { clientPlatform: record.clientPlatform } : {}),
  };
}

function isActive(record: PairedDeviceRecord, now: Date): boolean {
  if (record.revokedAt) return false;
  const expires = Date.parse(record.expiresAt);
  if (Number.isNaN(expires)) return false;
  return expires > now.getTime();
}

/**
 * QR mint secrets are long random base64url; the typed route uses 8–10 character tokens.
 * Only the long kind stacks when Settings → Pairing auto-opens — those are safe to discard when
 * unused, because nothing ever authenticated with them.
 */
function isQrSecret(token: string): boolean {
  return token.length > USER_PAIRING_TOKEN_MAX_LEN;
}

/** Unused QR codes: never seen by a phone, not an explicit revoke. */
function isUnusedQr(record: PairedDeviceRecord): boolean {
  return isQrSecret(record.token) && !record.lastSeenAt && !record.revokedAt;
}

async function atomicWrite(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/**
 * Load / create the stable identity fields a pairing URI requires.
 *
 * When a mesh profile exists the owner id is preferred later by the mint caller; this file is the
 * fallback so a machine with no EnvoyMesh node can still pair a phone to the local daemon.
 */
/**
 * The identity if it exists, `null` otherwise — **never writes**.
 *
 * `loadOrCreatePairingIdentity` is for the one place an identity may be minted (the user asking for a
 * pairing code). Authenticating a token is not that place: a resolve that created state could mint a
 * fresh identity on a machine whose secrets were lost, and would report an owner nobody paired with.
 */
export async function readPairingIdentity(paths: CoderPaths): Promise<PairingIdentity | null> {
  const file = join(paths.secretsDir, "pairing-identity.json");
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<PairingIdentity>;
    if (
      typeof raw.ownerId === "string" &&
      raw.ownerId.length > 0 &&
      typeof raw.ownerPublicKey === "string" &&
      raw.ownerPublicKey.length > 0
    ) {
      return { ownerId: raw.ownerId, ownerPublicKey: raw.ownerPublicKey };
    }
  } catch {
    // No identity yet, or an unreadable one: both mean "nobody has paired on this machine".
  }
  return null;
}

export async function loadOrCreatePairingIdentity(paths: CoderPaths): Promise<PairingIdentity> {
  const file = join(paths.secretsDir, "pairing-identity.json");
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<PairingIdentity>;
    if (typeof raw.ownerId === "string" && raw.ownerId.length > 0 && typeof raw.ownerPublicKey === "string" && raw.ownerPublicKey.length > 0) {
      return { ownerId: raw.ownerId, ownerPublicKey: raw.ownerPublicKey };
    }
  } catch {
    // Missing or unreadable — mint below.
  }
  const identity: PairingIdentity = {
    ownerId: `envoy:owner:local-${randomBytes(8).toString("hex")}`,
    // Not a real PEM key — pairing for this product only needs a stable opaque claim the phone stores.
    // Mesh shared-identity flows use the profile's real key when present.
    ownerPublicKey: `-----BEGIN PUBLIC KEY-----\n${randomBytes(32).toString("base64")}\n-----END PUBLIC KEY-----`,
  };
  await mkdir(paths.secretsDir, { recursive: true, mode: 0o700 });
  await atomicWrite(file, `${JSON.stringify(identity, null, 2)}\n`);
  return identity;
}

export class PairedDeviceStore {
  private devices: PairedDeviceRecord[] = [];
  private loaded = false;
  private tail: Promise<void> = Promise.resolve();
  private readonly now: () => Date;

  constructor(
    private readonly file: string,
    options: {
      now?: () => Date;
      /**
       * The machine's owner identity, read **without creating one**.
       *
       * A resolve is not the place to mint an identity: `null` means nobody has ever paired, and a
       * token cannot match in that state anyway. Reading it (rather than reporting the product name,
       * which is what this did) is what makes `ownerId` mean *who* rather than *what*.
       */
      ownerId?: () => Promise<string | null>;
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.readOwnerId = options.ownerId ?? (async () => null);
  }

  private readonly readOwnerId: () => Promise<string | null>;

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as StoreFile;
      this.devices = Array.isArray(raw.devices) ? raw.devices.filter(isRecord) : [];
    } catch {
      this.devices = [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await atomicWrite(this.file, `${JSON.stringify({ devices: this.devices }, null, 2)}\n`);
  }

  list(): Promise<PairedDevicePublic[]> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      // Opening *This machine* should not show a graveyard of codes minted every time Pairing opened
      // and never scanned — keep at most one unused QR, drop the rest (and expired unused QR).
      // Two cleanups before the owner sees the list: unused QR codes (a graveyard of codes minted every time
      // Pairing opened), and **rows that are the same device** — a phone paired repeatedly before this store
      // recorded identities. The newest row is kept; the older ones are revoked, not deleted, so a phone still
      // holding one of those tokens is refused rather than quietly working.
      const prunedCodes = this.pruneUnusedQrCodes({ keepNewest: true });
      const collapsed = this.collapseSameDevice();
      if (prunedCodes || collapsed) await this.persist();
      return this.devices.map(publicOf);
    });
  }

  mint(
    input: { deviceLabel?: string; ttlMs?: number; token?: string; fresh?: boolean } = {},
  ): Promise<{ record: PairedDeviceRecord; public: PairedDevicePublic }> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const now = this.now();

      // QR path (no user token): reuse an unused code when Pairing opens again, instead of stacking
      // another "Phone" row the owner never paired with. `fresh: true` is "Show a new code".
      if (input.token === undefined && input.fresh !== true) {
        const reusable = this.devices
          .filter((d) => isUnusedQr(d) && isActive(d, now))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (reusable) {
          if (this.pruneUnusedQrCodes({ keepId: reusable.id })) await this.persist();
          return { record: reusable, public: publicOf(reusable) };
        }
      }

      let token: string;
      if (input.token !== undefined) {
        const normalized = normalizeUserPairingToken(input.token);
        if (!normalized.ok) {
          throw new Error(
            normalized.reason === "length"
              ? `token must be ${USER_PAIRING_TOKEN_MIN_LEN}–${USER_PAIRING_TOKEN_MAX_LEN} characters`
              : "token must be letters and digits only",
          );
        }
        const taken = this.devices.some((d) => d.token === normalized.token && isActive(d, now));
        if (taken) {
          throw new Error("that token is already in use by another pairing code");
        }
        token = normalized.token;
      } else {
        // New QR secret: drop every unused QR first so "Show a new code" replaces clutter.
        this.pruneUnusedQrCodes({ keepId: null });
        token = randomBytes(24).toString("base64url");
      }
      const ttl = input.ttlMs ?? DEFAULT_PAIRING_TTL_MS;
      const record: PairedDeviceRecord = {
        id: `pad_${randomBytes(8).toString("hex")}`,
        token,
        deviceLabel: (input.deviceLabel?.trim() || "Phone").slice(0, 80),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttl).toISOString(),
      };
      this.devices = [...this.devices, record];
      await this.persist();
      return { record, public: publicOf(record) };
    });
  }

  /**
   * Revoke every active row but the newest for each `clientId`.
   *
   * Runs on `list()` as well as on a re-pair, so a list that accumulated before this store recorded identities
   * heals the next time the owner looks at it. Rows without a `clientId` are left exactly as they are: they
   * cannot be attributed, and a wrong collapse here revokes somebody else's device.
   */
  private collapseSameDevice(): boolean {
    const newest = new Map<string, PairedDeviceRecord>();
    for (const device of this.devices) {
      if (device.clientId === undefined || device.revokedAt !== undefined) continue;
      const seen = newest.get(device.clientId);
      if (seen === undefined || device.createdAt > seen.createdAt) newest.set(device.clientId, device);
    }
    let collapsed = false;
    for (const device of this.devices) {
      if (device.clientId === undefined || device.revokedAt !== undefined) continue;
      const keep = newest.get(device.clientId);
      if (keep === undefined || keep.id === device.id) continue;
      device.revokedAt = this.now().toISOString();
      collapsed = true;
    }
    return collapsed;
  }

  /**
   * Drop unused QR pairing codes that never authenticated a phone.
   *
   * These are not security evidence (nothing was revoked; nothing connected). They accumulate when
   * Pairing auto-mints on open. User-chosen short tokens, used devices, and explicitly revoked rows
   * are kept.
   *
   * @param keepId keep this record; `null` keep none; omit + `keepNewest` keep the newest active unused QR
   */
  private pruneUnusedQrCodes(
    options: { keepId?: string | null; keepNewest?: boolean } = {},
  ): boolean {
    const now = this.now();
    let keepId = options.keepId;
    if (keepId === undefined && options.keepNewest === true) {
      keepId =
        this.devices
          .filter((d) => isUnusedQr(d) && isActive(d, now))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id ?? null;
    }
    const next = this.devices.filter((d) => {
      if (keepId && d.id === keepId) return true;
      if (!isUnusedQr(d)) return true;
      return false;
    });
    if (next.length === this.devices.length) return false;
    this.devices = next;
    return true;
  }

  revoke(id: string): Promise<PairedDevicePublic | null> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const index = this.devices.findIndex((d) => d.id === id);
      if (index < 0) return null;
      const now = this.now().toISOString();
      const next = { ...this.devices[index]!, revokedAt: now };
      this.devices = this.devices.map((d, i) => (i === index ? next : d));
      await this.persist();
      return publicOf(next);
    });
  }

  /**
   * Remove a **revoked** record from the list.
   *
   * ## Why this refuses an active record instead of revoking it first
   *
   * The revoked row is the evidence that a token was withdrawn: the store deliberately keeps it, and
   * revocation is a security event, not a delete. A caller that could "forget" an active record would
   * destroy the only row naming a token that still works — so this refuses, and the two steps stay
   * explicit. The store never prunes on its own for the same reason: an automatic delete would make the
   * evidence disappear without the owner deciding that it should.
   *
   * Expiry needs no special case here: an expired but unrevoked record is still not `revokedAt` set, so
   * it is refused on the same terms and can be revoked (or left to read as expired) first.
   */
  forget(id: string): Promise<ForgetPairedDeviceOutcome> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const record = this.devices.find((d) => d.id === id);
      if (!record) return { kind: "missing" };
      if (!record.revokedAt) return { kind: "not-revoked" };
      this.devices = this.devices.filter((d) => d.id !== id);
      await this.persist();
      return { kind: "forgotten", device: publicOf(record) };
    });
  }

  /**
   * Resolve a bearer token into a host session, or `null` when it is unknown / expired / revoked.
   *
   * Side effect: updates `lastSeenAt` for an active match (best-effort; failure does not refuse).
   */
  async resolveSession(
    token: string,
    client?: { id?: string; name?: string; platform?: string },
  ): Promise<PairedSession | null> {
    await this.ensureLoaded();
    const now = this.now();
    const match = this.devices.find((d) => d.token === token);
    if (!match || !isActive(match, now)) return null;

    let changed = false;
    // Recorded once, on first sight: a client that identifies itself later is still the same row.
    if (client?.id !== undefined && match.clientId === undefined) {
      match.clientId = client.id;
      changed = true;
    }
    if (client?.name !== undefined && match.clientName === undefined) {
      match.clientName = client.name;
      // The label the owner reads. "Phone" for every row is what made the list useless.
      match.deviceLabel = client.name.slice(0, 80);
      changed = true;
    }
    if (client?.platform !== undefined && match.clientPlatform === undefined) {
      match.clientPlatform = client.platform;
      changed = true;
    }

    /**
     * **One live row per device.**
     *
     * A phone that pairs again carries a *new* token, and the row it used before stays active — a working
     * credential nobody is watching, which is why revoking "the phone" appeared to work while it stayed
     * connected. The older row is **revoked, never deleted**: the phone may still be holding that token, and a
     * refusal it can see beats a token that behaves strangely.
     *
     * Only rows that share a `clientId` are touched. Guessing from a label would revoke somebody else's phone,
     * and this is the one list in the product where a wrong guess is a security failure.
     */
    if (match.clientId !== undefined) {
      for (const other of this.devices) {
        if (other.id === match.id || other.revokedAt !== undefined) continue;
        if (other.clientId !== match.clientId) continue;
        other.revokedAt = now.toISOString();
        changed = true;
      }
    }

    const seen = now.toISOString();
    if (match.lastSeenAt !== seen) {
      match.lastSeenAt = seen;
      changed = true;
    }
    if (changed) {
      void this.enqueue(async () => {
        await this.persist();
      });
    }
    return {
      // The product scope is what the transport routes on; the *owner* is the machine's identity.
      scopeKey: `product:${ENVOYDEV_PRODUCT_NAME}`,
      ownerId: (await this.readOwnerId()) ?? ENVOYDEV_PRODUCT_NAME,
      isOwnerScope: true,
      deviceId: match.id,
      caller: { kind: "owner-device", deviceId: match.id, label: match.deviceLabel },
    };
  }
}

function isRecord(value: unknown): value is PairedDeviceRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PairedDeviceRecord>;
  return (
    typeof row.id === "string" &&
    typeof row.token === "string" &&
    typeof row.deviceLabel === "string" &&
    typeof row.createdAt === "string" &&
    typeof row.expiresAt === "string"
  );
}

export function pairedDevicesFile(paths: CoderPaths): string {
  return join(paths.stateDir, "paired-devices.json");
}
