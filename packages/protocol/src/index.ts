/**
 * EnvoyCoder's own wire contract: what the daemon and its clients say to each other.
 *
 * ## Why this is a separate protocol from EnvoyMesh's
 *
 * EnvoyMesh's JSON-RPC surface is the *mesh's* — identity, bonds, chat, discovery. It belongs
 * to the host node and every product shares it. EnvoyCoder's own surface is about projects,
 * workspaces and agent runs, which no other product has an opinion about.
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
] as const;

export type HarnessId = (typeof HARNESS_IDS)[number];

export const NATIVE_HARNESSES: readonly HarnessId[] = ["envoy-harness", "deepseek-harness"];

export const EXTERNAL_HARNESSES: readonly HarnessId[] = [
  "claudecode",
  "codex",
  "copilot",
  "opencode",
  "cursor",
  "pi",
];

export const HarnessIdSchema = z.enum(HARNESS_IDS);

export function isHarnessId(value: string): value is HarnessId {
  return (HARNESS_IDS as readonly string[]).includes(value.trim());
}

export function isNativeHarness(value: string): boolean {
  return (NATIVE_HARNESSES as readonly string[]).includes(value.trim());
}

/* ────────────────────────────── the domain ───────────────────────────── */

/**
 * A **project** is a registered root — a directory on a host that the user has said "this is
 * somewhere I work". It carries the defaults new workspaces inherit.
 *
 * The naming and the relationship are inherited deliberately (see `docs/envoycoder-ui.md`):
 * a project is a *place*, a workspace is a *task in that place*. Keeping them distinct is what
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
  /** Defaults inherited by new workspaces under this project. */
  defaults?: WorkspaceDefaults;
  /** VCS hint, discovered or set. */
  vcs?: { kind: "git" | "jj" | "none"; branch?: string };
  /** Free-form tags, for filtering. */
  tags?: readonly string[];
}

export interface WorkspaceDefaults {
  harness?: HarnessId;
  /** Provider-qualified model, e.g. `anthropic/claude-sonnet-4.5`, `deepseek/deepseek-v4`. */
  model?: string;
  /** Extra argv handed to the harness, as the user typed it. */
  extraArgs?: string;
}

/**
 * A **workspace** is one task: a working directory, the agent assigned to it, and its state.
 *
 * It is intentionally *not* a git worktree, though it usually has one. A workspace can point at
 * the project root itself (quick question, no branch), a worktree (parallel feature work), or
 * any subdirectory (a monorepo package) — the sidebar shows the difference by path, not by
 * inventing a second entity.
 */
export interface Workspace {
  id: string;
  projectId: string;
  /** Absolute working directory for the agent. */
  cwd: string;
  /** What the user asked for, shown as the row title. */
  title: string;
  harness: HarnessId;
  /** Provider-qualified model actually used (defaults resolved at creation). */
  model?: string;
  extraArgs?: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  /** The live agent run, when one exists. */
  runId?: string;
  /** Worktree/branch this workspace is bound to, when it has one. */
  worktree?: { path: string; branch: string };
  /** Set when the workspace is executing on another machine (distributed mode). */
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
export const WORKSPACE_STATUSES = [
  "queued",
  "running",
  "needs-attention",
  "idle",
  "done",
  "failed",
  "cancelled",
] as const;

export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export function isWorkspaceStatus(value: string): value is WorkspaceStatus {
  return (WORKSPACE_STATUSES as readonly string[]).includes(value);
}

/** Does this status want the human? Used by the sidebar, notifications and the badge count. */
export function statusNeedsHuman(status: WorkspaceStatus): boolean {
  return status === "needs-attention" || status === "failed";
}

export function statusIsActive(status: WorkspaceStatus): boolean {
  return status === "queued" || status === "running" || status === "needs-attention";
}

/* ────────────────────────────── runs and events ───────────────────────────── */

export interface AgentRun {
  id: string;
  workspaceId: string;
  harness: HarnessId;
  model?: string;
  /** OS process id of the harness, when it is a child process of the daemon. */
  pid?: number;
  hostId: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  status: WorkspaceStatus;
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
  "run.output",
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
  workspaceId: string;
  at: string;
  /** Monotonic per run, so a client can detect a gap and ask for a replay. */
  seq: number;
}

export type RunEvent =
  | (RunEventBase & { kind: "run.started"; harness: HarnessId; model?: string; hostId: string })
  | (RunEventBase & { kind: "run.output"; stream: "stdout" | "stderr" | "assistant"; text: string })
  | (RunEventBase & { kind: "run.tool"; name: string; input: unknown; output?: unknown; ok?: boolean })
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
  | (RunEventBase & { kind: "run.usage"; inputTokens?: number; outputTokens?: number; costUsd?: number })
  | (RunEventBase & { kind: "run.status"; status: WorkspaceStatus; note?: string })
  | (RunEventBase & { kind: "run.ended"; exitCode: number | null; status: WorkspaceStatus });

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
  /** A pairing code was minted by a different app in the family. */
  appMismatch: "envoycoder.app-mismatch",
  /** The harness binary is not installed (or not on PATH). */
  harnessMissing: "envoycoder.harness-missing",
  /** The harness refused to start (bad config, unsupported arg). */
  harnessFailed: "envoycoder.harness-failed",
  /** The workspace's cwd is gone or not a directory. */
  workspaceMissing: "envoycoder.workspace-missing",
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
  "coder.listProjects",
  "coder.addProject",
  "coder.updateProject",
  "coder.removeProject",
  "coder.listWorkspaces",
  "coder.createWorkspace",
  "coder.updateWorkspace",
  "coder.archiveWorkspace",
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

/* ────────────────────────────── settings ───────────────────────────── */

export interface CoderSettings {
  /** Where new projects default to when the user does not pick. */
  defaultProjectPath?: string;
  /** Defaults for new workspaces when the project does not override them. */
  defaults: WorkspaceDefaults;
  /** Ask before running anything a harness marks destructive. Default: true. */
  requireApprovalForDestructive: boolean;
  /** Share this machine's agents with peers on the mesh. Default: false (fail-closed). */
  allowRemoteRuns: boolean;
  /** Keep a run's transcript on disk after it ends. */
  keepTranscripts: boolean;
}

export const DEFAULT_CODER_SETTINGS: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  allowRemoteRuns: false,
  keepTranscripts: true,
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
  })
  .strict();

export function parseCoderSettings(value: unknown): CoderSettings {
  return CoderSettingsSchema.parse(value);
}
