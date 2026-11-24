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
 * | `plan` / `plan_update` / `plan_removed` | `run.plan` | ACP agent plan checklist (Cursor-style progress) |
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
 * policy (`docs/envoydev-ui.md` §5). The **opening** prompt of `startRun` is recorded the same way
 * (`delivered: "steered"`) so the transcript shows what the human asked, not only the agent's reply.
 *
 * ## One run per task
 *
 * A second `startRun` on a task that is already running is **refused**, not queued: two agents
 * editing one working tree is the failure a control plane exists to prevent. The refusal names the
 * way to send a message to the run that is already going.
 *
 * ## Idle keep-alive (auth-tax agents)
 *
 * Cursor (and other launches with `authMethodId`) pay ~1 minute of `authenticate` per ACP process.
 * After a successful `end_turn` with an empty queue we therefore **keep the process idle** for
 * {@link IDLE_KEEPALIVE_MS} so the next `send` reuses the same session — Stop or the idle timeout
 * tear it down. Agents without `authMethodId` still finish on the first empty-queue turn.
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
  isHarnessId,
} from "@envoydev/protocol";
// Only what this file uses: the three delivery helpers (`harnessModelDelivery`, `resolveModelChoice`,
// `thinkingDelivery`) are `run-options.ts`'s, and were imported here without being read — dead
// references the compiler does not flag because `noUnusedLocals` is off. Removed while this import
// block was already being edited.
import {
  askingControl,
  askingOffLaunchArgs,
  envoyDomainPresetPolicy,
  envoyPermissionPolicy,
  featureSessionConfigs,
  harnessDefinition,
  harnessTransport,
  isPermissionModeId,
  mapRetiredEnvoyMode,
  modeForAskingOff,
  modeLaunchEnv,
  observeSessionOptions,
  ompApprovalLaunchArgs,
  collaborationModeToSet,
} from "@envoydev/agent-catalog";
import { cataloguedUnattendedModeId } from "@envoydev/agent-catalog/catalog";
import type { PlatformId } from "@envoydev/platform";

import type { CoderPaths } from "@envoydev/host-bridge";

import {
  AcpClient,
  ACP_AUTH_HANDSHAKE_TIMEOUT_MS,
  type AcpLaunch,
  type AcpPermissionRequest,
  type AcpSessionPolicy,
  type AcpUpdate,
  type AcpUserQuestion,
  type AcpUserQuestionChoice,
} from "./acp/client.js";
import { JsonlRpcAgentClient } from "./rpc/client.js";
import { launchForAgent } from "./launch.js";
import { envoyRunModel } from "./envoy-llm.js";
import { slashCommandsFromAcp } from "../composer/slash-commands.js";
import { stripPlanFirstFraming } from "../composer/plan-gate.js";
import { followUpMustQueue } from "@envoydev/agent-catalog/asking";
import { parseAcpPlanUpdate } from "./acp-plan.js";
import {
  isAcpRetriableLeakError,
  isAcpToolRunnerFailure,
  RETRIABLE_LEAK_RETRY_DELAY_MS,
  stripAcpRetriableLeak,
  toolPayloadFromAcpUpdate,
} from "./acp/retriable-leak.js";
import { splitAskPrompt } from "./ask-prompt.js";
import { keyed, ref } from "./messages.js";
import { describeFailure as describeRunFailure } from "./describe-failure.js";

/** ACP or Pi-family JSONL client — the surface `drive` / cancel / stop share. */
type RunAgentClient = AcpClient | JsonlRpcAgentClient;
// The values a run asks for, checked against the catalogue before anything is spawned — and the
// refusals a user reads when this build cannot deliver one. They live in their own module because they
// are one subject (see its head), and this file is about the run loop rather than about the rules.
import {
  resolveAgentMode,
  resolveApprovalPolicy,
  resolveCataloguedProviderMode,
  resolveModelDelivery,
  resolveThinkingDelivery,
} from "./run-options.js";
import type { CoderStore } from "./store.js";
import { ensureRunnableAgent, findRunnableProvider } from "./runnable-agent.js";
import {
  allowChoiceId,
  approvalSubject,
  choiceAllows,
  choiceIsAllowAlways,
  isCommandAllowed,
  permissionMemoryKey,
  rememberCommand,
} from "./allowed-commands.js";
import { guardianMayAutoAllow } from "./guardian.js";
import {
  agentRunFromTranscript,
  readTranscript,
  rememberRun,
  resumableSessionId,
  runIdsForTask,
  transcriptFile,
} from "./transcript-log.js";
import { isFileMutatingTool, pathFromToolInput } from "../state/tool-buckets.js";
import { activeParticipant, harnessForRun, hostIdForRun } from "./collaboration.js";

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
    /** Pi-family JSONL `--session` resume id. */
    resumeSessionId?: string;
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
  /**
   * The two memory bounds, injectable **so a test can cross them in two events rather than two thousand**.
   * Defaults are the constants above this interface; production never passes this.
   */
  limits?: { events?: number; transcriptBytes?: number };
  /**
   * How long an auth-tax agent stays idle after `end_turn` waiting for the next `send`.
   * Tests pass a short value; production uses {@link IDLE_KEEPALIVE_MS}.
   */
  idleKeepAliveMs?: number;
}

/**
 * `Omit` over a union collapses to the members' *common* keys, which would erase every field that
 * distinguishes one run event from another. Distributing it over the union keeps each variant's own
 * shape, so `record()` is type-checked per event kind rather than against their intersection.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * How many events of one live run are kept in memory.
 *
 * The buffer is a **catch-up window**, not the record: a client that reconnects asks for everything after the
 * sequence number it last saw, and the transcript on disk is what answers for history. Without a bound, a long
 * agent turn that streams output for hours would grow this array without limit — the run would still be fine and
 * the *daemon* would be the thing that died, which is the opposite of what a 7×24 daemon is for.
 *
 * Truncation is **visible rather than silent**: sequence numbers continue to climb, so a client whose `sinceSeq`
 * fell out of the window sees a gap in them. 2 000 events is a few megabytes of agent output — more than any
 * window can display, and enough that a reconnect after a minute of scrolling misses nothing.
 */
const EVENT_BUFFER_LIMIT = 2_000;

/**
 * How large one run's transcript may grow before it stops growing.
 *
 * 8 MB is deliberately generous: a real agent turn is tens of kilobytes, and 8 MB is where a run has stopped being
 * a conversation and become a log. Past it the file keeps what it has — the beginning, which is what a person
 * actually reads — and says so once on stderr, which is the daemon's log. Truncating agent output silently would
 * be worse than either bounding it or not.
 */
const TRANSCRIPT_LIMIT_BYTES = 8 * 1024 * 1024;

/**
 * Same-session re-prompts after the harness returns `max_iterations`.
 * Codex/Claude keep going on large tasks; two host continues after the
 * harness's own phases is enough to finish a summary without unbounded cost.
 */
const MAX_HOST_CONTINUES = 2;

/**
 * Cursor ACP can end a turn with `end_turn` after streaming an internal RetriableError as
 * assistant text. Two same-session re-prompts with a short pause usually recover; more burns
 * the session without helping.
 */
const MAX_RETRIABLE_LEAK_RETRIES = 2;

/** Fixed steer when the host continues a budget-exhausted turn. */
const HOST_CONTINUE_PROMPT =
  "Continue from where you left off — do not restart exploration. Finish open " +
  "plan items; prefer the task tool for independent remaining slices; then " +
  "deliver a complete answer from evidence gathered so far.";

/** Compact before a host continue when context fill is at least this fraction. */
const HOST_CONTINUE_COMPACT_RATIO = 0.85;

/**
 * After a successful turn on an `authMethodId` launch, keep the ACP process up this long so the
 * next chat message does not pay another authenticate (~90 s for Cursor). Stop ends sooner.
 */
export const IDLE_KEEPALIVE_MS = 10 * 60 * 1000;

/** An event before the daemon stamps it with its run, task, time and sequence. */
type RunEventInput = DistributiveOmit<RunEvent, "runId" | "taskId" | "at" | "seq">;

interface LiveRun {
  run: AgentRun;
  events: RunEvent[];
  seq: number;
  /** Bytes appended to the transcript so far, counted rather than `stat`-ed: this is on the hot path. */
  transcriptBytes: number;
  /**
   * When this run last produced an event.
   *
   * **The one fact that separates "working" from "stuck".** A count of active runs cannot: a long agent turn is
   * normal and an agent silent for an hour is not, and the two look identical from outside. Stamped on the hot
   * path because that is where the answer already is — one assignment per event, no timer.
   */
  lastEventAt?: string;
  client: RunAgentClient | undefined;
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
  /**
   * Wakes an idle keep-alive waiter when `send` enqueues or `cancel` stops the run.
   * One-shot: cleared when the wait resolves.
   */
  queueWake?: (() => void) | undefined;
  /** Why the turn in flight was interrupted — the difference between `cancel` and `steer`. */
  intent: "none" | "cancel" | "steer";
  /** The approval or question the run is blocked on, if any. A string is one permission choice. */
  approval: {
    requestId: string;
    settle: (choice: string | AcpUserQuestionChoice | null) => void;
    /**
     * Option ids that mean allow for this card. `stopAsking` may only run when the answer is one of
     * these — otherwise a deny over RPC would flip machine approvals off.
     */
    allowOptionIds: readonly string[];
  } | undefined;
  /**
   * Serialize permission + ask_user cards — one `approval` slot. OMP/Pi also serialize in the
   * RPC client; ACP agents can raise both without that, so the host chain is the backstop.
   */
  approvalChain: Promise<void>;
  /**
   * Wave 4 session stop-asking — auto-allow further permission cards on this live run only.
   * Does not flip Settings; cleared when the run ends.
   */
  sessionAutoAllow?: boolean;
  /**
   * Cursor ACP streamed a RetriableError / WritableIterable leak as assistant text this turn.
   * Cleared when we re-prompt or finish.
   */
  retriableLeakSeen?: boolean;
  /** Assistant characters kept this turn after stripping leaks — >0 means a real reply arrived. */
  assistantKeptCharsThisTurn?: number;
  /**
   * A tool_call_update reached a **successful** terminal status this turn. When set with a leak
   * and no assistant text, we do **not** same-prompt retry (would re-run Shell). Tool-runner
   * blips do not set this — retrying is exactly what we want then.
   */
  toolsSettledThisTurn?: boolean;
  /**
   * A tool result this turn was a Cursor tool-runner blip (e.g. Service temporarily unavailable).
   * With no assistant answer, same-session re-prompt so Shell/Read can run again.
   */
  toolRunnerBlipThisTurn?: boolean;
  /** How many same-prompt recoveries we already spent on Cursor ACP stream leaks / tool blips. */
  retriableLeakRetries?: number;
  /** `sessionUpdate` kinds we already logged for this run (once each on stderr). */
  ignoredSessionUpdates?: Set<string>;
  /** Logged once when a terminal tool update arrived with no content (Cursor omits Shell/Read). */
  loggedEmptyToolContent?: boolean;
  stderr: string[];
  settled: boolean;
  /**
   * Paths write/edit tools named during this run — emitted as one `run.diff` before `run.ended`.
   * Added/removed stay 0 when we only know the path; the UI headline is the file count.
   */
  touchedFiles: Map<string, { added: number; removed: number }>;
  /** Last `run.usage` pair — used to decide whether to compact before a host continue. */
  lastContextUsed: number | undefined;
  lastContextSize: number | undefined;
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
  /**
   * Transcript text for the opening message when `prompt` carries host framing the user should not see.
   */
  displayPrompt?: string;
  /**
   * After `coder.acceptParticipantOffer` on this daemon: run a peer participant locally while
   * keeping `run.hostId` as the peer id. Mesh dial will replace this path (M5b).
   */
  forceLocalPeer?: boolean;
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

  /* ───────────────────────── the two bounds that keep a long run finite ───────────────────────── */
  /** The agent session each task last used, so `resume` has something to rejoin. */
  private readonly lastSession = new Map<string, string>();

  private readonly eventLimit: number;
  private readonly transcriptLimitBytes: number;

  constructor(deps: RunManagerDeps) {
    this.deps = deps;
    this.eventLimit = deps.limits?.events ?? EVENT_BUFFER_LIMIT;
    this.transcriptLimitBytes = deps.limits?.transcriptBytes ?? TRANSCRIPT_LIMIT_BYTES;
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

  /**
   * When any live run last produced an event, or nothing when none is running.
   *
   * Absent is not the same as "long ago": a daemon with no runs has no staleness to report, and the health
   * endpoint says so by omitting the field rather than by inventing a timestamp.
   */
  lastEventAt(): string | undefined {
    let newest: string | undefined;
    for (const live of this.active.values()) {
      const at = live.lastEventAt;
      if (at === undefined) continue;
      if (newest === undefined || at > newest) newest = at;
    }
    return newest;
  }

  liveFor(taskId: string): AgentRun | undefined {
    for (const live of this.active.values()) {
      if (live.run.taskId === taskId && !live.settled) return live.run;
    }
    return undefined;
  }

  /**
   * Snapshot for the loopback companion UI — active runs and any pending approval request id.
   * Question text is not stored on the live run; the companion shows a generic prompt.
   */
  companionSnapshot(): readonly {
    runId: string;
    taskId: string;
    status: string;
    approvalRequestId?: string;
    allowOptionId?: string;
  }[] {
    const rows: {
      runId: string;
      taskId: string;
      status: string;
      approvalRequestId?: string;
      allowOptionId?: string;
    }[] = [];
    for (const live of this.active.values()) {
      if (live.settled) continue;
      rows.push({
        runId: live.run.id,
        taskId: live.run.taskId,
        status: live.run.status,
        ...(live.approval !== undefined
          ? {
              approvalRequestId: live.approval.requestId,
              allowOptionId: live.approval.allowOptionIds[0],
            }
          : {}),
      });
    }
    return rows;
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

    // Collaboration: the active participant's harness/host, not always the task's defaults.
    const participant = activeParticipant(task);
    if (
      participant !== undefined &&
      participant.kind === "peer" &&
      participant.hostId !== "local" &&
      input.forceLocalPeer !== true
    ) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        `Participant “${participant.id}” runs on another machine. Offer the turn with coder.offerParticipantRun.`,
        ref("error.collaboration.notPeer", { id: participant.id }),
      );
    }

    const runHarness = harnessForRun(task);
    const runHostId = hostIdForRun(task);

    const requested = input.model ?? task.model;
    // A shipped agent, or a provider the user added. The resolvers below only know the nine.
    const shipped = isHarnessId(runHarness) ? runHarness : undefined;
    // Envoy Harness has no model until Settings saves one. An empty picker, or a leftover catalogue
    // choice for a different provider, uses that saved model so the key and base URL travel with it.
    const model =
      shipped === "envoy-harness" ? envoyRunModel(this.deps.paths, requested) : requested;
    // **Checked before anything is spawned.** A mode the agent cannot accept has two possible
    // outcomes and only one of them is honest: refuse the call, or start an agent in a posture the
    // user did not ask for. The second is not a smaller version of the first — a user who chose
    // `plan` and got an unrestricted agent has been told something false about what is running.
    const requestedMode = input.agentModeId ?? task.agentModeId;
    if (!shipped) await ensureRunnableAgent(this.deps.store, runHarness);
    const provider = shipped ? undefined : findRunnableProvider(this.deps.store, runHarness);
    // OMP approval levels travel as `--approval-mode` at spawn, not `session/set_mode` — resolve
    // against the catalogue modes without claiming `capabilities.agentMode`.
    let agentModeId: string | undefined;
    if (shipped === "omp") {
      const modes = harnessDefinition("omp").modes.map((mode) => mode.id);
      if (requestedMode !== undefined && !modes.includes(requestedMode)) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          `OMP does not offer a mode called "${requestedMode}", so the run was not started. Pick one of its modes and try again.`,
          ref("error.agentModeUnknown", { harness: "OMP (Oh My Pi)", mode: requestedMode }),
        );
      }
      agentModeId = requestedMode;
    } else {
      agentModeId = shipped
        ? resolveAgentMode(shipped, requestedMode)
        : resolveCataloguedProviderMode(provider, requestedMode);
    }
    // Settings Off for agents without `session/set_policy`: force their published unattended mode
    // (Claude `bypassPermissions`, Codex `agent-full-access`, DeepSeek Full access via env). Envoy
    // Harness stays on the chosen sandbox and only changes `autoRun` below. OMP Asking Off selects
    // Full access → `--approval-mode yolo` via `askingOffLaunchArgs` below.
    if (this.settings().requireApprovalForDestructive === false) {
      if (shipped === "omp") {
        agentModeId = "full";
      } else if (shipped) {
        const unattended = modeForAskingOff(shipped);
        if (unattended !== undefined) agentModeId = unattended;
      } else {
        // Catalogue YOLO / Full modes (Gemini, Qwen, …) — same Settings Off posture as shipped.
        const unattended = cataloguedUnattendedModeId(provider?.catalogEntryId ?? provider?.id);
        if (unattended !== undefined) agentModeId = unattended;
      }
    }
    // A permission level is not `session/set_mode`. DeepSeek takes it as `DSH_PERMISSION_MODE` on the
    // process; Envoy Harness takes it as `session/set_policy`. `default` / `plan` / `review` stay on
    // `session/set_mode`, and those runs still get the settings switch as `autoRun`.
    const permissionEnv = shipped ? modeLaunchEnv(shipped, agentModeId) : undefined;
    const permissionPolicy = shipped
      ? envoyPermissionPolicy(
          shipped,
          agentModeId,
          this.settings().requireApprovalForDestructive,
        )
      : undefined;
    const planMode = task.planMode === true || (shipped === "envoy-harness" && requestedMode === "plan");
    // Catalogue providers with documented modes use `session/set_mode` directly (modeToSet = agentModeId).
    const modeToSet = shipped
      ? collaborationModeToSet(shipped, agentModeId, planMode)
      : agentModeId;
    // The model, on exactly the same terms and for a failure that is easier to miss: `envoy-harness`
    // parses `--model` whether or not `--provider` is there and *then ignores it*
    // (`../envoy-harness/packages/envoy-harness/src/cli/run/acp.ts:99-111`), so a model we could not
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
    const modelConfig = shipped ? resolveModelDelivery(shipped, model) : undefined;
    // The thinking level, on the same terms and with an extra one recorded below: the *value* is not
    // checked against anything we have seen, because the observed list is a record of an earlier
    // session and the agent is the authority on what it currently accepts.
    const thinkingLevel = input.thinkingLevel ?? task.thinkingLevel;
    const thinkingConfig = shipped ? resolveThinkingDelivery(shipped, thinkingLevel) : undefined;
    /**
     * Whether this agent asks before destructive actions — the app setting, resolved for *this* agent.
     *
     * Read from the settings the daemon owns rather than from the caller, because it is not a property
     * of the run: `requireApprovalForDestructive` is the user's decision about this machine, and a task
     * started from the phone or from a second window has to be governed by the same one.
     * `undefined` for an agent with no `session/set_policy` — deliberately not a refusal, for the
     * reasons `resolveApprovalPolicy` records, and disclosed on screen by the settings row instead.
     *
     * A provider has no catalogue `approvalPolicy` claim, so it is treated like any shipped agent that
     * lacks the method: the setting is left alone, and Safety names that the switch does not reach it.
     * Inventing `safe-only` here would either break agents that reject `session/set_policy`, or pretend
     * EnvoyDev enforced a gate it never sent.
     *
     * **Domain preset (Mobile / Web):** when the task stores `domainPreset` and Full access is *not*
     * the permission level, send `{ preset }` so envoy-harness unlocks `device_*` / `browser_*` and
     * expands writable roots. Full access already unlocks those tools via `danger-full-access`; a
     * named preset would also reset the sandbox to `workspace-write`, so it is skipped then.
     * Settings Asking Off co-sends `autoRun: "off"` in the same `set_policy` call.
     * Plan mode is a separate axis (`session/set_mode`): the harness keeps domain roots under
     * plan/review read-only, so Tools=Mobile/Web still unlocks those tools while planning.
     */
    const domainPolicy =
      shipped && agentModeId !== "danger-full-access"
        ? envoyDomainPresetPolicy(shipped, task.domainPreset)
        : undefined;
    const basePolicy: AcpSessionPolicy | undefined =
      permissionPolicy ??
      (shipped
        ? resolveApprovalPolicy(shipped, this.settings().requireApprovalForDestructive)
        : undefined);
    const sessionPolicy: AcpSessionPolicy | undefined = domainPolicy
      ? {
          preset: domainPolicy.preset,
          ...(basePolicy?.autoRun !== undefined ? { autoRun: basePolicy.autoRun } : {}),
        }
      : basePolicy;
    // Asking Off launch argv: Cursor `--force`, OMP `--approval-mode yolo`.
    // OMP with Settings On still maps a catalogue mode id (full/write/ask) to approval argv.
    const askingLaunch =
      shipped && this.settings().requireApprovalForDestructive === false
        ? askingOffLaunchArgs(shipped)
        : shipped === "omp" && agentModeId
          ? ompApprovalLaunchArgs(agentModeId)
          : [];
    const launchExtraArgs = [...askingLaunch, ...(task.extraArgs ? [task.extraArgs] : [])]
      .join(" ")
      .trim();
    // RPC resume must be in spawn argv (`--session`); resolve before launch. ACP resumes over the protocol.
    const previousRunId = task.runId;
    const resumeSessionId =
      shipped && harnessTransport(shipped) === "rpc-ui"
        ? await this.sessionToResume(task.id, input.resume === true, previousRunId)
        : undefined;
    const launch =
      shipped && this.deps.resolveLaunch
        ? this.deps.resolveLaunch({
            harness: shipped,
            cwd: task.cwd,
            ...(launchExtraArgs ? { extraArgs: launchExtraArgs } : {}),
            ...(model ? { model } : {}),
            ...(permissionEnv ? { extraEnv: permissionEnv } : {}),
            ...(resumeSessionId ? { resumeSessionId } : {}),
          })
        : // **The same function the probe and sign-in call** (`launchForAgent`): a shipped id goes to
          // `launchForHarness`, an added provider to `launchForProvider`.
          launchForAgent({
            id: runHarness,
            ...(provider !== undefined ? { provider } : {}),
            cwd: task.cwd,
            paths: this.deps.paths,
            ...(this.deps.platform ? { platform: this.deps.platform } : {}),
            ...(launchExtraArgs ? { extraArgs: launchExtraArgs } : {}),
            ...(shipped && model ? { model } : {}),
            ...(shipped && this.deps.deliveryOf ? { delivery: this.deps.deliveryOf(shipped) } : {}),
            ...(permissionEnv ? { extraEnv: permissionEnv } : {}),
            ...(resumeSessionId ? { resumeSessionId } : {}),
          });

    const runId = randomUUID();
    const file = transcriptFile(this.deps.paths.transcriptsDir, runId);
    const run: AgentRun = {
      id: runId,
      taskId: task.id,
      harness: runHarness,
      ...(model ? { model } : {}),
      // Only when the agent accepted it, which `resolveThinkingDelivery` has just established: a run
      // that named a level the agent refused never gets here, so this field cannot claim one.
      ...(thinkingConfig && thinkingLevel ? { thinkingLevel } : {}),
      hostId: runHostId,
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
      transcriptBytes: 0,
      seq: 0,
      client: undefined,
      launch,
      sessionConfigs: [
        // Model first: an agent derives its thinking levels from the model it has resolved.
        ...(modelConfig ? [modelConfig] : []),
        ...(thinkingConfig && thinkingLevel ? [{ ...thinkingConfig, value: thinkingLevel }] : []),
        // Plan, when this agent accepts it. Fast is remembered and not sent — see features.ts.
        ...(shipped
          ? featureSessionConfigs(shipped, model, {
              ...(task.fastMode !== undefined ? { fastMode: task.fastMode } : {}),
              ...(task.planMode !== undefined ? { planMode: task.planMode } : {}),
            })
          : []),
      ],
      sessionPolicy,
      turn: undefined,
      queued: [],
      intent: "none",
      approval: undefined,
      approvalChain: Promise.resolve(),
      // Host auto-allow: Cursor `--force` / OpenCode session-auto / OMP yolo defense-in-depth.
      ...(shipped &&
      this.settings().requireApprovalForDestructive === false &&
      (askingControl(shipped) === "launch-force" ||
        askingControl(shipped) === "session-auto" ||
        askingControl(shipped) === "launch-approval")
        ? { sessionAutoAllow: true }
        : {}),
      stderr: [],
      settled: false,
      touchedFiles: new Map(),
      lastContextUsed: undefined,
      lastContextSize: undefined,
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
    // Collaboration handoff: name the transfer on the run that follows it so the transcript shows it.
    const handoff = task.collaboration?.lastHandoff;
    if (handoff !== undefined && participant !== undefined && handoff.toId === participant.id) {
      await this.record(live, {
        kind: "run.handoff",
        ...(handoff.fromId !== undefined ? { fromId: handoff.fromId } : {}),
        toId: handoff.toId,
        role: participant.role,
        ...(handoff.brief !== undefined && handoff.brief !== "" ? { brief: handoff.brief } : {}),
      });
    }
    // Echo the opening prompt into the transcript. Follow-ups go through `send()` which records
    // `run.message`; without this, a startRun's words reach the agent but never the chat UI.
    // Prefer `displayPrompt` / strip plan-first framing so the chat never shows host instructions.
    if (input.prompt.trim() !== "") {
      const shown = (() => {
        const display = input.displayPrompt?.trim();
        if (display !== undefined && display !== "") return display;
        return stripPlanFirstFraming(input.prompt);
      })();
      await this.record(live, {
        kind: "run.message",
        text: shown,
        mode: "steer",
        delivered: "steered",
      });
    }

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
      events: events.slice(-this.eventLimit),
      // A recalled run is finished: nothing will be appended, so an unmeasured size cannot let one grow.
      transcriptBytes: 0,
      seq,
      client: undefined,
      launch: { command: "", args: [], cwd: "" },
      sessionConfigs: [],
      sessionPolicy: undefined,
      turn: undefined,
      queued: [],
      intent: "none",
      approval: undefined,
      approvalChain: Promise.resolve(),
      stderr: [],
      settled: true,
      touchedFiles: new Map(),
      lastContextUsed: undefined,
      lastContextSize: undefined,
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
      const harnessId = live.run.harness;
      const useRpc =
        isHarnessId(harnessId) && harnessTransport(harnessId) === "rpc-ui";
      const sharedCallbacks = {
        launch: live.launch,
        onUpdate: (update: AcpUpdate) => this.onUpdate(live, update),
        onPermissionRequest: (request: AcpPermissionRequest) =>
          this.onPermissionRequest(live, request),
        onStderr: (line: string) => {
          live.stderr = [...live.stderr.slice(-20), line];
        },
        ...(resumeSessionId ? { resumeSessionId } : {}),
        ...(agentModeId ? { agentModeId } : {}),
        ...(live.sessionConfigs.length > 0 ? { sessionConfigs: live.sessionConfigs } : {}),
        ...(live.sessionPolicy ? { sessionPolicy: live.sessionPolicy } : {}),
      };
      // Stop before spawn — do not pay Cursor's authenticate after the user already asked to leave.
      if (isCancelIntent(live)) {
        await this.finish(live, "cancelled", null);
        return;
      }
      const client: RunAgentClient = useRpc
        ? await JsonlRpcAgentClient.start({
            ...sharedCallbacks,
            // OMP negotiates protocol v2 when advertised; Pi waits for ready only.
            negotiateOmp: harnessId === "omp",
          })
        : await startClient({
            ...sharedCallbacks,
            onUserQuestion: (request) => this.onUserQuestion(live, request),
            // Cursor's authenticate alone was measured at ~90 s when already logged in; the default
            // 30 s handshake is what users read as "did not answer authenticate / session/new".
            ...(live.launch.authMethodId !== undefined
              ? { handshakeTimeoutMs: ACP_AUTH_HANDSHAKE_TIMEOUT_MS }
              : {}),
            // So Stop during authenticate can tear down before `start` returns.
            onClient: (started) => {
              live.client = started;
              // Cancel landed in the sync gap before this callback, or while we were constructing.
              if (isCancelIntent(live)) started.cancel();
            },
            // Only when a real `authenticate` runs (not Copilot terminal-auth). Phone otherwise looks hung.
            onAuthenticating: async () => {
              if (isCancelIntent(live)) return;
              await this.record(live, {
                kind: "run.status",
                status: "running",
                note: keyed(
                  "run.auth.waiting",
                  "Signing in to the agent… This can take about a minute, even when you are already logged in.",
                ),
              });
            },
          });
      live.client = client;

      // Stop landed while connect/handshake was in flight — never start the first turn.
      // Read through a helper so TS does not narrow `live.intent` for the loop below: cancel can
      // still arrive between turns after this check (same reason `takeIntent` exists).
      if (isCancelIntent(live)) {
        await this.finish(live, "cancelled", null);
        return;
      }

      // **Only for a session we opened.** A resume is answered with less — both native harnesses reply
      // to `session/resume` with little more than the session id — so recording it would replace a full
      // option list with an empty one, which on screen is the difference between a picker and "this
      // agent offers nothing". The condition is `resumeSessionId`, which is also exactly when
      // `AcpClient` called `session/new` rather than `session/resume`.
      if (resumeSessionId === undefined) await this.recordSessionOptions(live, client);
      const catalogResume =
        isHarnessId(live.run.harness) && harnessDefinition(live.run.harness).capabilities.resume;
      // RPC synthetic `rpc-…` ids are not `--session`-safe; catalogue resume alone would lie.
      const sessionResumable =
        catalogResume &&
        (client instanceof JsonlRpcAgentClient ? client.sessionResumable : true);
      // Only remember ids we can actually rejoin — a synthetic fallback must not poison Resume.
      if (client.sessionId !== undefined) {
        this.rememberSession(live.run.taskId, client.sessionId, sessionResumable);
      }
      await this.record(live, {
        kind: "run.session",
        sessionId: client.sessionId ?? "unknown",
        // A capability we record from the protocol the agent speaks, never a guess about this
        // particular run: an agent with no `session/resume` says so here.
        resumable: sessionResumable,
        resumed: resumeSessionId !== undefined,
      });

      let prompt = firstPrompt;
      let images = firstImages;
      /** Same-session re-prompts after harness `max_iterations` (Codex-style keep-going). */
      let hostContinues = 0;
      /** Consecutive `session/prompt` throws — caps recovery so a dead process cannot burn the queue. */
      let promptFailures = 0;
      for (;;) {
        // Stop between turns (including before the first) — do not prompt again.
        if (isCancelIntent(live)) {
          await this.finish(live, "cancelled", null);
          return;
        }
        try {
          // Clear per-attempt flags. Do *not* reset retriableLeakRetries here — a same-prompt
          // recovery `continue`s into this block, and wiping the counter would retry forever.
          live.retriableLeakSeen = false;
          live.assistantKeptCharsThisTurn = 0;
          live.toolsSettledThisTurn = false;
          live.toolRunnerBlipThisTurn = false;
          live.turn = client.prompt(prompt, images);
          const result = await live.turn;
          live.turn = undefined;
          promptFailures = 0;

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
          // Cursor ACP: RetriableError / WritableIterable / Service temporarily unavailable leaked
          // as assistant text + end_turn.
          //   * Real answer already kept → strip only (retry would duplicate the reply).
          //   * Tools already settled, no answer → strip only + note (retry would re-run Shell).
          //   * No answer and no tools → same-session re-prompt with a short pause.
          // Read through helpers so TS does not narrow flags set asynchronously in onUpdate.
          const stopForRecovery =
            result.stopReason === "end_turn" || result.stopReason === "max_tokens";
          if (sawRetriableLeak(live) && stopForRecovery) {
            const hadAnswer = assistantKeptThisTurn(live) > 0;
            const toolsSettled = toolsSettledThisTurn(live);
            if (hadAnswer) {
              live.retriableLeakSeen = false;
            } else if (toolsSettled) {
              live.retriableLeakSeen = false;
              await this.record(live, {
                kind: "run.status",
                status: "running",
                note: keyed(
                  "run.retriableLeak.afterTools",
                  "The agent’s connection dropped after tools ran. Send a follow-up to continue — tools were not re-run.",
                ),
              });
            } else if ((live.retriableLeakRetries ?? 0) < MAX_RETRIABLE_LEAK_RETRIES) {
              live.retriableLeakSeen = false;
              live.retriableLeakRetries = (live.retriableLeakRetries ?? 0) + 1;
              if (next !== undefined) live.queued.unshift(next);
              await this.record(live, {
                kind: "run.status",
                status: "running",
                note: keyed(
                  "run.retriableLeak.retrying",
                  "The agent’s connection dropped mid-reply. Retrying…",
                ),
              });
              if ((await sleepUnlessCancelled(live, RETRIABLE_LEAK_RETRY_DELAY_MS)) === "cancel") {
                await this.finish(live, "cancelled", null);
                return;
              }
              // Retry the same user prompt — do not advance to the queued follow-up yet.
              continue;
            } else {
              if (next !== undefined) live.queued.unshift(next);
              const dropped = live.queued.length;
              live.queued = [];
              await this.record(live, {
                kind: "run.status",
                status: "failed",
                note: retriableLeakFailedNote(dropped),
              });
              await this.finish(live, "failed", null);
              return;
            }
          }
          // Tool-runner blip (unavailable Shell/Read) with no usable answer — re-prompt so tools
          // can run again. Skip when a real tool already settled this turn (same as afterTools).
          if (
            toolRunnerBlipThisTurn(live) &&
            !toolsSettledThisTurn(live) &&
            assistantKeptThisTurn(live) === 0 &&
            stopForRecovery
          ) {
            if ((live.retriableLeakRetries ?? 0) < MAX_RETRIABLE_LEAK_RETRIES) {
              live.retriableLeakRetries = (live.retriableLeakRetries ?? 0) + 1;
              if (next !== undefined) live.queued.unshift(next);
              await this.record(live, {
                kind: "run.status",
                status: "running",
                note: keyed(
                  "run.toolRunner.retrying",
                  "A tool briefly failed. Retrying…",
                ),
              });
              if ((await sleepUnlessCancelled(live, RETRIABLE_LEAK_RETRY_DELAY_MS)) === "cancel") {
                await this.finish(live, "cancelled", null);
                return;
              }
              continue;
            }
            if (next !== undefined) live.queued.unshift(next);
            const dropped = live.queued.length;
            live.queued = [];
            await this.record(live, {
              kind: "run.status",
              status: "failed",
              note: toolRunnerFailedNote(dropped),
            });
            await this.finish(live, "failed", null);
            return;
          }
          // A successful (or strip-only) turn restores the per-turn retry budget for the next prompt.
          live.retriableLeakRetries = 0;
          if (next) {
            prompt = next.text;
            images = next.images;
            continue;
          }
          // Harness spent its internal phases — keep the ACP session and ask it to finish, instead of
          // ending the run and hoping the user narrows the prompt (Codex/Claude keep going).
          if (
            result.stopReason === "max_iterations" &&
            hostContinues < MAX_HOST_CONTINUES
          ) {
            hostContinues++;
            await this.record(live, {
              kind: "run.status",
              status: "running",
              note: `Continuing after iteration budget (${hostContinues}/${MAX_HOST_CONTINUES})…`,
            });
            await this.compactBeforeContinue(live, client);
            prompt = HOST_CONTINUE_PROMPT;
            images = undefined;
            continue;
          }
          if (result.stopReason === "max_iterations") {
            await this.record(live, {
              kind: "run.status",
              status: "failed",
              note: keyed(
                "run.stop.maxIterations",
                "The agent used its full iteration budget without finishing.",
              ),
            });
            await this.finish(live, "failed", null);
            return;
          }
          if (result.stopReason === "refusal") {
            // Without this note the transcript only shows the generic end line — no reason.
            await this.record(live, {
              kind: "run.status",
              status: "failed",
              note: keyed(
                "run.stop.refusal",
                "The agent declined to continue with this request.",
              ),
            });
            await this.finish(live, "failed", null);
            return;
          }
          // Auth-tax agents (Cursor): keep the process after a clean `end_turn` so the next chat
          // message does not pay another authenticate. `max_tokens` still ends — the turn was cut
          // short, and "waiting for your next message" would mislabel an incomplete answer.
          // Stop or idle timeout still tear down.
          if (result.stopReason === "end_turn" && live.launch.authMethodId !== undefined) {
            // `idle` (not `running`): the turn is over. Composer must not show "Will send when the
            // agent finishes this reply" / a Working peek over a finished turn — that made Cursor
            // keep-alive look stuck. Session stays live for sendToRun until timeout or Stop.
            await this.setStatus(live, "idle");
            await this.record(live, {
              kind: "run.status",
              status: "idle",
              note: keyed(
                "run.idle.waiting",
                "Reply finished. Send another message whenever you’re ready — the session stays open so the next reply is fast.",
              ),
            });
            const waited = await waitForQueueOrIdle(
              live,
              this.deps.idleKeepAliveMs ?? IDLE_KEEPALIVE_MS,
            );
            // Re-check cancel after the wait: send may have woken us, then Stop cleared the queue.
            if (waited === "cancel" || isCancelIntent(live)) {
              await this.finish(live, "cancelled", null);
              return;
            }
            if (waited === "queue") {
              const followUp = live.queued.shift();
              if (followUp !== undefined) {
                await this.setStatus(live, "running");
                prompt = followUp.text;
                images = followUp.images;
                continue;
              }
            }
            await this.finish(live, "done", null);
            return;
          }
          await this.finish(live, statusForStopReason(result.stopReason), null);
          return;
        } catch (error) {
          // Some agents reject the in-flight prompt when cancel lands, instead of resolving
          // `stopReason: cancelled`. Treat Stop as cancelled; after a steer (or a single transport
          // blip with a queued follow-up), try one recovery delivery — never walk the whole queue
          // against a dead process.
          live.turn = undefined;
          const intent = takeIntent(live);
          const next = live.queued.shift();
          if (intent === "cancel") {
            await this.finish(live, "cancelled", null);
            return;
          }
          // Cursor ACP sometimes throws the same RetriableError instead of leaking it as text.
          if (isAcpRetriableLeakError(error)) {
            if (toolsSettledThisTurn(live)) {
              // Tools already ran — do not same-prompt retry (would re-run Shell).
              await this.record(live, {
                kind: "run.status",
                status: "running",
                note: keyed(
                  "run.retriableLeak.afterTools",
                  "The agent’s connection dropped after tools ran. Send a follow-up to continue — tools were not re-run.",
                ),
              });
              live.retriableLeakRetries = 0;
              if (next !== undefined) {
                prompt = next.text;
                images = next.images;
                continue;
              }
              await this.finish(live, "done", null);
              return;
            }
            if ((live.retriableLeakRetries ?? 0) < MAX_RETRIABLE_LEAK_RETRIES) {
              live.retriableLeakRetries = (live.retriableLeakRetries ?? 0) + 1;
              if (next !== undefined) live.queued.unshift(next);
              await this.record(live, {
                kind: "run.status",
                status: "running",
                note: keyed(
                  "run.retriableLeak.retrying",
                  "The agent’s connection dropped mid-reply. Retrying…",
                ),
              });
              if ((await sleepUnlessCancelled(live, RETRIABLE_LEAK_RETRY_DELAY_MS)) === "cancel") {
                await this.finish(live, "cancelled", null);
                return;
              }
              continue;
            }
          }
          promptFailures += 1;
          if (next !== undefined && promptFailures <= 1) {
            live.retriableLeakRetries = 0;
            prompt = next.text;
            images = next.images;
            continue;
          }
          if (next !== undefined) live.queued.unshift(next);
          const dropped = live.queued.length;
          live.queued = [];
          const note = isAcpRetriableLeakError(error)
            ? retriableLeakFailedNote(dropped)
            : dropped > 0
              ? `${describeFailure(error, live)} ${dropped} queued follow-up${dropped === 1 ? " was" : "s were"} not sent.`
              : describeFailure(error, live);
          await this.record(live, { kind: "run.status", status: "failed", note });
          await this.finish(live, "failed", null);
          return;
        }
      }
    } catch (error) {
      // Stop during connect beats a handshake error — the user asked for cancelled, not failed.
      if (isCancelIntent(live)) {
        live.queued = [];
        await this.finish(live, "cancelled", null);
        return;
      }
      // Handshake / client start failed — same honesty as a mid-turn prompt failure: say how many
      // follow-ups never left the queue (send is allowed while connect is still in flight).
      const dropped = live.queued.length;
      live.queued = [];
      const message = describeFailure(error, live);
      const note =
        dropped > 0
          ? `${message} ${dropped} queued follow-up${dropped === 1 ? " was" : "s were"} not sent.`
          : message;
      await this.record(live, { kind: "run.status", status: "failed", note });
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
  private async recordSessionOptions(live: LiveRun, client: RunAgentClient): Promise<void> {
    // The catalogue's observation mapper only knows the nine. A provider's session still ran;
    // its model list stays unknown until a probe written for that id exists.
    if (!isHarnessId(live.run.harness)) return;
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
        const raw = textOf(update.content);
        if (raw === "") return;
        // Cursor ACP can append RetriableError / WritableIterable as if it were the answer.
        const { kept, leaked } = stripAcpRetriableLeak(raw);
        if (leaked) live.retriableLeakSeen = true;
        if (kept === "") return;
        live.assistantKeptCharsThisTurn = (live.assistantKeptCharsThisTurn ?? 0) + kept.length;
        void this.record(live, {
          kind: "run.output",
          stream: "assistant",
          text: kept,
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
        const name = typeof update.title === "string" && update.title !== "" ? update.title : "tool";
        const kind = typeof update.kind === "string" ? update.kind : undefined;
        const input = update.rawInput !== undefined ? update.rawInput : undefined;
        this.noteTouchedFile(live, name, kind, input);
        void this.record(live, {
          kind: "run.tool",
          callId: String(update.toolCallId ?? ""),
          name,
          status: "running",
          ...(input !== undefined ? { input } : {}),
        });
        return;
      }
      case "tool_call_update": {
        const callId = String(update.toolCallId ?? "");
        // A terminal update often carries no title; recover the start's name so a late path in
        // content still counts toward `run.diff`.
        const name = this.toolName(live, callId) ?? "";
        const input = this.toolInput(live, callId);
        this.noteTouchedFile(live, name, undefined, input);
        // Cursor puts Shell/Read results on `rawOutput` ({stdout,stderr,exitCode}) and leaves
        // `content` empty — valid ACP. Prefer non-empty content; else take rawOutput.
        const payload = toolPayloadFromAcpUpdate({
          content: update.content,
          rawOutput: update.rawOutput,
        });
        const statusRaw = typeof update.status === "string" ? update.status : undefined;
        const runnerBlip = isAcpToolRunnerFailure(payload);
        // in_progress / pending must stay "running" — treating them as completed made empty
        // shells look finished before a later rawOutput/content frame.
        if ((statusRaw === "in_progress" || statusRaw === "pending") && !runnerBlip) {
          void this.record(live, {
            kind: "run.tool",
            callId,
            name: "",
            status: "running",
            ...(payload !== undefined ? { output: payload } : {}),
          });
          return;
        }
        const failed = statusRaw === "failed" || runnerBlip;
        const terminal: "failed" | "completed" = failed ? "failed" : "completed";
        if (runnerBlip) {
          // Fake "completed" with unavailable text is not a settle — retry may re-run Shell.
          live.toolRunnerBlipThisTurn = true;
        } else {
          // Real terminal settle blocks leak-only retry.
          live.toolsSettledThisTurn = true;
        }
        if (payload === undefined && !live.loggedEmptyToolContent) {
          live.loggedEmptyToolContent = true;
          process.stderr.write(
            "acp tool_call_update completed without content or rawOutput\n",
          );
        }
        void this.record(live, {
          kind: "run.tool",
          callId,
          name: "",
          status: terminal,
          ...(payload !== undefined ? { output: payload } : {}),
        });
        return;
      }
      case "usage_update": {
        if (typeof update.used === "number") live.lastContextUsed = update.used;
        if (typeof update.size === "number") live.lastContextSize = update.size;
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
      case "plan":
      case "plan_update":
      case "plan_removed": {
        const parsed = parseAcpPlanUpdate(update);
        if (parsed === undefined) return;
        void this.record(live, {
          kind: "run.plan",
          planId: parsed.planId,
          entries: parsed.entries,
          ...(parsed.markdown !== undefined ? { markdown: parsed.markdown } : {}),
          ...(parsed.removed === true ? { removed: true } : {}),
        });
        return;
      }
      default: {
        // A kind this build does not render is dropped rather than guessed at. Showing a user raw
        // JSON for an unknown payload is worse than showing nothing. Log once per kind per run so
        // Cursor dialect drift is visible in the daemon log without flooding it.
        const label = kind === "" ? "(missing)" : kind;
        const seen = live.ignoredSessionUpdates ?? new Set<string>();
        live.ignoredSessionUpdates = seen;
        if (!seen.has(label)) {
          seen.add(label);
          process.stderr.write(`acp sessionUpdate ignored: ${label}\n`);
        }
        return;
      }
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
    return this.enqueueApproval(live, () => this.handlePermissionRequest(live, request));
  }

  private handlePermissionRequest(
    live: LiveRun,
    request: AcpPermissionRequest,
  ): Promise<string | null> {
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
      // Session-scoped stop-asking — allow without a card for the rest of this run.
      if (live.sessionAutoAllow === true) {
        const choice = allowChoiceId(request.options);
        if (choice !== undefined) return choice;
      }
      // Durable Guardian — auto-allow clear non-destructive reads only.
      if (this.settings().approvalsReviewer === "guardian" && guardianMayAutoAllow(request)) {
        const choice = allowChoiceId(request.options);
        if (choice !== undefined) {
          // Audit trail: resolved with by=guardian so the transcript shows what was auto-allowed
          // without opening a card (no live.approval, no needs-attention flicker).
          void this.record(live, {
            kind: "run.approval-resolved",
            requestId,
            optionId: choice,
            by: "guardian",
          });
          return choice;
        }
      }
      return this.askPermission(live, request, requestId, key);
    });
  }

  /** One card at a time — a second permission/question waits until the first settle clears the slot. */
  private enqueueApproval<T>(live: LiveRun, work: () => Promise<T>): Promise<T> {
    const run = live.approvalChain.then(work, work);
    live.approvalChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
    const step = approvalSubject(
      request.args ?? this.toolInput(live, request.toolCall?.toolCallId ?? ""),
    );
    return new Promise<string | null>((resolve) => {
      const settle = (choice: string | AcpUserQuestionChoice | null): void => {
        if (live.approval?.requestId !== requestId) return;
        live.approval = undefined;
        const optionId = typeof choice === "string" ? choice : choice?.optionIds?.[0];
        void (async () => {
          // Cursor/ACP "Always allow" is only as durable as the agent makes it. Mirror it
          // on the host for the rest of this run so the next tool does not pop another card
          // — including requests we cannot key for project memory.
          if (optionId !== undefined && choiceIsAllowAlways(request.options, optionId)) {
            live.sessionAutoAllow = true;
          }
          // Project memory: exact command/path for Allow once or Always (existing contract).
          if (optionId !== undefined && key !== undefined && choiceAllows(request.options, optionId)) {
            await rememberCommand(this.deps.paths.stateDir, live.launch.cwd, key);
          }
          if (typeof choice === "string") resolve(choice);
          else resolve(choice?.optionIds?.[0] ?? null);
        })();
      };
      live.approval = {
        requestId,
        settle,
        allowOptionIds: options.filter((option) => option.destructive !== true).map((option) => option.id),
      };

      void (async () => {
        await this.setStatus(live, "needs-attention");
        await this.record(live, {
          kind: "run.approval-requested",
          requestId,
          // The family's wording rule: the headline is what is about to happen, in the user's words.
          // ACP gives us a tool id and the agent's own label for the call; "the agent is asking" is
          // the part that is always true, so it is what the card leads with when there is no label.
          // Lead with the concrete command or path when we have one — the tool id is secondary.
          question:
            step !== undefined
              ? keyed("approval.question.step", `Allow “${step}”?`, { step })
              : named
                ? keyed("approval.question.tool", `Allow the agent to run “${named}”?`, { tool: named })
                : keyed("approval.question.generic", "Allow the agent to continue?"),
          detail:
            step !== undefined
              ? keyed(
                  "approval.detail.remember",
                  "Allowing this step lets it run again in this project without asking.",
                )
              : keyed(
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
    return this.enqueueApproval(live, () => this.handleUserQuestion(live, request));
  }

  private handleUserQuestion(
    live: LiveRun,
    request: AcpUserQuestion,
  ): Promise<AcpUserQuestionChoice | null> {
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
    // Headline vs body — never concatenate a keyed hint onto the body: localizeText would keep the
    // key and drop the plan. The pick/type hint is selection-keyed and the window renders it.
    const { question: head, body, kind } = splitAskPrompt(prompt);
    const question =
      kind === "plan-review"
        ? head !== ""
          ? head
          : keyed("approval.question.planReview", "Implement this plan?")
        : head !== ""
          ? head
          : keyed("approval.question.ask", "The agent asked a question.");
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
      // Questions never offer stop-asking — only permission allows may flip the machine setting.
      live.approval = { requestId, settle, allowOptionIds: [] };
      void (async () => {
        await this.setStatus(live, "needs-attention");
        await this.record(live, {
          kind: "run.approval-requested",
          requestId,
          question,
          ...(body !== undefined && body !== "" ? { detail: body } : {}),
          options,
          selection: many ? ("many" as const) : text ? ("text" as const) : ("one" as const),
          ...(text && request.multiline === true ? { multiline: true } : {}),
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

  /**
   * Remember a path a write/edit tool named, for one `run.diff` at the end of the turn.
   *
   * Line counts stay 0 when we only know the path — the transcript headline is the file count, and
   * inventing added/removed from the tool args would be a guess dressed as a diff.
   */
  private noteTouchedFile(live: LiveRun, name: string, kind: string | undefined, input: unknown): void {
    if (!isFileMutatingTool(name, kind)) return;
    const path = pathFromToolInput(input);
    if (path === undefined) return;
    if (live.touchedFiles.has(path)) return;
    live.touchedFiles.set(path, { added: 0, removed: 0 });
  }

  /* ────────────────────────────── control ────────────────────────────── */

  /**
   * Compact the ACP session when context is full (or unknown) before a host continue.
   *
   * Agents without `session/compact` refuse — that is a skip, not a failed run.
   */
  private async compactBeforeContinue(
    live: LiveRun,
    client: { compact: (options?: { keep?: number }) => Promise<void> },
  ): Promise<void> {
    const used = live.lastContextUsed;
    const size = live.lastContextSize;
    const ratio =
      used !== undefined && size !== undefined && size > 0 ? used / size : undefined;
    // Unknown usage after a long tool run still warrants a compact: better a shorter
    // transcript than another budget cliff. Known low fill skips the round trip.
    if (ratio !== undefined && ratio < HOST_CONTINUE_COMPACT_RATIO) return;
    try {
      await client.compact({ keep: 8 });
      await this.record(live, {
        kind: "run.status",
        status: "running",
        note:
          ratio !== undefined
            ? `Compacted context (${Math.round(ratio * 100)}% full) before continuing.`
            : "Compacted context before continuing.",
      });
    } catch {
      // Method missing or agent refusal — continue without compact.
    }
  }

  /**
   * Say something to a run that is already going.
   *
   * `queue` waits for the turn in flight; `steer` interrupts it. See the module doc for why those
   * are the two things the protocol can actually do — and note that both are *delivered*, so neither
   * mode silently drops a message.
   *
   * While an approval or question is open, **queue still lands** (Codex-style async ask): the words
   * wait until the card is answered, then become the next prompt. Steer is refused — interrupting
   * mid-approval would race the agent's permission waiter.
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
    // Stop already requested — do not append a ghost user line that cancel will drop.
    if (live.intent === "cancel" || live.run.status === "cancelled") {
      throw coderError(
        ENVOYDEV_ERRORS.harnessFailed,
        "That run is stopping, so there is nothing to send to it. Start a new task instead.",
        ref("error.runFinished"),
      );
    }
    // Only Envoy / DeepSeek may steer — other agents' cancel often rejects `session/prompt`
    // and the UI shows “Stopped before it finished.” Daemon gate so mobile Settings cannot bypass.
    const effective: RunMode =
      mode === "steer" && followUpMustQueue(live.run.harness) ? "queue" : mode;
    if (live.approval && effective === "steer") {
      throw coderError(
        ENVOYDEV_ERRORS.harnessFailed,
        "The agent is waiting for an answer before it can go on. Answer that first — interrupting now would race the prompt it is blocked on.",
        ref("error.approvalPending"),
      );
    }

    live.queued.push({
      text,
      mode: effective,
      ...(images !== undefined && images.length > 0 ? { images } : {}),
    });
    // Wake an idle keep-alive waiter so the next turn starts without waiting for the timeout.
    wakeQueue(live);
    const delivered = effective === "steer" ? "steered" : "queued";
    await this.record(live, { kind: "run.message", text, mode: effective, delivered });

    if (effective === "steer") {
      // Interrupt the turn in flight. The reply arrives as `cancelled`, and the loop above then sends
      // this message as the next prompt — which is what "join the turn" means when the protocol has
      // one prompt in flight at a time. While idle keep-alive (no turn), only enqueue + wake — do not
      // `session/cancel` with nothing in flight.
      live.intent = "steer";
      if (live.turn !== undefined) live.client?.cancel();
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
    // Idle keep-alive must not wait out the full timeout after Stop.
    wakeQueue(live);
    await this.setStatus(live, "cancelled");
    return true;
  }

  /** Answer the approval or question this run is blocked on. */
  async answerApproval(
    runId: string,
    requestId: string,
    optionId: string | undefined,
    extra?: {
      optionIds?: readonly string[];
      text?: string;
      stopAsking?: boolean;
      stopAskingScope?: "session" | "machine";
    },
  ): Promise<boolean> {
    const live = this.active.get(runId);
    if (!live?.approval || live.approval.requestId !== requestId) return false;
    const ids = extra?.optionIds && extra.optionIds.length > 0 ? [...extra.optionIds] : optionId !== undefined ? [optionId] : [];
    const text = extra?.text?.trim() ?? "";
    const primary = ids[0] ?? (text !== "" ? text : undefined);
    if (primary === undefined) return false;
    // RPC/mesh can send stopAsking with any choice; only an allow may flip asking off.
    // Settle the approval first — a Settings write must not strand the run on needs-attention.
    const shouldStopAsking =
      extra?.stopAsking === true && live.approval.allowOptionIds.includes(primary);
    const scope = extra?.stopAskingScope === "session" ? "session" : "machine";
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
    if (shouldStopAsking) {
      try {
        if (scope === "session") {
          live.sessionAutoAllow = true;
        } else {
          await this.stopAskingApprovals(live);
        }
      } catch {
        // Allow already took; surface that the machine flip did not stick.
        await this.record(live, {
          kind: "run.output",
          stream: "stderr",
          text: "Could not turn off asking for this agent. Use Settings → Ask before risky steps, or pick a Full access / YOLO mode.",
          messageId: `stop-asking-fail-${requestId}`,
        }).catch(() => undefined);
      }
    }
    return true;
  }

  /**
   * Flip the machine setting off and push `autoRun: off` onto this live session.
   * Only for agents that accept an approval policy (`capabilities.approvalPolicy`).
   * Best-effort on the live push: a refusal still leaves Settings off for the next run.
   */
  private async stopAskingApprovals(live: LiveRun): Promise<void> {
    const harness = live.run.harness;
    if (isHarnessId(harness)) {
      if (askingControl(harness) === "none") {
        throw new Error("asking-unsupported");
      }
    } else {
      const provider = findRunnableProvider(this.deps.store, harness);
      const unattended = cataloguedUnattendedModeId(provider?.catalogEntryId ?? provider?.id ?? harness);
      if (unattended === undefined) {
        throw new Error("asking-unsupported");
      }
    }
    try {
      await this.deps.store.updateSettings({ requireApprovalForDestructive: false });
    } catch {
      // Disk write failed — still try the live session below.
    }
    await this.applyAskingOffToLive(live);
  }

  /**
   * Settings turned Off while runs are live — stop asking on every open session that can hear it.
   *
   * Policy agents get `autoRun: off`. Unattended-mode agents get `session/set_mode` when the mode
   * is not a permission level delivered only at process start (DeepSeek). Best-effort per run.
   */
  async applyAskingOff(): Promise<void> {
    for (const live of this.active.values()) {
      await this.applyAskingOffToLive(live);
    }
  }

  private async applyAskingOffToLive(live: LiveRun): Promise<void> {
    const harness = live.run.harness;
    if (!isHarnessId(harness)) {
      const provider = findRunnableProvider(this.deps.store, harness);
      const mode = cataloguedUnattendedModeId(provider?.catalogEntryId ?? provider?.id ?? harness);
      if (mode === undefined) return;
      try {
        await live.client?.applySessionMode(mode);
      } catch {
        // Next run still starts in YOLO from Settings Off.
      }
      return;
    }
    const via = askingControl(harness);
    if (via === "policy") {
      const next: AcpSessionPolicy = { autoRun: "off" };
      try {
        await live.client?.applySessionPolicy(next);
        live.sessionPolicy = { ...(live.sessionPolicy ?? {}), ...next };
      } catch {
        // Next Envoy Harness run still starts with autoRun off from Settings.
      }
      return;
    }
    if (via === "launch-force" || via === "session-auto" || via === "launch-approval") {
      // Cannot change OpenCode policy / OMP approval-mode / Cursor --force mid-process.
      // Host auto-allow covers the rest of this run; the next spawn carries the launch wire.
      live.sessionAutoAllow = true;
      return;
    }
    if (via !== "unattended-mode") return;
    const mode = modeForAskingOff(harness);
    if (mode === undefined || isPermissionModeId(mode)) return;
    try {
      await live.client?.applySessionMode(mode);
    } catch {
      // Next run starts in the unattended mode from Settings Off.
    }
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
      // Same as `cancel`: auth-tax idle keep-alive sits in `waitForQueueOrIdle` — without a wake
      // the idle timer holds the event loop for up to 10 minutes and then `finish`es as "done".
      live.intent = "cancel";
      wakeQueue(live);
      // Eager status so listTasks does not keep saying "running" through shutdown.
      await this.setStatus(live, "cancelled").catch(() => undefined);
      await live.client?.stop().catch(() => undefined);
    }
    const settled = Promise.allSettled(running.map((live) => live.done));
    // `Promise.race` does not cancel the loser, and an outstanding timer keeps the event loop alive: without the
    // `clearTimeout` below, every stop looked like a ten-second hang *after* the runs were already done.
    let deadline: NodeJS.Timeout | undefined;
    await Promise.race([
      settled,
      new Promise<void>((resolve) => {
        deadline = setTimeout(resolve, 10_000);
      }),
    ]);
    if (deadline !== undefined) clearTimeout(deadline);
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
    if (live.events.length > this.eventLimit) {
      // Drop from the front: the newest events are the ones a client is waiting for.
      live.events.splice(0, live.events.length - this.eventLimit);
    }
    live.lastEventAt = full.at;
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
    const line = `${JSON.stringify(event)}\n`;
    /**
     * **A transcript's two structural lines are never refused: `run.started` and `run.ended`.**
     *
     * Everything between them is the *record* — what the agent said and did — and the cap exists to bound that.
     * These two are not record, they are the frame, and dropping either makes the file lie:
     *
     *   * no `run.ended` → `agentRunFromTranscript` reports the run as **failed**, so a run that finished comes back
     *     after a restart looking like it crashed, with nothing to tell the two apart;
     *   * no `run.started` → it reports **no run at all**, because a transcript it cannot place is not one.
     *
     * Both were real: exempting only the ending left a file with an ending and no beginning, which `recall()`
     * silently ignored. The residual is honest and worth naming: a capped transcript carries no marker saying it was
     * capped, so a reader cannot tell "trimmed" from "a run that produced almost nothing" — the notice at the
     * crossing goes to the daemon's log, which is where the truncation can be seen.
     */
    const mustWrite = event.kind === "run.started" || event.kind === "run.ended";
    if (!mustWrite && live.transcriptBytes + line.length > this.transcriptLimitBytes) {
      // Once, at the crossing — not once per event afterwards, which would fill the log it is complaining in.
      if (live.transcriptBytes <= this.transcriptLimitBytes) {
        live.transcriptBytes = this.transcriptLimitBytes + line.length;
        process.stderr.write(
          `transcript for run ${live.run.id} reached ${Math.round(this.transcriptLimitBytes / (1024 * 1024))} MB ` +
            "and is no longer being written; the run itself continues\n",
        );
      }
      return;
    }
    try {
      await mkdir(this.deps.paths.transcriptsDir, { recursive: true });
      await appendFile(file, line, "utf8");
      live.transcriptBytes += line.length;
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
    // Before the ending: one summary of files write tools named. Absent when nothing mutated a path
    // we could read — a silent run is better than a zero-file "diff" pretending to be news.
    if (live.touchedFiles.size > 0) {
      await this.record(live, {
        kind: "run.diff",
        files: [...live.touchedFiles.entries()].map(([path, counts]) => ({
          path,
          added: counts.added,
          removed: counts.removed,
        })),
      });
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

  /**
   * Remember a session id for Resume only when it is actually rejoinable. Synthetic RPC
   * fallbacks (`rpc-…`) must not sit in `lastSession` or the next resume passes a dead `--session`.
   */
  private rememberSession(taskId: string, sessionId: string, resumable: boolean): void {
    if (!resumable) {
      this.lastSession.delete(taskId);
      return;
    }
    this.lastSession.set(taskId, sessionId);
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

/** Peek without resetting — and without letting TS narrow `live.intent` across awaits. */
function isCancelIntent(live: { intent: "none" | "cancel" | "steer" }): boolean {
  return live.intent === "cancel";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff that still honors Stop — do not make the user wait out the full delay. */
async function sleepUnlessCancelled(
  live: { intent: "none" | "cancel" | "steer" },
  ms: number,
): Promise<"ok" | "cancel"> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (isCancelIntent(live)) return "cancel";
    await sleep(Math.min(50, deadline - Date.now()));
  }
  return isCancelIntent(live) ? "cancel" : "ok";
}

/** Resolve an idle keep-alive waiter, if any. */
function wakeQueue(live: { queueWake?: (() => void) | undefined }): void {
  const wake = live.queueWake;
  live.queueWake = undefined;
  wake?.();
}

/**
 * After a clean turn on an auth-tax agent: wait for the next `send`, Stop, or idle timeout.
 *
 * `send` / `cancel` call {@link wakeQueue}; without that, Stop would block until the timeout.
 */
async function waitForQueueOrIdle(
  live: {
    intent: "none" | "cancel" | "steer";
    queued: unknown[];
    queueWake?: (() => void) | undefined;
  },
  ms: number,
): Promise<"queue" | "cancel" | "timeout"> {
  if (isCancelIntent(live)) return "cancel";
  if (live.queued.length > 0) return "queue";

  return await new Promise<"queue" | "cancel" | "timeout">((resolve) => {
    let settled = false;
    const finish = (result: "queue" | "cancel" | "timeout") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (live.queueWake === onWake) live.queueWake = undefined;
      // Prefer real work over a timer that fired in the same tick as send/Stop.
      if (result === "timeout") {
        if (isCancelIntent(live)) {
          resolve("cancel");
          return;
        }
        if (live.queued.length > 0) {
          resolve("queue");
          return;
        }
      }
      resolve(result);
    };
    const onWake = () => {
      if (isCancelIntent(live)) finish("cancel");
      else if (live.queued.length > 0) finish("queue");
      // Spurious wake with neither cancel nor queue — treat as cancel so we do not sit forever.
      else finish("cancel");
    };
    live.queueWake = onWake;
    const timer = setTimeout(() => finish("timeout"), ms);
    // Race: enqueue/cancel between the empty check and registration.
    if (isCancelIntent(live)) finish("cancel");
    else if (live.queued.length > 0) finish("queue");
  });
}

function sawRetriableLeak(live: { retriableLeakSeen?: boolean }): boolean {
  return live.retriableLeakSeen === true;
}

function assistantKeptThisTurn(live: { assistantKeptCharsThisTurn?: number }): number {
  return live.assistantKeptCharsThisTurn ?? 0;
}

function retriableLeakFailedNote(dropped: number): string {
  if (dropped <= 0) {
    return keyed(
      "run.retriableLeak.failed",
      "The agent’s connection dropped mid-reply. Send again to retry.",
    );
  }
  if (dropped === 1) {
    return keyed(
      "run.retriableLeak.failed.queued",
      "The agent’s connection dropped mid-reply. 1 queued follow-up was not sent. Send again to retry.",
      { count: 1 },
    );
  }
  return keyed(
    "run.retriableLeak.failed.queued.many",
    "The agent’s connection dropped mid-reply. {count} queued follow-ups were not sent. Send again to retry.",
    { count: dropped },
  );
}

/** ACP's stop reason → the status the rail shows. */
function statusForStopReason(stopReason: string): TaskStatus {
  switch (stopReason) {
    case "cancelled":
      return "cancelled";
    case "refusal":
    case "max_iterations":
      // Budget exhaustion after the harness's continuation phases — unfinished, not "Finished."
      return "failed";
    default:
      // `end_turn` and `max_tokens` both mean the turn is over and nothing went wrong. `max_tokens`
      // is unfinished work rather than a failure, and the note on the run says which it was.
      return "done";
  }
}

/**
 * The text of an ACP content value, or `""`.
 *
 * Accepts a string, a single `{ type: "text", text }`, or an **array** of those (joined). Image and
 * audio blocks are ignored — a stringified object in the transcript is worse than a gap.
 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => textOf(part)).join("");
  }
  if (typeof content !== "object" || content === null) return "";
  const block = content as { type?: unknown; text?: unknown };
  return block.type === "text" && typeof block.text === "string" ? block.text : "";
}

function toolsSettledThisTurn(live: { toolsSettledThisTurn?: boolean }): boolean {
  return live.toolsSettledThisTurn === true;
}

function toolRunnerBlipThisTurn(live: { toolRunnerBlipThisTurn?: boolean }): boolean {
  return live.toolRunnerBlipThisTurn === true;
}

function toolRunnerFailedNote(dropped: number): string {
  if (dropped <= 0) {
    return keyed(
      "run.toolRunner.failed",
      "A tool hit a temporary outage. Send again to retry — or switch agent to avoid Cursor’s tool runner.",
    );
  }
  if (dropped === 1) {
    return keyed(
      "run.toolRunner.failed.queued",
      "A tool hit a temporary outage. 1 queued follow-up was not sent. Send again to retry — or switch agent.",
    );
  }
  return keyed(
    "run.toolRunner.failed.queued.many",
    "A tool hit a temporary outage. {count} queued follow-ups were not sent. Send again to retry — or switch agent.",
    { count: dropped },
  );
}

function describeFailure(error: unknown, live: LiveRun): string {
  return describeRunFailure(error, live.stderr.slice(-2).join(" · "));
}
