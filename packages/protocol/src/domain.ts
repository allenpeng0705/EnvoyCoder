/**
 * EnvoyDev's domain: the nouns the daemon, the window and the phone all agree on.
 *
 * ## Why this is a separate protocol from EnvoyMesh's
 *
 * EnvoyMesh's JSON-RPC surface is the *mesh's* — identity, bonds, chat, discovery. It belongs
 * to the host node and every product shares it. EnvoyDev's own surface is about projects,
 * tasks and agent runs, which no other product has an opinion about.
 *
 * The two meet in exactly two places, and both are imported rather than redefined:
 *
 *   * the **pairing claim** (`app=EnvoyDev`), so a QR is refused by the wrong app — the
 *     builder/parser live in `@envoymesh/protocol` and this package only carries the name;
 *   * the **mesh attach**, where EnvoyDev presents a product session to a running EnvoyMesh
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
export const ENVOYDEV_PRODUCT_NAME = "EnvoyDev";

/**
 * Environment variable a launcher may set instead of hard-coding the name.
 *
 * The guide's pre-flight for this product says `ENVOYMESH_APP_NAME=EnvoyDev` (§9), so the launcher
 * states it once and every surface — pairing codes, product sessions, logs — uses that value. The
 * fallback is **our own** name rather than the family default: `resolveAppName()` would answer
 * "EnvoyMesh" when the variable is unset, which is the one wrong answer for this app.
 */
export const ENVOYDEV_APP_NAME_ENV = "ENVOYMESH_APP_NAME";

export function coderProductName(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[ENVOYDEV_APP_NAME_ENV]?.trim();
  return raw && raw.length > 0 ? raw : ENVOYDEV_PRODUCT_NAME;
}

/**
 * The capability this product exists to use, owner-granted on the node that hosts it.
 *
 * The guide is blunt about the default (§4.7): until the owner runs
 * `updateNodeConfig({ productGrants: { EnvoyDev: ["coding"] } })`, the node refuses this product
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
export const ENVOYDEV_DAEMON_PORT_ENV = "ENVOYDEV_DAEMON_PORT";

/** Default port for the EnvoyDev daemon's WebSocket endpoint. */
export const DEFAULT_DAEMON_PORT = 4770;

/** Default path the daemon serves its RPC on. */
export const DEFAULT_DAEMON_PATH = "/ws";

/** Default SSH port used by the mobile app's "connect over SSH" path. */
export const DEFAULT_SSH_PORT = 22;

/* ────────────────────────────── agents (harnesses) ───────────────────────────── */

/**
 * A coding agent EnvoyDev can drive.
 *
 * Two tiers, and the tier is a promise about who maintains the integration:
 *
 *   * `native` — shipped and understood by this project (`envoy-harness`, `deepseek-harness`);
 *   * `external` — a third-party CLI that EnvoyDev knows how to launch and stream from. The
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
 * The agents EnvoyDev **ships and stands behind**.
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

/* ──────────────────────── agents a user declares themselves ──────────────────────── */

/**
 * The id shape a user's own provider may take.
 *
 * A lowercase slug rather than free text, because this value is written to `providers.json`, travels on
 * the wire, and is what every refusal about it names. Two ids differing only in case are two rows a user
 * cannot tell apart in a list they read by eye, and one of them would be whichever the file happened to
 * be sorted into. Lowercase also makes the one collision worth refusing easy to state — see
 * `AgentProviderConfigSchema`, which refuses an id that names an agent we already ship.
 */
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * What an environment variable **name** looks like — and why this is a pattern rather than `min(1)`.
 *
 * `AgentProviderConfig.env` holds names, and this is the rule that keeps it that: a name is
 * `[A-Za-z_][A-Za-z0-9_]*`, and a credential is not. `sk-live-…`, `Bearer eyJ…`, a path to a key file, a
 * base64 blob — every shape a key actually takes contains a character a name cannot. The pattern is
 * therefore not decoration on top of the "names, never values" decision; it is the half of that decision
 * a machine can check, and `test/providers.test.ts` asserts it rejects a value that looks like a key.
 */
export const PROVIDER_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * An environment variable name that **means the value is somebody's credential** — and the one rule that
 * lets a reviewed recipe carry a constant without opening a door for a user's secret.
 *
 * ## Why a name pattern decides this, and not a length or an entropy heuristic
 *
 * A recipe we publish may set `AUGMENT_DISABLE_AUTO_UPDATE: "1"`: the name says *what the flag is for* and
 * the value is a constant of a command line anybody can read. `ANTHROPIC_API_KEY`, by contrast, names a
 * slot whose whole purpose is to hold a secret — and it does so whatever value happens to sit in it today.
 * So the honest test is on the **name**, which is a fact we can check, rather than on the value, where
 * "does this look random enough" is a guess that both misses real keys and fires on real flags.
 *
 * ## The pattern, and why it is anchored to segments
 *
 * `NAME` is split by `_` for the purpose of this test, and a credential word must be a **whole segment**:
 *
 *   * `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `DB_PASSWD`, `AUTH_TOKEN` → refused;
 *   * `AUGMENT_DISABLE_AUTO_UPDATE`, `FACTORY_DROID_AUTO_UPDATE_ENABLED`, `GJC_ACP_PERMISSION_MODE`,
 *     `VT_ACP_ENABLED` → allowed, which is what keeps all four catalogued recipes working.
 *
 * The anchoring is the point rather than the decoration: a bare substring test for `KEY` refuses
 * `MONKEY`, and a bare substring test for `AUTH` refuses `AUTHOR` — which is exactly the class of false
 * positive that gets a rule switched off instead of fixed. The second alternative catches the
 * concatenated spelling (`OPENAI_APIKEY`) **without** a `$KEY` free-for-all: only the distinctive words
 * may end a name, so `MONKEY` and `TURKEY` stay ordinary.
 *
 * ## Where it is enforced
 *
 *   * a **catalogue entry's** environment values (`CatalogEntrySchema.env`, and
 *     `agent-catalog`'s own projection): our data, and a credential there is a mistake in this repository
 *     rather than a user's business, so it is refused loudly;
 *   * a **wire claim** that a recipe supplied a value (`AgentProviderEnvStateSchema.from`), for the same
 *     reason one layer out;
 *   * **not** a user's own `AgentProviderConfig.env` — naming `ANTHROPIC_API_KEY` there is the entire
 *     point of the names-only rule (§7.10), and the value still never leaves the daemon's environment.
 */
export const CREDENTIAL_ENV_NAME_PATTERN =
  /(?:^|_)(?:KEY|KEYS|APIKEY|API_KEY|TOKEN|TOKENS|SECRET|SECRETS|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|CREDENTIALS|AUTH|AUTHORIZATION|AUTHORISATION|BEARER|COOKIE|ACCESS_KEY|PRIVATE_KEY)(?:_|$)|(?:APIKEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PASSWD)$/i;

/** The predicate form, for the branches that need it — `isHarnessId`/`HarnessIdSchema`'s arrangement. */
export function looksLikeCredentialEnvName(name: string): boolean {
  return CREDENTIAL_ENV_NAME_PATTERN.test(name);
}

/**
 * An agent **the user declared** — the ACP provider config, which is how a program we have never heard of
 * becomes runnable without a release of this product.
 *
 * ## Why the shape cannot express a secret, and why that is the whole design
 *
 * This project has deliberately refused to store credentials: it declined to copy the reference
 * product's providers page partly because an `env` map of *values* keeps API keys in plaintext in a
 * config file. So `env` here is a list of environment variable **names**, and the value is read from the
 * daemon's own environment when the agent is spawned. The security property is not a rule written in a
 * doc next to the schema — it is the type:
 *
 *   * `env: readonly string[]` **cannot** hold `{"ANTHROPIC_API_KEY": "sk-live-…"}`. There is no field
 *     for the right-hand side, so no caller, no UI and no future migration can write one to disk. This
 *     is what "the shape is the enforcement" means, and `test/providers.test.ts` asserts it rather than
 *     trusting the paragraph: a secret placed in the daemon's environment never appears in the file that
 *     is written, nor in the answer that is served.
 *   * A name that is present but unset in the daemon's environment is **reported per agent** — in the
 *     summary the window reads, and as a keyed refusal at launch. Silently skipping it would start an
 *     agent that cannot authenticate and blame the agent; defaulting it would be a claim about a
 *     credential we do not have. (The one exception is a variable a **catalogue entry** declares a
 *     constant for, and it is not a default of a credential: see `catalogEntryId` below.)
 *   * Nothing here is ever logged or echoed. Diagnostics name the variable and say `set` / `not set` —
 *     and, for a value that came from a recipe, say *that* rather than pretending the daemon had it.
 *
 * ## The dialect, reused rather than reinvented
 *
 * `transport`, `authMethodId` and `modeParam` are the same three facts, spelled the same way, that
 * `AgentLaunch` records for the catalogue entries (`packages/agent-catalog/src/index.ts`): whether the
 * program speaks ACP at all, which `authenticate` method it needs before it will open a session, and
 * which field name its `session/set_mode` reads. A provider is mapped onto an `AgentLaunch` rather than
 * given a private launch vocabulary, which is what lets it travel the *same* launch path as a catalogue
 * entry instead of a second one written from memory.
 *
 * ## What is deliberately absent
 *
 * There is no `model` / `models` field and no `capabilities` block. We have never run this program, so
 * any capability here would be the user's guess restated as our fact — and the whole point of a probe is
 * that we find out instead. A provider takes a model the only way we can honestly offer one: whatever
 * the user put in `args`, which is theirs and is passed through verbatim.
 *
 * ## `catalogEntryId` is a **reference**, and it is how a reviewed recipe's constants reach a launch
 *
 * Four catalogued recipes set six environment variables (`AUGMENT_DISABLE_AUTO_UPDATE`,
 * `DROID_DISABLE_AUTO_UPDATE`, `FACTORY_DROID_AUTO_UPDATE_ENABLED`, `GJC_ACP_PERMISSION_MODE`,
 * `VT_ACP_ENABLED`, `VT_ACP_ZED_ENABLED`), and every one of them is a constant of a command line
 * *we* publish — `1`, `true`, `prompt` — not a credential. Refusing to carry them made those four
 * recipes unusable for no safety gain, and the distinction that fixes it honestly is **whose data it
 * is**:
 *
 *   * a **catalogue entry** is our own reviewed, git-tracked data, so it may declare a non-secret
 *     default (`AcpAgentEntry.env`, refused if a name looks like a credential —
 *     `CREDENTIAL_ENV_NAME_PATTERN`);
 *   * a **provider config** still has **no field for a value**. What it may carry is the *name of the
 *     entry it was added from*, and the daemon resolves the entry's constants from the catalogue at
 *     launch and at summary time.
 *
 * So `providers.json` cannot hold a value at all — not ours and not a user's — which is a strictly
 * stronger property than "a user may not write one". A hand-edited file that invents a reference is not
 * a hole either: the daemon **verifies** that the referenced entry's recipe is the recipe the provider
 * states (`command`, `args`, `transport` and the environment names must all agree) and refuses by name
 * when it does not, so the reference can only ever mean "this provider *is* that entry".
 */
export interface AgentProviderConfig {
  /** Stable id, unique among providers and never one of `HARNESS_IDS`. */
  id: string;
  /** What a user sees in the agent list. */
  label: string;
  /**
   * The program to spawn — a bare name to look up on the search path, or an absolute path.
   *
   * Never a shell string: it is passed to `spawn` as the executable, so `foo && rm -rf /` is a file name
   * that does not exist rather than a command.
   */
  command: string;
  /** The argv after the command, each element passed through verbatim. */
  args: readonly string[];
  /**
   * Environment variables to give the agent, **by name**.
   *
   * Each is copied from the daemon's own environment at spawn (see the interface doc: a value cannot be
   * expressed here, which is the point). Empty is a normal answer, not a missing one. For a provider
   * added from a catalogue entry, a name the entry declares a constant for is supplied from the
   * catalogue instead — and only when the daemon's own environment does not have it, so a user's own
   * value always wins.
   */
  env: readonly string[];
  /** How the daemon must speak to this program. `"cli"` is startable but not yet drivable. */
  transport: "acp" | "cli";
  /**
   * The **catalogue entry** this provider was added from, when it was — a reference, never a value.
   *
   * See the interface doc for why this exists and what the daemon checks before believing it. Absent
   * means "a command the user typed", which is the case that has no constants to resolve.
   */
  catalogEntryId?: string;
  /** The ACP `authenticate` method this agent needs before it will open a session, when it needs one. */
  authMethodId?: string;
  /** Which field name this agent's `session/set_mode` reads. */
  modeParam?: "mode" | "modeId";
}

/**
 * The stored and served shape of a user's provider, with its agreements enforced.
 *
 * Four rules, and each is a contradiction the shape would otherwise allow to travel:
 *
 *   1. **The id is not one of the nine we ship.** `id` is the key a list is searched by and the word every
 *      refusal names, so a provider called `codex` would be a second row with a shipped agent's name — and
 *      which one a caller meant would depend on which list it happened to consult. The daemon refuses this
 *      at the wire with a sentence in the user's language; this refuses it in the file, so a hand-edited
 *      `providers.json` cannot smuggle one in past the handler.
 *   2. **The two dialect fields belong to ACP.** A `"cli"` program has no `authenticate` method and no
 *      `session/set_mode` at all, so carrying either would be a launch that reads a field nothing will
 *      ever ask it for — the shape promising a step that cannot happen.
 *   3. **No repeated environment name.** Two identical names are one variable, and a list that says
 *      otherwise makes "which of these is unset" unanswerable.
 *   4. **A reference names a catalogue entry, and only a catalogue entry can.** `catalogEntryId` is the
 *      same slug shape as an id, and it may not be the provider's own id — a provider that claimed to be
 *      the entry it says it came from would be a reference to itself, which resolves to nothing and reads
 *      as though something had been checked.
 */
export const AgentProviderConfigSchema = z
  .object({
    id: z.string().min(1).max(64).regex(PROVIDER_ID_PATTERN, "expected a lowercase id like `my-agent`"),
    label: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).readonly(),
    /**
     * Names, each checked against `PROVIDER_ENV_NAME_PATTERN`. The value a user might paste in place of a
     * name is exactly what this rejects, and the failure message names the variable slot rather than
     * echoing what was typed — a refused value is still a secret, and it must not reach a log.
     */
    env: z
      .array(
        z
          .string()
          .regex(PROVIDER_ENV_NAME_PATTERN, "expected the name of an environment variable, not its value"),
      )
      .readonly(),
    transport: z.enum(["acp", "cli"]),
    /**
     * The catalogue entry this provider was added from. **A name, and the only thing about a value this
     * shape can carry** — see `AgentProviderConfig` for the resolution and for the daemon's check.
     */
    catalogEntryId: z.string().min(1).max(64).regex(PROVIDER_ID_PATTERN, "expected a catalogue entry id").optional(),
    authMethodId: z.string().min(1).optional(),
    modeParam: z.enum(["mode", "modeId"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
    if (isHarnessId(value.id)) {
      fail(
        `"${value.id}" is the id of an agent EnvoyDev already ships, and a provider may not take it — ` +
          `the two rows would be indistinguishable wherever an id is the key`,
        "id",
      );
    }
    if (value.transport !== "acp" && (value.authMethodId !== undefined || value.modeParam !== undefined)) {
      fail(
        `a "${value.transport}" program has no ACP session to authenticate or to set a mode on, so it ` +
          `must not declare authMethodId or modeParam`,
        value.authMethodId !== undefined ? "authMethodId" : "modeParam",
      );
    }
    const seen = new Set<string>();
    value.env.forEach((name, index) => {
      if (seen.has(name)) fail(`"${name}" is named twice, and one variable is one variable`, `env.${index}`);
      seen.add(name);
    });
    if (value.catalogEntryId === value.id) {
      fail(
        `a provider cannot be the catalogue entry it says it came from — the reference would resolve to ` +
          `the provider itself`,
        "catalogEntryId",
      );
    }
  });

/* ────────────────────────────── the domain ───────────────────────────── */

/**
 * A **project** is a registered root — a directory on a host that the user has said "this is
 * somewhere I work". It carries the defaults new tasks inherit.
 *
 * The naming and the relationship are inherited deliberately (see `docs/envoydev-ui.md`):
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
  /**
   * Codex / Claude Fast, when the user has turned it on or off.
   *
   * Absent means the agent decides. Stored even when this build cannot deliver it yet: Fast is not an
   * ACP option the bridges publish, and dropping the choice would make the toggle forget itself.
   */
  fastMode?: boolean;
  /**
   * Codex Plan (`collaboration_mode` `plan`), when the user has chosen.
   *
   * Not the same thing as the mode picker: that one is how much the agent may do, this one is
   * planning-only collaboration. Absent means the agent's own default (`default`).
   */
  planMode?: boolean;
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
  /**
   * The mode a new task should show when the user has not chosen one.
   *
   * One list should mark at most one. DeepSeek lists Read only first and marks Workspace change,
   * because that is the process default when `DSH_PERMISSION_MODE` is unset.
   */
  preferred?: boolean;
}

export const AgentModeSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    labelKey: z.string().optional(),
    descriptionKey: z.string().optional(),
    unattended: z.boolean().optional(),
    preferred: z.boolean().optional(),
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
 * EnvoyDev streams *runs*, not raw stdout: a client renders a transcript, an approval prompt
 * and a diff, and the daemon is the only thing that knows which harness produced them. This is
 * the same shape Paseo's daemon exposes to its clients (see `docs/envoydev-paseo-inheritance.md`),
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
  "run.commands",
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
      /**
       * How the card is answered. Absent means one exclusive choice (a permission, or a
       * single-pick question). `many` is checkboxes; `text` is a typed answer.
       */
      selection?: "one" | "many" | "text";
      /** A typed answer may be several lines. Ignored unless `selection` is `text`. */
      multiline?: boolean;
    })
  | (RunEventBase & {
      kind: "run.approval-resolved";
      requestId: string;
      optionId: string;
      /** Every id chosen, when the card asked for more than one. */
      optionIds?: readonly string[];
      by: string;
    })
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
  | (RunEventBase & {
      kind: "run.commands";
      /**
       * The slash commands this agent says it accepts, newest list wins.
       *
       * They arrive as an ACP `available_commands_update`, which is how Claude, Codex, Cursor and the
       * harnesses publish `/compact` and the rest. The list is the agent's, not a catalogue we keep:
       * a command the agent did not name is one we must not offer.
       */
      commands: readonly { name: string; description: string; argumentHint?: string }[];
    })
  | (RunEventBase & { kind: "run.status"; status: TaskStatus; note?: string })
  | (RunEventBase & { kind: "run.ended"; exitCode: number | null; status: TaskStatus });

/* ────────────────────────────── errors ───────────────────────────── */

/**
 * Wire error codes.
 *
 * These are the *client-facing* catalogue, so they are stable strings rather than exception
 * classes: a mobile client on another OS must be able to branch on them without importing our
 * TypeScript. Codes are `envoydev.*` so they cannot collide with the mesh's own catalogue.
 */
export const ENVOYDEV_ERRORS = {
  /** No daemon is listening where the client expected one. */
  daemonUnreachable: "envoydev.daemon-unreachable",
  /** The client's token is missing, expired or from another host. */
  unauthorized: "envoydev.unauthorized",
  /**
   * Something is listening where the daemon should be, but it is not this daemon.
   *
   * Distinct from `daemonUnreachable` on purpose: "nobody is home" and "a stranger is" call for
   * different words in front of a user, and only the second is worth being careful about.
   */
  notOurDaemon: "envoydev.not-our-daemon",
  /** A call arrived with parameters this build cannot use — the caller's bug, said out loud. */
  badRequest: "envoydev.bad-request",
  /** A pairing code was minted by a different app in the family. */
  appMismatch: "envoydev.app-mismatch",
  /** The harness binary is not installed (or not on PATH). */
  harnessMissing: "envoydev.harness-missing",
  /**
   * We could not *check* whether this agent is usable, so we will not start it and will not claim it is absent.
   *
   * The third member of the same family as `harnessMissing` / `harnessUnsupported`, and it exists for the same
   * reason the other two are separate: the translated sentence a user reads must not assert something we do not
   * know. A daemon that could not assemble a search path — no `PATH` of its own, no answer from a login shell,
   * and none of the well-known tool directories — has established nothing about the agent, and answering
   * "not installed, install it and try again" would send a user to reinstall a program they already have.
   * Reached from `launchForHarness` when the probe's state is `unknown`; see `HarnessAvailability` in `rpc.ts`.
   */
  harnessUnknown: "envoydev.harness-unknown",
  /**
   * The agent exists and is installed, but speaks a protocol this product cannot drive yet.
   *
   * Distinct from `harness-missing` on purpose: "install it" is wrong advice for an agent that is
   * already there, and the two failures send a user to different places.
   */
  harnessUnsupported: "envoydev.harness-unsupported",
  /**
   * This agent's connector cannot be fetched — there is no npm package for it, so `npx` is not a route it can
   * take.
   *
   * A refusal rather than a stored preference that quietly does nothing: a delivery is a claim about *what will
   * run*, and keeping a choice the launch cannot honour would leave a row saying `Runs through npx` about an
   * agent whose first run would fail. The seven agents we ship whose adapters are in this repository are exactly
   * this case.
   */
  connectorNotFetchable: "envoydev.connector-not-fetchable",
  /** The harness refused to start (bad config, unsupported arg). */
  harnessFailed: "envoydev.harness-failed",
  /**
   * A directory the call named is gone, or is not a directory.
   *
   * Four different refusals used to ride on `taskMissing` — this, plus a missing task, a missing
   * project and a missing run — which made the code useless to the caller it exists for: the family's
   * transport flattens `error.code` to `"ERROR"`, so a client branches on the leading `envoydev.*`
   * token, and `task-missing` coming back from `coder.addProject` says the wrong thing about what to do
   * next ("pick another folder" is not "reload the list").
   */
  pathMissing: "envoydev.path-missing",
  /** No task with that id. */
  taskMissing: "envoydev.task-missing",
  /** No project with that id. */
  projectMissing: "envoydev.project-missing",
  /**
   * No provider the user declared has that id.
   *
   * `projectMissing`'s twin, and separate from it for the reason that family exists: the family's
   * transport flattens `error.code` to `"ERROR"`, so a client branches on the leading `envoydev.*`
   * token, and "no agent provider by that name" leads somewhere different from "no project by that
   * name" — one is a list the user edits, the other is the rail.
   */
  providerMissing: "envoydev.provider-missing",
  /**
   * The id a user asked to add names an agent we already ship.
   *
   * Its own code rather than `badRequest` because it is not a malformed call: the parameters are exactly
   * what was intended, and the answer is "that name is taken" — which the window renders as a sentence
   * beside the field the user typed into, in their language, rather than as a bug report.
   */
  providerIdTaken: "envoydev.provider-id-taken",
  /**
   * A provider needs an environment variable this daemon does not have.
   *
   * The refusal that keeps "we copied what you named" honest: the alternative is a silently skipped
   * variable, which produces an agent that cannot authenticate and reports *its own* failure — a sentence
   * about somebody else's product for a fact about our environment. It names the variable and never a
   * value; see `AgentProviderConfig.env`.
   */
  providerEnvUnset: "envoydev.provider-env-unset",
  /** No run with that id — typically a daemon that restarted under a window that was still open. */
  runMissing: "envoydev.run-missing",
  /** The mesh node refused the product session, or granted it fewer methods. */
  meshRefused: "envoydev.mesh-refused",
  /** We asked a peer to run something and the peer declined. */
  peerRefused: "envoydev.peer-refused",
  /** The operation is not supported on this platform. */
  unsupportedPlatform: "envoydev.unsupported-platform",
  /**
   * `git` is not on the path this daemon searched, so nothing about a repository can be read or changed.
   *
   * Its own code rather than `badRequest` because the answer is an action — install git — and because a
   * user who has a repository open on the desktop should be told that this machine, not the folder, is
   * what is missing.
   */
  gitMissing: "envoydev.git-missing",
  /**
   * The folder is not a git repository, or is one this build does not drive (`jj`, on the wire, is not
   * driven yet).
   *
   * A refusal rather than an empty answer: "no branches" for a folder that is not a repository reads as a
   * broken repository, and the sentence a user needs is about the folder.
   */
  gitNotARepository: "envoydev.git-not-a-repository",
  /**
   * Git itself refused the operation, and its own sentence is the detail.
   *
   * The `detail` the window shows is git's `stderr` — the one place in this product where a program's own
   * words are passed through, because a user who has hit a git edge case (an unrelated history, a
   * protected branch, a missing author) can only act on git's own explanation of it.
   */
  gitFailed: "envoydev.git-failed",
  /**
   * A run is live in this project, so a command that would rewrite the working tree is refused.
   *
   * The refusal that keeps two writers out of one folder: an agent part-way through an edit and a
   * `checkout` in the same tree is how a user loses work, and neither program can see the other. Reads are
   * never refused — looking is not the dangerous half.
   */
  gitBusy: "envoydev.git-busy",
  /** The name the user typed cannot be a branch name. */
  gitBranchInvalid: "envoydev.git-branch-invalid",
  /**
   * A commit was asked for with nothing staged.
   *
   * Its own code rather than `gitFailed` because it is not a failure of git's: the user asked for a commit at
   * a moment when the index was empty, and the sentence they need is about the index — git's own answer is
   * `nothing added to commit`, which reads as a complaint about their work.
   */
  gitNothingStaged: "envoydev.git-nothing-staged",
  /** A commit was asked for with a message that is empty (or only whitespace). */
  gitCommitEmpty: "envoydev.git-commit-empty",
  /**
   * A merge stopped on conflicts, and was **undone** before the refusal was raised.
   *
   * The values carry the files, because that is what a person needs: resolving them is work on their
   * machine, and this window cannot do it — the honest answer is the list and a repository left exactly as
   * it was.
   */
  gitMergeConflict: "envoydev.git-merge-conflict",
  /**
   * A pull could not fast-forward, so the histories have diverged.
   *
   * Its own code rather than `gitFailed`: nothing failed, and the action that helps is a *choice* — merge, or
   * push, or rebase — which a user can only make if the sentence says the histories diverged.
   */
  gitPullDiverged: "envoydev.git-pull-diverged",
} as const;

export type EnvoyDevErrorCode = (typeof ENVOYDEV_ERRORS)[keyof typeof ENVOYDEV_ERRORS];

/* ────────────────────────────── pairing ───────────────────────────── */

/**
 * The connection information a mobile client needs, as carried in an EnvoyMesh pairing code.
 *
 * EnvoyDev does not invent a QR format. It uses the family's (`@envoymesh/protocol`), so one
 * camera path works for every app and the `app` claim is what keeps them apart.
 */
export interface CoderHostDescriptor {
  /** `host:port` the daemon serves on, as reachable from the client's network. */
  endpoint: string;
  /** Owner identity the daemon belongs to, so a client can refuse a stranger's code. */
  ownerId: string;
  /** Product name, always `EnvoyDev` for this app. */
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
  /**
   * Where a remote folder picker starts: platform, home directory, and drive/root list.
   *
   * The phone cannot open the OS chooser on the daemon's machine. These two methods are the
   * same contract EnvoyGo already uses against EnvoyMesh (`getHomeFsInfo` / `listHomeFsEntries`),
   * namespaced under `coder.*` so the catalogue stays one closed list.
   */
  "coder.getHomeFsInfo",
  "coder.listHomeFsEntries",
  /**
   * One file from a listing, so the window can open it.
   *
   * Text, pictures, and PDFs carry their bytes. Anything else, and anything over the size cap,
   * is still an answer: the tab opens and says what it could not draw.
   */
  "coder.readHomeFsFile",
  /** An empty file or a new folder in a directory the listing already showed. */
  "coder.createHomeFsEntry",
  /**
   * Git changes in a folder: added, modified, deleted, renamed, and new files.
   *
   * The desktop explorer asks for this. `repo: false` is a normal answer — the folder is not a
   * git repository — not an error. A path that is not a directory is.
   */
  "coder.listWorktreeChanges",
  /**
   * The difference for one file in that list.
   *
   * A click in Changes opens this, not the file. A deletion is still an answer. The path has to
   * stay inside the repository.
   */
  "coder.readWorktreeDiff",
  /**
   * The repository's state, the branches it has, and the two branch actions — all on the **project's own
   * folder**, never on a task's, and all executed by the daemon on the desktop the folder lives on.
   *
   * Four methods rather than one `coder.git` with an action field: each has its own parameters and its own
   * result, and a single method with a union would let a client send a `checkout` where a `status` belongs.
   * The operations themselves are closed — the client names a branch, never a command — which is the same
   * property `coder.runFix` states for the one other place this product runs something for a user.
   */
  "coder.gitStatus",
  "coder.gitBranches",
  "coder.gitCheckout",
  "coder.gitCreateBranch", 
  /**
   * The working tree, one file at a time: stage it, unstage it, and commit what is staged.
   *
   * A commit takes the **index**, never "everything" — the window's "stage all" is a press on the list, which
   * is a decision a user makes rather than one the daemon infers from a message being typed.
   */
  "coder.gitStage",
  "coder.gitUnstage",
  "coder.gitCommit", 
  /**
   * Combining two histories, and the safe half of talking to a remote.
   *
   * `gitMerge` acts on the branch the project is on; `gitFetch` changes nothing in the working tree;
   * `gitPull` is fetch plus a **fast-forward only** step, so it cannot conflict — combining divergent
   * histories is `gitMerge`, which names the files and undoes itself.
   */
  "coder.gitMerge",
  "coder.gitFetch",
  "coder.gitPull", 
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
  /**
   * The agents a **user** declared, each with what a probe found on this machine.
   *
   * A method of its own rather than rows inside `coder.listHarnesses`, and the reason is the type rather
   * than taste: `HarnessSummary.id` is `HarnessId`, the closed nine-entry union that `harnessLabel`,
   * `resolveAgentMode`, `resolveModelDelivery` and `canApplyModel` all branch on exhaustively. A user's id
   * in that field would either have to widen the union everywhere — which is a lie about what we ship —
   * or be answered about by every one of those functions with a default, which is exactly the assertion
   * this feature must not make. The *states* are shared (`HarnessAvailability`, from the same probe);
   * the identity is what stays separate.
   */
  "coder.listProviders",
  /**
   * Declare an agent of your own: a command, its argv, and the **names** of the environment variables it
   * needs — never their values (`AgentProviderConfig`).
   *
   * Refused, with a sentence in the user's language, when the id names an agent we already ship or when
   * an environment entry is a value rather than a name. Adding an id that already exists **replaces**
   * that provider: the entry is a complete statement of how to start a program, so merging two of them
   * would leave the user with half of each — see `CoderStore.addProvider`.
   */
  "coder.addProvider",
  /** Forget a provider. Nothing is launched and nothing else is touched. */
  "coder.removeProvider",
  /**
   * **Trigger the agent's own sign-in flow**, and report truthfully whether a session opens afterwards.
   *
   * The ACP method it sends is `authenticate {methodId}`, with a method id the **agent advertised in its
   * own `initialize` answer** — the catalogue's declared one when it has one and the agent offers it,
   * otherwise the only one the agent offered, otherwise nothing at all (see `SignInOutcome`'s `no-method`;
   * choosing between several methods on the user's behalf is exactly what this product refuses to do).
   *
   * EnvoyDev stores no credential, no token and no session: the flow belongs to the agent and its state
   * lives wherever the agent puts it (`cursor-agent` writes `~/.cursor/acp-config.json`). What this method
   * owns is the *attempt* and the honest report of it — the result is one of `SIGN_IN_OUTCOMES`, and the
   * only member that means success is the one that opened a session.
   *
   * Named agents rather than providers, and the parameter type says so: a provider is not runnable by a
   * task yet and nothing in this daemon opens a session with one, so there is no flow here to trigger. When
   * a task can run on a provider, this method's `harness` becomes the same kind of id `coder.addProvider`
   * and `coder.removeProvider` already take — and that is a change to make deliberately, against a probe
   * that exists, rather than a field widened in advance.
   */
  "coder.signInAgent",
  /**
   * Ask an agent, right now, what it offers — the pre-flight probe.
   *
   * `coder.probeHarness` answers "is it installed"; this answers "what does it publish", which for both
   * native harnesses is knowable **only from a session**. It is a method of its own rather than a flag on
   * `coder.listHarnesses` because a list call that silently spawns agents is a trap: a window rendering
   * a sidebar would start every installed agent, and the user would have no way to tell why the machine
   * got busy. See `rpc.ts` for the three outcomes and the caching rules.
   */
  "coder.probeSessionOptions",
  /**
   * **The agents EnvoyDev knows how to drive but has not measured on this machine** — the catalogue,
   * served so that no client carries a copy of it.
   *
   * This is the list a control plane exists for. `coder.listHarnesses` answers for the nine agents we ship
   * and `coder.listProviders` for the ones a user typed; between them they left the 38 catalogued ACP
   * agents reachable from nowhere, so a user with Gemini CLI or Goose installed had no way to see it.
   *
   * ## Why it is on the wire rather than a constant in the window
   *
   * Two reasons, and the second is the product's whole thesis. The catalogue is authored data that lives in
   * `@envoydev/agent-catalog` — the same package the **daemon** launches from — so an app-side copy would
   * be a second answer to "what does this entry run", drifting from the one the launch uses. And the phone
   * reads this same method: a mobile client showing an agent list, or letting a user add one, must see
   * exactly the entries the desktop window sees, including the dialect each entry states. Nothing here is
   * desktop-only knowledge.
   *
   * ## What the call costs, and what it answers
   *
   * It walks no search path and starts nothing, and it still answers **every row's state** — the two are not
   * in tension, and believing they were is what produced this method's own history. A row's cheap facts (does
   * the program resolve, does the connector resolve, is it fetched on first run, are the variables the launch
   * needs present) are filesystem and environment reads, so 38 of them cost less than drawing the rows. What
   * *is* expensive — starting an agent, which for 14 of these recipes downloads a package — is a different
   * question and travels on `coder.probeSessionOptions`, as a property with the time it was observed.
   *
   * That is why there is no per-entry companion method here any more. There used to be one
   * (`coder.probeCatalogAgent`), it took **one id**, it cached its answer for ten minutes, and its existence
   * was the reason the window rendered all 38 rows as *"Not checked yet"* with a *Check* button on each. The
   * owner's report — *"I don't want user to guess, to check if we can do that"* — is why it is gone: a row
   * that has to be asked about one at a time is a chore, and the chore was the design.
   */
  /**
   * **Choose how an agent's connector is delivered**: installed, or fetched by `npx` on first run.
   *
   * A method rather than a settings field, because a refusal has to be possible — a harness with no
   * npm-published connector cannot be fetched — and because the answer names the delivery now in force.
   */
  "coder.setAgentDelivery",
  /**
   * **Run the fix a row is showing**: the window names a target by id, the daemon resolves the commands
   * through the same probes that drew the row, and runs exactly those.
   *
   * The one method in this product that executes a command on the user's behalf, which is why its shape is
   * what it is: an id and nothing else, so a window cannot name a command; and one press per run, so the
   * user is the one who decided. See `rpc.ts` for the four outcomes and the bounded output.
   */
  "coder.runFix",
  /**
   * **Look at this machine again**: re-ask the login shell where the user's programs are, then tell every
   * window the answer may have changed.
   *
   * The daemon already re-measures each row on every read, so this is not a cache to bust in the list — it is
   * the two inputs that are captured once per process (`PATH`, and `command -v` per program name) and the
   * broadcast that makes an open page current. It exists because a user who installs a bridge in their own
   * terminal has told nobody, and *"restart the app to find out whether your install worked"* is not an answer.
   */
  "coder.recheckAgents",
  "coder.listCatalog",
  "coder.meshStatus",
  "coder.listPeers",
  // **`coder.offerRemoteRun` used to sit here, and it is gone on purpose.** It was a spec with no
  // handler and no caller: it promised a client that a run could be handed to another machine, which is
  // a mesh feature rather than a settings change, and nothing in the daemon ever served it. A method in
  // this catalogue is a claim about what this product can do, so a claim nothing implements is the same
  // defect as a switch nothing reads. `docs/settings-parity.md` §8.1 records what would bring it back:
  // a peer directory (`coder.listPeers` returns an empty list today), the session store that makes the
  // remote path reachable, and a broker decision — then the method and its params are written together,
  // against a handler.
  /**
   * Mint a pairing code for a phone (or other remote client).
   *
   * Writes a token into the paired-device store and returns an `envoy://pair?…` URI the desktop shows
   * as a QR. The token *is* the session credential — `coderSessionIdentity` resolves it for remote
   * callers. Loopback-only: a phone must not mint further phones.
   */
  "coder.mintPairing",
  /** Who may reach this daemon with a pairing token — labels and timestamps, never the tokens. */
  "coder.listPairedDevices",
  /** Stop accepting a paired device's token. */
  "coder.revokePairedDevice",
  /**
   * Remove a **revoked** device's record from the list — the deliberate cleanup an owner asks for.
   *
   * The record is the evidence that a token was withdrawn (`daemon/paired-devices.ts`), so this is never
   * a side effect of revoking and never automatic pruning: an active record is refused with "revoke it
   * first", and the owner's press is the only thing that can destroy a row. Owner-window-only, exactly
   * like minting and revoking.
   */
  "coder.forgetPairedDevice",
  "coder.getSettings",
  "coder.updateSettings",
  /**
   * Read Envoy Harness LLM settings for the Agents panel — provider, model, base URL, and whether an
   * API key is stored. The key itself never travels on this wire.
   */
  "coder.getEnvoyLlm",
  /** Write Envoy Harness LLM settings (and optionally replace or clear the stored API key). */
  "coder.setEnvoyLlm",
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
  /**
   * The folder the Add-project flow starts from when the user does not pick one.
   *
   * Read by the palette's `project.add` row, which seeds its text stage with this value instead of an
   * empty field (`components/CommandCenter.tsx`). Absent — the shipped state — means the field starts
   * empty and nothing is assumed about where the user works.
   */
  defaultProjectPath?: string;
  /** Defaults for new tasks when the project does not override them. */
  defaults: TaskDefaults;
  /**
   * Ask before running anything a harness marks destructive. Default: true.
   *
   * Delivered to the agent as its own session policy (`session/set_policy { autoRun }`) at the start of
   * every run, for the agents that document such a method — `envoy-harness` does, `deepseek-harness`
   * does not. `true` asks before a command or a change (`safe-only`), not before each read. `false`
   * asks the agent to stop asking (`off`). `resolveApprovalPolicy` in the daemon owns the mapping; see
   * `docs/settings-parity.md` §7.1 for which agents it reaches and why the control is disabled, with
   * the reason on screen, for the ones it cannot.
   *
   * This field was **stored and never read** until slice 1 of that document, which is the defect the
   * `settings-coverage` test now exists to prevent.
   */
  requireApprovalForDestructive: boolean;
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
  keepTranscripts: true,
  language: DEFAULT_CODER_LANGUAGE,
};

/**
 * The defaults a *patch* may carry, which is not the same shape as the defaults a file may hold.
 *
 * Two differences, and both are about `""`:
 *
 *   * `model` and `extraArgs` accept `""` on the wire, because a control that can *choose* a value has
 *     to be able to *clear* one, and `{model: undefined}` survives `JSON.stringify` as nothing at all
 *     — the same reason `coder.updateTask` has `clearModel`. The store turns `""` into "drop the key",
 *     so `CoderSettingsSchema` below can keep requiring `min(1)` for what is actually stored.
 *   * every field is optional: a patch says what changed, not what the whole object is.
 */
export const ProjectDefaultsPatchSchema = z
  .object({
    harness: HarnessIdSchema.optional(),
    model: z.string().optional(),
    extraArgs: z.string().optional(),
  })
  .strict();

/** The stored shape: `""` is not a value a settings file may hold. */
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
    keepTranscripts: z.boolean(),
    // Optional, and validated against the same closed list the app's picker offers: a client that
    // asked for a language nobody translated is a client bug the daemon should refuse, not store.
    language: CoderLanguageSchema.optional(),
  })
  .strict();

/**
 * Settings keys this build used to store and no longer has.
 *
 * ## This list is explanatory, and it is deliberately not load-bearing
 *
 * It used to be load-bearing: `CoderSettingsSchema` is `.strict()` and a settings file that fails to
 * parse was *quarantined*, so a field dropped from the schema without an entry here would have cost an
 * upgrading user their language, their default agent and their nominated folder — the whole document
 * — over one dead key. That is the wrong failure mode for a file that is **the user's data**, and it
 * put a maintainer's memory in the critical path of every future deletion: forget the list, lose
 * somebody's settings.
 *
 * It is not how the read works any more. `readCoderSettingsDocument` below drops **any** key the schema
 * does not have — retired or never shipped by us — and keeps every key it does, so an absent entry here
 * costs a slightly less specific sentence in the startup note and nothing else. What remains is a
 * *vocabulary*: membership turns "this build does not recognise `hiddenAgents`" into the more useful
 * "this build used to have `hiddenAgents` and does not any more", which is a different sentence for the
 * user because it names a deletion rather than an unrecognised key.
 *
 * **The honest test of "not load-bearing" is that deleting this constant would break no behaviour** —
 * only the wording of two notes. `apps/desktop/test/settings-store.test.ts` asserts exactly that, with
 * the retired-key case and the never-heard-of-it case producing the same *kept settings* and different
 * sentences.
 *
 * `allowRemoteRuns` is the first entry, removed by settings slice 1: the switch promised to share this
 * machine's agents with the user's other machines, nothing read it, and `coder.offerRemoteRun` had no
 * handler (`docs/settings-parity.md` §7.1, §8.1).
 *
 * `hiddenAgents` is the second, and it is a **deletion rather than a retirement of something that merely
 * went unused**. It was a list of agent ids a user had taken out of the pickers, served as a `hidden` flag
 * on every `HarnessSummary` and `AgentProviderSummary` and read by one filter. The owner's brief for this
 * product is that a user could not *see* the agents we support, and a list filter is the subtractive answer
 * to that: it is the one control that can make an agent we ship disappear from the product's own lists. It
 * was added on a misreading of Paseo's "Enable {provider}" row — that switch decides whether Paseo's daemon
 * instantiates a provider at all, which is a fact about a daemon's wiring, not a preference over a list —
 * and `docs/settings-parity.md` §5.8 records the correction and the reasoning. What replaces it is not
 * another stored field but a **derived** rule over probed facts (`apps/desktop/src/composer/agent-for.ts`),
 * which cannot be wrong by design because there is nothing in it a user can set. A future curation, if one
 * is ever wanted, must be **additive** — a favourite that adds to a short list — so that nothing can become
 * invisible.
 */
export const RETIRED_SETTINGS_KEYS: readonly string[] = ["allowRemoteRuns", "hiddenAgents"];

/** One key a settings document carried that this build does not have. */
export interface DroppedSettingsKey {
  /** The key's path inside the document: `hiddenAgents`, or `defaults.somethingNew`. */
  readonly path: string;
  /**
   * True when this build *used to* have the key (it is in `RETIRED_SETTINGS_KEYS`), false when no build
   * of EnvoyDev ever shipped it. Two causes, two sentences — see the constant's doc.
   */
  readonly retired: boolean;
}

/**
 * What reading a settings document produced.
 *
 * **Two ways to be unusable, and they are deliberately different events.** A file that is not a settings
 * *document* at all (a list, a string, `null` — or bytes that are not JSON, which the caller detects
 * before this) is unreadable, and there is nothing to salvage: that is the quarantine case. A document
 * whose *values* this build refuses (the right key, the wrong type) is the other one, and it is refused
 * for the same reason: nothing here can guess what `keepTranscripts: "yes"` was meant to mean, and
 * guessing on a control plane's own configuration is worse than saying so.
 *
 * Neither is the case this exists for. A key we simply do not have is **not** an unreadable file: the
 * document is perfectly understood apart from a field nothing here reads, and one such key must never
 * cost the user the rest of their settings.
 */
export type CoderSettingsRead =
  | {
      readonly kind: "ok";
      readonly settings: CoderSettings;
      /** Empty in the ordinary case; the keys that were dropped, in document order, when it is not. */
      readonly dropped: readonly DroppedSettingsKey[];
    }
  | { readonly kind: "not-a-document"; readonly found: string }
  | { readonly kind: "refused"; readonly issues: string };

/**
 * Read a settings document **tolerantly by construction**: unknown keys are dropped, known ones are kept.
 *
 * ## Why this is a function in the protocol rather than a line in the daemon
 *
 * The rule it keeps is a rule about the *shape*, and the shape is here. Writing it in the daemon would
 * mean either a hand-written list of settings keys (which is the same "remember to update it" failure
 * the retired list just stopped being) or the daemon reaching into Zod internals itself. Deriving the
 * known keys from `CoderSettingsSchema` means a field added to the schema is readable the day it is
 * added, and a field removed **from** the schema is droppable the day it is removed, with no list to
 * edit in either direction.
 *
 * ## Why the schema keeps `.strict()`
 *
 * Reading is tolerant; *producing* is not. The schema is also the wire shape of `coder.getSettings`'s
 * result, and a stored document this build writes must still be one whose every key the schema knows —
 * otherwise the read path's tolerance would become a licence for the daemon to write anything. So the
 * pruning happens here, on the way in, and the parse after it stays strict: every key in `pruned` is
 * one the schema has, so `.strict()` can only fail on a *value*, which is exactly the second case above.
 *
 * Nine lines below this comment spell out the difference the whole change is about:
 * `{language: "de", keepTranscripts: true, hiddenAgents: [...]}` **parses**, with `hiddenAgents`
 * dropped and `language` kept. It used to be rejected whole, and rejection means quarantine.
 */
export function readCoderSettingsDocument(value: unknown): CoderSettingsRead {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "not-a-document", found: describeFound(value) };
  }
  const pruned = pruneUnknownSettingsKeys(CoderSettingsSchema, value, "");
  const parsed = CoderSettingsSchema.safeParse(pruned.value);
  if (!parsed.success) {
    return {
      kind: "refused",
      issues: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(the document)"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { kind: "ok", settings: parsed.data, dropped: pruned.dropped };
}

/** How a value that is not a settings document is described in a note, in end-user words. */
function describeFound(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "a list"
  return `a ${typeof value}`
}

/**
 * Drop every key the schema does not have, at every level the schema reaches.
 *
 * Recursion is the point rather than a flourish: `defaults` is an object with a `.strict()` schema of
 * its own, so a key that no build ever shipped *inside* it would have refused the whole document in
 * exactly the way a top-level unknown key did. Making one level tolerant and leaving the next strict
 * would be a fix that moves the catastrophe one object deeper.
 *
 * A key inside a value that is not an object is left alone: `defaults: "broken"` is a wrong *value*,
 * not an unknown key, and the parse after this refuses it. That division is the whole contract — prune
 * *keys*, refuse *values*.
 */
function pruneUnknownSettingsKeys(
  schema: z.ZodTypeAny,
  value: unknown,
  prefix: string,
): { value: unknown; dropped: DroppedSettingsKey[] } {
  const shape = objectShapeOf(schema);
  if (shape === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return { value, dropped: [] };
  }
  const kept: Record<string, unknown> = {};
  const dropped: DroppedSettingsKey[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const field = shape[key];
    if (field === undefined) {
      // **Reported with the path it had, and whether we used to have it.** `prefix === ""` is what makes
      // the retired list apply only to top-level keys, which is where every entry is: a nested path that
      // happened to spell `hiddenAgents` is not the field that was deleted.
      dropped.push({ path, retired: prefix === "" && RETIRED_SETTINGS_KEYS.includes(key) });
      continue;
    }
    const nested = pruneUnknownSettingsKeys(field, entry, path);
    kept[key] = nested.value;
    dropped.push(...nested.dropped);
  }
  return { value: kept, dropped };
}

/**
 * The shape of an object schema, seen through the wrappers that do not change what it is.
 *
 * `defaultProjectPath: z.string().min(1).optional()` is an optional *string*, and `language` is an
 * optional enum: neither is an object, so neither has keys to prune, and the unwrapping stops there.
 * The chain exists so that `defaults` — a required object with a `.strict()` schema of its own — is
 * found whether a later edit wraps it in `.optional()` or gives it a default.
 */
function objectShapeOf(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> | undefined {
  let current: z.ZodTypeAny = schema;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap();
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = current.removeDefault();
      continue;
    }
    break;
  }
  return current instanceof z.ZodObject ? (current.shape as Record<string, z.ZodTypeAny>) : undefined;
}

/**
 * The parse a writer uses, which stays strict.
 *
 * Kept beside the tolerant reader so the pair reads as one decision: **what we write must be a shape we
 * understand; what we read only has to contain one.** A caller that used this on a document read from
 * disk would get the old, catastrophic behaviour back.
 */
export function parseCoderSettings(value: unknown): CoderSettings {
  return CoderSettingsSchema.parse(value);
}
