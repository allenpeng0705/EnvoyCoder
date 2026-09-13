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
 */

import { type HarnessId, EXTERNAL_HARNESSES, NATIVE_HARNESSES } from "@envoycoder/protocol";
import { type PlatformId, detectPlatform, findBinary, spawnTreeOptions } from "@envoycoder/platform";

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
      /** Extra argv for resuming a session, when the CLI supports it. */
      resumeArgs?: (sessionId: string) => string[];
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
  tier: "native" | "external";
  /** One line a picker can show. */
  summary: string;
  launch: AgentLaunch;
  capabilities: AgentCapabilities;
  install?: { hint: string; url?: string };
  /** Where the facts came from. `unverified` means "confirm before relying on it". */
  evidence: string;
}

/* ────────────────────────────── the catalogue ───────────────────────────── */

export const HARNESS_CATALOG: Record<HarnessId, HarnessDefinition> = {
  "envoy-harness": {
    id: "envoy-harness",
    label: "Envoy Harness",
    tier: "native",
    summary: "EnvoyCoder's built-in agent — structured tools, approvals and sessions.",
    launch: {
      kind: "in-process",
      // The one harness EnvoyCoder owns end to end, so it can be linked: this is *our* code, not
      // somebody else's CLI. It also speaks ACP, which is why the same adapter that drives
      // DeepSeek Harness can drive it — one integration, two native agents.
      module: "@envoymesh/envoy-harness",
      advantages: [
        "tool calls arrive as events rather than terminal text",
        "approval prompts can be answered from the UI",
        "sessions and transcripts are ours to store and resume",
        "no subprocess: the agent runs in the daemon, so cancel and resume are exact",
      ],
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
      "EnvoyMesh docs/envoymesh-multi-product-design.md §3 D4 (harness is a peer) and " +
      "docs/envoymesh-new-app-guide.md §7.5. Package surface: ../envoy-harness (sibling checkout, " +
      "built by `npm run build:envoy-harness` there).",
  },

  "deepseek-harness": {
    id: "deepseek-harness",
    label: "DeepSeek Harness",
    tier: "native",
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
    tier: "external",
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
    tier: "external",
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
    tier: "external",
    summary: "GitHub Copilot's CLI agent.",
    launch: {
      kind: "child-process",
      binaries: ["copilot"],
      buildArgs: ({ prompt, extraArgs }) => [...splitArgs(extraArgs), "-p", prompt],
      stream: "text",
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
    tier: "external",
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
    tier: "external",
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

  pi: {
    id: "pi",
    label: "Pi",
    tier: "external",
    summary: "The Pi coding agent.",
    launch: {
      kind: "child-process",
      binaries: ["pi"],
      buildArgs: ({ prompt, extraArgs }) => [prompt, ...splitArgs(extraArgs)],
      stream: "text",
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
      "unverified — Paseo lists Pi as supported (README, Prerequisites) and EnvoyMesh runs a Pi " +
      "runtime in-repo (`packages/harness`), but neither tells us Pi's *CLI* argv. Confirm before use; " +
      "EnvoyMesh's Pi runtime is a library, so an in-process integration may be the better route here " +
      "than launching a binary.",
  },
};

/* ────────────────────────────── queries ───────────────────────────── */

export const ALL_HARNESSES: readonly HarnessId[] = [...NATIVE_HARNESSES, ...EXTERNAL_HARNESSES];

export function harnessDefinition(id: HarnessId): HarnessDefinition {
  return HARNESS_CATALOG[id];
}

export function harnessesByTier(tier: "native" | "external"): HarnessDefinition[] {
  return ALL_HARNESSES.map(harnessDefinition).filter((entry) => entry.tier === tier);
}

export interface HarnessProbe {
  id: HarnessId;
  /** Ready to run on this machine right now. */
  available: boolean;
  /** Absolute path we would launch, when it is a child process. */
  binaryPath?: string;
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
    if (resolved) return { id, available: true, binaryPath: resolved };
  }
  return {
    id,
    available: false,
    reason:
      `${definition.label} is not installed (looked for ${definition.launch.binaries.join(", ")} on PATH)` +
      (definition.install ? `. ${definition.install.hint}` : ""),
  };
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
