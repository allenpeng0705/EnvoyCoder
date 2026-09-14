/**
 * The ACP agents we can drive — a **catalogue**, not thirty-eight hardcoded integrations.
 *
 * ## Why a catalogue and not more built-ins
 *
 * Agent Client Protocol is our common denominator (the same choice Paseo made): an agent that speaks
 * ACP over stdio can be driven by one adapter, so adding an agent is *data*, not a new driver. That is
 * the difference between a product that supports the agents people actually use and one that supports
 * whichever six were compiled in.
 *
 * It is also the honest shape. A **built-in** means we ship the driving logic and stand behind it: we
 * probe it, we test its capabilities, and when it cannot cancel or cannot answer an approval we say so.
 * For an agent we have never run, the truthful claim is smaller — *here is the command, here is where
 * to install it, we will probe it and tell you whether it is there* — and that is exactly what an entry
 * in this file is. Promoting an entry to a built-in (`HARNESS_CATALOG` in `index.ts`) is a deliberate
 * act: it means we have run it and recorded the evidence.
 *
 * ## Provenance, and what we deliberately do not carry
 *
 * The list — ids, titles, descriptions, versions, install links, commands, and the `env`/`params` that
 * change how an agent behaves — is catalogued from **Paseo v0.8.0** (Apache-2.0), which curates it at
 * `packages/app/src/data/acp-provider-catalog.ts`. Those fields describe **third-party tools**: we
 * assert nothing about them beyond what their own documentation says, and every one of them is
 * verified at runtime by probing the command rather than by trusting this file.
 *
 * Paseo's per-entry `iconId` is **not** carried over: it names an icon in their asset set, and shipping
 * their artwork is neither necessary nor ours to distribute. A product that wants per-agent icons
 * should own its own set.
 *
 * ## Adding one
 *
 * Append an entry, or let a user declare their own ACP provider in settings (same shape: a command and
 * optional `env`/`params`). Nothing here is compiled into the daemon's dispatch — it is a menu of
 * recipes, and the daemon drives whichever one the user chose.
 *
 * **Both halves of that sentence are now real**, and the user's half is `AgentProviderConfig` in
 * `@envoycoder/protocol` — reached by `coder.listProviders` / `coder.addProvider` /
 * `coder.removeProvider`, probed by the same prober as the entries below (`./probe.ts`, through
 * `./providers.ts`) and launched by the same body
 * (`apps/desktop/src/daemon/launch.ts`'s `launchForProvider`). Two differences between the two tiers
 * are worth stating here, because this file is where a maintainer looks first:
 *
 *   * **An entry's `env` carries values; a provider's carries names only.** That is not an
 *     inconsistency, it is the security decision: `AUGMENT_DISABLE_AUTO_UPDATE: "1"` is part of a
 *     *recipe we author and publish* and is not a secret, while a user's provider may need a credential
 *     — and a credential a user must supply is never stored, so the schema has no field for one.
 *   * **An entry's `params` has no provider equivalent yet.** `supportsMcpServers` describes how a host
 *     should open a session; a provider declares only how to start one. When a user needs to say one, it
 *     becomes a field with a reader, not a key in a bag.
 */

import { findBinary } from "@envoycoder/platform";

/** One ACP agent's recipe: how to start it, and where a user gets it. */
export interface AcpAgentEntry {
  /** Stable id, also the key a user's provider config uses. */
  id: string;
  /** What a user sees in the agent list. */
  title: string;
  /** One line saying what the agent is. Third-party wording, kept factual. */
  description: string;
  /** The version the command pins, or `"manual"` when the tool manages its own updates. */
  version: string;
  /** Where to install it. Shown when the probe reports it is missing. */
  installLink: string;
  /** The command to spawn. The first element is the binary the probe looks for. */
  command: readonly [string, ...string[]];
  /** Environment the agent needs to behave correctly (auto-update off, ACP mode on, …). */
  env?: Readonly<Record<string, string>>;
  /**
   * ACP provider parameters.
   *
   * `supportsMcpServers: false` is the one that matters: some adapters cannot create a session while
   * `mcpServers` is non-empty, so an MCP-injecting host would break them.
   */
  params?: Readonly<Record<string, unknown>>;
}

/**
 * Every catalogued ACP agent, sorted by id.
 *
 * Sorted rather than ordered by popularity on purpose: a list this long is read by searching, and an
 * order that means something to the catalogue's author is noise to everyone else.
 */
export const ACP_AGENT_CATALOG: readonly AcpAgentEntry[] = [
  {
    id: "agoragentic-acp",
    title: "Agoragentic",
    description:
      "Agent marketplace with 174+ AI capabilities. Browse, invoke, and pay for agent services settled in USDC on Base L2.",
    version: "1.3.6",
    installLink: "https://agoragentic.com",
    command: ["npx","-y","agoragentic-mcp@1.3.6","--acp"],
  },
  {
    id: "amp-acp",
    title: "Amp",
    description:
      "ACP wrapper for Amp - the frontier coding agent",
    version: "0.7.0",
    installLink: "https://github.com/tao12345666333/amp-acp",
    command: ["amp-acp"],
  },
  {
    id: "auggie",
    title: "Auggie CLI",
    description:
      "Augment Code's powerful software agent, backed by industry-leading context engine",
    version: "0.33.0",
    installLink: "https://www.augmentcode.com/",
    command: ["npx","-y","@augmentcode/auggie@0.33.0","--acp"],
    env: {"AUGMENT_DISABLE_AUTO_UPDATE":"1"},
  },
  {
    id: "autohand",
    title: "Autohand Code",
    description:
      "Autohand Code - AI coding agent powered by Autohand AI",
    version: "0.2.1",
    installLink: "https://www.autohand.ai/cli/",
    command: ["npx","-y","@autohandai/autohand-acp@0.2.1"],
  },
  {
    id: "cline",
    title: "Cline",
    description:
      "Autonomous coding agent CLI - capable of creating/editing files, running commands, using the browser, and more",
    version: "3.0.46",
    installLink: "https://cline.bot/cli",
    command: ["npx","-y","cline@3.0.46","--acp"],
  },
  {
    id: "codebuddy-code",
    title: "Codebuddy Code",
    description:
      "Tencent Cloud's official intelligent coding tool",
    version: "manual",
    installLink: "https://www.codebuddy.cn/cli/",
    command: ["codebuddy","--acp"],
  },
  {
    id: "codewhale",
    title: "CodeWhale",
    description:
      "Terminal coding agent for DeepSeek V4 and open models",
    version: "0.8.55",
    installLink: "https://codewhale.net/",
    command: ["codewhale","serve","--acp"],
  },
  {
    id: "cortex-code",
    title: "Cortex Code",
    description:
      "Snowflake's Cortex Code coding agent",
    version: "1.0.73",
    installLink: "https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli",
    command: ["cortex","acp","serve"],
  },
  {
    id: "corust-agent",
    title: "Corust Agent",
    description:
      "Co-building with a seasoned Rust partner.",
    version: "0.5.1",
    installLink: "https://github.com/Corust-ai/corust-agent-release/releases",
    command: ["corust-agent-acp"],
  },
  {
    id: "crow-cli",
    title: "crow-cli",
    description:
      "Minimal ACP Native Coding Agent",
    version: "0.1.23",
    installLink: "https://crow-ai.dev/",
    command: ["crow-cli","acp"],
  },
  {
    id: "cursor",
    title: "Cursor",
    description:
      "Cursor's coding agent",
    version: "2026.03.30",
    installLink: "https://docs.cursor.com/en/cli/overview",
    command: ["cursor-agent","acp"],
  },
  {
    id: "deepagents",
    title: "DeepAgents",
    description:
      "Batteries-included AI coding and general purpose agent powered by LangChain.",
    version: "0.1.20",
    installLink: "https://docs.langchain.com/oss/javascript/deepagents/overview",
    command: ["npx","-y","deepagents-acp@0.1.20"],
  },
  {
    id: "devin",
    title: "Devin CLI",
    description:
      "Cognition's Devin for Terminal via Agent Client Protocol",
    version: "manual",
    installLink: "https://cli.devin.ai/docs",
    command: ["devin","acp"],
  },
  {
    id: "dimcode",
    title: "DimCode",
    description:
      "A coding agent that puts leading models at your command.",
    version: "0.2.36",
    installLink: "https://dimcode.dev/docs/acp.html",
    command: ["npx","-y","dimcode@0.2.36","acp"],
  },
  {
    id: "dirac",
    title: "Dirac",
    description:
      "Reduces API costs by more than 50%, produces better and faster work. Uses Hash anchored parallel edits, AST manipulation and a whole lot of neat optimizations. Fully Open Source.",
    version: "0.4.22",
    installLink: "https://dirac.run",
    command: ["npx","-y","dirac-cli@0.4.22","--acp"],
  },
  {
    id: "factory-droid",
    title: "Factory Droid",
    description:
      "Factory Droid - AI coding agent powered by Factory AI",
    version: "0.179.0",
    installLink: "https://factory.ai/product/cli",
    command: ["npx","-y","droid@0.179.0","exec","--output-format","acp-daemon"],
    env: {"DROID_DISABLE_AUTO_UPDATE":"true","FACTORY_DROID_AUTO_UPDATE_ENABLED":"false"},
    params: {"supportsMcpServers":false},
  },
  {
    id: "fast-agent",
    title: "fast-agent",
    description:
      "Code and build agents with comprehensive multi-provider support",
    version: "0.9.22",
    installLink: "https://fast-agent.ai/acp/",
    command: ["uvx","--from","fast-agent-acp==0.9.22","fast-agent-acp","-x"],
  },
  {
    id: "gemini",
    title: "Gemini CLI",
    description:
      "Google's official CLI for Gemini",
    version: "0.52.0",
    installLink: "https://geminicli.com",
    command: ["npx","-y","@google/gemini-cli@0.52.0","--acp"],
  },
  {
    id: "gjc",
    title: "Gajae Code",
    description:
      "Runs on the Claude/Codex/Gemini subscription you already pay for. Plan-before-mutation workflows, evidence-gated execution, and approval prompts for shell and destructive edits.",
    version: "manual",
    installLink: "https://gajae-code.com",
    command: ["gjc","acp"],
    env: {"GJC_ACP_PERMISSION_MODE":"prompt"},
  },
  {
    id: "glm-acp-agent",
    title: "GLM Agent",
    description:
      "ACP agent powered by Zhipu AI's GLM Coding Plan models (glm-5.1, glm-5-turbo, glm-4.7, glm-4.5-air). Supports streaming, tool calls, mid-session model switching, image input via Z.AI Coding Plan Vision MCP, and session load/fork/resume with on-disk persistence.",
    version: "1.3.0",
    installLink: "https://github.com/stefandevo/glm-acp-agent",
    command: ["npx","-y","glm-acp-agent@1.3.0"],
  },
  {
    id: "goose",
    title: "goose",
    description:
      "A local, extensible, open source AI agent that automates engineering tasks",
    version: "1.33.1",
    installLink: "https://block.github.io/goose/",
    command: ["goose","acp"],
  },
  {
    id: "grok",
    title: "Grok",
    description:
      "xAI's Grok Build agentic coding CLI with plan mode and parallel subagents. Requires a SuperGrok or X Premium+ subscription.",
    version: "0.2.11",
    installLink: "https://docs.x.ai/build/overview",
    command: ["grok","agent","stdio"],
  },
  {
    id: "hermes",
    title: "Hermes",
    description:
      "Nous Research self-improving AI agent",
    version: "manual",
    installLink: "https://hermes-agent.nousresearch.com/docs/user-guide/features/acp",
    command: ["hermes","acp"],
  },
  {
    id: "junie",
    title: "Junie",
    description:
      "AI Coding Agent by JetBrains",
    version: "1468.30.0",
    installLink: "https://junie.jetbrains.com/docs/junie-cli-acp.html",
    command: ["junie","--acp","true"],
  },
  {
    id: "kilo",
    title: "Kilo",
    description:
      "The open source coding agent",
    version: "7.2.40",
    installLink: "https://kilo.ai/docs/code-with-ai/platforms/cli",
    command: ["kilo","acp"],
  },
  {
    id: "kimi",
    title: "Kimi Code CLI",
    description:
      "Moonshot AI's open-source terminal coding agent",
    version: "0.11.0",
    installLink: "https://github.com/MoonshotAI/kimi-code",
    command: ["kimi","acp"],
  },
  {
    id: "kiro",
    title: "Kiro CLI",
    description:
      "Amazon's AI coding agent with native ACP support",
    version: "manual",
    installLink: "https://kiro.dev/docs/cli/acp/",
    command: ["kiro-cli","acp"],
  },
  {
    id: "minimax-code",
    title: "MiniMax Code",
    description:
      "MiniMax's coding agent for the terminal",
    version: "0.1.2",
    installLink: "https://agent.minimax.io",
    command: ["npx","-y","@minimax-ai/code@0.1.2","acp"],
  },
  {
    id: "minion-code",
    title: "Minion Code",
    description:
      "An enhanced AI code assistant built on the Minion framework with rich development tools",
    version: "0.1.44",
    installLink: "https://github.com/femto/minion-code",
    command: ["uvx","--from","minion-code==0.1.44","minion-code","acp"],
  },
  {
    id: "mistral-vibe",
    title: "Mistral Vibe",
    description:
      "Mistral's open-source coding assistant",
    version: "2.9.3",
    installLink: "https://github.com/mistralai/mistral-vibe",
    command: ["vibe-acp"],
  },
  {
    id: "nova",
    title: "Nova",
    description:
      "Nova by Compass AI - a fully-fledged software engineer at your command",
    version: "1.1.29",
    installLink: "https://www.compassap.ai/portfolio/nova.html",
    command: ["npx","-y","@compass-ai/nova@1.1.29","acp"],
  },
  {
    id: "poolside",
    title: "Poolside",
    description:
      "Poolside's coding agent",
    version: "1.0.0",
    installLink: "https://docs.poolside.ai/cli/pool",
    command: ["pool","acp"],
  },
  {
    id: "qoder",
    title: "Qoder CLI",
    description:
      "AI coding assistant with agentic capabilities",
    version: "1.1.4",
    installLink: "https://qoder.com",
    command: ["npx","-y","@qoder-ai/qodercli@1.1.4","--acp"],
  },
  {
    id: "qwen-code",
    title: "Qwen Code",
    description:
      "Alibaba's Qwen coding assistant",
    version: "0.20.1",
    installLink: "https://qwenlm.github.io/qwen-code-docs/en/users/overview",
    command: ["npx","-y","@qwen-code/qwen-code@0.20.1","--acp","--experimental-skills"],
  },
  {
    id: "sigit",
    title: "siGit Code",
    description:
      "Local-first coding agent. Runs entirely on your machine with optional on-device LLM inference via Onde.",
    version: "1.0.3",
    installLink: "https://github.com/getsigit/sigit",
    command: ["sigit"],
  },
  {
    id: "stakpak",
    title: "Stakpak",
    description:
      "Open-source DevOps agent in Rust with enterprise-grade security",
    version: "0.3.80",
    installLink: "https://stakpak.dev/",
    command: ["stakpak","acp"],
  },
  {
    id: "traecli",
    title: "TRAE CLI",
    description:
      "ByteDance's official TRAE coding agent with native ACP support",
    version: "manual",
    installLink: "https://docs.trae.cn/cli_get-started-with-trae-cli",
    command: ["traecli","acp","serve"],
  },
  {
    id: "vtcode",
    title: "VT Code",
    description:
      "An open-source coding agent with LLM-native code understanding and robust shell safety. Supports multiple LLM providers with automatic failover and efficient context management.",
    version: "0.96.14",
    installLink: "https://github.com/vinhnx/VTCode/blob/main/docs/guides/zed-acp.md",
    command: ["vtcode","acp"],
    env: {"VT_ACP_ENABLED":"1","VT_ACP_ZED_ENABLED":"1"},
  },
];

/** Look one up by id, or `undefined` — the same question a provider config asks. */
export function acpAgent(id: string): AcpAgentEntry | undefined {
  return ACP_AGENT_CATALOG.find((entry) => entry.id === id);
}

/**
 * What a probe found, for an entry in the **preset** catalogue above.
 *
 * `available: boolean` rather than `HarnessProbe`'s five states, and the difference is not drift: this list is
 * a recipe set (a command line and a link) with no notion of a bridge, so there is no second program to ask
 * about — "the command's binary is on `PATH`, or it is not" is the whole question. The five states exist for
 * the *harness* catalogue, where an agent and the adapter we drive it through are two different installs
 * (`AgentLaunch.agentBinaries`); a UI that renders both lists must therefore map this boolean itself, which is
 * what `apps/desktop/src/composer/agent-for.ts` does for the one list the window actually shows.
 */
export interface AcpAgentProbe {
  id: string;
  available: boolean;
  /** The binary we resolved, when we found one. */
  binaryPath?: string;
  /** How it was found — on PATH, or as an `npx` package we would fetch on first run. */
  via?: "path" | "npx";
  /** End-user wording for why it is not usable, including where to get it. */
  reason?: string;
}

/**
 * Is this catalogued agent usable on this machine?
 *
 * Two honest outcomes, and no third one:
 *
 *   * **`available: true`** — the command's binary resolves. We still know nothing about the agent's
 *     *capabilities*; that comes from the ACP handshake at run time, which is why the UI must not
 *     promise cancel or approvals before a session exists.
 *   * **`available: false`, with a reason that names the install link** — missing, or only reachable
 *     through `npx`, which we report as `npx` rather than as present: fetching a package on first run
 *     is a different user experience from running an installed binary, and a reviewer should see
 *     which one they are choosing.
 *
 * `npx`-first commands are deliberately *not* resolved to a binary: `npx` itself is the binary, and a
 * machine without network access would look ready and then fail at run time.
 */
export function probeAcpAgent(
  id: string,
  options: {
    /** Injectable for tests, so probing needs no PATH and no filesystem. */
    find?: (name: string) => string | null;
  } = {},
): AcpAgentProbe {
  const entry = acpAgent(id);
  if (!entry) {
    return { id, available: false, reason: `No catalogued ACP agent has the id "${id}".` };
  }

  const [binary, ...rest] = entry.command;
  const find = options.find ?? ((name: string) => findBinary(name));

  if (binary === "npx" || binary === "npx.cmd") {
    const resolved = find("npx");
    return resolved
      ? { id, available: true, binaryPath: resolved, via: "npx" }
      : {
          id,
          available: false,
          reason: `npx is not available, and ${entry.title} is installed through it. ${entry.installLink}`,
        };
  }

  const resolved = find(binary);
  if (resolved) return { id, available: true, binaryPath: resolved, via: "path" };

  return {
    id,
    available: false,
    reason:
      `${entry.title} is not installed (looked for ${binary} on PATH). ` +
      `${entry.installLink}${rest.length > 0 ? ` — then it runs as: ${entry.command.join(" ")}` : ""}`,
  };
}

/**
 * Which entry wins for an id, when a name exists in both lists.
 *
 * The two tiers overlap on purpose: `cursor` is a harness we drive ourselves *and* a recipe in the
 * catalogue (Paseo drives it as an ACP preset, we drive it as a built-in). Overlap is not a bug —
 * but ambiguity is, so the rule is one line and testable: **a built-in wins**, because a built-in is
 * the entry we ship the driving logic for and the one whose capabilities we have evidence about. The
 * catalogue is what fills the rest of the list.
 */
export function resolveAgentEntry(
  id: string,
  builtInIds: readonly string[],
): { tier: "built-in"; id: string } | { tier: "catalogued"; entry: AcpAgentEntry } | null {
  if (builtInIds.includes(id)) return { tier: "built-in", id };
  const entry = acpAgent(id);
  return entry ? { tier: "catalogued", entry } : null;
}

/**
 * The ids that appear in both tiers — a known, finite list, asserted in the tests.
 *
 * Kept as a function rather than a comment so a name that starts colliding later is *noticed*: the
 * test that pins this list fails when it changes, in either direction.
 */
export function overlappingAgentIds(builtInIds: readonly string[]): string[] {
  return acpAgentIds().filter((id) => builtInIds.includes(id));
}

/** The ids, for a config UI or a coverage assertion. */
export function acpAgentIds(): string[] {
  return ACP_AGENT_CATALOG.map((entry) => entry.id);
}
