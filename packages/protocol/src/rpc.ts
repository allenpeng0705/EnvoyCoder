/**
 * The wire: the envelope a client speaks, the schema of every method, and the event names.
 *
 * ## The envelope is the family's, not ours
 *
 * EnvoyCoder's daemon is hosted by `@envoymesh/reuse-host`, whose transport
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
 * so an `envoycoder.*` code cannot ride in `error.code`. It rides in the message as a leading
 * token — `"envoycoder.task-missing: /x/y is gone"` — which is exactly the convention that
 * helper implements for EnvoyMesh's own catalogue. `coderError()` produces that string and
 * `coderErrorCode()` reads it back, so both ends agree by construction rather than by everyone
 * remembering the format.
 */

import { z } from "zod";

import {
  type AgentMode,
  AgentModeSchema,
  type CoderSettings,
  CoderLanguageSchema,
  CoderSettingsSchema,
  ENVOYCODER_ERRORS,
  type EnvoyCoderErrorCode,
  type HarnessId,
  HarnessIdSchema,
  RUN_MODES,
  type RunEvent,
  type RpcMethod,
  RPC_METHODS,
  TASK_STATUSES,
  type Task,
} from "./domain.js";

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
export function coderError(code: EnvoyCoderErrorCode, message: string, ref?: CoderMessageRef): Error {
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
 * (`envoycoder.task-missing: …`) and why the key rides beside it.
 *
 * So the convention is: `<code>: <english sentence> <marker> <json>`. Everything before the marker
 * is exactly the sentence a user reads today — a log line, a `toContain` assertion and a client
 * that has never heard of this convention all keep working. Only a client that knows the marker
 * ever looks past it.
 */
const MESSAGE_REF_MARKER = " [envoycoder.key] ";

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
  code: EnvoyCoderErrorCode | null;
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
  const coded = colon > 0 && head.startsWith("envoycoder.");
  const body = coded ? message.slice(colon + 1).trim() : message;
  const { text, ref } = parseMessageRef(body);
  return {
    code: coded ? (head as EnvoyCoderErrorCode) : null,
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
export function coderErrorCode(message: string): EnvoyCoderErrorCode | null {
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
  kind: "projects" | "tasks" | "settings";
  at: string;
  ids?: readonly string[];
  /** Which window caused it, so a client can skip work it has already applied. */
  origin?: string;
}

/* ────────────────────────────── schemas for the domain ───────────────────────────── */

const TaskStatusSchema = z.enum(TASK_STATUSES);

const ProjectDefaultsSchema = z
  .object({
    harness: HarnessIdSchema.optional(),
    model: z.string().optional(),
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
 * Declared here rather than imported from `@envoycoder/host-bridge` for the same reason the mesh
 * types are not imported from EnvoyMesh: a client — the phone especially — must render this
 * without pulling the mesh's attach client into its bundle. `host-bridge` maps its own outcome onto
 * this shape, and that mapping is the one place the two can drift.
 */
export type CoderMeshStatus =
  | { kind: "attached"; scopeKey: string; ownerId: string; peerCount?: number }
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

/** One agent, as a *picker* needs it. Everything the UI promises is gated on `capabilities`. */
export interface HarnessSummary {
  id: HarnessId;
  label: string;
  tier: "built-in" | "catalogued";
  summary: string;
  /** The agent's own modes. Empty is a fact ("it declares none here"), not a missing answer. */
  modes: readonly AgentMode[];
  capabilities: {
    resume: boolean;
    cancel: boolean;
    approvals: boolean;
    structuredTools: boolean;
    streaming: boolean;
    images: boolean;
  };
  /** Whether the binary exists right now. `unknown` is honest for a harness we have not probed. */
  available: boolean | "unknown";
  installHint?: string;
  /**
   * Where the catalogue's facts came from.
   *
   * Carried on the wire so a maintainer can read it from a client, and deliberately **not rendered**:
   * it cites repositories and file paths, which is exactly what the family's wording rule puts last
   * and small — and what a user never needs to see.
   */
  evidence: string;
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
    capabilities: z
      .object({
        resume: z.boolean(),
        cancel: z.boolean(),
        approvals: z.boolean(),
        structuredTools: z.boolean(),
        streaming: z.boolean(),
        images: z.boolean(),
      })
      .strict(),
    available: z.union([z.boolean(), z.literal("unknown")]),
    installHint: z.string().optional(),
    evidence: z.string(),
  })
  .strict();

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
         * Two different daemons both answer `product: "EnvoyCoder"`, so the product name cannot
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
        defaults: ProjectDefaultsSchema.optional(),
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
  "coder.probeHarness": {
    params: z.object({ harness: HarnessIdSchema }).strict(),
    result: z
      .object({
        harness: HarnessIdSchema,
        available: z.boolean(),
        /** The resolved absolute path when we found one; absent when we did not. */
        binary: z.string().optional(),
        detail: z.string(),
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
  "coder.offerRemoteRun": {
    // The broker for a distributed run is an open decision (`docs/envoycoder-design.md` §7), so the
    // parameters are deliberately not frozen here. The method exists in the catalogue because a
    // client may already ask *whether* it is supported, and a refusal that names the reason is
    // better than an unknown-method error.
    params: z.record(z.unknown()).optional(),
    result: z.unknown(),
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
            defaultProjectPath: z.string().min(1).optional(),
            defaults: ProjectDefaultsSchema.optional(),
            requireApprovalForDestructive: z.boolean().optional(),
            allowRemoteRuns: z.boolean().optional(),
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
    ENVOYCODER_ERRORS.badRequest,
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
