/**
 * The daemon's own state: projects, tasks and settings, on disk under `<home>/EnvoyCoder/`.
 *
 * ## Why JSON files and not a database
 *
 * Three small collections that a human may need to read, fix or back up — and the reference product
 * reached the same conclusion for the same data (`docs/envoycoder-paseo-inheritance.md` §2 cites its
 * `projects/projects.json`; Paseo's daemon state is JSON under one home directory, with no database
 * anywhere in it). A database here would buy transactions we do not need and cost the property we
 * do: a user can `cat` what this app remembers about their repositories.
 *
 * ## The rule that matters more than the format: never destroy a user's file
 *
 * A file we cannot parse is **quarantined, not overwritten**. The bytes are renamed aside with a
 * timestamp, the daemon carries on with the defaults, and the reason is reported through
 * `coder.hello` so the user is told rather than left to discover an empty sidebar. Silently writing
 * over a corrupt file is how a control plane makes someone lose the list of what they were working
 * on, and it is unrecoverable — which is the one failure mode worth being paranoid about here.
 *
 * A single *invalid entry* inside a valid file is a lesser case with a lesser response: the entry
 * is skipped, the rest of the file is kept, and the skip is reported. One bad row must not cost the
 * other forty.
 *
 * ## Writers are serialised, and reads are snapshots
 *
 * Every mutation goes through one promise chain (`this.tail`). The daemon is single-process, so
 * this is not about competing writers — it is about a mutation that `await`s a rename while a
 * second one starts, which would let two writes interleave and the *last* one to finish win rather
 * than the last one requested.
 */

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { z } from "zod";

import {
  type CoderSettings,
  CoderSettingsSchema,
  DEFAULT_CODER_SETTINGS,
  type HarnessId,
  type Project,
  ProjectSchema,
  type Task,
  TaskSchema,
} from "@envoycoder/protocol";
import type { CoderPaths } from "@envoycoder/host-bridge";
import { projectIdFor, resolveTaskDefaults, taskIdFor } from "@envoycoder/task-model";

/** What a mutation reports, so a listener can refetch exactly one list. */
export interface StoreChange {
  kind: "projects" | "tasks" | "settings";
  at: string;
  ids?: readonly string[];
}

export interface CoderStoreOptions {
  paths: CoderPaths;
  now?: () => Date;
  /** Where a quarantined file goes. Defaults to beside the original, so it is findable. */
  quarantineSuffix?: (at: Date) => string;
}

/**
 * A quarantined file's name.
 *
 * `projects.json` becomes `projects.corrupt-20260913T101500Z.json` — **still a `.json` file**, in
 * the same directory, so the user can open it and a backup tool will include it. Renaming it to
 * something without an extension, or moving it to a temp directory, would technically preserve the
 * bytes and practically lose them.
 */
function defaultQuarantineSuffix(at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `.corrupt-${stamp}.json`;
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
  extraArgs?: string;
}

/** What the store could not read, in end-user words. Reported at `coder.hello`. */
export interface StoreNotes {
  readonly quarantined: readonly { file: string; movedTo: string; reason: string }[];
  readonly skipped: readonly { file: string; reason: string }[];
}

export class CoderStore {
  private readonly paths: CoderPaths;
  private readonly now: () => Date;
  private readonly quarantineSuffix: (at: Date) => string;

  private projectsState: Project[] = [];
  private tasksState: Task[] = [];
  private settingsState: CoderSettings = DEFAULT_CODER_SETTINGS;

  private readonly listeners = new Set<(change: StoreChange) => void>();
  private readonly quarantined: { file: string; movedTo: string; reason: string }[] = [];
  private readonly skipped: { file: string; reason: string }[] = [];

  /** The write chain. See the module doc: one mutation at a time, in request order. */
  private tail: Promise<unknown> = Promise.resolve();

  private constructor(options: CoderStoreOptions) {
    this.paths = options.paths;
    this.now = options.now ?? (() => new Date());
    this.quarantineSuffix = options.quarantineSuffix ?? defaultQuarantineSuffix;
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

    const projects = await store.readCollection(store.paths.projectsFile, ProjectSchema);
    store.projectsState = projects.items;
    if (projects.skipped.length > 0) await store.writeJsonAtomic(store.paths.projectsFile, projects.items);

    // **Adoption, not migration.** The file holding these rows was called `workspaces.json` before the
    // vocabulary changed to Project → Tasks, and a rename that ignores the old file would show a user an
    // empty rail while their work sat on disk under the previous name. The family's rule for state that
    // moves is to *adopt in place* (EnvoyMesh §5): read the old file when the new one does not exist,
    // then write it back under the new name. One-way, no dual-write, nothing deleted.
    await store.adoptLegacyTasksFile();
    const tasks = await store.readCollection(store.paths.tasksFile, TaskSchema);
    store.tasksState = tasks.items;
    if (tasks.skipped.length > 0) await store.writeJsonAtomic(store.paths.tasksFile, tasks.items);

    store.settingsState = await store.readSettings();
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

  notes(): StoreNotes {
    return { quarantined: this.quarantined, skipped: this.skipped };
  }

  /** Subscribe to mutations. Returns an unsubscribe function. */
  onChange(listener: (change: StoreChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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

  async updateProject(
    id: string,
    patch: { label?: string; defaults?: Project["defaults"]; tags?: readonly string[] },
  ): Promise<Project | undefined> {
    const current = this.projectsState.find((project) => project.id === id);
    if (!current) return undefined;
    const next: Project = {
      ...current,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.defaults !== undefined ? { defaults: patch.defaults } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    };
    this.projectsState = this.projectsState.map((project) => (project.id === id ? next : project));
    await this.persistProjects([id]);
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

  async updateSettings(patch: Partial<CoderSettings>): Promise<CoderSettings> {
    const next: CoderSettings = {
      ...this.settingsState,
      ...patch,
      // `defaults` merges rather than replaces: a client that sends `{harness}` must not silently
      // clear a model the user chose in another window.
      defaults: { ...this.settingsState.defaults, ...(patch.defaults ?? {}) },
    };
    this.settingsState = CoderSettingsSchema.parse(next);
    await this.persistSettings();
    return this.settingsState;
  }

  /* ────────────────────────────── reading ────────────────────────────── */

  /**
   * Read a collection, tolerating both a broken file and a broken row.
   *
   * The schema is applied **per element**, not to the whole array: one invalid row costs that row,
   * not the file. The caller rewrites the file when anything was skipped, so the warning appears
   * once at startup instead of on every launch for a row that will never be valid.
   */
  private async readCollection<S extends z.ZodTypeAny>(
    file: string,
    schema: S,
  ): Promise<{ items: z.infer<S>[]; skipped: string[] }> {
    const raw = await this.readJson(file);
    if (raw === undefined) return { items: [], skipped: [] };
    if (!Array.isArray(raw)) {
      await this.quarantine(file, `expected a list in ${basename(file)}, found ${typeof raw}`);
      return { items: [], skipped: [] };
    }

    const items: z.infer<S>[] = [];
    const skipped: string[] = [];
    for (const [index, entry] of raw.entries()) {
      const parsed = schema.safeParse(entry);
      if (parsed.success) {
        items.push(parsed.data as z.infer<S>);
        continue;
      }
      const reason = `entry ${index + 1}: ${parsed.error.issues[0]?.message ?? "did not match the schema"}`;
      skipped.push(reason);
      this.skipped.push({ file: basename(file), reason });
    }
    if (skipped.length > 0) {
      this.skipped.push({
        file: basename(file),
        reason: `${skipped.length} entr${skipped.length === 1 ? "y was" : "ies were"} left out of the list, and the file has been rewritten without ${skipped.length === 1 ? "it" : "them"}.`,
      });
    }
    return { items, skipped };
  }

  private async readSettings(): Promise<CoderSettings> {
    const raw = await this.readJson(this.paths.settingsFile);
    if (raw === undefined) return DEFAULT_CODER_SETTINGS;
    const parsed = CoderSettingsSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    await this.quarantine(this.paths.settingsFile, `settings did not match the schema: ${parsed.error.message}`);
    return DEFAULT_CODER_SETTINGS;
  }

  /**
   * Read and parse one file.
   *
   * `undefined` means "there is nothing here", which covers a missing file and a file whose bytes
   * were not JSON — the second only after the bytes have been moved aside, since "there is nothing
   * here" must never be *made* true by us reading it.
   */
  private async readJson(file: string): Promise<unknown> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (text.trim() === "") return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      await this.quarantine(file, `not readable as JSON: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /** Move an unreadable file aside, and remember that we did. */
  private async quarantine(file: string, reason: string): Promise<void> {
    const at = this.now();
    const movedTo = join(dirname(file), baseNameWithoutExtension(file) + this.quarantineSuffix(at));
    try {
      await rename(file, movedTo);
    } catch (error) {
      // A file we cannot even move is reported and left alone. Deleting it would be the one action
      // that turns a recoverable problem into an unrecoverable one.
      this.quarantined.push({
        file,
        movedTo: "",
        reason: `${reason} (and it could not be moved aside: ${error instanceof Error ? error.message : String(error)})`,
      });
      return;
    }
    this.quarantined.push({ file, movedTo, reason });
  }

  /* ────────────────────────────── writing ────────────────────────────── */

  private persistProjects(ids: readonly string[]): Promise<void> {
    return this.enqueue(
      () => this.writeJsonAtomic(this.paths.projectsFile, this.projectsState),
      () => this.emit({ kind: "projects", at: this.now().toISOString(), ids }),
    );
  }

  private persistTasks(ids: readonly string[]): Promise<void> {
    return this.enqueue(
      () => this.writeJsonAtomic(this.paths.tasksFile, this.tasksState),
      () => this.emit({ kind: "tasks", at: this.now().toISOString(), ids }),
    );
  }

  private persistSettings(): Promise<void> {
    return this.enqueue(
      () => this.writeJsonAtomic(this.paths.settingsFile, this.settingsState),
      () => this.emit({ kind: "settings", at: this.now().toISOString() }),
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
    if ((await this.readJson(this.paths.tasksFile)) !== undefined) return false;

    const previous = await this.readCollection(legacy, TaskSchema);
    if (previous.items.length === 0) return false;
    await this.writeJsonAtomic(this.paths.tasksFile, previous.items);
    return true;
  }

  private async writeJsonAtomic(file: string, value: unknown): Promise<void> {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const temp = `${file}.tmp`;
    await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });

    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temp, file);
        return;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") break;
        await sleep(20 * (attempt + 1));
      }
    }
    // Leave no `.tmp` behind for the next read to trip over.
    await unlink(temp).catch(() => undefined);
    throw lastError;
  }
}

function baseNameWithoutExtension(file: string): string {
  const name = basename(file);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
