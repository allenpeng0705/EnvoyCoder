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
 * Append an entry — and **state its `transport`**, which the type will not let you leave out. That field
 * is the one dialect fact a recipe carries; `modeParam` and `authMethodId` are not here at all, and
 * nothing built from an entry may write one down (see `AcpAgentEntry.transport`). Or let a user declare
 * their own ACP provider in settings (same shape: a command, optional `env` names, and a transport).
 * Nothing here is compiled into the daemon's dispatch — it is a menu of recipes, and the daemon drives
 * whichever one the user chose.
 *
 * **Both halves of that sentence are now real, including the surface.** The user's half is
 * `AgentProviderConfig` in `@envoycoder/protocol` — reached by `coder.listProviders` /
 * `coder.addProvider` / `coder.removeProvider`, probed by the same prober as the entries below
 * (`./probe.ts`, through `./providers.ts`) and launched by the same body
 * (`apps/desktop/src/daemon/launch.ts`'s `launchForProvider`). The list below reaches a user through
 * `coder.listCatalog` (`apps/desktop/src/daemon/catalog.ts`), which serves one row per entry **with what this
 * machine can do with it**, resolved when the list is served — the cheap facts, from filesystem and environment
 * reads, for all 38 rows at once. There is no per-row probe method any more: §7.17 of `docs/settings-parity.md`
 * records the report that removed it, and the test beside it counts child processes across a whole read and
 * requires zero. That is why the catalogue is *not* desktop-only knowledge
 *
 *   * **An entry's `env` carries values; a provider's carries names and a *reference*.** That is not an
 *     inconsistency, it is the security decision: `AUGMENT_DISABLE_AUTO_UPDATE: "1"` is part of a
 *     *recipe we author and publish* and is not a secret, while a user's provider may need a credential —
 *     and a credential a user must supply is never stored, so the schema has no field for one. For a
 *     while the two halves did not meet: `cataloguedProviderInput` carried only the **name**, so adding
 *     one of the four entries that set a variable produced a provider the launch refused by name until
 *     the user exported something we had written ourselves. `catalogEntryId` closes it the only honest
 *     way — the provider names the *entry*, and the daemon resolves the constants from this file — so the
 *     value still never reaches `providers.json`. See `CataloguedProviderInput`.
 *   * **An entry may declare the vendor program its command is an adapter over** (`wrappedAgent`), which is
 *     what makes `needs-bridge` a state a catalogued row can actually reach. One entry does, with a
 *     citation; the other 37 do not, and the field's own doc says why an assumption here is worse than an
 *     omission.
 *   * **An entry's `params` has no provider equivalent yet.** `supportsMcpServers` describes how a host
 *     should open a session; a provider declares only how to start one. When a user needs to say one, it
 *     becomes a field with a reader, not a key in a bag.
 *   * **A provider has no install link and no version; an entry has both.** A provider is a command the
 *     user typed, so there is nobody to ask where it comes from — which is why the install guidance on
 *     this screen is entry data and is shown from the row rather than from the probe.
 */

import {
  probeRecipe,
  type HarnessInstallHints,
  type ProbeFinding,
  type ProbeHarnessOptions,
  type ProbeRecipe,
} from "./probe.js";

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
  /**
   * **How the daemon must speak to this program** — the only dialect fact an entry carries.
   *
   * ## Why it is stated per entry rather than defaulted at the call site
   *
   * A recipe tells you how to *start* a program and nothing about how to *talk* to it. That distinction
   * is one this repository keeps paying for: `AgentLaunch.transport` records it for the nine agents we
   * ship, `coder.addProvider` makes it **required** from a user, and the reason is the same in both
   * places — a `"cli"` program is *startable and not drivable*, and something that guessed `"acp"` would
   * send an `initialize` to a program that never answers it.
   *
   * Making the field required is what turns "somebody added a one-shot CLI to the ACP list" from a
   * silent wrongness into a compile error: whoever adds entry 39 has to say which one it is, and a
   * `"cli"` entry is then honestly reported `unsupported` by the prober (`probe.ts`, step 1) rather than
   * offered as ready.
   *
   * All 38 entries are `"acp"` today, and that is not a coincidence being papered over: this file **is**
   * the ACP catalogue, catalogued from the reference product's `acp-provider-catalog.ts`, where every
   * entry declares `extends: "acp"`. That file is the citation — not an inference from a command line,
   * because `sigit` (`command: ["sigit"]`) says nothing whatsoever about a protocol and is here only
   * because the catalogue it came from says it speaks ACP.
   *
   * ## The dialect facts that are deliberately **not** here
   *
   * `AgentLaunch` records two more: `modeParam` (`"mode"` vs `"modeId"`) and `authMethodId`
   * (`cursor_login`). **No entry states either**, so nothing built from an entry may write one down.
   * Guessing them fails in the direction that cannot be detected: a peer that does not recognise the
   * field name it was sent ignores it and reports success, so a wrong `modeParam` produces a mode picker
   * that appears to work and changes nothing. A catalogue-added provider therefore carries a transport
   * and no other dialect fact, and the probe is what tells the truth about whether the program runs.
   */
  transport: "acp" | "cli";
  /**
   * Environment the agent needs to behave correctly (auto-update off, ACP mode on, …), as **name →
   * constant** — the one place a value is allowed to exist.
   *
   * These are constants of a command line *we* publish — `AUGMENT_DISABLE_AUTO_UPDATE: "1"`,
   * `VT_ACP_ENABLED: "1"` — not credentials, and a name that looks like a credential is refused when the
   * row is built (`CatalogEnvConstantSchema`). Two readers, one source: the **row** carries name and value
   * so the screen can say which variables the recipe supplies, and the **launch** resolves the same map by
   * reference (`AgentProviderConfig.catalogEntryId`), so `providers.json` never holds one.
   */
  env?: Readonly<Record<string, string>>;
  /**
   * The **vendor's own program**, when `command` launches an adapter *over* it rather than the agent itself.
   *
   * ## Why this field exists, and why almost every entry does not have it
   *
   * `agentBinaries` (`AgentLaunch` in `index.ts`) has recorded both halves of "installed" for the nine
   * agents we ship since the bug report *"I have installed codex and claudecode … why all of them shown
   * 'Not Installed'"* — and the catalogue could not express it at all, so `needs-bridge` was a state
   * **no catalogued row could reach**. That is the gap this closes: with the field, a row whose adapter is
   * missing but whose vendor program is present reports exactly that, with the adapter's install step as
   * its fix, instead of "Not installed" about a tool the user does have.
   *
   * ## One entry declares it, and that is the honest count
   *
   * The reference product's catalogue — the source of every entry here — carries **no** such field: its
   * `AcpProviderCatalogEntry` (`paseo` `packages/app/src/data/acp-provider-catalog.ts:3-13`) has `command`,
   * `env`, `params` and nothing about a second binary, and its generic ACP provider resolves exactly one
   * binary (`defaultBinary: this.command[0]`). So this cannot be populated by porting: it needs evidence,
   * and an assumption here is the specific failure this catalogue is written against — a wrong
   * `agentBinaries` turns "we cannot find the program" into "your agent is installed and something else is
   * missing", which is a *worse* sentence, and it is unfalsifiable from the row.
   *
   * The evidence that qualifies an entry is that its own recorded description says the command is an
   * adapter over something else. `amp-acp` says so in as many words. Nothing else in these 38 does, so
   * nothing else declares this field — and an entry added later declares it only with the same kind of
   * citation, not because it "looks like" a wrapper.
   */
  wrappedAgent?: {
    /**
     * The vendor program(s) the probe looks for — **never launched**, exactly as `agentBinaries` is not.
     *
     * More than one is allowed for the same reason the shipped entries allow it: a first-party CLI can
     * ship under two names.
     */
    readonly binaries: readonly string[];
    /** Where a user gets the vendor's own program (the adapter's page is the entry's own `installLink`). */
    readonly installLink: string;
    /** How a user installs the **adapter** — the one step a `needs-bridge` row offers. */
    readonly adapterInstall: string;
  };
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
    transport: "acp",
  },
  {
    id: "amp-acp",
    title: "Amp",
    description:
      "ACP wrapper for Amp - the frontier coding agent",
    version: "0.7.0",
    installLink: "https://github.com/tao12345666333/amp-acp",
    command: ["amp-acp"],
    transport: "acp",
    /**
     * **The only entry that declares this, and the evidence is in its own description.**
     *
     * `amp-acp` is not Amp — it is *"ACP wrapper for Amp - the frontier coding agent"*, and everything a
     * recipe would need to say so was already in this file except a place to put it. Verified against the
     * package itself (2026-09-14, `registry.npmjs.org`): `amp-acp@0.9.0` is described as *"ACP adapter that
     * bridges Amp Code to Agent Client Protocol"* and declares `bin: { "amp-acp": … }` — so the adapter
     * ships the program this entry names, and `npm install -g amp-acp` is the step that installs it. Amp's
     * own CLI is `amp`, from the package that used to be `@sourcegraph/amp` and is now `@ampcode/cli`
     * (`bin: { "amp": … }`, homepage `https://ampcode.com/`).
     *
     * Two consequences, both of which are the point of the field: a machine with `amp` and no `amp-acp`
     * now reports **`needs-bridge`** rather than "not installed", and the row's fix is the *adapter's* one
     * step instead of a page about the agent the user already has.
     */
    wrappedAgent: {
      binaries: ["amp"],
      installLink: "https://ampcode.com/",
      adapterInstall: "npm install -g amp-acp",
    },
  },
  {
    id: "auggie",
    title: "Auggie CLI",
    description:
      "Augment Code's powerful software agent, backed by industry-leading context engine",
    version: "0.33.0",
    installLink: "https://www.augmentcode.com/",
    command: ["npx","-y","@augmentcode/auggie@0.33.0","--acp"],
    transport: "acp",
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
    transport: "acp",
  },
  {
    id: "cline",
    title: "Cline",
    description:
      "Autonomous coding agent CLI - capable of creating/editing files, running commands, using the browser, and more",
    version: "3.0.46",
    installLink: "https://cline.bot/cli",
    command: ["npx","-y","cline@3.0.46","--acp"],
    transport: "acp",
  },
  {
    id: "codebuddy-code",
    title: "Codebuddy Code",
    description:
      "Tencent Cloud's official intelligent coding tool",
    version: "manual",
    installLink: "https://www.codebuddy.cn/cli/",
    command: ["codebuddy","--acp"],
    transport: "acp",
  },
  {
    id: "codewhale",
    title: "CodeWhale",
    description:
      "Terminal coding agent for DeepSeek V4 and open models",
    version: "0.8.55",
    installLink: "https://codewhale.net/",
    command: ["codewhale","serve","--acp"],
    transport: "acp",
  },
  {
    id: "cortex-code",
    title: "Cortex Code",
    description:
      "Snowflake's Cortex Code coding agent",
    version: "1.0.73",
    installLink: "https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli",
    command: ["cortex","acp","serve"],
    transport: "acp",
  },
  {
    id: "corust-agent",
    title: "Corust Agent",
    description:
      "Co-building with a seasoned Rust partner.",
    version: "0.5.1",
    installLink: "https://github.com/Corust-ai/corust-agent-release/releases",
    command: ["corust-agent-acp"],
    transport: "acp",
  },
  {
    id: "crow-cli",
    title: "crow-cli",
    description:
      "Minimal ACP Native Coding Agent",
    version: "0.1.23",
    installLink: "https://crow-ai.dev/",
    command: ["crow-cli","acp"],
    transport: "acp",
  },
  {
    id: "cursor",
    title: "Cursor",
    description:
      "Cursor's coding agent",
    version: "2026.03.30",
    installLink: "https://docs.cursor.com/en/cli/overview",
    command: ["cursor-agent","acp"],
    transport: "acp",
  },
  {
    id: "deepagents",
    title: "DeepAgents",
    description:
      "Batteries-included AI coding and general purpose agent powered by LangChain.",
    version: "0.1.20",
    installLink: "https://docs.langchain.com/oss/javascript/deepagents/overview",
    command: ["npx","-y","deepagents-acp@0.1.20"],
    transport: "acp",
  },
  {
    id: "devin",
    title: "Devin CLI",
    description:
      "Cognition's Devin for Terminal via Agent Client Protocol",
    version: "manual",
    installLink: "https://cli.devin.ai/docs",
    command: ["devin","acp"],
    transport: "acp",
  },
  {
    id: "dimcode",
    title: "DimCode",
    description:
      "A coding agent that puts leading models at your command.",
    version: "0.2.36",
    installLink: "https://dimcode.dev/docs/acp.html",
    command: ["npx","-y","dimcode@0.2.36","acp"],
    transport: "acp",
  },
  {
    id: "dirac",
    title: "Dirac",
    description:
      "Reduces API costs by more than 50%, produces better and faster work. Uses Hash anchored parallel edits, AST manipulation and a whole lot of neat optimizations. Fully Open Source.",
    version: "0.4.22",
    installLink: "https://dirac.run",
    command: ["npx","-y","dirac-cli@0.4.22","--acp"],
    transport: "acp",
  },
  {
    id: "factory-droid",
    title: "Factory Droid",
    description:
      "Factory Droid - AI coding agent powered by Factory AI",
    version: "0.179.0",
    installLink: "https://factory.ai/product/cli",
    command: ["npx","-y","droid@0.179.0","exec","--output-format","acp-daemon"],
    transport: "acp",
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
    transport: "acp",
  },
  {
    id: "gemini",
    title: "Gemini CLI",
    description:
      "Google's official CLI for Gemini",
    version: "0.52.0",
    installLink: "https://geminicli.com",
    command: ["npx","-y","@google/gemini-cli@0.52.0","--acp"],
    transport: "acp",
  },
  {
    id: "gjc",
    title: "Gajae Code",
    description:
      "Runs on the Claude/Codex/Gemini subscription you already pay for. Plan-before-mutation workflows, evidence-gated execution, and approval prompts for shell and destructive edits.",
    version: "manual",
    installLink: "https://gajae-code.com",
    command: ["gjc","acp"],
    transport: "acp",
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
    transport: "acp",
  },
  {
    id: "goose",
    title: "goose",
    description:
      "A local, extensible, open source AI agent that automates engineering tasks",
    version: "1.33.1",
    installLink: "https://block.github.io/goose/",
    command: ["goose","acp"],
    transport: "acp",
  },
  {
    id: "grok",
    title: "Grok",
    description:
      "xAI's Grok Build agentic coding CLI with plan mode and parallel subagents. Requires a SuperGrok or X Premium+ subscription.",
    version: "0.2.11",
    installLink: "https://docs.x.ai/build/overview",
    command: ["grok","agent","stdio"],
    transport: "acp",
  },
  {
    id: "hermes",
    title: "Hermes",
    description:
      "Nous Research self-improving AI agent",
    version: "manual",
    installLink: "https://hermes-agent.nousresearch.com/docs/user-guide/features/acp",
    command: ["hermes","acp"],
    transport: "acp",
  },
  {
    id: "junie",
    title: "Junie",
    description:
      "AI Coding Agent by JetBrains",
    version: "1468.30.0",
    installLink: "https://junie.jetbrains.com/docs/junie-cli-acp.html",
    command: ["junie","--acp","true"],
    transport: "acp",
  },
  {
    id: "kilo",
    title: "Kilo",
    description:
      "The open source coding agent",
    version: "7.2.40",
    installLink: "https://kilo.ai/docs/code-with-ai/platforms/cli",
    command: ["kilo","acp"],
    transport: "acp",
  },
  {
    id: "kimi",
    title: "Kimi Code CLI",
    description:
      "Moonshot AI's open-source terminal coding agent",
    version: "0.11.0",
    installLink: "https://github.com/MoonshotAI/kimi-code",
    command: ["kimi","acp"],
    transport: "acp",
  },
  {
    id: "kiro",
    title: "Kiro CLI",
    description:
      "Amazon's AI coding agent with native ACP support",
    version: "manual",
    installLink: "https://kiro.dev/docs/cli/acp/",
    command: ["kiro-cli","acp"],
    transport: "acp",
  },
  {
    id: "minimax-code",
    title: "MiniMax Code",
    description:
      "MiniMax's coding agent for the terminal",
    version: "0.1.2",
    installLink: "https://agent.minimax.io",
    command: ["npx","-y","@minimax-ai/code@0.1.2","acp"],
    transport: "acp",
  },
  {
    id: "minion-code",
    title: "Minion Code",
    description:
      "An enhanced AI code assistant built on the Minion framework with rich development tools",
    version: "0.1.44",
    installLink: "https://github.com/femto/minion-code",
    command: ["uvx","--from","minion-code==0.1.44","minion-code","acp"],
    transport: "acp",
  },
  {
    id: "mistral-vibe",
    title: "Mistral Vibe",
    description:
      "Mistral's open-source coding assistant",
    version: "2.9.3",
    installLink: "https://github.com/mistralai/mistral-vibe",
    command: ["vibe-acp"],
    transport: "acp",
  },
  {
    id: "nova",
    title: "Nova",
    description:
      "Nova by Compass AI - a fully-fledged software engineer at your command",
    version: "1.1.29",
    installLink: "https://www.compassap.ai/portfolio/nova.html",
    command: ["npx","-y","@compass-ai/nova@1.1.29","acp"],
    transport: "acp",
  },
  {
    id: "poolside",
    title: "Poolside",
    description:
      "Poolside's coding agent",
    version: "1.0.0",
    installLink: "https://docs.poolside.ai/cli/pool",
    command: ["pool","acp"],
    transport: "acp",
  },
  {
    id: "qoder",
    title: "Qoder CLI",
    description:
      "AI coding assistant with agentic capabilities",
    version: "1.1.4",
    installLink: "https://qoder.com",
    command: ["npx","-y","@qoder-ai/qodercli@1.1.4","--acp"],
    transport: "acp",
  },
  {
    id: "qwen-code",
    title: "Qwen Code",
    description:
      "Alibaba's Qwen coding assistant",
    version: "0.20.1",
    installLink: "https://qwenlm.github.io/qwen-code-docs/en/users/overview",
    command: ["npx","-y","@qwen-code/qwen-code@0.20.1","--acp","--experimental-skills"],
    transport: "acp",
  },
  {
    id: "sigit",
    title: "siGit Code",
    description:
      "Local-first coding agent. Runs entirely on your machine with optional on-device LLM inference via Onde.",
    version: "1.0.3",
    installLink: "https://github.com/getsigit/sigit",
    command: ["sigit"],
    transport: "acp",
  },
  {
    id: "stakpak",
    title: "Stakpak",
    description:
      "Open-source DevOps agent in Rust with enterprise-grade security",
    version: "0.3.80",
    installLink: "https://stakpak.dev/",
    command: ["stakpak","acp"],
    transport: "acp",
  },
  {
    id: "traecli",
    title: "TRAE CLI",
    description:
      "ByteDance's official TRAE coding agent with native ACP support",
    version: "manual",
    installLink: "https://docs.trae.cn/cli_get-started-with-trae-cli",
    command: ["traecli","acp","serve"],
    transport: "acp",
  },
  {
    id: "vtcode",
    title: "VT Code",
    description:
      "An open-source coding agent with LLM-native code understanding and robust shell safety. Supports multiple LLM providers with automatic failover and efficient context management.",
    version: "0.96.14",
    installLink: "https://github.com/vinhnx/VTCode/blob/main/docs/guides/zed-acp.md",
    command: ["vtcode","acp"],
    transport: "acp",
    env: {"VT_ACP_ENABLED":"1","VT_ACP_ZED_ENABLED":"1"},
  },
];

/** Look one up by id, or `undefined` — the same question a provider config asks. */
export function acpAgent(id: string): AcpAgentEntry | undefined {
  return ACP_AGENT_CATALOG.find((entry) => entry.id === id);
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

/* ──────────────────── from an entry to the two things a screen needs ──────────────────── */

/**
 * How an entry's program gets onto a machine, in the two shapes that need **different sentences**.
 *
 * Not decoration: `npx -y cline@3.0.46 --acp` needs no install at all — the package arrives on first run
 * — while `goose acp` needs a program that is simply not there. A screen that said "install it" about
 * the first would send a user to a download page for something that installs itself, and one that said
 * "no install needed" about the second would leave them with a row that never becomes ready.
 *
 * Derived from the command's own first element, which is the only place the answer exists. `package`
 * carries the whole `name@version` argument so a row can say *what* the first run fetches without
 * parsing a command line — a second parser is a second answer to "what is this entry".
 */
export type CataloguedInstall =
  | { readonly kind: "npx"; readonly package: string }
  | { readonly kind: "binary"; readonly binary: string };

/** The `npx`/`npx.cmd` first element that means "this is fetched on first run, not installed". */
function isNpxBinary(binary: string): boolean {
  return binary === "npx" || binary === "npx.cmd";
}

/**
 * Which of the two shapes this entry is.
 *
 * `package` is the argument after `-y` when there is one — the spec `npx` would resolve — and the whole
 * command after `npx` otherwise, so the field is never empty for an `npx` entry and never invents a spec
 * that is not in the command.
 */
export function cataloguedInstall(entry: AcpAgentEntry): CataloguedInstall {
  const [binary, ...rest] = entry.command;
  if (isNpxBinary(binary)) {
    const at = rest.indexOf("-y");
    const spec = at >= 0 ? rest[at + 1] : rest[0];
    return { kind: "npx", package: spec ?? entry.command.join(" ") };
  }
  return { kind: "binary", binary };
}

/** The command line, as one string: what a row shows and what a fix carries, from one place. */
export function cataloguedCommandLine(entry: AcpAgentEntry): string {
  return entry.command.join(" ");
}

/**
 * An entry flattened into the recipe **the one prober** reads.
 *
 * The same `ProbeRecipe` a provider config produces (`providers.ts`) and the nine shipped agents produce
 * (`index.ts`), so a catalogued row's state comes from the same five checks, in the same order, as
 * everything else on the screen. Nothing here decides a state; it only states what to look for.
 *
 * ## The install hint, and why it is a sentence rather than a package name
 *
 * The fourth agreement rule of `HarnessAvailabilitySchema` is that a state asserting an absence must say
 * what to do about it, and for a third-party tool **we cannot author an install command** — we have not
 * read its release process and inventing `npm i -g goose` would be advice that does not run. So the hint
 * says what is true and where the answer is: install *this tool* (the entry's own link carries the how)
 * and then it runs as this command line. The precedent is `opencode`'s own entry in `index.ts`, whose
 * hint is "see the project's install instructions" for exactly this reason.
 *
 * The `npx` case is genuinely different and gets a different sentence: what is missing there is `npx`
 * itself, which is Node's, not the agent's.
 */
export function cataloguedRecipe(entry: AcpAgentEntry): ProbeRecipe {
  const [binary] = entry.command;
  const wrapped = entry.wrappedAgent;
  const commandLine = cataloguedCommandLine(entry);
  /**
   * Two shapes, and the second is why `wrappedAgent` exists.
   *
   * * **The command is the agent.** Then the hint is the entry's own tool and its link, exactly as before:
   *   `install Goose — then it runs as: goose acp`.
   * * **The command is an adapter over something the user installs separately.** Then the *agent* step and
   *   the *adapter* step are two facts with two links — the entry's `installLink` is the adapter's page,
   *   and `wrappedAgent.installLink` is the vendor's. Handing the adapter's link to the agent step (what
   *   the single-hint version did) is the same class of wrong sentence the shipped catalogue was fixed
   *   for: it tells a user to go and install the thing that is already there.
   *
   * The `npx` sentence stays as it is, and deliberately: there, `npx` itself is what is missing and the
   * hint says so rather than naming a package that installs itself.
   */
  const install: HarnessInstallHints = isNpxBinary(binary)
    ? {
        hint:
          `install Node.js so that \`npx\` is on PATH — ${entry.title} itself needs no install, ` +
          `it is fetched from npm on the first run`,
        url: "https://nodejs.org/en/download",
      }
    : wrapped
      ? {
          hint: `install ${entry.title} — its own program, which \`${binary}\` drives`,
          url: wrapped.installLink,
          bridge: {
            hint: wrapped.adapterInstall,
            // The adapter's page, which is also the entry's own link — stated here so the two steps never
            // disagree about which link belongs to which half.
            url: entry.installLink,
          },
        }
      : { hint: `install ${entry.title} — then it runs as: ${commandLine}`, url: entry.installLink };
  return {
    label: entry.title,
    kind: "child-process",
    // The **first element only**, which is the program the probe looks for. For an `npx` entry that is
    // `npx`: the package name in the command is not a binary on this machine, and looking for it would
    // report every npx recipe as missing.
    binaries: [binary],
    transport: entry.transport,
    // The vendor's program, when the command is an adapter over it — the field that makes `needs-bridge`
    // reachable for a catalogued row at all. Absent for the other 37, which is a statement rather than a
    // gap: no evidence, no claim. See `AcpAgentEntry.wrappedAgent`.
    ...(wrapped ? { agentBinaries: wrapped.binaries } : {}),
    install,
    // The user's own command line, for `notInstalledFix`: it is the one command in the world that
    // describes what this row would run.
    commandLine,
  };
}

/**
 * **The catalogue's projection of one entry is `probeRecipe(cataloguedRecipe(entry))`, and nothing wraps it.**
 *
 * There used to be a `probeCatalogAgent(id)` here beside a `CataloguedAgentProbe` — the entry point for the
 * per-row method a user had to press (`coder.probeCatalogAgent`, deleted in §7.17 of `docs/settings-parity.md`).
 * It measured one entry per call, and once the daemon began resolving **every** row when it serves the list it
 * had no caller left outside this package's own test. A function whose only remaining reader is the test that
 * asserts it is an implementation of nothing, so both are gone and the assertions that were here now drive
 * `probeRecipe` over `cataloguedRecipe` directly — which is exactly what `apps/desktop/src/daemon/catalog.ts`
 * composes for the rows it serves.
 */

/**
 * What `coder.addProvider` is handed for one entry — **and the dialect is the entry's, not ours**.
 *
 * ## Why this is a function here rather than three field reads in a screen
 *
 * A screen that assembled these parameters would be a second place that knows what a catalogue entry
 * means, and the first one to be wrong about the dialect. It is also the half of this product the phone
 * needs: `coder.listCatalog` serves exactly this object per entry, so a client on any platform declares
 * an agent by passing back what the daemon said the entry states. That is what "the catalogue is not
 * desktop-only knowledge" means in practice, and it is why this lives in the shared package rather than
 * in the app that happens to render it first.
 *
 * ## Three fields, and the two that are absent on purpose
 *
 *   * `command`, `args` — the entry's own argv, split at the first element. Never re-quoted, never
 *     reordered: a recipe we catalogued from a vendor's own documentation is the last thing that should
 *     be reinterpreted on the way to a spawn.
 *   * `transport` — `entry.transport`, passed through. The entry states it (`AcpAgentEntry.transport`);
 *     nothing here infers it, and nothing downstream may default it.
 *   * **`modeParam` and `authMethodId` are not set**, because no entry states either. See
 *     `AcpAgentEntry.transport` for why writing a plausible one is worse than writing nothing.
 *
 * ## `env` is names, and `catalogEntryId` is what carries the recipe's constants
 *
 * The entry's own `env` carries **values** — `AUGMENT_DISABLE_AUTO_UPDATE: "1"`, `VT_ACP_ENABLED: "1"` —
 * because those are constants of a recipe *we* publish. A provider config cannot carry a value (its `env`
 * is a list of names read from the daemon's own environment at spawn, which is the security decision
 * `AgentProviderConfig` states), and refusing to carry them at all made those four recipes unusable for no
 * safety gain. So what crosses is the **names** *and* the reference: `catalogEntryId` names the entry, and
 * the daemon resolves the constants from this same catalogue at launch and at summary time.
 *
 * The consequence is worth stating plainly, because it is the improvement: `providers.json` now holds **no
 * value at all** — not ours and not a user's — and a var the entry does not declare a constant for is still
 * refused by name when the daemon's environment lacks it. `cataloguedEnvNames` is the name list and
 * `cataloguedEnvValues` is the name-and-value list the *row* renders, so a caller never reads `.env` keys
 * itself and the two cannot disagree.
 */
export interface CataloguedProviderInput {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly string[];
  readonly transport: "acp" | "cli";
  /**
   * The entry's own id, as `coder.addProvider`'s `catalogEntryId`.
   *
   * Always present — a caller assembling these parameters *is* adding a catalogue entry, and the reference
   * is what lets the launch resolve the entry's constants without a value ever crossing the wire.
   */
  readonly catalogEntryId: string;
}

/** The environment variable **names** an entry's recipe sets. Never the values — see above. */
export function cataloguedEnvNames(entry: AcpAgentEntry): string[] {
  return Object.keys(entry.env ?? {});
}

/**
 * The same list with the constants, in declaration order — **what the row renders**.
 *
 * One function so a row and a launch cannot disagree about which variables a recipe supplies: the row
 * draws this, and `resolveProviderEnv` (in `./providers.js`) resolves the same `entry.env` for the spawn.
 * The credential rule is not re-checked here because it is enforced where the data enters the wire
 * (`CatalogEnvConstantSchema`) and asserted over all 38 entries in `test/acp-catalog.test.ts`.
 */
export function cataloguedEnvValues(entry: AcpAgentEntry): { name: string; value: string }[] {
  return Object.entries(entry.env ?? {}).map(([name, value]) => ({ name, value }));
}

/** The `coder.addProvider` parameters for one entry. See `CataloguedProviderInput` for every choice. */
export function cataloguedProviderInput(entry: AcpAgentEntry): CataloguedProviderInput {
  const [command, ...args] = entry.command;
  return {
    id: entry.id,
    label: entry.title,
    command,
    args,
    env: cataloguedEnvNames(entry),
    transport: entry.transport,
    catalogEntryId: entry.id,
  };
}
