/**
 * The Agent Client Protocol client: how EnvoyDev drives an agent.
 *
 * ## Why ACP, and why one client is enough
 *
 * ACP is a JSON-RPC session lifecycle over stdio — `initialize`, `session/new`, `session/prompt`,
 * `session/cancel`, `session/resume`, `session/close` — with `session/update` for streaming and
 * `session/request_permission` for approvals. Both of our native harnesses speak it
 * (`envoy-harness run --acp`, `dsh --profile acp`), and several external CLIs do too, so this one
 * client covers them. That is the whole point of the catalogue recording a *dialect* rather than a
 * client class per agent (`docs/envoydev-harness.md` §2), and it is why an agent that merely
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
 *      in the wrong repository (`docs/envoydev-harness.md` §4).
 *   3. **Teardown is stdin EOF → SIGTERM → SIGKILL**, in that order, because a harness that is told
 *      its input ended can flush a session; one that is killed cannot.
 *
 * ## What this file does not decide
 *
 * Which agent, which arguments, which environment — that is the catalogue's job
 * (`@envoydev/agent-catalog`), and it arrives here as a launch description. A client that knew
 * about `dsh` would have to be forked for the next agent, which is exactly the fork the catalogue
 * exists to prevent.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";

import {
  AcpRequestError,
  type AcpAgentInfo,
  type AcpLaunch,
  type AcpSessionPolicy,
  type AcpPermissionRequest,
  type AcpUpdate,
} from "./protocol.js";
import { sessionPromptAttempts } from "./prompt-attempts.js";

// The shapes themselves live in `./protocol.ts` — see its header for why the seam is there — and are
// re-exported so that the module a caller has always reached for stays this one.
export type {
  AcpAgentInfo,
  AcpAutoRunPolicy,
  AcpLaunch,
  AcpSessionPolicy,
  AcpPermissionRequest,
  AcpUpdate,
} from "./protocol.js";
export { AcpRequestError } from "./protocol.js";

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
   * (`session/set_config_option { sessionId, configId, value }`), **in the order given**.
   *
   * **Where a model and a thinking level go when they are not arguments.** `deepseek-harness` has no
   * model flag and no effort flag: it advertises both as standard ACP `select` options on the session
   * it just opened and takes a change through this method
   * (`../deepseek-harness/packages/acp/acp/README.md:70,76`; `.../packages/acp/acp/src/index.ts:388`).
   * `envoy-harness`, by contrast, reads `--provider`/`--model` from argv and has no such method at all,
   * so it never uses this.
   *
   * The **value is opaque and belongs to the agent** — `configId` and the encoding are decided in
   * `@envoydev/agent-catalog` (see `SessionModelConfig` and `HARNESS_THINKING_DELIVERY` there) and
   * passed through verbatim, for the same reason a mode id is: a value this client prettified would be
   * one the agent refuses, and the refusals here are real — an id outside the agent's catalog comes back
   * as `invalid params: unknown model option: …`. Awaited and **not** best-effort, like `agentModeId`: a
   * model or a thinking level that failed to apply is invisible in the transcript, and the run would
   * report a posture it is not in.
   *
   * **Order is the caller's and it matters.** The thinking options an agent offers are derived from the
   * model it has resolved (`dsh-acp/lib/index.js:494-508` reads `info.reasoning` for the current route),
   * so a model must be set before a level is, and `RunManager` sends them in that order.
   */
  sessionConfigs?: readonly { configId: string; value: string }[];
  /**
   * The agent's own session policy to set once the session exists (`session/set_policy`).
   *
   * **Where "ask before anything destructive" actually lands.** The app setting is a preference; the
   * mechanism is this method on the agents that document it, and `resolveApprovalPolicy` in the daemon
   * is what turns one into the other — the client only carries the value, exactly as it does for a mode
   * or a session config. Absent means "this agent has no policy method" (or the caller had nothing to
   * say), which is the normal case for every agent but `envoy-harness`.
   *
   * Awaited rather than best-effort, like `agentModeId` and `sessionConfigs`, and for the sharper
   * version of the same reason: an approval posture that failed to apply is invisible in the
   * transcript — the agent simply stops asking, or keeps asking — and the run would report a safety
   * posture it is not in. Throwing fails the run with the agent's own words instead.
   */
  sessionPolicy?: AcpSessionPolicy;
  /**
   * Stop after `initialize`, and let the caller drive the rest — **for the two callers whose question is
   * about the agent rather than about a session.**
   *
   * A run wants the whole thing: handshake, the sign-in its entry declares, a session, the session's own
   * configuration. Two other callers want the agent:
   *
   *   * the **pre-flight probe**, whose question is "can this agent open a session here, and if not, does it
   *     want a sign-in?" — it must send nothing that changes the answer, and a declared `authMethodId` sent
   *     on its behalf would both change what it is measuring and, for a browser-login method, put a window
   *     on the user's desktop that nobody asked for;
   *   * the **sign-in flow**, which has to see the agent's own `authMethods` and send the one step itself, so
   *     that it can tell a refusal of that step from a session that still would not open.
   *
   * So the flag means exactly one thing: **send `initialize` and nothing else.** No `authenticate`, no
   * session, no configuration. The caller owns the process from then on and must stop it — which both of
   * those callers do in a `finally`.
   */
  initializeOnly?: boolean;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

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
  /** The one teardown, memoised so a second `stop()` joins it rather than racing it. See `stop`. */
  private stopping: Promise<void> | undefined;
  private exited: Promise<void>;

  private agentInfoValue: AcpAgentInfo | undefined;
  private sessionIdValue: string | undefined;
  /**
   * The `configOptions` this session has published, **verbatim and most recent**.
   *
   * The agent's own shapes, unparsed on purpose: what an option *means* is a fact about an agent's
   * protocol dialect, and `@envoydev/agent-catalog` is where that knowledge lives
   * (`parseSessionConfigOptions`). This client's only job is to not lose what it was told.
   */
  private configOptionsValue: unknown[] = [];

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

    /**
     * "The process is gone" — resolved on **either** `exit` or `close`, and the second one is not
     * redundant.
     *
     * `exit` does not fire when the spawn itself failed: Node emits `error` and then `close`, and nothing
     * else. Verified with a one-line script (`spawn("definitely-not-an-agent-binary")` prints
     * `error ENOENT` and `close`, never `exit`). So a teardown that waited only on `exit` would wait
     * forever after a bad binary — `stop()` ends in `await this.exited`, and every caller that awaits
     * `stop()` would hang with it. `close` fires in both cases, so the promise always settles and
     * "nothing to tear down" is a state this class can actually reach.
     */
    this.exited = new Promise<void>((resolve) => {
      const ended = (): void => {
        this.stopped = true;
        this.failAll(new Error("The agent process ended."));
        resolve();
      };
      child.once("exit", ended);
      child.once("close", ended);
    });
    child.once("error", (error: Error) => {
      this.failAll(
        new Error(`EnvoyDev could not start ${options.launch.command}: ${error.message}`),
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
      // **The one exit before the session.** A probe and a sign-in stop here and drive the next two steps
      // themselves; see `AcpClientOptions.initializeOnly`, which is also where the reason a probe must not
      // authenticate lives. Returning rather than throwing is deliberate: the client is started, the caller
      // owns it, and the `catch` below would have stopped the very process the caller is about to use.
      if (options.initializeOnly === true) return client;
      // **After `initialize`, before anything that touches a session** — the only order that works: the
      // agent advertises its methods in the first call and refuses `session/new` until one has been used.
      if (options.launch.authMethodId !== undefined) {
        await client.signIn(options.launch.authMethodId);
      }
      if (options.resumeSessionId) await client.resume(options.resumeSessionId);
      else await client.openSession();
      // **Order matters, and it is the agent's.** The model goes first because it is the more
      // fundamental of the two — the mode changes what the agent may *do*, the model changes what is
      // doing it, and the thinking levels an agent offers are derived from the model it resolved — and
      // because the method that carries it exists whether or not the agent has modes. Neither call is
      // conditional on the other: an agent can accept a model and no mode, which is exactly
      // `deepseek-harness`.
      for (const config of options.sessionConfigs ?? []) await client.setSessionConfig(config);
      if (options.agentModeId) await client.setMode(options.agentModeId)
      // **Last, and it is not an ordering nicety.** A mode changes what the agent may *do*; this changes
      // what it *asks about*, and the peer accepts it only while the session is idle — before the first
      // prompt, which is exactly where this is. It is also the only one of the four whose absence means
      // "leave the agent's own policy alone", so a failure here has nothing to fall back to.
      if (options.sessionPolicy) await client.setPolicy(options.sessionPolicy)
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

  /**
   * The sign-in methods the agent advertised in its `initialize` answer — **its own ids, verbatim**.
   *
   * Read by the two callers that decide what to authenticate with (`SessionProbe` and `SessionSignIn`), and
   * kept here because this object is the only thing that saw the handshake. Both start with
   * `initializeOnly`, because the decision has to be made *before* the step is sent — after a normal `start`
   * the question is already answered, one way or the other.
   *
   * Empty for every agent that needs no authentication, which is most of them — and empty is an answer
   * rather than a gap: it is what lets the daemon report "this agent refused a session and named no way to
   * sign in" instead of choosing a method for the user.
   */
  authMethods(): readonly string[] {
    return this.agentInfoValue?.authMethods ?? [];
  }

  /**
   * The session configuration options the agent has published — the most recent state it has told us,
   * verbatim.
   *
   * Two sources, and the second is not a nicety:
   *
   *   * the `session/new` response, where an agent states what it offers
   *     (`session/new` → `{sessionId, configOptions}`, `dsh-acp/lib/index.js:1170`, `:1248`);
   *   * the **result of every accepted `session/set_config_option`**, which this protocol defines as
   *     the *complete* resulting option state rather than an acknowledgement
   *     (`dsh-acp/lib/index.js:388-409` — `return (await this.state(signal)).options`). That matters
   *     because an agent builds some options from the model it has resolved: setting a model changes
   *     which thinking levels exist, so the state after a change is a better answer than the one from
   *     before it.
   *
   * What a caller does with this is the caller's decision, and `RunManager` writes an observation to the
   * daemon's state **only for a session it opened**: a resume is answered with less than `session/new`
   * was (both of ours reply with little more than a session id), and a thinner answer must not overwrite
   * the fuller one a user is looking at.
   */
  sessionConfigOptions(): readonly unknown[] {
    return this.configOptionsValue;
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
      authMethods?: unknown;
    };

    return {
      name: result.agentInfo?.name ?? "unknown agent",
      version: result.agentInfo?.version ?? "unknown",
      protocolVersion: result.protocolVersion ?? 0,
      capabilities: result.agentCapabilities ? Object.keys(result.agentCapabilities) : [],
      // Ids only, and only the strings: an entry without an id is one we could not ask for even if the
      // catalogue named it, so keeping it would be a list of things that look offerable and are not.
      authMethods: Array.isArray(result.authMethods)
        ? result.authMethods
            .map((method) =>
              typeof (method as { id?: unknown } | null)?.id === "string"
                ? ((method as { id: string }).id)
                : undefined,
            )
            .filter((id): id is string => id !== undefined)
        : [],
      /**
       * **The command an agent wants run in a terminal**, keyed by method id, when it advertises one.
       *
       * ACP lets a method carry `_meta["terminal-auth"]` — Copilot's does: `{"command": "…/copilot", "args":
       * ["login"], "label": "Copilot Login"}` beside the description *"Run `copilot login` in the terminal"*. That
       * is not decoration: measured on 2026-09-15, `authenticate {methodId: "copilot-login"}` answers `-32000
       * Authentication required` and a session still refuses, so a **Sign in** button for that agent is a press
       * that changes nothing. The command is the way in, and this is where it is picked up.
       */
      authTerminal: authTerminalCommands(result.authMethods),
    };
  }

  /**
   * **What to run in a terminal to sign this agent in**, when it says a terminal is the way.
   *
   * `undefined` for an agent whose methods are all answerable over the protocol (Cursor, both bridges) — and that
   * `undefined` is what keeps the Sign in button on their rows and off Copilot's.
   */
  authTerminalCommand(methodId?: string): string | undefined {
    const terminal = this.agentInfoValue?.authTerminal;
    if (terminal === undefined) return undefined;
    // The method `authenticate` would be sent to, when the caller names one; otherwise the only method offered.
    const wanted = methodId !== undefined ? terminal.get(methodId) : undefined;
    return wanted ?? [...terminal.values()][0];
  }

  /**
   * Authenticate with one of the methods the agent advertised.
   *
   * Public because two callers outside a run send this step themselves: `SessionSignIn`, which has to tell
   * a refusal of *this* call from a session that would not open, and nothing else. A run reaches it through
   * `start`, which sends the method its catalogue entry declares.
   *
   * `{methodId}` is ACP's shape (`agentclientprotocol.com/protocol/initialization`), and the id is the
   * agent's own — passed through verbatim, like a mode id or a session-config value, because a
   * prettified one is one the agent refuses. A caller that supplies an id **must** have taken it from
   * `authMethods()` rather than from its own parameters: this method has no way to check, and a string
   * invented by a client would reach somebody else's program.
   *
   * **Awaited, and not best-effort**, for the same reason `setMode` is: an agent that needed
   * authentication and did not get it answers `session/new` with a refusal whose sentence names the
   * method to call, and letting that be the failure means the user reads the agent's own words instead
   * of ours. A failure here also cannot be "mostly fine": every session on this process is opened after
   * it, so there is nothing to fall back to.
   */
  async signIn(methodId: string): Promise<void> {
    await this.request("authenticate", { methodId }, this.options.handshakeTimeoutMs ?? 30_000);
  }

  /**
   * Open a session on this process — the step that proves the agent will talk to us.
   *
   * Public for the same two callers as `signIn`, and it is the half that makes an auth report honest: a
   * sign-in is successful only if a session opens *afterwards*, and a probe learns "it wants a sign-in" by
   * being refused one. `start` calls it once, in the ordinary course of a run.
   */
  async openSession(): Promise<string> {
    const result = (await this.request(
      "session/new",
      // `mcpServers: []` is not decoration: the field is required, and an agent that assumed a
      // server was attached would fail later and in a less readable place.
      { cwd: this.options.launch.cwd, mcpServers: [] },
      this.options.handshakeTimeoutMs ?? 30_000,
    )) as { sessionId?: string; configOptions?: unknown };
    if (typeof result.sessionId !== "string" || result.sessionId === "") {
      throw new Error("The agent opened a session but did not name it, so nothing can be sent to it.");
    }
    this.sessionIdValue = result.sessionId;
    if (Array.isArray(result.configOptions)) this.configOptionsValue = result.configOptions;
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
   * The parameter **name** is the agent's, not ours (see `AcpLaunch.modeParam`: the peer harness reads
   * `{sessionId, mode}`, everything else reads the specification's `modeId`, and the peer *silently
   * ignores* a `modeId` rather than refusing it). The mode id is passed through verbatim, because a mode
   * id we prettified would be one the agent refuses.
   *
   * Awaited, and **not** best-effort. A mode that failed to apply is the one failure a user cannot
   * detect by reading the transcript: the agent still answers, it just does the thing plan mode
   * exists to prevent. Throwing here fails the run, with the agent's own words, which is the only
   * outcome that does not mislead.
   */
  private async setMode(mode: string): Promise<void> {
    const sessionId = this.requireSession();
    const param = this.options.launch.modeParam;
    if (param === undefined) {
      // Unreachable from a run that went through `sessionSetModeId`. A permission level is not sent
      // here — DeepSeek has no `modeParam`, and Envoy Harness refuses those ids on `session/set_mode`.
      // This throw is what is left if those two drift: a sentence, rather than a mode applied to a
      // field the agent ignores.
      throw new Error(
        "EnvoyDev does not know which parameter this agent's session/set_mode reads, so it did " +
          "not ask for a mode. The agent's catalogue entry has to record it before one can be set.",
      );
    }
    await this.request(
      "session/set_mode",
      { sessionId, [param]: mode },
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
    const result = (await this.request(
      "session/set_config_option",
      { sessionId, configId: config.configId, value: config.value },
      this.options.handshakeTimeoutMs ?? 30_000,
    )) as { configOptions?: unknown } | undefined;
    // The complete state after the change, when the agent answers with one. Recorded rather than
    // ignored: for an option that depends on the model, this is the only way to learn what the agent
    // offers *now* — see `sessionConfigOptions`.
    if (Array.isArray(result?.configOptions)) this.configOptionsValue = result.configOptions;
  }

  /**
   * Set the open session's own approval policy — whether the agent asks before it acts.
   *
   * `{sessionId, autoRun}`, the peer's own parameters: it validates the value against
   * `always-confirm | safe-only | off` and answers `-32602 preset, sandbox, approval, or autoRun
   * required` for anything else, so the value is passed through verbatim
   * (`../envoy-harness/packages/envoy-harness/src/protocol/acp-params.ts:237-295`). The peer also
   * exposes `session/get_policy` for the other direction, which is how the setting was verified against
   * the built binary rather than inferred from its source — the daemon does not call it, because a
   * policy this daemon set is one it already knows.
   *
   * **The fields that are set are the ones that are sent.** `autoRun` alone is the settings switch.
   * A permission level also sends `sandbox` and `approval`, and Full access sends `autoRun: "off"`
   * so the settings switch does not keep asking after the user chose not to be asked.
   */
  private async setPolicy(policy: AcpSessionPolicy): Promise<void> {
    const sessionId = this.requireSession();
    await this.request(
      "session/set_policy",
      {
        sessionId,
        ...(policy.sandbox !== undefined ? { sandbox: policy.sandbox } : {}),
        ...(policy.approval !== undefined ? { approval: policy.approval } : {}),
        ...(policy.autoRun !== undefined ? { autoRun: policy.autoRun } : {}),
      },
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
  async prompt(
    text: string,
    images?: readonly { mimeType: string; data: string }[],
  ): Promise<{ stopReason: string }> {
    const sessionId = this.requireSession();
    // A turn is minutes of work, not a handshake. The timeout exists so a wedged agent does not hold
    // a run open forever; it is generous because the alternative is killing real work.
    const timeoutMs = this.options.requestTimeoutMs ?? 30 * 60_000;
    // Which body goes first is `prompt-attempts.ts`. Retrying is safe because `invalid params` is
    // thrown by the parser, before the agent has done anything — there is no half-run turn to
    // duplicate. A retry on any other failure would run the task twice. A picture never falls through
    // to `{text}`: that shape would drop it.
    const attempts = sessionPromptAttempts(sessionId, text, images);

    try {
      const result = (await this.request("session/prompt", attempts.first, timeoutMs)) as {
        stopReason?: string;
      };
      return { stopReason: result.stopReason ?? "unknown" };
    } catch (error) {
      if (attempts.pictures) {
        if (!(error instanceof AcpRequestError) || error.code !== INVALID_PARAMS) throw error;
      } else if (!isPromptShapeRefusal(error)) {
        throw error;
      }
      const result = (await this.request("session/prompt", attempts.second, timeoutMs)) as {
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

  /**
   * Close the session politely, then the process. **Safe to call more than once — including twice at
   * the same moment**, which is the case this method's shape exists for.
   *
   * Two callers really do arrive together: a run's own `finally` stops the client it started, and
   * `RunManager.stopAll` stops every live client during shutdown. `stop()` used to be `async`, so each
   * caller got its own promise, each one passed the `stopped` check, and the second one sent
   * `session/close` down a stdin the first had already ended — the intermittent
   * `ERR_STREAM_WRITE_AFTER_END` this repo has seen in CI, which does not fail a test but can make the
   * vitest *process* exit 1 under load.
   *
   * So it is memoised rather than re-entrant: not an `async` method, because an `async` function wraps
   * whatever it returns in a fresh promise and the two callers would be back to having two.
   */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.teardown();
    return this.stopping;
  }

  /** The body of `stop`, run once per client. See that method for why it is behind a memo. */
  private async teardown(): Promise<void> {
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
      this.respondError(id, -32601, `EnvoyDev does not handle ${method}.`);
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

/**
 * **The terminal commands an agent advertises in `initialize`**, keyed by method id.
 *
 * `_meta["terminal-auth"]` is the only place a client learns that a login happens *outside* the protocol, and an
 * agent that says so is telling the truth: Copilot's `authenticate` answers `-32000 Authentication required` and
 * keeps refusing a session. The command is joined into the line a user would type — `pathForWire` is not applied
 * because this string is displayed and copied, not spawned by us.
 */
function authTerminalCommands(raw: unknown): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(raw)) return out;
  for (const method of raw) {
    const entry = method as { id?: unknown; _meta?: unknown } | null;
    const id = typeof entry?.id === "string" ? entry.id : undefined;
    const terminal = (entry?._meta as { "terminal-auth"?: unknown } | undefined)?.["terminal-auth"] as
      | { command?: unknown; args?: unknown }
      | undefined;
    if (id === undefined || typeof terminal?.command !== "string") continue;
    const args = Array.isArray(terminal.args) ? terminal.args.filter((a): a is string => typeof a === "string") : [];
    out.set(id, [terminal.command, ...args].join(" "));
  }
  return out;
}
