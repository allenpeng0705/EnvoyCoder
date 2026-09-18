/**
 * The daemon's own state: projects, tasks and settings, on disk under `<home>/EnvoyDev/`.
 *
 * ## Why JSON files and not a database
 *
 * Five small collections that a human may need to read, fix or back up — and the reference product
 * reached the same conclusion for the same data (`docs/envoydev-paseo-inheritance.md` §2 cites its
 * `projects/projects.json`; Paseo's daemon state is JSON under one home directory, with no database
 * anywhere in it). A database here would buy transactions we do not need and cost the property we
 * do: a user can `cat` what this app remembers about their repositories.
 *
 * ## The rule that matters more than the format: never destroy a user's file
 *
 * A file we cannot parse is **quarantined, not overwritten**, and a single unusable *entry* inside a
 * valid file costs that entry rather than the file. Both halves of that rule — with the reasoning, and
 * with the one place that counts what it had to set aside — are in `./state-file.js`, which is where the
 * reading, the atomic write and the quarantine now live. What stays here is what a store is *for*: which
 * collections exist, what a mutation means, and the order they happen in.
 *
 * ## Writers are serialised, and reads are snapshots
 *
 * Every mutation goes through one promise chain (`this.tail`). The daemon is single-process, so
 * this is not about competing writers — it is about a mutation that `await`s a rename while a
 * second one starts, which would let two writes interleave and the *last* one to finish win rather
 * than the last one requested.
 */

import { mkdir } from "node:fs/promises";
import { basename } from "node:path";

import {
  type AgentAuthObservation,
  AgentAuthObservationSchema,
  type AgentProviderConfig,
  AgentProviderConfigSchema,
  type CoderSettings,
  CoderSettingsSchema,
  DEFAULT_CODER_SETTINGS,
  type HarnessId,
  type ObservedSessionOptions,
  ObservedSessionOptionsSchema,
  type Project,
  ProjectSchema,
  type Task,
  TaskSchema,
  readCoderSettingsDocument,
} from "@envoydev/protocol";
import type { CoderPaths } from "@envoydev/host-bridge";
import { projectIdFor, resolveTaskDefaults, taskIdFor } from "@envoydev/task-model";
import { harnessSwitchPatch, applyHarnessSwitch, taskMayFollowProjectHarness } from "./task-harness-switch.js";

import { StateFiles, type FileNotes } from "./state-file.js";

/** What a mutation reports, so a listener can refetch exactly one list. */
export interface StoreChange {
  kind: "projects" | "tasks" | "settings" | "harnesses" | "providers";
  at: string;
  ids?: readonly string[];
}

export interface CoderStoreOptions {
  paths: CoderPaths;
  now?: () => Date;
  /** Where a quarantined file goes. Defaults to beside the original, so it is findable. */
  quarantineSuffix?: (at: Date) => string;
}

export interface AddProjectInput {
  path: string;
  label?: string;
  hostId?: string;
  defaults?: { harness?: HarnessId; model?: string; extraArgs?: string };
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  cwd?: string;
  harness?: HarnessId;
  model?: string;
  extraArgs?: string;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  pinned?: boolean;
  harness?: HarnessId;
  model?: string;
  /**
   * Move the task to another folder. Already normalised and checked as a directory by the caller —
   * the store owns data, not the filesystem (the same division `coder.addProject` uses).
   *
   * It is *not* `projectId`: a task can point at a subdirectory of its project (a monorepo package),
   * and a folder chosen elsewhere does not refile the row. Refiling would mean the rail reshuffling
   * under a user who only asked to change where the agent works, so the two facts stay separate.
   */
  cwd?: string;
  /** The agent's own mode for this task's next run. */
  agentModeId?: string;
  /**
   * Forget the stored mode, leaving the key off the task entirely.
   *
   * Explicit rather than "send `agentModeId: undefined`", because those two are different requests on
   * a JSON wire: an absent field means "leave it as it is", and only a caller that knows the mode is
   * no longer valid — the handler, which can see the agent that replaced it — may say "drop it".
   */
  clearAgentMode?: boolean;
  /**
   * Forget the stored model, on the same terms as `clearAgentMode` and for the same reason: the model
   * on a task is provider-qualified (`anthropic/claude-sonnet-4-6`) and one agent resolves it by
   * looking it up in its own published list, so a value that was right for the agent the user replaced
   * can be unresolvable for the new one. Absent means leave it alone; only the handler, which is the
   * only place that can see both values, may say drop it.
   */
  clearModel?: boolean;
  /** The agent's own thinking-level id for this task's next run. */
  thinkingLevel?: string;
  /**
   * Forget the stored thinking level, leaving the key off the task entirely.
   *
   * `clearModel`'s twin, and needed for the same two reasons: `{thinkingLevel: undefined}` survives
   * `JSON.stringify` as nothing at all, so "unset it" cannot be expressed as a patch; and switching to
   * an agent with no thought-level method must be able to leave the task clean rather than unrunnable.
   */
  clearThinkingLevel?: boolean;
  extraArgs?: string;
}

/**
 * What the store could not read, in end-user words. Reported at `coder.hello`.
 *
 * `StateFiles`' own shape, under the name the daemon has always used for it: the class that counts
 * quarantined and skipped files is `./state-file.js` now, and a second identical interface here would be a
 * second thing to keep in step.
 */
export type StoreNotes = FileNotes;

export class CoderStore {
  private readonly paths: CoderPaths;
  private readonly now: () => Date;
  /**
   * The file half of this class: read, write atomically, set aside what cannot be read.
   *
   * See `./state-file.js` for why it is separate — two hundred lines of file handling that had grown
   * `CoderStore` past the repository's size rule, none of which was about what a store *remembers*.
   */
  private readonly files: StateFiles;

  /**
   * The file half, for a collection that lives in its own file and is **not** this class's subject.
   *
   * `AgentDeliveries` is the one caller: it is a store of its own, and it needs the same read-tolerantly /
   * write-atomically / quarantine-what-cannot-be-read behaviour. A second `StateFiles` instance would be a second
   * set of `quarantined` notes for the same directory, and the diagnostics would then depend on which one a
   * caller happened to hold.
   */
  get fileHelper(): StateFiles {
    return this.files;
  }

  private projectsState: Project[] = [];
  private tasksState: Task[] = [];
  private settingsState: CoderSettings = DEFAULT_CODER_SETTINGS;
  /**
   * What each agent published the last time a session was opened with it, one entry per agent.
   *
   * In memory as well as on disk because `coder.listHarnesses` reads it on every call: a daemon that
   * parsed the file per request would put a filesystem read in the path of a window's first paint.
   */
  private sessionOptionsState: ObservedSessionOptions[] = [];
  /**
   * The agents the user declared, one entry per provider.
   *
   * In memory as well as on disk for the same reason the observations above are: `coder.listProviders`
   * probes each one on every call, and a daemon that parsed the file per request would put a filesystem
   * read in the path of a window's first paint.
   */
  private providersState: AgentProviderConfig[] = [];
  /**
   * What each agent's authentication was the last time a probe or a sign-in looked, one entry per agent.
   *
   * In memory as well as on disk, for the third time and the same reason as the two collections above:
   * `coder.listHarnesses` reads it on every call, and a daemon that parsed the file per request would put a
   * filesystem read in the path of a window's first paint. Unlike the session-options record, this one is
   * also written when nothing could be established (`state: "unknown"`), because "we could not tell" is an
   * answer about an agent that has changed since the last one — see `AgentAuthObservation`.
   */
  private agentAuthState: AgentAuthObservation[] = [];

  private readonly listeners = new Set<(change: StoreChange) => void>();

  /** The write chain. See the module doc: one mutation at a time, in request order. */
  private tail: Promise<unknown> = Promise.resolve();

  private constructor(options: CoderStoreOptions) {
    this.paths = options.paths;
    this.now = options.now ?? (() => new Date());
    this.files = new StateFiles({
      ...(options.now ? { now: options.now } : {}),
      ...(options.quarantineSuffix ? { quarantineSuffix: options.quarantineSuffix } : {}),
    });
  }

  /**
   * Read the state directory, quarantining what cannot be read.
   *
   * `open` never throws for a *data* problem. It throws only when the directory itself cannot be
   * created, because that is the one failure the user has to fix (a permission or a missing volume)
   * and pretending to have loaded an empty state would hide it until the first save.
   */
  static async open(options: CoderStoreOptions): Promise<CoderStore> {
    const store = new CoderStore(options);
    await mkdir(store.paths.stateDir, { recursive: true });

    const projects = await store.files.readCollection(store.paths.projectsFile, ProjectSchema);
    store.projectsState = projects.items;
    if (projects.skipped.length > 0) await store.files.writeJsonAtomic(store.paths.projectsFile, projects.items);

    // **Adoption, not migration.** The file holding these rows was called `workspaces.json` before the
    // vocabulary changed to Project → Tasks, and a rename that ignores the old file would show a user an
    // empty rail while their work sat on disk under the previous name. The family's rule for state that
    // moves is to *adopt in place* (EnvoyMesh §5): read the old file when the new one does not exist,
    // then write it back under the new name. One-way, no dual-write, nothing deleted.
    await store.adoptLegacyTasksFile();
    const tasks = await store.files.readCollection(store.paths.tasksFile, TaskSchema);
    store.tasksState = tasks.items;
    if (tasks.skipped.length > 0) await store.files.writeJsonAtomic(store.paths.tasksFile, tasks.items);

    store.settingsState = await store.readSettings();

    // Read through the same collection helper as the two lists above, so a single malformed entry
    // costs that entry rather than every observation — and so a file we cannot parse at all is
    // quarantined rather than overwritten. What it holds is *evidence* about other products, so losing
    // it silently would leave a user with a text field where a picker used to be and no explanation.
    const observed = await store.files.readCollection(
      store.paths.sessionOptionsFile,
      ObservedSessionOptionsSchema,
    );
    store.sessionOptionsState = observed.items;
    if (observed.skipped.length > 0) {
      await store.files.writeJsonAtomic(store.paths.sessionOptionsFile, observed.items);
    }

    // The user's own agents, read through the same collection helper as everything else — which is what
    // gives this file the two properties that matter for a list a user edits by hand: one unusable row
    // costs that row, and a file we cannot parse at all is **quarantined rather than emptied**. Emptying
    // it would silently delete every agent the user had declared, which is the failure mode this store's
    // rule about never destroying a user's file exists to prevent.
    const providers = await store.files.readCollection(store.paths.providersFile, AgentProviderConfigSchema);
    store.providersState = providers.items;
    if (providers.skipped.length > 0) {
      await store.files.writeJsonAtomic(store.paths.providersFile, providers.items);
    }

    // And the authentication facts, through the same collection helper — for the same two properties, plus
    // one this file has that none of the others does: what it holds is a *measurement* of somebody else's
    // program, so losing it to a parse error would leave a row asserting nothing at all where it used to
    // assert something true.
    const auth = await store.files.readCollection(store.paths.agentAuthFile, AgentAuthObservationSchema);
    store.agentAuthState = auth.items;
    if (auth.skipped.length > 0) {
      await store.files.writeJsonAtomic(store.paths.agentAuthFile, auth.items);
    }
    return store;
  }

  /* ────────────────────────────── reads ────────────────────────────── */

  projects(): readonly Project[] {
    return this.projectsState;
  }

  tasks(options: { projectId?: string; includeArchived?: boolean } = {}): readonly Task[] {
    return this.tasksState.filter(
      (task) =>
        (options.includeArchived === true || !task.archivedAt) &&
        (!options.projectId || task.projectId === options.projectId),
    );
  }

  settings(): CoderSettings {
    return this.settingsState;
  }

  findProject(id: string): Project | undefined {
    return this.projectsState.find((project) => project.id === id);
  }

  findTask(id: string): Task | undefined {
    return this.tasksState.find((task) => task.id === id);
  }

  /** What this agent published the last time we opened a session with it, if we ever have. */
  sessionOptions(harness: HarnessId): ObservedSessionOptions | undefined {
    return this.sessionOptionsState.find((entry) => entry.harness === harness);
  }

  /** Every agent the user has declared. Empty is a normal answer, not a missing one. */
  providers(): readonly AgentProviderConfig[] {
    return this.providersState;
  }

  findProvider(id: string): AgentProviderConfig | undefined {
    return this.providersState.find((provider) => provider.id === id);
  }

  /**
   * What this agent's authentication was the last time anything looked, if anything ever has.
   *
   * `undefined` is the answer for an agent no probe has reached, and it is deliberately different from a
   * record whose `state` is `"unknown"`: the first says nothing has ever looked, the second says something
   * looked and could not tell. `summarize` renders both as `unknown` on the wire — a client cannot act
   * differently on the two — but the difference is kept here because the file is the record and a
   * maintainer reading it must be able to tell "never probed" from "probed, no answer".
   */
  agentAuth(harness: HarnessId): AgentAuthObservation | undefined {
    return this.agentAuthState.find((entry) => entry.harness === harness);
  }

  notes(): StoreNotes {
    return this.files.notes();
  }

  /** Subscribe to mutations. Returns an unsubscribe function. */
  onChange(listener: (change: StoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ────────────────────────────── reading ────────────────────────────── */

  /**
   * The user's settings: **read tolerantly by construction, quarantined only when there is nothing to
   * keep.**
   *
   * ## The failure mode this replaces, in the words of the report that found it
   *
   * *"`hiddenAgents` had to go into `RETIRED_SETTINGS_KEYS`, or the strict schema would have quarantined
   * an upgrading user's entire settings file (language, folder, default agent) over a list nothing reads."*
   * That is true, and it is the wrong shape of rule. A settings file is **the user's data**; one
   * unrecognised key must never cost them the other four, and it must never need a maintainer to remember
   * a list *before* deleting a field. Both halves of that sentence are defects: the first is what
   * happened, the second is what would have happened next time.
   *
   * ## Three outcomes, and the line between them
   *
   * | what is on disk | what happens | why |
   * |---|---|---|
   * | a document with a key this build does not have — retired or never shipped | **the key is dropped and noted; every other setting is kept** | we understand the document perfectly apart from a field nothing here reads. Losing a language, a folder and a default agent to it is not caution, it is destruction |
   * | bytes that are not JSON, or JSON that is not one object | **quarantined** | there is no document here to keep anything *from*. The bytes are moved aside, not overwritten, so a user can still read them |
   * | a document whose *values* we refuse — the right key with the wrong type | **quarantined** | the same. `keepTranscripts: "yes"` has no reading we could honestly pick, and guessing at a control plane's own configuration is worse than the defaults plus a sentence saying so |
   *
   * The distinction the middle rows share is the one the first row exists for: **prune keys, refuse
   * values.** A key we do not have is not an unreadable file.
   *
   * ## Why the file is not rewritten when a key is dropped
   *
   * The collection reader rewrites a list after skipping a bad row, so the warning appears once instead of
   * on every launch. Deliberately **not** copied here, because the situations are not the same shape. A
   * skipped row is a row this build cannot represent, and keeping it in the file means keeping something
   * that will never load. An unknown *settings* key is far more often a key from a **newer** build —
   * the user ran a newer EnvoyDev, then an older one — and rewriting the file would delete that
   * setting permanently, from a version that does read it. So the bytes are left exactly as they are,
   * the note is repeated until the user's next settings write (which necessarily drops the key, because
   * what is written is the parsed object), and nothing is destroyed behind their back.
   *
   * ## Why the note is a note rather than a refusal
   *
   * `notes()` is the mechanism the window already shows, and the reason it is the right one here is that
   * there is nothing for the user to *do*: the drop is correct, the rest of their settings are in force,
   * and the only action available would be to re-add a key this build has no reader for.
   */
  private async readSettings(): Promise<CoderSettings> {
    const raw = await this.files.readJson(this.paths.settingsFile);
    if (raw === undefined) return DEFAULT_CODER_SETTINGS;

    const read = readCoderSettingsDocument(raw);
    switch (read.kind) {
      case "ok":
        if (read.dropped.length > 0) {
          this.files.noteDroppedSettingsKeys(this.paths.settingsFile, read.dropped);
        }
        return read.settings;
      case "not-a-document":
        await this.files.quarantine(
          this.paths.settingsFile,
          `settings: expected one object of settings, found ${read.found}`,
        );
        return DEFAULT_CODER_SETTINGS;
      case "refused":
        await this.files.quarantine(
          this.paths.settingsFile,
          `settings did not match the schema: ${read.issues}`,
        );
        return DEFAULT_CODER_SETTINGS;
    }
  }

  /* ────────────────────────────── mutations ────────────────────────────── */

  async addProject(input: AddProjectInput): Promise<{ project: Project; created: boolean }> {
    const hostId = input.hostId ?? "local";
    const id = projectIdFor(hostId, input.path);
    const existing = this.projectsState.find((project) => project.id === id);
    // Adding a directory that is already a project is a *success*, not a conflict: the user asked
    // for it to be there, and it is. A duplicate row would be the real bug.
    if (existing) return { project: existing, created: false };

    const project: Project = {
      id,
      path: input.path,
      label: input.label ?? (basename(input.path) || input.path),
      hostId,
      addedAt: this.now().toISOString(),
      ...(input.defaults ? { defaults: input.defaults } : {}),
    };
    this.projectsState = [...this.projectsState, project];
    await this.persistProjects(["added"]);
    return { project, created: true };
  }

  /**
   * Update a project — its label, its tags, and **the defaults its tasks inherit**.
   *
   * The defaults *replace* rather than merge, which is the opposite of `updateSettings` and deliberate:
   * a project's defaults are a complete statement about that project ("this one runs on DeepSeek"),
   * while the app's are a set of independent fallbacks. The patch shape carries `""` for "clear", on the
   * same terms as `updateSettings` — a project scope whose model control can be emptied has to be able
   * to empty it — and `dropCleared` is what keeps the sentinel out of the stored file.
   *
   * When the resolved agent changes, every **idle** task in the project is rewritten onto that agent
   * (mode / model / thinking cleared when the new harness cannot honour them). That is what stops the
   * project header saying DeepSeek while an open task still says Envoy. Active runs are left alone.
   */
  async updateProject(
    id: string,
    patch: { label?: string; defaults?: Project["defaults"]; tags?: readonly string[] },
  ): Promise<Project | undefined> {
    const current = this.projectsState.find((project) => project.id === id);
    if (!current) return undefined;
    const next: Project = {
      ...current,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.defaults !== undefined ? { defaults: dropCleared(patch.defaults) } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    };
    this.projectsState = this.projectsState.map((project) => (project.id === id ? next : project));
    await this.persistProjects([id]);

    if (patch.defaults !== undefined) {
      const resolvedHarness = (project: Project): HarnessId =>
        project.defaults?.harness ?? this.settingsState.defaults.harness ?? "envoy-harness";
      const previousHarness = resolvedHarness(current);
      const nextHarness = resolvedHarness(next);
      if (previousHarness !== nextHarness) {
        const preferredModel = next.defaults?.model;
        const at = this.now().toISOString();
        const migratedIds: string[] = [];
        this.tasksState = this.tasksState.map((task) => {
          if (task.projectId !== id || !taskMayFollowProjectHarness(task)) return task;
          if (task.harness === nextHarness) return task;
          migratedIds.push(task.id);
          return applyHarnessSwitch(
            task,
            harnessSwitchPatch(task, nextHarness, preferredModel),
            at,
          );
        });
        if (migratedIds.length > 0) await this.persistTasks(migratedIds);
      }
    }

    return next;
  }

  /**
   * Remove a project, **archiving** its tasks rather than deleting them.
   *
   * A task can be mid-run, and its transcript is the user's work. Removing the project is a
   * statement about the rail, not about the tasks, so the tasks leave the rail and stay on disk.
   */
  async removeProject(id: string): Promise<{ removed: string; archived: readonly Task[] } | undefined> {
    const current = this.projectsState.find((project) => project.id === id);
    if (!current) return undefined;
    this.projectsState = this.projectsState.filter((project) => project.id !== id);

    const at = this.now().toISOString();
    const archived: Task[] = [];
    this.tasksState = this.tasksState.map((task) => {
      if (task.projectId !== id || task.archivedAt) return task;
      const next = { ...task, archivedAt: at, updatedAt: at };
      archived.push(next);
      return next;
    });

    await this.persistProjects([id]);
    if (archived.length > 0) await this.persistTasks(archived.map((task) => task.id));
    return { removed: id, archived };
  }

  async createTask(input: CreateTaskInput): Promise<Task | undefined> {
    const project = this.projectsState.find((candidate) => candidate.id === input.projectId);
    if (!project) return undefined;

    const at = this.now();
    const resolved = resolveTaskDefaults({
      project,
      appDefaults: this.settingsState.defaults,
      explicit: {
        ...(input.harness ? { harness: input.harness } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.extraArgs ? { extraArgs: input.extraArgs } : {}),
      },
    });

    const task: Task = {
      id: taskIdFor(project.id, input.title, at),
      projectId: project.id,
      cwd: input.cwd ?? project.path,
      title: input.title,
      harness: resolved.harness,
      ...(resolved.model ? { model: resolved.model } : {}),
      ...(resolved.extraArgs ? { extraArgs: resolved.extraArgs } : {}),
      // `idle`, not `queued`: nothing has been asked of an agent yet, and "waiting to start" would
      // claim a run exists. The rail reserves `queued` for work the daemon has accepted.
      status: "idle",
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    };
    this.tasksState = [...this.tasksState, task];
    await this.persistTasks([task.id]);
    return task;
  }

  async updateTask(input: UpdateTaskInput): Promise<Task | undefined> {
    const current = this.tasksState.find((task) => task.id === input.id);
    if (!current) return undefined;
    const next: Task = {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(input.harness !== undefined ? { harness: input.harness } : {}),
      // `clearModel` is the model's half of `clearAgentMode` below, and it exists for the same reason:
      // `{model: undefined}` survives `JSON.stringify` as *nothing at all*, so a task could not be sent
      // back to "the agent's own default" by a patch — only by an explicit flag the store acts on.
      ...(input.model !== undefined
        ? { model: input.model }
        : input.clearModel === true
          ? { model: undefined }
          : {}),
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      ...(input.agentModeId !== undefined
        ? { agentModeId: input.agentModeId }
        : input.clearAgentMode === true
          ? { agentModeId: undefined }
          : {}),
      // The thinking level's half of the same rule, and it is not folded into `model` because the two
      // are separate choices: a user can run one agent on a chosen model with the agent's own thinking
      // depth, and clearing one must not clear the other.
      ...(input.thinkingLevel !== undefined
        ? { thinkingLevel: input.thinkingLevel }
        : input.clearThinkingLevel === true
          ? { thinkingLevel: undefined }
          : {}),
      ...(input.extraArgs !== undefined ? { extraArgs: input.extraArgs } : {}),
      updatedAt: this.now().toISOString(),
    };
    this.tasksState = this.tasksState.map((task) =>
      task.id === input.id ? next : task,
    );
    await this.persistTasks([input.id]);
    return next;
  }

  async archiveTask(id: string, archived = true): Promise<Task | undefined> {
    const current = this.tasksState.find((task) => task.id === id);
    if (!current) return undefined;
    const at = this.now().toISOString();
    const next: Task = {
      ...current,
      updatedAt: at,
      ...(archived ? { archivedAt: at } : { archivedAt: undefined }),
    };
    this.tasksState = this.tasksState.map((task) => (task.id === id ? next : task));
    await this.persistTasks([id]);
    return next;
  }

  /**
   * Record a run starting or ending on a task. The run itself lives in the run manager; this
   * only keeps the row's status and its `runId` — the two facts the rail renders.
   */
  async setTaskRun(
    id: string,
    patch: { runId?: string | undefined; status?: Task["status"] },
  ): Promise<Task | undefined> {
    const current = this.tasksState.find((task) => task.id === id);
    if (!current) return undefined;
    const next: Task = {
      ...current,
      ...(patch.runId !== undefined ? { runId: patch.runId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: this.now().toISOString(),
    };
    this.tasksState = this.tasksState.map((task) => (task.id === id ? next : task));
    await this.persistTasks([id]);
    return next;
  }

  /**
   * Record what one agent published about itself in the session that just opened.
   *
   * ## Why this is a *record* and not a setting
   *
   * The options a session offers — the models, the thinking levels — are only knowable from a session,
   * and the window has to render them before the next run exists. So the daemon writes down what it
   * saw, with the time it saw it, and the window presents that as what it is: an observation from the
   * last session, which the agent may contradict next time. Two consequences follow, and both are
   * deliberate:
   *
   *   * **The newest observation replaces the oldest, per agent.** It is not a merge: an agent that
   *     stops offering a level has to be able to stop, and a union of everything ever seen would offer
   *     a value the agent has since dropped — the one failure this control row exists to prevent.
   *   * **An observation with no options is recorded too**, because "we opened a session and the agent
   *     published nothing" is a fact about the agent (it is what `envoy-harness` does), and it is a
   *     different statement from "we have not looked yet".
   *
   * The change kind is `harnesses`, not `tasks`: what moved is the answer about an *agent*, and a
   * client that refetched its task list on this event would fetch the wrong list.
   */
  async recordSessionOptions(observation: ObservedSessionOptions): Promise<void> {
    const others = this.sessionOptionsState.filter((entry) => entry.harness !== observation.harness);
    this.sessionOptionsState = [...others, observation];
    await this.enqueue(
      () => this.files.writeJsonAtomic(this.paths.sessionOptionsFile, this.sessionOptionsState),
      () =>
        this.emit({
          kind: "harnesses",
          at: this.now().toISOString(),
          ids: [observation.harness],
        }),
    );
  }

  /**
   * Apply a settings patch, with `""` meaning **"clear it"** rather than "store an empty value".
   *
   * The rule exists because of a fact about JSON rather than a preference: `{model: undefined}` survives
   * `JSON.stringify` as *nothing at all*, so a control that can choose a value could not un-choose one
   * by sending a patch. `coder.updateSettings` therefore accepts `""` on `defaultProjectPath` and on
   * `defaults.model` / `defaults.extraArgs` (see the wire schema), and this method is where that
   * sentinel stops: the key is **dropped**, so `CoderSettingsSchema` can keep requiring `min(1)` for
   * what is actually written to disk, and `resolveTaskDefaults` sees an absent key — which is exactly
   * the state "the app has no default" means.
   *
   * `defaults` merges rather than replaces: a client that sends `{harness}` must not silently clear a
   * model the user chose in another window.
   */
  async updateSettings(patch: Partial<CoderSettings>): Promise<CoderSettings> {
    const mergedDefaults = { ...this.settingsState.defaults, ...(patch.defaults ?? {}) };
    const next: CoderSettings = {
      ...this.settingsState,
      ...patch,
      // Undefined rather than `""`: the spread above would otherwise write the sentinel into the file,
      // and `ProjectDefaultsSchema` refuses it — a schema error at *this* point would surface as a
      // failed RPC for a user who did something entirely legal.
      ...(patch.defaultProjectPath === "" ? { defaultProjectPath: undefined } : {}),
      defaults: dropCleared(mergedDefaults),
    };
    this.settingsState = CoderSettingsSchema.parse(next);
    await this.persistSettings();
    return this.settingsState;
  }

  /**
   * Declare an agent of the user's own — or **replace** the one already under this id.
   *
   * ## Replace rather than merge, and why that is not the same decision `updateSettings` makes
   *
   * An app setting is one independent fallback among several, so a patch that carries only a model must
   * not clear a harness (`updateSettings` merges for exactly that reason). A provider is the opposite
   * shape: it is a **complete statement of how to start one program** — a command, its argv, the names of
   * the variables it needs and the dialect it speaks. Merging two of those would leave the user with half
   * of each: a new command with the previous command's arguments, which is a program that starts and does
   * something nobody asked for. So the incoming entry wins whole, and `""`-style clearing is not needed
   * because every field here is required or explicitly absent.
   *
   * The stored value is parsed through `AgentProviderConfigSchema` *here* rather than only at the wire, so
   * the file can never contain something the schema would refuse — including an id that names one of the
   * nine agents we ship, which a hand-edited file is the only remaining way to attempt.
   */
  async addProvider(input: AgentProviderConfig): Promise<{ provider: AgentProviderConfig; created: boolean }> {
    const provider = AgentProviderConfigSchema.parse(input);
    const existing = this.providersState.find((candidate) => candidate.id === provider.id);
    this.providersState = existing
      ? this.providersState.map((candidate) => (candidate.id === provider.id ? provider : candidate))
      : [...this.providersState, provider];
    await this.persistProviders([provider.id]);
    return { provider, created: existing === undefined };
  }

  /**
   * Forget a provider.
   *
   * `undefined` when there is nothing under that id, which the handler turns into a refusal rather than a
   * cheerful success — the same rule `removeProject` follows, so a user whose list changed under them in
   * another window is told rather than left believing a removal happened twice.
   *
   * Nothing else is touched, and that is deliberate rather than an omission: a provider is a *recipe*, and
   * no row refers to one — a task names a `HarnessId`. If a later slice lets a task run on a provider, that
   * slice owes the archived-not-deleted treatment `removeProject` gives tasks.
   */
  async removeProvider(id: string): Promise<{ removed: string } | undefined> {
    const current = this.providersState.find((provider) => provider.id === id);
    if (!current) return undefined;
    this.providersState = this.providersState.filter((provider) => provider.id !== id);
    await this.persistProviders([id]);
    return { removed: id };
  }

  /* ────────────────────────────── authentication ────────────────────────────── */

  /**
   * Record what one agent's authentication is — the newest observation replaces the oldest, per agent.
   *
   * ## A *record*, not a cache, and why a failed look is written too
   *
   * `coder.listHarnesses` must answer without starting anything, so the fact a probe learned has to
   * outlive the probe; that is the same argument `recordSessionOptions` makes. The difference between the
   * two is what happens when nothing could be established, and it is a difference in subject rather than a
   * change of rule:
   *
   *   * the session-options record **writes nothing** then, because "what does this agent offer" has no
   *     answer if we could not ask, and an entry would be a claim about somebody else's product;
   *   * this record **writes `unknown` with the reason**, because "can it open a session here" *does* have
   *     an answer when we tried and failed — *we could not tell* — and keeping a previous `needs-signin` in
   *     front of a user whose agent has since been uninstalled would be a stale fact presented as current.
   *
   * The change kind is `harnesses`, the same one a session observation emits and for the same reason: what
   * moved is the answer about an *agent*, so a client that refetched its task list here would fetch the
   * wrong list.
   */
  async recordAgentAuth(observation: AgentAuthObservation): Promise<void> {
    const parsed = AgentAuthObservationSchema.parse(observation);
    const others = this.agentAuthState.filter((entry) => entry.harness !== parsed.harness);
    this.agentAuthState = [...others, parsed];
    await this.enqueue(
      () => this.files.writeJsonAtomic(this.paths.agentAuthFile, this.agentAuthState),
      () =>
        this.emit({
          kind: "harnesses",
          at: this.now().toISOString(),
          ids: [parsed.harness],
        }),
    );
  }

  /* ────────────────────────────── reading ────────────────────────────── */

  /* ────────────────────────────── writing ────────────────────────────── */

  private persistProjects(ids: readonly string[]): Promise<void> {
    return this.enqueue(
      () => this.files.writeJsonAtomic(this.paths.projectsFile, this.projectsState),
      () => this.emit({ kind: "projects", at: this.now().toISOString(), ids }),
    );
  }

  private persistTasks(ids: readonly string[]): Promise<void> {
    return this.enqueue(
      () => this.files.writeJsonAtomic(this.paths.tasksFile, this.tasksState),
      () => this.emit({ kind: "tasks", at: this.now().toISOString(), ids }),
    );
  }

  private persistSettings(): Promise<void> {
    return this.enqueue(
      () => this.files.writeJsonAtomic(this.paths.settingsFile, this.settingsState),
      () => this.emit({ kind: "settings", at: this.now().toISOString() }),
    );
  }

  /**
   * The user's provider list, written whole.
   *
   * Its own change kind rather than reusing `harnesses`, which is the store's rule for every list: the
   * event says *what* moved so a client refetches the one list that changed. A second window that heard
   * `harnesses` here would ask `coder.listHarnesses` — nine agents it already has — and never see the
   * provider it was just told about.
   */
  private persistProviders(ids: readonly string[]): Promise<void> {
    return this.enqueue(
      () => this.files.writeJsonAtomic(this.paths.providersFile, this.providersState),
      () => this.emit({ kind: "providers", at: this.now().toISOString(), ids }),
    );
  }

  /**
   * Run a write and its notification in order, behind every write before it.
   *
   * The notification is queued *with* the write rather than fired before it, so a listener that
   * refetches on the event cannot read the state it had before the write landed.
   */
  private enqueue(write: () => Promise<void>, notify: () => void): Promise<void> {
    const next = this.tail.then(async () => {
      await write();
      notify();
    });
    // Keep the chain alive when a write fails; the caller still sees the rejection.
    this.tail = next.catch(() => undefined);
    return next;
  }

  private emit(change: StoreChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        // A listener is a UI notification, and one that throws must not fail the write that has
        // already succeeded — nor stop the other listeners from hearing about it.
      }
    }
  }

  /**
   * Write a file by writing a sibling and renaming over the target.
   *
   * The rename is the point: a reader (a backup tool, the user, a second process) sees either the
   * old file or the new one, never a half-written one. `fs.rename` replaces an existing target on
   * every platform we support — libuv maps it to `MoveFileEx(..., MOVEFILE_REPLACE_EXISTING)` on
   * Windows — so there is no platform branch to write here, which is why there is none.
   *
   * The retry covers the one Windows-specific way this can fail: a rename onto a file another
   * process holds open (`EPERM`/`EBUSY`/`EACCES`), which antivirus and search indexers do routinely.
   * Retrying a *rename* is safe because the rename is idempotent; retrying a partial write would
   * not be.
   */
  /**
   * If this install still has the pre-rename tasks file, take it over.
   *
   * Returns true when something was adopted, so the caller can log it once rather than silently
   * changing what a user sees. Deliberately narrow: only ever `tasks.json` ← `workspaces.json`, only
   * when the new file is absent, and the old file is left in place as a backup rather than deleted —
   * a one-way door should have a handle on the other side.
   */
  private async adoptLegacyTasksFile(): Promise<boolean> {
    const legacy = this.paths.tasksFile.replace(/tasks\.json$/, "workspaces.json");
    if (legacy === this.paths.tasksFile) return false;
    // `readJson` answers `undefined` for a missing file, which is the whole test we need.
    if ((await this.files.readJson(this.paths.tasksFile)) !== undefined) return false;

    const previous = await this.files.readCollection(legacy, TaskSchema);
    if (previous.items.length === 0) return false;
    await this.files.writeJsonAtomic(this.paths.tasksFile, previous.items);
    return true;
  }

}

/**
 * Drop the entries a client used `""` to clear, so the sentinel never reaches the disk.
 *
 * One function because there are three of them (`model` and `extraArgs` on a project *and* on the app
 * settings) and the rule is one rule: **`""` is the wire's "nothing chosen", and absence is what the
 * stored document means by it.** `harness` is deliberately not part of this — an empty harness is not a
 * state, it is a bug, and the schema refuses it.
 */
function dropCleared<T extends { model?: string; extraArgs?: string }>(defaults: T): T {
  const out = { ...defaults };
  if (out.model === "") delete out.model;
  if (out.extraArgs === "") delete out.extraArgs;
  return out;
}
