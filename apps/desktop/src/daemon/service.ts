/**
 * The daemon's method handlers: what the daemon *does* when a client asks.
 *
 * ## Why this is separate from the dispatcher
 *
 * `createCoderDispatcher` (`@envoycoder/host-bridge`) decides **what may be called** — an unknown
 * method is refused, a known-but-unimplemented one is refused by name, and the dispatcher never
 * mints credentials. This module decides **what happens**, and nothing else: no sockets, no
 * transport, no identity. That split is what lets every behaviour here be tested by calling a
 * function with an object, which is the only way the interesting cases — a corrupt state file, a
 * project whose directory vanished, a second window adding the same path — get covered at all.
 *
 * ## Failures carry codes
 *
 * Every refusal here is a `coderError(...)`, whose message begins with an `envoycoder.*` token, so
 * a client can branch on it after the family's transport has flattened `error.code` to `"ERROR"`.
 * `rpc.ts` explains why that is necessary rather than lazy. The rule for choosing one: **the code
 * says what happened, the message says what to do about it** — a code that needs prose to be
 * actionable is a code that was chosen wrong.
 */

import { currentSearchPath, normalizeUserPath } from "@envoycoder/platform";
import { stat } from "node:fs/promises";

import {
  type AgentProviderConfig,
  type AgentRun,
  type CoderLanguage,
  type HarnessId,
  type HarnessSummary,
  type ObservedSessionOptions,
  type RpcMethod,
  type RunEvent,
  type CoderMeshStatus,
  ENVOYCODER_ERRORS,
  ENVOYCODER_PRODUCT_NAME,
  RPC_METHODS,
  coderError,
  isHarnessId,
  parseRpcParams,
} from "@envoycoder/protocol";
import {
  ALL_HARNESSES,
  harnessAvailability,
  harnessDefinition,
  canApplyThinking,
  cataloguedRecipe,
  probeHarness,
  probeProvider,
  probeRecipe,
  resolveModelChoice,
  type AcpAgentEntry,
  type HarnessProbe,
  type ProbeFinding,
  type ProviderProbe,
} from "@envoycoder/agent-catalog";

import type { CoderPaths } from "@envoycoder/host-bridge";

import { keyed, ref } from "./messages.js";
import { createCatalogHandlers } from "./catalog.js";
import { createProviderHandlers } from "./providers.js";
import { createSignInHandlers } from "./sign-in.js";
import type { SessionSignIn } from "./sign-in.js";
import { summarize } from "./summaries.js";
import type { RunManager } from "./runs.js";
import type { SessionProbe } from "./session-probe.js";
import type { CoderStore } from "./store.js";

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

/** One handler: parameters already parsed, result not yet validated. */
export type CoderHandler = (params: unknown) => Promise<unknown>;

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
   * `currentSearchPath()` is synchronous and never spawns a shell (see `@envoycoder/platform`): the login
   * shell's answer, when it arrives, is already cached by `primeSearchPath()` at boot. Passing the list here
   * is what makes a GUI-launched daemon able to see `~/.local/bin` at all, and `launchForHarness` passes the
   * same list to the child so the two cannot disagree. `searchable` travels with it, because a list that
   * could not be assembled is `unknown` rather than `not-installed`.
   */
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
   * resolved search path — see `@envoycoder/agent-catalog`'s `probe.ts` for why there is one body rather
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
    // The sign-in: one method whose whole subject is an agent's own authentication flow. Spread in the same
    // way the provider methods are, so this table stays the complete list of what the daemon serves.
    ...createSignInHandlers({ ...(deps.signIn ? { signIn: deps.signIn } : {}) }),

    /* ────────────────── who am I talking to ────────────────── */
    "coder.hello": async (params) => {
      parseRpcParams("coder.hello", params);
      const notes = deps.store.notes();
      return {
        product: ENVOYCODER_PRODUCT_NAME,
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
          ENVOYCODER_ERRORS.pathMissing,
          `${path} is not a directory on this machine. Pick a folder that exists — EnvoyCoder runs agents in it, so the path has to be real.`,
          ref("error.addProject.notDirectory", { path }),
        );
      }
      const { project } = await deps.store.addProject({ ...input, path });
      return { project };
    },

    "coder.updateProject": async (params) => {
      const input = parseRpcParams("coder.updateProject", params) as {
        id: string;
        label?: string;
        defaults?: { harness?: HarnessId; model?: string; extraArgs?: string };
        tags?: readonly string[];
      };
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
        harness?: HarnessId;
        model?: string;
        extraArgs?: string;
      };
      const project = deps.store.findProject(input.projectId);
      if (!project) throw notFound("project", input.projectId);
      const cwd = input.cwd ?? project.path;
      if (!(await isDirectory(cwd))) {
        throw coderError(
          ENVOYCODER_ERRORS.pathMissing,
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
            ENVOYCODER_ERRORS.pathMissing,
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
       * **A stored mode the new harness cannot honour is dropped here, not left to fail later.**
       *
       * Modes are per agent — `envoy-harness` takes `default | plan | review`, `deepseek-harness`
       * takes none — so switching the agent can strand a mode the task remembers. Keeping it would
       * make every later run of this task refuse, with a sentence about a mode the user chose for a
       * *different* agent and has since replaced. Clearing it means the next run starts the way the
       * agent's own default does, which is what "no mode chosen" already means.
       */
      let agentModeId = input.agentModeId;
      let clearAgentMode = false;
      if (input.harness !== undefined) {
        const next = harnessDefinition(input.harness);
        const kept = agentModeId ?? deps.store.findTask(input.id)?.agentModeId;
        if (kept !== undefined && !next.modes.some((mode) => mode.id === kept)) {
          agentModeId = undefined;
          clearAgentMode = true;
        }
      }

      /**
       * **A stored model the new agent cannot resolve is dropped here too**, for the same reason and
       * with the same cost: switching the agent can strand a value the task remembers. The two cases
       * are genuinely different values, though — `deepseek-harness` takes free text, so a task can
       * carry a bare `sonnet` that `envoy-harness` has no provider for, and every later run of that
       * task would then refuse with a sentence about a model the user chose for a *different* agent.
       * Clearing it means the next run starts on the agent's own default, which is what "no model
       * chosen" already means.
       *
       * Only checked when the harness was given and no model came with it: a model the *current* agent
       * cannot resolve is left alone, because there it is the run's job to refuse loudly rather than
       * for a stray edit of the title to quietly erase a choice.
       */
      if (input.harness !== undefined && model === undefined) {
        const kept = deps.store.findTask(input.id)?.model;
        if (kept !== undefined && kept !== "" && !resolveModelChoice(input.harness, kept).ok) {
          clearModel = true;
        }
      }

      /**
       * **A stored thinking level the new agent cannot take is dropped**, on exactly the terms of the
       * mode above and for a sharper reason: a level is an id in one agent's vocabulary (`off | low |
       * high | max` for `deepseek-harness`) and means nothing to an agent with no thought-level method
       * at all. Left in place, every later run of the task would refuse with a sentence about a choice
       * the user made for the agent they replaced; clearing it leaves the next run at the depth the new
       * agent decides for itself, which is what "no level chosen" already means.
       *
       * The check is the delivery, not a list of values: whether the agent accepts *this* id is the
       * agent's answer, and the observed list we could compare against describes a model that agent may
       * no longer be running.
       */
      let thinkingLevel = input.thinkingLevel;
      let clearThinkingLevel = input.thinkingLevel === "";
      if (thinkingLevel === "") thinkingLevel = undefined;
      if (input.harness !== undefined) {
        const kept = thinkingLevel ?? deps.store.findTask(input.id)?.thinkingLevel;
        if (kept !== undefined && !canApplyThinking(input.harness)) {
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
      });
      return { run };
    },

    "coder.sendToRun": async (params) => {
      const input = parseRpcParams("coder.sendToRun", params) as {
        runId: string;
        text: string;
        mode: "queue" | "steer";
      };
      const runs = requireRuns(deps);
      const delivered = await runs.send(input.runId, input.text, input.mode);
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
        optionId: string;
      };
      const runs = requireRuns(deps);
      const resolved = await runs.answerApproval(input.runId, input.requestId, input.optionId);
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
      return { runs: runs.list(input ?? {}) };
    },

    /* ────────────────── agents ────────────────── */
    "coder.listHarnesses": async (params) => {
      parseRpcParams("coder.listHarnesses", params);
      return {
        harnesses: ALL_HARNESSES.map((id) =>
          summarize(
            id,
            probe,
            deps.store.sessionOptions(id),
            // The auth record — the last fact on this row. **Every field of a summary is something a probe
            // established**; nothing here is read from the settings document, which is what makes a picker
            // built over these rows impossible to shorten with a stored preference. The decision about which
            // of them a picker offers lives in one pure function over them
            // (`apps/desktop/src/composer/agent-for.ts`), not here.
            deps.store.agentAuth(id),
          ),
        ),
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
        harness: HarnessId;
        force?: boolean;
      };
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
          defaults?: { harness?: HarnessId; model?: string; extraArgs?: string };
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
      const settings = await deps.store.updateSettings(input.settings);
      return { settings };
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
      ENVOYCODER_ERRORS.harnessFailed,
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
      ENVOYCODER_ERRORS.harnessFailed,
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
function snapshot(runs: RunManager, runId: string, sinceSeq: number): {
  run: AgentRun;
  events: readonly RunEvent[];
  nextSeq: number;
  live: boolean;
} {
  const run = runs.get(runId);
  if (!run) {
    throw coderError(
      ENVOYCODER_ERRORS.runMissing,
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

/**
 * "There is no such project / task."
 *
 * Two keys rather than one with a `{kind}` value, deliberately: German, French, Italian and the rest
 * inflect the noun ("kein Projekt" / "keine Aufgabe"), so a template with the noun substituted into
 * it would be wrong in exactly the languages this work exists for.
 */
function notFound(kind: "project" | "task", id: string): Error {
  const sentence =
    `There is no ${kind} called "${id}" on this machine. It may have been removed from another window.`;
  // The code follows the noun too, for the same reason the key does: a caller that has just been told
  // its project is gone and one that has been told its task is gone do different things next.
  return coderError(
    kind === "project" ? ENVOYCODER_ERRORS.projectMissing : ENVOYCODER_ERRORS.taskMissing,
    sentence,
    kind === "project"
      ? ref("error.projectNotFound", { id })
      : ref("error.taskNotFound", { id }),
  );
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
            `EnvoyCoder could not read ${name}, so it moved it aside to ${entry.movedTo} and started that list empty. (${entry.reason})`,
            { name, movedTo: entry.movedTo, reason: entry.reason },
          )
        : keyed(
            "note.quarantined.left",
            `EnvoyCoder could not read ${name} and could not move it aside, so it left it untouched and started that list empty. (${entry.reason})`,
            { name, reason: entry.reason },
          ),
    );
  }
  for (const entry of notes.droppedKeys) {
    /**
     * **One sentence per key, and the difference between the two is a deletion rather than a typo.**
     *
     * A key this build used to have is worth a word of its own: "we removed this" is a fact about
     * EnvoyCoder, and it tells a user the value is not coming back and there is nothing to re-add. A key
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
            ? `${entry.file} had ${dropped.path}, which this build no longer has. EnvoyCoder dropped it and kept every other setting.`
            : `${entry.file} had ${dropped.path}, which this build does not recognise. EnvoyCoder dropped it and kept every other setting.`,
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
