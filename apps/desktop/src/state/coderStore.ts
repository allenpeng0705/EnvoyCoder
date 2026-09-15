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
 *      about when it insists one function computes the attention count (`docs/envoycoder-ui.md` §4).
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
  CatalogProbe,
  CoderSettings,
  HarnessId,
  HarnessSummary,
  ProbeOutcome,
  Project,
  RunEvent,
  RunMode,
  SignInOutcome,
  Task,
  TaskDefaults,
} from "@envoycoder/protocol";
import { DEFAULT_CODER_SETTINGS, missingMethods } from "@envoycoder/protocol";

import { localNotice, noticeFromError, type Notice, type Refusal } from "../i18n/notice.js";
import { buildTranscript, type Transcript } from "./transcript.js";

import { CoderConnection, type ConnectionStatus, type HelloResult } from "../client/connection.js";
import { resolveDaemonEndpoint, type ResolvedEndpoint } from "../client/endpoint.js";

/** The mesh, as the daemon last reported it. Mirrors `CoderMeshStatus` in the protocol. */
export type MeshStatus =
  | { kind: "attached"; scopeKey: string; ownerId: string; peerCount?: number }
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
   * The catalogued agents — **the recipes, with nothing measured about them**.
   *
   * `coder.listCatalog` walks no search path and starts no process, so this list may be loaded with every
   * other list at connect time. What it deliberately does **not** carry is a state: an entry is a recipe,
   * and whether this machine can run it is a fact somebody has to measure. Each row's measurement lives
   * beside it in the settings screen's own state, taken one row at a time when the user asks for that row
   * (`probeCatalogAgent`), because 14 of the entries are `npx` recipes and a sweep would be a window that
   * fetches packages for asking a question nobody asked.
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
   * The last thing that went wrong, in the user's words.
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

export class CoderStore {
  private readonly options: CoderStoreOptions;
  private state: CoderState = initialState;
  private readonly listeners = new Set<() => void>();
  private connection: CoderConnection | undefined;
  private disposers: (() => void)[] = [];
  /** Coalesces a burst of change events into one refetch. See `scheduleRefresh`. */
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The methods the connected daemon says it has — its own build's catalogue, from `hello`.
   *
   * Empty until a daemon describes itself, and empty *means* "no idea": an older daemon that sends an
   * empty list is not a daemon with no methods, so nothing is skipped and the calls speak for
   * themselves. See `missingMethods` in `@envoycoder/protocol` for why this exists.
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

  /** Resolve the endpoint, open the connection, and load. Idempotent. */
  async start(): Promise<void> {
    if (this.connection) return;
    try {
      const resolved = await (this.options.resolveEndpoint ?? resolveDaemonEndpoint)();
      this.set({ resolved, error: undefined });
      this.open(resolved);
    } catch (error) {
      // Connection setup failures belong in the chip / empty work area — not the attention
      // banner. The banner is for actions the user just took (add project, start run, …).
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
    }
  }

  /** Clear the attention-banner error (Dismiss). Notices are owned by the shell UI. */
  clearError(): void {
    this.set({ error: undefined });
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.connection?.dispose();
    this.connection = undefined;
  }

  /* ────────────────────────────── reading ────────────────────────────── */

  private open(resolved: ResolvedEndpoint): void {
    const connection =
      this.options.connect?.(resolved) ??
      new CoderConnection({ endpoint: resolved.endpoint, client: { name: "EnvoyCoder window" } });
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
          this.set({ hello: connection.hello });
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
        this.set({
          runs: {
            ...this.state.runs,
            [event.runId]: { run: existing.run, events: [...existing.events, event] },
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
   */
  private scheduleRefresh(kind: string | undefined): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      // Three of the four kinds land in a list; `harnesses` is the odd one and refetches on its own.
      // What moved there is the *answer about an agent* — a run reports what it published when its
      // session opened — so a client that fetched task lists on this event would fetch the wrong list,
      // and the composer's pickers would keep showing what the agent offered before it last ran.
      void (kind === "settings"
        ? this.loadSettings()
        : kind === "harnesses"
          ? this.loadHarnesses()
          : kind === "providers"
            ? this.loadProviders()
            : this.loadLists());
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

  /**
   * One catalogued entry, measured — the row a user asked about, and only that row.
   *
   * The result is returned rather than stored, on the same arrangement `probeSessionOptions` uses and for a
   * sharper version of the same reason: the measurement belongs to the row the user pressed, the caller is
   * the thing rendering that row, and a copy in this store would be a second place a state could live. What
   * the *daemon* keeps is the cache, which is where it belongs — it is globally true, and a second window
   * asking a minute later must not make the daemon walk the search path again.
   */
  async probeCatalogAgent(
    id: string,
    options: { force?: boolean } = {},
  ): Promise<{ ok: true; probe: CatalogProbe } | Refusal> {
    return this.mutate(
      "coder.probeCatalogAgent",
      { id, ...(options.force !== undefined ? { force: options.force } : {}) },
      (answer) => ({ ok: true as const, probe: answer as CatalogProbe }),
    );
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
      this.fail(error);
    }
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
    options: { resume?: boolean; agentModeId?: string; model?: string; thinkingLevel?: string } = {},
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
  ): Promise<{ ok: true; delivered: "queued" | "steered" } | Refusal> {
    return this.mutate("coder.sendToRun", { runId, text, mode }, (answer) => ({
      ok: true as const,
      delivered: (answer as { delivered: "queued" | "steered" }).delivered,
    }));
  }

  async cancelRun(runId: string): Promise<{ ok: true } | Refusal> {
    return this.mutate("coder.cancelRun", { runId }, () => ({ ok: true as const }));
  }

  async answerApproval(
    runId: string,
    requestId: string,
    optionId: string,
  ): Promise<{ ok: true } | Refusal> {
    return this.mutate("coder.answerApproval", { runId, requestId, optionId }, () => ({ ok: true as const }));
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
      return { ok: true, project };
    });
  }

  async createTask(input: {
    projectId: string;
    title: string;
    harness?: HarnessId;
    model?: string;
  }): Promise<{ ok: true; task: Task } | Refusal> {
    return this.mutate("coder.createTask", input, (result) => ({
      ok: true,
      task: (result as { task: Task }).task,
    }));
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

  async updateSettings(patch: Partial<CoderSettings>): Promise<{ ok: true } | Refusal> {
    return this.mutate("coder.updateSettings", { settings: patch }, (result) => {
      this.set({ settings: (result as { settings: CoderSettings }).settings });
      return { ok: true };
    });
  }

  /**
   * The shared body of every write: refuse early when disconnected, report failures in the user's
   * words, and let the daemon's broadcast drive the refetch rather than guessing at local state.
   *
   * A refusal is a `Notice` — the sentence the daemon sent plus the key to re-render it — which is
   * what makes a German window answer a German user even though the daemon wrote English. Nothing
   * here resolves the language: the strip does that at render time, so switching language re-renders
   * the refusal that is already on screen.
   */
  private async mutate<T>(
    method: string,
    params: Record<string, unknown>,
    onSuccess: (result: unknown) => T,
  ): Promise<T | Refusal> {
    const connection = this.connection;
    if (!connection || connection.status.state !== "connected") {
      const failure = localNotice("error.notConnectedChange");
      this.set({ error: failure });
      return { ok: false, ...failure };
    }
    try {
      const result = await connection.call(method, params);
      this.set({ error: undefined });
      return onSuccess(result);
    } catch (error) {
      const failure = noticeFromError(error);
      this.set({ error: failure });
      return { ok: false, ...failure };
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
