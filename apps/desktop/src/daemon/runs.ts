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
 * policy (`docs/envoycoder-ui.md` §5).
 *
 * ## One run per task
 *
 * A second `startRun` on a task that is already running is **refused**, not queued: two agents
 * editing one working tree is the failure a control plane exists to prevent. The refusal names the
 * way to send a message to the run that is already going.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  type AgentRun,
  type CoderSettings,
  ENVOYCODER_ERRORS,
  type HarnessId,
  type RunEvent,
  type RunMode,
  type TaskStatus,
  coderError,
} from "@envoycoder/protocol";
import { harnessDefinition, isDrivableByAcpAdapter, probeHarness, resolveHarnessCommand } from "@envoycoder/agent-catalog";
import type { PlatformId } from "@envoycoder/platform";

import type { CoderPaths } from "@envoycoder/host-bridge";

import { AcpClient, type AcpLaunch, type AcpPermissionRequest, type AcpUpdate } from "./acp/client.js";
import type { CoderStore } from "./store.js";

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
  }) => AcpLaunch;
  /** Which platform's argv and spawn rules to use, so the Windows branch is testable. */
  platform?: PlatformId;
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
  /** The turn currently in flight, so `send` can tell "queued" from "steered". */
  turn: Promise<{ stopReason: string }> | undefined;
  /** Messages the user sent, oldest first. */
  queued: { text: string; mode: RunMode }[];
  /** Why the turn in flight was interrupted — the difference between `cancel` and `steer`. */
  intent: "none" | "cancel" | "steer";
  /** The approval the run is blocked on, if any. */
  approval: { requestId: string; settle: (optionId: string | null) => void } | undefined;
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
        ENVOYCODER_ERRORS.taskMissing,
        `There is no task called "${input.taskId}", so there is nowhere to run an agent.`,
      );
    }
    if (this.liveFor(input.taskId)) {
      throw coderError(
        ENVOYCODER_ERRORS.harnessFailed,
        `"${task.title}" is already running. Send it a message instead — starting a second agent in one directory is how two of them come to edit the same file.`,
      );
    }

    const model = input.model ?? task.model;
    const launch = this.deps.resolveLaunch
      ? this.deps.resolveLaunch({
          harness: task.harness,
          cwd: task.cwd,
          ...(task.extraArgs ? { extraArgs: task.extraArgs } : {}),
          ...(model ? { model } : {}),
        })
      : this.launchFromCatalogue(task.harness, task.cwd, model, task.extraArgs);

    const run: AgentRun = {
      id: randomUUID(),
      taskId: task.id,
      harness: task.harness,
      ...(model ? { model } : {}),
      hostId: task.hostId ?? "local",
      startedAt: this.now(),
      status: "running",
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

    await this.deps.store.setTaskRun(task.id, { runId: run.id, status: "running" });
    await this.record(live, {
      kind: "run.started",
      harness: run.harness,
      ...(run.model ? { model: run.model } : {}),
      hostId: run.hostId,
    });

    // The turn runs in the background: `coder.startRun` answers as soon as the run *exists*, so the
    // UI renders a task starting rather than blocking until it finishes.
    void this.drive(live, input.prompt, input.resume === true);
    return run;
  }

  /** The argv from the catalogue, plus the environment an agent needs to keep its own state. */
  private launchFromCatalogue(
    harness: HarnessId,
    cwd: string,
    model: string | undefined,
    extraArgs: string | undefined,
  ): AcpLaunch {
    // Probe first, then build: where the agent *is* and what argv it understands are different
    // questions, and the answers differ for a harness living in a peer checkout — there the command
    // is Node and the script is the first argument. Assuming a bare binary name is how a machine with
    // the harness cloned but not installed gets `spawn envoy-harness ENOENT`.
    const probe = probeHarness(harness, this.deps.platform ? { platform: this.deps.platform } : {});
    if (!probe.available) {
      throw coderError(ENVOYCODER_ERRORS.harnessMissing, probe.reason ?? `${harness} is not available on this machine.`);
    }
    // **Installed is not drivable.** This method returns an `AcpLaunch`, and the ACP client then speaks
    // `initialize` / `session/new` to whatever it spawned. Six catalogue entries describe programs that
    // do not speak ACP (a one-shot `-p` CLI, an app-server, an HTTP server, a JSONL-RPC mode), so
    // without this check we would spawn them and wait for a handshake that can never come — after the
    // picker had already offered them as ready. Refusing here, by name and with the reason, is the same
    // fail-closed choice the rest of this daemon makes.
    if (!isDrivableByAcpAdapter(harness)) {
      const label = harnessDefinition(harness).label;
      throw coderError(
        ENVOYCODER_ERRORS.harnessUnsupported,
        `${label} speaks a protocol EnvoyCoder cannot drive yet (this adapter drives ACP agents only). ` +
          `Envoy Harness and DeepSeek Harness work today; ${label} needs its own adapter.`,
      );
    }
    const resolved = resolveHarnessCommand(
      harness,
      probe,
      { prompt: "", cwd, ...(model ? { model } : {}), ...(extraArgs ? { extraArgs } : {}) },
    );
    const definition = harnessDefinition(harness);
    return {
      command: resolved.command,
      args: resolved.args,
      cwd,
      ...(definition.id === "deepseek-harness"
        ? {
            // A home of our own per agent, so EnvoyCoder never writes into the state a user's own
            // `dsh` install owns — and so sessions the control plane starts are separable from the
            // ones they started by hand.
            env: { DSH_HOME: join(this.deps.paths.stateDir, "agents", "dsh") },
          }
        : {}),
    };
  }

  /* ────────────────────────────── the turn loop ────────────────────────────── */

  /**
   * Run turns until there is nothing left to say.
   *
   * The loop is the composer's two modes made concrete. Each iteration sends one prompt; when it
   * returns, either the user interrupted (so the run ends unless a `steer` is waiting), or a queued
   * message takes over as the next turn, or the run finishes.
   */
  private async drive(live: LiveRun, firstPrompt: string, resume: boolean): Promise<void> {
    const startClient = this.deps.startClient ?? AcpClient.start;
    try {
      const resumeSessionId = resume ? this.lastSession.get(live.run.taskId) : undefined;
      const client = await startClient({
        launch: live.launch,
        onUpdate: (update) => this.onUpdate(live, update),
        onPermissionRequest: (request) => this.onPermissionRequest(live, request),
        onStderr: (line) => {
          // Kept, bounded, and never printed: it is what explains a failure the protocol reported as
          // one sentence, and a chatty agent must not become a memory leak in a long-lived daemon.
          live.stderr = [...live.stderr.slice(-20), line];
        },
        ...(resumeSessionId ? { resumeSessionId } : {}),
      });
      live.client = client;

      if (client.sessionId) this.lastSession.set(live.run.taskId, client.sessionId);
      await this.record(live, {
        kind: "run.session",
        sessionId: client.sessionId ?? "unknown",
        // A capability we record from the protocol the agent speaks, never a guess about this
        // particular run: an agent with no `session/resume` says so here.
        resumable: harnessDefinition(live.run.harness).capabilities.resume,
        resumed: resumeSessionId !== undefined,
      });

      let prompt = firstPrompt;
      for (;;) {
        live.turn = client.prompt(prompt);
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
   * (`docs/envoycoder-ui.md` §4).
   */
  private onPermissionRequest(live: LiveRun, request: AcpPermissionRequest): Promise<string | null> {
    const requestId = request.toolCall?.toolCallId ?? randomUUID();
    const options = (request.options ?? []).map((option, index) => ({
      id: typeof option.optionId === "string" && option.optionId !== "" ? option.optionId : `option-${index}`,
      label: typeof option.name === "string" && option.name !== "" ? option.name : `Option ${index + 1}`,
      // The protocol's own vocabulary says which choice refuses. Guessing from the label would paint
      // "Deny" as a neutral button for the one agent that words it differently.
      destructive: option.kind === "reject_once" || option.kind === "reject_always",
    }));

    const toolName = this.toolName(live, requestId);
    return new Promise<string | null>((resolve) => {
      const settle = (optionId: string | null): void => {
        if (live.approval?.requestId !== requestId) return;
        live.approval = undefined;
        resolve(optionId);
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
          question: toolName ? `Allow the agent to run “${toolName}”?` : "Allow the agent to continue?",
          detail:
            "It has stopped before this step and will not continue until you answer. Answering this one request does not allow anything else.",
          options,
        });
      })();
    });
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
  async send(runId: string, text: string, mode: RunMode): Promise<"queued" | "steered"> {
    const live = this.active.get(runId);
    if (!live || live.settled) {
      throw coderError(
        ENVOYCODER_ERRORS.harnessFailed,
        "That run has already finished, so there is nothing to send to it. Start a new task instead.",
      );
    }
    if (live.approval) {
      // Queueing behind an approval prompt strands the message: the prompt must be answered before
      // anything else can happen, and the user would be waiting on words the agent never received.
      throw coderError(
        ENVOYCODER_ERRORS.harnessFailed,
        "The agent is waiting for an answer before it can go on. Answer that first — a message sent now would sit behind it.",
      );
    }

    live.queued.push({ text, mode });
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

  /** Answer the approval this run is blocked on. */
  async answerApproval(runId: string, requestId: string, optionId: string): Promise<boolean> {
    const live = this.active.get(runId);
    if (!live?.approval || live.approval.requestId !== requestId) return false;
    const settle = live.approval.settle;
    await this.record(live, { kind: "run.approval-resolved", requestId, optionId, by: "you" });
    await this.setStatus(live, "running");
    settle(optionId);
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
    await this.record(live, { kind: "run.ended", exitCode, status });
    await this.deps.store.setTaskRun(live.run.taskId, { status });
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
