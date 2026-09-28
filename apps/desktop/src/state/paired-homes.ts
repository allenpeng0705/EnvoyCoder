/**
 * Paired EnvoyDev homes — credentials the laptop keeps for thin-client sessions.
 *
 * Normative design: `docs/envoydev-paired-homes.md`. Tokens are the credential; persistence goes
 * through an injectable `PairedHomesStorage` so tests use memory and the shell owns the on-disk file
 * (never only the webview).
 */

import { readPairingUri } from "./pairing-uri.js";

export const LOCAL_HOME_ID = "local" as const;

export type HomeId = typeof LOCAL_HOME_ID | string;

export interface PairedHomeRecord {
  id: string;
  label: string;
  host: string;
  port: number;
  path: string;
  token: string;
  /** When this laptop first joined. */
  addedAt: string;
  /** Optional SSH hop string for dial (Phase 4); unused in LAN joins. */
  sshHop?: string;
}

export interface PairedHomesFile {
  version: 1;
  /** Install-stable id sent on `coder.hello` for every paired-home session. */
  clientId: string;
  homes: PairedHomeRecord[];
}

export interface PairedHomesStorage {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `home-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `envoydev-desktop-${crypto.randomUUID()}`;
  return `envoydev-desktop-${Date.now()}`;
}

function parseFile(text: string | undefined): PairedHomesFile {
  if (!text || text.trim() === "") {
    return { version: 1, clientId: newClientId(), homes: [] };
  }
  try {
    const raw = JSON.parse(text) as Partial<PairedHomesFile>;
    const clientId = typeof raw.clientId === "string" && raw.clientId.length > 0 ? raw.clientId : newClientId();
    const homes = Array.isArray(raw.homes) ? raw.homes.filter(isHomeRecord) : [];
    return { version: 1, clientId, homes };
  } catch {
    return { version: 1, clientId: newClientId(), homes: [] };
  }
}

function isHomeRecord(value: unknown): value is PairedHomeRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.label === "string" &&
    typeof r.host === "string" &&
    typeof r.port === "number" &&
    typeof r.path === "string" &&
    typeof r.token === "string" &&
    typeof r.addedAt === "string"
  );
}

/** In-memory storage for tests. */
export function memoryPairedHomesStorage(initial?: string): PairedHomesStorage {
  let text = initial;
  return {
    async read() {
      return text;
    },
    async write(next) {
      text = next;
    },
  };
}

export type HomeFromPairing =
  | { host: string; port: number; path: string; token: string; label: string }
  | { error: string };

/**
 * Parse an `envoy://pair?…` URI into endpoint + token for joining a home.
 *
 * Accepts both the compressed `pairing=` form the home mints for QR and the legacy query-string
 * form (typed host:port). Prefers `lanWsUrl` when the code carries one — same order as the phone.
 */
export async function homeFromPairingUri(uri: string, label?: string): Promise<HomeFromPairing> {
  // Window-safe reader — never `@envoydev/host-bridge` (that barrel blanks the webview).
  const check = await readPairingUri(uri.trim());
  if (!check.ok) return { error: check.message };
  const ws = check.lanWsUrl || check.wsUrl;
  let parsed: URL;
  try {
    parsed = new URL(ws);
  } catch {
    return { error: "That link's address is not a URL." };
  }
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "wss:" ? 443 : 80;
  if (!host || !Number.isFinite(port)) return { error: "That link's address is incomplete." };
  const path = parsed.pathname && parsed.pathname.length > 0 ? parsed.pathname : "/ws";
  const fromOwner = check.ownerId.replace(/^envoy:owner:/, "") || host;
  return {
    host,
    port,
    path,
    token: check.token,
    label: (label?.trim() || fromOwner || host).slice(0, 64),
  };
}

export class PairedHomeStore {
  private file: PairedHomesFile = { version: 1, clientId: newClientId(), homes: [] };
  private loaded = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: PairedHomesStorage) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly PairedHomeRecord[] => this.file.homes;

  clientId(): string {
    return this.file.clientId;
  }

  async load(): Promise<void> {
    const text = await this.storage.read();
    const previousClientId =
      typeof text === "string"
        ? (() => {
            try {
              const raw = JSON.parse(text) as { clientId?: unknown };
              return typeof raw.clientId === "string" && raw.clientId.length > 0 ? raw.clientId : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined;
    this.file = parseFile(text);
    this.loaded = true;
    // Only rewrite when we minted a clientId the disk did not have. Unconditional write raced with
    // other windows' add/forget and could drop homes (Bugbot: load rewrites credentials).
    if (previousClientId === undefined || previousClientId !== this.file.clientId) {
      await this.storage.write(JSON.stringify(this.file, null, 2));
    }
    this.emit();
  }

  list(): readonly PairedHomeRecord[] {
    return this.file.homes;
  }

  get(id: string): PairedHomeRecord | undefined {
    return this.file.homes.find((h) => h.id === id);
  }

  async add(input: {
    label: string;
    host: string;
    port: number;
    path: string;
    token: string;
    sshHop?: string;
  }): Promise<PairedHomeRecord> {
    await this.ensureLoaded();
    const existing = this.file.homes.find(
      (h) => h.host === input.host && h.port === input.port && h.path === input.path,
    );
    if (existing) {
      const updated: PairedHomeRecord = {
        ...existing,
        label: input.label.trim() || existing.label,
        token: input.token,
        ...(input.sshHop ? { sshHop: input.sshHop } : {}),
      };
      this.file = {
        ...this.file,
        homes: this.file.homes.map((h) => (h.id === existing.id ? updated : h)),
      };
      await this.persist();
      return updated;
    }
    const record: PairedHomeRecord = {
      id: newId(),
      label: input.label.trim() || input.host,
      host: input.host,
      port: input.port,
      path: input.path.startsWith("/") ? input.path : `/${input.path}`,
      token: input.token,
      addedAt: new Date().toISOString(),
      ...(input.sshHop ? { sshHop: input.sshHop } : {}),
    };
    this.file = { ...this.file, homes: [...this.file.homes, record] };
    await this.persist();
    return record;
  }

  async rename(id: string, label: string): Promise<PairedHomeRecord | undefined> {
    await this.ensureLoaded();
    const trimmed = label.trim();
    if (!trimmed) return this.get(id);
    let found: PairedHomeRecord | undefined;
    this.file = {
      ...this.file,
      homes: this.file.homes.map((h) => {
        if (h.id !== id) return h;
        found = { ...h, label: trimmed };
        return found;
      }),
    };
    if (found) await this.persist();
    return found;
  }

  async forget(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.file.homes.length;
    this.file = { ...this.file, homes: this.file.homes.filter((h) => h.id !== id) };
    if (this.file.homes.length === before) return false;
    await this.persist();
    return true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  private async persist(): Promise<void> {
    await this.storage.write(JSON.stringify(this.file, null, 2));
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* one subscriber must not break others */
      }
    }
  }
}
