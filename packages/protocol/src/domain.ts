/**
 * EnvoyCoder's domain: the nouns the daemon, the window and the phone all agree on.
 *
 * ## Why this is a separate protocol from EnvoyMesh's
 *
 * EnvoyMesh's JSON-RPC surface is the *mesh's* — identity, bonds, chat, discovery. It belongs
 * to the host node and every product shares it. EnvoyCoder's own surface is about projects,
 * tasks and agent runs, which no other product has an opinion about.
 *
 * The two meet in exactly two places, and both are imported rather than redefined:
 *
 *   * the **pairing claim** (`app=EnvoyCoder`), so a QR is refused by the wrong app — the
 *     builder/parser live in `@envoymesh/protocol` and this package only carries the name;
 *   * the **mesh attach**, where EnvoyCoder presents a product session to a running EnvoyMesh
 *     node and may call the methods that node grants it (`@envoymesh/host-connect`).
 *
 * Everything else here is single-product: if EnvoyMesh changed its chat schema tomorrow,
 * nothing in this file would notice, which is the point.
 *
 * ## This module versus `rpc.ts`
 *
 * The *nouns* live here; the *wire* — the JSON-RPC envelope, the per-method parameter and result
 * schemas, the event names — lives in `rpc.ts`, which imports from here. The split is not
 * cosmetic: `zod` schemas are built at module-evaluation time, so one file that both defined
 * `HarnessIdSchema` and used it to build a method table would only work by accident of import
 * order.
 */

import { z } from "zod";

/** The product name this app states in every pairing code and product session. */
export const ENVOYCODER_PRODUCT_NAME = "EnvoyCoder";

/**
 * Environment variable a launcher may set instead of hard-coding the name.
 *
 * The guide's pre-flight for this product says `ENVOYMESH_APP_NAME=EnvoyCoder` (§9), so the launcher
 * states it once and every surface — pairing codes, product sessions, logs — uses that value. The
 * fallback is **our own** name rather than the family default: `resolveAppName()` would answer
 * "EnvoyMesh" when the variable is unset, which is the one wrong answer for this app.
 */
export const ENVOYCODER_APP_NAME_ENV = "ENVOYMESH_APP_NAME";

export function coderProductName(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[ENVOYCODER_APP_NAME_ENV]?.trim();
  return raw && raw.length > 0 ? raw : ENVOYCODER_PRODUCT_NAME;
}

/**
 * The capability this product exists to use, owner-granted on the node that hosts it.
 *
 * The guide is blunt about the default (§4.7): until the owner runs
 * `updateNodeConfig({ productGrants: { EnvoyCoder: ["coding"] } })`, the node refuses this product
 * the coding surface it exists for. The read fails closed, so a product must treat "not granted" as
 * a normal state to report — not as an error to retry.
 */
export const CAPABILITY_CODING = "coding";

/**
 * Environment variable that overrides the daemon's port.
 *
 * `0` is a legal value and means "let the OS choose", which is how the tests and the smoke run: a
 * fixed port in a test is a test that fails when something else on the machine happens to use it.
 */
export const ENVOYCODER_DAEMON_PORT_ENV = "ENVOYCODER_DAEMON_PORT";

/** Default port for the EnvoyCoder daemon's WebSocket endpoint. */
export const DEFAULT_DAEMON_PORT = 4770;

/** Default path the daemon serves its RPC on. */
export const DEFAULT_DAEMON_PATH = "/ws";

/** Default SSH port used by the mobile app's "connect over SSH" path. */
export const DEFAULT_SSH_PORT = 22;

/* ────────────────────────────── agents (harnesses) ───────────────────────────── */

/**
 * A coding agent EnvoyCoder can drive.
 *
 * Two tiers, and the tier is a promise about who maintains the integration:
 *
 *   * `native` — shipped and understood by this project (`envoy-harness`, `deepseek-harness`);
 *   * `external` — a third-party CLI that EnvoyCoder knows how to launch and stream from. The
 *     list mirrors what Paseo supports, because that is the baseline users expect, and the
 *     integration is ours: we launch their binary and parse their output.
 */
export const HARNESS_IDS = [
  "envoy-harness",
  "deepseek-harness",
  "claudecode",
  "codex",
  "copilot",
  "opencode",
  "cursor",
  "pi",
  "omp",
] as const;

export type HarnessId = (typeof HARNESS_IDS)[number];

/**
 * The agents EnvoyCoder **ships and stands behind**.
 *
 * One, deliberately: `envoy-harness` is the agent that lives in this product — no external install, no
 * third-party release cadence, and the one whose capabilities we can state because we run it. Everything
 * else, including the two other harnesses we author recipes for, is *catalogued* (below).
 *
 * This is Paseo's shape, adopted on purpose: Paseo compiles in the handful of providers it drives with
 * its own client code and catalogues the rest, because a built-in is a promise, and the list of agents a
 * user might have installed is far longer than the list we can verify.
 */
export const BUILT_IN_HARNESSES: readonly HarnessId[] = ["envoy-harness"];

/**
 * Everything else: supported by driving an installed (or fetched) program.
 *
 * `deepseek-harness` sits here rather than with the built-in even though it is *first-party* — we author
 * its recipe and verified it against the real binary. The distinction is not who wrote the entry, it is
 * what a user must do to use it: `dsh` is a program they install, so calling it built-in would be untrue
 * in the one place it matters (a machine with nothing installed).
 */
export const CATALOGUED_HARNESSES: readonly HarnessId[] = [
  "deepseek-harness",
  "claudecode",
  "codex",
  "copilot",
  "opencode",
  "cursor",
  "pi",
  "omp",
];

/**
 * The wire form of a harness id — `z.enum(HARNESS_IDS)` rather than a hand-written list, so a new agent
 * cannot be added to the nouns without the wire accepting it.
 */
export const HarnessIdSchema = z.enum(HARNESS_IDS);

/**
 * True when a value names *any* agent we support — built-in or catalogued.
 *
 * The guard exists because harness ids arrive from two untrusted places: a user's settings file and the
 * wire. `HarnessIdSchema` is the wire's copy of this rule; this is the one callers use in code, and
 * having both is deliberate (a schema for parsing, a predicate for branching) — the tests assert they
 * agree rather than hoping they do.
 */
export function isHarnessId(value: string): value is HarnessId {
  return (HARNESS_IDS as readonly string[]).includes(value.trim());
}

/** True for the agents we ship. Kept as a function so the question has one implementation. */
export function isBuiltInHarness(value: string): boolean {
  return (BUILT_IN_HARNESSES as readonly string[]).includes(value.trim());
}

/* ────────────────────────────── the domain ───────────────────────────── */

/**
 * A **project** is a registered root — a directory on a host that the user has said "this is
 * somewhere I work". It carries the defaults new tasks inherit.
 *
 * The naming and the relationship are inherited deliberately (see `docs/envoycoder-ui.md`):
 * a project is a *place*, a task is a *task in that place*. Keeping them distinct is what
 * makes the sidebar legible when ten agents are running across four repositories.
 */
export interface Project {
  /** Stable id for the project. Derived from host + path, so two clients agree. */
  id: string;
  /** Absolute path on `hostId`. */
  path: string;
  /** Display label — the folder name, or a rename. */
  label: string;
  /** Which machine this path is on (`"local"` or a paired host id). */
  hostId: string;
  addedAt: string;
  /** Defaults inherited by new tasks under this project. */
  defaults?: TaskDefaults;
  /** VCS hint, discovered or set. */
  vcs?: { kind: "git" | "jj" | "none"; branch?: string };
  /** Free-form tags, for filtering. */
  tags?: readonly string[];
}

export interface TaskDefaults {
  harness?: HarnessId;
  /** Provider-qualified model, e.g. `anthropic/claude-sonnet-4.5`, `deepseek/deepseek-v4`. */
  model?: string;
  /** Extra argv handed to the harness, as the user typed it. */
  extraArgs?: string;
}

/**
 * A **task** is one task: a working directory, the agent assigned to it, and its state.
 *
 * It is intentionally *not* a git worktree, though it usually has one. A task can point at
 * the project root itself (quick question, no branch), a worktree (parallel feature work), or
 * any subdirectory (a monorepo package) — the sidebar shows the difference by path, not by
 * inventing a second entity.
 */
export interface Task {
  id: string;
  projectId: string;
  /** Absolute working directory for the agent. */
  cwd: string;
  /** What the user asked for, shown as the row title. */
  title: string;
  harness: HarnessId;
  /** Provider-qualified model actually used (defaults resolved at creation). */
  model?: string;
  /**
   * The agent's own mode for this task (`AgentMode.id`), once one has been chosen.
   *
   * On the task, and not only on the start call, for the same reason `harness` and `model` are: how
   * the agent should behave is part of what the task *is*, so the next run — from this window, from
   * the phone, or after a restart — starts the way the user left it. Absent means "whatever the agent
   * does by default", which is a different statement from naming that default explicitly.
   *
   * It is a bare id rather than a nested `AgentMode`: the catalogue is what knows the labels, and a
   * task file that carried a copy of them would show a user last release's wording.
   */
  agentModeId?: string;
  /**
   * The agent's own id for how much it should think before it answers.
   *
   * The value is the **agent's**: `deepseek-harness` publishes `off | low | high | max` in its session
   * configuration and validates whatever it is handed, so this is stored as the agent wrote it — the
   * label on screen and the value on the wire are two different things, and only one of them is a
   * translation.
   *
   * On the task for the same reason `agentModeId` and `model` are: it is part of what the task *is*, so
   * a run started after a restart — or from the phone — uses the same thinking level without the caller
   * having to repeat it. Absent means "whatever the agent does by default", which is where a task
   * starts and where clearing the choice returns it to.
   *
   * The agent's own name for the option is `reasoning_effort` (ACP category `thought_level`); ours is
   * thinking, because that is the word on the pill and the word a user reads.
   */
  thinkingLevel?: string;
  extraArgs?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /** The live agent run, when one exists. */
  runId?: string;
  /** Worktree/branch this task is bound to, when it has one. */
  worktree?: { path: string; branch: string };
  /** Set when the task is executing on another machine (distributed mode). */
  hostId?: string;
  pinned?: boolean;
  archivedAt?: string;
}

/**
 * Status buckets, chosen to answer the only question the sidebar has to answer at a glance:
 * *does this need me?*
 *
 * `needs-attention` is deliberately separate from `running`: an agent that is waiting for
 * approval is not making progress, and burying that in "running" is how a control plane makes
 * users wait on it.
 */
export const TASK_STATUSES = [
  "queued",
  "running",
  "needs-attention",
  "idle",
  "done",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/** Does this status want the human? Used by the sidebar, notifications and the badge count. */
export function statusNeedsHuman(status: TaskStatus): boolean {
  return status === "needs-attention" || status === "failed";
}

export function statusIsActive(status: TaskStatus): boolean {
  return status === "queued" || status === "running" || status === "needs-attention";
}

/* ────────────────────────────── runs and events ───────────────────────────── */

/**
 * How a message typed while a run is in flight is delivered.
 *
 * `queue` waits for the turn to finish; `steer` joins the turn in progress. It is a value on the
 * wire rather than a client-side preference because the *transcript* has to record which one
 * happened — see `run.message` — and because the phone, a second window and a reload must all agree
 * about what was sent. Paseo makes the same distinction at its composer and calls the two
 * "Queue" and "Steer"; this is the part of that idea that has to survive the trip to disk.
 */
/**
 * **An agent's own execution mode** — not to be confused with `RUN_MODES` below.
 *
 * Two different things share the word "mode", and keeping them apart is the point of this comment:
 *
 *   * `AgentMode` (here) is the agent's *permission posture* — Paseo calls these `plan`, `acceptEdits`,
 *     `bypassPermissions` for Claude, `auto-review`/`full-access` for Codex, `build`/`plan` for
 *     OpenCode. It is chosen per run and passed *to the agent*.
 *   * `RUN_MODES` (`queue | steer`) is what *our* composer does with a message sent while a turn is
 *     already running. It never reaches the agent.
 *
 * They were both called `mode` on the wire, which is how a client ends up sending "plan" where the
 * daemon expects "queue". The composer's field keeps the name `mode` because it is already in use and
 * documented; the agent's mode is `agentModeId`, and `coder.startRun` takes it beside `mode` — see the
 * note on that spec, which also says what the daemon does when the agent cannot be put into a mode at
 * all (it refuses the run rather than starting it in a posture the user did not ask for).
 */
export interface AgentMode {
  /** The agent's own id for the mode, passed through verbatim. */
  id: string;
  /** What a user reads in the picker. */
  label: string;
  /** One line explaining the posture, when the agent offers one. */
  description?: string;
  /**
   * Catalogue keys for `label` and `description` — the same mechanism `coderError` uses for its
   * refusals, applied to data instead of to a failure.
   *
   * `label` and `description` are prose *we* wrote when the mode is ours to name (the three
   * `envoy-harness` modes are its `ModeKind`, labelled by us), and a German window must not read an
   * English sentence we authored. A mode a third-party agent named itself arrives without these keys,
   * and the window shows the agent's own words — which is the rule the approval prompt's option
   * labels already follow.
   *
   * Plain `string` rather than a `MessageKey`, because this type is the *wire's*: the protocol cannot
   * know a window's catalogue. The consumer checks (`isMessageKey`) and falls back to `label`, so a
   * key from a build one version ahead renders the sentence rather than `mode.plan.label`.
   */
  labelKey?: string;
  descriptionKey?: string;
  /**
   * The most-permissioned no-prompt mode — "just do it" — when the agent has one.
   *
   * Paseo calls this `isUnattended` and uses it for scheduled and unattended runs. We mark it but do not
   * yet offer unattended runs; the field exists so the *data* is honest, not to imply the feature.
   */
  unattended?: boolean;
}

export const AgentModeSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    labelKey: z.string().optional(),
    descriptionKey: z.string().optional(),
    unattended: z.boolean().optional(),
  })
  .strict();

export const RUN_MODES = ["queue", "steer"] as const;

export type RunMode = (typeof RUN_MODES)[number];

export function isRunMode(value: string): value is RunMode {
  return (RUN_MODES as readonly string[]).includes(value);
}

export interface AgentRun {
  id: string;
  taskId: string;
  harness: HarnessId;
  model?: string;
  /**
   * The agent's own thinking-level id this run was started with, when one was chosen.
   *
   * Recorded beside `model` and for the same reason: the transcript should be able to say what the
   * agent was actually asked for, and a run whose thinking level had been dropped on the way would
   * otherwise look identical to one that ran on the agent's own default. Absent means the agent chose.
   */
  thinkingLevel?: string;
  /** OS process id of the harness, when it is a child process of the daemon. */
  pid?: number;
  hostId: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  status: TaskStatus;
  /** Where the transcript is stored, relative to the product state dir. */
  transcriptPath?: string;
}

/**
 * The event stream a client subscribes to.
 *
 * EnvoyCoder streams *runs*, not raw stdout: a client renders a transcript, an approval prompt
 * and a diff, and the daemon is the only thing that knows which harness produced them. This is
 * the same shape Paseo's daemon exposes to its clients (see `docs/envoycoder-paseo-inheritance.md`),
 * which is what lets a thin mobile client show a rich run.
 */
export const RUN_EVENT_KINDS = [
  "run.started",
  "run.session",
  "run.output",
  "run.thought",
  "run.message",
  "run.tool",
  "run.approval-requested",
  "run.approval-resolved",
  "run.diff",
  "run.usage",
  "run.status",
  "run.ended",
] as const;

export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

export interface RunEventBase {
  runId: string;
  taskId: string;
  at: string;
  /** Monotonic per run, so a client can detect a gap and ask for a replay. */
  seq: number;
}

export type RunEvent =
  | (RunEventBase & {
      kind: "run.started";
      harness: HarnessId;
      model?: string;
      /** The thinking level the run was started with, as the agent's own id. See `AgentRun`. */
      thinkingLevel?: string;
      hostId: string;
    })
  | (RunEventBase & {
      kind: "run.session";
      /**
       * The agent's own name for this conversation, and whether it can be rejoined.
       *
       * It is an event rather than a field on `AgentRun` because it is only known once the agent has
       * answered, and a run that cannot be resumed must say *that* rather than carry a null the UI
       * has to interpret. "Resume" is what makes a cancelled task recoverable rather than lost.
       */
      sessionId: string;
      resumable: boolean;
      /** How the run was started: a fresh session, or an earlier one rejoined. */
      resumed: boolean;
    })
  | (RunEventBase & {
      kind: "run.output";
      stream: "stdout" | "stderr" | "assistant";
      text: string;
      /**
       * Which message this text belongs to.
       *
       * Streaming arrives as fragments, and the *client* decides how to render them — so the
       * fragments have to be attributable to one message, or a transcript interleaves two replies
       * the moment an agent emits anything concurrently. Paseo's equivalent carries the same field
       * for the same reason (`agent_thought_chunk`/`agent_message_chunk` both take a `messageId`).
       */
      messageId?: string;
    })
  | (RunEventBase & {
      kind: "run.thought";
      /**
       * The agent's reasoning, kept apart from what it says to the user.
       *
       * Deliberately a separate kind, not `run.output` with a flag: reasoning is usually long, often
       * irrelevant, and must be collapsible — a client that has to parse a flag to know whether it
       * is rendering the answer or the thinking about it will get it wrong once and never notice.
       */
      text: string;
      messageId?: string;
    })
  | (RunEventBase & {
      kind: "run.message";
      /**
       * A message the *human* sent, rendered in the transcript beside the agent's replies.
       *
       * It is an event rather than client-side state on purpose: Queue and Steer deliver the same
       * words differently, and the only way a user can see which happened is for the transcript
       * itself to record it — the mode is on the event, and it survives a reload, a second window
       * and the phone.
       */
      text: string;
      mode: RunMode;
      /** `queue` waits for the turn in flight; `steer` joins it. Set when the daemon delivered it. */
      delivered: "queued" | "steered";
    })
  | (RunEventBase & {
      kind: "run.tool";
      /**
       * The agent's id for this call, which is what pairs a start with its result.
       *
       * ACP emits a `tool_call` and later a `tool_call_update` carrying only this id
       * (`packages/acp/acp/src/updates.ts`, both functions), so a client that keyed on the tool's
       * *name* would merge two concurrent calls to the same tool into one row.
       */
      callId: string;
      /** The agent's own label for the call — free text, shown as-is. */
      name: string;
      /**
       * What the call is doing.
       *
       * `running` and the two terminal states arrive as separate events with the same `callId`;
       * the client folds them. `status` is the shape ACP uses (`in_progress` → `completed` or
       * `failed`), renamed here to the words the rest of this protocol uses for a run.
       */
      status: "running" | "completed" | "failed";
      input?: unknown;
      output?: unknown;
    })
  | (RunEventBase & {
      kind: "run.approval-requested";
      requestId: string;
      /** End-user phrasing, not the harness's own vocabulary. */
      question: string;
      detail?: string;
      options: readonly { id: string; label: string; destructive?: boolean }[];
    })
  | (RunEventBase & { kind: "run.approval-resolved"; requestId: string; optionId: string; by: string })
  | (RunEventBase & { kind: "run.diff"; files: readonly { path: string; added: number; removed: number }[] })
  | (RunEventBase & {
      kind: "run.usage";
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
      /**
       * How full the agent's context is, when the agent reports it.
       *
       * ACP's `usage_update` carries `used` and `size`, and it is the one number that answers "is
       * this run about to fall over?" before it does. Left optional because most agents do not
       * report it at all, and inventing a zero would render a healthy empty bar.
       */
      contextUsed?: number;
      contextSize?: number;
    })
  | (RunEventBase & { kind: "run.status"; status: TaskStatus; note?: string })
  | (RunEventBase & { kind: "run.ended"; exitCode: number | null; status: TaskStatus });

/* ────────────────────────────── errors ───────────────────────────── */

/**
 * Wire error codes.
 *
 * These are the *client-facing* catalogue, so they are stable strings rather than exception
 * classes: a mobile client on another OS must be able to branch on them without importing our
 * TypeScript. Codes are `envoycoder.*` so they cannot collide with the mesh's own catalogue.
 */
export const ENVOYCODER_ERRORS = {
  /** No daemon is listening where the client expected one. */
  daemonUnreachable: "envoycoder.daemon-unreachable",
  /** The client's token is missing, expired or from another host. */
  unauthorized: "envoycoder.unauthorized",
  /**
   * Something is listening where the daemon should be, but it is not this daemon.
   *
   * Distinct from `daemonUnreachable` on purpose: "nobody is home" and "a stranger is" call for
   * different words in front of a user, and only the second is worth being careful about.
   */
  notOurDaemon: "envoycoder.not-our-daemon",
  /** A call arrived with parameters this build cannot use — the caller's bug, said out loud. */
  badRequest: "envoycoder.bad-request",
  /** A pairing code was minted by a different app in the family. */
  appMismatch: "envoycoder.app-mismatch",
  /** The harness binary is not installed (or not on PATH). */
  harnessMissing: "envoycoder.harness-missing",
  /**
   * The agent exists and is installed, but speaks a protocol this product cannot drive yet.
   *
   * Distinct from `harness-missing` on purpose: "install it" is wrong advice for an agent that is
   * already there, and the two failures send a user to different places.
   */
  harnessUnsupported: "envoycoder.harness-unsupported",
  /** The harness refused to start (bad config, unsupported arg). */
  harnessFailed: "envoycoder.harness-failed",
  /**
   * A directory the call named is gone, or is not a directory.
   *
   * Four different refusals used to ride on `taskMissing` — this, plus a missing task, a missing
   * project and a missing run — which made the code useless to the caller it exists for: the family's
   * transport flattens `error.code` to `"ERROR"`, so a client branches on the leading `envoycoder.*`
   * token, and `task-missing` coming back from `coder.addProject` says the wrong thing about what to do
   * next ("pick another folder" is not "reload the list").
   */
  pathMissing: "envoycoder.path-missing",
  /** No task with that id. */
  taskMissing: "envoycoder.task-missing",
  /** No project with that id. */
  projectMissing: "envoycoder.project-missing",
  /** No run with that id — typically a daemon that restarted under a window that was still open. */
  runMissing: "envoycoder.run-missing",
  /** The mesh node refused the product session, or granted it fewer methods. */
  meshRefused: "envoycoder.mesh-refused",
  /** We asked a peer to run something and the peer declined. */
  peerRefused: "envoycoder.peer-refused",
  /** The operation is not supported on this platform. */
  unsupportedPlatform: "envoycoder.unsupported-platform",
} as const;

export type EnvoyCoderErrorCode = (typeof ENVOYCODER_ERRORS)[keyof typeof ENVOYCODER_ERRORS];

/* ────────────────────────────── pairing ───────────────────────────── */

/**
 * The connection information a mobile client needs, as carried in an EnvoyMesh pairing code.
 *
 * EnvoyCoder does not invent a QR format. It uses the family's (`@envoymesh/protocol`), so one
 * camera path works for every app and the `app` claim is what keeps them apart.
 */
export interface CoderHostDescriptor {
  /** `host:port` the daemon serves on, as reachable from the client's network. */
  endpoint: string;
  /** Owner identity the daemon belongs to, so a client can refuse a stranger's code. */
  ownerId: string;
  /** Product name, always `EnvoyCoder` for this app. */
  app: string;
  /** Optional SSH hop for machines that are not directly reachable. */
  ssh?: { host: string; port: number; user?: string };
  /** TLS/wss when the daemon sits behind a proxy. */
  secure?: boolean;
}

/* ────────────────────────────── rpc ───────────────────────────── */

/**
 * The daemon's method catalogue, with the transport-agnostic param/result schemas.
 *
 * Kept as data rather than prose so the router, the clients and the docs cannot disagree: the
 * generated method list is what a client's typed stub is built from, and a method that exists
 * in one place and not the others fails a test rather than a user's evening.
 */
export const RPC_METHODS = [
  "coder.hello",
  /**
   * Subscribe this connection to the daemon's events.
   *
   * **Handled before the dispatcher**, by the product's socket-method port, so a client should not
   * expect to find it in the handler table — but it belongs in the catalogue, because it is part of
   * our protocol surface and a client's typed stub must know it exists. See `rpc.ts` for why
   * subscription is per-connection rather than a broadcast the transport fans out.
   */
  "coder.subscribe",
  "coder.listProjects",
  "coder.addProject",
  "coder.updateProject",
  "coder.removeProject",
  "coder.listTasks",
  "coder.createTask",
  "coder.updateTask",
  "coder.archiveTask",
  "coder.startRun",
  "coder.sendToRun",
  "coder.cancelRun",
  "coder.answerApproval",
  "coder.getRun",
  "coder.listRuns",
  "coder.tailRun",
  "coder.listHarnesses",
  "coder.probeHarness",
  "coder.meshStatus",
  "coder.listPeers",
  "coder.offerRemoteRun",
  "coder.getSettings",
  "coder.updateSettings",
] as const;

export type RpcMethod = (typeof RPC_METHODS)[number];

export const RpcMethodSchema = z.enum(RPC_METHODS);

export function isRpcMethod(value: string): value is RpcMethod {
  return (RPC_METHODS as readonly string[]).includes(value);
}

/**
 * Which of *this build's* methods the daemon we are talking to does not have.
 *
 * `coder.hello` already carries the daemon's own `RPC_METHODS` — the list compiled into *its* bundle —
 * which is the honest answer to "are the window and its daemon the same build?". They are two
 * artifacts started at different times, and the family's rule D2 (one owner at a time, everyone else
 * attaches) means starting the app does **not** replace a daemon that is already holding the port: so
 * after an upgrade the new window can end up talking to the old daemon, which is exactly what happened
 * here — the window asked for `coder.listTasks`, a method added since, and got `Method not found`.
 *
 * Comparing the two lists answers that at *connect* time instead of at the first failed call, and it
 * needs nothing new on the wire, because both halves already describe themselves.
 *
 * Two deliberate asymmetries:
 *
 *   * A daemon with **more** methods is the newer half; that is not skew and nothing is reported.
 *   * An **empty** advertised list means the daemon does not describe itself at all — a build from
 *     before this field carried anything. That is not evidence that every method is missing, so
 *     `missingMethods` returns nothing and the window falls back to letting the calls speak. Reporting
 *     "your daemon lacks all 20 methods" there would be a worse lie than the one this prevents.
 */
export function missingMethods(advertised: readonly string[]): RpcMethod[] {
  if (advertised.length === 0) return [];
  const has = new Set(advertised);
  return RPC_METHODS.filter((method) => !has.has(method));
}

/* ────────────────────────────── language ───────────────────────────── */

/**
 * The languages this product speaks — **the family's seven**, defined here because the setting that
 * chooses one is part of the wire.
 *
 * The list is `apps/desktop/src/i18n/locales.ts`'s, not a second one: that file derives `LOCALES`
 * from this tuple, so the picker, the resolver and the settings schema cannot disagree about which
 * languages exist. `"system"` is a *preference*, not a locale — it resolves to one of the others
 * from what the platform reports, at render time.
 *
 * It lives in the protocol rather than in the app because a client stores it: the phone will read
 * and write the same field over the same RPC, and a client that invented its own list would be able
 * to save a value the daemon then refuses.
 */
export const CODER_LANGUAGES = ["system", "en", "zh", "de", "fr", "it", "ja", "ko"] as const;

export type CoderLanguage = (typeof CODER_LANGUAGES)[number];

/** The preference a user has not expressed yet. */
export const DEFAULT_CODER_LANGUAGE: CoderLanguage = "system";

export const CoderLanguageSchema = z.enum(CODER_LANGUAGES);

/* ────────────────────────────── settings ───────────────────────────── */

export interface CoderSettings {
  /** Where new projects default to when the user does not pick. */
  defaultProjectPath?: string;
  /** Defaults for new tasks when the project does not override them. */
  defaults: TaskDefaults;
  /** Ask before running anything a harness marks destructive. Default: true. */
  requireApprovalForDestructive: boolean;
  /** Share this machine's agents with peers on the mesh. Default: false (fail-closed). */
  allowRemoteRuns: boolean;
  /** Keep a run's transcript on disk after it ends. */
  keepTranscripts: boolean;
  /**
   * The language the UI speaks, **including what the daemon says**.
   *
   * Optional so a settings file written by an older build still parses; absent means `"system"`.
   * Stored here rather than in the window's `localStorage` on purpose: it is a per-user preference,
   * the daemon already owns settings, and a value in the webview's storage would be one the phone
   * and a second window could not see (and which a cleared webview cache would silently lose).
   */
  language?: CoderLanguage;
}

export const DEFAULT_CODER_SETTINGS: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  allowRemoteRuns: false,
  keepTranscripts: true,
  language: DEFAULT_CODER_LANGUAGE,
};

const ProjectDefaultsSchema = z
  .object({
    harness: HarnessIdSchema.optional(),
    model: z.string().min(1).optional(),
    extraArgs: z.string().optional(),
  })
  .strict();

export const CoderSettingsSchema = z
  .object({
    defaultProjectPath: z.string().min(1).optional(),
    defaults: ProjectDefaultsSchema,
    requireApprovalForDestructive: z.boolean(),
    allowRemoteRuns: z.boolean(),
    keepTranscripts: z.boolean(),
    // Optional, and validated against the same closed list the app's picker offers: a client that
    // asked for a language nobody translated is a client bug the daemon should refuse, not store.
    language: CoderLanguageSchema.optional(),
  })
  .strict();

export function parseCoderSettings(value: unknown): CoderSettings {
  return CoderSettingsSchema.parse(value);
}
