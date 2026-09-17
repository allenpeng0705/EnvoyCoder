/**
 * The wire: the envelope a client speaks, the schema of every method, and the event names.
 *
 * ## The envelope is the family's, not ours
 *
 * EnvoyDev's daemon is hosted by `@envoymesh/reuse-host`, whose transport
 * (`@envoymesh/host-connect`'s `WsServer`) already fixes the framing:
 *
 * ```
 *   request   { id, method, params }   →   response  { id, result }
 *                                      or            { id, error: { code, message } }
 *   event     { event, data }          (server → client, subscription-gated)
 * ```
 *
 * Those three shapes are declared here so the window, the phone and the tests share one
 * definition, rather than each client learning the transport's JSON by reading its source.
 * There is deliberately no second framing layer on top — Paseo nests its application traffic one
 * level deeper (`{type:"session", message}`, `packages/protocol/src/messages.ts:7260-7291`), and
 * that buys nothing here: the transport's frame is already unambiguous, and a wrapper would be one
 * more thing to keep in sync between three clients.
 *
 * ## Subscriptions are explicit
 *
 * The transport pushes nothing a client did not ask for. A client sends
 * `{ id, method: "on", params: { event: "coder:run-event" } }` — the transport's own `on`/`off`
 * methods, handled before the dispatcher — and events arrive as `{ event, data }` frames. That is
 * also how a **second window sees the first window's changes without a refresh**: both are
 * subscribed to the same broadcast.
 *
 * ## Errors are code-prefixed messages, and that is not laziness
 *
 * The family's transport derives `error.code` from a *closed catalogue* of its own tokens
 * (`@envoymesh/host-connect/src/rpc-error-code.ts:14-36`) and answers `"ERROR"` for anything else,
 * so an `envoydev.*` code cannot ride in `error.code`. It rides in the message as a leading
 * token — `"envoydev.path-missing: /x/y is gone"` — which is exactly the convention that
 * helper implements for EnvoyMesh's own catalogue. `coderError()` produces that string and
 * `coderErrorCode()` reads it back, so both ends agree by construction rather than by everyone
 * remembering the format.
 */

import { z } from "zod";

import {
  type AgentMode,
  AgentModeSchema,
  AgentProviderConfigSchema,
  type CoderSettings,
  CoderLanguageSchema,
  CoderSettingsSchema,
  ENVOYDEV_ERRORS,
  type EnvoyDevErrorCode,
  type HarnessId,
  HarnessIdSchema,
  looksLikeCredentialEnvName,
  ProjectDefaultsPatchSchema,
  RUN_MODES,
  type RunEvent,
  type RpcMethod,
  RPC_METHODS,
  TASK_STATUSES,
  type Task,
} from "./domain.js";
// The authentication facts, and the vocabulary of an attempted sign-in: one subject both this module and
// `domain.ts` read, which is why it lives in a third. See `index.ts` for the direction of that dependency.
import { type HarnessAuth, HarnessAuthSchema, SignInOutcomeSchema } from "./agent-auth.js";

/* ────────────────────────────── the envelope ───────────────────────────── */

export interface CoderRpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface CoderRpcError {
  code: string;
  message: string;
  /**
   * The catalogue key for `message`, when the failure came from a build that has one.
   *
   * **Why this field exists.** The daemon's refusals are written in English because that is the
   * language this repository is written in — and a German user looking at a German window must not
   * be answered in English by the daemon behind it. A key is the one thing both ends can agree on
   * without the daemon carrying six catalogues: the client looks it up in the language the *user*
   * chose, and falls back to `message` when the key is not one this build knows.
   *
   * The English `message` is never replaced by it — it stays the fallback and the log line, so a
   * client that ignores this field (an older build, a script) still reads a sentence.
   */
  messageKey?: string;
  /** The values the key's template needs — `{path}`, `{project}`, `{count}`. Strings and numbers only. */
  messageValues?: Record<string, string | number>;
}

/** A reply to one request. The transport sets exactly one of `result` / `error`. */
export type CoderRpcResponse =
  | { id: string; result: unknown; error?: undefined }
  | { id: string; result?: undefined; error: CoderRpcError };

/** A server-pushed event. `event` is one of `CODER_EVENTS`. */
export interface CoderEventMessage {
  event: string;
  data: unknown;
}

/** The transport's own subscription methods — handled before the dispatcher, never by it. */
export const TRANSPORT_SUBSCRIBE_METHOD = "on";
export const TRANSPORT_UNSUBSCRIBE_METHOD = "off";

/**
 * Wrap a failure so its code survives the family's transport.
 *
 * The message *is* the wire format: `<code>: <message>`. Throwing anything else loses the code —
 * the transport would answer `"ERROR"` and the client could only pattern-match on prose.
 */
export function coderError(code: EnvoyDevErrorCode, message: string, ref?: CoderMessageRef): Error {
  return new Error(withMessageRef(`${code}: ${message}`, ref));
}

/* ────────────────────────────── translatable daemon prose ───────────────────────────── */

/**
 * The key a sentence should be re-rendered with, and the values its template needs.
 *
 * Typed loosely (`key: string`) on purpose: this is wire vocabulary, and the *app* is what knows
 * which keys exist. A key this build cannot find is not an error — it is the case the English
 * `message` exists for.
 */
export interface CoderMessageRef {
  key: string;
  values?: Record<string, string | number>;
}

/**
 * The separator between a human sentence and its key.
 *
 * ## Why the key rides *inside* the string
 *
 * There is no field to put it in. The family's transport builds the error object itself —
 * `sendResponse(ws, id, undefined, { code: rpcErrorCode(message), message })`
 * (`@envoymesh/host-connect/src/ws-server.ts:1157`) — from a thrown `Error`'s `message` alone, so
 * anything else attached to the error is dropped before it reaches the socket. The message is the
 * one channel a product controls end to end, which is why the code already rides there
 * (`envoydev.path-missing: …`) and why the key rides beside it.
 *
 * So the convention is: `<code>: <english sentence> <marker> <json>`. Everything before the marker
 * is exactly the sentence a user reads today — a log line, a `toContain` assertion and a client
 * that has never heard of this convention all keep working. Only a client that knows the marker
 * ever looks past it.
 */
const MESSAGE_REF_MARKER = " [envoydev.key] ";

/** Attach a key to a sentence. Used by the daemon, and by the app for the prose it authors itself. */
export function withMessageRef(text: string, ref?: CoderMessageRef): string {
  if (!ref || ref.key === "") return text;
  const payload = JSON.stringify(ref.values ? { key: ref.key, values: ref.values } : { key: ref.key });
  return `${text}${MESSAGE_REF_MARKER}${payload}`;
}

/**
 * Split a sentence from the key that came with it.
 *
 * Two failure modes are both handled in the direction that keeps a user out of the JSON: a marker
 * with an unreadable payload, or with a payload that is not a key, yields the **sentence alone**.
 */
export function parseMessageRef(text: string): { text: string; ref?: CoderMessageRef } {
  const at = text.lastIndexOf(MESSAGE_REF_MARKER);
  if (at < 0) return { text };
  const sentence = text.slice(0, at);
  try {
    const parsed = JSON.parse(text.slice(at + MESSAGE_REF_MARKER.length)) as {
      key?: unknown;
      values?: unknown;
    };
    if (typeof parsed.key !== "string" || parsed.key === "") return { text: sentence };
    const raw = parsed.values;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const values: Record<string, string | number> = {};
      for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        // Only what a template can interpolate: a nested object would render as `[object Object]`.
        if (typeof value === "string" || typeof value === "number") values[name] = value;
      }
      return Object.keys(values).length > 0 ? { text: sentence, ref: { key: parsed.key, values } } : { text: sentence, ref: { key: parsed.key } };
    }
    return { text: sentence, ref: { key: parsed.key } };
  } catch {
    // A truncation, or a sentence that merely contains the marker. Showing the JSON would be worse
    // than showing the sentence it followed, so the tail is dropped.
    return { text: sentence };
  }
}

/** Everything a client can read out of a failed call: the code, the sentence, and the key. */
export interface ParsedCoderError {
  code: EnvoyDevErrorCode | null;
  /** The English sentence, with the code prefix and any key marker removed. */
  message: string;
  ref?: CoderMessageRef;
}

/**
 * Read a failure the way both ends agree on.
 *
 * One parser for the three things the message carries, so `coderErrorCode`, `coderErrorMessage` and
 * `coderErrorRef` cannot drift apart about where the boundaries are.
 */
export function parseCoderError(message: string): ParsedCoderError {
  const colon = message.indexOf(":");
  const head = colon > 0 ? message.slice(0, colon).trim() : "";
  const coded = colon > 0 && head.startsWith("envoydev.");
  const body = coded ? message.slice(colon + 1).trim() : message;
  const { text, ref } = parseMessageRef(body);
  return {
    code: coded ? (head as EnvoyDevErrorCode) : null,
    message: text,
    ...(ref ? { ref } : {}),
  };
}

/**
 * The error object as a *client* should read it — the shape `CoderRpcError` promises.
 *
 * A client receives `{ code, message }` from the transport (flattened, and with the key inside the
 * message). This turns it into the object with `messageKey` / `messageValues` filled in, so a
 * client never has to know the marker exists.
 */
export function readRpcError(error: { code?: string; message: string }): CoderRpcError {
  const parsed = parseCoderError(error.message);
  return {
    code: error.code ?? "ERROR",
    message: parsed.message,
    ...(parsed.ref
      ? {
          messageKey: parsed.ref.key,
          ...(parsed.ref.values ? { messageValues: parsed.ref.values } : {}),
        }
      : {}),
  };
}

/** The code a failed call carried, or `null` when it did not carry one of ours. */
export function coderErrorCode(message: string): EnvoyDevErrorCode | null {
  return parseCoderError(message).code;
}

/** The human half of a coded failure — what a UI shows once `coderErrorCode` has done its job. */
export function coderErrorMessage(message: string): string {
  return parseCoderError(message).message;
}

/** The key the daemon sent with a failure, when it sent one. */
export function coderErrorRef(message: string): CoderMessageRef | undefined {
  return parseCoderError(message).ref;
}

/* ────────────────────────────── events ───────────────────────────── */

/**
 * The daemon's broadcast vocabulary.
 *
 * Three names, one per question a client asks, because a client subscribes to what it renders:
 *
 *   * `coder:state-changed` — projects, tasks or settings changed. Deliberately carries
 *     **what** changed and not the new state: a client refetches the list it is showing, so two
 *     windows cannot disagree about ordering, and a change the client did not cause arrives in the
 *     same shape as one it did.
 *   * `coder:run-event` — one normalized run event (the union in `domain.ts`).
 *   * `coder:mesh-status` — the mesh attachment changed. The status bar is the one surface that
 *     must not wait for a poll: whether "run it on the workstation" is even possible depends on it.
 *
 * Names are `coder:`-prefixed so they cannot collide with the mesh's own vocabulary, which shares
 * the same transport.
 *
 * ## Why subscription is per-connection, not a broadcast the transport fans out
 *
 * The transport *can* fan out: a product may hand it an event-disposition table
 * (`WsServerOptions.eventDispositions`, `@envoymesh/host-connect/src/ws-server.ts:136-140`) and have
 * `nodeService.on(name, …)` wired to a broadcast loop (`ws-server.ts:471-479`). That looks like
 * exactly the right mechanism, and it is the one this project tried first.
 *
 * It does not work through the surface a product is told to use. `createReuseHost` forwards
 * `sessionIdentity`, `dispatch`, `socketMethods`, `preAuthMethods`, `transformForSession` and
 * `onListenError` into the transport — and **not** `eventDispositions`
 * (`@envoymesh/reuse-host/src/index.ts:242-252`). The symptom is quiet and misleading: the transport
 * logs `wiring 25 event dispositions` (its own core vocabulary), starts normally, serves every RPC,
 * and silently drops the product's events as though their names were typos.
 *
 * So the daemon publishes through the port that *is* forwarded: `socketMethods`, whose context hands
 * a product method the live connection and a `send(event, data)` for it
 * (`ws-server.ts:1086-1097`). `coder.subscribe` registers this connection against the daemon's own
 * bus, and pushes to that connection alone. Three consequences, all of them wanted:
 *
 *   * a client streams exactly what it renders — a phone on metered data does not receive a
 *     desktop's transcript traffic;
 *   * "did this client hear me?" is answerable per connection rather than inferred from a fan-out;
 *   * the gap is stated in one place instead of being rediscovered by the next product that needs an
 *     event. It is worth raising in EnvoyMesh: forwarding `eventDispositions` (and
 *     `loopbackOnlyMethods`) is a two-line change, and the family's guide §7.4 says contract changes
 *     go upstream rather than into a workaround.
 */
export const CODER_EVENTS = ["coder:state-changed", "coder:run-event", "coder:mesh-status"] as const;

export type CoderEventName = (typeof CODER_EVENTS)[number];

export function isCoderEventName(value: string): value is CoderEventName {
  return (CODER_EVENTS as readonly string[]).includes(value);
}

/** The method a client calls to receive `CODER_EVENTS` on its own connection. */
export const CODER_SUBSCRIBE_METHOD = "coder.subscribe";

/** What changed. `ids` names the affected entities when the emitter knows them. */
export interface CoderStateChange {
  /**
   * `harnesses` is the odd one, and it is the honest name for what changed: the **answer about an
   * agent** moved. A run that opened a session reports what that agent published about itself, so the
   * composer's options for that agent are new — and a client that refetches tasks on that event would
   * fetch the wrong list.
   */
  kind: "projects" | "tasks" | "settings" | "harnesses";
  at: string;
  ids?: readonly string[];
  /** Which window caused it, so a client can skip work it has already applied. */
  origin?: string;
}

/* ────────────────────────────── schemas for the domain ───────────────────────────── */

const TaskStatusSchema = z.enum(TASK_STATUSES);

/**
 * The defaults a **stored project** may hold — as opposed to the patch shape a write carries.
 *
 * `ProjectDefaultsPatchSchema` (the protocol's) is what `coder.updateProject` accepts, and it allows
 * `model: ""` because a control that can pick a model has to be able to clear one. The store turns
 * that into "drop the key" before writing, so a stored project never holds an empty model — which is
 * this schema's rule, and the reason the two shapes exist rather than one lenient one.
 */
const ProjectDefaultsSchema = z
  .object({
    harness: HarnessIdSchema.optional(),
    model: z.string().min(1).optional(),
    extraArgs: z.string().optional(),
  })
  .strict();

export const ProjectSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    label: z.string().min(1),
    hostId: z.string().min(1),
    addedAt: z.string(),
    defaults: ProjectDefaultsSchema.optional(),
    vcs: z
      .object({ kind: z.enum(["git", "jj", "none"]), branch: z.string().optional() })
      .strict()
      .optional(),
    tags: z.array(z.string()).readonly().optional(),
  })
  .strict();

export const TaskSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    cwd: z.string().min(1),
    title: z.string(),
    harness: HarnessIdSchema,
    model: z.string().optional(),
    agentModeId: z.string().min(1).optional(),
    thinkingLevel: z.string().min(1).optional(),
    extraArgs: z.string().optional(),
    status: TaskStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    runId: z.string().optional(),
    worktree: z.object({ path: z.string(), branch: z.string() }).strict().optional(),
    hostId: z.string().optional(),
    pinned: z.boolean().optional(),
    archivedAt: z.string().optional(),
  })
  .strict() as unknown as z.ZodType<Task>;

export const AgentRunSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    harness: HarnessIdSchema,
    model: z.string().optional(),
    thinkingLevel: z.string().min(1).optional(),
    pid: z.number().int().optional(),
    hostId: z.string().min(1),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    exitCode: z.number().int().nullable().optional(),
    status: TaskStatusSchema,
    transcriptPath: z.string().optional(),
  })
  .strict();

/**
 * The run-event union, as a schema.
 *
 * Spelled out rather than `z.custom` on purpose: the window and the phone both *validate* what
 * they render, and a client that silently accepts a malformed event renders an empty transcript
 * rather than reporting a protocol mismatch. `seq` is the one field the client depends on
 * structurally — it is how a gap is detected and a replay requested.
 */
const RunEventBase = {
  runId: z.string().min(1),
  taskId: z.string().min(1),
  at: z.string(),
  seq: z.number().int().nonnegative(),
};

export const RunEventSchema: z.ZodType<RunEvent> = z.discriminatedUnion("kind", [
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.started"),
      harness: HarnessIdSchema,
      model: z.string().optional(),
      thinkingLevel: z.string().min(1).optional(),
      hostId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.session"),
      sessionId: z.string().min(1),
      resumable: z.boolean(),
      resumed: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.output"),
      stream: z.enum(["stdout", "stderr", "assistant"]),
      text: z.string(),
      messageId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.thought"),
      text: z.string(),
      messageId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.message"),
      text: z.string(),
      mode: z.enum(RUN_MODES),
      delivered: z.enum(["queued", "steered"]),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.tool"),
      callId: z.string().min(1),
      name: z.string(),
      status: z.enum(["running", "completed", "failed"]),
      input: z.unknown().optional(),
      output: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.approval-requested"),
      requestId: z.string().min(1),
      question: z.string(),
      detail: z.string().optional(),
      options: z
        .array(
          z.object({ id: z.string(), label: z.string(), destructive: z.boolean().optional() }).strict(),
        )
        .readonly(),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.approval-resolved"),
      requestId: z.string().min(1),
      optionId: z.string(),
      by: z.string(),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.diff"),
      files: z
        .array(z.object({ path: z.string(), added: z.number(), removed: z.number() }).strict())
        .readonly(),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.usage"),
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      costUsd: z.number().optional(),
      contextUsed: z.number().optional(),
      contextSize: z.number().optional(),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.status"),
      status: TaskStatusSchema,
      note: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...RunEventBase,
      kind: z.literal("run.ended"),
      exitCode: z.number().int().nullable(),
      status: TaskStatusSchema,
    })
    .strict(),
]) as unknown as z.ZodType<RunEvent>;

/* ────────────────────────────── shapes the wire adds ───────────────────────────── */

/**
 * What the mesh looks like from inside the daemon.
 *
 * Declared here rather than imported from `@envoydev/host-bridge` for the same reason the mesh
 * types are not imported from EnvoyMesh: a client — the phone especially — must render this
 * without pulling the mesh's attach client into its bundle. `host-bridge` maps its own outcome onto
 * this shape, and that mapping is the one place the two can drift.
 */
export type CoderMeshStatus =
  | { kind: "attached"; scopeKey: string; ownerId: string; peerCount?: number }
  /**
   * **We are the node** — this machine hosts its own peer, and this is how to reach it.
   *
   * The three other variants are all written from a client's point of view looking for *somebody
   * else's* node, so a healthy self-hosting desktop had no honest value to report: the attach probe
   * found nothing and the daemon said `no-node` while its own peer was listening and dialable.
   * `multiaddrs` and `relayHints` are the addresses a peer (a paired phone) dials; `peerCount` is
   * how many peers are currently connected.
   *
   * (Rejected alternative: an optional `self: true` on `attached`. A client that only understands
   * the old shape would then read our own identity as the node we attached to — the precise
   * confusion this variant exists to prevent.)
   */
  | { kind: "hosting"; peerId: string; multiaddrs: string[]; relayHints: string[]; peerCount?: number }
  | { kind: "no-node"; reason: string }
  | { kind: "refused"; code: string; reason: string };

export const CoderMeshStatusSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("attached"),
      scopeKey: z.string().min(1),
      ownerId: z.string(),
      peerCount: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("hosting"),
      peerId: z.string().min(1),
      multiaddrs: z.array(z.string()),
      relayHints: z.array(z.string()),
      peerCount: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("no-node"), reason: z.string() }).strict(),
  z.object({ kind: z.literal("refused"), code: z.string(), reason: z.string() }).strict(),
]);

/** A place work could run. Reachability is the daemon's answer, not the client's guess. */
export interface CoderPeer {
  id: string;
  label: string;
  reachable: boolean;
  lastSeenAt?: string;
}

export const CoderPeerSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    reachable: z.boolean(),
    lastSeenAt: z.string().optional(),
  })
  .strict();

/**
 * One model a task can be run on.
 *
 * `id` is the value that travels: it is what the picker shows as chosen, what `coder.updateTask.model`
 * stores, and what the run is started with. It is **provider-qualified**, which is the shape
 * `TaskDefaults.model` has documented since the first release (`anthropic/claude-sonnet-4.5`,
 * `deepseek/deepseek-v4`).
 *
 * `provider` and `model` are that same choice taken apart, and they are on the wire rather than left
 * for the daemon to recover by splitting the id, because **splitting is not safe**: an Ollama tag or a
 * Hugging Face repository id can itself contain a slash (`meta-llama/Llama-3-70b`), and a naive
 * `split("/")` would then hand the agent a provider called `meta-llama`. Both agents here want the two
 * fields separately anyway — `envoy-harness` as `--provider` / `--model`, `deepseek-harness` inside one
 * opaque session-config value.
 */
export interface AgentModel {
  /** Provider-qualified, and the value stored on the task. */
  id: string;
  label: string;
  description?: string;
  provider: string;
  model: string;
}

export const AgentModelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    provider: z.string().min(1),
    model: z.string().min(1),
  })
  .strict();

/**
 * Can a model be chosen for this agent at all, and where does the list come from?
 *
 * The three values are three different facts, and the type exists so that **an empty list can never be
 * read as "this agent takes no model"** — the one mistake that would turn a supported feature into a
 * disabled control:
 *
 *   * `"listed"` — the agent publishes the models it accepts, and `options` is that list. Non-empty by
 *     construction (see the refinement on the schema below), because a list we can show is the only
 *     reason to say `"listed"`.
 *   * `"free-text"` — the agent accepts a model but publishes **no** list EnvoyDev can read before a
 *     session exists. `options` is empty **and the control is still usable**: it takes what the user
 *     types. This is the state `deepseek-harness` is in, and reporting it as `"none"` would be a claim
 *     about somebody else's product that we are in no position to make.
 *   * `"none"` — the agent takes no model at all. Only this value means "there is nothing to set".
 *
 * `kind` and `options` are one fact stated twice on purpose: a client that only reads `options` gets
 * "we have nothing to show", and `kind` is what says whether that is because the agent has none or
 * because we cannot enumerate them. The schema rejects the two disagreeing.
 */
export interface AgentModels {
  kind: "listed" | "free-text" | "none";
  /** Non-empty if and only if `kind` is `"listed"`. */
  options: readonly AgentModel[];
  /**
   * Where this answer came from, or why there is none — a repository, a file and a line range.
   *
   * Carried on the wire for the same reason `HarnessSummary.evidence` is, and **never rendered**: it
   * cites somebody else's source tree, which is what a maintainer needs and a user never does. The
   * user-facing half is `HarnessSummary.capabilities.model` plus the reason the composer words.
   */
  source: string;
  /**
   * ISO 8601, daemon clock: the session these options were observed from.
   *
   * Present **only when the list came from a real session** rather than from a catalogue, and it is
   * what the window renders instead of a promise: "these are what the agent published the last time we
   * opened a session with it". A catalogue list has no time and no such sentence — it is what the
   * agent's own source documents, which is a different kind of answer.
   *
   * For `deepseek-harness` this is the *only* way the models get shown at all, and it closes the gap
   * slice 2 recorded: the list exists per session, so it is recorded when we see one.
   */
  observedAt?: string;
}

export const AgentModelsSchema = z
  .object({
    kind: z.enum(["listed", "free-text", "none"]),
    options: z.array(AgentModelSchema).readonly(),
    source: z.string().min(1),
    observedAt: z.string().optional(),
  })
  .strict()
  .refine((value) => (value.kind === "listed") === (value.options.length > 0), {
    // The rule the whole feature turns on, enforced rather than trusted: `"listed"` with no options
    // would be a picker with nothing in it, and options with another kind would be a list nobody
    // promised. Either way the composer would have to guess, and guessing is how a control ends up
    // offering a model that will never reach the agent.
    message:
      'models.kind and models.options must agree: "listed" means options is non-empty, and any other ' +
      "kind means the list is empty (use \"free-text\" when the agent accepts a model but publishes no list).",
  });

/**
 * One value an agent published for one of its own session configuration options.
 *
 * `value` is **opaque and the agent's**: it is what goes back to the agent unchanged, and for
 * `deepseek-harness`'s model option it is a JSON array rather than a name. `label`/`description` are
 * what that value is called, taken from the agent's own `name`/`description` fields.
 *
 * `labelKey`/`descriptionKey` exist for the same reason `AgentMode` has them — a value **we** named is
 * ours to translate, one the agent named is shown as the agent wrote it — and they are plain strings
 * because this type is the wire's: the protocol cannot know a window's catalogue, so the consumer
 * checks (`isMessageKey`) and falls back to the label. Nothing in this build sets them: every value we
 * can currently show is the agent's own vocabulary (`Off`, `Low`, `High`, `Max`), and inventing our
 * words for somebody else's levels would put a second vocabulary on one choice.
 */
export interface AgentOptionValue {
  value: string;
  label: string;
  description?: string;
  labelKey?: string;
  descriptionKey?: string;
}

export const AgentOptionValueSchema = z
  .object({
    value: z.string(),
    label: z.string().min(1),
    description: z.string().optional(),
    labelKey: z.string().optional(),
    descriptionKey: z.string().optional(),
  })
  .strict();

/**
 * What an agent offers for its **thinking level** — ACP's `thought_level` option, by another name.
 *
 * The ACP category is `thought_level` and `deepseek-harness`'s option id is `reasoning_effort`
 * (`@deepseek-ai/dsh-acp` 0.1.2-rc.1, `lib/index.js:306`, `:494-508`); a user reads "thinking", which
 * is what Paseo's control row calls it. One vocabulary, chosen once: the wire, the task field and the
 * pill all say thinking, and the agent's own two names appear only in citations.
 *
 * ## The three `kind`s, and why this is not a list
 *
 * The same reasoning as `AgentModels`, one step further, because a thought level is knowable **only
 * from a session**: an agent publishes it inside the `session/new` response (or in the state returned
 * by a change), and no catalogue can know it in advance.
 *
 *   * `"listed"` — the agent published values and we have them. `options` is that list, non-empty by
 *     construction.
 *   * `"session"` — the agent publishes its levels only inside a session, and we have not seen one
 *     yet. **This is our ignorance**, and rendering it as "none" would be the claim this field exists
 *     to prevent: it would tell a user that `deepseek-harness` has no thinking levels, which is false
 *     and which one run disproves.
 *   * `"none"` — the agent offers none over the protocol we speak to it. Either recorded from its own
 *     source and verified against the binary (`envoy-harness`, whose ACP dispatch has no
 *     `session/set_config_option` at all), or **observed**: a session was opened and the agent
 *     published no thought-level option in it.
 *
 * `observedAt` is what keeps the first state from being read as a promise: it says these values came
 * from a real session at a real time, and a window that shows them says exactly that. It is absent for
 * a list that came from a catalogue rather than from an agent we watched.
 */
export interface AgentThinking {
  kind: "listed" | "session" | "none";
  /** Non-empty if and only if `kind` is `"listed"`. */
  options: readonly AgentOptionValue[];
  /** ISO 8601, daemon clock: when a session published these. Absent when nothing was observed. */
  observedAt?: string;
  /** Where this answer came from, or why there is none. Carried like `AgentModels.source`, never rendered. */
  source: string;
}

export const AgentThinkingSchema = z
  .object({
    kind: z.enum(["listed", "session", "none"]),
    options: z.array(AgentOptionValueSchema).readonly(),
    observedAt: z.string().optional(),
    source: z.string().min(1),
  })
  .strict()
  .refine((value) => (value.kind === "listed") === (value.options.length > 0), {
    // `AgentModelsSchema`'s rule, for the same reason: `"listed"` with nothing in it would be a picker
    // with nothing to pick, and options under another kind would be a list nobody promised.
    message:
      'thinking.kind and thinking.options must agree: "listed" means options is non-empty, and any ' +
      'other kind means the list is empty (use "session" when the agent publishes levels we have not seen yet).',
  });

/**
 * One session configuration option, as an agent published it, recorded by the daemon.
 *
 * **Not a wire type** — this is what the daemon writes to its own state file after a run
 * (`session-options.json`, beside `projects.json`), and it is deliberately closer to the agent's own
 * shape than `AgentThinking`/`AgentModels` are: `configId` and `category` are the agent's own strings,
 * so the *mapping* from "an option the agent published" to "the thinking pill" is data rather than a
 * hardcoded id, and a maintainer reading the file sees what the agent actually said.
 *
 * The **current** value is deliberately not recorded. A session's current selection describes the
 * session that has ended — the next run opens a new one — and a stored "current" would be read as a
 * promise about a run that has not happened. `observedAt` and `sessionId` are the provenance, and
 * they are the two facts that make the record auditable rather than merely plausible.
 */
export interface ObservedSessionOption {
  /** The agent's own config-option id (`model`, `reasoning_effort`). */
  configId: string;
  /** The agent's own label for it (`Model`, `Reasoning effort`). */
  label: string;
  /** The agent's own ACP category (`model`, `thought_level`). */
  category: string;
  values: readonly AgentOptionValue[];
}

export const ObservedSessionOptionSchema = z
  .object({
    configId: z.string().min(1),
    label: z.string().min(1),
    category: z.string(),
    values: z.array(AgentOptionValueSchema).readonly(),
  })
  .strict();

/** Everything one agent published about its own session configuration, and when we watched it. */
export interface ObservedSessionOptions {
  harness: HarnessId;
  /** ISO 8601, daemon clock. */
  observedAt: string;
  /** The agent's own session id, for a maintainer tracing one observation back to one run. */
  sessionId?: string;
  /**
   * The options it published, **empty included**.
   *
   * An empty list is a fact and not a gap: `envoy-harness` answers `session/new` with `{sessionId}`
   * alone, so a record with no options is the observation "this agent offered nothing", which is the
   * only evidence that turns the thinking pill's disabled state into a statement about the agent
   * rather than about our ignorance.
   */
  options: readonly ObservedSessionOption[];
}

export const ObservedSessionOptionsSchema = z
  .object({
    harness: HarnessIdSchema,
    observedAt: z.string().min(1),
    sessionId: z.string().optional(),
    options: z.array(ObservedSessionOptionSchema).readonly(),
  })
  .strict();

/**
 * What asking an agent "what do you offer?" can come back as — **three answers, never two.**
 *
 * The whole point of the union is the third member. A probe is a process spawn, a handshake and a
 * timeout, so it can fail for reasons that have nothing to do with the agent's abilities; and the one
 * mistake this type exists to make impossible is reporting that failure as a fact about the agent:
 *
 *   * `"listed"` — a session opened and published session configuration options. They are recorded (see
 *     `ObservedSessionOptions`), so the pickers render the real list.
 *   * `"none"` — a session opened and published **nothing**. This is a fact about the agent (it is
 *     exactly what `envoy-harness` does) and it is recorded as one, on the same terms a run records it.
 *   * `"unreachable"` — we could not ask: the binary is missing, it refused to start, it never answered,
 *     or the probe ran out of time. **Nothing is recorded**, because an answer we do not have must not
 *     be written down as an answer the agent gave.
 *
 * Same shape and same discipline as `AgentModels.kind` and `AgentThinking.kind`: a `kind`-like field is
 * required rather than optional so that "absent" can never be read as one of the real answers.
 */
export const PROBE_OUTCOMES = ["listed", "none", "unreachable"] as const;

export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

export const ProbeOutcomeSchema = z.enum(PROBE_OUTCOMES);

/**
 * **What kind of thing is missing, when something is** — and the answer is never "the agent".
 *
 * ## Why a boolean was not enough, and exactly how it lied
 *
 * `HarnessSummary.available` used to be `boolean | "unknown"`, and a user read "Not installed" for three
 * different situations that are not the same sentence:
 *
 *   1. **The bridge is missing.** `claudecode` and `codex` are driven through the Agent Client Protocol
 *      bridges `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp` — the vendor
 *      CLIs themselves speak no ACP and never answer `initialize` (measured; see each entry's `evidence`).
 *      An agent is therefore a **program plus the adapter we drive it through**, and the row said "not
 *      installed" about the adapter while `claude` 2.1.159 sat in `~/.local/bin`. The user had installed
 *      the agent; the app refused to say so.
 *   2. **The thing is installed but the daemon cannot see it.** A GUI launch hands its daemon launchd's
 *      environment, which on macOS contains no `PATH` at all, so a program in `~/.local/bin` is invisible
 *      to the search. "Not installed" was a claim about *our* environment dressed as a claim about *the
 *      user's machine*.
 *   3. **Nothing was probed.** A daemon that could not run the search knows nothing, and a boolean that
 *      folds "we did not look" into "false" turns our ignorance into an assertion about somebody else's
 *      software — precisely the move this project refuses.
 *
 * So the state names **the thing that is missing**, and each non-ready state carries what to do about it:
 *
 *   * `"ready"` — the program we drive resolved and this build speaks its protocol. It can run.
 *   * `"unsupported"` — the program is there, and this build has no adapter for the protocol it speaks
 *     (the four catalogue entries tagged `transport: "cli"`). Distinct from `ready` because the catalogue's
 *     own doctrine is that **being installed is not being drivable**, and a green chip for an agent whose
 *     every run is refused by `isDrivableByAcpAdapter` is the same kind of false promise as case 1.
 *   * `"needs-bridge"` — the agent's own program resolved and the adapter did not. `agentBinary` names what
 *     was found, `fix` names the install command from the entry.
 *   * `"not-installed"` — neither resolved, over a search that actually ran.
 *   * `"unknown"` — we could not run the search (see `SearchPath.searchable`). **Must never render as
 *     "not installed"**, which is the single rule this field exists for.
 *
 * `provisional` is the one provenance fact a resolved program can carry: `dsh` on the machine this was
 * written on resolves out of `~/.npm/_npx/<hash>/node_modules/.bin`, a directory belonging to somebody
 * else's `npx` invocation. It **counts as installed** — it resolves and it runs, verified against the real
 * binary — and it is *marked*, because an installation that `npm cache clean` removes is worth one
 * sentence rather than silence. **Decided by the path, never by how the program was found**: a `dsh` the
 * user's own login shell names *and* that lives in an `npx` cache is still `provisional`, because what the
 * warning is about is that the directory has a hash in it and `npm cache clean` removes it — not who
 * asked. See `provisionalCacheOf` in `@envoydev/platform`.
 */
export const HARNESS_STATES = [
  "ready",
  "unsupported",
  "needs-bridge",
  "not-installed",
  "unknown",
] as const;

export type HarnessState = (typeof HARNESS_STATES)[number];

export const HarnessStateSchema = z.enum(HARNESS_STATES);

/** The caches a resolved program may have come out of. A closed list, so the window can name each one. */
export const TOOL_CACHES = ["npx", "bun-cache", "pnpm-dlx"] as const;

export type ToolCache = (typeof TOOL_CACHES)[number];

export const ToolCacheSchema = z.enum(TOOL_CACHES);

/**
 * One step that fixes the state, in the order the steps must be run.
 *
 * `command` is a command line and is **deliberately never translated**: a translated `npm install -g …` is
 * a command that does not run (`SectionsFacts.tsx` has carried that rule since `installHint`). A list
 * rather than one command because `not-installed` on a bridged agent genuinely needs two steps — the agent
 * itself, then the adapter over it — and picking one of them would leave the user at another "not
 * installed" a moment later.
 */
export interface AvailabilityFix {
  /** The exact command line. Shown verbatim, in every language. */
  command: string;
  /** Where to read more, when the entry names a page. Also shown verbatim. */
  url?: string;
}

export const AvailabilityFixSchema = z
  .object({ command: z.string().min(1), url: z.string().min(1).optional() })
  .strict();

/**
 * **How this machine gets the program that drives an agent.**
 *
 * Two routes, and the difference is where the program lives rather than what runs:
 *
 *   * `installed` — the ordinary one: the probe found a program on the user's `PATH` and we launch that path.
 *   * `npx` — **fetched**: nothing is installed, and the launch is `npx -y <package>`, which downloads the
 *     connector into npm's cache the first time and runs it from there afterwards.
 *
 * ## Why this is a *stored choice* rather than a fallback the daemon picks
 *
 * The tempting design is to use `npx` silently whenever the installed connector is missing — no setting, no
 * control, and the row "just works". It is refused here for the reason this product refuses every other silent
 * machine change: the first run would **download a package** for an agent whose program the user believed they
 * had installed, and the row would go on saying what it said before. A delivery is a fact about what will run,
 * so it is the user's to choose and it is rendered on the row (see `HarnessSummary.delivery`).
 *
 * `package` appears **exactly when** the route is `npx`: a delivery claim with no package is a route nothing can
 * take, and the same "a claim that contradicts another claim is worse than a missing one" rule that governs
 * `HarnessAvailability` governs this.
 */
export const AgentDeliverySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("installed") }).strict(),
  z.object({ kind: z.literal("npx"), package: z.string().min(1) }).strict(),
]);

export type AgentDelivery = z.infer<typeof AgentDeliverySchema>;

/**
 * **What a fix belongs to** — an id, and never a command line.
 *
 * The three tiers the Agents page draws (`HarnessSummary`, `AgentProviderSummary`, `CatalogEntry`), named by
 * the id each of them already has. `coder.runFix` resolves the target through the same probes that drew the
 * row, which is what makes "the command the user read is the command that runs" a property of the types
 * rather than a promise.
 */
export const FixTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("harness"), id: HarnessIdSchema }).strict(),
  z.object({ kind: z.literal("catalog"), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("provider"), id: z.string().min(1) }).strict(),
]);

export type FixTarget = z.infer<typeof FixTargetSchema>;

/**
 * What one fix run produced — the shape `coder.runFix` answers with.
 *
 * Derived from the schema rather than written twice: the daemon's runner and the window's block both name this
 * type, and a second interface would be the place the two drifted.
 */
export type FixRunResult = z.infer<(typeof RPC_SPECS)["coder.runFix"]["result"]>;

/**
 * What this machine can actually do with one agent right now.
 *
 * ## The agreement rules the schema enforces rather than trusts
 *
 * Same discipline as `models.kind` ⇄ `options` (`AgentModelsSchema`): every field here is a *claim*, and a
 * claim that contradicts another claim is worse than a missing one, because both travel and a client reads
 * whichever it trusts. So the schema rejects all five contradictions instead of leaving them to review:
 *
 *   1. `binary` is present **exactly when** the state says we found the program we drive (`ready`,
 *      `unsupported`). A path with `not-installed` is the old lie wearing the new field.
 *   2. `agentBinary` may appear **only** with `needs-bridge`. It is the evidence for that state — "we found
 *      `claude`, we did not find `claude-agent-acp`" — and with any other state it would be a path found
 *      for a reason the state does not describe.
 *   3. `provisional` may appear **only** with `ready`: provenance is a property of a resolved program.
 *   4. `fix` appears **exactly when** there is something to install (`needs-bridge`, `not-installed`) and
 *      must be non-empty. An `unknown` with a fix would be us telling the user to install something we
 *      never established was missing — the `available: false` bug, reintroduced through the back door.
 *   5. `unsupported` and `unknown` carry no `fix` for the same reason in two directions: one needs an
 *      adapter we have not written, the other needs us to look again.
 */
export interface HarnessAvailability {
  state: HarnessState;
  /** Absolute path to the program we would launch, when we found one. */
  binary?: string;
  /** Absolute path to the **agent's own** program, when it is a bridge we drive and it resolved. */
  agentBinary?: string;
  /** Set when `binary` came out of another tool's cache rather than an installation of the user's own. */
  provisional?: ToolCache;
  /** What to run to get to `ready`, in order. Present exactly when something must be installed. */
  fix?: readonly AvailabilityFix[];
}

export const HarnessAvailabilitySchema = z
  .object({
    state: HarnessStateSchema,
    binary: z.string().min(1).optional(),
    agentBinary: z.string().min(1).optional(),
    provisional: ToolCacheSchema.optional(),
    fix: z.array(AvailabilityFixSchema).min(1).readonly().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
    const drives = value.state === "ready" || value.state === "unsupported";
    if (drives !== (value.binary !== undefined)) {
      fail(
        value.binary !== undefined
          ? `a resolved program (binary) means we found the thing we drive, so state must be "ready" or ` +
              `"unsupported", not "${value.state}"`
          : `state "${value.state}" claims we found the thing we drive, so it must carry its binary path`,
        "binary",
      );
    }
    if (value.agentBinary !== undefined && value.state !== "needs-bridge") {
      fail(
        `agentBinary is the evidence for "needs-bridge" — the agent's own program found while the adapter ` +
          `we drive was not — so it cannot accompany "${value.state}"`,
        "agentBinary",
      );
    }
    if (value.state === "needs-bridge" && value.agentBinary === undefined) {
      fail(`"needs-bridge" must name the agent binary it found`, "agentBinary");
    }
    if (value.provisional !== undefined && value.state !== "ready") {
      fail(`provisional describes a resolved program, so it belongs to "ready" alone`, "provisional");
    }
    const installable = value.state === "needs-bridge" || value.state === "not-installed";
    if (installable && (value.fix === undefined || value.fix.length === 0)) {
      fail(
        `"${value.state}" is a statement about something missing, so it must carry the command that fixes ` +
          `it — a row that says what is absent and not what to do is the sentence this field replaced`,
        "fix",
      );
    }
    if (!installable && value.fix !== undefined) {
      fail(
        `"${value.state}" has nothing to install, so it must not carry an install command: naming one ` +
          `would claim something is missing that this state does not assert`,
        "fix",
      );
    }
  });

/** One agent, as a *picker* needs it. Everything the UI promises is gated on `capabilities`. */
export interface HarnessSummary {
  id: HarnessId;
  label: string;
  tier: "built-in" | "catalogued";
  summary: string;
  /** The agent's own modes. Empty is a fact ("it declares none here"), not a missing answer. */
  modes: readonly AgentMode[];
  /**
   * Which models this agent publishes, and how a choice reaches it.
   *
   * Required rather than optional, on the same reasoning as `capabilities.agentMode`: "the field is
   * absent" must never be readable as "this agent has no models", because those two lead to opposite
   * controls — free text, and a disabled pill. See `AgentModels` for what the empty list means.
   */
  models: AgentModels;
  /**
   * What this agent offers for its **thinking level**, as the daemon last saw it.
   *
   * Required, like `models` and for the same reason turned up a notch: the three states here are
   * `"listed"` (we have values), `"session"` (the agent publishes them only inside a session, and we
   * have not seen one) and `"none"` (it offers none). An optional field would collapse the last two
   * into "absent", and a composer that read absent as "none" would tell a user their agent has no
   * thinking levels when the truth is that nobody has opened a session with it yet.
   */
  thinking: AgentThinking;
  capabilities: {
    resume: boolean;
    cancel: boolean;
    approvals: boolean;
    structuredTools: boolean;
    streaming: boolean;
    images: boolean;
    /**
     * Can the daemon apply one of those modes?
     *
     * False for an agent that declares modes but speaks a protocol with no way to choose one — and
     * false is what makes the composer *disable* its picker with a reason rather than offer a choice
     * that would be dropped on the floor.
     */
    agentMode: boolean;
    /**
     * Can the daemon make a chosen model the one this agent runs on?
     *
     * Separate from `models` for exactly the reason `agentMode` is separate from `modes`, and it is
     * the flag the composer's model control is enabled on: an agent can publish a list (or accept free
     * text) that this build still has no wired-up way to deliver — the catalogue entries for
     * third-party CLIs are precisely that case. Required, so "we did not ask" is not an answer here:
     * enabling the control is a promise that the choice reaches the agent.
     */
    model: boolean;
    /**
     * Can the daemon set this agent's thinking level?
     *
     * `agentMode` and `model`'s third sibling, and the flag the thinking pill is enabled on. False for
     * `envoy-harness`, whose ACP dispatch has no `session/set_config_option` at all (its own
     * `acp-server.ts` answers `-32601 method not found` — verified against the built peer), and false
     * for the catalogued CLIs this build cannot launch. True for an agent whose levels travel through
     * the session configuration, which is the same call the model already uses.
     */
    thinking: boolean;
    /**
     * Can the daemon change whether this agent **asks before destructive actions**?
     *
     * The flag the settings pane enables "Ask before anything destructive" on. `agentMode`, `model` and
     * `thinking`'s fourth sibling, and a fourth wire again: `envoy-harness` takes a session policy
     * through `session/set_policy { autoRun }`, `deepseek-harness` has no such method at all. False
     * means the row is disabled **with the reason on screen** when this agent is the default one —
     * never a switch that stores a preference the agent will not be told about.
     */
    approvalPolicy: boolean;
  };
  /**
   * What this machine can actually do with this agent, and what is missing when it cannot.
   *
   * **Required, and it replaced `available: boolean | "unknown"`.** The old field is why a user with
   * `claude`, `codex` and `dsh` all installed read "Not installed" for all three: a boolean cannot say
   * *which* of the agent, its adapter and our own search turned up empty, and the window had no choice but
   * to render every false as one word. See `HarnessAvailability` for the five states, the five
   * contradictions its schema rejects, and why `provisional` is a fact rather than a warning.
   *
   * **The compatibility consequence, recorded because this is a wire and an older daemon is real.**
   * A daemon built before this field sends `available` and `installHint`, and this schema is `.strict()` —
   * so its `coder.listHarnesses` answer no longer validates. Nothing in the running product validates a
   * result on the client (the schemas are the declared contract and the tests' instrument), so the window
   * does not break; it must nonetheless render that answer honestly, and it does:
   * `availabilityOf()` in `apps/desktop/src/composer/agent-for.ts` reads the legacy boolean and maps it to
   * a state **without inventing one**. That mapping is the interesting half — a legacy `false` becomes
   * `unknown`, never `not-installed`, because a daemon that never asked about the agent's own program
   * cannot support the claim, and it sends no `fix` for the same reason. The user is told the daemon is a
   * build behind and to restart EnvoyDev, which is the action that fixes it, rather than being told a
   * program they installed is missing.
   */
  availability: HarnessAvailability;
  /**
   * Whether this agent opens a session here, or wants a sign-in first.
   *
   * See `HarnessAuth`: three states, `unknown` until a probe says otherwise, and the reason the two
   * neighbouring fields are not enough — `availability` says the program is on this machine, and this says
   * whether it will talk to us. `cursor-agent acp` is both `ready` and `needs-signin` until its own login
   * has been through once.
   */
  auth: HarnessAuth;
  /**
   * Where the catalogue's facts came from.
   *
   * Carried on the wire so a maintainer can read it from a client, and deliberately **not rendered**:
   * it cites repositories and file paths, which is exactly what the family's wording rule puts last
   * and small — and what a user never needs to see.
   */
  evidence: string;
  /**
   * **How this agent's connector is delivered on this machine** — the user's choice, rendered on the row.
   *
   * Absent from a daemon older than this field, which the window reads as `installed`: that is the route such a
   * daemon can actually take, and inventing `npx` for it would describe a launch it has no code for.
   */
  delivery?: AgentDelivery;

  /**
   * **How to install this agent's connector on this machine anyway** — present when the delivery in force is
   * `npx`, and absent otherwise.
   *
   * The owner's requirement, in their words: *"we should keep the command text, but also provide the exec
   * button. Not to remove the text. The user can install it by himself."* A fetched delivery makes the row
   * `Ready`, and `availability.fix` is then empty **because there is nothing to fix** — which quietly took the
   * command off the screen and left a user who would rather install it with nothing to read or copy. So the
   * commands for the *other* route travel as their own field: the text stays, the Copy control stays, and the
   * press that runs it stays beside them.
   *
   * Its own field rather than a fix on `availability`, because `HarnessAvailability` means *the state of the
   * route in force* and its agreement rules (fix appears exactly when something must be installed) are what keep
   * a row from telling a user to install a program it just said was working.
   */
  installFix?: readonly AvailabilityFix[];

  /**
   * **The npm package this agent's connector could be fetched from** — the *offer*, as opposed to `delivery`,
   * which is the route in force.
   *
   * Present only for an agent whose adapter is published on npm (the two bridges), and absent for the seven whose
   * adapter is in this repository. The window needs it because it cannot invent a package name: without this field
   * it drew a *Run it through npx* press on **every** row the daemon could write — including Envoy Harness, whose
   * press could only ever come back `connector-not-fetchable`. That is a control that cannot work, which this
   * panes's laws forbid outright (`docs/settings-parity.md` §7.18.2).
   */
  fetchable?: {
    package: string;
    /**
     * **What fetching this resolves** — a *connector* for an agent that is already here, or the *agent itself*.
     *
     * The two are not interchangeable, which is why the row has to be told which: Claude Code missing its bridge can
     * be fetched into usability, and so can Copilot missing entirely — but neither offer is valid in the other's
     * state. The window offers the press only where fetching would actually resolve the row.
     */
    covers: "connector" | "agent";
  };

}

export const HarnessSummarySchema = z
  .object({
    id: HarnessIdSchema,
    label: z.string(),
    tier: z.enum(["built-in", "catalogued"]),
    summary: z.string(),
    /**
     * The modes this agent offers, so a composer can render the picker from data.
     *
     * Required rather than optional, and allowed to be empty: an agent with no modes is a fact a client
     * must be able to tell apart from "we did not ask". Paseo reports ACP modes only after `session/new`;
     * we list what the catalogue knows and leave the list empty where it is genuinely dynamic.
     */
    modes: z.array(AgentModeSchema).readonly(),
    /**
     * The models this agent publishes, and what an empty list means.
     *
     * Required, and shaped so that the *reason* travels with the list: a client that sees no options
     * still has to know whether that is the agent's answer or ours, which is what `kind` carries.
     */
    models: AgentModelsSchema,
    /**
     * What this agent offers for its thinking level, and which of the three states that answer is in.
     *
     * Required, and shaped so the *reason* travels with the list: an agent that publishes none, one
     * whose levels we have not seen yet, and one we can offer are three different sentences on screen
     * and only one of them is about the agent.
     */
    thinking: AgentThinkingSchema,
    capabilities: z
      .object({
        resume: z.boolean(),
        cancel: z.boolean(),
        approvals: z.boolean(),
        structuredTools: z.boolean(),
        streaming: z.boolean(),
        images: z.boolean(),
        /**
         * Whether the daemon can put this agent into a mode it declares.
         *
         * The one fact a composer needs before it may enable its picker, and deliberately separate
         * from `modes`: an agent can have modes and still have no way to be *set* into one. Required,
         * because "we did not ask" is not an answer here — an enabled picker is a promise that the
         * choice reaches the agent.
         */
        agentMode: z.boolean(),
        /**
         * Whether the daemon can put this agent on a model it publishes or accepts.
         *
         * Separate from `models` on the same terms as `agentMode`, and separate from `agentMode`
         * because the two are genuinely different wires: `envoy-harness` takes a mode through ACP and a
         * model through **argv**, so a daemon can honour one and not the other.
         */
        model: z.boolean(),
        /**
         * Whether the daemon can set this agent's thinking level.
         *
         * Separate from `thinking` on the same terms as `model`, and separate from `model` because the
         * two are different delivery questions: `envoy-harness` takes a model in argv and has no
         * thought-level method at all, so a daemon can honour one and not the other.
         */
        thinking: z.boolean(),
        /**
         * Whether the daemon can tell this agent whether to ask before destructive actions.
         *
         * Separate from `approvals`, which says whether the agent can ask at all, and separate from the
         * other three flags because it is a fourth method: `session/set_policy`. Required, on the same
         * terms — an enabled control is a promise that the choice reaches the agent.
         */
        approvalPolicy: z.boolean(),
      })
      .strict(),
    /**
     * Whether this agent can be run here, and which of the three things that could be missing is.
     *
     * Required, like `models` and `thinking`, and for the strongest version of their reason: the state is
     * what a user reads before deciding whether to try, and "the field is absent" would be read as "not
     * installed" by any client that had to guess. Its five states and five agreement rules are documented
     * on `HarnessAvailability`.
     */
    availability: HarnessAvailabilitySchema,
    /**
     * Whether this agent can open a session here, or wants a sign-in first.
     *
     * Required, and `unknown` until a probe has established something, because the one thing this field
     * must never do is assert a sign-in requirement nobody measured (`HarnessAuth`). Beside `availability`
     * rather than inside it: "the program is installed" and "the program will talk to us" are different
     * questions with different fixes, and `cursor-agent` on a fresh installation is the measured case of
     * an agent that is `ready` and `needs-signin` at the same time.
     */
    auth: HarnessAuthSchema,
    evidence: z.string(),
    // The delivery this machine will use, absent from a daemon that predates the field — see the interface.
    delivery: AgentDeliverySchema.optional(),
    // The other route's commands, present **exactly** when the delivery in force is `npx`: with the connector
    // installed there is nothing to install, and offering the command anyway would be an invitation to reinstall
    // a program the row just said was working.
    // The offer, as opposed to the choice: the package this connector could be fetched from, when there is one.
    fetchable: z
      .object({ package: z.string().min(1), covers: z.enum(["connector", "agent"]) })
      .strict()
      .optional(),
    installFix: z.array(AvailabilityFixSchema).min(1).readonly().optional(),
  })
  .strict()
  /**
   * **The two claims cannot contradict each other**, which is this schema family's standing rule
   * (`HarnessAvailabilitySchema` enforces five of them). `installFix` is the *other* route's commands, so it is
   * present exactly when the route in force is `npx` — an `installFix` on an installed delivery would be a
   * command for something the row says is already here.
   */
  .superRefine((value, ctx) => {
    const fetching = value.delivery?.kind === "npx";
    if (fetching && value.fetchable === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["fetchable"],
        message: "a fetched delivery must name the package it fetches from",
      });
    }
    if (fetching !== (value.installFix !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["installFix"],
        message: fetching
          ? "a fetched delivery must carry the commands that would install it here instead"
          : "installFix is for a fetched delivery; an installed one has nothing to install",
      });
    }
  });

/**
 * One environment variable a provider declared, and whether **this daemon** has a value for it.
 *
 * The `set` flag is the whole point, and it is a fact about our process rather than about the agent: a
 * provider whose credential is missing is not ready *here*, and the alternative to saying so is a spawn
 * that fails with the agent's own sentence about a login nobody performed. The **name** travels; the
 * value never does — there is no field for one on this shape either, which is the same enforcement
 * `AgentProviderConfig.env` states.
 *
 * ## `from`, and the difference it makes to a user
 *
 * `set` alone cannot say *where* a value came from, and that is the whole question this field answers for
 * the four catalogued recipes that set a constant. `from: "catalogue"` means the value is the recipe's own
 * — published in our source, not something the daemon's environment happened to hold — so a window can say
 * so instead of telling a user to export a variable we are already supplying. Absent means the ordinary
 * case: the daemon's own environment, which is where every credential still comes from and the only place
 * one ever does.
 *
 * Two agreement rules, checked rather than trusted, and each is a claim that would otherwise contradict
 * itself:
 *
 *   1. **`from` requires `set`.** A value cannot come from a recipe and be absent at the same time.
 *   2. **A value from a recipe may not sit under a credential-looking name**
 *      (`CREDENTIAL_ENV_NAME_PATTERN`). This is the wire's copy of the rule `CatalogEntrySchema` enforces on
 *      the catalogue itself: a recipe is our reviewed data, and `ANTHROPIC_API_KEY: "sk-live-…"` in one
 *      would be a real secret in a git-tracked file whichever layer noticed it first.
 */
export const AgentProviderEnvStateSchema = z
  .object({
    name: z.string().min(1),
    set: z.boolean(),
    /** Where the value comes from, when it is not the daemon's own environment. */
    from: z.enum(["daemon", "catalogue"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.from !== undefined && !value.set) {
      ctx.addIssue({
        code: "custom",
        message: `"${value.name}" cannot come from ${value.from} and be unset — a value has one source`,
        path: ["from"],
      });
    }
    if (value.from === "catalogue" && looksLikeCredentialEnvName(value.name)) {
      ctx.addIssue({
        code: "custom",
        message:
          `"${value.name}" names a credential, so no recipe may supply it — a catalogue entry's ` +
          `constants are not secrets and this shape must not carry one`,
        path: ["name"],
      });
    }
  });

export type AgentProviderEnvState = z.infer<typeof AgentProviderEnvStateSchema>;

/**
 * One constant a catalogued **recipe** sets for the agent, name and value together.
 *
 * ## Why the value is here, and what it is not
 *
 * Four entries set one (`AUGMENT_DISABLE_AUTO_UPDATE: "1"`, `VT_ACP_ENABLED: "1"`, …) because the recipe is
 * ours: git-tracked data we reviewed and published (`packages/agent-catalog/src/acp-catalog.ts`), where a
 * constant of a command line anybody can read is not a secret. Carrying both halves in one object is what
 * lets a row say which variables the recipe supplies and which are the user's to set, from one list rather
 * than two that can drift.
 *
 * ## The one thing this shape refuses, **loudly**
 *
 * A name that looks like a credential may not sit beside a value (`looksLikeCredentialEnvName`). The
 * distinction this whole slice rests on is *whose data it is*: `ANTHROPIC_API_KEY: "sk-live-…"` in a
 * git-tracked catalogue is a leaked secret whichever layer notices it, so a recipe may not carry one and
 * this **refuses** rather than dropping the entry quietly — a silently dropped variable is a row lying
 * about its own recipe. A *user's* own `AgentProviderConfig.env` is untouched by this rule: naming a
 * credential is exactly what the names-only design is for (§7.10).
 *
 * Declared before `CatalogEntrySchema`, which reads it: these are module-level values, so source order is
 * initialisation order and a forward reference would be a temporal-dead-zone crash rather than a type error.
 */
export const CatalogEnvConstantSchema = z
  .object({
    /** The variable's name, as the recipe sets it. */
    name: z.string().min(1),
    /** The constant the recipe sets it to. Never a credential — see the rule below. */
    value: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (looksLikeCredentialEnvName(value.name)) {
      ctx.addIssue({
        code: "custom",
        message:
          `"${value.name}" names a credential, so no catalogue recipe may supply it — a recipe's ` +
          `environment is constants we publish, and a secret has no place in git-tracked data`,
        path: ["name"],
      });
    }
  });

export type CatalogEnvConstant = z.infer<typeof CatalogEnvConstantSchema>;

/**
 * An agent a **user** declared, as a list needs it.
 *
 * Deliberately **not** a `HarnessSummary` with a different id, and the two differences are the honest
 * ones between "an agent we ship" and "a program you told us about":
 *
 *   * `availability` is the *same* field, from the *same* prober, under the *same* five-state schema with
 *     the same agreement rules — a provider is probed, never believed. What a user typed is a command to
 *     look for, not a claim that it is there, so a provider whose program is missing reads
 *     `not-installed` with the command that fixes it, exactly as a catalogue entry does.
 *   * there is no `capabilities`, no `modes`, no `models` and no `thinking`. We have never opened a
 *     session with this program, and every one of those fields would be a guess restated as our fact.
 *   * there is no `auth` either, and the reason is the same one a step further: an auth state is a fact
 *     about a session this daemon managed to open, and it opens none with a provider — no task can run on
 *     one yet. A field here would read `unknown` forever, which is not a fact about the program but a
 *     statement about us dressed as one about it. See `coder.signInAgent`.
 *
 * The two tiers used to be required to agree on one further field, a stored `hidden` preference over the
 * pickers. It is **gone from both**, and the removal is the point rather than a tidy-up: a preference that
 * filters a list is the one control that can make an agent this product ships disappear from the product's
 * own lists, which is the exact failure the owner of this product objected to. What decides which agents a
 * picker offers is now derived from `availability` — a fact we measure, and one we can be wrong about and
 * then correct with a probe — and nothing a user stores can shorten a list. See
 * `apps/desktop/src/composer/agent-for.ts` for the rule and `docs/settings-parity.md` §5.8 for the
 * reasoning.
 */
export interface AgentProviderSummary {
  /** The user's own id. Never one of `HARNESS_IDS` — `AgentProviderConfigSchema` refuses that. */
  id: string;
  label: string;
  /** The program, as it would be spawned. */
  command: string;
  /** The argv after it, verbatim. */
  args: readonly string[];
  /**
   * Every variable the provider names, with whether this daemon has a value for it and where that value
   * came from.
   *
   * Required, and empty when the provider names none: a window has to be able to tell "no credential is
   * needed" from "we have not looked", which is the same rule `models` and `thinking` follow. `from` is
   * present exactly when the value is **not** the daemon's own environment — see
   * `AgentProviderEnvStateSchema`, where the two agreement rules on it live.
   */
  env: readonly AgentProviderEnvState[];
  transport: "acp" | "cli";
  availability: HarnessAvailability;
  /**
   * One English sentence about this row — the probe's own reason when it is not ready.
   *
   * For the log and for the tests, like `HarnessSummary.evidence`: the states and the `fix` are what a
   * window renders, and a translated window reads the *keyed* refusals a launch produces rather than this
   * line. It exists so a bug report can quote what the daemon actually found.
   */
  detail: string;
  /**
   * **The catalogue entry this provider is**, when it was added from one.
   *
   * It travels because the *catalogue row* has to know: pressing Add on `goose` stores a provider whose own id is
   * `goose-acp` (a provider may not be the entry it references — the store's rule), so a list that matched on ids
   * alone would leave the row offering **Add** for a recipe already in the user's list, and let it be added again
   * and again. `addedProviderIds` keys on this.
   */
  catalogEntryId?: string;

}

export const AgentProviderSummarySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).readonly(),
    env: z.array(AgentProviderEnvStateSchema).readonly(),
    transport: z.enum(["acp", "cli"]),
    availability: HarnessAvailabilitySchema,
    detail: z.string(),
    catalogEntryId: z.string().min(1).optional(),
  })
  .strict();

/**
 * **One catalogued agent**, as the catalogue states it — the row `coder.listCatalog` serves.
 *
 * ## Why this shape and not a `HarnessSummary` with a different id
 *
 * A `HarnessSummary` answers "what can this agent do", and every field of it is something we verified by
 * running the agent: its modes, its models, its thinking levels, its capabilities. For a catalogued entry
 * **we have run nothing** — all we hold is a recipe we catalogued from the vendor's documentation plus the
 * reference product's list. So this carries the recipe, and the one claim about *this machine* is
 * `availability`: the cheap facts — does the program resolve, does the connector resolve, is it fetched on the
 * first run, does the daemon have the variables the launch needs — resolved for every row when the list is
 * served, with nothing started. A capability field here would be a guess restated as our fact, which is the
 * same reason `AgentProviderSummary` has none; the deep facts (what it publishes, whether it wants a sign-in)
 * travel on `coder.probeSessionOptions` as properties carrying the time they were observed. A capability field here would be a guess
 * restated as our fact, which is the same reason `AgentProviderSummary` has none.
 *
 * ## The four fields that are also `coder.addProvider`'s parameters
 *
 * `id`, `command`, `args`, `env` and `transport` are the entry's own recipe facts, and adding the entry
 * means handing exactly them to `coder.addProvider` under `label: title`. They travel in this row so that
 * **no client assembles a dialect**: `transport` in particular is a fact the entry states
 * (`AcpAgentEntry.transport`), and a window that defaulted it would produce a provider whose launch fails
 * in a way nobody can see (the trap: a peer ignores an unknown field name and reports success).
 *
 * `modeParam` and `authMethodId` are **absent, on purpose**, and their absence is a statement: no entry has
 * evidence for either, so no client may invent one.
 *
 * ## `env` is the recipe's own constants, and the value is part of the row
 *
 * Four entries set a constant (`AUGMENT_DISABLE_AUTO_UPDATE: "1"`, `VT_ACP_ENABLED: "1"`, …) because the
 * recipe is ours: it is git-tracked data we reviewed, published in
 * `packages/agent-catalog/src/acp-catalog.ts`, and a value that is a constant of a command line anybody can
 * read is not a secret. So the row carries **name and value together**, and the reason is a user's:
 * before this, adding one of those four entries produced a provider that named a variable nothing would
 * ever set, and the launch refused by name for no safety gain. A row that carries the constant can say
 * which variables the recipe supplies and which are the user's to set, from one list rather than two.
 *
 * What a provider config carries is still **only the name of the entry** — see `AgentProviderConfig`.
 * Nothing a client sends may be a value, which is what keeps this field from becoming the door the
 * reference exists instead of.
 *
 * ## The one thing this shape refuses, loudly
 *
 * A name that looks like a credential (`looksLikeCredentialEnvName`) may not sit beside a value here. The
 * distinction the whole slice rests on is *whose data it is* — and `ANTHROPIC_API_KEY: "sk-live-…"` in a
 * git-tracked catalogue is a leaked secret whichever layer notices it, so a recipe may not carry one and
 * this refuses rather than dropping the entry quietly. A user's own `AgentProviderConfig.env` is untouched
 * by this rule: naming a credential is exactly what the names-only design is for.
 */
export const CatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    /** What a user sees, and the label the added provider takes. */
    title: z.string().min(1),
    /** The vendor's own one-line description, kept factual. */
    description: z.string(),
    /** The version the command pins, or `"manual"` when the tool updates itself. */
    version: z.string().min(1),
    /** Where a user gets it. Shown for a missing program, and shown for an `npx` recipe too. */
    installLink: z.string(),
    /** The program to spawn — the first element of the entry's command, exactly as catalogued. */
    command: z.string().min(1),
    /** The argv after it, verbatim. */
    args: z.array(z.string()).readonly(),
    /** How the daemon must speak to it. The entry states it; nothing infers it. */
    transport: z.enum(["acp", "cli"]),
    /**
     * Every environment variable the recipe sets, **name and constant together** — see the doc above for
     * why the value is part of the row and what `CatalogEnvConstantSchema` refuses. Never a credential: a
     * recipe's environment is constants we publish, and a name that looks like a credential is rejected
     * when the row is built rather than dropped from it.
     *
     * A **provider** still carries names only. Adding this row sends the entry's `id` as
     * `catalogEntryId`, and the daemon resolves the constants from the catalogue — so no client ever sends a
     * value, which is the property the reference field exists to preserve.
     */
    env: z.array(CatalogEnvConstantSchema).readonly(),
    /**
     * How the program gets onto a machine, in the two shapes that need different sentences.
     *
     * `"npx"` means it is fetched from npm on the first run and needs **no install at all** — saying
     * "install it" there would send a user to a download page for something that installs itself. `"binary"`
     * means a program that is simply not there yet, and `binary` is the name the probe looks for.
     */
    install: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("npx"), package: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("binary"), binary: z.string().min(1) }).strict(),
    ]),
    /**
     * True when this id also names an agent we ship — `cursor` is the one today.
     *
     * Computed by the daemon rather than by each client, because the rule for the overlap is a catalogue
     * decision with a name behind it (`resolveAgentEntry`): **a built-in wins**, because a built-in is the
     * entry we ship driving logic for and have evidence about. A row that is both must not be offered as
     * something to add, and the window must not be the place that decides so.
     */
    builtIn: z.boolean(),
    /**
     * **What this machine can do with this recipe right now** — resolved when the list is served, not when a
     * user asks about a row.
     *
     * This field is the whole "nobody has to press anything to learn a state" rule, and the reasoning is worth
     * keeping because the opposite shape shipped first and was wrong in a way no reader of the code could
     * see: the row carried **no** claim about this machine, the window rendered *"Not checked yet"*
     * (`settings.agent.unchecked`), and a button beside it asked the daemon about one entry at a time. So a
     * user opening the page met thirty-eight rows that knew nothing plus a chore — press, wait, read, times
     * thirty-eight. The owner's report was *"I don't want user to guess, to check if we can do that"*, and the
     * chore was the defect rather than the wording.
     *
     * Why the old design believed it had to be that way, and why it did not: a sweep was rejected as expensive
     * because 14 of these recipes are `npx -y …`. That is true of *starting* one, and a cheap availability
     * answer starts nothing. It answers four questions about this machine and no others — does the program the
     * recipe names resolve (on the search path, in a tool cache, or as the user's own login shell resolves it),
     * does the **agent's own** program resolve when the recipe is a bridge over one, is the recipe an
     * `npx`/`uvx` shape (there is then nothing to install at all), and does the daemon have the variables the
     * launch needs. All four are filesystem and environment reads: see `apps/desktop/src/daemon/catalog.ts`,
     * and the test that counts child processes across a whole list read and requires zero.
     *
     * **Ignorance stays representable.** When the daemon could not search at all this carries
     * `state: "unknown"`, and the window says so in its own words rather than "not installed" — the single
     * rule `HarnessState` exists for.
     *
     * The **deep** facts are deliberately not here and cannot be: whether an agent speaks ACP, what it
     * publishes and whether it wants a sign-in are learned by starting it. They travel on
     * `coder.probeSessionOptions` for the rows the daemon may start, and a client renders them as properties
     * carrying the time they were observed — never as a row state the user has to trigger in order to learn.
     */
    availability: HarnessAvailabilitySchema,
  })
  .strict();

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

/** What a run looks like to a client: the record, plus the events it may render. */
export const RunSnapshotSchema = z
  .object({
    run: AgentRunSchema,
    events: z.array(RunEventSchema).readonly(),
    /** The `seq` a client should ask from next time. Equal to the last event's `seq`, or 0. */
    nextSeq: z.number().int().nonnegative(),
    /** True while the daemon is still producing events for it. */
    live: z.boolean(),
  })
  .strict();

export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

/* ────────────────────────────── the method table ───────────────────────────── */

/**
 * A method's contract: what it takes, what it returns.
 *
 * The **catalogue** (`RPC_METHODS` in `domain.ts`) is complete, so a client's typed stub is
 * complete; the schemas tighten as each method lands. Both a declared method with no spec and a
 * spec for a method that is not in the catalogue fail `test/rpc.test.ts`, so the two cannot drift.
 *
 * ## Version skew, stated rather than discovered
 *
 * This product is two artifacts — a window and a daemon — and the family's rule D2 means starting the
 * app does not replace a daemon already holding the port, so **"the window and its daemon are
 * different builds" is a routine state after an upgrade, not an exceptional one.** Three combinations
 * exist, and only one of them is actually handled by the schemas below:
 *
 * | direction | what happens | handled? |
 * |---|---|---|
 * | a newer **daemon** sends a field an older window does not know | nothing at all. **No client parses a result** — `RPC_SPECS[method].result` is a *specification* asserted in `packages/protocol/test/`, not a runtime gate, and the window's store reads results with `result as { … }` casts (`state/coderStore.ts`). An extra field is simply never read | ✅ by construction — and this is why the `.strict()` on a result schema is **not** a compatibility hazard |
 * | a window calls a method an older **daemon** does not have | `-32601`, plus the connect-time notice `missingMethods` derives from `coder.hello`'s `methods` | ✅ deliberately: the notice names the one action that fixes it |
 * | an older **daemon** omits a field a newer window's types call **required** | the window reads `undefined` where its type says an object. Nothing refuses it, because nothing parses results | ⚠️ **by guard, at each reader** — not by this file |
 *
 * The third row is the real one, and its history is why it is written down rather than left implied:
 * `HarnessSummary.models` and `.thinking` are required here, an older daemon did not send them, and a
 * settings page that dereferenced them took the whole pane down. The fix was a guard in the reader
 * (`DeclaredFacts` in `components/settings/SectionsAgents.tsx`), and choosing *that* fix over "parse
 * every result against the spec and fail the call" was deliberate:
 *
 *   * parsing results in the client converts "one row degrades to a sentence" into "the whole call
 *     fails" — which is strictly worse for a user, since one agent missing a field would empty the
 *     list of nine;
 *   * and it would make **adding** a field to a result a breaking change for old windows, which is the
 *     opposite of what the first row says is true today.
 *
 * So the position is: **adding a field to a result is compatible; removing one is not, and the reader
 * that would notice is the one that owes the guard.** `coder.hello`'s version and `methods` pair is
 * what tells a user *why* they are looking at a degraded row; `docs/settings-parity.md` §7.2 carries
 * the same table from the daemon's side.
 *
 * ## Params are the other question, and they stay strict
 *
 * `parseRpcParams` refuses an unknown key in a request. That looks like the same asymmetry and is not:
 * a request is written by **our own** client, which is typechecked against this same catalogue, so a
 * key the daemon does not have is a *bug in us* rather than a build difference — and the failure a
 * lenient params schema would hide is the one this product keeps deleting features over: a control
 * that silently does nothing. The one reachable skew case (a newer window's brand-new settings
 * control, an older daemon) is confined to that single control, because the window sends only the
 * fields the user actually changed, and it arrives as a loud refusal beside the "different builds"
 * sentence — which is the honest outcome rather than a worse one.
 */
export interface RpcMethodSpec {
  params: z.ZodTypeAny;
  result: z.ZodTypeAny;
}

const EmptyParams = z.object({}).strict().optional();

/**
 * Every method, its parameters and its result.
 *
 * Grouped by the question it answers, because that is how a client consumes them: the rail asks for
 * projects and tasks, the pane asks for a run, settings asks for settings.
 */
export const RPC_SPECS: Readonly<Record<RpcMethod, RpcMethodSpec>> = Object.freeze({
  /* — who am I talking to, and what does this daemon do — */
  "coder.hello": {
    params: z
      .object({
        client: z
          .object({
            name: z.string().min(1),
            version: z.string().optional(),
            platform: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    result: z
      .object({
        product: z.string().min(1),
        version: z.string(),
        /**
         * Identity of this *process*, not of the product.
         *
         * Two different daemons both answer `product: "EnvoyDev"`, so the product name cannot
         * tell the shell's daemon from a squatter on the same port. The shell writes this value
         * into the lock file before the window connects, and the window refuses a hello that does
         * not carry it — "something is listening" and "our daemon is listening" are different
         * answers, which is the lesson the family's own Tauri shell paid for.
         */
        instanceId: z.string().min(1),
        home: z.string(),
        stateDir: z.string(),
        startedAt: z.string(),
        windowCount: z.number().int().positive(),
        methods: z.array(z.string()).readonly(),
        mesh: CoderMeshStatusSchema,
        /** Anything the user should know at startup: a quarantined file, a refused attach. */
        notes: z.array(z.string()).readonly(),
      })
      .strict(),
  },

  /* — events — */
  "coder.subscribe": {
    params: z
      .object({
        /**
         * Which events this connection wants. Omitted means all of them.
         *
         * Named explicitly rather than implicitly because the phone will want a subset: a task
         * list on a metered connection does not need every token of every running transcript.
         */
        events: z.array(z.string()).readonly().optional(),
      })
      .strict()
      .optional(),
    result: z.object({ subscribed: z.array(z.string()).readonly() }).strict(),
  },

  /* — projects — */
  "coder.listProjects": {    params: EmptyParams,
    result: z.object({ projects: z.array(ProjectSchema).readonly() }).strict(),
  },
  "coder.addProject": {
    params: z
      .object({
        path: z.string().min(1),
        label: z.string().min(1).optional(),
        hostId: z.string().min(1).optional(),
        defaults: ProjectDefaultsSchema.optional(),
      })
      .strict(),
    result: z.object({ project: ProjectSchema }).strict(),
  },
  "coder.updateProject": {
    params: z
      .object({
        id: z.string().min(1),
        label: z.string().min(1).optional(),
        /**
         * The project's own defaults, and they **replace** rather than merge: a patch that carried only
         * a model would otherwise leave the harness ambiguous. `ProjectDefaultsPatchSchema` is the patch
         * shape, so `""` clears a value — see `coder.updateSettings` for why that is not just tidiness.
         */
        defaults: ProjectDefaultsPatchSchema.optional(),
        tags: z.array(z.string()).readonly().optional(),
      })
      .strict(),
    result: z.object({ project: ProjectSchema }).strict(),
  },
  "coder.removeProject": {
    params: z.object({ id: z.string().min(1) }).strict(),
    result: z
      .object({
        removed: z.string().min(1),
        /**
         * The tasks archived with it, in full.
         *
         * Removing a project must not delete its tasks: a running agent dropped out of the tree is
         * the worst outcome this app can produce, and a transcript is the user's work. They are
         * archived — out of the rail, still on disk, still reachable through search.
         */
        archived: z.array(TaskSchema).readonly(),
      })
      .strict(),
  },

  /* — tasks — */
  "coder.listTasks": {
    params: z
      .object({ projectId: z.string().min(1).optional(), includeArchived: z.boolean().optional() })
      .strict()
      .optional(),
    result: z.object({ tasks: z.array(TaskSchema).readonly() }).strict(),
  },
  "coder.createTask": {
    params: z
      .object({
        projectId: z.string().min(1),
        title: z.string(),
        /** Defaults to the project root: a quick question should not need a branch. */
        cwd: z.string().min(1).optional(),
        harness: HarnessIdSchema.optional(),
        model: z.string().optional(),
        extraArgs: z.string().optional(),
      })
      .strict(),
    result: z.object({ task: TaskSchema }).strict(),
  },
  "coder.updateTask": {
    params: z
      .object({
        id: z.string().min(1),
        title: z.string().optional(),
        pinned: z.boolean().optional(),
        harness: HarnessIdSchema.optional(),
        model: z.string().optional(),
        /**
         * Move the task to another folder.
         *
         * Applied to the **next run**, because that is the truth of it: `runs.ts` launches the agent
         * with `task.cwd`, so a run already in flight keeps the directory it started in. The window
         * says exactly that beside the control while a run is live, instead of pretending to move an
         * agent that is already working somewhere.
         *
         * Normalised and checked by the daemon the same way `coder.addProject` does it, so `~/repo`,
         * `"~/repo"` and `~/repo/` are one directory rather than three failures.
         */
        cwd: z.string().min(1).optional(),
        agentModeId: z.string().min(1).optional(),
        /**
         * The agent's own thinking level for this task (`AgentOptionValue.value`, from
         * `HarnessSummary.thinking`).
         *
         * `""` means **the agent's own default**, on exactly the terms `model` uses it: it is the
         * control's "not set" value, it can never be a level an agent publishes as a name, and it
         * arrives here as a real request — drop the stored choice rather than store a level called
         * nothing.
         */
        thinkingLevel: z.string().optional(),
        extraArgs: z.string().optional(),
      })
      .strict(),
    result: z.object({ task: TaskSchema }).strict(),
  },
  "coder.archiveTask": {
    params: z.object({ id: z.string().min(1), archived: z.boolean().optional() }).strict(),
    result: z.object({ task: TaskSchema }).strict(),
  },

  /* — runs — */
  "coder.startRun": {
    params: z
      .object({
        taskId: z.string().min(1),
        prompt: z.string().min(1),
        mode: z.enum(RUN_MODES).optional(),
        /**
         * Continue the harness's previous session instead of starting a new one.
         *
         * Here because the *handler* and the window already sent it (`service.ts` reads `input.resume`,
         * `coderStore.ts` passes it) and this spec — `.strict()` — was rejecting the call before the
         * agent was ever touched: "Unrecognized key(s) in object: 'resume'". The feature existed on both
         * ends of the wire and nowhere in the middle, which is a type of bug a `.strict()` schema is
         * supposed to catch rather than cause.
         */
        resume: z.boolean().optional(),
        /**
         * The agent's own mode for this run (`AgentMode.id`, from `HarnessSummary.modes`).
         *
         * Named `agentModeId` rather than `agentMode` so that the *value* is unambiguous: it is an id
         * the agent gave us, passed through verbatim, and not an object we assemble. `mode` above is
         * ours (`queue | steer`); this one is the agent's.
         *
         * The daemon **refuses** the call when it cannot honour it — the harness is not one we can
         * drive over ACP, its `capabilities.agentMode` is false, or the id is not one it declares —
         * rather than starting the agent in a posture the user did not ask for. Silently ignoring a
         * request for `plan` produces an agent that edits files, which is the failure this field
         * exists to prevent.
         */
        agentModeId: z.string().min(1).optional(),
        /**
         * The model for this run, provider-qualified (`AgentModel.id` from `HarnessSummary.models`).
         *
         * Sent — like `agentModeId` — as an **override for this run**, because a model the user picks in
         * the composer is applied to the run they are about to start. It is stored on the task as well
         * (`coder.updateTask.model`), so a run started after a restart uses the same model without the
         * window having to repeat it, and the daemon falls back to the task when this is absent.
         *
         * The daemon **refuses** a model it cannot take apart or that the harness does not publish,
         * rather than starting the agent on its own default: `envoy-harness` parses `--model` and then
         * ignores it unless `--provider` accompanies it, so a dropped model would leave an agent
         * answering on one model while the transcript named another.
         */
        model: z.string().min(1).optional(),
        /**
         * The agent's own thinking level for this run (`AgentOptionValue.value`).
         *
         * Sent as an **override for this run**, like `model`, and stored on the task as well
         * (`coder.updateTask.thinkingLevel`) so a run started after a restart keeps it without the
         * window repeating it. The daemon refuses the call when it cannot honour it — the agent has no
         * thought-level option in the protocol we speak to it, or this build has no way to deliver one
         * — rather than starting the agent at a depth the user did not ask for. Unlike `model`, a value
         * the agent does not currently publish is **not** refused here: the observed list came from an
         * earlier session and is a record rather than a promise, so the agent is the authority, and it
         * refuses loudly with its own sentence.
         */
        thinkingLevel: z.string().min(1).optional(),
      })
      .strict(),
    result: z.object({ run: AgentRunSchema }).strict(),
  },
  "coder.sendToRun": {
    params: z
      .object({ runId: z.string().min(1), text: z.string().min(1), mode: z.enum(RUN_MODES) })
      .strict(),
    result: z.object({ runId: z.string(), delivered: z.enum(["queued", "steered"]) }).strict(),
  },
  "coder.cancelRun": {
    params: z.object({ runId: z.string().min(1) }).strict(),
    result: z.object({ runId: z.string(), cancelled: z.boolean() }).strict(),
  },
  "coder.answerApproval": {
    params: z
      .object({
        runId: z.string().min(1),
        requestId: z.string().min(1),
        optionId: z.string().min(1),
      })
      .strict(),
    result: z.object({ runId: z.string(), requestId: z.string(), resolved: z.boolean() }).strict(),
  },
  "coder.getRun": {
    params: z.object({ runId: z.string().min(1), sinceSeq: z.number().int().nonnegative().optional() }).strict(),
    result: RunSnapshotSchema,
  },
  "coder.listRuns": {
    params: z
      .object({
        taskId: z.string().min(1).optional(),
        limit: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    result: z.object({ runs: z.array(AgentRunSchema).readonly() }).strict(),
  },
  "coder.tailRun": {
    params: z.object({ runId: z.string().min(1), sinceSeq: z.number().int().nonnegative().optional() }).strict(),
    result: RunSnapshotSchema,
  },

  /* — agents — */
  "coder.listHarnesses": {
    params: EmptyParams,
    result: z.object({ harnesses: z.array(HarnessSummarySchema).readonly() }).strict(),
  },
  /**
   * **Choose how an agent's connector is delivered** — installed, or fetched by `npx`.
   *
   * The one setting in this product that changes *what runs* rather than how it is displayed, which is why it
   * travels as its own method rather than a field on the settings patch: a refusal has to be possible (a harness
   * with no npm-published connector cannot be fetched, and asking for that must not be stored as a preference
   * that silently does nothing), and the answer has to say which delivery is now in force.
   *
   * The daemon re-reads its agent list on the next read — and emits the change, so every window's rows say what
   * the run will actually do.
   */
  "coder.setAgentDelivery": {
    params: z.object({ harness: HarnessIdSchema, delivery: z.enum(["installed", "npx"]) }).strict(),
    result: z.object({ harness: HarnessIdSchema, delivery: AgentDeliverySchema }).strict(),
  },
  /**
   * **Run the fix a row is showing** — the answer to *"can we support run the commands in EnvoyDev?"*
   *
   * ## The property this method exists to keep
   *
   * The window sends an **id and nothing else**. It cannot name a command, a shell, an argument or a
   * directory: the daemon looks the target up through the same probes that drew the row, takes the
   * `availability.fix` commands from that projection, and runs exactly those. So the command a user read is
   * the command that runs, and a window — or anything pretending to be one — cannot ask this product to
   * execute arbitrary shell.
   *
   * ## Four outcomes, and only one of them is a failure of the call
   *
   * `succeeded` and `failed` are about the command. `nothing-to-do` is the honest answer to a press that
   * arrives after the world moved — the daemon re-measures on the read, so a user who installed the program
   * in their own terminal and *then* pressed Install gets that answer rather than a command run twice.
   * `refused` is about the target: an id that is no longer in any list. Only a malformed call is a protocol
   * error; the other four are things this call found out, and a client renders them in the block the press
   * came from.
   *
   * **The output is bounded and it is a tail.** Everything here is bounded — the login-shell asks, the probe,
   * the search — and a package manager's transcript is the one thing in this product that can be genuinely
   * enormous. What a user needs from it is the end: the error, when there is one.
   */
  "coder.runFix": {
    params: z
      .object({
        target: FixTargetSchema,
      })
      .strict(),
    result: z
      .object({
        outcome: z.enum(["succeeded", "failed", "nothing-to-do", "refused"]),
        /** The exact commands, in the order they were run — the ones the row showed. */
        commands: z.array(z.string()).readonly(),
        /** The exit code of the step that stopped it, when one did. */
        exitCode: z.number().int().nullable(),
        /** The last of what the commands wrote, capped. */
        output: z.string(),
        /**
         * Why nothing ran, when nothing did — **as a key, not as a sentence.**
         *
         * The daemon writes English; this window may be in Japanese, and a refusal that arrives as prose is a
         * refusal that stays English (the same rule the error catalogue follows, one layer down). `timeout`
         * means the sequence was killed at the deadline; `unknown-target` means the id is in no list any more.
         */
        reason: z.enum(["timeout", "unknown-target"]).optional(),
      })
      .strict(),
  },
  /**
   * **Look at this machine again** — the one method whose subject is the measurement itself.
   *
   * ## Why this exists when the daemon already re-measures on every read
   *
   * It does: `coder.listHarnesses` and `coder.listCatalog` resolve each row's state from filesystem and
   * environment reads on the read, so a program installed in a directory the daemon already searches is
   * reported ready the next time a window asks. What the daemon *cannot* know is that its answer is stale: a
   * user who runs `npm install -g @agentclientprotocol/codex-acp` in their own terminal tells nobody, so the
   * page keeps the answer it last drew — and two of the daemon's own inputs are captured once per process on
   * purpose (the login shell's `PATH`, and its `command -v` answer per name; see
   * `packages/platform/src/shell-binaries.ts`). Without this method the only way to make the page current is
   * to restart something, which is exactly the thing a user should not have to do to find out whether their
   * own install worked.
   *
   * ## What it does, and what it deliberately does not return
   *
   * It re-asks the login shell for `PATH` and for every program name the daemon cares about, and then emits
   * the same `harnesses` change the boot primes emit. **It returns no list**: the window re-reads through
   * `coder.listHarnesses` — the one projection — and every *other* window hears on the bus, which a second
   * copy of the list in this result would quietly compete with.
   *
   * It starts nothing. A re-check is the cheap half of the page (`docs/settings-parity.md` §7.17.4): what an
   * agent publishes about itself still needs `coder.probeSessionOptions`, and a run still needs a task.
   */
  "coder.recheckAgents": {
    params: EmptyParams,
    result: z.object({ ok: z.literal(true) }).strict(),
  },
  /**
   * The whole catalogue, **with the cheap verdict on every row** — and still nothing started.
   *
   * It used to serve "nothing measured" and leave each row's state to a second call the user had to make,
   * one entry at a time (`coder.probeCatalogAgent`, now deleted). The consequence a client had to render was
   * *"Not checked yet"* on thirty-eight rows and a button on each; the consequence of *this* shape is that a
   * window draws all 38 rows with a verdict in the time it takes to draw them, because the answer was
   * computed before the request was served.
   *
   * **What "cheap" buys, stated so it is not mistaken for a promise about cost.** Every row's state comes
   * from filesystem and environment reads — no process, no package, no network — so serving 38 of them is
   * safe to do on every read of the list rather than once per user press. What it cannot answer is anything
   * that requires starting the agent: those facts are `coder.probeSessionOptions`'s, and they are properties
   * with a time rather than a state a row waits on.
   */
  "coder.listCatalog": {
    params: EmptyParams,
    result: z.object({ entries: z.array(CatalogEntrySchema).readonly() }).strict(),
  },
  "coder.probeHarness": {
    params: z.object({ harness: HarnessIdSchema }).strict(),
    result: z
      .object({
        harness: HarnessIdSchema,
        /**
         * The same five states `HarnessSummary.availability` carries, from the same function.
         *
         * It used to be `available: z.boolean()` — which could not express `unknown` at all, on the one
         * method whose whole job is to answer this question, so "we did not look" was unrepresentable here
         * while it was representable in the list. The resolved path is inside `availability.binary` rather
         * than beside it, so the two cannot disagree about whether anything was found.
         */
        availability: HarnessAvailabilitySchema,
        detail: z.string(),
      })
      .strict(),
  },
  /**
   * The pre-flight probe: open a session with an agent and keep what it publishes about itself.
   *
   * ## What it is for
   *
   * The model list and the thinking levels of both native harnesses exist **only inside a session**, so
   * before a first run the window had two choices and both were bad: ask the user to type
   * `provider/model` from memory, or render an empty picker. This asks the agent instead — the same
   * question a run asks, at the same point in the session's life, and records the answer through the
   * same store path (`CoderStore.recordSessionOptions`), so there is one shape of truth and the window
   * needs no new rendering path.
   *
   * ## `force`
   *
   * The daemon answers from a recent observation when it has one — a probe is a process spawn, and a
   * window that re-renders a pane must not spawn an agent each time (see `session-probe.ts` for the
   * staleness window and the build fingerprint). `force: true` means "ask the agent, not your notes",
   * and it is what the window's *Ask again* sends: a user who presses a button means it.
   *
   * ## Compatibility, stated rather than discovered
   *
   * This is a **new method**, not a new field on an existing result. An older daemon refuses it by name,
   * which is the skew the window already handles (`missingMethods`/`coder.hello`'s `methods`, and the
   * "restart EnvoyDev so both come from one build" sentence) — so the open asymmetry §7.2 of
   * `docs/settings-parity.md` records for a *stricter result schema* is not widened here: nothing in an
   * older daemon's answers changes shape.
   */
  "coder.probeSessionOptions": {
    params: z
      .object({
        harness: HarnessIdSchema,
        /**
         * Ask the agent rather than answering from a recent observation. Optional, and absent means
         * "your notes are fine" — which is what a window asks when it merely needs the list.
         */
        force: z.boolean().optional(),
      })
      .strict(),
    result: z
      .object({
        harness: HarnessIdSchema,
        /** Required, for the reason `PROBE_OUTCOMES` gives: a failure must not read as an answer. */
        outcome: ProbeOutcomeSchema,
        /**
         * The evidence, or the reason we could not ask — one English sentence, with its catalogue key
         * attached when this daemon wrote it (`keyed()`).
         *
         * Rendered by the window for `"unreachable"` and for `"none"` (where it is the daemon saying
         * what happened, in the user's language); for `"listed"` the store's own record supersedes it,
         * and it stays as the evidence a maintainer and the tests read.
         */
        detail: z.string().min(1),
      })
      .strict(),
  },

  /* — agents a user declared — */
  /**
   * The providers this user has declared, each probed.
   *
   * `params: EmptyParams` and a full list, rather than a per-id probe method: a list is what a window
   * renders, and the probe is what makes each row's state a fact rather than a stored claim. A provider
   * whose program is missing costs one search per call, which is the same price `coder.listHarnesses`
   * already pays for nine agents.
   */
  "coder.listProviders": {
    params: EmptyParams,
    result: z.object({ providers: z.array(AgentProviderSummarySchema).readonly() }).strict(),
  },
  /**
   * Declare an agent of the user's own.
   *
   * ## What is required, and the one field that is not
   *
   * `transport` is **required**, with no default. A default is us choosing a dialect on the user's behalf
   * for a program we cannot see, and the two possible outcomes are both bad: defaulting to `"acp"` makes a
   * one-shot CLI get an `initialize` it will never answer, and defaulting to `"cli"` tells a user their
   * ACP agent is unsupported. The catalogue records this fact per entry for the same reason
   * (`AgentLaunch.transport`: "being installed is not being drivable"); here the user is the one who
   * knows it.
   *
   * `id` is optional and derived from the label when absent, so a UI can offer one field. `args` and `env`
   * are optional and mean "none", which is a normal answer rather than a missing one.
   *
   * ## The refusals it carries
   *
   *   * an `id` that names one of the nine agents we ship → `envoydev.provider-id-taken` with a
   *     translated sentence, because the parameters were exactly what the user meant;
   *   * an `env` entry that is a **value** rather than an environment variable name →
   *     `envoydev.bad-request` with `error.providerEnvNotAName`, the same refusal shape
   *     `AgentProviderConfigSchema` enforces in the file. The name of the *variable* is quoted in the
   *     sentence; the thing the user pasted is never echoed, because a refused value is still a secret.
   */
  "coder.addProvider": {
    params: z
      .object({
        /**
         * The id, derived from the label when absent.
         *
         * Validated by the daemon against `PROVIDER_ID_PATTERN` and refused with a translated sentence
         * rather than here, so the failure a user sees names the rule in their own language instead of
         * quoting a regular expression.
         */
        id: z.string().min(1).optional(),
        label: z.string().min(1),
        command: z.string().min(1),
        args: z.array(z.string()).readonly().optional(),
        /**
         * The **names** of the environment variables the agent needs.
         *
         * `z.array(z.string().min(1))` rather than the stricter name pattern, so the daemon can refuse a
         * value with a keyed sentence (`error.providerEnvNotAName`) instead of this schema's English
         * parameter dump. The pattern is still the rule — `AgentProviderConfigSchema` is what enforces it,
         * and it is what the store parses before anything is written.
         */
        env: z.array(z.string().min(1)).readonly().optional(),
        /**
         * The catalogue entry this provider **is**, when the caller is adding one.
         *
         * The only thing about a catalogue recipe's constants that crosses this wire. The daemon looks the
         * entry up and refuses (`error.providerCatalogMismatch`) unless the `command`, `args`, `transport`
         * and `env` the caller sent are that entry's own — so the reference can only ever mean "this
         * provider is that recipe", never "give me that recipe's variables".
         *
         * **There is deliberately no `envDefaults` / `envValues` parameter beside it**, and that is the
         * whole design: the field a value belongs in is exactly the field a user would paste a credential
         * into, and this schema is `.strict()`, so a client that invented one is refused here rather than
         * stored. `test/providers.test.ts` asserts the negative with a real key.
         */
        catalogEntryId: z.string().min(1).optional(),
        transport: z.enum(["acp", "cli"]),
        authMethodId: z.string().min(1).optional(),
        modeParam: z.enum(["mode", "modeId"]).optional(),
      })
      .strict(),
    result: z.object({ provider: AgentProviderConfigSchema }).strict(),
  },
  /**
   * Forget a provider.
   *
   * Nothing else is touched: unlike `coder.removeProject` there are no rows that referred to it, because a
   * provider is a *recipe* and a task names one of the nine shipped agents. If a later slice lets a task
   * run on a provider, that slice owes the same archived-not-deleted treatment `removeProject` gives
   * tasks — which is why this result carries only the id it removed.
   */
  "coder.removeProvider": {
    params: z.object({ id: z.string().min(1) }).strict(),
    result: z.object({ removed: z.string().min(1) }).strict(),
  },
  /**
   * Trigger the agent's own sign-in flow, and say truthfully what happened.
   *
   * The result is a `SignInOutcome` plus a keyed sentence and the **auth state that follows** — so a client
   * can update the row it pressed the button on without a second call, and a second window is told through
   * the store's own change event.
   *
   * `methodId` is the caller's choice and never ours: it is passed only if the **agent advertised it** in
   * `initialize`, so a value a caller invented is never sent to the agent and never stored (the daemon
   * refuses it into the `no-method` outcome rather than quoting it back, because a string a caller supplied
   * where a method id belongs is very often something else entirely).
   */
  "coder.signInAgent": {
    params: z
      .object({
        harness: HarnessIdSchema,
        /** One of the agent's own advertised methods. Absent means "use what the catalogue declares". */
        methodId: z.string().min(1).optional(),
      })
      .strict(),
    result: z
      .object({
        harness: HarnessIdSchema,
        outcome: SignInOutcomeSchema,
        /** A keyed sentence in the user's language, with the agent's own words as a value. */
        detail: z.string().min(1),
        /** What this attempt established — the same fact `HarnessSummary.auth` now carries. */
        auth: HarnessAuthSchema,
      })
      .strict(),
  },

  /* — the mesh — */
  "coder.meshStatus": {
    params: EmptyParams,
    result: z.object({ mesh: CoderMeshStatusSchema }).strict(),
  },
  "coder.listPeers": {
    params: EmptyParams,
    result: z.object({ peers: z.array(CoderPeerSchema).readonly() }).strict(),
  },

  /* — paired phones — */
  "coder.mintPairing": {
    params: z
      .object({
        /** Shown in Settings → This machine. Defaults to "Phone". */
        deviceLabel: z.string().min(1).max(80).optional(),
        /**
         * Reachable host for the QR's `wsUrl` (LAN IP, tailnet, public IP, or domain). Absent → first
         * non-loopback address, then `127.0.0.1` (useful only for same-machine tests). Hostname only —
         * the daemon's bound port is appended when the URI is built.
         */
        host: z.string().min(1).optional(),
        /** Preferable LAN address for `lanWsUrl`. */
        lanHost: z.string().min(1).optional(),
        /**
         * User-chosen short token for the host:port (typed) route. Absent → daemon mints a long random
         * secret for QR scan (the phone never types it). When present: 8–10 alphanumeric characters.
         */
        token: z
          .string()
          .min(8)
          .max(10)
          .regex(/^[A-Za-z0-9]+$/, "token must be 8–10 letters or digits")
          .optional(),
        /**
         * QR path only: mint a **new** secret even when an unused QR code already exists.
         * Absent / false → reuse the newest unused QR (stops Pairing-on-open from stacking rows).
         */
        fresh: z.boolean().optional(),
      })
      .strict(),
    result: z
      .object({
        /** Full `envoy://pair?…` URI — contains the secret token; show as QR, never log. */
        uri: z.string().min(1),
        device: z
          .object({
            id: z.string().min(1),
            deviceLabel: z.string().min(1),
            createdAt: z.string().min(1),
            expiresAt: z.string().min(1),
            revokedAt: z.string().min(1).optional(),
            lastSeenAt: z.string().min(1).optional(),
          })
          .strict(),
      })
      .strict(),
  },
  "coder.listPairedDevices": {
    params: EmptyParams,
    result: z
      .object({
        devices: z
          .array(
            z
              .object({
                id: z.string().min(1),
                deviceLabel: z.string().min(1),
                createdAt: z.string().min(1),
                expiresAt: z.string().min(1),
                revokedAt: z.string().min(1).optional(),
                lastSeenAt: z.string().min(1).optional(),
              })
              .strict(),
          )
          .readonly(),
      })
      .strict(),
  },
  "coder.revokePairedDevice": {
    params: z.object({ id: z.string().min(1) }).strict(),
    result: z
      .object({
        device: z
          .object({
            id: z.string().min(1),
            deviceLabel: z.string().min(1),
            createdAt: z.string().min(1),
            expiresAt: z.string().min(1),
            revokedAt: z.string().min(1).optional(),
            lastSeenAt: z.string().min(1).optional(),
          })
          .strict(),
      })
      .strict(),
  },
  /**
   * Forget a revoked record. The daemon refuses when the id is unknown **or** the record is not
   * revoked, so the wire cannot collapse revocation into a delete.
   */
  "coder.forgetPairedDevice": {
    params: z.object({ id: z.string().min(1) }).strict(),
    result: z
      .object({
        device: z
          .object({
            id: z.string().min(1),
            deviceLabel: z.string().min(1),
            createdAt: z.string().min(1),
            expiresAt: z.string().min(1),
            revokedAt: z.string().min(1).optional(),
            lastSeenAt: z.string().min(1).optional(),
          })
          .strict(),
      })
      .strict(),
  },

  /* — settings — */
  "coder.getSettings": {
    params: EmptyParams,
    result: z.object({ settings: CoderSettingsSchema }).strict(),
  },
  "coder.updateSettings": {
    params: z
      .object({
        settings: z
          .object({
            /**
             * `""` is **"clear it"**, not a path: the control that can choose a folder has to be able
             * to empty it, and `{defaultProjectPath: undefined}` survives `JSON.stringify` as nothing
             * at all. The store drops the key rather than storing an empty string, so the *stored*
             * document keeps the `min(1)` rule `CoderSettingsSchema` states.
             */
            defaultProjectPath: z.string().optional(),
            defaults: ProjectDefaultsPatchSchema.optional(),
            requireApprovalForDestructive: z.boolean().optional(),
            keepTranscripts: z.boolean().optional(),
            /**
             * The language the UI speaks. Validated here, against the same closed list the picker
             * offers (`CODER_LANGUAGES`), so an unknown value is refused at the wire rather than
             * stored and rendered as a language nobody has.
             */
            language: CoderLanguageSchema.optional(),
          })
          .strict(),
      })
      .strict(),
    result: z.object({ settings: CoderSettingsSchema }).strict(),
  },
});

export type { CoderSettings };
export { CoderSettingsSchema };

/**
 * Parse a method's params, or throw a coded failure naming the method and the field.
 *
 * The daemon parses **inside** the dispatcher rather than trusting its caller: a phone on an older
 * build is the normal case in this family, and a bad parameter should come back as a readable
 * refusal rather than as `undefined is not an object` from three frames deeper.
 *
 * **No `messageKey`, deliberately.** This refusal names an internal RPC method and a parameter path,
 * and quotes a Zod message: it is addressed to whoever wrote the client. A translated version would
 * be a German sentence wrapped around English identifiers — worse than the sentence an engineer can
 * act on, and no more useful to a user. Every refusal a user *can* read carries a key; this one is a
 * bug report.
 */
export function parseRpcParams(method: RpcMethod, params: unknown): unknown {
  const parsed = RPC_SPECS[method].params.safeParse(params);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? issue.path.join(".") : "params";
  throw coderError(
    ENVOYDEV_ERRORS.badRequest,
    `${method} was called with an unusable "${where}": ${issue?.message ?? "invalid"}`,
  );
}

/** Catalogue methods with no spec. Empty is the only healthy answer; the test asserts it. */
export function missingRpcSpecs(): RpcMethod[] {
  return RPC_METHODS.filter((method) => !(method in RPC_SPECS));
}

/** Specs naming a method the catalogue does not have — the other half of the same check. */
export function orphanRpcSpecs(): string[] {
  return Object.keys(RPC_SPECS).filter((method) => !(RPC_METHODS as readonly string[]).includes(method));
}
