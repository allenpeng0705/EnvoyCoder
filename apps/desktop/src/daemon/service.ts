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

import { normalizeUserPath } from "@envoycoder/platform";
import { stat } from "node:fs/promises";

import {
  type AgentRun,
  type HarnessId,
  type HarnessSummary,
  type RpcMethod,
  type RunEvent,
  type CoderMeshStatus,
  ENVOYCODER_ERRORS,
  ENVOYCODER_PRODUCT_NAME,
  RPC_METHODS,
  coderError,
  parseRpcParams,
} from "@envoycoder/protocol";
import { ALL_HARNESSES, harnessDefinition, probeHarness } from "@envoycoder/agent-catalog";

import type { CoderPaths } from "@envoycoder/host-bridge";

import type { RunManager } from "./runs.js";
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
  probe?: (harness: HarnessId) => { available: boolean; binaryPath?: string; reason?: string };
  isModuleAvailable?: (module: string) => boolean;
  /**
   * Runs, from M2 on.
   *
   * Optional so the M1 handler table can still be built on its own — a daemon that can list
   * projects but not run anything is a real configuration (and is what the M1 tests exercise), and
   * the run methods refuse by name when it is absent rather than answering as if nothing were wrong.
   */
  runs?: RunManager;
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
  const probe = deps.probe ?? ((harness: HarnessId) => probeHarness(harness, { moduleAvailable: deps.isModuleAvailable }));

  const handlers: Partial<Record<RpcMethod, CoderHandler>> = {
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
          ENVOYCODER_ERRORS.taskMissing,
          `${path} is not a directory on this machine. Pick a folder that exists — EnvoyCoder runs agents in it, so the path has to be real.`,
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
          ENVOYCODER_ERRORS.taskMissing,
          `${cwd} is not a directory on this machine, so there is nowhere to run the agent. It was the working directory for "${input.title}".`,
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
        extraArgs?: string;
      };
      const task = await deps.store.updateTask(input);
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
      };
      const runs = requireRuns(deps);
      const run = await runs.start({
        taskId: input.taskId,
        prompt: input.prompt,
        ...(input.resume !== undefined ? { resume: input.resume } : {}),
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
      return { harnesses: ALL_HARNESSES.map((id) => summarize(id, probe)) };
    },

    "coder.probeHarness": async (params) => {
      const { harness } = parseRpcParams("coder.probeHarness", params) as { harness: HarnessId };
      const result = probe(harness);
      return {
        harness,
        available: result.available,
        ...(result.binaryPath ? { binary: result.binaryPath } : {}),
        detail: result.available
          ? `Ready to run${result.binaryPath ? ` (${result.binaryPath})` : ""}.`
          : (result.reason ?? `${harnessDefinition(harness).label} is not available on this machine.`),
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
          defaultProjectPath?: string;
          defaults?: { harness?: HarnessId; model?: string; extraArgs?: string };
          requireApprovalForDestructive?: boolean;
          allowRemoteRuns?: boolean;
          keepTranscripts?: boolean;
        };
      };
      const settings = await deps.store.updateSettings(input.settings);
      return { settings };
    },
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
    );
  }
  return deps.runs;
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
      ENVOYCODER_ERRORS.taskMissing,
      `There is no run called "${runId}". It may have been started by a daemon that has since restarted.`,
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

function notFound(kind: "project" | "task", id: string): Error {
  return coderError(
    ENVOYCODER_ERRORS.taskMissing,
    `There is no ${kind} called "${id}" on this machine. It may have been removed from another window.`,
  );
}

async function defaultIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** A catalogue entry plus what this machine can actually do with it. */
function summarize(
  id: HarnessId,
  probe: (harness: HarnessId) => { available: boolean; binaryPath?: string; reason?: string },
): HarnessSummary {
  const definition = harnessDefinition(id);
  const result = probe(id);
  return {
    id,
    label: definition.label,
    tier: definition.tier,
    summary: definition.summary,
    // The agent's own modes, so a composer can render its picker from the wire rather than from a
    // hardcoded list. Empty means "the agent declares none here" — for the two ACP harnesses the real
    // answer arrives in the `session/new` response, and a static guess would go stale.
    modes: definition.modes,
    capabilities: {
      resume: definition.capabilities.resume,
      cancel: definition.capabilities.cancel,
      approvals: definition.capabilities.approvals,
      structuredTools: definition.capabilities.structuredTools,
      streaming: definition.capabilities.streaming,
      images: definition.capabilities.images,
    },
    available: result.available,
    ...(definition.install?.hint ? { installHint: definition.install.hint } : {}),
    evidence: definition.evidence,
  };
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
}): string[] {
  const lines: string[] = [];
  for (const entry of notes.quarantined) {
    const name = entry.file.split(/[\\/]/).pop() ?? entry.file;
    lines.push(
      entry.movedTo
        ? `EnvoyCoder could not read ${name}, so it moved it aside to ${entry.movedTo} and started that list empty. (${entry.reason})`
        : `EnvoyCoder could not read ${name} and could not move it aside, so it left it untouched and started that list empty. (${entry.reason})`,
    );
  }
  for (const entry of notes.skipped) {
    lines.push(`${entry.file}: ${entry.reason}`);
  }
  return lines;
}
