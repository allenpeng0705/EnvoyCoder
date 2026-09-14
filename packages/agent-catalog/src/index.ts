/**
 * The agent catalogue: which coding agents EnvoyCoder can drive, and how.
 *
 * ## Two tiers, and why the distinction is load-bearing
 *
 * * **native** — `envoy-harness` and `deepseek-harness`. EnvoyCoder owns the integration end to
 *   end: it can run them in-process, see their tool calls as structured events, and answer an
 *   approval prompt without parsing a terminal.
 * * **external** — the CLIs the rest of the world ships (`claude`, `codex`, `copilot`,
 *   `opencode`, `cursor-agent`, `pi`). We launch the binary and interpret its output. The
 *   catalogue mirrors what Paseo supports, because that is the baseline a user arrives with.
 *
 * The tier is not decoration: it is what a UI needs to decide whether it can offer a rich diff
 * panel and structured approvals, or only a terminal and a prompt. It is also what tells a
 * maintainer where a bug lives — our adapter, or somebody else's CLI.
 *
 * ## The common denominator: ACP
 *
 * Most external agents — and both of ours — can be driven over the **Agent Client Protocol**: a
 * JSON-RPC session lifecycle (new / resume / cancel / close) with `session/update` streaming and
 * `session/request_permission` for approvals. That is why the catalogue records a `stream` dialect
 * and a capability set per harness instead of pretending every agent needs its own bespoke client:
 * one ACP adapter covers the family's built-in harness, DeepSeek Harness, and any third-party
 * agent that speaks it, and only agents with no ACP support need a bespoke argv adapter.
 *
 * The decisive evidence is in the capabilities: an agent we cannot *cancel* and cannot *ask on* is
 * not merely less pleasant — it silently denies every escalation (DeepSeek Harness's SDK profile
 * behaves exactly that way, which is why EnvoyCoder drives its `acp` profile instead).
 *
 * ## The honesty rule for this file
 *
 * Every entry carries `evidence`: where the invocation facts came from, and what is still
 * unverified. A catalogue that claims a flag it has not checked is worse than one that admits
 * ignorance, because the failure surfaces as "the agent started and then did something odd" on
 * a user's machine rather than as a failing test here. Entries marked `unverified` are the
 * worklist; `test/agent-catalog.test.ts` asserts the flags stay in sync with the ids.
 *
 * **What the tests assert about *running* them** lives in `test/drivable.test.ts`: an entry records the
 * protocol its program speaks (`transport`), and only `"acp"` entries can be launched by the adapter we
 * have. That test exists because the opposite was true for a while — six entries described one-shot CLIs
 * and were offered as ready — and because "it is installed" is not the same question as "we can drive it".
 */

import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  type AgentMode,
  type HarnessId,
  BUILT_IN_HARNESSES,
  CATALOGUED_HARNESSES,
} from "@envoycoder/protocol";
import { type PlatformId, detectPlatform, findBinary, spawnTreeOptions } from "@envoycoder/platform";

// `require` from inside an ES module, for the two filesystem questions this package asks (does the
// peer checkout exist? which repository are we in?). Kept to `require` rather than a static import
// so nothing in the catalogue pulls `node:fs` into a client bundle that only reads the catalogue.
const require = createRequire(import.meta.url);

/** How the daemon talks to an agent. */
export type AgentLaunch =
  | {
      kind: "in-process";
      /** Package that provides the runtime, resolved by the daemon. */
      module: string;
      /** What the daemon gains by running it in-process. */
      advantages: readonly string[];
    }
  | {
      kind: "child-process";
      /** Binary name(s) tried in order; the first that resolves on PATH wins. */
      binaries: readonly string[];
      /** Build the argv for a one-shot task. */
      buildArgs: (input: RunInput) => string[];
      /** How output arrives, which decides how much structure we get. */
      stream: "jsonl" | "text";
      /**
       * How the daemon must *speak* to this process — and the field that makes the difference
       * between a supported agent and a wish.
       *
       * `"acp"` means the program implements the Agent Client Protocol over stdio, which is what our
       * adapter drives (`initialize` / `session/new` / `session/prompt` / `session/request_permission`).
       * `"cli"` means it is a one-shot command line whose output we would have to parse ourselves: we
       * can *start* it — argv, environment, prompt — but nothing in this product yet understands what
       * it prints back.
       *
       * Recorded per entry because the two facts are genuinely different: **being installed is not
       * being drivable.** Before this field existed, the picker offered six agents whose programs do
       * not speak ACP, and `RunManager` — which builds an `AcpLaunch` for every harness — handed them
       * an ACP handshake they could not answer.
       */
      transport: "acp" | "cli";
      /** Extra argv for resuming a session, when the CLI supports it. */
      resumeArgs?: (sessionId: string) => string[];
      /**
       * A built entry point in the **peer checkout**, used when nothing resolves on `PATH`.
       *
       * The built-in harness is ours-to-clone, not ours-to-ship (design D4), so "is it installed?"
       * is the wrong question on a development machine: `../envoy-harness` may be built and ready
       * with no global command at all. `entry` is absolute, resolved against the repository root, and
       * launched with the Node that is running the daemon (`resolveHarnessCommand`).
       *
       * A **function**, not a string, and that is load-bearing: the catalogue is a module-level
       * object, so a value here is computed while the module is still initialising — which is how
       * this first version died with `Cannot access 'cachedRepoRoot' before initialization`. Calling
       * it at probe time also means a checkout that appears while the app is running is found, which
       * is the same reason probing is not cached.
       */
      devCheckout?: {
        entry: () => string;
        /**
         * The argv for **this** entry, which is not the installed CLI's argv.
         *
         * The built checkout ships a dedicated ACP entry (`dist/cli/acp-stdio.js`) that already
         * implies `--acp` and strips a duplicate flag, so handing it `run --acp` would be two
         * different launches of the same thing — and the wrong one. Stating it here keeps that
         * asymmetry in the catalogue, where every other launch fact lives, instead of in the daemon.
         */
        args: (input: RunInput) => string[];
      };
    };

export interface RunInput {
  prompt: string;
  /** Working directory, already absolute and platform-normalised. */
  cwd: string;
  model?: string;
  extraArgs?: string;
  /** Continue a previous session when the CLI supports it. */
  resumeSessionId?: string;
}

export interface AgentCapabilities {
  /** Can a session be resumed after the process exits? */
  resume: boolean;
  /** Is there a way to stop it other than killing the process? */
  cancel: boolean;
  /** Does it ask before doing something destructive? */
  approvals: boolean;
  /** Do we see tool calls as structured events, or only as text? */
  structuredTools: boolean;
  /** Does it stream incrementally (vs only on completion)? */
  streaming: boolean;
  /** Can it take image attachments? */
  images: boolean;
  /** Does it know about git worktrees itself, or do we manage them? */
  worktrees: "native" | "external";
}

export interface HarnessDefinition {
  id: HarnessId;
  label: string;
  tier: "built-in" | "catalogued";
  /** One line a picker can show. */
  summary: string;
  launch: AgentLaunch;
  capabilities: AgentCapabilities;
  /**
   * The modes the *agent* offers, for the composer's picker (see `AgentMode` in the protocol).
   *
   * Evidence-based, and empty where we genuinely do not know: the lists for the four third-party CLIs
   * come from Paseo's provider manifest, which drives them every day. Both first-party harnesses are
   * empty on purpose — they speak ACP, and ACP reports its session modes in the `session/new` response,
   * so a static list here would be a guess that goes stale.
   */
  modes: readonly AgentMode[];
  install?: { hint: string; url?: string };
  /** Where the facts came from. `unverified` means "confirm before relying on it". */
  evidence: string;
}

/* ────────────────────────────── the catalogue ───────────────────────────── */

export const HARNESS_CATALOG: Record<HarnessId, HarnessDefinition> = {
  "envoy-harness": {
    id: "envoy-harness",
    label: "Envoy Harness",
    tier: "built-in",
    modes: [],
    summary: "EnvoyCoder's built-in agent — structured tools, approvals and sessions.",
    launch: {
      kind: "child-process",
      // Spawned, like DeepSeek Harness, and driven over the same ACP surface.
      //
      // This entry said `in-process` and named `@envoymesh/envoy-harness` as the module to link.
      // That was wrong on the surface a product may depend on: the package's `exports` map exposes
      // only `.`, whose entry does not include the ACP server — attaching it means importing
      // `dist/protocol/acp-server.js` and building a `ProtocolSessionBackend` from the harness's
      // internals, which is the "depend on the surface, not the internals" mistake the family guide
      // §4.2 names. The **CLI** offers the same thing as a documented flag: `--acp` serves ACP
      // JSON-RPC on stdio (`../envoy-harness/packages/envoy-harness/src/cli/argv-help.ts:45`),
      // reached by the `run` subcommand (`src/cli/run.ts:123-124`).
      //
      // Nothing is lost. "In-process" was never what made cancel and approvals exact — speaking a
      // protocol that *has* `session/cancel` and `session/request_permission` is, and a spawned
      // agent has that too (`docs/envoycoder-harness.md` §2).
      binaries: ["envoy-harness", "envoy"],
      buildArgs: ({ extraArgs }) => ["run", "--acp", ...splitArgs(extraArgs)],
      stream: "jsonl",
      transport: "acp",
      resumeArgs: () => [],
      // The peer checkout: `agent-catalog` lives at `<repo>/packages/agent-catalog`, and the harness
      // is cloned beside the repo (`../envoy-harness`). Resolved at probe time against the repository
      // root, so a machine with the clone but no global install still has a working built-in agent.
      devCheckout: {
        entry: () => resolvePeerEntry("envoy-harness", "packages/envoy-harness/dist/cli/acp-stdio.js"),
        // The entry is already the ACP server: `src/cli/acp-stdio.ts:13-14` runs with `--acp` itself
        // and filters a duplicate, so only the user's own extra arguments travel.
        args: ({ extraArgs }) => splitArgs(extraArgs),
      },
    },
    capabilities: {
      resume: true,
      cancel: true,
      approvals: true,
      structuredTools: true,
      streaming: true,
      images: true,
      worktrees: "external",
    },
    // Policy: the harness is a **peer** of the family, not a package EnvoyMesh ships
    // (EnvoyMesh design D4). EnvoyCoder clones or copies the harness itself.
    evidence:
      "Verified from source in ../envoy-harness (peer checkout): the ACP stdio mode is " +
      "`run --acp` (src/cli/argv-help.ts:45 documents `--acp`; src/cli/run.ts:123-124 dispatches " +
      "`subcommand === \"run\" && acp` to the ACP server; src/protocol/acp-server.ts implements " +
      "the dialect). UNVERIFIED at runtime: no `envoy-harness` binary resolves on the machine this " +
      "was written on, and the package has no exported ACP entry, so a spawn-and-handshake has not " +
      "been run against it. Peer policy: EnvoyMesh docs/envoymesh-multi-product-design.md §3 D4 and " +
      "docs/envoymesh-new-app-guide.md §7.5.",
  },

  "deepseek-harness": {
    id: "deepseek-harness",
    label: "DeepSeek Harness",
    tier: "catalogued",
    modes: [],
    summary: "DeepSeek's harness, driven over ACP — the same adapter as the built-in agent.",
    launch: {
      kind: "child-process",
      // Spawned, not imported: the project states plainly that "this package is not a library you
      // import", and its own entrypoint verifier rejects direct in-process mounting. The CLI is
      // the supported launcher, so `dsh` is a binary we drive like any other agent.
      binaries: ["dsh"],
      buildArgs: ({ extraArgs }) => [
        // `acp` rather than `sdk`: the SDK profile speaks a simpler JSON-RPC (initialize /
        // session/prompt) but has **no cancel and no approval answerer**, so an escalation is
        // denied silently. A control plane needs cancel and approvals, and ACP has both.
        "--profile",
        "acp",
        ...splitArgs(extraArgs),
      ],
      stream: "jsonl",
      transport: "acp",
      resumeArgs: () => [],
    },
    capabilities: {
      // ACP provides session/new, resume, cancel, close and per-session config, and
      // `session/request_permission` — so unlike the SDK profile, this surface can ask us.
      resume: true,
      cancel: true,
      approvals: true,
      structuredTools: true,
      streaming: true,
      images: false,
      worktrees: "external",
    },
    install: {
      hint: "npm install -g @deepseek-ai/dsh (developer preview: expect breaking changes)",
      url: "https://www.npmjs.com/package/@deepseek-ai/dsh",
    },
    evidence:
      "verified against ../deepseek-harness @ 0.1.5-alpha.2 (MIT). Profiles and their stdio " +
      "protocols: apps/cli/README.md ('A running dsh is a plugin tree…', profiles web/headless/sdk/" +
      "sdk-minimal/acp). Not-a-library: packages/bundle/base/README.md:12 and " +
      "scripts/verify-application-entrypoints.ts. ACP method table incl. session/cancel and " +
      "session/request_permission: packages/acp/acp/README.md. SDK has no cancel/close: " +
      "packages/sdk/protocol/README.md. Platform behaviour: see docs/envoycoder-platforms.md " +
      "§'DeepSeek Harness' (bash on POSIX / pwsh on Windows; sandbox enforcement is 'partial' on " +
      "Windows; SIGTERM is not distinct from force-kill there).",
  },

  claudecode: {
    id: "claudecode",
    label: "Claude Code",
    tier: "catalogued",
    modes: [
      { id: "plan", label: "Plan", description: "Read-only: propose a plan, change nothing.", unattended: false },
      { id: "default", label: "Always ask" },
      { id: "acceptEdits", label: "Accept edits", description: "Apply file edits without asking." },
      { id: "auto", label: "Auto" },
      { id: "bypassPermissions", label: "Bypass", description: "No prompts at all.", unattended: true },
    ],
    summary: "Anthropic's Claude Code CLI.",
    launch: {
      kind: "child-process",
      binaries: ["claude"],
      buildArgs: ({ prompt, model, extraArgs, resumeSessionId }) => [
        ...(resumeSessionId ? ["--resume", resumeSessionId] : []),
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        ...(model ? ["--model", model] : []),
        ...splitArgs(extraArgs),
      ],
      stream: "jsonl",
      transport: "cli",
      resumeArgs: (sessionId) => ["--resume", sessionId],
    },
    capabilities: {
      resume: true,
      cancel: true,
      approvals: true,
      structuredTools: true,
      streaming: true,
      images: true,
      worktrees: "external",
    },
    install: { hint: "npm install -g @anthropic-ai/claude-code", url: "https://docs.anthropic.com/en/docs/claude-code" },
    evidence:
      "unverified against the installed binary — `-p`, `--output-format stream-json`, `--model` and " +
      "`--resume` are the flags this adapter assumes. Confirm with `claude --help` on each platform " +
      "we ship; the CLI has changed flag names before.",
  },

  codex: {
    id: "codex",
    label: "Codex",
    tier: "catalogued",
    modes: [
      { id: "auto", label: "Default permissions" },
      { id: "auto-review", label: "Auto-review" },
      { id: "full-access", label: "Full access", description: "No prompts at all.", unattended: true },
    ],
    summary: "OpenAI's Codex CLI.",
    launch: {
      kind: "child-process",
      binaries: ["codex"],
      buildArgs: ({ prompt, model, cwd, extraArgs }) => [
        "exec",
        "--cd",
        cwd,
        ...(model ? ["--model", model] : []),
        "--json",
        prompt,
        ...splitArgs(extraArgs),
      ],
      stream: "jsonl",
      transport: "cli",
    },
    capabilities: {
      resume: false,
      cancel: true,
      approvals: true,
      structuredTools: true,
      streaming: true,
      images: true,
      worktrees: "external",
    },
    install: { hint: "npm install -g @openai/codex", url: "https://github.com/openai/codex" },
    evidence:
      "unverified — `codex exec --cd <dir> --json` is assumed. Session resume is recorded as false " +
      "rather than guessed; if the CLI gains it, this entry and its capability flags change together.",
  },

  copilot: {
    id: "copilot",
    label: "GitHub Copilot",
    tier: "catalogued",
    modes: [
      { id: "https://agentclientprotocol.com/protocol/session-modes#agent", label: "Agent" },
      { id: "https://agentclientprotocol.com/protocol/session-modes#plan", label: "Plan", description: "Read-only." },
      { id: "allow-all", label: "Allow all", unattended: true },
    ],
    summary: "GitHub Copilot's CLI agent.",
    launch: {
      kind: "child-process",
      binaries: ["copilot"],
      buildArgs: ({ prompt, extraArgs }) => [...splitArgs(extraArgs), "-p", prompt],
      stream: "text",
      transport: "cli",
    },
    capabilities: {
      resume: false,
      cancel: true,
      approvals: false,
      structuredTools: false,
      streaming: true,
      images: false,
      worktrees: "external",
    },
    install: { hint: "npm install -g @github/copilot", url: "https://github.com/features/copilot/cli/" },
    evidence:
      "unverified, and the least certain entry in the catalogue: Paseo lists Copilot as a supported " +
      "agent (paseo README, 'Prerequisites'), but its non-interactive flag surface has not been read. " +
      "Treat as `stream: text` until proven otherwise — a text-only agent must not be offered the " +
      "structured diff panel.",
  },

  opencode: {
    id: "opencode",
    label: "OpenCode",
    tier: "catalogued",
    modes: [
      { id: "build", label: "Build" },
      { id: "plan", label: "Plan", description: "Read-only." },
    ],
    summary: "The open-source OpenCode agent.",
    launch: {
      kind: "child-process",
      binaries: ["opencode"],
      buildArgs: ({ prompt, model, extraArgs }) => [
        "run",
        ...(model ? ["--model", model] : []),
        prompt,
        ...splitArgs(extraArgs),
      ],
      stream: "text",
      transport: "cli",
    },
    capabilities: {
      resume: true,
      cancel: true,
      approvals: true,
      structuredTools: false,
      streaming: true,
      images: false,
      worktrees: "external",
    },
    install: { hint: "see the project's install instructions", url: "https://github.com/anomalyco/opencode" },
    evidence:
      "unverified — `opencode run` with an optional `--model` is assumed; Paseo's CLI reference shows " +
      "provider-qualified models (`paseo run --provider claude/opus-4.6`), which is where our " +
      "`provider/model` string convention comes from (paseo README, CLI section).",
  },

  cursor: {
    id: "cursor",
    label: "Cursor Agent",
    tier: "catalogued",
    modes: [],
    summary: "Cursor's headless agent CLI.",
    launch: {
      kind: "child-process",
      binaries: ["cursor-agent", "cursor"],
      buildArgs: ({ prompt, model, extraArgs }) => [
        "-p",
        prompt,
        ...(model ? ["--model", model] : []),
        ...splitArgs(extraArgs),
      ],
      stream: "jsonl",
      transport: "cli",
    },
    capabilities: {
      resume: false,
      cancel: true,
      approvals: false,
      structuredTools: false,
      streaming: true,
      images: false,
      worktrees: "external",
    },
    evidence:
      "unverified — carried over from EnvoyMesh's harness list (`packages/api/src/coding-harness.ts`, " +
      "Tier B: claudecode, codex, opencode, cursor, codewhale). EnvoyMesh drives it through its own " +
      "agent-adapter layer; EnvoyCoder needs its own adapter, and this entry is a placeholder for it.",
  },

  /**
   * **OMP (Oh My Pi)** — a Pi-compatible fork, and the one agent here whose *capabilities* we
   * deliberately understate.
   *
   * What is verified (`paseo/packages/server/src/server/agent/providers/omp/**`, `pi/runtime.ts:119-140`,
   * `docs/custom-providers.md` §"OMP profiles and Pi-compatible forks"): it is launched as
   * `<binary> --mode rpc [--model M] [--session S]`, it speaks JSON-RPC over stdio with an initial
   * `ready` frame (20 s) and a 60 s control-plane deadline, its approvals arrive as `rpc-ui`
   * permission requests, and its sessions are JSONL under `~/.omp/agent/sessions`.
   *
   * What is *not* true yet: our adapter cannot speak that protocol. We spawn a process, pass the prompt
   * in argv and read a stream; `--mode rpc` needs the prompt written to stdin as JSON-RPC and its
   * frames mapped. So the capabilities below stay false — not because OMP lacks them (it has cancel,
   * approvals, structured tools and subagents), but because **we cannot deliver them through the
   * transport we have**, and a UI that offered an approval dialog for a channel we never read would be
   * lying to the user.
   *
   * "Done" for this entry is one thing: a pi-family RPC transport (`--mode rpc`, write the prompt,
   * map `ready`/tool/permission frames). That it also fixes `pi` below is the reason it is worth
   * building rather than special-casing OMP.
   */
  omp: {
    id: "omp",
    label: "OMP (Oh My Pi)",
    tier: "catalogued",
    modes: [
      { id: "full", label: "Full access", unattended: true },
      { id: "write", label: "Write approval" },
      { id: "ask", label: "Always ask" },
    ],
    summary: "A Pi-compatible coding agent with multi-provider models, approvals and subagents.",
    launch: {
      kind: "child-process",
      binaries: ["omp"],
      // The prompt is *not* here: in rpc mode it goes over stdin. Until the transport exists this
      // argv is what a user would run by hand to see the agent, which is why it is still worth having.
      buildArgs: ({ extraArgs }) => ["--mode", "rpc", ...splitArgs(extraArgs)],
      stream: "jsonl",
      transport: "cli",
      // `resumeArgs` takes the session id itself (see `AgentLaunch`), which is the JSONL file path
      // OMP/Pi write under their session directory.
      resumeArgs: (sessionId) => ["--session", sessionId],
    },
    capabilities: {
      resume: false,
      cancel: false,
      approvals: false,
      structuredTools: false,
      streaming: true,
      images: false,
      worktrees: "external",
    },
    install: {
      hint: "install the OMP (Oh My Pi) CLI so `omp` is on PATH (Paseo ships it as a built-in provider, disabled by default — see their docs/custom-providers.md)",
    },
    evidence:
      "unverified on this machine (no `omp` binary here). Launch/argv, the `ready` handshake, the 60 s " +
      "control-plane deadline, `rpc-ui` approvals and the `~/.omp/agent/sessions` layout are read from " +
      "Paseo v0.8.0: server/agent/providers/omp/{runtime,provider-config,rpc-ui-permission-mapper}.ts " +
      "and providers/pi/runtime.ts:119-140 (`argv.push(\"--mode\", protocolMode)`), plus their " +
      "docs/custom-providers.md. Capabilities are deliberately conservative: our adapter has no rpc " +
      "transport, so what OMP *has* and what we can *deliver* are different lists today.",
  },

  pi: {
    id: "pi",
    label: "Pi",
    tier: "catalogued",
    modes: [],
    summary: "The Pi coding agent.",
    launch: {
      kind: "child-process",
      binaries: ["pi"],
      buildArgs: ({ prompt, extraArgs }) => [prompt, ...splitArgs(extraArgs)],
      stream: "text",
      transport: "cli",
    },
    capabilities: {
      resume: false,
      cancel: true,
      approvals: false,
      structuredTools: false,
      streaming: true,
      images: false,
      worktrees: "external",
    },
    install: { hint: "see pi.dev", url: "https://pi.dev" },
    evidence:
      "unverified on this machine, and **known to be wrong about the protocol**: Paseo drives Pi as " +
      "`<binary> --mode rpc [--model M] [--session S]` with JSON-RPC over stdio " +
      "(providers/pi/runtime.ts:119-140) and `rpc-ui` approvals, while this entry launches it in " +
      "one-shot text mode and therefore claims no cancel, no approvals and no structured tools. Those " +
      "claims understate the agent rather than overstate it, which is the safe direction — but the fix " +
      "is the same pi-family RPC transport the `omp` entry above needs. Until then, treat this entry as " +
      "\"starts Pi and reads its output\", nothing more.",
  },
};

/* ────────────────────────────── queries ───────────────────────────── */

export const ALL_HARNESSES: readonly HarnessId[] = [...BUILT_IN_HARNESSES, ...CATALOGUED_HARNESSES];

export function harnessDefinition(id: HarnessId): HarnessDefinition {
  return HARNESS_CATALOG[id];
}

/**
 * Can the adapter we actually have drive this agent?
 *
 * **Being installed is not being drivable**, and conflating the two is how a picker offers six agents
 * that cannot start. `RunManager` builds an `AcpLaunch` for every harness and hands the process to the
 * ACP client, so an entry whose program does not speak Agent Client Protocol is not "available but
 * unverified" — it is a process that will never answer `initialize`.
 *
 * This is the honest gate for that: the two harnesses whose argv *is* ACP are drivable today, and each
 * other entry names what it would need instead (an app-server client, an HTTP bridge, a JSONL-RPC
 * reader, or a vendor ACP subcommand that this machine's build may not even ship).
 */
export function isDrivableByAcpAdapter(id: HarnessId): boolean {
  const launch = HARNESS_CATALOG[id].launch;
  return launch.kind === "child-process" && launch.transport === "acp";
}

/**
 * What an agent speaks, for a refusal message or a UI that wants to explain the gap.
 *
 * `in-process` is a third answer rather than a missing one: a harness mounted as a library inside the
 * daemon is neither an ACP peer nor a command line, and pretending either would misreport it.
 */
export function harnessTransport(id: HarnessId): "acp" | "cli" | "in-process" {
  const launch = HARNESS_CATALOG[id].launch;
  return launch.kind === "child-process" ? launch.transport : "in-process";
}

export function harnessesByTier(tier: "built-in" | "catalogued"): HarnessDefinition[] {
  return ALL_HARNESSES.map(harnessDefinition).filter((entry) => entry.tier === tier);
}

export interface HarnessProbe {
  id: HarnessId;
  /** Ready to run on this machine right now. */
  available: boolean;
  /** Absolute path we would launch, when it is a child process. */
  binaryPath?: string;
  /**
   * How it would be launched.
   *
   * `path` is the ordinary case — a binary on `PATH`. `node-script` is the **peer checkout**: the
   * built-in harness is a peer of the family rather than something EnvoyMesh distributes (design D4,
   * guide §7.5), so a developer who has cloned it next to this repo can run it without a global
   * install. The distinction is stated rather than inferred from the extension, because launching
   * the wrong thing as a script is a failure that reads as "the agent is broken".
   */
  via?: "path" | "node-script";
  /** Why it is not available, in end-user language. */
  reason?: string;
}

/**
 * Is this agent usable here?
 *
 * Deliberately *not* a network call and deliberately not cached: an agent can be installed
 * while the app is open, and "I just installed it, why doesn't it show up" is a support ticket.
 * The caller decides how often to ask.
 */
export function probeHarness(
  id: HarnessId,
  options: {
    platform?: PlatformId;
    env?: NodeJS.ProcessEnv;
    /** Injectable for tests. */
    find?: (name: string) => string | null;
    /** For in-process harnesses: is the module resolvable? */
    moduleAvailable?: (module: string) => boolean;
    /** Injectable for tests, so probing the peer checkout needs no filesystem. */
    fileExists?: (path: string) => boolean;
  } = {},
): HarnessProbe {
  const platform = options.platform ?? detectPlatform();
  const definition = harnessDefinition(id);
  if (definition.launch.kind === "in-process") {
    const isAvailable = options.moduleAvailable?.(definition.launch.module) ?? true;
    return {
      id,
      available: isAvailable,
      ...(isAvailable
        ? {}
        : {
            reason: `${definition.label} is built into EnvoyCoder, but its runtime (${definition.launch.module}) is not present. Run \`npm run peers:check\` for the exact fix.`,
          }),
    };
  }

  const find = options.find ?? ((name: string) => findBinary(name, { platform, env: options.env }));
  for (const binary of definition.launch.binaries) {
    const resolved = find(binary);
    if (resolved) return { id, available: true, binaryPath: resolved, via: "path" };
  }

  // Not on PATH: for a harness we are allowed to run from a clone, look in the peer checkout. This
  // is what makes `envoy-harness` usable on a development machine without `npm i -g`, and it is the
  // arrangement the family's guide describes — the product clones the harness itself.
  const peer = definition.launch.devCheckout;
  const peerEntry = peer?.entry();
  if (peerEntry && (options.fileExists ?? defaultFileExists)(peerEntry)) {
    return { id, available: true, binaryPath: peerEntry, via: "node-script" };
  }

  return {
    id,
    available: false,
    reason:
      `${definition.label} is not installed (looked for ${definition.launch.binaries.join(", ")} on PATH` +
      (peerEntry ? `, and at ${peerEntry}` : "") +
      ")" +
      (definition.install ? `. ${definition.install.hint}` : ""),
  };
}

/**
 * The repository root, found rather than assumed.
 *
 * Walking up for the manifest that names *this* workspace is the only honest way to locate a sibling
 * checkout: a relative path from `import.meta.url` differs between the source tree and `dist/`, and
 * an environment variable would put the burden on every user. Returns `undefined` when there is no
 * such manifest — a packaged app has none, and there the peer checkout does not exist either.
 */
let cachedRepoRoot: string | null | undefined;

export function repoRoot(): string | null {
  if (cachedRepoRoot !== undefined) return cachedRepoRoot;
  const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
  const { dirname, join } = require("node:path") as typeof import("node:path");
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
        if (parsed.name === "envoycoder") {
          cachedRepoRoot = dir;
          return dir;
        }
      } catch {
        // A manifest we cannot read is not the one we are looking for.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedRepoRoot = null;
  return null;
}

/**
 * Where a peer checkout's file would be, from the repository root.
 *
 * `../<peer>/<relative>` — the layout the family guide describes (§7.5: the product clones the
 * harness beside itself). It returns a path whether or not it exists: `probeHarness` is what checks,
 * so this stays a pure string function and the probe stays testable without a filesystem.
 */
function resolvePeerEntry(peer: string, relative: string): string {
  const { join, dirname } = require("node:path") as typeof import("node:path");
  const root = repoRoot() ?? dirname(fileURLToPath(import.meta.url));
  return join(root, "..", peer, relative);
}

function defaultFileExists(path: string): boolean {
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  return existsSync(path);
}

/**
 * Exactly what to run for a harness: the command, and the args *before* the harness's own.
 *
 * Separated from `buildHarnessInvocation` because the two answer different questions. That one says
 * what argv this harness understands; this one says what process to start — which is not the same
 * answer for a harness living in a peer checkout, where the command is Node and the first argument
 * is the script.
 */
export function resolveHarnessCommand(
  id: HarnessId,
  probe: HarnessProbe,
  input: RunInput,
): { command: string; args: string[] } {
  const definition = harnessDefinition(id);
  if (definition.launch.kind !== "child-process") {
    throw new Error(`${id} is not a child-process harness, so there is no command to resolve.`);
  }
  if (!probe.available || !probe.binaryPath) {
    throw new Error(
      probe.reason ?? `${definition.label} is not available on this machine, so it cannot be started.`,
    );
  }
  // `via` comes from the probe, never from the file extension: a harness that happened to end in
  // `.js` on PATH is still a program to execute directly.
  if (probe.via === "node-script") {
    const peer = definition.launch.devCheckout;
    if (!peer) throw new Error(`${id} was probed as a checkout entry but has none declared.`);
    // Node runs the entry, and the entry supplies its own mode — so the argv is the *checkout's*,
    // not the installed CLI's.
    return { command: process.execPath, args: [probe.binaryPath, ...peer.args(input)] };
  }
  return { command: probe.binaryPath, args: definition.launch.buildArgs(input) };
}

/** The argv to run a task, plus the spawn options that make it killable as a tree. */
export function buildHarnessInvocation(
  id: HarnessId,
  input: RunInput,
  options: { platform?: PlatformId; binaryPath?: string } = {},
): { command: string; args: string[]; spawn: ReturnType<typeof spawnTreeOptions>; stream: "jsonl" | "text" } {
  const platform = options.platform ?? detectPlatform();
  const definition = harnessDefinition(id);
  if (definition.launch.kind !== "child-process") {
    throw new Error(
      `${id} is an in-process harness: there is no argv to build. Use the runtime module directly ` +
        `(${definition.launch.module}), or call this only for child-process harnesses.`,
    );
  }
  const command = options.binaryPath ?? definition.launch.binaries[0];
  if (!command) throw new Error(`${id} has no binary configured`);
  return {
    command,
    args: definition.launch.buildArgs(input),
    spawn: spawnTreeOptions(platform),
    stream: definition.launch.stream,
  };
}

/**
 * Split a user-typed argument string.
 *
 * Quotes are honoured because users paste paths with spaces, and a path split in half is a bug
 * report about "the agent said it could not find my project" rather than about argument
 * parsing. Not a shell: we never expand variables or globs here.
 */
export function splitArgs(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

export * from "./acp-catalog.js";
