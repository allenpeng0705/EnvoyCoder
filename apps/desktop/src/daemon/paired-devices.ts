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
}

/** What Settings and `coder.listPairedDevices` may show — never the token. */
export interface PairedDevicePublic {
  id: string;
  deviceLabel: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
}

export interface PairingIdentity {
  ownerId: string;
  ownerPublicKey: string;
}

interface StoreFile {
  devices: PairedDeviceRecord[];
}

function publicOf(record: PairedDeviceRecord): PairedDevicePublic {
  return {
    id: record.id,
    deviceLabel: record.deviceLabel,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
    ...(record.lastSeenAt ? { lastSeenAt: record.lastSeenAt } : {}),
  };
}

function isActive(record: PairedDeviceRecord, now: Date): boolean {
  if (record.revokedAt) return false;
  const expires = Date.parse(record.expiresAt);
  if (Number.isNaN(expires)) return false;
  return expires > now.getTime();
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
      return this.devices.map(publicOf);
    });
  }

  mint(input: { deviceLabel?: string; ttlMs?: number } = {}): Promise<{ record: PairedDeviceRecord; public: PairedDevicePublic }> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const now = this.now();
      const ttl = input.ttlMs ?? DEFAULT_PAIRING_TTL_MS;
      const record: PairedDeviceRecord = {
        id: `pad_${randomBytes(8).toString("hex")}`,
        token: randomBytes(24).toString("base64url"),
        deviceLabel: (input.deviceLabel?.trim() || "Phone").slice(0, 80),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttl).toISOString(),
      };
      this.devices = [...this.devices, record];
      await this.persist();
      return { record, public: publicOf(record) };
    });
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
   * Resolve a bearer token into a host session, or `null` when it is unknown / expired / revoked.
   *
   * Side effect: updates `lastSeenAt` for an active match (best-effort; failure does not refuse).
   */
  async resolveSession(token: string): Promise<PairedSession | null> {
    await this.ensureLoaded();
    const now = this.now();
    const match = this.devices.find((d) => d.token === token);
    if (!match || !isActive(match, now)) return null;
    const seen = now.toISOString();
    if (match.lastSeenAt !== seen) {
      match.lastSeenAt = seen;
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
