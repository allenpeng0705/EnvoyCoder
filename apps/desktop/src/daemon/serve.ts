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
  CODER_EVENTS,
  DEFAULT_DAEMON_PATH,
  DEFAULT_DAEMON_PORT,
  ENVOYDEV_PRODUCT_NAME,
} from "@envoydev/protocol";
import {
  type CoderMeshPeer,
  type CoderPaths,
  coderPaths,
  coderSessionIdentity,
  createCoderDaemonHost,
  createCoderDispatcher,
  createCoderMeshPeer,
} from "@envoydev/host-bridge";
import {
  currentSearchPath,
  primeSearchPath,
  primeShellBinaries,
  reaskShellBinaries,
  refreshSearchPath,
  type SearchPath,
} from "@envoydev/platform";
import {
  ALL_HARNESSES,
  acpAgent,
  cataloguedInstall,
  harnessAvailability,
  probeHarness,
  probeableBinaryNames,
  type HarnessProbe,
} from "@envoydev/agent-catalog";

import type { AcpLaunch } from "./acp/client.js";
import { AcpClient } from "./acp/client.js";
import { createCoderEventBus, createCoderSocketMethods, createNodeService } from "./events.js";
import { clearDaemonClaim, writeDaemonClaim } from "./lock.js";
import { RunManager } from "./runs.js";
import { SessionProbe } from "./session-probe.js";
import { WARM_STALE_MS, startDeepWarm } from "./deep-warm.js";
import { SessionSignIn } from "./sign-in.js";
import { createCoderHandlers } from "./service.js";
import { CoderStore } from "./store.js";
import { AgentDeliveries } from "./deliveries.js";
import { createPairingHandlers } from "./pairing.js";
import { PairedDeviceStore, pairedDevicesFile, readPairingIdentity } from "./paired-devices.js";
import { readLifecycle } from "./lifecycle.js";
import { reconcileInterruptedRuns } from "./reconcile.js";
import { readTranscript, transcriptFile } from "./transcript-log.js";
import { DAEMON_VERSION } from "./version.js";
import type { CoderDaemonHost } from "@envoydev/host-bridge";

export interface StartCoderDaemonOptions {
  /**
   * How to begin a graceful stop when a *client* asks for one (`coder.shutdown`).
   *
   * Injected rather than implemented here: the stop has to record why it happened and then end the process, and
   * this module owns neither the ledger nor the process. Everything else about stopping — draining live runs — is
   * `stop()`, which the hook ends up calling.
   */
  onShutdown?: () => void;
  /** `0` lets the OS choose, which is what tests use. */
  port?: number;
  path?: string;
  /** Defaults to the family's resolution (`ENVOYMESH_HOME`, per-OS default, legacy adoption). */
  home?: string;
  /** Overrides the resolved paths wholesale — the test hook for a temporary state directory. */
  paths?: CoderPaths;
  version?: string;
  instanceId?: string;
  /**
   * Who supervises this process, for the claim every launcher reads.
   *
   * `app` by default — the Tauri shell spawns the daemon and stops it when the last window quits. A service
   * supervisor passes `service`, and then that shell leaves it alone (`docs/daemon-lifecycle.md` §3).
   */
  managedBy?: "app" | "service";
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
  /**
   * **Look at what the ready agents publish, in the background, one at a time.**
   *
   * Defaults to **false**, and the two callers are the argument for that: the production entry point
   * (`daemon/main.ts`) passes `true`, and every test plus `scripts/smoke.ts` leaves it out. A warmer that ran
   * by default would spawn the developer's own coding agents on every test run, and it would make this
   * slice's own headline property — *loading the agents page spawns nothing* — unprovable.
   *
   * What it does when it is on: `deep-warm.ts` carries the four bounds. In one sentence, it asks each agent
   * that is `ready` **and is not fetched on first run** what it publishes, sequentially, so the row's
   * `Verified` property has a time without anybody pressing a button.
   */
  warm?: boolean;
  resolveLaunch?: (input: {
    harness: import("@envoydev/protocol").HarnessId;
    cwd: string;
    extraArgs?: string;
    model?: string;
  }) => AcpLaunch;
  platform?: import("@envoydev/platform").PlatformId;
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
  /**
   * The programs the login shell resolved **by name**, once that ask has landed.
   *
   * The same seam as `searchPath()`, for the second question the shell is asked. A test awaits this to know
   * the prime is finished rather than sleeping; production never waits, because `currentSearchPath()` reads
   * whatever has landed (`./launch.ts` explains why the probe and the spawn must read one list).
   */
  shellBinaries(): Promise<ReadonlyMap<string, string>>;
  /**
   * The background warm-up's report, when this daemon was asked to warm (`warm: true`).
   *
   * `undefined` when it was not — and that is the honest answer rather than an empty report, because "we did
   * not look" and "we looked at nothing" are different facts and only one of them is about the agents.
   */
  warm(): Promise<import("./deep-warm.js").WarmReport> | undefined;
  stop(): Promise<void>;
}

export async function startCoderDaemon(options: StartCoderDaemonOptions = {}): Promise<StartedCoderDaemon> {
  const paths = options.paths ?? coderPaths(options.home);
  const instanceId = options.instanceId ?? randomUUID();
  const version = options.version ?? DAEMON_VERSION;
  let connections = 1;

  const store = await CoderStore.open({ paths });
  /**
   * **The user's delivery choices**, read at boot beside the store.
   *
   * Loaded before anything can start an agent, because a run reads it: a choice that arrived one request late
   * would start the connector the user just replaced.
   */
  const deliveries = new AgentDeliveries(paths, store.fileHelper);
  await deliveries.load();
  const bus = createCoderEventBus();

  // The mesh used to be an **attach**: we looked for somebody else's EnvoyMesh node and reported what
  // it said. Under the chosen topology there is no such node — this daemon *is* the peer, and it
  // reuses the family's network layer to be one (`createCoderMeshPeer`). An attach probe would now
  // answer `no-node` while our own peer is up and dialable, which is the one answer that is certainly
  // wrong, so the probe is gone rather than kept as a fallback.
  //
  // The binding is mutable because the peer cannot be built here: it needs the same dispatcher the
  // host gets, and that dispatcher is built from the handlers below, which read this. Reading it
  // lazily is what breaks that cycle without standing up a placeholder peer — and until `start()`
  // answers, the honest status is "not started yet", never "hosting".
  let mesh: CoderMeshStatus = options.mesh
    ? options.mesh()
    : {
        kind: "no-node",
        reason: options.skipMeshAttach
          ? "The mesh was skipped for this daemon (it was started without one)."
          : "The mesh peer has not started yet.",
      };

  // Every run event goes onto the bus, and each subscribed connection receives it. That is the only
  // path by which a transcript reaches a window: the daemon never sends a client a frame it did not
  // ask for (`CODER_EVENTS` in `@envoydev/protocol` explains why subscription works this way).
  const runs = new RunManager({
    // The same lookup the list and the launch use: one answer to "how is this agent delivered".
    deliveryOf: (harness) => deliveries.of(harness),
    paths,
    store,
    onEvent: (event) => bus.emit("coder:run-event", event),
    ...(options.startClient ? { startClient: options.startClient } : {}),
    ...(options.resolveLaunch ? { resolveLaunch: options.resolveLaunch } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
  });

  /**
   * **Close the books on the last daemon's runs before anybody can look at them.**
   *
   * A killed daemon leaves task rows claiming a live run with no process behind them, and the product's one
   * promise about a task — "this is still working" — would be wrong for ever. This runs after the store is open
   * and before the first client can connect, so no window ever sees the stale state, and a restart that
   * interrupted work is reported rather than quietly tidied away.
   */
  const stranded = await reconcileInterruptedRuns({
    tasks: () => store.tasks(),
    eventsFor: async (runId) => {
      const file = transcriptFile(paths.transcriptsDir, runId);
      return file === undefined ? [] : await readTranscript(file);
    },
    setTaskStatus: async (taskId, status) => {
      await store.setTaskRun(taskId, { status });
    },
  });
  if (stranded.length > 0) {
    console.log(
      `closed ${stranded.length} run(s) a previous daemon left open: ${stranded.join(", ")}`,
    );
  }

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
    // The same lookup the list and the launch use: one answer to "how is this agent delivered".
    deliveryOf: (harness) => deliveries.of(harness),
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
    // The same lookup the list and the launch use: one answer to "how is this agent delivered".
    deliveryOf: (harness) => deliveries.of(harness),
    paths,
    store,
    ...(options.startClient ? { startClient: options.startClient } : {}),
    ...(options.resolveLaunch ? { resolveLaunch: options.resolveLaunch } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
  });

  /**
   * **The one prober for the nine agents we ship** — built here rather than left to `service.ts`'s own default,
   * because the background warm-up below needs the *same* answer to decide which agents it may start.
   *
   * Two constructions of `probeHarness` over two search-path reads would be two answers to "what can this
   * machine do", and the one that drifts is always the one nobody is looking at: the row would say `ready`
   * about an agent the warmer refused to start, or the reverse. The read happens **per call** rather than once
   * at construction so that the login shell's answers — which land a moment after the daemon starts
   * listening — are included, which is the whole reason `primeSearchPath()` exists.
   */
  const harnessProbe = (harness: import("@envoydev/protocol").HarnessId): HarnessProbe => {
    const search = currentSearchPath();
    return probeHarness(harness, {
      pathDirs: search.dirs,
      searchable: search.searchable,
      ...(options.platform ? { platform: options.platform } : {}),
    });
  };

  /**
   * **Ask this machine again** — the user's half of *"I installed it while the window was open"*.
   *
   * `coder.recheckAgents` calls this, and what it does is deliberately only the two things that *cannot* be
   * right on their own: the login shell's `PATH` and its per-name `command -v` answers are captured once per
   * process on purpose (one shell, and a toolchain manager's rc file is expensive), so a program that installs
   * where only the shell can see it stays missed until something asks again. Everything else in the row is
   * already re-measured on every read — `harnessProbe` above builds a fresh `ProbeFinding` per call, and
   * `catalog.ts` carries why no cache belongs there.
   *
   * The broadcast is the half the *window* needs and it is the same event the boot primes emit, so a page
   * updates through its ordinary path: one list-shaped answer, re-read by every window, rather than a second
   * copy of the list travelling back on this call's result.
   *
   * A failure is a log line and not a refusal, for the same reason the boot primes fail quietly: a shell that
   * is missing, slow or hostile leaves the previous answers in place, and a search that could not be redone is
   * not a claim about anybody's machine.
   */
  const recheckAgents = async (): Promise<void> => {
    const names = probeableBinaryNames(store.providers().map((provider) => provider.command));
    await Promise.all([
      refreshSearchPath().catch(() => undefined),
      names.length > 0 ? reaskShellBinaries(names).catch(() => undefined) : Promise.resolve(undefined),
    ]);
    bus.emit("coder:state-changed", { kind: "harnesses", at: new Date().toISOString() });
  };

/**
 * Has this agent been looked at recently enough that a background pass may skip it?
 *
 * A pure function of a timestamp and a clock, and separate from the plan for the reason every clock in this
 * repo is injected: a missing observation is **not** recent (there is nothing to skip), a timestamp that is not
 * a date is not recent (we cannot tell), and a clock that went backwards is not evidence of freshness — the
 * same rule `catalog.ts` learned when a laptop woke from sleep.
 */
function isFreshObservation(observedAt: string | undefined, now: number): boolean {
  if (observedAt === undefined) return false;
  const then = Date.parse(observedAt);
  if (Number.isNaN(then)) return false;
  const age = now - then;
  return age >= 0 && age < WARM_STALE_MS;
}

  // The store answers *who* a token belongs to, so it is given the machine's owner identity — read,
  // never created, because authenticating a token is not the place to mint an identity.
  const pairedDevices = new PairedDeviceStore(pairedDevicesFile(paths), {
    ownerId: async () => (await readPairingIdentity(paths))?.ownerId ?? null,
  });
  let hostRef: CoderDaemonHost | null = null;
  // Declared here and assigned only after the socket answers. The pairing handlers read it at **mint**
  // time, so a `const` further down the function would sit in the temporal dead zone for any mint that
  // arrived first — and the failure would be a thrown ReferenceError in the one flow a new user runs.
  let meshPeer: CoderMeshPeer | null = null;
  /**
   * One deferred for the whole boot: mint awaits it so a code issued while the peer is still starting
   * still carries libp2p fields once hosting lands. Settled immediately when there is no peer to wait
   * for (`skipMeshAttach` / injected status), otherwise after `meshPeer.start()` finishes.
   */
  let settleMeshReady: () => void = () => undefined;
  const meshReady = new Promise<void>((resolve) => {
    settleMeshReady = resolve;
  });
  if (options.mesh || options.skipMeshAttach) {
    settleMeshReady();
  }

  const handlers = {
    ...createCoderHandlers({
    // The same store the pairing family uses: the hello path records an identity through it, and two stores over
    // one file would mean two writers racing on the same rows.
    paired: pairedDevices,
    store,
    paths,
    runs,
    probeSession,
    signIn,
    instance: { instanceId, version, startedAt: new Date().toISOString(), connectionCount: () => connections },
    mesh: () => mesh,
    // The same function the warm-up reads, so the list and the background pass cannot disagree.
    probe: harnessProbe,
    // The one method whose subject is the measurement itself: the page's "Check again".
    recheckAgents,
    // The portable stop: Windows has no signal an unrelated process can send (item 8).
    ...(options.onShutdown ? { shutdown: options.onShutdown } : {}),
    // The daemon's own restart history, beside the supervisor's answer: a unit restarted for ever still reports
    // "running", so the count is what tells a person their daemon is in a crash loop.
    serviceFacts: async () => {
      const facts = await readLifecycle(paths);
      return {
        restartsInLastHour: facts.bootsInLastHour,
        ...(facts.lastStop ? { lastStop: facts.lastStop } : {}),
      };
    },
    // The user's delivery choices: read by the list (so a row says which route is in force), written by
    // `coder.setAgentDelivery`, and read by every launch (`deliveryOf`, above).
    deliveries: { of: (harness) => deliveries.of(harness), set: (harness, next) => deliveries.set(harness, next) },
    onHarnessesChanged: () => bus.emit("coder:state-changed", { kind: "harnesses", at: new Date().toISOString() }),
    ...(options.isDirectory ? { isDirectory: options.isDirectory } : {}),
  }),
    ...createPairingHandlers({
      store: pairedDevices,
      paths,
      getHost: () => {
        if (!hostRef) {
          throw new Error("pairing called before the daemon host was ready");
        }
        return hostRef;
      },
      // Read at **mint** time rather than at boot: a code minted after the relay reservation lands
      // carries the circuit address, and one minted a second earlier would otherwise be permanently
      // poorer than a later code for no reason the user could see.
      mesh: () => ({
        ...(meshPeer?.peerId ? { peerId: meshPeer.peerId } : {}),
        multiaddrs: meshPeer?.multiaddrs ?? [],
        relayHints: meshPeer?.relayHints ?? [],
      }),
      awaitMeshReady: () => meshReady,
      // The half of revocation a store cannot do: `store.revoke` refuses the next token, but a phone
      // already connected keeps its mesh stream. Read through the closure at revoke time, like `mesh`
      // above, so it is the live peer. `meshPeer` is `null` on the `skipMeshAttach` / injected-status
      // paths — the `?.` makes that an ordinary no-op and the revoke still succeeds.
      closeMeshStreams: (deviceId) => {
        meshPeer?.closeStreamsForDevice(deviceId);
      },
      // The WebSocket half of the same event — LAN / host:port phones.
      closeWsSessions: (deviceId) => {
        hostRef?.disconnectClientsForDevice(deviceId);
      },
    }),
  };

  // Built once and shared: the mesh peer authenticates through the same session resolver and
  // dispatches through **the same** dispatcher the WebSocket host uses. A second dispatcher for the
  // mesh would be two authorization surfaces that could drift, and the drift would stay invisible
  // until somebody tried the one method that differed.
  const sessionIdentity = coderSessionIdentity({
    resolveSession: (token) => pairedDevices.resolveSession(token),
  });
  const dispatch = createCoderDispatcher({ handlers });

  const host = createCoderDaemonHost({
    port: options.port ?? DEFAULT_DAEMON_PORT,
    path: options.path ?? DEFAULT_DAEMON_PATH,
    sessionIdentity,
    dispatch,
    nodeService: createNodeService(bus),
    // Subscription is per connection, through the one port `createReuseHost` actually forwards.
    // `eventDispositions` is *not* that port — it is dropped silently, and the daemon would look
    // perfectly healthy while never delivering an event. `@envoydev/protocol`'s `CODER_EVENTS`
    // documents the gap with its citation; `createCoderSocketMethods` explains the handling rules.
    socketMethods: createCoderSocketMethods(bus),
    onConnectionChange: (count) => {
      connections = Math.max(1, count);
    },
  });
  hostRef = host;

  await host.serve();

  // The peer starts **after** the socket answers, for the same reason the claim is written only then:
  // a daemon that has not accepted its first window must not be sitting in a network handshake. A peer
  // that fails to start is a state to report (`refused`, with its code) — never a failure to serve.
  //
  // Built only when neither seam was used, so the tests that inject a status still never construct a
  // node. That is the same guard the old probe had, now around a real peer.
  meshPeer =
    options.mesh || options.skipMeshAttach
      ? null
      : createCoderMeshPeer({
          paths,
          sessionIdentity,
          dispatch,
          // Every mesh connection hears the events a window hears, from the same bus and the same event
          // list. The transport subscribes each connection for us, so this *is* the mesh broadcast path
          // — and a second path that could disagree with the socket one is the bug this prevents.
          subscribe: (send) => {
            const offs = CODER_EVENTS.map((event) => bus.on(event, (data) => send(event, data)));
            return () => {
              for (const off of offs) off();
            };
          },
        });
  if (meshPeer) {
    mesh = await meshPeer.start();
  }
  settleMeshReady();

  // Only now is the port answering, so only now is the claim worth anything.
  await writeDaemonClaim(paths, {
    // Passed in by whoever started this process; `main.ts` reads it from argv, and the service unit is what
    // passes `--managed-by service`. The default keeps every existing launcher's daemon exactly as it was.
    managedBy: options.managedBy ?? "app",
    product: ENVOYDEV_PRODUCT_NAME,
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
   * (`@envoydev/platform`). This call is what *upgrades* that answer with the login shell's, which is the
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
      `[envoydev] agent search path from ${resolved.source}: ${resolved.dirs.length} director` +
        `${resolved.dirs.length === 1 ? "y" : "ies"}` +
        `${resolved.added.length > 0 ? `, ${resolved.added.length} added from the well-known list` : ""}` +
        `${resolved.cached.length > 0 ? `, ${resolved.cached.length} from a tool cache` : ""}\n`,
    );
    bus.emit("coder:state-changed", { kind: "harnesses", at: new Date().toISOString() });
    return resolved;
  });

  /**
   * **The second question the login shell is asked: where would you find *this* name?**
   *
   * A `$PATH` answer is a variable and a `command -v` answer is a lookup, and on the machine this was written
   * on the two disagree about `dsh`: the login shell's own `PATH`, asked from a clean environment, holds 26
   * directories and none of them has it, while `command -v dsh` names an `npx` cache directory that no `PATH`
   * this process inherits mentions. That is why the row read "not installed" for an agent its owner uses every
   * day, and asking about the names is half of what closes it (the other half is `cacheBinDirs`).
   *
   * The names come from the catalogue itself (`probeableBinaryNames`) plus the commands this daemon's stored
   * providers declare — **one** shell invocation for all of them, cached per name for the life of the process.
   * Shaped like the `PATH` prime above and for the same three reasons: not awaited (the daemon is already
   * listening), broadcast when it lands (a row painted a moment ago may now be a different state), and a
   * failure is a log line rather than a claim about anybody's machine.
   */
  const binariesPrimed = primeShellBinaries(
    probeableBinaryNames(store.providers().map((provider) => provider.command)),
  ).then((answers) => {
    if (answers.size > 0) {
      process.stderr.write(
        `[envoydev] the login shell resolved ${answers.size} program` +
          `${answers.size === 1 ? "" : "s"} by name — a lookup, which can differ from its own PATH answer\n`,
      );
      bus.emit("coder:state-changed", { kind: "harnesses", at: new Date().toISOString() });
    }
    return answers;
  });

  /**
   * **The deep facts, looked at in the background — one agent at a time, and never something that must be
   * downloaded first.**
   *
   * `deep-warm.ts` carries the reasoning; what belongs here is how the candidates are built, because that is
   * where the one prohibition is decided. A candidate is eligible when this daemon measured it `ready` **and**
   * starting it is not a fetch — and the second half is *derived from the catalogue* rather than written down:
   * an entry whose `install.kind` is `npx` is fetched from npm on the first run, so a background pass that
   * started one would **download a package because a user opened an app**. `acpAgent(id)` answers for the
   * catalogued entries (including `cursor`, which is also a built-in), and `undefined` for the built-in
   * harnesses that are not recipes at all — which is exactly the set where "will this download?" is `false`
   * for a real reason rather than by assertion.
   */
  const warm = options.warm === true
    ? startDeepWarm({
        candidates: () =>
          ALL_HARNESSES.map((id) => {
            const entry = acpAgent(id);
            const install = entry === undefined ? undefined : cataloguedInstall(entry);
            return {
              id,
              availability: harnessAvailability(harnessProbe(id)),
              fetchedOnFirstRun: install?.kind === "npx",
              // **The cross-session bound**, and the reason a second launch of the app starts nothing: the
              // store's observation survives a restart, `SessionProbe`'s cache does not, so this is the field
              // that makes the pass free on a machine that has already been looked at recently. Read from the
              // two records a deep probe writes — the options it published, and the auth it wanted.
              observedRecently: isFreshObservation(
                store.sessionOptions(id)?.observedAt ?? store.agentAuth(id)?.observedAt,
                Date.now(),
              ),
            };
          }),
        ask: (id) => probeSession.probe(id),
        onAnswer: () => bus.emit("coder:state-changed", { kind: "harnesses", at: new Date().toISOString() }),
        note: (line) => process.stderr.write(line),
      })
    : undefined;

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
    /** What the shell resolved by name, on the same terms. */
    shellBinaries: () => binariesPrimed,
    /**
     * The background warm-up, once it has finished — or `undefined` when this daemon was not asked to warm.
     *
     * Exposed for the same reason `searchPath()` is: a test that wants to watch the pass complete must be able
     * to await it rather than sleep. Production never waits, because nothing depends on the pass finishing.
     */
    warm: () => warm?.done(),
    async stop() {
      unsubscribe();
      // Before the agents: the pass asks agents to start, and one that began a moment ago must not leave a
      // child behind a daemon that is exiting — the property `agent-teardown.ts` exists for.
      warm?.stop();
      // Runs and probes first: an agent is a child process, and a daemon that exits before its children
      // leaves agents writing to a user's working tree with nobody watching them. A probe's agent is a
      // child process too — short-lived, but a daemon that exited out from under one would leave it
      // waiting on a pipe nobody will ever answer.
      await Promise.all([runs.stopAll(), probeSession.stopAll(), signIn.stopAll()]);
      host.stop();
      // The peer's stop never rejects, so it is awaited unconditionally: a shutdown that could throw
      // here would skip the claim removal below and leave the next window talking to nobody.
      await meshPeer?.stop();
      await clearDaemonClaim(paths, instanceId);
    },
  };
}

/*
 * The `meshAttach` probe that used to live here is gone, and its absence is the point: it asked a
 * *different* process — a running EnvoyMesh node — to vouch for us, and reported `no-node` when there
 * was none. EnvoyDev no longer has a node to attach to; it is one (`createCoderMeshPeer`). Keeping the
 * probe as a fallback would have let a healthy daemon report itself unreachable, which is worse than
 * reporting nothing.
 */
