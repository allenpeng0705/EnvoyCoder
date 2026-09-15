/**
 * The shapes that cross the ACP boundary: what an agent is launched with, what it says, what it asks us,
 * and what it fails with.
 *
 * ## Why these are not defined beside the client that uses them
 *
 * They were, and the client grew past the family's size rule (a module under ~500 lines; past ~800,
 * split it — `AGENTS.md` §Conventions). The seam is not arbitrary: everything here is a **shape**
 * (`AcpLaunch`, `AcpUpdate`, `AcpPermissionRequest`, `AcpAgentInfo`, `AcpRequestError` and the one
 * vocabulary value `AcpAutoRunPolicy`), and nothing here runs. `client.ts` is what *does* something with
 * them — spawn, handshake, prompt, cancel, tear down — so a reader asking "what does an agent tell us?"
 * and a reader asking "how do we drive one?" now open different files, and neither has to read past the
 * other to find its answer.
 *
 * The reverse direction mattered more than tidiness: **`AcpLaunch` is the catalogue's whole channel to
 * this client.** Every fact the catalogue knows about how an agent's own protocol dialect differs —
 * `authMethodId`, `modeParam` — travels on it, which is why its two optional fields are the most-documented
 * lines in the file. A type carrying a contract with another *package* is a poor fit buried in the middle
 * of an 800-line implementation.
 *
 * `AcpClientOptions` deliberately stayed in `client.ts`: it is this client's own constructor input rather
 * than anything an agent sends or receives, and it is read by nobody else.
 *
 * `client.ts` re-exports everything here, so a caller that has always imported `AcpLaunch` or `AcpUpdate`
 * from `./acp/client.js` still can. That is not laziness — the client is the module a caller reaches for,
 * and a second import path for one type is the kind of choice that turns into two conventions.
 */

/** How to start the agent. Built by the catalogue; never guessed here. */
export interface AcpLaunch {
  command: string;
  args: readonly string[];
  /** The task's working directory, which the agent treats as its workspace root. */
  cwd: string;
  env?: Record<string, string>;
  /**
   * The ACP `authenticate` method to send after `initialize`, when the catalogue recorded one.
   *
   * Sent **between** `initialize` — where the agent advertises the methods it offers — and the session
   * that needs them, and awaited rather than best-effort: an agent that wanted authentication and did not
   * get it answers `session/new` with a refusal naming the method, and that refusal is the sentence a
   * user should read. `cursor-agent acp` is the one agent here that needs it; `AgentLaunch.authMethodId`
   * in `@envoycoder/agent-catalog` carries the evidence, including the fact that the requirement is
   * stateful, and why the *catalogue* rather than this client chooses a method.
   */
  authMethodId?: string;
  /**
   * The field name this agent's `session/set_mode` reads: the peer harness's `mode`, or the
   * specification's `modeId`.
   *
   * **Declared, never discovered.** The two contracts are cited on `AgentLaunch.modeParam` in
   * `@envoycoder/agent-catalog`, and the reason this is a fact rather than a runtime fallback is worth
   * repeating next to the field it governs: the built-in harness **accepts** a `modeId` by ignoring it and
   * answering success, so a client that "tried one and fell back on a refusal" would report a mode it
   * never applied. Absent means "nobody has read this agent's mode method", and the client refuses to send
   * one rather than guess.
   */
  modeParam?: "mode" | "modeId";
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

/** What the agent said it can do. Recorded so the run's capabilities are the agent's, not ours. */
export interface AcpAgentInfo {
  name: string;
  version: string;
  protocolVersion: number;
  /** Capability names the agent advertised, flattened for reporting. */
  capabilities: readonly string[];
  /**
   * The `authMethods` ids the agent offered in its `initialize` answer, **verbatim and in its order**.
   *
   * Recorded rather than acted on — which one to use is the catalogue's decision (`AcpLaunch.authMethodId`)
   * — so that "why did this run stop at `Authentication required`?" is a fact instead of a guess. Empty
   * for every agent that needs no authentication, which is most of them.
   */
  authMethods: readonly string[];
  /**
   * **The command to run in a terminal, per auth method**, when the agent advertises one.
   *
   * ACP's `_meta["terminal-auth"]`: Copilot's method carries `{command, args, label}` and the description *"Run
   * `copilot login` in the terminal"*, and measured on 2026-09-15 the protocol step cannot do that login for it
   * (`authenticate` → `-32000 Authentication required`, and a session still refuses). So the row needs the
   * instruction rather than a button, and this is the fact it is drawn from.
   */
  authTerminal?: ReadonlyMap<string, string>;
}

/**
 * The `autoRun` values `session/set_policy` accepts — **the peer's own vocabulary, verbatim**.
 *
 * Taken from `envoy-harness`'s parameter check, which is the contract rather than a suggestion:
 * `always-confirm` (ask before every tool), `safe-only` (auto-allow read-only tools and single safe shell
 * commands, ask for everything else) and `off` (never ask)
 * (`../envoy-harness/packages/envoy-harness/src/protocol/acp-params.ts:237-295`,
 * `.../src/permissions/auto-run.ts:1-70`). Verified against the built peer: a fresh session answers
 * `session/get_policy` with no `autoRun` at all, each of the three values is accepted and echoed back,
 * and anything else is refused `-32602 preset, sandbox, approval, or autoRun required`.
 *
 * A translated or prettified value would be refused by the agent, so this union exists to make that
 * impossible in our own types: only the catalogue's resolver builds one (`resolveApprovalPolicy`), and the
 * client passes it through untouched — the same division `agentModeId` and `sessionConfigs` follow.
 */
export type AcpAutoRunPolicy = "always-confirm" | "safe-only" | "off";

/** A JSON-RPC failure, with the protocol's own code preserved. */
export class AcpRequestError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code: number | undefined) {
    super(message);
    this.name = "AcpRequestError";
    this.code = code;
  }
}
