/**
 * Runs: one agent turn, from the daemon's point of view.
 *
 * ## What this class is responsible for
 *
 * Starting an agent, normalizing whatever it says into `RunEvent`s, keeping those events so a window
 * that connects late can still render the transcript, answering approvals, cancelling, and resuming
 * rather than restarting. It is the only place that knows which agent produced a run — which is
 * exactly why what it emits is normalized: a client renders a transcript, and only the daemon can
 * know that an ACP `agent_message_chunk` and a CLI's stdout line are the same idea.
 *
 * ## Where every mapping comes from
 *
 * The ACP side was read out of the harness's own source rather than the specification, because what
 * matters is the shapes a *specific* agent actually sends:
 *
 * | ACP | Event | Source |
 * |---|---|---|
 * | `agent_message_chunk { messageId, content }` | `run.output { stream: "assistant" }` | `../deepseek-harness/packages/acp/acp/src/updates.ts:33-38` |
 * | `agent_thought_chunk { messageId, content }` | `run.thought` | `updates.ts:24-30` |
 * | `tool_call { toolCallId, title, status, rawInput }` | `run.tool { status: "running" }` | `updates.ts:51-59` |
 * | `tool_call_update { toolCallId, status, content }` | `run.tool` terminal | `updates.ts:76-86` |
 * | `usage_update { used, size }` | `run.usage { contextUsed, contextSize }` | `updates.ts:93-99` |
 * | `available_commands_update { availableCommands }` | `run.commands` | ACP session update; the agent's own `/` list |
 * | `session/request_permission { toolCall, options }` | `run.approval-requested` | `packages/acp/acp/src/index.ts:157-172` |
 * | the `session/prompt` result's `stopReason` | `run.ended` | observed against the real binary |
 *
 * ## Queue and Steer, and why they are implemented this way
 *
 * ACP's shape is one `session/prompt` in flight at a time and a `session/cancel` notification. There
 * is no "append to the running turn" method, so the two composer modes are built out of what the
 * protocol does have, and they differ in exactly the way a user experiences them:
 *
 *   * **Queue** — the message waits. The turn in flight finishes, and the message is sent as the
 *     next prompt in the same session.
 *   * **Steer** — the message interrupts. The turn in flight is cancelled *now*, and the message is
 *     sent immediately as the next prompt. The agent changes course mid-task instead of finishing
 *     the thing the user is trying to redirect.
 *
 * Both are recorded in the transcript as `run.message` with a `delivered` field, so "did it join or
 * wait?" is answerable afterwards — the reason the distinction is a control rather than a hidden
 * policy (`docs/envoydev-ui.md` §5).
 *
 * ## One run per task
 *
 * A second `startRun` on a task that is already running is **refused**, not queued: two agents
 * editing one working tree is the failure a control plane exists to prevent. The refusal names the
 * way to send a message to the run that is already going.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import {
  type AgentRun,
  type CoderSettings,
  ENVOYDEV_ERRORS,
  type HarnessId,
  type RunEvent,
  type RunMode,
  type TaskStatus,
  type PromptImage,
  coderError,
} from "@envoydev/protocol";
// Only what this file uses: the three delivery helpers (`harnessModelDelivery`, `resolveModelChoice`,
// `thinkingDelivery`) are `run-options.ts`'s, and were imported here without being read — dead
// references the compiler does not flag because `noUnusedLocals` is off. Removed while this import
// block was already being edited.
import {
  envoyPermissionPolicy,
  featureSessionConfigs,
  harnessDefinition,
  mapRetiredEnvoyMode,
  modeLaunchEnv,
  observeSessionOptions,
  collaborationModeToSet,
} from "@envoydev/agent-catalog";
import type { PlatformId } from "@envoydev/platform";

import type { CoderPaths } from "@envoydev/host-bridge";

import { AcpClient, type AcpLaunch, type AcpPermissionRequest, type AcpSessionPolicy, type AcpUpdate, type AcpUserQuestion, type AcpUserQuestionChoice } from "./acp/client.js";
import { launchForHarness } from "./launch.js";
import { envoyRunModel } from "./envoy-llm.js";
import { slashCommandsFromAcp } from "../composer/slash-commands.js";
import { keyed, ref } from "./messages.js";
// The values a run asks for, checked against the catalogue before anything is spawned — and the
// refusals a user reads when this build cannot deliver one. They live in their own module because they
// are one subject (see its head), and this file is about the run loop rather than about the rules.
import {
  resolveAgentMode,
  resolveApprovalPolicy,
  resolveModelDelivery,
  resolveThinkingDelivery,
} from "./run-options.js";
import type { CoderStore } from "./store.js";
import { allowChoiceId, choiceAllows, isCommandAllowed, permissionMemoryKey, rememberCommand } from "./allowed-commands.js";
import {
  agentRunFromTranscript,
  readTranscript,
  rememberRun,
  resumableSessionId,
  runIdsForTask,
  transcriptFile,
} from "./transcript-log.js";

export interface RunManagerDeps {
  paths: CoderPaths;
  store: CoderStore;
  /** Where run events go. The daemon wires this to a per-connection push. */
  onEvent: (event: RunEvent) => void;
  /** Resolve the agent's binary and argv. Injected so tests drive a fixture, not a real CLI. */
  resolveLaunch?: (input: {
    harness: HarnessId;
    cwd: string;
    extraArgs?: string;
    model?: string;
    /** Extra environment for this launch — a DeepSeek permission level. */
    extraEnv?: Record<string, string>;
  }) => AcpLaunch;
  /** Which platform's argv and spawn rules to use, so the Windows branch is testable. */
  platform?: PlatformId;
  /**
   * **How this agent's connector is delivered** — the user's stored choice, read here rather than inside
   * `launchForHarness`.
   *
   * Injected because the launch is a pure function of its input by design, and because a test that wants to prove
   * the `npx` argv must not need a state file to do it. Absent means `installed`.
   */
  deliveryOf?: (harness: HarnessId) => "installed" | "npx";
  now?: () => Date;
  /** The ACP client constructor. Overridden by tests, which must not spawn real agents. */
  startClient?: typeof AcpClient.start;
}

/**
 * `Omit` over a union collapses to the members' *common* keys, which would erase every field that
 * distinguishes one run event from another. Distributing it over the union keeps each variant's own
 * shape, so `record()` is type-checked per event kind rather than against their intersection.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event before the daemon stamps it with its run, task, time and sequence. */
type RunEventInput = DistributiveOmit<RunEvent, "runId" | "taskId" | "at" | "seq">;

interface LiveRun {
  run: AgentRun;
  events: RunEvent[];
  seq: number;
  client: AcpClient | undefined;
  launch: AcpLaunch;
  /**
   * The model this run was started on, taken apart for the agent's own protocol, and the thinking
   * level beside it — **in the order they must be applied**.
   *
   * Resolved once, in `start`, from the catalogue — and kept on the live run rather than looked up
   * again in `drive`, because the two must be the same answer. `launch` already carries the argv half
   * of the model (the catalogue's `buildArgs` built those flags from the same value); this is the half
   * that cannot travel in argv, which `AcpClient` applies to the session once it exists.
   *
   * Order is load-bearing rather than tidy: an agent derives the thinking levels it offers from the
   * model it has resolved (`dsh-acp/lib/index.js:494-508`), so the model goes first.
   */
  sessionConfigs: readonly { configId: string; value: string }[];
  /**
   * Whether this agent was told to ask before destructive actions — the app setting, resolved for this
   * run's agent, and `undefined` when that agent has no `session/set_policy` to be told through.
   *
   * On the live run for the same reason `sessionConfigs` is: it is resolved once, from the settings
   * that were current when the run started, and `drive` must apply *that* answer rather than reading
   * the settings again a moment later — a user who flips the switch mid-run should not get a posture
   * the run's own record disagrees with.
   */
  sessionPolicy: AcpSessionPolicy | undefined;
  /** The turn currently in flight, so `send` can tell "queued" from "steered". */
  turn: Promise<{ stopReason: string }> | undefined;
  /** Messages the user sent, oldest first. */
  queued: { text: string; mode: RunMode; images?: PromptImage[] }[];
  /** Why the turn in flight was interrupted — the difference between `cancel` and `steer`. */
  intent: "none" | "cancel" | "steer";
  /** The approval or question the run is blocked on, if any. A string is one permission choice. */
  approval: {
    requestId: string;
    settle: (choice: string | AcpUserQuestionChoice | null) => void;
  } | undefined;
  stderr: string[];
  settled: boolean;
  /**
   * Resolves when the run has finished and every write it makes has been made.
   *
   * Without it, shutdown returns while a cancelled run is still appending its last events — so a
   * daemon that stopped "cleanly" can be followed by a transcript write against a directory
   * somebody has already removed. `stopAll` awaits these.
   */
  done: Promise<void>;
  markDone: () => void;
}

export interface StartRunInput {
  taskId: string;
  prompt: string;
  /** Rejoin the task's last agent session instead of starting a new one. */
  resume?: boolean;
  model?: string;
  /**
   * The agent's own mode for this run (`AgentMode.id`).
   *
   * Defaults to the task's stored `agentModeId`, so a choice made in the composer survives to the
   * next run without the caller having to repeat it. Whatever the source, it is checked against the
   * catalogue before anything is spawned — see `resolveAgentMode`.
   */
  agentModeId?: string;
  /**
   * The agent's own thinking level for this run (`AgentOptionValue.value`).
   *
   * Defaults to the task's stored `thinkingLevel`, so a choice made in the composer survives to the
   * next run without the caller repeating it — the same arrangement `model` has. Checked against the
   * catalogue before anything is spawned (see `resolveThinkingDelivery`), and **not** checked against
   * the observed option list, which is a record of an earlier session rather than a promise.
   */
  thinkingLevel?: string;
  /** Pictures for this turn. Absent when the message is only words. */
  images?: PromptImage[];
}

export class RunManager {
  private readonly deps: RunManagerDeps;
  private readonly active = new Map<string, LiveRun>();
  /**
   * Finished runs, **with their events**, oldest first and bounded.
   *
   * Keeping the events is not a nicety: a window that opens after a run has ended must still be able
   * to render what the agent did, and `coder.getRun` on a finished run has to answer. Dropping them
   * at `run.ended` would make a transcript readable only while its agent was still alive — which is
   * exactly when nobody needs to read it. The bound is what keeps that from being a leak.
   */
  private readonly finished = new Map<string, LiveRun>();
  private static readonly RECENT_LIMIT = 50;
  /** The agent session each task last used, so `resume` has something to rejoin. */
  private readonly lastSession = new Map<string, string>();

  constructor(deps: RunManagerDeps) {
    this.deps = deps;
  }

  /* ────────────────────────────── queries ────────────────────────────── */

  get(runId: string): AgentRun | undefined {
    return (this.active.get(runId) ?? this.finished.get(runId))?.run;
  }

  /** The run's events, from `sinceSeq` (exclusive) onward. Available for finished runs too. */
  events(runId: string, sinceSeq = 0): readonly RunEvent[] {
    const live = this.active.get(runId) ?? this.finished.get(runId);
    return (live?.events ?? []).filter((event) => event.seq > sinceSeq);
  }

  isLive(runId: string): boolean {
    const live = this.active.get(runId);
    return live !== undefined && !live.settled;
  }

  liveFor(taskId: string): AgentRun | undefined {
    for (const live of this.active.values()) {
      if (live.run.taskId === taskId && !live.settled) return live.run;
    }
    return undefined;
  }

  list(filter: { taskId?: string; limit?: number } = {}): readonly AgentRun[] {
    const all = [...this.active.values(), ...this.finished.values()].map((live) => live.run);
    const matching = filter.taskId ? all.filter((run) => run.taskId === filter.taskId) : all;
    return matching.slice(-(filter.limit ?? RunManager.RECENT_LIMIT));
  }

  /* ────────────────────────────── starting ────────────────────────────── */

  async start(input: StartRunInput): Promise<AgentRun> {
    const task = this.deps.store.findTask(input.taskId);
    if (!task) {
      throw coderError(
        ENVOYDEV_ERRORS.taskMissing,
        `There is no task called "${input.taskId}", so there is nowhere to run an agent.`,
        ref("error.taskForRunMissing", { taskId: input.taskId }),
      );
    }
    if (this.liveFor(input.taskId)) {
      throw coderError(
        ENVOYDEV_ERRORS.harnessFailed,
        `"${task.title}" is already running. Send it a message instead — starting a second agent in one directory is how two of them come to edit the same file.`,
        ref("error.taskAlreadyRunning", { task: task.title }),
      );
    }

    const requested = input.model ?? task.model;
    // Envoy Harness has no model until Settings saves one. An empty picker, or a leftover catalogue
    // choice for a different provider, uses that saved model so the key and base URL travel with it.
    const model =
      task.harness === "envoy-harness" ? envoyRunModel(this.deps.paths, requested) : requested;
    // **Checked before anything is spawned.** A mode the agent cannot accept has two possible
    // outcomes and only one of them is honest: refuse the call, or start an agent in a posture the
    // user did not ask for. The second is not a smaller version of the first — a user who chose
    // `plan` and got an unrestricted agent has been told something false about what is running.
    const requestedMode = input.agentModeId ?? task.agentModeId;
    const agentModeId = resolveAgentMode(task.harness, requestedMode);
    // A permission level is not `session/set_mode`. DeepSeek takes it as `DSH_PERMISSION_MODE` on the
    // process; Envoy Harness takes it as `session/set_policy`. `default` / `plan` / `review` stay on
    // `session/set_mode`, and those runs still get the settings switch as `autoRun`.
    const permissionEnv = modeLaunchEnv(task.harness, agentModeId);
    const permissionPolicy = envoyPermissionPolicy(task.harness, agentModeId);
    const planMode = task.planMode === true || (task.harness === "envoy-harness" && requestedMode === "plan");
    const modeToSet = collaborationModeToSet(task.harness, agentModeId, planMode);
    // The model, on exactly the same terms and for a failure that is easier to miss: `envoy-harness`
    // parses `--model` whether or not `--provider` is there and *then ignores it*
    // (`../envoy-harness/packages/envoy-harness/src/cli/run/acp.ts:100-106`), so a model we could not
    // take apart would leave the agent answering on its default while the transcript named the user's
    // choice. Refusing here is the only outcome that does not mislead — and it happens before the
    // process exists, so there is nothing half-started to clean up.
    //
    // **Resolved before the launch, and the order is load-bearing.** The catalogue's `buildArgs` also
    // turns the model into flags, and for a value it cannot resolve `modelArgs` throws a plain `Error`
    // with no code and no catalogue key. Building the launch first would therefore surface *that*
    // failure — a sentence a translated window cannot render, from a layer that cannot know which
    // refusal it is — where this produces the keyed one. Both refuse; only one of them is explainable
    // to a user.
    const modelConfig = resolveModelDelivery(task.harness, model);
    // The thinking level, on the same terms and with an extra one recorded below: the *value* is not
    // checked against anything we have seen, because the observed list is a record of an earlier
    // session and the agent is the authority on what it currently accepts.
    const thinkingLevel = input.thinkingLevel ?? task.thinkingLevel;
    const thinkingConfig = resolveThinkingDelivery(task.harness, thinkingLevel);
    /**
     * Whether this agent asks before destructive actions — the app setting, resolved for *this* agent.
     *
     * Read from the settings the daemon owns rather than from the caller, because it is not a property
     * of the run: `requireApprovalForDestructive` is the user's decision about this machine, and a task
     * started from the phone or from a second window has to be governed by the same one.
     * `undefined` for an agent with no `session/set_policy` — deliberately not a refusal, for the
     * reasons `resolveApprovalPolicy` records, and disclosed on screen by the settings row instead.
     */
    const sessionPolicy =
      permissionPolicy ??
      resolveApprovalPolicy(
        task.harness,
        this.settings().requireApprovalForDestructive,
      );
    const launch = this.deps.resolveLaunch
      ? this.deps.resolveLaunch({
          harness: task.harness,
          cwd: task.cwd,
          ...(task.extraArgs ? { extraArgs: task.extraArgs } : {}),
          ...(model ? { model } : {}),
          ...(permissionEnv ? { extraEnv: permissionEnv } : {}),
        })
      : // **The same function the probe calls** (`launch.ts`), which is the point of it being a module
        // rather than a method here: a probe starts the agent exactly the way a run does, so a change to
        // the argv, the environment or the refusals cannot reach one path and miss the other.
        launchForHarness({
          harness: task.harness,
          cwd: task.cwd,
          paths: this.deps.paths,
          ...(this.deps.platform ? { platform: this.deps.platform } : {}),
          ...(task.extraArgs ? { extraArgs: task.extraArgs } : {}),
          ...(model ? { model } : {}),
          // **The user's delivery choice, read here rather than inside `launchForHarness`.** The launch is a
          // pure function of its input on purpose; which route this machine takes is daemon state, and this is
          // the one place a run is started from.
          ...(this.deps.deliveryOf ? { delivery: this.deps.deliveryOf(task.harness) } : {}),
          ...(permissionEnv ? { extraEnv: permissionEnv } : {}),
        });

    const runId = randomUUID();
    const previousRunId = task.runId;
    const file = transcriptFile(this.deps.paths.transcriptsDir, runId);
    const run: AgentRun = {
      id: runId,
      taskId: task.id,
      harness: task.harness,
      ...(model ? { model } : {}),
      // Only when the agent accepted it, which `resolveThinkingDelivery` has just established: a run
      // that named a level the agent refused never gets here, so this field cannot claim one.
      ...(thinkingConfig && thinkingLevel ? { thinkingLevel } : {}),
      hostId: task.hostId ?? "local",
      startedAt: this.now(),
      status: "running",
      // Set before the first event, or that event is the one a restarted daemon cannot read back.
      ...(file !== undefined && this.settings().keepTranscripts ? { transcriptPath: file } : {}),
    };
    let markDone = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      markDone = resolve;
    });
    const live: LiveRun = {
      run,
      events: [],
      seq: 0,
      client: undefined,
      launch,
      sessionConfigs: [
        // Model first: an agent derives its thinking levels from the model it has resolved.
        ...(modelConfig ? [modelConfig] : []),
        ...(thinkingConfig && thinkingLevel ? [{ ...thinkingConfig, value: thinkingLevel }] : []),
        // Plan, when this agent accepts it. Fast is remembered and not sent — see features.ts.
        ...featureSessionConfigs(task.harness, model, {
          ...(task.fastMode !== undefined ? { fastMode: task.fastMode } : {}),
          ...(task.planMode !== undefined ? { planMode: task.planMode } : {}),
        }),
      ],
      sessionPolicy,
      turn: undefined,
      queued: [],
      intent: "none",
      approval: undefined,
      stderr: [],
      settled: false,
      done,
      markDone,
    };
    this.active.set(run.id, live);

    if (run.transcriptPath !== undefined) {
      await rememberRun(this.deps.paths.transcriptsDir, task.id, run.id).catch(() => undefined);
    }
    await this.deps.store.setTaskRun(task.id, { runId: run.id, status: "running" });
    await this.record(live, {
      kind: "run.started",
      harness: run.harness,
      ...(run.model ? { model: run.model } : {}),
      ...(run.thinkingLevel ? { thinkingLevel: run.thinkingLevel } : {}),
      hostId: run.hostId,
    });

    // The turn runs in the background: `coder.startRun` answers as soon as the run *exists*, so the
    // UI renders a task starting rather than blocking until it finishes.
    void this.drive(live, input.prompt, input.resume === true, modeToSet, input.images, previousRunId);
    return run;
  }

  /**
   * Load a run the daemon no longer has in memory, from the transcript it wrote.
   *
   * No-op when the run is already here, or when nothing was written (the setting was off, or this
   * build is older than the file). A phone that opens a task after a restart calls this through
   * `tailRun` and gets the history instead of "there is no such run".
   */
  async recall(runId: string): Promise<void> {
    if (this.active.has(runId) || this.finished.has(runId)) return;
    const file = transcriptFile(this.deps.paths.transcriptsDir, runId);
    if (file === undefined) return;
    const events = await readTranscript(file);
    const run = agentRunFromTranscript(events, file);
    if (run === undefined) return;
    const sessionId = resumableSessionId(events);
    if (sessionId !== undefined) this.lastSession.set(run.taskId, sessionId);
    const seq = events.reduce((max, event) => Math.max(max, event.seq), 0);
    this.finished.set(runId, {
      run,
      events: [...events],
      seq,
      client: undefined,
      launch: { command: "", args: [], cwd: "" },
      sessionConfigs: [],
      sessionPolicy: undefined,
      turn: undefined,
      queued: [],
      intent: "none",
      approval: undefined,
      stderr: [],
      settled: true,
      done: Promise.resolve(),
      markDone: () => undefined,
    });
  }

  /**
   * Every run of a task the daemon can still show, oldest first.
   *
   * Memory first is not enough: after a restart the only copy is the transcript index, and the
   * task row names only the latest id. Both are included, and a run that did not record a start
   * is left out rather than shown as an empty conversation.
   */
  async history(taskId: string, limit = RunManager.RECENT_LIMIT): Promise<AgentRun[]> {
    const ids = [...(await runIdsForTask(this.deps.paths.transcriptsDir, taskId))];
    const task = this.deps.store.findTask(taskId);
    if (task?.runId !== undefined && !ids.includes(task.runId)) ids.push(task.runId);
    for (const run of this.list({ taskId })) {
      if (!ids.includes(run.id)) ids.push(run.id);
    }
    const runs: AgentRun[] = [];
    for (const id of ids) {
      await this.recall(id);
      const run = this.get(id);
      if (run !== undefined && run.taskId === taskId) runs.push(run);
    }
    return runs.slice(-limit);
  }

  /** The session to rejoin, including one that lives only in a transcript from before this process. */
  private async sessionToResume(
    taskId: string,
    resume: boolean,
    previousRunId: string | undefined,
  ): Promise<string | undefined> {
    if (!resume) return undefined;
    const known = this.lastSession.get(taskId);
    if (known !== undefined) return known;
    if (previousRunId === undefined) return undefined;
    await this.recall(previousRunId);
    return this.lastSession.get(taskId);
  }

  /* ────────────────────────────── the turn loop ────────────────────────────── */

  /**
   * Run turns until there is nothing left to say.
   *
   * The loop is the composer's two modes made concrete. Each iteration sends one prompt; when it
   * returns, either the user interrupted (so the run ends unless a `steer` is waiting), or a queued
   * message takes over as the next turn, or the run finishes.
   */
  private async drive(
    live: LiveRun,
    firstPrompt: string,
    resume: boolean,
    agentModeId: string | undefined,
    firstImages: PromptImage[] | undefined,
    previousRunId: string | undefined,
  ): Promise<void> {
    const startClient = this.deps.startClient ?? AcpClient.start;
    try {
      const resumeSessionId = await this.sessionToResume(live.run.taskId, resume, previousRunId);
      const client = await startClient({
        launch: live.launch,
        onUpdate: (update) => this.onUpdate(live, update),
        onPermissionRequest: (request) => this.onPermissionRequest(live, request),
        onUserQuestion: (request) => this.onUserQuestion(live, request),
        onStderr: (line) => {
          // Kept, bounded, and never printed: it is what explains a failure the protocol reported as
          // one sentence, and a chatty agent must not become a memory leak in a long-lived daemon.
          live.stderr = [...live.stderr.slice(-20), line];
        },
        ...(resumeSessionId ? { resumeSessionId } : {}),
        // Passed only when the catalogue says this agent accepts one, which is why the client needs no
        // per-agent knowledge of its own: it sets what it is given and reports what comes back.
        ...(agentModeId ? { agentModeId } : {}),
        // The other half of the same division. Some agents take a model in argv (already in `launch`)
        // and some through the session's own configuration, and *which* is a catalogue fact the client
        // must not know — so the daemon hands it a config id and a value, in the order they must be
        // applied, or nothing at all.
        ...(live.sessionConfigs.length > 0 ? { sessionConfigs: live.sessionConfigs } : {}),
        // And the posture, on the same division: which method carries it and which values it accepts is
        // the catalogue's and the agent's business, and `RunManager` hands over a resolved value or
        // nothing. Absent is the normal case — every agent but `envoy-harness` — and it means "leave
        // this agent's own approval policy alone".
        ...(live.sessionPolicy ? { sessionPolicy: live.sessionPolicy } : {}),
      });
      live.client = client;

      if (client.sessionId) this.lastSession.set(live.run.taskId, client.sessionId);
      // **Only for a session we opened.** A resume is answered with less — both native harnesses reply
      // to `session/resume` with little more than the session id — so recording it would replace a full
      // option list with an empty one, which on screen is the difference between a picker and "this
      // agent offers nothing". The condition is `resumeSessionId`, which is also exactly when
      // `AcpClient` called `session/new` rather than `session/resume`.
      if (resumeSessionId === undefined) await this.recordSessionOptions(live, client);
      await this.record(live, {
        kind: "run.session",
        sessionId: client.sessionId ?? "unknown",
        // A capability we record from the protocol the agent speaks, never a guess about this
        // particular run: an agent with no `session/resume` says so here.
        resumable: harnessDefinition(live.run.harness).capabilities.resume,
        resumed: resumeSessionId !== undefined,
      });

      let prompt = firstPrompt;
      let images = firstImages;
      for (;;) {
        live.turn = client.prompt(prompt, images);
        const result = await live.turn;
        live.turn = undefined;

        // The intent recorded *while* the turn was in flight, taken and reset in one step. A steer
        // also cancels — the difference between "stop" and "redirect" is which intent was set at the
        // same moment, and reading it through a method keeps that value from being narrowed away by
        // the compiler at the assignment site.
        const intent = takeIntent(live);
        const next = live.queued.shift();
        if (intent === "cancel") {
          await this.finish(live, "cancelled", null);
          return;
        }
        if (next) {
          prompt = next.text;
          images = next.images;
          continue;
        }
        await this.finish(live, statusForStopReason(result.stopReason), null);
        return;
      }
    } catch (error) {
      const message = describeFailure(error, live);
      await this.record(live, { kind: "run.status", status: "failed", note: message });
      await this.finish(live, "failed", null);
    } finally {
      await live.client?.stop().catch(() => undefined);
      live.client = undefined;
    }
  }

  /* ────────────────────────────── what the agent told us about itself ────────────────────────────── */

  /**
   * Write down what this agent published when the session opened.
   *
   * ## Why a run is the only place this can happen
   *
   * The options are per session — `session/new` answers `{sessionId, configOptions}` and there is no
   * way to ask an agent what it offers without opening one — so the record is a *by-product* of real
   * work rather than something the daemon can go and fetch at startup. Two consequences the window
   * lives with, and states on screen: the first run of an agent teaches us, and the answer is always
   * about the **last** session rather than the next one.
   *
   * ## Why it never fails the run
   *
   * This is a note about somebody else's product, not part of the user's work. A write that failed —
   * a full disk, a state directory removed underneath us — must not take down a session that has
   * already opened, so the failure is swallowed and the run continues with the options the window
   * showed before. The alternative would be an agent that worked and a task reported as failed.
   *
   * An **empty** observation is recorded rather than skipped: "we opened a session and the agent
   * published nothing" is a fact about the agent (it is exactly what `envoy-harness` does), and it is
   * a different statement from "we have not looked yet" — the distinction the thinking pill's two
   * disabled states rest on.
   */
  private async recordSessionOptions(live: LiveRun, client: AcpClient): Promise<void> {
    try {
      await this.deps.store.recordSessionOptions(
        observeSessionOptions({
          harness: live.run.harness,
          observedAt: this.now(),
          ...(client.sessionId !== undefined ? { sessionId: client.sessionId } : {}),
          configOptions: client.sessionConfigOptions(),
        }),
      );
    } catch {
      // See the doc above: the record is a courtesy to the next render, not part of the run.
    }
  }

  /* ────────────────────────────── normalization ────────────────────────────── */

  private onUpdate(live: LiveRun, update: AcpUpdate): void {
    const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
    switch (kind) {
      case "agent_message_chunk": {
        const text = textOf(update.content);
        if (text === "") return;
        void this.record(live, {
          kind: "run.output",
          stream: "assistant",
          text,
          ...(typeof update.messageId === "string" ? { messageId: update.messageId } : {}),
        });
        return;
      }
      case "agent_thought_chunk": {
        const text = textOf(update.content);
        if (text === "") return;
        void this.record(live, {
          kind: "run.thought",
          text,
          ...(typeof update.messageId === "string" ? { messageId: update.messageId } : {}),
        });
        return;
      }
      case "tool_call": {
        void this.record(live, {
          kind: "run.tool",
          callId: String(update.toolCallId ?? ""),
          name: typeof update.title === "string" && update.title !== "" ? update.title : "tool",
          status: "running",
          ...(update.rawInput !== undefined ? { input: update.rawInput } : {}),
        });
        return;
      }
      case "tool_call_update": {
        void this.record(live, {
          kind: "run.tool",
          callId: String(update.toolCallId ?? ""),
          name: "",
          status: update.status === "failed" ? "failed" : "completed",
          ...(update.content !== undefined ? { output: update.content } : {}),
        });
        return;
      }
      case "usage_update": {
        void this.record(live, {
          kind: "run.usage",
          ...(typeof update.used === "number" ? { contextUsed: update.used } : {}),
          ...(typeof update.size === "number" ? { contextSize: update.size } : {}),
        });
        return;
      }
      case "available_commands_update": {
        void this.record(live, {
          kind: "run.commands",
          commands: slashCommandsFromAcp(update),
        });
        return;
      }
      default:
        // A kind this build does not render is dropped rather than guessed at. Showing a user raw
        // JSON for an unknown payload is worse than showing nothing.
        return;
    }
  }

  /**
   * An approval the agent is blocked on.
   *
   * The task becomes `needs-attention` **before** the event is emitted, so a window that reacts
   * to the event and refetches the rail already sees the row in the right state. `needs-attention`
   * is deliberately not `running`: an agent waiting on a human is not making progress
   * (`docs/envoydev-ui.md` §4).
   */
  private onPermissionRequest(live: LiveRun, request: AcpPermissionRequest): Promise<string | null> {
    const requestId = request.toolCall?.toolCallId ?? randomUUID();
    const key = permissionMemoryKey({
      toolName:
        (typeof request.toolName === "string" && request.toolName !== "" ? request.toolName : undefined) ??
        this.toolName(live, request.toolCall?.toolCallId ?? ""),
      args: request.args ?? this.toolInput(live, request.toolCall?.toolCallId ?? ""),
    });
    const remembered = key
      ? isCommandAllowed(this.deps.paths.stateDir, live.launch.cwd, key)
      : Promise.resolve(false);
    return remembered.then((known) => {
      if (known) {
        const choice = allowChoiceId(request.options);
        if (choice !== undefined) return choice;
      }
      return this.askPermission(live, request, requestId, key);
    });
  }

  private askPermission(
    live: LiveRun,
    request: AcpPermissionRequest,
    requestId: string,
    key: string | undefined,
  ): Promise<string | null> {
    const fromAgent = (request.options ?? []).map((option, index) => ({
      id: typeof option.optionId === "string" && option.optionId !== "" ? option.optionId : `option-${index}`,
      label: typeof option.name === "string" && option.name !== "" ? option.name : `Option ${index + 1}`,
      // The protocol's own vocabulary says which choice refuses. Guessing from the label would paint
      // "Deny" as a neutral button for the one agent that words it differently.
      destructive: option.kind === "reject_once" || option.kind === "reject_always",
    }));
    // Envoy Harness asks without listing choices. An empty list is a card with no buttons.
    const options =
      fromAgent.length > 0
        ? fromAgent
        : [
            { id: "allow", label: keyed("approval.allow", "Allow"), destructive: false },
            { id: "deny", label: keyed("approval.deny", "Don't allow"), destructive: true },
          ];

    const named =
      this.toolName(live, request.toolCall?.toolCallId ?? "") ??
      (typeof request.toolName === "string" && request.toolName !== "" ? request.toolName : undefined) ??
      (typeof request.toolCall?.title === "string" && request.toolCall.title !== ""
        ? request.toolCall.title
        : undefined);
    return new Promise<string | null>((resolve) => {
      const settle = (choice: string | AcpUserQuestionChoice | null): void => {
        if (live.approval?.requestId !== requestId) return;
        live.approval = undefined;
        const optionId = typeof choice === "string" ? choice : choice?.optionIds?.[0];
        void (async () => {
          if (optionId !== undefined && key !== undefined && choiceAllows(request.options, optionId)) {
            await rememberCommand(this.deps.paths.stateDir, live.launch.cwd, key);
          }
          if (typeof choice === "string") resolve(choice);
          else resolve(choice?.optionIds?.[0] ?? null);
        })();
      };
      live.approval = { requestId, settle };

      void (async () => {
        await this.setStatus(live, "needs-attention");
        await this.record(live, {
          kind: "run.approval-requested",
          requestId,
          // The family's wording rule: the headline is what is about to happen, in the user's words.
          // ACP gives us a tool id and the agent's own label for the call; "the agent is asking" is
          // the part that is always true, so it is what the card leads with when there is no label.
          question: named
            ? keyed("approval.question.tool", `Allow the agent to run “${named}”?`, { tool: named })
            : keyed("approval.question.generic", "Allow the agent to continue?"),
          detail: keyed(
            "approval.detail",
            "It has stopped before this step and will not continue until you answer. Allowing it lets this same step run again in this project without asking.",
          ),
          options,
        });
      })();
    });
  }

  /**
   * A question the model asked (`ask_user`), not a permission.
   *
   * `multiple` becomes checkboxes. No options becomes a typed answer. Either way the reply is the
   * set the human confirmed, not one click that also means "allow".
   */
  private onUserQuestion(live: LiveRun, request: AcpUserQuestion): Promise<AcpUserQuestionChoice | null> {
    const requestId =
      typeof request.questionId === "string" && request.questionId !== "" ? request.questionId : randomUUID();
    const labels = request.options ?? [];
    const options = labels.map((label, index) => ({
      id: String(index),
      label: label !== "" ? label : `Option ${index + 1}`,
      destructive: false,
    }));
    const many = request.multiple === true && options.length > 1;
    const text = options.length === 0;
    const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
    return new Promise<AcpUserQuestionChoice | null>((resolve) => {
      const settle = (choice: string | AcpUserQuestionChoice | null): void => {
        if (live.approval?.requestId !== requestId) return;
        live.approval = undefined;
        if (choice === null || typeof choice === "string") {
          resolve(typeof choice === "string" ? { optionIds: [choice] } : null);
          return;
        }
        resolve(choice);
      };
      live.approval = { requestId, settle };
      void (async () => {
        await this.setStatus(live, "needs-attention");
        await this.record(live, {
          kind: "run.approval-requested",
          requestId,
          question: prompt !== "" ? prompt : keyed("approval.question.ask", "The agent asked a question."),
          detail: many
            ? keyed(
                "approval.detail.multiple",
                "Tick every option that applies, then confirm. This answer is only for this question.",
              )
            : text
              ? keyed(
                  "approval.detail.text",
                  "Type your answer. The agent will not continue until you send it.",
                )
              : keyed("approval.detail.pick", "Pick one. This answer is only for this question."),
          options,
          ...(many ? { selection: "many" as const } : {}),
          ...(text ? { selection: "text" as const, ...(request.multiline === true ? { multiline: true } : {}) } : {}),
        });
      })();
    });
  }

  /** The arguments of a tool call we have already streamed, so a remembered command can be named. */
  private toolInput(live: LiveRun, callId: string): unknown {
    if (callId === "") return undefined;
    for (let index = live.events.length - 1; index >= 0; index -= 1) {
      const event = live.events[index];
      if (event && event.kind === "run.tool" && event.callId === callId && event.input !== undefined) {
        return event.input;
      }
    }
    return undefined;
  }

  /** The label of a tool call we have already streamed, so the card can name it. */
  private toolName(live: LiveRun, callId: string): string | undefined {
    if (callId === "") return undefined;
    for (let index = live.events.length - 1; index >= 0; index -= 1) {
      const event = live.events[index];
      if (event && event.kind === "run.tool" && event.callId === callId && event.name !== "") return event.name;
    }
    return undefined;
  }

  /* ────────────────────────────── control ────────────────────────────── */

  /**
   * Say something to a run that is already going.
   *
   * `queue` waits for the turn in flight; `steer` interrupts it. See the module doc for why those
   * are the two things the protocol can actually do — and note that both are *delivered*, so neither
   * mode silently drops a message.
   */
  async send(
    runId: string,
    text: string,
    mode: RunMode,
    images?: PromptImage[],
  ): Promise<"queued" | "steered"> {
    const live = this.active.get(runId);
    if (!live || live.settled) {
      throw coderError(
        ENVOYDEV_ERRORS.harnessFailed,
        "That run has already finished, so there is nothing to send to it. Start a new task instead.",
        ref("error.runFinished"),
      );
    }
    if (live.approval) {
      // Queueing behind an approval prompt strands the message: the prompt must be answered before
      // anything else can happen, and the user would be waiting on words the agent never received.
      throw coderError(
        ENVOYDEV_ERRORS.harnessFailed,
        "The agent is waiting for an answer before it can go on. Answer that first — a message sent now would sit behind it.",
        ref("error.approvalPending"),
      );
    }

    live.queued.push({
      text,
      mode,
      ...(images !== undefined && images.length > 0 ? { images } : {}),
    });
    const delivered = mode === "steer" ? "steered" : "queued";
    await this.record(live, { kind: "run.message", text, mode, delivered });

    if (mode === "steer") {
      // Interrupt the turn in flight. The reply arrives as `cancelled`, and the loop above then sends
      // this message as the next prompt — which is what "join the turn" means when the protocol has
      // one prompt in flight at a time.
      live.intent = "steer";
      live.client?.cancel();
    }
    return delivered;
  }

  /**
   * Ask the agent to stop.
   *
   * The turn ends with `stopReason: "cancelled"`, which becomes `run.ended { status: "cancelled" }` —
   * a finished run, not a failed one. Queued messages are dropped: the user asked for the work to
   * stop, and delivering them afterwards would be the opposite of that.
   */
  async cancel(runId: string): Promise<boolean> {
    const live = this.active.get(runId);
    if (!live || live.settled) return false;
    // An open approval is released as a refusal first: an agent blocked on a human cannot see a
    // cancel, so leaving it waiting would make "stop" do nothing.
    live.approval?.settle(null);
    live.queued = [];
    live.intent = "cancel";
    live.client?.cancel();
    await this.setStatus(live, "cancelled");
    return true;
  }

  /** Answer the approval or question this run is blocked on. */
  async answerApproval(
    runId: string,
    requestId: string,
    optionId: string | undefined,
    extra?: { optionIds?: readonly string[]; text?: string },
  ): Promise<boolean> {
    const live = this.active.get(runId);
    if (!live?.approval || live.approval.requestId !== requestId) return false;
    const ids = extra?.optionIds && extra.optionIds.length > 0 ? [...extra.optionIds] : optionId !== undefined ? [optionId] : [];
    const text = extra?.text?.trim() ?? "";
    const primary = ids[0] ?? (text !== "" ? text : undefined);
    if (primary === undefined) return false;
    const settle = live.approval.settle;
    await this.record(live, {
      kind: "run.approval-resolved",
      requestId,
      optionId: primary,
      ...(ids.length > 1 ? { optionIds: ids } : {}),
      by: "you",
    });
    await this.setStatus(live, "running");
    if (text !== "") settle({ text });
    else if (ids.length > 1) settle({ optionIds: ids });
    else settle(primary);
    return true;
  }

  /**
   * Stop everything, and **wait for the runs to actually be over**.
   *
   * Stopping the agent processes is only half of it: each run is mid-`await` when its client is
   * stopped, so it wakes up in its own `catch`, records a final event and writes a transcript. A
   * shutdown that returned before those writes landed would be a shutdown that lies — and the
   * failure it produces is a transcript write against a directory that has since been removed.
   *
   * The wait is bounded: an agent that ignores SIGKILL must not be able to hold the daemon open.
   */
  async stopAll(): Promise<void> {
    const running = [...this.active.values()];
    for (const live of running) {
      live.approval?.settle(null);
      live.queued = [];
      await live.client?.stop().catch(() => undefined);
    }
    await Promise.race([
      Promise.allSettled(running.map((live) => live.done)),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }

  /* ────────────────────────────── recording ────────────────────────────── */

  private async record(live: LiveRun, event: RunEventInput): Promise<void> {
    live.seq += 1;
    const full = {
      ...event,
      runId: live.run.id,
      taskId: live.run.taskId,
      at: this.now(),
      seq: live.seq,
    } as RunEvent;
    live.events.push(full);
    this.deps.onEvent(full);
    await this.appendTranscript(live, full);
  }

  /**
   * Append one event to the run's transcript, as a JSON line.
   *
   * Append-only, so a crash mid-run leaves a readable prefix rather than a truncated object. Best
   * effort: losing a transcript is bad, and losing the *run* because a transcript could not be
   * written would be worse. The switch decides whether we try at all — `keepTranscripts: false` means
   * the record is deliberately not kept.
   */
  private async appendTranscript(live: LiveRun, event: RunEvent): Promise<void> {
    if (!this.settings().keepTranscripts) return;
    const file = live.run.transcriptPath;
    if (!file) return;
    try {
      await mkdir(this.deps.paths.transcriptsDir, { recursive: true });
      await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
    } catch {
      // See the doc above.
    }
  }

  private settings(): CoderSettings {
    return this.deps.store.settings();
  }

  private async setStatus(live: LiveRun, status: TaskStatus): Promise<void> {
    live.run = { ...live.run, status };
    await this.deps.store.setTaskRun(live.run.taskId, { status });
  }

  /** End the run, once, whatever the reason. */
  private async finish(live: LiveRun, status: TaskStatus, exitCode: number | null): Promise<void> {
    if (live.settled) return;
    live.settled = true;
    // Release anyone still waiting on an approval: the agent is gone, so the question is moot, and a
    // promise nobody settles is how a card stays on screen forever.
    live.approval?.settle(null);

    live.run = { ...live.run, endedAt: this.now(), status, exitCode };
    // **The status is written before the ending is announced, and the order is the whole point.**
    //
    // `record` hands the event to the daemon's subscribers synchronously and only then awaits the
    // transcript append, so by the time `run.ended` has been said, this write has not necessarily run —
    // and a client's very next act after hearing that a run ended is to read the task back. It did:
    // `coder.listTasks` answered `running` for a run whose ending had just been delivered, which is the
    // rail's spinner outliving its run. `setTaskRun` updates the store's memory *before* it awaits the
    // disk, so writing it first costs the event nothing and makes the state readable exactly when the
    // announcement arrives. It is also the order this file already uses to *start* a run — status
    // recorded, then `run.started` said — which is what an ending should mirror.
    try {
      await this.deps.store.setTaskRun(live.run.taskId, { status });
    } catch {
      // **An unwritable row is not a reason to lose the ending, nor to keep shutdown waiting on it.**
      //
      // `writeJsonAtomic` has already retried the rename and cleaned up after itself; what it cannot do
      // is make a full disk accept a file. Swallowing it is the call `appendTranscript` makes a few
      // lines up: the run's ending is the record, the row is a convenience — and a disk that cannot
      // take this write will refuse the next one loudly, so nothing is hidden by not failing here.
      // Letting it throw would be worse than either: the run is already `settled`, so `finish` cannot
      // run again, while the tail below (`active`, `finished`, `markDone`) would be skipped — the run
      // left in `active` with `live.done` never resolved, which is a daemon that hangs on quit.
    }
    // **A task that was running when its project's agent changed follows it now.** `updateProject`
    // cannot move a live run — the agent on disk was launched with the old harness — so it remembers
    // the task instead, and this is the moment that memory is spent. A task that was not waiting costs
    // one `Set.delete`: a harness chosen explicitly, through the API, is never overwritten merely
    // because a run ended.
    try {
      await this.deps.store.followProjectHarness(live.run.taskId);
    } catch {
      // The same rule as the row above: the ending is the record, and a store that cannot write must
      // not cost it. The next project change picks the task up.
    }
    await this.record(live, { kind: "run.ended", exitCode, status });
    this.active.delete(live.run.id);
    // Kept for reading, not for control: `settled` is already true, so every mutating path refuses.
    this.finished.set(live.run.id, live);
    // Last, and after every write above: this is the signal shutdown waits on.
    live.markDone();
    while (this.finished.size > RunManager.RECENT_LIMIT) {
      const oldest = this.finished.keys().next();
      if (oldest.done) break;
      this.finished.delete(oldest.value);
    }
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
}

/* ────────────────────────────── helpers ────────────────────────────── */

/**
 * Take the intent recorded during the turn, and reset it.
 *
 * A method rather than an inline read, for a reason worth stating: assigning `"none"` before the
 * prompt narrows the property in the compiler's view, and the values the *await* may have set are
 * then treated as impossible. Reading it here is both correct at runtime and type-checked.
 */
function takeIntent(live: { intent: "none" | "cancel" | "steer" }): "none" | "cancel" | "steer" {
  const intent = live.intent;
  live.intent = "none";
  return intent;
}

/** ACP's stop reason → the status the rail shows. */
function statusForStopReason(stopReason: string): TaskStatus {
  switch (stopReason) {
    case "cancelled":
      return "cancelled";
    case "refusal":
      return "failed";
    default:
      // `end_turn` and `max_tokens` both mean the turn is over and nothing went wrong. `max_tokens`
      // is unfinished work rather than a failure, and the note on the run says which it was.
      return "done";
  }
}

/**
 * The text of an ACP content block, or `""`.
 *
 * Only text is rendered. An image or audio block becomes nothing rather than `[object Object]`,
 * because a transcript that shows a user a stringified object is worse than one with a gap in it.
 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (typeof content !== "object" || content === null) return "";
  const block = content as { type?: unknown; text?: unknown };
  return block.type === "text" && typeof block.text === "string" ? block.text : "";
}

/**
 * Turn a start-up failure into something a user can act on.
 *
 * The agent's own last stderr lines are the difference between "the agent failed" and "the agent
 * needs an API key", and the harness reports that second case as a JSON-RPC error whose text is
 * already good. So the rule is: keep the agent's words, and add our own only when it gave none.
 */
function describeFailure(error: unknown, live: LiveRun): string {
  const message = error instanceof Error ? error.message : String(error);
  const tail = live.stderr.slice(-2).join(" · ");
  return tail !== "" && !message.includes(tail) ? `${message} (${tail})` : message;
}
