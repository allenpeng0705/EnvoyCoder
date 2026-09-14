/**
 * The Agent Client Protocol client: how EnvoyCoder drives an agent.
 *
 * ## Why ACP, and why one client is enough
 *
 * ACP is a JSON-RPC session lifecycle over stdio — `initialize`, `session/new`, `session/prompt`,
 * `session/cancel`, `session/resume`, `session/close` — with `session/update` for streaming and
 * `session/request_permission` for approvals. Both of our native harnesses speak it
 * (`envoy-harness run --acp`, `dsh --profile acp`), and several external CLIs do too, so this one
 * client covers them. That is the whole point of the catalogue recording a *dialect* rather than a
 * client class per agent (`docs/envoycoder-harness.md` §2), and it is why an agent that merely
 * "probably works" is not added here: `capabilities.approvals` is a statement about the protocol we
 * actually speak.
 *
 * ## The wire, as observed rather than assumed
 *
 * Newline-delimited JSON in both directions. Verified against the real binary before this file was
 * written — `dsh --profile acp` answers
 * `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"deepseek-harness-acp",…}}}`
 * to `initialize`, and `session/new` returns `{sessionId, configOptions}`. The shapes this client
 * normalizes are cited from the harness's own source in `runs.ts`.
 *
 * ## Three rules the harness's own documentation imposes
 *
 *   1. **stdout is the protocol.** Never attach a logger to the child's stdout; a stray line is a
 *      protocol error, not a log entry. Diagnostics go to stderr, which is why `onStderr` exists and
 *      why it is never parsed.
 *   2. **The child's working directory *is* the task's root.** `dsh` treats the invoking directory as
 *      its own workspace root, so `cwd` is not a convenience — passing the wrong one runs the agent
 *      in the wrong repository (`docs/envoycoder-harness.md` §4).
 *   3. **Teardown is stdin EOF → SIGTERM → SIGKILL**, in that order, because a harness that is told
 *      its input ended can flush a session; one that is killed cannot.
 *
 * ## What this file does not decide
 *
 * Which agent, which arguments, which environment — that is the catalogue's job
 * (`@envoycoder/agent-catalog`), and it arrives here as a launch description. A client that knew
 * about `dsh` would have to be forked for the next agent, which is exactly the fork the catalogue
 * exists to prevent.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";

/** How to start the agent. Built by the catalogue; never guessed here. */
export interface AcpLaunch {
  command: string;
  args: readonly string[];
  /** The task's working directory, which the agent treats as its workspace root. */
  cwd: string;
  env?: Record<string, string>;
}

/** One `session/update` payload, as this client understands it. */
export interface AcpUpdate {
  sessionUpdate: string;
  [key: string]: unknown;
}

/** One `session/request_permission` payload. */
export interface AcpPermissionRequest {
  sessionId: string;
  toolCall?: { toolCallId?: string; title?: string; kind?: string };
  options?: readonly { optionId?: string; name?: string; kind?: string }[];
}

export interface AcpClientOptions {
  launch: AcpLaunch;
  /** Streaming updates, in arrival order. */
  onUpdate?: (update: AcpUpdate) => void;
  /**
   * An approval the agent is blocked on.
   *
   * Resolve with the `optionId` to choose; return `null` to answer `cancelled`, which is the
   * protocol's way of saying "no answer" and is treated by the agent as a refusal. Rejecting is not
   * an option this client offers: a throw here would leave the agent waiting forever, which is
   * strictly worse than a refusal.
   */
  onPermissionRequest?: (request: AcpPermissionRequest) => Promise<string | null>;
  /** Child stderr, line by line. Diagnostics only — never parsed, never treated as protocol. */
  onStderr?: (line: string) => void;
  /** How long a single request may take. `session/prompt` is a whole turn, so it needs a lot. */
  requestTimeoutMs?: number;
  /** Per-request budget for the handshake, which should be quick or is broken. */
  handshakeTimeoutMs?: number;
  /**
   * The agent's own mode to set once the session exists (`session/set_mode`).
   *
   * **Set after `session/new`, never in it.** `session/new` accepts a working directory and nothing
   * else about behaviour (`../envoy-harness/packages/envoy-harness/src/protocol/acp-server.ts:88-95`
   * reads `cwd` and answers `{sessionId}`), so a mode is a *second* call on a session that already
   * exists. That ordering is also why a mode change cannot retroactively apply to a run already in
   * flight: by the time the user picks another one, the session this client opened is the one it set.
   *
   * Whether the agent accepts one is the **caller's** decision, not this client's: knowing that
   * `envoy-harness` answers `session/set_mode` and `deepseek-harness` does not is a catalogue fact,
   * and a client that carried it would have to be forked for the next agent.
   */
  agentModeId?: string;
  /**
   * The agent's own session configuration to set once the session exists
   * (`session/set_config_option { sessionId, configId, value }`).
   *
   * **Where a model goes when it is not an argument.** `deepseek-harness` has no model flag: it
   * advertises its models as a standard ACP `select` option on the session it just opened and takes a
   * change through this method (`../deepseek-harness/packages/acp/acp/README.md:70,76`;
   * `.../packages/acp/acp/src/index.ts:388`). `envoy-harness`, by contrast, reads `--provider`/`--model`
   * from argv, so it never uses this.
   *
   * The **value is opaque and belongs to the agent** — `configId` and the encoding are decided in
   * `@envoycoder/agent-catalog` (see `SessionModelConfig` there) and passed through verbatim, for the
   * same reason a mode id is: a value this client prettified would be one the agent refuses, and the
   * refusals here are real — an id outside the agent's catalog comes back as `invalid params:
   * unknown model option: …`. Awaited and **not** best-effort, like `agentModeId`: a model that failed
   * to apply is invisible in the transcript, and the run would report a model it is not using.
   */
  sessionConfig?: { configId: string; value: string };
}

/** What the agent said it can do. Recorded so the run's capabilities are the agent's, not ours. */
export interface AcpAgentInfo {
  name: string;
  version: string;
  protocolVersion: number;
  /** Capability names the agent advertised, flattened for reporting. */
  capabilities: readonly string[];
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

/** A JSON-RPC failure, with the protocol's own code preserved. */
export class AcpRequestError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code: number | undefined) {
    super(message);
    this.name = "AcpRequestError";
    this.code = code;
  }
}

/** JSON-RPC `invalid params`. The only failure this client retries, and only for one reason. */
const INVALID_PARAMS = -32602;

/**
 * One agent process, and one session on it.
 *
 * Not reusable across sessions in this build: `close()` and a new instance is the honest model while
 * the only caller starts one run at a time. A pool would need a policy about *which* session a
 * message belongs to, and there is exactly one.
 */
export class AcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly options: AcpClientOptions;
  private readonly pending = new Map<number, Pending>();
  private readonly stderrLines: string[] = [];
  private nextId = 1;
  private buffer = "";
  private stopped = false;
  private exited: Promise<void>;

  private agentInfoValue: AcpAgentInfo | undefined;
  private sessionIdValue: string | undefined;

  private constructor(child: ChildProcessWithoutNullStreams, options: AcpClientOptions) {
    this.child = child;
    this.options = options;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));

    child.stderr.setEncoding("utf8");
    let stderrBuffer = "";
    child.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
      let index: number;
      while ((index = stderrBuffer.indexOf("\n")) >= 0) {
        const line = stderrBuffer.slice(0, index);
        stderrBuffer = stderrBuffer.slice(index + 1);
        if (line.trim() === "") continue;
        // Bounded, because a chatty agent must not become a memory leak in a long-lived daemon.
        if (this.stderrLines.length < 200) this.stderrLines.push(line);
        this.options.onStderr?.(line);
      }
    });

    this.exited = new Promise<void>((resolve) => {
      child.once("exit", () => {
        this.stopped = true;
        this.failAll(new Error("The agent process ended."));
        resolve();
      });
    });
    child.once("error", (error: Error) => {
      this.failAll(
        new Error(`EnvoyCoder could not start ${options.launch.command}: ${error.message}`),
      );
    });
  }

  /**
   * Start an agent and open a session.
   *
   * A `resumeSessionId` asks the agent to continue an earlier session rather than start a new one —
   * the capability the catalogue records, and the reason a task can be picked up after the app was
   * closed. When an `agentModeId` is given it is applied to whichever session we ended up with, new
   * or resumed: a resumed session carries the mode the agent last had, and the task's stored mode is
   * what the user is being promised.
   */
  static async start(
    options: AcpClientOptions & { resumeSessionId?: string },
  ): Promise<AcpClient> {
    const child = spawn(options.launch.command, [...options.launch.args], {
      cwd: options.launch.cwd,
      env: { ...process.env, ...options.launch.env },
      // stdin stays open: EOF is the *first* step of the teardown protocol, so it must be ours to
      // send rather than something a wrapper does for us.
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const client = new AcpClient(child, options);
    try {
      const info = await client.initialize();
      client.agentInfoValue = info;
      if (options.resumeSessionId) await client.resume(options.resumeSessionId);
      else await client.newSession();
      // **Order matters, and it is the agent's.** The model goes first because it is the more
      // fundamental of the two — the mode changes what the agent may *do*, the model changes what is
      // doing it — and because the method that carries it exists whether or not the agent has modes.
      // Neither call is conditional on the other: an agent can accept a model and no mode, which is
      // exactly `deepseek-harness`.
      if (options.sessionConfig) await client.setSessionConfig(options.sessionConfig);
      if (options.agentModeId) await client.setMode(options.agentModeId)
      return client;
    } catch (error) {
      // A half-started agent is a process we own and must not leak.
      await client.stop();
      throw error;
    }
  }

  get agentInfo(): AcpAgentInfo | undefined {
    return this.agentInfoValue;
  }

  get sessionId(): string | undefined {
    return this.sessionIdValue;
  }

  /** Everything the child wrote to stderr, for a failure report a user can act on. */
  recentStderr(): readonly string[] {
    return this.stderrLines;
  }

  private async initialize(): Promise<AcpAgentInfo> {
    const result = (await this.request(
      "initialize",
      {
        protocolVersion: 1,
        // Deliberately **no** filesystem capabilities. Declaring them would ask the agent to route
        // every file read through us; the agent has its own tools and its own permissions, and a
        // client that also read files would be a second, weaker sandbox to keep honest.
        clientCapabilities: {},
      },
      this.options.handshakeTimeoutMs ?? 30_000,
    )) as {
      protocolVersion?: number;
      agentInfo?: { name?: string; version?: string };
      agentCapabilities?: Record<string, unknown>;
    };

    return {
      name: result.agentInfo?.name ?? "unknown agent",
      version: result.agentInfo?.version ?? "unknown",
      protocolVersion: result.protocolVersion ?? 0,
      capabilities: result.agentCapabilities ? Object.keys(result.agentCapabilities) : [],
    };
  }

  private async newSession(): Promise<string> {
    const result = (await this.request(
      "session/new",
      // `mcpServers: []` is not decoration: the field is required, and an agent that assumed a
      // server was attached would fail later and in a less readable place.
      { cwd: this.options.launch.cwd, mcpServers: [] },
      this.options.handshakeTimeoutMs ?? 30_000,
    )) as { sessionId?: string };
    if (typeof result.sessionId !== "string" || result.sessionId === "") {
      throw new Error("The agent opened a session but did not name it, so nothing can be sent to it.");
    }
    this.sessionIdValue = result.sessionId;
    return result.sessionId;
  }

  private async resume(sessionId: string): Promise<void> {
    await this.request(
      "session/resume",
      { sessionId, cwd: this.options.launch.cwd, mcpServers: [] },
      this.options.handshakeTimeoutMs ?? 30_000,
    );
    this.sessionIdValue = sessionId;
  }

  /**
   * Put the open session into one of the agent's own modes.
   *
   * The parameter names are the agent's, not ours: `{sessionId, mode}`, with the value passed through
   * verbatim — `envoy-harness` validates it against exactly `default | plan | review`
   * (`../envoy-harness/packages/envoy-harness/src/protocol/acp-params.ts:352-375`, answering
   * `-32602 mode must be default|plan|review` for anything else), so a mode id we translated or
   * prettified would be a mode the agent refuses.
   *
   * Awaited, and **not** best-effort. A mode that failed to apply is the one failure a user cannot
   * detect by reading the transcript: the agent still answers, it just does the thing plan mode
   * exists to prevent. Throwing here fails the run, with the agent's own words, which is the only
   * outcome that does not mislead.
   */
  private async setMode(mode: string): Promise<void> {
    const sessionId = this.requireSession();
    await this.request(
      "session/set_mode",
      { sessionId, mode },
      this.options.handshakeTimeoutMs ?? 30_000,
    );
  }

  /**
   * Set one of the agent's own session configuration options — the model, for `deepseek-harness`.
   *
   * `{sessionId, configId, value}`, exactly as the agent's own dispatcher reads it
   * (`../deepseek-harness/packages/acp/acp/src/index.ts:333-340`), with the value untouched: it is an
   * *opaque* selector value owned by the agent, and the catalogue is what knows how to build one.
   *
   * Awaited rather than best-effort, for the same reason as `setMode` and with the same consequence:
   * the run fails with the agent's own sentence instead of continuing on a model nobody chose. The
   * agent's refusal is specific and readable (`unknown model option: ["x","y"]`, mapped to `invalid
   * params`), so the user learns which value was wrong rather than that "the model failed".
   */
  private async setSessionConfig(config: { configId: string; value: string }): Promise<void> {
    const sessionId = this.requireSession();
    await this.request(
      "session/set_config_option",
      { sessionId, configId: config.configId, value: config.value },
      this.options.handshakeTimeoutMs ?? 30_000,
    );
  }

  /**
   * Send one turn and wait for it to finish.
   *
   * The updates arrive through `onUpdate` while this is in flight; the promise settles when the
   * agent says the turn is over (`stopReason`), which may be `end_turn`, `max_tokens`,
   * `refusal` or `cancelled`. Those are *outcomes*, not errors — a cancelled turn is a successful
   * request that reports cancellation, and treating it as a failure would show a user an error for
   * something they asked for.
   */
  async prompt(text: string): Promise<{ stopReason: string }> {
    const sessionId = this.requireSession();
    // A turn is minutes of work, not a handshake. The timeout exists so a wedged agent does not hold
    // a run open forever; it is generous because the alternative is killing real work.
    const timeoutMs = this.options.requestTimeoutMs ?? 30 * 60_000;

    try {
      const result = (await this.request(
        "session/prompt",
        // The **standard** ACP shape: a list of content blocks.
        { sessionId, prompt: [{ type: "text", text }] },
        timeoutMs,
      )) as { stopReason?: string };
      return { stopReason: result.stopReason ?? "unknown" };
    } catch (error) {
      if (!isPromptShapeRefusal(error)) throw error;
      // The two native harnesses disagree about how a prompt is shaped, and the standard form is not
      // the one the built-in agent accepts: `envoy-harness` parses `{sessionId, text}` (or a
      // `content` block list), and rejects the standard array with `-32602 text required`
      // (`../envoy-harness/packages/envoy-harness/src/protocol/acp-params.ts:120-133`), while `dsh`
      // takes the array and not the flat string.
      //
      // Retrying is safe *here* specifically because `invalid params` is thrown by the parser, before
      // the agent has done anything — there is no half-run turn to duplicate. A retry on any other
      // failure would be exactly the kind of thing that runs a task twice.
      const result = (await this.request("session/prompt", { sessionId, text }, timeoutMs)) as {
        stopReason?: string;
      };
      return { stopReason: result.stopReason ?? "unknown" };
    }
  }

  /**
   * Ask the agent to stop the current turn.
   *
   * A **notification**, not a request — so it does not wait for a reply, and the turn's own
   * `session/prompt` resolves with `stopReason: "cancelled"`. Waiting here for confirmation would
   * deadlock against the very call being cancelled.
   */
  cancel(): void {
    const sessionId = this.sessionIdValue;
    if (!sessionId || this.stopped) return;
    this.notify("session/cancel", { sessionId });
  }

  /** Close the session politely, then the process. Safe to call more than once. */
  async stop(): Promise<void> {
    if (this.stopped) {
      await this.exited;
      return;
    }
    const child = this.child;
    try {
      if (this.sessionIdValue) {
        // Best effort and short: an agent that does not answer `session/close` still gets the
        // signal below, and a shutdown path that can hang is worse than one that is impolite.
        await this.request("session/close", { sessionId: this.sessionIdValue }, 2_000).catch(() => undefined);
      }
    } catch {
      // ignore: the teardown below is what guarantees the process goes away
    }

    // Rule 3: EOF first, so a harness can flush its session; then a signal; then nothing left.
    this.child.stdin.end();
    const gone = await Promise.race([
      this.exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!gone) {
      child.kill("SIGTERM");
      const afterTerm = await Promise.race([
        this.exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
      ]);
      if (!afterTerm) child.kill("SIGKILL");
    }
    this.stopped = true;
    await this.exited.catch(() => undefined);
    this.failAll(new Error("The agent was stopped."));
  }

  /* ────────────────────────────── the wire ────────────────────────────── */

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line === "") continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        // stdout is the protocol; a line that is not JSON is the agent's bug, and the only useful
        // thing we can do is keep the rest of the stream alive. It is recorded, not thrown.
        if (this.stderrLines.length < 200) this.stderrLines.push(`[stdout, not JSON] ${line.slice(0, 400)}`);
        continue;
      }
      void this.dispatch(message);
    }
  }

  private async dispatch(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null) return;
    const frame = message as {
      id?: number | string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code?: number; message?: string };
    };

    // A reply to something we sent.
    if (frame.id !== undefined && frame.method === undefined) {
      const key = typeof frame.id === "number" ? frame.id : Number.parseInt(String(frame.id), 10);
      const entry = this.pending.get(key);
      if (!entry) return;
      this.pending.delete(key);
      if (entry.timer) clearTimeout(entry.timer);
      if (frame.error) {
        // The code is kept, not discarded: the one retry this client makes (see `prompt`) is decided
        // on `invalid params`, and matching on the prose instead would break the day an agent
        // rewords its message.
        entry.reject(
          new AcpRequestError(frame.error.message ?? "The agent reported an error.", frame.error.code),
        );
      }
      else entry.resolve(frame.result);
      return;
    }

    // A request from the agent to us: the approval seam, and nothing else — that is the only
    // server-to-client request this client advertises support for.
    if (frame.method !== undefined && frame.id !== undefined) {
      await this.handleIncomingRequest(frame.id, frame.method, frame.params);
      return;
    }

    // A notification.
    if (frame.method === "session/update") {
      const params = frame.params as { update?: AcpUpdate } | undefined;
      if (params?.update) this.options.onUpdate?.(params.update);
      return;
    }
    // Other notifications are ignored on purpose: a client that logged every unknown method would
    // print a wall of text for each agent release, and there is nothing to act on.
  }

  private async handleIncomingRequest(id: number | string, method: string, params: unknown): Promise<void> {
    if (method !== "session/request_permission") {
      // Refusing is the protocol's answer for "I do not implement that", and it is much better than
      // silence: the agent can then decide what to do instead of waiting for a reply that never
      // comes.
      this.respondError(id, -32601, `EnvoyCoder does not handle ${method}.`);
      return;
    }

    const request = params as AcpPermissionRequest;
    try {
      const optionId = (await this.options.onPermissionRequest?.(request)) ?? null;
      if (optionId === null) {
        this.respond(id, { outcome: { outcome: "cancelled" } });
        return;
      }
      // The shape is the agent's, not ours: `{outcome: {outcome: "selected", optionId}}`
      // (`../deepseek-harness/packages/acp/acp/src/index.ts:169-172`).
      this.respond(id, { outcome: { outcome: "selected", optionId } });
    } catch (error) {
      // A throw from the answerer must still answer. Leaving the agent blocked on a request we
      // dropped is the one failure mode that looks like a hang rather than an error.
      this.options.onStderr?.(
        `the approval handler failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.respond(id, { outcome: { outcome: "cancelled" } });
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.stopped) return Promise.reject(new Error("The agent is no longer running."));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === Number.POSITIVE_INFINITY
          ? undefined
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`The agent did not answer ${method} within ${Math.round(timeoutMs / 1000)}s.`));
            }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    if (this.stopped) return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  private respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: number | string, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private write(message: unknown): void {
    if (this.child.stdin.destroyed) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private requireSession(): string {
    if (!this.sessionIdValue) throw new Error("The agent has no open session.");
    return this.sessionIdValue;
  }

  private failAll(error: Error): void {
    for (const [, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}

/**
 * Is this the "I do not read prompts shaped like that" refusal?
 *
 * Both halves are required, and both are checked: the protocol's code, and the field the agent says
 * it wanted. A bare `invalid params` on a *different* field would then not be silently retried into
 * a second, differently-wrong call.
 */
function isPromptShapeRefusal(error: unknown): boolean {
  if (!(error instanceof AcpRequestError) || error.code !== INVALID_PARAMS) return false;
  return /text|content|prompt/i.test(error.message);
}
