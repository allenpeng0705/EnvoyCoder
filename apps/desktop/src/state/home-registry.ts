/**
 * Local home + paired EnvoyDev homes — one active work surface at a time.
 *
 * `docs/envoydev-paired-homes.md`: the local `CoderStore` singleton stays the laptop daemon; each
 * paired home gets its own `CoderStore` with a tokenised connection. The rail may list many homes;
 * the pane reads `activeStore()`.
 */

import { CoderConnection } from "../client/connection.js";
import type { ResolvedEndpoint } from "../client/endpoint.js";
import { DEFAULT_CODER_SETTINGS } from "@envoydev/protocol";

import {
  createCoderStore,
  getCoderStore,
  type CoderState,
  type CoderStore,
} from "./coderStore.js";
import { homeFromDirect, homeFromSsh } from "./home-join.js";
import {
  defaultHomeSshForwardOpener,
  isLoopbackHost,
  type HomeSshForwardOpener,
} from "./home-ssh-forward.js";
import {
  LOCAL_HOME_ID,
  type HomeId,
  type PairedHomeRecord,
  type PairedHomeStore,
  homeFromPairingUri,
} from "./paired-homes.js";

export interface HomeTreeSnapshot {
  activeHomeId: HomeId;
  local: CoderState;
  homes: readonly {
    record: PairedHomeRecord;
    state: CoderState;
  }[];
}

function clientPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad/.test(ua)) return "darwin";
  if (/Windows/.test(ua)) return "win32";
  if (/Linux/.test(ua)) return "linux";
  return "unknown";
}

export class HomeRegistry {
  private activeHomeId: HomeId = LOCAL_HOME_ID;
  private readonly remote = new Map<string, CoderStore>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubs: (() => void)[] = [];
  private started = false;
  /**
   * Cached for `useSyncExternalStore`: React compares snapshots by identity. Building a fresh object
   * on every `getSnapshot` looks like a change every render and blanks the window (infinite updates).
   */
  private snapshot: HomeTreeSnapshot;
  private readonly openSshForward: HomeSshForwardOpener;

  constructor(
    private readonly homes: PairedHomeStore,
    options?: { openSshForward?: HomeSshForwardOpener },
  ) {
    this.openSshForward = options?.openSshForward ?? defaultHomeSshForwardOpener;
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): HomeTreeSnapshot => this.snapshot;

  activeHomeIdValue(): HomeId {
    return this.activeHomeId;
  }

  /** Store for the work surface (composer, task pane, settings that follow focus). */
  activeStore(): CoderStore {
    return this.storeFor(this.activeHomeId);
  }

  storeFor(id: HomeId): CoderStore {
    if (id === LOCAL_HOME_ID) return getCoderStore();
    return this.remote.get(id) ?? getCoderStore();
  }

  /** Always the laptop daemon — pairing mint, local Agents/LLM, paired-homes credentials. */
  localStore(): CoderStore {
    return getCoderStore();
  }

  pairedHomeStore(): PairedHomeStore {
    return this.homes;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.homes.load();
    const local = getCoderStore();
    this.unsubs.push(local.subscribe(() => this.emit()));
    this.unsubs.push(this.homes.subscribe(() => this.emit()));
    void local.start();
    for (const record of this.homes.list()) {
      this.ensureRemote(record);
    }
    this.emit();
  }

  setActiveHome(id: HomeId): void {
    if (id !== LOCAL_HOME_ID && !this.homes.get(id)) return;
    this.activeHomeId = id;
    this.emit();
  }

  async joinFromUri(
    uri: string,
    label?: string,
    sshHop?: string,
  ): Promise<PairedHomeRecord | { error: string }> {
    const parsed = await homeFromPairingUri(uri, label);
    if ("error" in parsed) return parsed;
    return this.commitJoin({
      ...parsed,
      ...(sshHop?.trim() ? { sshHop: sshHop.trim() } : {}),
    });
  }

  /** host:port + token — same Direct TCP path as the phone. */
  async joinFromDirect(
    endpoint: string,
    token: string,
    label?: string,
  ): Promise<PairedHomeRecord | { error: string }> {
    const parsed = homeFromDirect({ endpoint, token, label });
    if ("error" in parsed) return parsed;
    return this.commitJoin(parsed);
  }

  /** SSH hop + daemon address + token — same Remote SSH path as the phone. */
  async joinFromSsh(input: {
    sshHost: string;
    sshPort?: string;
    sshUser?: string;
    daemonEndpoint: string;
    token: string;
    label?: string;
  }): Promise<PairedHomeRecord | { error: string }> {
    const parsed = homeFromSsh(input);
    if ("error" in parsed) return parsed;
    return this.commitJoin(parsed);
  }

  private async commitJoin(
    parsed: {
      label: string;
      host: string;
      port: number;
      path: string;
      token: string;
      sshHop?: string;
    },
  ): Promise<PairedHomeRecord> {
    const record = await this.homes.add(parsed);
    this.ensureRemote(record);
    this.activeHomeId = record.id;
    this.emit();
    return record;
  }

  /**
   * Drop and reopen a remote session (after revoke recovery, or when the user focuses an offline home).
   * The pairing token is unchanged; a home that revoked the device will fail hello again until re-paired.
   */
  retryHome(id: string): void {
    const record = this.homes.get(id);
    if (!record) return;
    this.ensureRemote(record);
    this.emit();
  }

  async forgetHome(id: string): Promise<void> {
    const store = this.remote.get(id);
    store?.dispose();
    this.remote.delete(id);
    await this.homes.forget(id);
    if (this.activeHomeId === id) this.activeHomeId = LOCAL_HOME_ID;
    this.emit();
  }

  async renameHome(id: string, label: string): Promise<void> {
    await this.homes.rename(id, label);
    this.emit();
  }

  dispose(): void {
    for (const u of this.unsubs.splice(0)) u();
    for (const store of this.remote.values()) store.dispose();
    this.remote.clear();
    this.started = false;
    this.snapshot = this.buildSnapshot();
  }

  private ensureRemote(record: PairedHomeRecord): void {
    if (this.remote.has(record.id)) {
      // Token/label may have been updated — dispose and reopen.
      this.remote.get(record.id)?.dispose();
      this.remote.delete(record.id);
    }
    const clientId = this.homes.clientId();
    const openSshForward = this.openSshForward;
    const store = createCoderStore({
      resolveEndpoint: async (): Promise<ResolvedEndpoint> => {
        // SSH join stores the far-side daemon (often 127.0.0.1). Dialling that on *this* laptop is a
        // lie — open a local-forward through the saved hop first (shell), same story as the phone.
        if (record.sshHop && isLoopbackHost(record.host)) {
          const local = await openSshForward(record.sshHop, record.port, record.path);
          return {
            endpoint: {
              host: local.host,
              port: local.port,
              path: local.path,
            },
            verifiedBy: "none",
          };
        }
        return {
          endpoint: {
            host: record.host,
            port: record.port,
            path: record.path,
          },
          // Pairing token authenticates; there is no shell claim file for a remote home.
          verifiedBy: "none",
        };
      },
      connect: (resolved) =>
        new CoderConnection({
          endpoint: resolved.endpoint,
          token: record.token,
          client: {
            name: record.label || "EnvoyDev",
            platform: clientPlatform(),
            id: clientId,
          },
        }),
    });
    this.remote.set(record.id, store);
    this.unsubs.push(store.subscribe(() => this.emit()));
    void store.start();
  }

  private buildSnapshot(): HomeTreeSnapshot {
    return {
      activeHomeId: this.activeHomeId,
      local: getCoderStore().getSnapshot(),
      homes: this.homes.list().map((record) => ({
        record,
        state: this.remote.get(record.id)?.getSnapshot() ?? EMPTY_REMOTE_STATE,
      })),
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Stable empty remote row — never allocate per `getSnapshot` read. */
const EMPTY_REMOTE_STATE: CoderState = {
  connection: { state: "idle" },
  resolved: undefined,
  hello: undefined,
  projects: [],
  tasks: [],
  tasksKnown: false,
  git: {},
  settings: DEFAULT_CODER_SETTINGS,
  harnesses: [],
  providers: [],
  catalog: [],
  mesh: { kind: "no-node", reason: "" },
  runs: {},
  jobsRevision: 0,
  loaded: false,
  error: undefined,
  notes: [],
};

let registrySingleton: HomeRegistry | undefined;

export function getHomeRegistry(homes?: PairedHomeStore): HomeRegistry {
  if (!registrySingleton) {
    if (!homes) {
      throw new Error("getHomeRegistry: first call needs a PairedHomeStore");
    }
    registrySingleton = new HomeRegistry(homes);
  }
  return registrySingleton;
}

/** Tests only — drop the singleton. */
export function resetHomeRegistryForTests(): void {
  registrySingleton?.dispose();
  registrySingleton = undefined;
}
