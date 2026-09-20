/**
 * The service store methods, proved without a DOM: the answer is the supervisor's, not the press's.
 *
 * ## The rule this file holds
 *
 * A service press is a **request to the operating system** that can be granted and still not leave the
 * service running (the acceptance is not the process — `docs/daemon-lifecycle.md` §6 records the launchd
 * lesson: "an accepted job is not yet a running one"). So `coderStore` adopts the `{ service }` the daemon
 * *returned* and never the state a press was expected to produce, and a refusal leaves the last known status
 * untouched rather than clearing it to an optimistic value.
 *
 * The mutation each case fails on is named in the case. The connection is faked at the store's own seam, the
 * same way `coder-store.test.ts` does it: what the store does with an answer is the contract, and the socket's
 * bytes are somebody else's test.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_CODER_SETTINGS, type DaemonServiceStatus } from "@envoydev/protocol";

import type { CoderConnection, ConnectionStatus, HelloResult } from "../src/client/connection.js";
import type { ResolvedEndpoint } from "../src/client/endpoint.js";
import { createCoderStore, type CoderStore } from "../src/state/coderStore.js";

class FakeConnection {
  readonly answers = new Map<string, unknown>();
  readonly refusals = new Map<string, string>();
  readonly calls: string[] = [];
  readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  status: ConnectionStatus = { state: "idle" };
  hello: HelloResult | undefined;

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  on(): () => void {
    return () => {};
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    void params;
    this.calls.push(method);
    const refusal = this.refusals.get(method);
    if (refusal !== undefined) return Promise.reject(new Error(refusal));
    if (!this.answers.has(method)) return Promise.reject(new Error(`no answer staged for ${method}`));
    return Promise.resolve(this.answers.get(method));
  }

  callTyped<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.call(method, params) as Promise<T>;
  }

  start(): void {
    this.setStatus({ state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } });
  }

  dispose(): void {
    this.setStatus({ state: "idle" });
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of [...this.statusListeners]) listener(status);
  }
}

const endpoint: ResolvedEndpoint = {
  endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" },
  verifiedBy: "shell",
};

/**
 * A connected store whose daemon answers the boot list, so the service calls are the only interesting ones.
 *
 * `hello` is set **before** the connection reports itself open, because that is the real order: the transport
 * verifies the handshake and hands the store the daemon's own method catalogue at the same moment it says
 * "connected" (`CoderStore.open`).
 */
async function bench(hello?: HelloResult): Promise<{ store: CoderStore; connection: FakeConnection }> {
  const connection = new FakeConnection();
  connection.hello = hello;
  connection.answers.set("coder.listProjects", { projects: [] });
  connection.answers.set("coder.listTasks", { tasks: [] });
  connection.answers.set("coder.getSettings", { settings: DEFAULT_CODER_SETTINGS });
  connection.answers.set("coder.listHarnesses", { harnesses: [] });
  connection.answers.set("coder.listProviders", { providers: [] });
  connection.answers.set("coder.listCatalog", { entries: [] });
  connection.answers.set("coder.meshStatus", { mesh: { kind: "no-node", reason: "" } });
  const store = createCoderStore({
    resolveEndpoint: async () => endpoint,
    connect: () => connection as unknown as CoderConnection,
  });
  await store.start();
  // The store subscribes and connects synchronously; `loadAll` runs on the status callback.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { store, connection };
}

describe("the service calls, as the store records them", () => {
  it("adopts the status the daemon returned rather than the one the press implied", async () => {
    // **The mutation this fails on:** storing a locally-guessed state after a press — "installing means
    // running" — which shows a running service the supervisor refused to bootstrap.
    const { store, connection } = await bench();
    const off: DaemonServiceStatus = {
      state: "not-installed",
      detail: "Could not find service",
      restartsInLastHour: 0,
    };
    connection.answers.set("coder.getServiceStatus", { service: off });
    await expect(store.getServiceStatus()).resolves.toEqual({ ok: true, service: off });
    expect(store.getSnapshot().service).toEqual(off);

    // The supervisor accepted the job and has not started it yet — the answer the store must keep.
    const accepted: DaemonServiceStatus = {
      state: "installed-stopped",
      enabled: true,
      detail: "state = waiting",
      restartsInLastHour: 0,
    };
    connection.answers.set("coder.installService", { service: accepted });
    await expect(store.installService()).resolves.toEqual({ ok: true, service: accepted });
    expect(store.getSnapshot().service).toEqual(accepted);
  });

  it("keeps the last known status when the daemon refuses the press", async () => {
    // **The mutation this fails on:** clearing `service` to `undefined` (or to a guess) on a refusal, which
    // turns "the OS would not let me change it" into "I do not know what it is".
    const { store, connection } = await bench();
    const running: DaemonServiceStatus = {
      state: "running",
      enabled: true,
      pid: 9,
      detail: "",
      restartsInLastHour: 0,
    };
    connection.answers.set("coder.getServiceStatus", { service: running });
    await store.getServiceStatus();

    connection.refusals.set("coder.uninstallService", "envoydev.owner-window-only: refused");
    const answer = await store.uninstallService();
    expect(answer.ok).toBe(false);
    expect(store.getSnapshot().service).toEqual(running);
  });

  it("acknowledges a stop without inventing the status the daemon has not answered yet", async () => {
    // **The mutation this fails on:** writing `not-installed` (or anything else) into `state.service` when
    // `coder.shutdown` answers. The answer only says the request was accepted; the daemon is still draining,
    // and the next read — or the service manager's own answer once it is gone — is what is true.
    const { store, connection } = await bench();
    const running: DaemonServiceStatus = {
      state: "running",
      enabled: true,
      pid: 9,
      detail: "",
      restartsInLastHour: 0,
    };
    connection.answers.set("coder.getServiceStatus", { service: running });
    await store.getServiceStatus();

    connection.answers.set("coder.shutdown", { stopping: true });
    await expect(store.shutdown()).resolves.toEqual({ ok: true, stopping: true });
    // The row re-reads for the new status; the store has not guessed one in the meantime.
    expect(store.getSnapshot().service).toEqual(running);
  });

  it("does not call a method the daemon's own catalogue does not have", async () => {
    // Old daemon, new window: the read is version-skew aware, so the refusal names the build rather than the
    // method, and nothing is sent to a daemon that cannot serve it. The mutation is dropping the `canCall`
    // guard, which turns one "restart so both come from one build" into a round trip that answers the same
    // fact in the transport's own words.
    const { store, connection } = await bench({
      product: "EnvoyDev",
      version: "0.0.1",
      instanceId: "old",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyDev",
      startedAt: "2026-09-14T00:00:00.000Z",
      windowCount: 1,
      methods: ["coder.getSettings"],
      mesh: { kind: "no-node" },
      notes: [],
    });
    const before = connection.calls.length;

    const answer = await store.getServiceStatus();
    expect(answer.ok).toBe(false);
    expect(connection.calls.length).toBe(before);
    expect(store.getSnapshot().service).toBeUndefined();
  });

  it("returns the log tail without putting it in the window's snapshot", async () => {
    // **The mutation this fails on:** storing the log in `CoderState`. Every consumer of the store takes the whole
    // object, so a log in the snapshot re-renders every surface in the window for a block one disclosure owns.
    const { store, connection } = await bench();
    const log = { path: "/home/you/logs/daemon.log", lines: ["one", "two"], truncated: true };
    connection.answers.set("coder.getDaemonLog", { log });
    const before = store.getSnapshot();

    await expect(store.getDaemonLog()).resolves.toEqual({ ok: true, log });
    // The same snapshot object: nothing was `set`, so nothing re-rendered.
    expect(store.getSnapshot()).toBe(before);
  });

  it("answers a refused log read with the refusal rather than an empty tail", async () => {
    // A daemon log is owner-window-only; "refused" and "this file is empty" must not look alike.
    const { store, connection } = await bench();
    connection.refusals.set("coder.getDaemonLog", "envoydev.owner-window-only: refused");
    const answer = await store.getDaemonLog();
    expect(answer.ok).toBe(false);
  });
});
