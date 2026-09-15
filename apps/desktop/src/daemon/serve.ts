/**
 * Starting the daemon, as a function rather than a script.
 *
 * ## Why this is not `main.ts`
 *
 * `main.ts` is a top-level-await script that reads the environment, prints a boot report, installs
 * signal handlers and calls `process.exit`. None of that is testable, and all of it is the *least*
 * interesting part of the daemon. What matters — the store, the handlers, the event bus, the claim,
 * the host — is here, so a test can boot a real daemon on a real socket, talk to it with a real
 * WebSocket client, and shut it down, all inside one process.
 *
 * That is not a nicety. The scaffold's own lesson (`AGENTS.md`, "Tests and the bundle are different
 * proofs") is that a green unit suite has already shipped a broken import path here: the parts that
 * only fail when something actually listens are exactly the parts a caller-object unit test cannot
 * reach.
 *
 * ## Ordering is the contract
 *
 * The claim is published **after** `serve()` resolves, and removed **only if it is still ours**.
 * Both are load-bearing:
 *
 *   * a claim written before the socket listens sends the next window to a dead endpoint, and that
 *     window reports "the daemon is not answering" for a daemon that is starting perfectly well;
 *   * an unconditional delete on shutdown races a replacement daemon — a slow stop can outlive its
 *     own successor, and removing the *new* claim leaves a healthy daemon nobody can find.
 */

import { randomUUID } from "node:crypto";
import process from "node:process";

import {
  type CoderMeshStatus,
  DEFAULT_DAEMON_PATH,
  DEFAULT_DAEMON_PORT,
  ENVOYCODER_PRODUCT_NAME,
} from "@envoycoder/protocol";
import {
  type CoderPaths,
  coderPaths,
  coderSessionIdentity,
  createCoderDaemonHost,
  createCoderDispatcher,
} from "@envoycoder/host-bridge";
import { primeSearchPath, type SearchPath } from "@envoycoder/platform";

import type { AcpLaunch } from "./acp/client.js";
import { AcpClient } from "./acp/client.js";
import { createCoderEventBus, createCoderSocketMethods, createNodeService } from "./events.js";
import { clearDaemonClaim, writeDaemonClaim } from "./lock.js";
import { RunManager } from "./runs.js";
import { SessionProbe } from "./session-probe.js";
import { SessionSignIn } from "./sign-in.js";
import { createCoderHandlers } from "./service.js";
import { CoderStore } from "./store.js";

export interface StartCoderDaemonOptions {
  /** `0` lets the OS choose, which is what tests use. */
  port?: number;
  path?: string;
  /** Defaults to the family's resolution (`ENVOYMESH_HOME`, per-OS default, legacy adoption). */
  home?: string;
  /** Overrides the resolved paths wholesale — the test hook for a temporary state directory. */
  paths?: CoderPaths;
  version?: string;
  instanceId?: string;
  /** Skip the mesh attach. Used by tests, which have no node and should not wait for one. */
  skipMeshAttach?: boolean;
  /** Injected so a test does not depend on which agents happen to be installed. */
  mesh?: () => CoderMeshStatus;
  isDirectory?: (path: string) => Promise<boolean>;
  /**
   * Injected by tests that must not spawn real agent processes.
   *
   * One seam for three flows — a run (`RunManager`), the pre-flight probe and the sign-in — which is the
   * point of it being one option rather than three: a fixture agent is driven by the production path, so
   * what a test proves about the handshake is what a user gets.
   */
  startClient?: typeof AcpClient.start;
  resolveLaunch?: (input: {
    harness: import("@envoycoder/protocol").HarnessId;
    cwd: string;
    extraArgs?: string;
    model?: string;
  }) => AcpLaunch;
  platform?: import("@envoycoder/platform").PlatformId;
}

export interface StartedCoderDaemon {
  readonly instanceId: string;
  readonly port: number;
  readonly path: string;
  readonly paths: CoderPaths;
  readonly store: CoderStore;
  /** The mesh as this daemon sees it, live. */
  mesh(): CoderMeshStatus;
  /** How many clients are attached right now, counting this process as one. */
  connectionCount(): number;
  /**
   * The agent search path, once the login shell has answered.
   *
   * Exposed because a *test* has to be able to wait for it — every other caller uses the synchronous
   * `currentSearchPath()` and never waits for anything. It resolves rather than rejects: a shell that is
   * absent, slow or hostile is not a daemon failure, it is the fallback answer.
   */
  searchPath(): Promise<SearchPath>;
  stop(): Promise<void>;
}

export async function startCoderDaemon(options: StartCoderDaemonOptions = {}): Promise<StartedCoderDaemon> {
  const paths = options.paths ?? coderPaths(options.home);
  const instanceId = options.instanceId ?? randomUUID();
  const version = options.version ?? "0.1.0";
  let connections = 1;

  const store = await CoderStore.open({ paths });
  const bus = createCoderEventBus();

  // Resolved once, at boot, and reported as a state rather than retried in a loop: the mesh is
  // optional and its answer changes what the status line says, not whether the daemon serves. The
  // attach is injected by tests, which have no node to attach to and should not wait for one.
  const mesh: CoderMeshStatus = options.mesh
    ? options.mesh()
    : options.skipMeshAttach
      ? {
          kind: "no-node",
          reason: "Mesh attach was skipped for this daemon (it was started without one).",
        }
      : ((await meshAttach(paths.home)) as CoderMeshStatus);

  // Every run event goes onto the bus, and each subscribed connection receives it. That is the only
  // path by which a transcript reaches a window: the daemon never sends a client a frame it did not
  // ask for (`CODER_EVENTS` in `@envoycoder/protocol` explains why subscription works this way).
  const runs = new RunManager({
    paths,
    store,
    onEvent: (event) => bus.emit("coder:run-event", event),
    ...(options.startClient ? { startClient: options.startClient } : {}),
    ...(options.resolveLaunch ? { resolveLaunch: options.resolveLaunch } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
  });

  /**
   * The probe: built here beside the run manager, and **started by nothing**.
   *
   * It takes the same two injections a run does — the launch resolver and the client constructor — so a
   * test that drives a fixture agent drives the probe through the same seam, and so a probe can never be
   * exercised against a different spawn path than the one it uses in production. Nothing is probed at
   * boot: the only caller is `coder.probeSessionOptions`, which a window sends when a control actually
   * needs a list.
   */
  const probeSession = new SessionProbe({
    paths,
    store,
    ...(options.startClient ? { startClient: options.startClient } : {}),
    ...(options.resolveLaunch ? { resolveLaunch: options.resolveLaunch } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
  });

  /**
   * The sign-in flow: the same two injections, the same launch resolver, the same client constructor.
   *
   * Built here beside the probe because they are siblings — two short-lived agent processes that belong to
   * the daemon rather than to a task — and **started by nothing**: the only caller is `coder.signInAgent`,
   * which a window or a phone sends when a user presses a button. Nothing signs anything in at boot, which
   * is the property that keeps a daemon from opening a browser on somebody's desktop by itself.
   */
  const signIn = new SessionSignIn({
    paths,
    store,
    ...(options.startClient ? { startClient: options.startClient } : {}),
    ...(options.resolveLaunch ? { resolveLaunch: options.resolveLaunch } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
  });

  const handlers = createCoderHandlers({
    store,
    paths,
    runs,
    probeSession,
    signIn,
    instance: { instanceId, version, startedAt: new Date().toISOString(), connectionCount: () => connections },
    mesh: () => mesh,
    ...(options.isDirectory ? { isDirectory: options.isDirectory } : {}),
  });

  const host = createCoderDaemonHost({
    port: options.port ?? DEFAULT_DAEMON_PORT,
    path: options.path ?? DEFAULT_DAEMON_PATH,
    sessionIdentity: coderSessionIdentity(),
    dispatch: createCoderDispatcher({ handlers }),
    nodeService: createNodeService(bus),
    // Subscription is per connection, through the one port `createReuseHost` actually forwards.
    // `eventDispositions` is *not* that port — it is dropped silently, and the daemon would look
    // perfectly healthy while never delivering an event. `@envoycoder/protocol`'s `CODER_EVENTS`
    // documents the gap with its citation; `createCoderSocketMethods` explains the handling rules.
    socketMethods: createCoderSocketMethods(bus),
    onConnectionChange: (count) => {
      connections = Math.max(1, count);
    },
  });

  await host.serve();

  // Only now is the port answering, so only now is the claim worth anything.
  await writeDaemonClaim(paths, {
    product: ENVOYCODER_PRODUCT_NAME,
    instanceId,
    pid: process.pid,
    host: "127.0.0.1",
    port: host.port,
    path: host.path,
    home: paths.home,
    stateDir: paths.stateDir,
    startedAt: new Date().toISOString(),
    version,
    ...(process.argv[1] ? { entry: process.argv[1] } : {}),
  });

  // Every store mutation becomes one broadcast, which is how a second window sees the first window's
  // changes without a refresh — and how the phone sees a task the desk started.
  const unsubscribe = store.onChange((change) => {
    bus.emit("coder:state-changed", change);
  });

  /**
   * **Find the user's `PATH`, without waiting for it and without gating anything on it.**
   *
   * `currentSearchPath()` — what `coder.listHarnesses` and every spawn use — answers synchronously from what
   * has already landed: the daemon's own environment plus the well-known tool directories
   * (`@envoycoder/platform`). This call is what *upgrades* that answer with the login shell's, which is the
   * only source that includes what the user's rc files add.
   *
   * Three things about the shape, and each is deliberate:
   *
   *   * **Not awaited.** The daemon is listening before this resolves, and no request handler can block on
   *     it — the timeout is the shell's problem, not the user's. `boot` already published the claim.
   *   * **A real broadcast follows it.** When the answer lands, "what is installed" can have changed, so
   *     the same `harnesses` change kind the store uses for a new observation is emitted: a window that
   *     painted a row a moment ago refetches instead of showing an answer we have already replaced. Without
   *     this the login shell's answer would arrive *after* the first `coder.listHarnesses` and never be
   *     drawn — the quiet half of the bug this exists to fix.
   *   * **Failures are not reported.** A shell that is missing, hangs or prints nonsense leaves the fallback
   *     answer in place, which is a real search and not an error state; the reason lands in the log for
   *     whoever is reading it. It is never turned into a claim about an agent.
   */
  const searchPathPrimed = primeSearchPath().then((resolved) => {
    process.stderr.write(
      `[envoycoder] agent search path from ${resolved.source}: ${resolved.dirs.length} director` +
        `${resolved.dirs.length === 1 ? "y" : "ies"}` +
        `${resolved.added.length > 0 ? `, ${resolved.added.length} added from the well-known list` : ""}\n`,
    );
    bus.emit("coder:state-changed", { kind: "harnesses", at: new Date().toISOString() });
    return resolved;
  });

  return {
    instanceId,
    get port() {
      return host.port;
    },
    path: host.path,
    paths,
    store,
    mesh: () => mesh,
    connectionCount: () => connections,
    /** What the resolver landed on, for a test and for a shutdown that wants to know it finished. */
    searchPath: () => searchPathPrimed,
    async stop() {
      unsubscribe();
      // Runs and probes first: an agent is a child process, and a daemon that exits before its children
      // leaves agents writing to a user's working tree with nobody watching them. A probe's agent is a
      // child process too — short-lived, but a daemon that exited out from under one would leave it
      // waiting on a pipe nobody will ever answer.
      await Promise.all([runs.stopAll(), probeSession.stopAll(), signIn.stopAll()]);
      host.stop();
      await clearDaemonClaim(paths, instanceId);
    },
  };
}

/**
 * Ask the mesh, without letting its answer decide whether we serve.
 *
 * Kept here rather than in `service.ts` because it is a boot-time fact: the mesh is attached once,
 * and what it said is what the status line reports until the process restarts. A per-call attach
 * would be a network round trip per `coder.meshStatus`, on the one surface that must answer
 * instantly.
 */
async function meshAttach(home: string): Promise<CoderMeshStatus> {
  const { attachToMeshNode } = await import("@envoycoder/host-bridge");
  const attach = await attachToMeshNode(home);
  if (attach.kind === "attached") {
    return { kind: "attached", scopeKey: attach.scopeKey, ownerId: attach.ownerId };
  }
  if (attach.kind === "refused") {
    return { kind: "refused", code: attach.code, reason: attach.reason };
  }
  return { kind: "no-node", reason: attach.reason };
}
