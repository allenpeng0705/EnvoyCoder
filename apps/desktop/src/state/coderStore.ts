/**
 * The window's state: one store, fed by the daemon, read by React.
 *
 * ## Why a store and not hooks full of `useState`
 *
 * Three reasons, all of which show up as bugs if ignored:
 *
 *   1. **One connection, many components.** The rail, the pane and the status line all want the same
 *      lists. Three independent fetchers means three copies that disagree — the rail saying "Working"
 *      while the pane says "Needs your answer" — which is precisely the failure the design warns
 *      about when it insists one function computes the attention count (`docs/envoydev-ui.md` §4).
 *   2. **A push-driven cache, not a poll.** The daemon says *what* changed; the store refetches the
 *      affected list. That keeps "the second window updates without a refresh" a property of the
 *      architecture rather than of a timer.
 *   3. **Testability without a DOM.** Everything here is a plain object with methods, so the
 *      interesting cases — a change event arriving for a list nobody loaded, a call failing while
 *      disconnected, two changes coalescing — are ordinary unit tests.
 *
 * ## `useSyncExternalStore` rather than a state library
 *
 * React 19 ships the primitive, and it needs exactly what the store already provides: a `subscribe`
 * and a `getSnapshot` that returns a value React can compare by identity. The reference
 * implementation reaches for zustand and react-query configured as a manual cache
 * (`packages/app/src/data/query-client.ts:3-13` — `staleTime: Infinity`, every refetch trigger off);
 * that is a great deal of machinery to arrive at "the server pushes, we refetch", and this app is
 * small enough that the version without the machinery is the one a reader can check.
 *
 * The snapshot is replaced, never mutated, so `getSnapshot()` is a cheap identity check and no
 * component re-renders for a field it does not read… with one honest caveat: consumers of
 * `useCoderState()` take the whole object, so they all re-render on any change. That is fine at this
 * size (a few dozen rows) and is the thing to revisit — with `useSyncExternalStoreWithSelector` —
 * the moment a transcript makes a re-render expensive.
 */

import type {
  AgentProviderSummary,
  AgentRun,
  CatalogEntry,
  CoderSettings,
  FixTarget,
  HarnessId,
  HarnessSummary,
  ProbeOutcome,
  Project,
  RunEvent,
  RunMode,
  PromptImage,
  SignInOutcome,
  Task,
  TaskDefaults,
} from "@envoydev/protocol";
import { DEFAULT_CODER_SETTINGS, ENVOYDEV_ERRORS, coderErrorCode, missingMethods } from "@envoydev/protocol";
import type { AgentDelivery as AgentDeliveryWire, FixRunResult as FixRunResultWire } from "@envoydev/protocol";

import { localNotice, noticeFromError, type Notice, type Refusal } from "../i18n/notice.js";
import { buildTranscript, type Transcript } from "./transcript.js";
import type { EnvoyLlmPublic, EnvoyLlmSetInput } from "./agent-actions.js";

import { CoderConnection, type ConnectionStatus, type HelloResult } from "../client/connection.js";
import { resolveDaemonEndpoint, type ResolvedEndpoint } from "../client/endpoint.js";

/** The mesh, as the daemon last reported it. Mirrors `CoderMeshStatus` in the protocol. */
export type MeshStatus =
  | { kind: "attached"; scopeKey: string; ownerId: string; peerCount?: number }
  // We are the node: this machine hosts its own peer, and `multiaddrs`/`relayHints` are how a paired
  // phone reaches it. The three older variants all describe looking for somebody else's node.
  | { kind: "hosting"; peerId: string; multiaddrs: string[]; relayHints: string[]; peerCount?: number }
  | { kind: "no-node"; reason: string }
  | { kind: "refused"; code: string; reason: string };

export interface CoderState {
  connection: ConnectionStatus;
  /** How the endpoint was decided — the shell, or a development fallback. */
  resolved: ResolvedEndpoint | undefined;
  hello: HelloResult | undefined;
  projects: readonly Project[];
  tasks: readonly Task[];
  /**
   * Whether the task list came from the daemon, or is unknown.
   *
   * `tasks: []` means two things — "there are none" and "I could not ask" — and the rail draws the
   * first as "No tasks yet" under every project. So the difference has to survive into the render, or
   * a daemon that is an older build (the case that produced it) makes the window claim a project has
   * no work when it may have plenty. `false` until `coder.listTasks` answers.
   */
  tasksKnown: boolean;
  settings: CoderSettings;
  harnesses: readonly HarnessSummary[];
  /**
   * The agents **this user declared**, each with the daemon's own probe of it.
   *
   * A list of its own rather than rows appended to `harnesses`, and the reason is the daemon's, not this
   * store's: `HarnessSummary.id` is the closed nine-entry `HarnessId`, and a user's id in that field would
   * be answered about by `harnessLabel`, `resolveModelMode` and the settings rows with a default each.
   *
   * **What arrives here is the daemon's probe, never a default.** `availability` is the same field
   * `HarnessSummary` carries, from the same prober, so a provider whose program is missing reads
   * `not-installed` in this window exactly as a catalogue entry does — a row a user typed is a recipe, and
   * whether it runs here is measured. `env[].set` is the other half: a named variable this daemon does not
   * have is shown as a fact about our environment, with its **name** and never its value.
   */
  providers: readonly AgentProviderSummary[];
  /**
   * The catalogued agents — **the 38 recipes, each with what this machine can do with it**.
   *
   * `coder.listCatalog` starts no process and downloads nothing, so this list loads with every other list at
   * connect time — and it arrives complete, because each row carries the availability the daemon resolved when
   * it served the list (`CatalogEntry.availability`). So there is no second call to make and no per-row state
   * for this store to hold: what a consumer renders is a verdict. The only reason a user used to have to ask
   * about a row one at a time is that the answer was believed to be expensive; it is not — the four facts
   * behind it are filesystem and environment reads — and the 14 `npx` recipes that made a sweep *look* costly
   * are only costly to **start**, which nothing here does.
   */
  catalog: readonly CatalogEntry[];
  mesh: MeshStatus;
  /**
   * Runs this window knows about, by run id.
   *
   * A map rather than one "current run", because a window can be watching a task while another
   * task's approval arrives — and the rail's badge counts across tasks, so the events have to
   * land somewhere keyed by run rather than in whatever pane happens to be focused.
   */
  runs: Readonly<Record<string, { run: AgentRun; events: readonly RunEvent[] }>>;
  /** True once projects, tasks and settings have arrived at least once. */
  loaded: boolean;
  /**
   * **What the window could not do** — in the user's words, and the only thing the shell's own bar carries.
   *
   * A read that failed, a daemon this build cannot talk to. **Never a press that was refused**: a write's
   * refusal is returned to the caller and rendered where the press was (`mutate` states the rule), because a
   * sentence about a row, shown in a bar above every surface, names no control, moves the window, and has to
   * be dismissed before the user can get on with what they were doing.
   *
   * A single slot, not a queue: this app is not a log viewer, and the newest failure is the one the
   * user can act on. Anything worth keeping goes to the audit log instead.
   *
   * A **`Notice`** rather than a string: a daemon refusal arrives as an English sentence *and* the
   * catalogue key for it, and the key has to survive into the render so that "the language must be
   * unified" holds for a refusal that arrived before the user switched language. The English
   * sentence stays beside it, for the case where this build has no such key.
   */
  error: Notice | undefined;
  /** Things the daemon wanted the user to know at startup. Empty in a healthy install. */
  notes: readonly string[];
}

const initialState: CoderState = {
  connection: { state: "idle" },
  resolved: undefined,
  hello: undefined,
  projects: [],
  tasks: [],
  tasksKnown: false,
  settings: DEFAULT_CODER_SETTINGS,
  harnesses: [],
  providers: [],
  catalog: [],
  mesh: { kind: "no-node", reason: "" },
  runs: {},
  loaded: false,
  error: undefined,
  notes: [],
};

/**
 * What a screen has to supply to declare an agent — `coder.addProvider`'s required parameters.
 *
 * Named here, next to the method that sends them, so the screen that fills it in and the daemon that
 * validates it are talking about one shape. `transport` is required and has no default anywhere on this
 * path: see `AgentProviderConfig` for why choosing a dialect on the user's behalf is the one thing this
 * field exists to prevent.
 */
export interface AddProviderInput {
  /** The provider id — the catalogue entry's own id, or a slug the user's label produces. */
  id: string;
  label: string;
  command: string;
  args: readonly string[];
  /** Environment variable **names**. A value cannot be expressed — that is the schema, not a rule here. */
  env: readonly string[];
  transport: "acp" | "cli";
  /**
   * The catalogue entry this provider **is**, when a catalogue row was added rather than the manual form
   * filled in. A reference, never a value: the daemon resolves the entry's own constants, and refuses
   * unless the recipe above is that entry's — see `AgentProviderConfig.catalogEntryId`.
   */
  catalogEntryId?: string;
}

export interface CoderStoreOptions {
  /**
   * How to open the connection. Defaults to the real one.
   *
   * Injected because the alternative is a store that can only be tested against a live daemon on a
   * fixed port — which means the one seam the window's whole data path runs through is the one thing
   * no test can reach. The daemon is exercised over a real socket elsewhere; what this seam needs is
   * the ability to say "here is a connection, tell me what you do with it".
   */
  connect?: (resolved: ResolvedEndpoint) => CoderConnection;
  /** How to work out where the daemon is. Defaults to asking the shell. */
  resolveEndpoint?: () => Promise<ResolvedEndpoint>;
}

/**
 * Is this approval answer the bare list of chosen option ids?
 *
 * A named predicate rather than an inline `Array.isArray`, because TypeScript narrows `readonly string[]`
 * with neither `Array.isArray` nor `"text" in choice` — so the only way to reach the `{ optionIds }` branch
 * without a cast is a guard that says what it means. `TaskPane`'s approval picker emits exactly this list.
 */
function isOptionIdList(
  choice: string | readonly string[] | { optionIds: readonly string[] } | { text: string },
): choice is readonly string[] {
  return Array.isArray(choice);
}

export class CoderStore {
  private readonly options: CoderStoreOptions;
  private state: CoderState = initialState;
  private readonly listeners = new Set<() => void>();
  private connection: CoderConnection | undefined;
  private disposers: (() => void)[] = [];
  /** Coalesces a burst of change events into one refetch. See `scheduleRefresh`. */
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Kinds waiting inside the coalesce window. Replacing the timer used to drop every kind but the
   * latest — so a boot `harnesses` broadcast landing just after `projects` could cancel the rail
   * refetch and leave a freshly added project invisible until the next change.
   */
  private refreshKinds = new Set<string>();
  /**
   * The in-flight `start()`, which is what makes "one socket per window" true.
   *
   * A promise rather than a boolean because the guard has to survive its own `await` — see `start()`.
   */
  private starting: Promise<void> | undefined;
  /**
   * The methods the connected daemon says it has — its own build's catalogue, from `hello`.
   *
   * Empty until a daemon describes itself, and empty *means* "no idea": an older daemon that sends an
   * empty list is not a daemon with no methods, so nothing is skipped and the calls speak for
   * themselves. See `missingMethods` in `@envoydev/protocol` for why this exists.
   */
  private advertised = new Set<string>();

  constructor(options: CoderStoreOptions = {}) {
    this.options = options;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CoderState => this.state;

  /**
   * Resolve the endpoint, open the connection, and load. **Idempotent — including while the first call is
   * still in flight**, which is what it was not.
   *
   * The guard used to be `if (this.connection) return`, and `this.connection` is only assigned *after*
   * `await resolveEndpoint()`. Two calls that arrive inside that window both get past the check and both open a
   * socket; the second is stored in `this.connection` and the first is never disposed, so its socket stays
   * connected for the life of the window. Nothing in the window can see it, and the daemon counts two.
   *
   * That is not theoretical and it is what the owner was looking at: `main.tsx` renders inside
   * `<StrictMode>`, React invokes the window's effect twice in development, and the title bar said
   * **"2 windows"** for one window. The daemon was telling the truth about *sockets*; the window was lying
   * about *windows*.
   *
   * So the guard is the promise rather than the result. A failed attempt clears it: the endpoint resolution can
   * fail (no shell, no claim file) and that must stay retryable, which a cached rejected promise would not.
   */
  async start(): Promise<void> {
    this.starting ??= this.connectOnce();
    return this.starting;
  }

  private async connectOnce(): Promise<void> {
    try {
      const resolved = await (this.options.resolveEndpoint ?? resolveDaemonEndpoint)();
      this.set({ resolved, error: undefined });
      this.open(resolved);
    } catch (error) {
      // Connection setup failures belong in the chip / empty work area — not the attention
      // banner. The banner carries what the **window** could not do (a read that failed, a
      // daemon that is a build behind); a press that failed is answered where it was made.
      // See `mutate` for the rule and `failure-placement.test.tsx` for it held surface by surface.
      //
      // The reason is kept **whole** — code and key included — because it is both branched on
      // (`coderErrorCode`) and rendered (`localizeText`, which resolves the key the endpoint failure
      // carried). Everything else in `ConnectionStatus.reason` is the raw message for the same
      // reason; the chip is where a localisation would otherwise be silently lost.
      this.set({
        connection: {
          state: "disconnected",
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      // **Retryable.** Nothing else will call `start()` again, so a failure that cached its promise would leave
      // the window permanently disconnected with no way back short of a reload.
      this.starting = undefined;
    }
  }

  /** Clear the attention-banner error (Dismiss). Notices are owned by the shell UI. */
  clearError(): void {
    this.set({ error: undefined });
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.refreshKinds.clear();
    this.starting = undefined;
    this.closeConnection();
  }

  /** Close the socket and drop every listener that belonged to it. */
  private closeConnection(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.connection?.dispose();
    this.connection = undefined;
  }

  /* ────────────────────────────── reading ────────────────────────────── */

  /**
   * Open the connection and wire everything the window listens to.
   *
   * **Reached once per window, and the guard that makes that true is `start()`'s promise.** A defensive
   * "close whatever was there first" was written here and then removed: with `start()` guarded it cannot be
   * reached — a disposed store has already closed its socket — so it was a branch no test could redden, which is
   * the shape this repository keeps refusing. One mechanism, one leg that fails when it goes
   * (`coder-store.test.ts`, "one window, one socket").
   */
  private open(resolved: ResolvedEndpoint): void {
    const connection =
      this.options.connect?.(resolved) ??
      new CoderConnection({ endpoint: resolved.endpoint, client: { name: "EnvoyDev window" } });
    this.connection = connection;

    this.disposers.push(
      connection.onStatus((status) => {
        this.set({ connection: status });
        if (status.state === "connected") {
          // **`hello` is recorded here, and it was not being recorded at all.** The field existed in the
          // state, the Settings pane read `hello.stateDir` and `hello.version` from it, and the status
          // bar read `hello.windowCount` — every one of them falling back to a default because nothing
          // ever wrote it. The connection has verified the handshake before it reports "connected", so
          // this is the moment the identity is known.
          /**
           * **Runs belong to the daemon instance that produced them.**
           *
           * The window attaches to whichever daemon owns the port (family rule D2), and a daemon that was
           * restarted — by an upgrade, by the shell, by a crash — knows nothing about the runs this window was
           * watching: their records here are the *previous* process's, complete with a missing `endedAt`, and a
           * composer that trusts them sends into nothing. So a different `instanceId` drops the run records
           * entirely, and the next event or press refetches what is real.
           */
          const previous = this.state.hello?.instanceId;
          const changed = previous !== undefined && previous !== connection.hello?.instanceId;
          this.set({ hello: connection.hello, ...(changed ? { runs: {} } : {}) });
          // Identity first, then the lists: a window that is told at connect time that its daemon is
          // an older build can say so before anything fails, rather than after the rail has already
          // rendered a lie. `hello` is already in hand — the connection verified it before it counted
          // as connected — so this costs nothing and adds nothing to the wire.
          this.noteVersionSkew(connection.hello);
          void this.loadAll();
        }
      }),
    );

    // The daemon says *what* changed, and the store refetches that list. The alternative — the event
    // carrying the new state — would let two windows disagree about ordering, because each would
    // apply its own copy of "the truth".
    this.disposers.push(
      connection.on("coder:state-changed", (data) => {
        const change = data as { kind?: string } | undefined;
        this.scheduleRefresh(change?.kind);
      }),
    );
    this.disposers.push(
      connection.on("coder:mesh-status", (data) => {
        this.set({ mesh: data as MeshStatus });
      }),
    );

    // Run events arrive per connection, in `seq` order per run. They are appended, never replaced:
    // a client that rebuilt the array from each event would lose the transcript the moment two runs
    // interleaved.
    this.disposers.push(
      connection.on("coder:run-event", (data) => {
        const event = data as RunEvent;
        if (typeof event?.runId !== "string") return;
        const existing = this.state.runs[event.runId];
        if (!existing) {
          // An event for a run this window has never heard of: it was started by another window (or
          // before this one connected). Fetch it rather than dropping the event — a transcript that
          // silently begins mid-sentence is worse than a frame's delay.
          void this.openRun(event.runId);
          return;
        }
        if (existing.events.some((seen) => seen.seq === event.seq)) return;
        /**
         * **A run's own record moves with its events, and this is the bug the owner hit.**
         *
         * This handler used to append the event and leave `run` untouched — so `run.ended` never reached
         * `run.endedAt`, and the composer, which branches on exactly that field (`runLive`), kept believing a
         * finished run was live. The next message was sent to it and refused:
         *
         * > *"That run has already finished, so there is nothing to send to it. Start a new task instead."*
         *
         * The window was right and the state was wrong. `run.status` moves the same field for the same reason: a
         * run that has become `needs-attention` is not a run whose status is whatever it was when the snapshot was
         * fetched.
         */
        const run =
          event.kind === "run.ended"
            ? { ...existing.run, endedAt: event.at, status: event.status, exitCode: event.exitCode }
            : event.kind === "run.status"
              ? { ...existing.run, status: event.status }
              : existing.run;
        this.set({
          runs: {
            ...this.state.runs,
            [event.runId]: { run, events: [...existing.events, event] },
          },
        });
      }),
    );

    connection.start();
  }

  /**
   * Refetch the affected lists, at most once per frame-ish window.
   *
   * A burst is normal: adding a project and creating its first task emits two `projects`/`tasks`
   * pairs plus the caller's own refetch. Without coalescing, a fast user produces a refetch storm on
   * a socket with one in-flight request at a time.
   *
   * Kinds accumulate across the window. Resetting the timer alone used to keep only the *last* kind,
   * which is how a late boot `harnesses` event could swallow a `projects` refresh and leave the rail
   * empty after a successful add.
   */
  private scheduleRefresh(kind: string | undefined): void {
    this.refreshKinds.add(kind ?? "lists");
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      const kinds = this.refreshKinds;
      this.refreshKinds = new Set();
      // Three of the four kinds land in a list; `harnesses` / `providers` / `settings` refetch on
      // their own. What moved for harnesses is the *answer about an agent* — a run reports what it
      // published when its session opened — so a client that fetched task lists on that event alone
      // would fetch the wrong list, and the composer's pickers would keep showing what the agent
      // offered before it last ran. When several kinds share the window, each needed load runs.
      const loads: Promise<void>[] = [];
      if (kinds.has("settings")) loads.push(this.loadSettings());
      if (kinds.has("harnesses")) loads.push(this.loadHarnesses());
      if (kinds.has("providers")) loads.push(this.loadProviders());
      const needLists = [...kinds].some(
        (k) => k !== "settings" && k !== "harnesses" && k !== "providers",
      );
      if (needLists) loads.push(this.loadLists());
      void Promise.all(loads);
    }, 16);
  }

  async loadAll(): Promise<void> {
    await Promise.all([
      this.loadLists(),
      this.loadSettings(),
      this.loadHarnesses(),
      this.loadProviders(),
      this.loadCatalog(),
      this.loadMesh(),
    ]);
    this.set({ loaded: true });
  }

  async loadLists(): Promise<void> {
    const connection = this.connection;
    if (!connection || connection.status.state !== "connected") return;

    // **Asked separately, applied together.** The rail draws a project and its tasks in one frame,
    // which is why these two arrive as a pair — but they are two calls, and a daemon that answers one
    // and refuses the other is not a daemon that answered nothing. This used to be a single
    // `Promise.all`, so one failing method dropped both lists and the rail rendered "No projects yet"
    // for a project that was on disk the whole time. The real case that produced it: a window whose
    // daemon is a *different build* — the shell spawns a bundle, a dev server keeps running, an
    // upgrade leaves the old one holding the port — answering `coder.listProjects` and refusing
    // `coder.listTasks` with "Method not found".
    const [projects, tasks] = await Promise.all([
      this.read<{ projects: Project[] }>("coder.listProjects"),
      this.read<{ tasks: Task[] }>("coder.listTasks", {}),
    ]);

    const patch: Partial<CoderState> = {};
    if (projects.ok) patch.projects = projects.value.projects;
    if (tasks.ok) {
      patch.tasks = tasks.value.tasks;
      patch.tasksKnown = true;
    } else {
      patch.tasksKnown = false;
    }
    // One failure is enough to say so — and `noticeFromError` turns "the daemon does not know this
    // method" into the sentence that tells the user their daemon is an older build.
    const failure = projects.ok ? (tasks.ok ? undefined : tasks.error) : projects.error;
    patch.error = failure === undefined ? undefined : noticeFromError(failure);
    this.set(patch);
  }

  /**
   * Say it at connect time when the daemon is an older build than this window.
   *
   * The window and its daemon are two artifacts. A shell *attaches* to a daemon that already owns the
   * machine (family rule D2) instead of replacing it, so upgrading and restarting the app can leave
   * the previous build answering the port — and the symptom a user sees is not an error but a *lie*:
   * an empty rail, because the method that would have filled it is not in the old build.
   *
   * `hello` carries the daemon's own method list, so this is known before the first call. The notice
   * names the missing method, because that is the evidence, and `error.daemonTooOld` is the key the
   * failed-call path uses too — one sentence for one situation, whichever way the window found out.
   */
  private noteVersionSkew(hello: HelloResult | undefined): void {
    if (!hello) return;
    this.advertised = new Set(hello.methods);
    const missing = missingMethods(hello.methods);
    if (missing.length === 0) {
      // The same build, or a newer daemon — neither is skew. Clear only a skew notice, so a refusal the
      // user just earned is not wiped out by a reconnect.
      if (this.state.error?.key === "error.daemonTooOld") this.set({ error: undefined });
      return;
    }
    this.set({
      error: {
        message: `The daemon does not know ${missing.join(", ")}.`,
        key: "error.daemonTooOld",
        values: { method: missing[0] ?? "" },
      },
    });
  }

  /**
   * Does the daemon say it serves this method?
   *
   * `hello` carries the daemon's own compiled method list, so this is known before the first call — and it
   * is the difference between a window that reports the skew once and a window that earns twenty identical
   * "Method not found" refusals. An **empty** advertised list means the daemon does not describe itself at
   * all; that is not evidence that everything is missing, so the answer is yes and the calls speak for
   * themselves (`missingMethods` states the same asymmetry).
   */
  private canCall(method: string): boolean {
    return this.advertised.size === 0 || this.advertised.has(method);
  }

  /**
   * One read that reports its failure instead of throwing, so its sibling still lands.
   *
   * Deliberately not a `Promise.all` of the calls themselves: the point is that the two lists fail
   * independently. `loadAll` keeps the strict shape for the settings/harness/mesh loads, where a
   * failure genuinely means the window has nothing to show.
   */
  private async read<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    const connection = this.connection;
    if (!connection) return { ok: false, error: new Error(`There is no connection to call ${method}.`) };
    // A call this daemon cannot serve is not worth making: the answer is known, and the transport's own
    // words for it are the sentence `noteVersionSkew` has already turned into advice. The error below
    // is deliberately the *same text* the transport would have produced, so both paths end in one
    // notice — a caller cannot tell (and must not care) which one happened.
    if (!this.canCall(method)) {
      return { ok: false, error: new Error(`Method not found: ${method}`) };
    }
    try {
      return { ok: true, value: await connection.callTyped<T>(method, params) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async loadSettings(): Promise<void> {
    const connection = this.connection;
    if (!connection || connection.status.state !== "connected") return;
    try {
      const answer = await connection.callTyped<{ settings: CoderSettings }>("coder.getSettings");
      this.set({ settings: answer.settings });
    } catch (error) {
      this.fail(error);
    }
  }

  async loadHarnesses(): Promise<void> {
    const connection = this.connection;
    if (!connection || connection.status.state !== "connected") return;
    try {
      const answer = await connection.callTyped<{ harnesses: HarnessSummary[] }>("coder.listHarnesses");
      this.set({ harnesses: answer.harnesses });
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * The agents the user declared — **as the daemon probed them, not as the user typed them**.
   *
   * Nothing here interprets, defaults or repairs the answer. A missing `availability` would be a daemon
   * from before this method existed, and that case cannot arise: this method is new in the same build that
   * declares the field, so an older daemon refuses the *call* by name (which `fail` renders as "restart so
   * both come from one build") rather than answering with rows whose state has to be invented. That is why
   * there is no `availabilityOf`-style legacy mapping here, unlike the harness list, where the field
   * genuinely replaced an older one on a wire that was already in use.
   */
  async loadProviders(): Promise<void> {
    const connection = this.connection;
    if (!connection || connection.status.state !== "connected") return;
    try {
      const answer = await connection.callTyped<{ providers: AgentProviderSummary[] }>(
        "coder.listProviders",
      );
      this.set({ providers: answer.providers });
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * The catalogued agents, as the daemon projects them.
   *
   * **Failure is silent here, and that is deliberate.** `coder.listCatalog` is a method this build added,
   * and the shell attaches to whichever daemon owns the port — so an older daemon refuses it by name. The
   * other loads report that through `fail`, which is right for them: a missing task list is a lie about the
   * user's work. An empty catalogue is not a lie about anything, because the screen renders "this daemon is
   * an older build, so it has no catalogue to show" from the method list itself rather than from an empty
   * array. Raising a global error banner for it would put a scary sentence over the whole window for a
   * feature that is simply not there yet.
   */
  async loadCatalog(): Promise<void> {
    const connection = this.connection;
    if (!connection || connection.status.state !== "connected") return;
    // A call this daemon cannot serve is not worth making: `coder.hello`'s method list already answered,
    // and the transport's refusal is the same fact one round trip later.
    if (!this.canCall("coder.listCatalog")) return;
    try {
      const answer = await connection.callTyped<{ entries: CatalogEntry[] }>("coder.listCatalog");
      this.set({ catalog: answer.entries });
    } catch {
      // Nothing to report: see the doc above. The screen renders an empty catalogue as "not offered by
      // this daemon", never as "there are no agents".
    }
  }

  async loadMesh(): Promise<void> {
    const connection = this.connection;
    if (!connection || connection.status.state !== "connected") return;
    try {
      const answer = await connection.callTyped<{ mesh: MeshStatus }>("coder.meshStatus");
      this.set({ mesh: answer.mesh });
    } catch (error) {
      this.fail(error);
    }
  }

  /* ────────────────────────────── runs ────────────────────────────── */

  /** Load a run and its backlog, which is what a window does when it opens onto work in flight. */
  async openRun(runId: string): Promise<void> {
    const connection = this.connection;
    if (!connection || connection.status.state !== "connected") return;
    try {
      const answer = await connection.callTyped<{
        run: AgentRun;
        events: RunEvent[];
      }>("coder.tailRun", { runId });
      this.set({ runs: { ...this.state.runs, [runId]: { run: answer.run, events: answer.events } } });
    } catch (error) {
      /**
       * **A run this daemon does not have is not a failure of the window, and it must not be left unknown.**
       *
       * A task's `runId` is the daemon's own record, and a daemon that has restarted since knows nothing about it
       * (`docs/settings-parity.md` §7.35: the owner's task listed a run whose transcript the daemon answered with
       * `envoydev.run-missing`). The task is fine and its next message starts a new run, so the bar stays quiet
       * — and the record is marked **ended** rather than left absent, because absence is what made the window treat
       * a run it had never heard of as a run that was still going.
       */
      if (coderErrorCode(error instanceof Error ? error.message : String(error)) === ENVOYDEV_ERRORS.runMissing) {
        this.markRunEnded(runId);
        return;
      }
      this.fail(error);
    }
  }

  /**
   * Record that a run is over **when the daemon says so and will not say more** — a refusal to `send`, a `tailRun`
   * that answers "no such run". `endedAt` is the field every reader branches on; the status is left alone rather
   * than guessed, because the task list carries the real one.
   */
  private markRunEnded(runId: string): void {
    const existing = this.state.runs[runId];
    if (existing !== undefined && existing.run.endedAt !== undefined) return;
    const run: AgentRun = existing?.run ?? {
      id: runId,
      taskId: "",
      harness: "envoy-harness",
      hostId: "local",
      startedAt: new Date().toISOString(),
      status: "done",
    };
    this.set({
      runs: { ...this.state.runs, [runId]: { run: { ...run, endedAt: new Date().toISOString() }, events: existing?.events ?? [] } },
    });
  }

  /** The transcript for a run, folded from its events. Pure, and cheap enough to do per render. */
  transcript(runId: string): Transcript {
    return buildTranscript(this.state.runs[runId]?.events ?? []);
  }

  /**
   * Start a task.
   *
   * The run is loaded immediately after starting: the daemon answers `startRun` as soon as the run
   * *exists*, and the first events may already have been broadcast before the reply arrived, so
   * fetching the backlog is what closes that window rather than hoping the events beat the answer.
   */
  async startRun(
    taskId: string,
    prompt: string,
    options: {
      resume?: boolean;
      agentModeId?: string;
      model?: string;
      thinkingLevel?: string;
      images?: PromptImage[];
    } = {},
  ): Promise<{ ok: true; run: AgentRun } | Refusal> {
    const result = await this.mutate(
      "coder.startRun",
      {
        taskId,
        prompt,
        ...(options.resume !== undefined ? { resume: options.resume } : {}),
        // Absent rather than `undefined` when there is no mode: the daemon reads the task's stored one
        // in that case, and an explicit `null` would be a third meaning nobody asked for.
        ...(options.agentModeId !== undefined ? { agentModeId: options.agentModeId } : {}),
        // The same rule for the model, and one extra care: `""` is the control's "the agent's own
        // default" and is **not** sent, because the daemon's wire schema requires a non-empty model
        // (`z.string().min(1)`) — a value that means "nothing" must not travel as a model.
        ...(options.model !== undefined && options.model !== "" ? { model: options.model } : {}),
        // And the same rule again for the thinking level, whose schema also demands a non-empty value
        // for exactly the same reason: `""` is a request to clear, not a level.
        ...(options.thinkingLevel !== undefined && options.thinkingLevel !== ""
          ? { thinkingLevel: options.thinkingLevel }
          : {}),
        ...(options.images !== undefined && options.images.length > 0 ? { images: options.images } : {}),
      },
      (answer) => ({ ok: true as const, run: (answer as { run: AgentRun }).run }),
    );
    if (result.ok) {
      await this.openRun(result.run.id);
      // The task's status changed, and the rail is rendered from the task list.
      await this.loadLists();
    }
    return result;
  }

  async sendToRun(
    runId: string,
    text: string,
    mode: RunMode,
    images?: PromptImage[],
  ): Promise<{ ok: true; delivered: "queued" | "steered" } | Refusal> {
    const answer = await this.mutate(
      "coder.sendToRun",
      {
        runId,
        text,
        mode,
        ...(images !== undefined && images.length > 0 ? { images } : {}),
      },
      (result) => ({
      ok: true as const,
      delivered: (result as { delivered: "queued" | "steered" }).delivered,
    }));
    // **The daemon has just told this window something about its own state: the run it was about to send to is
    // finished.** Leaving the record as it was would keep the composer in "queue behind the running turn" mode and
    // refuse the *next* message too, so the window converges on the daemon's answer before the user presses again.
    if (!answer.ok && answer.key === "error.runFinished") await this.convergeRun(runId);
    return answer;
  }

  /**
   * **Bring one run's record into line with the daemon**, after it said the run is finished.
   *
   * `tailRun` is the honest source — the daemon's record carries the real `endedAt` and the events this window may
   * have missed — and a refusal of *that* is the one case where inventing an end is better than keeping a live
   * run: the run is gone (a daemon restarted since it was started), and the only thing that must not survive is a
   * run this window believes it can still send to.
   */
  private async convergeRun(runId: string): Promise<void> {
    const connection = this.connection;
    if (connection && connection.status.state === "connected") {
      try {
        await this.openRun(runId);
        return;
      } catch {
        // Fall through: `openRun` reports its own failures, and the end is marked either way.
      }
    }
    this.markRunEnded(runId);
  }

  async cancelRun(runId: string): Promise<{ ok: true } | Refusal> {
    return this.mutate("coder.cancelRun", { runId }, () => ({ ok: true as const }));
  }

  async answerApproval(
    runId: string,
    requestId: string,
    // The array form is what `TaskPane`'s approval picker emits for a multi-option answer, so the store
    // accepts it directly rather than making every caller wrap it as `{ optionIds }` — the adapter that
    // used to be missing is why `tsc -b` failed on `CoderApp`'s `onAnswer` handler.
    choice: string | readonly string[] | { optionIds: readonly string[] } | { text: string },
  ): Promise<{ ok: true } | Refusal> {
    const params =
      typeof choice === "string"
        ? { runId, requestId, optionId: choice }
        : isOptionIdList(choice)
          ? { runId, requestId, optionId: choice[0], optionIds: [...choice] }
          : "text" in choice
            ? { runId, requestId, text: choice.text }
            : { runId, requestId, optionId: choice.optionIds[0], optionIds: [...choice.optionIds] };
    return this.mutate("coder.answerApproval", params, () => ({ ok: true as const }));
  }

  /**
   * List one folder for the explorer.
   *
   * A refusal stays with the caller. A browse that failed is about the sidebar, not the window,
   * so this does not raise `state.error`.
   */
  async listDirectory(
    path: string,
  ): Promise<
    | { ok: true; entries: { name: string; kind: "dir" | "file"; path: string; size?: number; modifiedAt?: string }[] }
    | Refusal
  > {
    return this.mutate("coder.listHomeFsEntries", { path }, (answer) => {
      const result = answer as {
        entries: { name: string; kind: "dir" | "file"; path: string; size?: number; modifiedAt?: string }[];
      };
      return { ok: true as const, entries: result.entries };
    });
  }

  /** One file for a tab. A refusal stays with the tab, not the window banner. */
  async readFile(path: string): Promise<
    | {
        ok: true;
        file: {
          path: string;
          name: string;
          kind: "text" | "image" | "pdf" | "binary" | "tooLarge";
          size: number;
          mimeType?: string;
          content?: string;
        };
      }
    | Refusal
  > {
    return this.mutate("coder.readHomeFsFile", { path }, (answer) => {
      const file = answer as {
        path: string;
        name: string;
        kind: "text" | "image" | "pdf" | "binary" | "tooLarge";
        size: number;
        mimeType?: string;
        content?: string;
      };
      return { ok: true as const, file };
    });
  }

  /** An empty file or a folder in a directory the explorer is showing. */
  async createEntry(
    directory: string,
    name: string,
    kind: "file" | "dir",
  ): Promise<{ ok: true; path: string; kind: "file" | "dir" } | Refusal> {
    return this.mutate("coder.createHomeFsEntry", { directory, name, kind }, (answer) => {
      const created = answer as { path: string; kind: "file" | "dir" };
      return { ok: true as const, path: created.path, kind: created.kind };
    });
  }

  /**
   * Git changes in the task's folder.
   *
   * `repo: false` is an answer (not a git repository). Only a failed call is a refusal.
   */
  async listWorktreeChanges(path: string): Promise<
    | {
        ok: true;
        repo: boolean;
        changes: { path: string; kind: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflict"; from?: string }[];
      }
    | Refusal
  > {
    return this.mutate("coder.listWorktreeChanges", { path }, (answer) => {
      const result = answer as {
        repo: boolean;
        changes: { path: string; kind: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflict"; from?: string }[];
      };
      return { ok: true as const, repo: result.repo, changes: result.changes };
    });
  }

  /** The difference for one file in Changes. A refusal stays with the tab. */
  async readWorktreeDiff(
    directory: string,
    path: string,
    from?: string,
  ): Promise<
    | {
        ok: true;
        diff: {
          path: string;
          name: string;
          kind: "text" | "binary" | "tooLarge" | "empty";
          size: number;
          content?: string;
        };
      }
    | Refusal
  > {
    return this.mutate(
      "coder.readWorktreeDiff",
      { directory, path, ...(from !== undefined ? { from } : {}) },
      (answer) => {
        const diff = answer as {
          path: string;
          name: string;
          kind: "text" | "binary" | "tooLarge" | "empty";
          size: number;
          content?: string;
        };
        return { ok: true as const, diff };
      },
    );
  }

  /**
   * Ask an agent what it offers — the pre-flight probe, from the window.
   *
   * Three outcomes come back as **successes**, because all three are answers this call produced: the
   * agent published a list, the agent published nothing, or the daemon could not ask. Only a failure of
   * the *call* (no connection, a method this daemon does not have, a refused parameter) is a `Refusal`,
   * and the caller renders that in the same line as `unreachable` — it is the same statement to a user:
   * we could not ask, and here is why.
   *
   * Nothing is refetched here. A successful probe writes the observation through the store, which emits
   * `coder:state-changed {kind: "harnesses"}`, and the window already refetches the agent list on that
   * event — the push-driven arrangement this store is built on, rather than a second path that could
   * disagree with it about when the list is current.
   */
  async probeSessionOptions(
    harness: HarnessId,
    options: { force?: boolean } = {},
  ): Promise<{ ok: true; outcome: ProbeOutcome; detail: string } | Refusal> {
    return this.mutate(
      "coder.probeSessionOptions",
      { harness, ...(options.force !== undefined ? { force: options.force } : {}) },
      (answer) => {
        const result = answer as { outcome: ProbeOutcome; detail: string };
        return { ok: true as const, outcome: result.outcome, detail: result.detail };
      },
    );
  }

  /**
   * **Choose how an agent's connector is delivered** — installed here, or fetched by `npx` on first run.
   *
   * The one call in this store that changes *what a run starts*. A refusal is possible and expected (a connector
   * that is not on npm cannot be fetched), and the caller renders it where the control is rather than in a strip
   * somewhere else.
   */
  async setAgentDelivery(
    harness: HarnessId,
    delivery: "installed" | "npx",
  ): Promise<{ ok: true; delivery: AgentDeliveryWire } | Refusal> {
    return this.mutate("coder.setAgentDelivery", { harness, delivery }, (answer) => {
      const result = answer as { delivery: AgentDeliveryWire };
      return { ok: true as const, delivery: result.delivery };
    });
  }

  /**
   * **Run the fix a row is showing** — the one action here that changes the user's machine.
   *
   * It sends the **target**, never a command: the daemon resolves the commands through the same probes that drew
   * the row, at the moment of the press (`fixes.ts` carries that property and why it is the whole design). The
   * result is the daemon's four outcomes, and the caller renders them in the block the press came from — a
   * failure inline, where the command is, rather than in a notice strip somewhere else.
   *
   * Nothing is refetched here: a successful install makes the daemon emit `harnesses` (it re-checks as part of
   * the run), and the window already re-reads the list on that event — the push-driven arrangement this store is
   * built on, rather than a second path that could disagree about when the list is current.
   */
  async runFix(target: FixTarget): Promise<{ ok: true; result: FixRunResultWire } | Refusal> {
    // **Not asked of a daemon that does not have it**, on the same terms as the rest of this store: a call whose
    // answer is already known to be "Method not found" produces a raw transport error in front of a user for no
    // new information. The page does not draw the control either — the two halves of one decision.
    if (!this.canCall("coder.runFix")) {
      const failure = localNotice("error.daemonTooOld");
      this.set({ error: failure });
      return { ok: false, ...failure };
    }
    return this.mutate("coder.runFix", { target }, (answer) => {
      const result = answer as FixRunResultWire;
      return { ok: true as const, result };
    });
  }

  /**
   * **Look at this machine again** — the page's *Check again*, and the answer to *"I installed the bridge in
   * my terminal; how does EnvoyDev find out without a restart?"*
   *
   * The daemon re-measures every row on the read, so the list itself is never stale *if* something asks it.
   * What cannot be right on its own is the two inputs the daemon captures once per process — the login shell's
   * `PATH` and its per-name `command -v` answers — so the call re-asks those and then broadcasts, and this
   * method re-reads through the ordinary loaders rather than accepting a list back on the answer: one
   * projection, one path, and the *other* windows hear on the bus like they do for every other change.
   *
   * A daemon that does not serve the method is not an error to report — the control is not rendered
   * (`SettingsPane` gates on `coder.hello`'s method list), and a press that arrives from an older build's
   * window does nothing rather than showing a failure for a page that is about to be correct by itself.
   */
  async recheckAgents(): Promise<void> {
    const connection = this.connection;
    if (!connection || connection.status.state !== "connected") return;
    if (!this.canCall("coder.recheckAgents")) return;
    try {
      await connection.callTyped("coder.recheckAgents", {});
    } catch {
      // The re-ask is best effort: the daemon logs what a shell could not tell it, and the re-read below still
      // shows the user the most current answer the daemon has.
    }
    await Promise.all([
      this.loadHarnesses(),
      this.canCall("coder.listCatalog") ? this.loadCatalog() : Promise.resolve(),
    ]);
  }

  /* ────────────────────────────── actions ────────────────────────────── */

  /**
   * Every action returns a typed result rather than throwing.
   *
   * A rejected promise from a click handler is an unhandled rejection in the console; a returned
   * refusal is a sentence the caller can put in front of the user, which is what a control plane
   * owes when it cannot do what was asked.
   */
  async addProject(path: string): Promise<{ ok: true; project: Project } | Refusal> {
    return this.mutate("coder.addProject", { path }, (result) => {
      const project = (result as { project: Project }).project;
      // The RPC answer *is* the rail's confirmation. Waiting only for `coder:state-changed` left
      // the row missing when that broadcast was coalesced away (boot `harnesses`) or when the path
      // was already registered and the daemon returned success without emitting again.
      if (!this.state.projects.some((row) => row.id === project.id)) {
        this.set({ projects: [...this.state.projects, project] });
      }
      return { ok: true, project };
    });
  }

  async createTask(input: {
    projectId: string;
    title: string;
    harness?: HarnessId;
    model?: string;
  }): Promise<{ ok: true; task: Task } | Refusal> {
    return this.mutate("coder.createTask", input, (result) => {
      const task = (result as { task: Task }).task;
      // Same rule as `addProject`: the RPC answer paints the row; do not wait on a broadcast that can
      // be coalesced away before the rail reads the new list.
      if (!this.state.tasks.some((row) => row.id === task.id)) {
        this.set({ tasks: [...this.state.tasks, task], tasksKnown: true });
      }
      return { ok: true, task };
    });
  }

  async updateTask(
    input: {
      id: string;
      title?: string;
      pinned?: boolean;
      cwd?: string;
      agentModeId?: string;
      /**
       * The model for this task's next run, provider-qualified — or `""` for **the agent's own
       * default**, which is a real choice and the only way to undo a model without replacing it.
       * The daemon turns `""` into "drop the stored model" rather than storing an empty string.
       */
      model?: string;
      /**
       * The thinking level for this task's next run, as the agent's own id — or `""` for **the agent's
       * own default**, which the daemon turns into "drop the stored level" rather than storing an empty
       * string. A level is an id in the agent's vocabulary (`off`, `low`, `high`, `max`), so there is no
       * equivalent of the model's free-text case: it is stored exactly as the agent published it.
       */
      thinkingLevel?: string;
      fastMode?: boolean;
      planMode?: boolean;
    },
  ): Promise<{ ok: true; task: Task } | Refusal> {
    return this.mutate("coder.updateTask", input, (result) => ({
      ok: true,
      task: (result as { task: Task }).task,
    }));
  }

  async archiveTask(
    id: string,
    archived = true,
  ): Promise<{ ok: true; task: Task } | Refusal> {
    return this.mutate("coder.archiveTask", { id, archived }, (result) => ({
      ok: true,
      task: (result as { task: Task }).task,
    }));
  }

  async removeProject(id: string): Promise<{ ok: true } | Refusal> {
    return this.mutate("coder.removeProject", { id }, () => ({ ok: true }));
  }

  /**
   * A project's own defaults — the second scope, and the one the sidebar's `⋯` button edits.
   *
   * Sent whole rather than as a patch, because a project's defaults **replace**: a call carrying only a
   * model would leave that project's agent undefined, and the next task in it would silently fall back
   * to this machine's default agent. `""` on `model` or `extraArgs` is "clear it", the same sentinel the
   * daemon's settings patch uses.
   *
   * The refusal is returned rather than swallowed, like every other action here: a project that could
   * not be updated has to say so, because the pane's controls would otherwise keep showing the value the
   * user chose while the stored one is the old.
   */
  async updateProject(input: {
    id: string;
    defaults: TaskDefaults;
  }): Promise<{ ok: true; project: Project } | Refusal> {
    return this.mutate("coder.updateProject", input, (result) => ({
      ok: true,
      project: (result as { project: Project }).project,
    }));
  }

  /* ────────────────────── the agents a user manages ────────────────────── */

  /**
   * Declare an agent — one of the catalogue's, or one nobody catalogued.
   *
   * The parameters are sent **verbatim**, `transport` included, and that is the point of the signature
   * taking the whole input rather than a set of fields: the screen that adds a catalogue entry passes the
   * entry's own statement of its dialect through untouched, so no caller here can decide one. A field
   * defaulted in this store would be a dialect invented one layer below the screen, which is exactly the
   * silent wrongness `AgentProviderConfig` requires the field to prevent.
   *
   * The list is refetched rather than patched locally. The daemon broadcasts `providers` and this store's
   * own event handler already reloads it — and the second window must see the same list, which a local
   * append would not do.
   */
  async addProvider(input: AddProviderInput): Promise<{ ok: true } | Refusal> {
    return this.mutate(
      "coder.addProvider",
      {
        id: input.id,
        label: input.label,
        command: input.command,
        args: [...input.args],
        env: [...input.env],
        transport: input.transport,
        // Sent only when there is one: the manual form declares an agent nobody catalogued, and a
        // `catalogEntryId` of `undefined` on the wire would be a reference to nothing rather than its
        // absence. The daemon's parameter schema is `.strict()`, so this is the *only* field about a
        // catalogue recipe that can cross — there is no `envDefaults` to accidentally fill in.
        ...(input.catalogEntryId !== undefined ? { catalogEntryId: input.catalogEntryId } : {}),
      },
      () => ({ ok: true as const }),
    );
  }

  /** Forget a provider. The daemon answers the id it removed, or refuses because there is nothing there. */
  async removeProvider(id: string): Promise<{ ok: true; removed: string } | Refusal> {
    return this.mutate("coder.removeProvider", { id }, (result) => ({
      ok: true as const,
      removed: (result as { removed: string }).removed,
    }));
  }

  /**
   * Ask an agent to run its **own** sign-in flow, and report what happened.
   *
   * Every outcome comes back as a success, including the four that are not: the agent opened a session,
   * refused, accepted but did not finish, named no method we may send, or could not be started. All five
   * are answers this call produced, and the caller renders the daemon's keyed sentence for whichever it
   * was. Only a failure of the *call* is a `Refusal` — no connection, a method this daemon lacks.
   */
  async signInAgent(
    harness: HarnessId,
    options: { methodId?: string } = {},
  ): Promise<{ ok: true; outcome: SignInOutcome; detail: string } | Refusal> {
    return this.mutate(
      "coder.signInAgent",
      { harness, ...(options.methodId !== undefined ? { methodId: options.methodId } : {}) },
      (result) => {
        const answer = result as { outcome: SignInOutcome; detail: string };
        return { ok: true as const, outcome: answer.outcome, detail: answer.detail };
      },
    );
  }

  /** Mint an `envoy://pair` URI for the phone. The URI carries the secret — never log it. */
  async mintPairing(
    input: { deviceLabel?: string; host?: string; token?: string; fresh?: boolean } = {},
  ): Promise<
    | { ok: true; uri: string; device: { id: string; deviceLabel: string; createdAt: string; expiresAt: string } }
    | Refusal
  > {
    return this.mutate(
      "coder.mintPairing",
      {
        ...(input.deviceLabel ? { deviceLabel: input.deviceLabel } : {}),
        ...(input.host ? { host: input.host } : {}),
        ...(input.token ? { token: input.token } : {}),
        ...(input.fresh === true ? { fresh: true } : {}),
      },
      (result) => {
        const answer = result as {
          uri: string;
          device: { id: string; deviceLabel: string; createdAt: string; expiresAt: string };
        };
        return { ok: true as const, uri: answer.uri, device: answer.device };
      },
    );
  }

  async listPairedDevices(): Promise<
    | {
        ok: true;
        devices: readonly {
          id: string;
          deviceLabel: string;
          createdAt: string;
          expiresAt: string;
          revokedAt?: string;
          lastSeenAt?: string;
        }[];
      }
    | Refusal
  > {
    return this.mutate("coder.listPairedDevices", {}, (result) => {
      const answer = result as {
        devices: readonly {
          id: string;
          deviceLabel: string;
          createdAt: string;
          expiresAt: string;
          revokedAt?: string;
          lastSeenAt?: string;
        }[];
      };
      return { ok: true as const, devices: answer.devices };
    });
  }

  async revokePairedDevice(id: string): Promise<
    | { ok: true; device: { id: string; deviceLabel: string; createdAt: string; expiresAt: string; revokedAt?: string } }
    | Refusal
  > {
    return this.mutate("coder.revokePairedDevice", { id }, (result) => {
      const answer = result as {
        device: { id: string; deviceLabel: string; createdAt: string; expiresAt: string; revokedAt?: string };
      };
      return { ok: true as const, device: answer.device };
    });
  }

  /**
   * Forget a revoked record. The answer is the record that left the list, which is what lets a caller
   * confirm the delete happened rather than assume it did.
   */
  async forgetPairedDevice(id: string): Promise<
    | { ok: true; device: { id: string; deviceLabel: string; createdAt: string; expiresAt: string; revokedAt?: string } }
    | Refusal
  > {
    return this.mutate("coder.forgetPairedDevice", { id }, (result) => {
      const answer = result as {
        device: { id: string; deviceLabel: string; createdAt: string; expiresAt: string; revokedAt?: string };
      };
      return { ok: true as const, device: answer.device };
    });
  }

  /** Envoy Harness LLM panel — never returns the API key. */
  async getEnvoyLlm(): Promise<{ ok: true } & EnvoyLlmPublic | Refusal> {
    return this.mutate("coder.getEnvoyLlm", {}, (result) => {
      const answer = result as EnvoyLlmPublic;
      return { ok: true as const, ...answer };
    });
  }

  /** Save Envoy Harness LLM settings; `defaults.model` syncs on the daemon and via settings broadcast. */
  async setEnvoyLlm(input: EnvoyLlmSetInput): Promise<{ ok: true } & EnvoyLlmPublic | Refusal> {
    return this.mutate(
      "coder.setEnvoyLlm",
      {
        provider: input.provider,
        model: input.model,
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
        ...(input.clearApiKey !== undefined ? { clearApiKey: input.clearApiKey } : {}),
      },
      (result) => {
        const answer = result as EnvoyLlmPublic;
        return { ok: true as const, ...answer };
      },
    );
  }

  async updateSettings(patch: Partial<CoderSettings>): Promise<{ ok: true } | Refusal> {
    return this.mutate("coder.updateSettings", { settings: patch }, (result) => {
      this.set({ settings: (result as { settings: CoderSettings }).settings });
      return { ok: true };
    });
  }

  /**
   * The shared body of every write: refuse early when disconnected, answer in the user's words, and let the
   * daemon's broadcast drive the refetch rather than guessing at local state.
   *
   * A refusal is a `Notice` — the sentence the daemon sent plus the key to re-render it — which is
   * what makes a German window answer a German user even though the daemon wrote English. Nothing
   * here resolves the language: whoever renders it does that at render time, so switching language
   * re-renders the refusal that is already on screen.
   *
   * ## It raises nothing, and that is the whole point
   *
   * **A write's refusal belongs to the press, not to the window.** Until this changed, every write also
   * stored the same sentence in `state.error`, which the shell renders in the bar across the top — so a
   * press that already showed its refusal on the row it came from (the catalogue's *Add*, a fix run, a
   * sign-in) showed it *twice*: once where the user was looking and once in a strip above everything. The
   * owner read the second one and said what it was: *"After clicking 'Add', it will show the top bar which
   * is ugly and useless"*.
   *
   * A strip that carries a row's failure is useless because it is in the wrong place: it says nothing about
   * *which* control failed, it pushes the whole window down, and it has to be dismissed before the user can
   * get on with the thing they were doing. So the store returns the refusal and the caller — the row, the
   * composer, the palette — renders it where the press was. `state.error` is now only for what the *window*
   * could not do: a read that failed, the connection, a daemon that is a build behind.
   *
   * **Nothing may go silent because of this.** Every one of these methods returns `T | Refusal`, so a caller
   * that ignores the answer has to write `void` to do it, and every call site in the window was given a sink
   * in the same change (`apps/desktop/test/failure-placement.test.tsx` holds each one, surface by surface).
   */
  private async mutate<T>(
    method: string,
    params: Record<string, unknown>,
    onSuccess: (result: unknown) => T,
  ): Promise<T | Refusal> {
    const connection = this.connection;
    if (!connection || connection.status.state !== "connected") {
      // **Not raised either.** A press made while the window is disconnected is a press that failed, and the
      // answer belongs on the control that made it; the connection's own chip already says the socket is
      // down, so a strip repeating it in different words adds nothing a user can act on.
      return { ok: false, ...localNotice("error.notConnectedChange") };
    }
    try {
      const result = await connection.call(method, params);
      return onSuccess(result);
    } catch (error) {
      return { ok: false, ...noticeFromError(error) };
    }
  }

  /* ────────────────────────────── bookkeeping ────────────────────────────── */

  private fail(error: unknown): void {
    this.set({ error: noticeFromError(error) });
  }

  private set(patch: Partial<CoderState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A render that throws is React's problem, not the store's; and one broken subscriber must
        // not stop the others from being told the state changed.
      }
    }
  }
}

let singleton: CoderStore | undefined;

/** The app's store. One per window, which is one per daemon connection. */
export function getCoderStore(): CoderStore {
  singleton ??= new CoderStore();
  return singleton;
}

/** A store with an injected connection, for tests. Never the singleton. */
export function createCoderStore(options: CoderStoreOptions): CoderStore {
  return new CoderStore(options);
}
