/**
 * The daemon's method handlers: what the daemon *does* when a client asks.
 *
 * ## Why this is separate from the dispatcher
 *
 * `createCoderDispatcher` (`@envoydev/host-bridge`) decides **what may be called** — an unknown
 * method is refused, a known-but-unimplemented one is refused by name, and the dispatcher never
 * mints credentials. This module decides **what happens**, and nothing else: no sockets, no
 * transport, no identity. That split is what lets every behaviour here be tested by calling a
 * function with an object, which is the only way the interesting cases — a corrupt state file, a
 * project whose directory vanished, a second window adding the same path — get covered at all.
 *
 * ## Failures carry codes
 *
 * Every refusal here is a `coderError(...)`, whose message begins with an `envoydev.*` token, so
 * a client can branch on it after the family's transport has flattened `error.code` to `"ERROR"`.
 * `rpc.ts` explains why that is necessary rather than lazy. The rule for choosing one: **the code
 * says what happened, the message says what to do about it** — a code that needs prose to be
 * actionable is a code that was chosen wrong.
 */

import {
  currentSearchPath,
  getHomeFsInfo,
  listHomeFsEntries,
  listWorktreeChanges,
  readWorktreeDiff,
  createHomeFsEntry,
  readHomeFsFile,
  normalizeUserPath,
} from "@envoydev/platform";
import { stat } from "node:fs/promises";

import {
  type AgentId,
  type AgentProviderConfig,
  type AgentRun,
  type CoderLanguage,
  type HarnessId,
  type HarnessSummary,
  type ObservedSessionOptions,
  type PromptImage,
  type RpcMethod,
  type RunEvent,
  type CoderMeshStatus,
  ENVOYDEV_ERRORS,
  ENVOYDEV_PRODUCT_NAME,
  RPC_METHODS,
  coderError,
  isHarnessId,
  parseRpcParams,
} from "@envoydev/protocol";
import {
  ALL_HARNESSES,
  harnessAvailability,
  harnessDefinition,
  cataloguedRecipe,
  probeHarness,
  probeProvider,
  probeRecipe,
  type AcpAgentEntry,
  type HarnessProbe,
  type ProbeFinding,
  type ProviderProbe,
  fetchableCovers,
  fetchablePackage,
  fetchedRecipe,
} from "@envoydev/agent-catalog";
import type { CoderPaths } from "@envoydev/host-bridge";
import { resolveTaskDefaults } from "@envoydev/task-model";

import { keyed, ref } from "./messages.js";
import { createHealthHandlers } from "./health.js";
import type { PairedDeviceStore } from "./paired-devices.js";
import { createCatalogHandlers } from "./catalog.js";
import { getEnvoyLlmPublic, setEnvoyLlm, envoyHarnessModels } from "./envoy-llm.js";
import { harnessSwitchPatch } from "./task-harness-switch.js";
import { createFixHandlers } from "./fixes.js";
import { createGitHandlers, measureProjectVcs, type GitDeps } from "./git.js";
import { notFound } from "./not-found.js";
import { createRecheckHandlers } from "./recheck.js";
import { createProviderHandlers } from "./providers.js";
import { ensureRunnableAgent } from "./runnable-agent.js";
import { createSignInHandlers } from "./sign-in.js";
import type { SessionSignIn } from "./sign-in.js";
import { summarize } from "./summaries.js";
import type { RunManager } from "./runs.js";
import type { SessionProbe } from "./session-probe.js";
import type { CoderStore } from "./store.js";
import type { LogTail } from "./log-tail.js";
import { createShutdownHandlers } from "./shutdown.js";
import { createLogHandlers } from "./log-rpc.js";
import type { SupervisorDeps } from "./supervisor-rpc.js";
import { createSupervisorHandlers } from "./supervisor-rpc.js";

/** Identity of the running process — what makes `coder.hello` answer *which* daemon this is. */
export interface CoderInstance {
  instanceId: string;
  version: string;
  startedAt: string;
  /** How many windows and phones are attached right now. */
  connectionCount: () => number;
}

export interface CoderServiceDeps {
  store: CoderStore;
  paths: CoderPaths;
  instance: CoderInstance;
  /**
   * The paired devices, when this daemon has one.
   *
   * Here because **the hello path is where a client's identity arrives**: the transport resolves a token into a
   * session before any method is called, so `coder.hello` is the first and only moment the daemon can learn who
   * is on the other end. The store is created by `serve.ts` and shared with the pairing family rather than made
   * twice, so both see the same rows.
   */
  paired?: PairedDeviceStore;
  mesh: () => CoderMeshStatus;
  /** Injectable so a test can decide whether a path "exists" without a filesystem. */
  isDirectory?: (path: string) => Promise<boolean>;
  /** Injectable probe, so `coder.listHarnesses` is testable without the CLIs installed. */
  probe?: (harness: HarnessId) => HarnessProbe;
  /**
   * The provider probe, injected on the same terms as `probe` and for the same reason: a test that has to
   * know what a provider row says must not depend on what this machine happens to have installed.
   */
  probeProvider?: (provider: AgentProviderConfig) => ProviderProbe;
  /**
   * The probe for one **catalogued** entry, injected on the same terms as the two above.
   *
   * A third injection point rather than a reuse of `probe`, because the subjects are genuinely different:
   * a catalogue entry is a recipe rather than a `HarnessId`, and `probeHarness` cannot be asked about
   * `goose` at all. What is *not* different is the body — the daemon's own implementation is
   * `probeRecipe(cataloguedRecipe(entry))` over the same resolved search path, so a test that replaces this
   * is replacing a measurement, not a rule.
   */
  probeCatalogEntry?: (entry: AcpAgentEntry) => ProbeFinding;
  /**
   * Re-ask the machine where the user's programs are, and emit the change.
   *
   * Injected on the same terms as the three probes above: `serve.ts` owns the login-shell caches and the event
   * bus, and a test of this table wants to assert that a press reaches an implementation without spawning a
   * login shell. Absent means the method answers `{ ok: true }` having done nothing, which is the honest answer
   * for a table built without one — the same shape `runs` uses when M1 builds a daemon that cannot run.
   */
  recheckAgents?: () => Promise<void>;
  /**
   * Begin a graceful stop, for `coder.shutdown`. Wired by the boot, which knows how to record the reason and end
   * the process; absent in a build with no way to stop (a bench, or a daemon whose boot did not pass one).
   */
  shutdown?: () => void;
  /**
   * Everything the service switch needs to know *which* service it is talking about, plus the daemon's restart
   * history for the row (§5.3). Passed as one bag because the two must never disagree: `serviceFacts` reads a
   * ledger from `paths`, and the operations must act on that same `paths`.
   */
  service?: SupervisorDeps;
  /** The tail of the daemon's log, for the service page's "why did it fail" line. */
  daemonLog?: () => Promise<LogTail>;
  /**
   * **How each agent's connector is delivered** — the user's stored choice.
   *
   * Read by the list (so the row says which route is in force), by the `npx` probe below (the program that
   * starts is `npx`, so that is what is looked for), and by `coder.setAgentDelivery` (which writes it). Absent
   * means every agent is `installed`, which is what a table built without one must assume.
   */
  /**
   * Tell every window the agent list moved. Wired to the daemon's bus by `serve.ts`; absent in a table built for
   * a test, which then observes the write directly.
   */
  onHarnessesChanged?: () => void;
  deliveries?: {
    of: (harness: HarnessId) => "installed" | "npx";
    set: (harness: HarnessId, delivery: "installed" | "npx") => Promise<void>;
  };
  /**
   * How a fix is run, injected for the same reason the probes are.
   *
   * A test of this method must be able to prove that the *sequence* runs and that a non-zero exit is reported
   * without installing a package on anybody's machine: `fixes.test.ts` drives `runFixCommands` with `/bin/sh`
   * scripts, and these two fields let the same be done through a daemon if a leg ever needs the whole path.
   */
  fixSpawn?: typeof import("node:child_process").spawn;
  /**
   * The `git` binary the branch actions run, and the spawn that starts it.
   *
   * Injectable on the same terms as `fixSpawn`: the test that has to see *"git is not installed"* must be
   * able to name a program that is not there, and every other test drives the real git.
   */
  gitCommand?: string;
  gitSpawn?: typeof import("node:child_process").spawn;
  /**
   * The environment the git children start from. Injected on the same terms as the two above, and for the one
   * case that cannot be arranged otherwise: a machine with no author identity, whose refusal a fresh install
   * really meets.
   */
  gitEnv?: () => NodeJS.ProcessEnv;
  fixTimeoutMs?: number;
  /**
   * The environment a provider's named variables are read from.
   *
   * Injected for one test, and it is a test that cannot be written any other way: "a variable this daemon
   * does not have is reported per agent" needs a daemon that provably does not have one, and mutating the
   * test runner's own `process.env` to arrange that would leak into every other file in the run.
   */
  env?: NodeJS.ProcessEnv;
  isModuleAvailable?: (module: string) => boolean;
  /**
   * Runs, from M2 on.
   *
   * Optional so the M1 handler table can still be built on its own — a daemon that can list
   * projects but not run anything is a real configuration (and is what the M1 tests exercise), and
   * the run methods refuse by name when it is absent rather than answering as if nothing were wrong.
   */
  runs?: RunManager;
  /**
   * The pre-flight probe: asking an agent what it offers, before a first run.
   *
   * Optional on exactly the same terms as `runs`, and for the same reason: it spawns agents, so a
   * daemon built without an agent runtime has no probe either — and the method refuses by name rather
   * than answering with an outcome nothing produced.
   */
  probeSession?: SessionProbe;
  /**
   * The sign-in flow: triggering the agent's own `authenticate` step, on a user's request.
   *
   * Optional on the same terms again, and the fourth member of one list: a daemon with no agent runtime
   * cannot run a task, cannot ask an agent what it offers and cannot sign one in. See `sign-in.ts` for the
   * five outcomes and why only one of them is success.
   */
  signIn?: SessionSignIn;
}

/**
 * Who is calling, as much as a handler is allowed to know.
 *
 * **`session === undefined` means the owner's own window.** The transport refuses a tokenless caller
 * that is not on this machine (`ws-server.ts`, the auth gate), so a request that reaches a handler
 * without a session came from loopback — the desktop's own pane. A session present means a **paired
 * device**, which is a different thing with fewer rights.
 *
 * This exists because a module claimed a restriction the code did not enforce: `pairing.ts` said
 * "loopback-only for mint/revoke/list: a paired phone must not mint further phones", while the
 * dispatcher called `handler(params)` and never handed the session over — so a phone holding a valid
 * token could mint itself another one, indefinitely, past the revocation of the first. A guard that
 * cannot see the caller is not a guard, and the sentence above it was worse than nothing.
 */
export interface CoderCallContext {
  /** `undefined` for the owner's own window; the resolved session for a paired device. */
  session: unknown;
}

/** One handler: parameters already parsed, result not yet validated, and who asked. */
export type CoderHandler = (params: unknown, context: CoderCallContext) => Promise<unknown>;

/**
 * Build the handler table.
 *
 * A method left out of the result is one this build does not serve, and the dispatcher refuses it
 * **by name** ("coder.startRun is not implemented in this build") rather than silently answering
 * nothing. That is deliberate: a UI can then say "not yet" instead of hanging, and the missing
 * feature is visible in the protocol rather than in a bug report.
 */
export function createCoderHandlers(deps: CoderServiceDeps): Partial<Record<RpcMethod, CoderHandler>> {
  const isDirectory = deps.isDirectory ?? defaultIsDirectory;
  /**
   * The daemon's own probe: the catalogue's, over **the resolved search path** rather than the inherited one.
   *
   * `currentSearchPath()` is synchronous and never spawns a shell (see `@envoydev/platform`): the login
   * shell's answer, when it arrives, is already cached by `primeSearchPath()` at boot. Passing the list here
   * is what makes a GUI-launched daemon able to see `~/.local/bin` at all, and `launchForHarness` passes the
   * same list to the child so the two cannot disagree. `searchable` travels with it, because a list that
   * could not be assembled is `unknown` rather than `not-installed`.
   */
  /**
   * The git program and spawn, read once so the branch handlers and `coder.addProject` — which measures a
   * folder's version control to label the row — cannot disagree about which git they run.
   */
  const gitRun: GitDeps = {
    ...(deps.gitCommand !== undefined ? { command: deps.gitCommand } : {}),
    ...(deps.gitSpawn !== undefined ? { spawn: deps.gitSpawn } : {}),
    ...(deps.gitEnv !== undefined ? { env: deps.gitEnv } : {}),
  };

  const search = currentSearchPath();
  const probe =
    deps.probe ??
    ((harness: HarnessId) =>
      probeHarness(harness, {
        moduleAvailable: deps.isModuleAvailable,
        pathDirs: search.dirs,
        searchable: search.searchable,
      }));
  /**
   * The same list, the same folder of facts, for an agent the user declared.
   *
   * Note what is *not* different: `probeProvider` is the same prober `probeHarness` wraps, over the same
   * resolved search path — see `@envoydev/agent-catalog`'s `probe.ts` for why there is one body rather
   * than two, and `launch.ts` for why one *spawn* body is the other half of the same claim.
   */
  const providerHandlers = createProviderHandlers({
    store: deps.store,
    probe:
      deps.probeProvider ??
      ((provider: AgentProviderConfig) =>
        probeProvider(provider, { pathDirs: search.dirs, searchable: search.searchable })),
    env: deps.env ?? process.env,
  });

  const handlers: Partial<Record<RpcMethod, CoderHandler>> = {
    // The agents a user declared: three methods whose whole subject is `AgentProviderConfig`, kept in their
    // own module because the list handler, the refusals that are the user's to fix and the credential
    // decision are one subject — and because this file is a table.
    ...providerHandlers,
    // The catalogue: the 38 ACP agents we can drive, each with what this machine can do with it resolved on
    // the read. One method, and `catalog.ts` carries why the old two-method split (a list that knew nothing
    // plus a per-row probe the user had to press) was the defect the owner reported rather than the cost
    // saving it looked like.
    ...createCatalogHandlers({
      probe:
        deps.probeCatalogEntry ??
        ((entry: AcpAgentEntry) =>
          probeRecipe(cataloguedRecipe(entry), {
            pathDirs: search.dirs,
            searchable: search.searchable,
          })),
    }),
    // **Running the fix a row shows** — the only method in this product that executes something on the user's
    // behalf. The window sends an id; the commands come from the same probes that drew the row, at the moment of
    // the press, so a command the user read is the command that runs and a window cannot name one. `fixes.ts`
    // carries the four outcomes, the deadline and the group kill.
    ...createLogHandlers(deps.daemonLog ? { read: deps.daemonLog } : {}),
    // The graceful stop a client can ask for, which is the only one Windows has.
    ...createShutdownHandlers(deps.shutdown ? { shutdown: deps.shutdown } : {}),
    // The service switch: whether this machine runs the daemon under a supervisor, and the three changes to it.
    // The changes are owner-window-only, like minting a pairing code. The shutdown hook rides along so the
    // switch can drain this daemon before a restart, and hand over after an install (`supervisor-rpc.ts`, §11).
    ...createSupervisorHandlers({ ...deps.service, ...(deps.shutdown ? { shutdown: deps.shutdown } : {}) }),
    // The supervisor's question, answered from the instance facts `coder.hello` already uses.
    ...createHealthHandlers({
      instance: deps.instance,
      ...(deps.runs !== undefined ? { runs: deps.runs } : {}),
    }),
    ...createGitHandlers({
      store: deps.store,
      ...(deps.runs !== undefined ? { runs: deps.runs } : {}),
      ...gitRun,
    }),
    ...createFixHandlers({
      probe,
      providers: () => deps.store.providers(),
      ...(probeProvider !== undefined ? { probeProvider } : {}),
      ...(deps.probeCatalogEntry !== undefined ? { probeCatalogEntry: deps.probeCatalogEntry } : {}),
      // A fix runs in the user's home, never in a project: an install is about the machine, and running one
      // inside somebody's repository would put `node_modules` where they did not ask for it.
      cwd: () => deps.paths.home,
      pathDirs: () => currentSearchPath().dirs,
      ...(deps.fixSpawn !== undefined ? { spawn: deps.fixSpawn } : {}),
      ...(deps.fixTimeoutMs !== undefined ? { timeoutMs: deps.fixTimeoutMs } : {}),
      ...(deps.recheckAgents !== undefined ? { recheck: deps.recheckAgents } : {}),
    }),
    // Looking at this machine again: one method, and its whole subject is the measurement — the user's half of
    // "I installed it while the window was open". `recheck.ts` carries why it is a press rather than a timer.
    ...createRecheckHandlers({
      recheck: deps.recheckAgents ?? (async () => undefined),
    }),
    // The sign-in: one method whose whole subject is an agent's own authentication flow. Spread in the same
    // way the provider methods are, so this table stays the complete list of what the daemon serves.
    ...createSignInHandlers({
      store: deps.store,
      ...(deps.signIn ? { signIn: deps.signIn } : {}),
    }),

    /* ────────────────── who am I talking to ────────────────── */
    "coder.hello": async (params, context) => {
      const input = parseRpcParams("coder.hello", params) as
        | { client?: { id?: string; name?: string; platform?: string } }
        | undefined;

      /**
       * **Record who is calling, once, the first time a paired device says hello.**
       *
       * A phone that pairs repeatedly used to leave one row per pairing — each a live token for a year, all
       * labelled "Phone" — so the list grew and a revoke only disconnected the phone that had stopped using the
       * revoked token. The identity is what makes "the same phone again" a fact the store can act on.
       *
       * Deliberately **not awaited**: hello is a greeting, and a bookkeeping write must never be able to fail it.
       * The window's own hello (`session === undefined`) has no device to record.
       */
      const deviceId = (context.session as { deviceId?: string } | undefined)?.deviceId;
      if (deviceId !== undefined && input?.client !== undefined) {
        void deps.paired?.identify(deviceId, input.client).catch(() => undefined);
      }

      const notes = deps.store.notes();
      return {
        product: ENVOYDEV_PRODUCT_NAME,
        version: deps.instance.version,
        instanceId: deps.instance.instanceId,
        home: deps.paths.home,
        stateDir: deps.paths.stateDir,
        startedAt: deps.instance.startedAt,
        windowCount: Math.max(1, deps.instance.connectionCount()),
        methods: [...RPC_METHODS],
        mesh: deps.mesh(),
        notes: describeStoreNotes(notes),
      };
    },

    /* ────────────────── projects ────────────────── */
    "coder.listProjects": async (params) => {
      parseRpcParams("coder.listProjects", params);
      return { projects: deps.store.projects() };
    },

    "coder.addProject": async (params) => {
      const input = parseRpcParams("coder.addProject", params) as {
        path: string;
        label?: string;
        hostId?: string;
        defaults?: { harness?: HarnessId; model?: string; extraArgs?: string };
      };
      // **Normalise before checking.** A person types `~/work/api`, wraps a path with a space in quotes,
      // or pastes one with the trailing slash Finder gives; all three are the same directory, and all
      // three used to be reported as "not a directory on this machine". The check below stays strict —
      // it is the input that becomes what the filesystem means.
      const path = normalizeUserPath(input.path, deps.paths.home);
      // Checked here rather than in the store: the store owns data, not the filesystem, and a
      // project row pointing at a directory that does not exist is a row whose every task fails.
      if (!(await isDirectory(path))) {
        throw coderError(
          ENVOYDEV_ERRORS.pathMissing,
          `${path} is not a directory on this machine. Pick a folder that exists — EnvoyDev runs agents in it, so the path has to be real.`,
          ref("error.addProject.notDirectory", { path }),
        );
      }
      // **Best effort, and never a reason to refuse.** A project is a directory; whether git tracks it only
      // decides which label the row wears. A machine without git, or a folder git cannot answer about,
      // leaves `vcs` unset — and `coder.gitStatus` is where a user is told the real reason.
      const vcs = await measureProjectVcs(gitRun, path).catch(() => undefined);
      const { project } = await deps.store.addProject({
        ...input,
        path,
        ...(vcs !== undefined ? { vcs: { kind: vcs } } : {}),
      });
      return { project };
    },

    "coder.updateProject": async (params) => {
      const input = parseRpcParams("coder.updateProject", params) as {
        id: string;
        label?: string;
        defaults?: { harness?: string; model?: string; extraArgs?: string };
        tags?: readonly string[];
      };
      await ensureRunnableAgent(deps.store, input.defaults?.harness);
      const project = await deps.store.updateProject(input.id, {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.defaults !== undefined ? { defaults: input.defaults } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      });
      if (!project) throw notFound("project", input.id);
      return { project };
    },

    "coder.removeProject": async (params) => {
      const { id } = parseRpcParams("coder.removeProject", params) as { id: string };
      const result = await deps.store.removeProject(id);
      if (!result) throw notFound("project", id);
      return { removed: result.removed, archived: result.archived };
    },

    /* ────────────────── home filesystem (remote folder picker) ────────────────── */
    "coder.getHomeFsInfo": async (params) => {
      parseRpcParams("coder.getHomeFsInfo", params);
      return getHomeFsInfo();
    },

    "coder.listHomeFsEntries": async (params) => {
      const input = parseRpcParams("coder.listHomeFsEntries", params) as
        | { path?: string; dirsOnly?: boolean }
        | undefined;
      try {
        return listHomeFsEntries(input ?? {});
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          detail,
        );
      }
    },

    "coder.readHomeFsFile": async (params) => {
      const { path } = parseRpcParams("coder.readHomeFsFile", params) as { path: string };
      try {
        return readHomeFsFile(path);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw coderError(ENVOYDEV_ERRORS.badRequest, detail);
      }
    },

    "coder.createHomeFsEntry": async (params) => {
      const input = parseRpcParams("coder.createHomeFsEntry", params) as {
        directory: string;
        name: string;
        kind: "file" | "dir";
      };
      try {
        return createHomeFsEntry(input.directory, input.name, input.kind);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw coderError(ENVOYDEV_ERRORS.badRequest, detail);
      }
    },

    "coder.listWorktreeChanges": async (params) => {
      const input = parseRpcParams("coder.listWorktreeChanges", params) as { path: string };
      try {
        return listWorktreeChanges(input.path);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw coderError(ENVOYDEV_ERRORS.badRequest, detail);
      }
    },

    "coder.readWorktreeDiff": async (params) => {
      const input = parseRpcParams("coder.readWorktreeDiff", params) as {
        directory: string;
        path: string;
        from?: string;
      };
      try {
        return readWorktreeDiff(input.directory, input.path, input.from);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw coderError(ENVOYDEV_ERRORS.badRequest, detail);
      }
    },

    /* ────────────────── tasks ────────────────── */
    "coder.listTasks": async (params) => {
      const input = parseRpcParams("coder.listTasks", params) as
        | { projectId?: string; includeArchived?: boolean }
        | undefined;
      return { tasks: deps.store.tasks(input ?? {}) };
    },

    "coder.createTask": async (params) => {
      const input = parseRpcParams("coder.createTask", params) as {
        projectId: string;
        title: string;
        cwd?: string;
        harness?: AgentId;
        model?: string;
        extraArgs?: string;
      };
      const project = deps.store.findProject(input.projectId);
      if (!project) throw notFound("project", input.projectId);
      // Gate the *resolved* agent — project/app default when the caller omitted harness — so a stale
      // default cannot be stored and only refuse at launch.
      const resolved = resolveTaskDefaults({
        project,
        appDefaults: deps.store.settings().defaults,
        explicit: {
          ...(input.harness ? { harness: input.harness } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.extraArgs ? { extraArgs: input.extraArgs } : {}),
        },
      });
      await ensureRunnableAgent(deps.store, resolved.harness);
      const cwd = input.cwd ?? project.path;
      if (!(await isDirectory(cwd))) {
        throw coderError(
          ENVOYDEV_ERRORS.pathMissing,
          `${cwd} is not a directory on this machine, so there is nowhere to run the agent. It was the working directory for "${input.title}".`,
          ref("error.createTask.notDirectory", { path: cwd, title: input.title }),
        );
      }
      const task = await deps.store.createTask({ ...input, cwd });
      if (!task) throw notFound("project", input.projectId);
      return { task };
    },

    "coder.updateTask": async (params) => {
      const input = parseRpcParams("coder.updateTask", params) as {
        id: string;
        title?: string;
        pinned?: boolean;
        harness?: HarnessId;
        model?: string;
        cwd?: string;
        agentModeId?: string;
        thinkingLevel?: string;
        fastMode?: boolean;
        planMode?: boolean;
        extraArgs?: string;
      };

      /**
       * A new working directory, checked here rather than in the store — the same division
       * `coder.addProject` uses, and for the same reason: a task row pointing at a folder that does
       * not exist is a row whose next run cannot start, and the moment to say so is while the user is
       * looking at the control they just used.
       */
      let cwd: string | undefined;
      if (input.cwd !== undefined) {
        cwd = normalizeUserPath(input.cwd, deps.paths.home);
        if (!(await isDirectory(cwd))) {
          throw coderError(
            ENVOYDEV_ERRORS.pathMissing,
            `${cwd} is not a directory on this machine, so the agent would have nowhere to run. The task's folder is unchanged.`,
            ref("error.updateTask.notDirectory", { path: cwd }),
          );
        }
      }

      /**
       * `""` is how a client says **"the agent's own default"**, and it is not a model called nothing.
       *
       * The control's empty value has to mean something on this wire: a task with no model runs on
       * whatever the agent defaults to, and clearing a choice is a real thing a user does — the only
       * way to undo a model without replacing it with another. `""` is also the one string that can
       * never be a model id, so it is unambiguous. It becomes `clearModel`, which drops the key, rather
       * than a stored empty string that would show up as a model chip on the task header.
       */
      let model = input.model;
      let clearModel = input.model === "";
      if (model === "") model = undefined;

      /**
       * **A stored mode / model / thinking the new harness cannot honour is dropped here.**
       *
       * Same helper every `updateTask({ harness })` uses (`harnessSwitchPatch`), so a switch from
       * the pane and one from the phone stay on identical rules.
       */
      let agentModeId = input.agentModeId;
      let clearAgentMode = false;
      let thinkingLevel = input.thinkingLevel;
      let clearThinkingLevel = input.thinkingLevel === "";
      if (thinkingLevel === "") thinkingLevel = undefined;

      if (input.harness !== undefined) {
        await ensureRunnableAgent(deps.store, input.harness);
        const current = deps.store.findTask(input.id);
        const project = current !== undefined ? deps.store.findProject(current.projectId) : undefined;
        const switched = harnessSwitchPatch(
          {
            agentModeId: agentModeId ?? current?.agentModeId,
            model: model ?? current?.model,
            thinkingLevel: thinkingLevel ?? current?.thinkingLevel,
          },
          input.harness,
          project?.defaults?.model,
        );
        if (switched.clearAgentMode) {
          agentModeId = undefined;
          clearAgentMode = true;
        }
        // Only auto-clear / auto-pick when the caller did not send a replacement. Prefer the project's
        // default when the stored id cannot follow (`harnessSwitchPatch`); otherwise drop the stranded
        // value so the header cannot keep yesterday's model after the agent (and the list under the
        // field) changed.
        if (input.model === undefined) {
          if (switched.model !== undefined) {
            model = switched.model;
            clearModel = false;
          } else if (switched.clearModel) {
            clearModel = true;
            model = undefined;
          }
        }
        if (switched.clearThinkingLevel) {
          thinkingLevel = undefined;
          clearThinkingLevel = true;
        }
      }

      const task = await deps.store.updateTask({
        ...input,
        ...(cwd !== undefined ? { cwd } : {}),
        // Spread *after* `...input` on purpose: an empty `model` on the wire means "clear", so the
        // empty string must not survive into the patch and become a stored model called nothing.
        model,
        ...(agentModeId !== undefined ? { agentModeId } : {}),
        ...(clearAgentMode ? { clearAgentMode: true } : {}),
        ...(clearModel ? { clearModel: true } : {}),
        // The same treatment for the thinking level: `""` is the control's "the agent's own default",
        // and a stored empty string would be a level called nothing.
        thinkingLevel,
        ...(clearThinkingLevel ? { clearThinkingLevel: true } : {}),
      });
      if (!task) throw notFound("task", input.id);
      return { task };
    },

    "coder.archiveTask": async (params) => {
      const input = parseRpcParams("coder.archiveTask", params) as { id: string; archived?: boolean };
      const task = await deps.store.archiveTask(input.id, input.archived ?? true);
      if (!task) throw notFound("task", input.id);
      return { task };
    },

    /* ────────────────── runs ────────────────── */
    "coder.startRun": async (params) => {
      const input = parseRpcParams("coder.startRun", params) as {
        taskId: string;
        prompt: string;
        mode?: "queue" | "steer";
        resume?: boolean;
        agentModeId?: string;
        model?: string;
        thinkingLevel?: string;
        images?: PromptImage[];
      };
      const runs = requireRuns(deps);
      const run = await runs.start({
        taskId: input.taskId,
        prompt: input.prompt,
        ...(input.resume !== undefined ? { resume: input.resume } : {}),
        // Passed straight through: `RunManager` is where the catalogue lives, and it refuses a mode
        // this agent cannot accept. Checking here too would be a second copy of the same rule, and the
        // copy that goes stale is always the one further from the data.
        ...(input.agentModeId !== undefined ? { agentModeId: input.agentModeId } : {}),
        // Same division for the model: `RunManager` resolves it against the catalogue and refuses what
        // the agent cannot take, before any process exists.
        ...(input.model !== undefined ? { model: input.model } : {}),
        // And for the thinking level, where the refusal is about the *agent* rather than the value: an
        // agent with no thought-level method cannot be told to think less, and pretending otherwise
        // would start it at a depth nobody chose.
        ...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
        ...(input.images !== undefined && input.images.length > 0 ? { images: input.images } : {}),
      });
      return { run };
    },

    "coder.sendToRun": async (params) => {
      const input = parseRpcParams("coder.sendToRun", params) as {
        runId: string;
        text: string;
        mode: "queue" | "steer";
        images?: PromptImage[];
      };
      const runs = requireRuns(deps);
      const delivered = await runs.send(input.runId, input.text, input.mode, input.images);
      return { runId: input.runId, delivered };
    },

    "coder.cancelRun": async (params) => {
      const { runId } = parseRpcParams("coder.cancelRun", params) as { runId: string };
      const runs = requireRuns(deps);
      return { runId, cancelled: await runs.cancel(runId) };
    },

    "coder.answerApproval": async (params) => {
      const input = parseRpcParams("coder.answerApproval", params) as {
        runId: string;
        requestId: string;
        optionId?: string;
        optionIds?: string[];
        text?: string;
      };
      const runs = requireRuns(deps);
      const resolved = await runs.answerApproval(input.runId, input.requestId, input.optionId, {
        ...(input.optionIds !== undefined ? { optionIds: input.optionIds } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
      });
      return { runId: input.runId, requestId: input.requestId, resolved };
    },

    /**
     * A run and the events a client needs to render it.
     *
     * This is the same shape `coder.tailRun` returns, and deliberately so: the difference between
     * them is *intent*, not data. `getRun` is "show me this run"; `tailRun` is "show me this run and
     * keep me subscribed", which the client says by subscribing to `coder:run-event` — the
     * subscription is per connection and the events are pushed there, so a second window on the same
     * run does not need a second call.
     */
    "coder.getRun": async (params) => {
      const input = parseRpcParams("coder.getRun", params) as { runId: string; sinceSeq?: number };
      const runs = requireRuns(deps);
      return snapshot(runs, input.runId, input.sinceSeq ?? 0);
    },

    "coder.tailRun": async (params) => {
      const input = parseRpcParams("coder.tailRun", params) as { runId: string; sinceSeq?: number };
      const runs = requireRuns(deps);
      return snapshot(runs, input.runId, input.sinceSeq ?? 0);
    },

    "coder.listRuns": async (params) => {
      const input = parseRpcParams("coder.listRuns", params) as
        | { taskId?: string; limit?: number }
        | undefined;
      const runs = requireRuns(deps);
      const filter = input ?? {};
      if (filter.taskId !== undefined) {
        return { runs: await runs.history(filter.taskId, filter.limit) };
      }
      return { runs: runs.list(filter) };
    },

    /* ────────────────── agents ────────────────── */
    "coder.listHarnesses": async (params) => {
      parseRpcParams("coder.listHarnesses", params);
      return {
        harnesses: ALL_HARNESSES.map((id) => {
          /**
           * **The probe follows the delivery**, and that is the whole point of the field.
           *
           * With `npx` the program we would start is `npx`, so `npx` is what must be found, and a machine with
           * no npm cannot take the route — which the row then reports honestly instead of offering a download
           * nothing can perform. The bridge's package name is not read here: it comes from the catalogue at
           * launch time, so a catalogue edit is not a migration of anybody's stored choice.
           */
          const delivery = deps.deliveries?.of(id) ?? "installed";
          const recipe = delivery === "npx" ? fetchedRecipe(id) : undefined;
          const installed = probe(id);
          const finding: HarnessProbe =
            recipe === undefined
              ? installed
              : {
                  ...probeRecipe(recipe, { pathDirs: search.dirs, searchable: search.searchable }),
                  id,
                };
          /**
           * **The other route's commands, kept on the row.**
           *
           * With a fetched delivery the row is `Ready` and `availability.fix` is empty *because there is nothing
           * to fix* — which took the install command off the screen entirely, leaving a user who would rather
           * install it with nothing to read, copy or press. The owner asked for the text to stay and the button
           * to stay with it, so the installed route's own commands travel in `installFix` and the window renders
           * them beside the delivery control.
           */
          const installFix = recipe === undefined ? undefined : harnessAvailability(installed).fix;
          const row = summarize(
            id,
            () => finding,
            deps.store.sessionOptions(id),
            // The auth record — the last fact on this row. **Every field of a summary is something a probe
            // established**; nothing here is read from the settings document, which is what makes a picker
            // built over these rows impossible to shorten with a stored preference. The decision about which
            // of them a picker offers lives in one pure function over them
            // (`apps/desktop/src/composer/agent-for.ts`), not here.
            deps.store.agentAuth(id),
            delivery === "npx" && recipe !== undefined
              ? { kind: "npx", package: fetchablePackage(id) ?? "" }
              : { kind: "installed" },
            // Present exactly when the delivery is `npx` and there is something to install on this machine —
            // `HarnessSummarySchema` refuses any other combination. (An argument, not a spread: a spread is an
            // object-literal form, and this is a call.)
            installFix !== undefined && installFix.length > 0 ? installFix : undefined,
            // The offer, from the catalogue: what this connector *could* be fetched from. Absent for an agent
            // whose adapter is in this repository, which is what stops the window drawing a press that cannot work.
            fetchablePackage(id) !== undefined && fetchableCovers(id) !== undefined
              ? { package: fetchablePackage(id) ?? "", covers: fetchableCovers(id) ?? "connector" }
              : undefined,
          );
          // Envoy Harness has no model of its own. The catalogue's provider defaults are not a list
          // the user can call. The picker is the model saved in Settings, or nothing until one is.
          return id === "envoy-harness" ? { ...row, models: envoyHarnessModels(deps.paths) } : row;
        }),
      };
    },

    /**
     * **Choose how an agent's connector is delivered** — installed, or fetched by `npx`.
     *
     * The one method here whose refusal is a *product rule* rather than a validation: an agent whose connector
     * is not on npm cannot be fetched, and storing that choice would leave a row saying `Runs through npx` about
     * an agent whose first run would fail. So the refusal is by name, and nothing is written.
     */
    "coder.setAgentDelivery": async (params) => {
      const { harness, delivery } = parseRpcParams("coder.setAgentDelivery", params) as {
        harness: HarnessId;
        delivery: "installed" | "npx";
      };
      if (delivery === "npx") {
        const pkg = fetchablePackage(harness);
        if (pkg === undefined) {
          throw coderError(
            ENVOYDEV_ERRORS.connectorNotFetchable,
            `${harnessDefinition(harness).label} has no connector published on npm, so it cannot be fetched.`,
            ref("error.connectorNotFetchable", { harness: harnessDefinition(harness).label }),
          );
        }
      }
      await deps.deliveries?.set(harness, delivery);
      // Every window re-reads on this, and the *runs* read the same store, so a row and the next launch cannot
      // disagree about which route is in force.
      deps.onHarnessesChanged?.();
      return {
        harness,
        delivery:
          delivery === "npx"
            ? ({ kind: "npx", package: fetchablePackage(harness) ?? "" } as const)
            : ({ kind: "installed" } as const),
      };
    },

    "coder.probeHarness": async (params) => {
      const { harness } = parseRpcParams("coder.probeHarness", params) as { harness: HarnessId };
      const result = probe(harness);
      const label = harnessDefinition(harness).label;
      return {
        harness,
        // The five states, from the one function that computes them, so this method and
        // `coder.listHarnesses` cannot answer the same question differently. It used to flatten to a
        // boolean here — which could not express `unknown` on the very method whose job is this question.
        availability: harnessAvailability(result),
        detail:
          result.state === "ready"
            ? `Ready to run${result.binaryPath ? ` (${result.binaryPath})` : ""}.`
            : (result.reason ?? `${label} is not available on this machine.`),
      };
    },

    /**
     * Ask an agent what it offers — the pre-flight probe.
     *
     * A thin handler on purpose. Everything that makes this safe is in `SessionProbe`: the three
     * outcomes, the per-agent join, the timeout, the build-keyed cache, and the store write. A handler
     * that decided any of that again would be the second copy of the rule, and the copy that goes stale
     * is always the one further from the data.
     *
     * It is a method of its own rather than a flag on `coder.listHarnesses`, and that matters: a list
     * call that silently spawned agents would make rendering a sidebar start every installed one.
     */
    "coder.probeSessionOptions": async (params) => {
      const input = parseRpcParams("coder.probeSessionOptions", params) as {
        harness: string;
        force?: boolean;
      };
      if (!isHarnessId(input.harness)) {
        await ensureRunnableAgent(deps.store, input.harness);
        return {
          harness: input.harness,
          outcome: "unreachable" as const,
          detail:
            "What this agent offers is learned from a task run, not from a pre-flight check.",
        };
      }
      const probeSession = requireProbeSession(deps);
      const answer = await probeSession.probe(input.harness, {
        ...(input.force !== undefined ? { force: input.force } : {}),
      });
      return {
        harness: answer.harness,
        outcome: answer.outcome,
        detail: answer.detail,
      };
    },

    /* ────────────────── the mesh ────────────────── */
    "coder.meshStatus": async (params) => {
      parseRpcParams("coder.meshStatus", params);
      return { mesh: deps.mesh() };
    },

    "coder.listPeers": async (params) => {
      parseRpcParams("coder.listPeers", params);
      // No peer directory yet: reachability comes from the mesh, and discovering peers is M5's work
      // (`docs/roadmap.md`). An empty list is the honest answer — inventing rows here is how a UI
      // ends up offering "run on the workstation" for a machine nobody can reach.
      return { peers: [] };
    },

    /* ────────────────── settings ────────────────── */
    "coder.getSettings": async (params) => {
      parseRpcParams("coder.getSettings", params);
      return { settings: deps.store.settings() };
    },

    "coder.updateSettings": async (params) => {
      const input = parseRpcParams("coder.updateSettings", params) as {
        settings: {
          /**
           * `""` is **clear it**, not a path: the store drops the key rather than storing an empty
           * string, because `{defaultProjectPath: undefined}` disappears in `JSON.stringify` and a
           * control that can choose a folder has to be able to un-choose one (`store.ts:481-506`).
           */
          defaultProjectPath?: string;
          /**
           * Merged rather than replaced, and `""` again means clear for `model`/`extraArgs` — the two
           * fields whose control is a picker with an "agent's own default" slot.
           */
          defaults?: { harness?: string; model?: string; extraArgs?: string };
          requireApprovalForDestructive?: boolean;
          keepTranscripts?: boolean;
          /**
           * The language the window speaks.
           *
           * Stored daemon-side rather than in the window's `localStorage`, and that is the point:
           * the daemon is what sends the refusals, so the *user* has to have one language across
           * every surface that renders them (a second window, the phone, a future tray). A value
           * the webview kept for itself could not do that, and would be lost with the cache.
           */
          language?: CoderLanguage;
        };
      };
      await ensureRunnableAgent(deps.store, input.settings.defaults?.harness);
      const settings = await deps.store.updateSettings(input.settings);
      return { settings };
    },

    "coder.getEnvoyLlm": async (params) => {
      parseRpcParams("coder.getEnvoyLlm", params);
      return getEnvoyLlmPublic(deps.paths);
    },

    "coder.setEnvoyLlm": async (params) => {
      const input = parseRpcParams("coder.setEnvoyLlm", params) as {
        provider: string;
        model: string;
        baseUrl?: string;
        apiKey?: string;
        clearApiKey?: boolean;
      };
      return setEnvoyLlm(deps.paths, deps.store, input);
    },

    // **There is deliberately no `coder.setAgentHidden` here, and its absence is a design decision rather
    // than an unimplemented method.** It existed: a stored list of agent ids (`CoderSettings.hiddenAgents`)
    // that the projection turned into a `hidden` flag on every row, which the desktop pickers filtered on.
    // It was removed for two reasons, and the second is the one that would have caught it earlier.
    //
    // The first is what a list filter *is*: the one control that can make an agent this product ships
    // disappear from the product's own lists, which is the exact failure the owner objected to when they
    // said they could not see the agents we support. The brief is "the control plane of coding agents", and
    // a control plane whose list of agents can be shortened by a preference is one that can be made to
    // forget what it controls.
    //
    // The second is that it was added on a misreading. Paseo's "Enable {provider}" row decides whether that
    // daemon *instantiates* a provider at all — a fact about a daemon's wiring — and we turned it into a
    // list filter. What a picker offers is now **derived from probed facts** instead, in one pure function
    // (`apps/desktop/src/composer/agent-for.ts`), which can be wrong about a fact and be corrected by the
    // next probe. A stored filter is wrong by design and stays wrong. `docs/settings-parity.md` §5.8 carries
    // the correction and the reasoning; `RETIRED_SETTINGS_KEYS` carries the old key so an upgrading user's
    // settings file is not quarantined over it.
    //
    // Nothing replaced it on the wire: what a user can *do* here is declare an agent
    // (`coder.addProvider`) or forget one they declared (`coder.removeProvider`), which is an undo of their
    // own action rather than a statement about an agent we ship.
  };

  return handlers;
}

/* ────────────────────────────── helpers ───────────────────────────── */

/** The run manager, or a refusal that says which build this is. */
function requireRuns(deps: CoderServiceDeps): RunManager {
  if (!deps.runs) {
    throw coderError(
      ENVOYDEV_ERRORS.harnessFailed,
      "This daemon was started without an agent runtime, so it cannot run tasks.",
      ref("error.noRunRuntime"),
    );
  }
  return deps.runs;
}

/**
 * The probe, or a refusal naming the same fact `requireRuns` names.
 *
 * The sentence and the key are the *same* one: a daemon without an agent runtime cannot run tasks and
 * cannot ask an agent what it offers, for one reason — there is nothing here that starts agents. A
 * second key saying the same thing in different words would be a second sentence for a translator to
 * keep in step with the first.
 */
function requireProbeSession(deps: CoderServiceDeps): SessionProbe {
  if (!deps.probeSession) {
    throw coderError(
      ENVOYDEV_ERRORS.harnessFailed,
      "This daemon was started without an agent runtime, so it cannot run tasks.",
      ref("error.noRunRuntime"),
    );
  }
  return deps.probeSession;
}

/**
 * A run plus everything a client needs to render it from scratch.
 *
 * `nextSeq` is the field that makes reconnection cheap: a client that dropped a frame asks for
 * `sinceSeq: nextSeq` instead of re-fetching the transcript, and a gap in `seq` is how it knows it
 * must.
 */
async function snapshot(runs: RunManager, runId: string, sinceSeq: number): Promise<{
  run: AgentRun;
  events: readonly RunEvent[];
  nextSeq: number;
  live: boolean;
}> {
  await runs.recall(runId);
  const run = runs.get(runId);
  if (!run) {
    throw coderError(
      ENVOYDEV_ERRORS.runMissing,
      `There is no run called "${runId}". It may have been started by a daemon that has since restarted.`,
      ref("error.runNotFound", { runId }),
    );
  }
  const events = runs.events(runId, sinceSeq);
  const last = events[events.length - 1];
  return {
    run,
    events,
    nextSeq: last?.seq ?? sinceSeq,
    live: runs.isLive(runId),
  };
}


async function defaultIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Turn the store's findings into sentences a user can act on.
 *
 * The wording rule is the family's: headline first, detail second, developer fields last. A user
 * does not know what a schema is, so the *reason* is attached, not led with — but it is attached,
 * because the alternative is a support conversation that starts with "it just came up empty".
 */
export function describeStoreNotes(notes: {
  quarantined: readonly { file: string; movedTo: string; reason: string }[];
  skipped: readonly { file: string; reason: string }[];
  droppedKeys: readonly {
    file: string;
    keys: readonly { path: string; retired: boolean }[];
  }[];
}): string[] {
  const lines: string[] = [];
  for (const entry of notes.quarantined) {
    const name = entry.file.split(/[\\/]/).pop() ?? entry.file;
    lines.push(
      entry.movedTo
        ? keyed(
            "note.quarantined.moved",
            `EnvoyDev could not read ${name}, so it moved it aside to ${entry.movedTo} and started that list empty. (${entry.reason})`,
            { name, movedTo: entry.movedTo, reason: entry.reason },
          )
        : keyed(
            "note.quarantined.left",
            `EnvoyDev could not read ${name} and could not move it aside, so it left it untouched and started that list empty. (${entry.reason})`,
            { name, reason: entry.reason },
          ),
    );
  }
  for (const entry of notes.droppedKeys) {
    /**
     * **One sentence per key, and the difference between the two is a deletion rather than a typo.**
     *
     * A key this build used to have is worth a word of its own: "we removed this" is a fact about
     * EnvoyDev, and it tells a user the value is not coming back and there is nothing to re-add. A key
     * no build of ours ever shipped — a typo, a hand-edit, another program's file — is not ours to
     * explain, and the sentence says only what happened.
     *
     * Per key rather than one sentence listing them, so that a translation never has to decide between
     * "it" and "them": a language that inflects for number gets one key per sentence and no agreement
     * problem to solve.
     *
     * Both sentences end the same way, and that half is the whole change: **everything else was kept.**
     * The user needs to know that, because the failure this replaced was the opposite one.
     */
    for (const dropped of entry.keys) {
      lines.push(
        keyed(
          dropped.retired ? "note.settings.retired" : "note.settings.unknown",
          dropped.retired
            ? `${entry.file} had ${dropped.path}, which this build no longer has. EnvoyDev dropped it and kept every other setting.`
            : `${entry.file} had ${dropped.path}, which this build does not recognise. EnvoyDev dropped it and kept every other setting.`,
          { file: entry.file, key: dropped.path },
        ),
      );
    }
  }
  for (const entry of notes.skipped) {
    // The file and the reason are named as they are on disk — this line is a diagnostic, and the
    // reason is a schema-validator message no catalogue can translate.
    lines.push(keyed("note.skipped", `${entry.file}: ${entry.reason}`, {
      file: entry.file,
      reason: entry.reason,
    }));
  }
  return lines;
}
