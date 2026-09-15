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
  type HarnessAvailability,
  type HarnessId,
  type HarnessState,
  type ToolCache,
  BUILT_IN_HARNESSES,
  CATALOGUED_HARNESSES,
} from "@envoycoder/protocol";
import { type PlatformId, detectPlatform, spawnTreeOptions } from "@envoycoder/platform";

import { modelArgs, modelIdOf } from "./models.js";
import { ACP_AGENT_CATALOG, cataloguedRecipe } from "./acp-catalog.js";
import { probeRecipe, type ProbeFinding, type ProbeHarnessOptions, type ProbeRecipe } from "./probe.js";
import { splitArgs } from "./args.js";

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
      /**
       * The **agent's own** program, when what `binaries` names is a *bridge* over it rather than the agent
       * itself. Used only to tell "the agent is not installed" from "the agent is installed and its adapter
       * is not" — it is never launched.
       *
       * ## Why an agent needs two binaries recorded, and why one was not enough
       *
       * Claude Code and Codex have no ACP mode. Their entries name the Agent Client Protocol **bridges**
       * (`@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`), which is correct and
       * measured — and it produced a bug report that is the reason this field exists: *"I have installed
       * codex and claudecode … why all of them shown 'Not Installed'."* The bridges had been verified from
       * throwaway `/tmp` prefixes and never installed globally, so the probe looked for a program the user
       * had never been told to install, and reported the **agent** missing. `claude` 2.1.159 was sitting in
       * `~/.local/bin` the whole time.
       *
       * The fix is to record both halves of what "installed" means and let the probe say which one is
       * absent. Absent means "what we drive **is** the agent", which is true for `dsh` (driven as
       * `dsh --profile acp`), for `cursor-agent` (whose `acp` is a subcommand, not a package) and for the
       * built-in harness.
       *
       * Asserted in `test/agent-catalog.test.ts`: every entry that declares this also declares
       * `install.bridge`, because a bridge with no install command would leave the user with a state and
       * nothing to do about it.
       */
      agentBinaries?: readonly string[];
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
      /**
       * The ACP `authenticate` method this agent needs before it will open a session, when it needs one.
       *
       * `initialize` answers with the methods an agent offers, and an agent may then refuse
       * `session/new` until one has been used. **`cursor-agent acp` is the one entry here that does**:
       * it advertises one method, `cursor_login`, and on its first run in this state answered
       * `session/new` with `Authentication required … then call authenticate() with methodId
       * 'cursor_login'`. That refusal turned out to be **state-dependent rather than permanent** — see the
       * `cursor` entry's `evidence` for the second observation — and sending the step is idempotent, which
       * is why the client sends one whenever an entry names it rather than trying to detect whether it is
       * still needed.
       *
       * The **catalogue** names it rather than the client choosing, because choosing is not safe:
       * `@agentclientprotocol/codex-acp` offers two `type: "env_var"` methods that fail with the
       * agent's own sentence when the variable is unset, and a browser-login method would open a window
       * on the user's desktop. Which method suits an installation is a fact about that installation, and
       * facts live here. Absent — for every other entry — means "this agent opens sessions with no
       * authentication at all", which was observed rather than assumed: both bridges and the built-in
       * harness answer `session/new` on a fresh process.
       */
      authMethodId?: string;
      /**
       * Which field name this agent's `session/set_mode` reads: the peer's `mode`, or the
       * specification's `modeId`.
       *
       * **Two contracts, and both were observed rather than inferred.** `envoy-harness` parses
       * `obj.mode` (`../envoy-harness/packages/envoy-harness/src/protocol/acp-params.ts:352-375`);
       * `cursor-agent acp`, `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`
       * all require `modeId`, and refuse `mode` with `-32603 … path: ["modeId"]` / `-32602 … modeId:
       * expected string, received undefined`.
       *
       * Declared per entry rather than retried at run time, and that is the whole point of the field:
       * the peer **accepts** a `modeId` and ignores it — `parseSessionSetModeParams` returns
       * `{sessionId}` with no mode, and the backend answers `{mode: <unchanged>}` — so a client that
       * tried one and fell back on refusal would be told the mode had been applied while the agent
       * stayed in its default. A refusal can be retried; a success that changed nothing cannot.
       *
       * Only meaningful for an entry whose `capabilities.agentMode` is true, and asserted as such in
       * `test/drivable.test.ts`.
       */
      modeParam?: "mode" | "modeId";
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
  /**
   * The model this run is on, in the **provider-qualified** form the task stores
   * (`anthropic/claude-sonnet-4-6`).
   *
   * One vocabulary on the whole path — picker, task, run, argv — because the two agents that can
   * actually be launched want opposite things from it and neither wants the other's shape:
   * `envoy-harness` splits it into `--provider` and `--model`, while `deepseek-harness` re-encodes the
   * pair as one opaque session-config value. Which of those happens is the entry's business
   * (`./models.ts`), not the caller's; an entry that takes only a bare id asks `modelIdOf` for one.
   */
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
  /**
   * Can this daemon put the agent into one of its own modes, over the protocol it speaks?
   *
   * Separate from `modes` on purpose, because the two answer different questions and only this one
   * decides whether the composer's picker is offered. `modes` says what the agent *has*; this says
   * whether we can *set* one. Both first-party harnesses name their modes honestly, and only one of
   * them accepts a way to choose:
   *
   *   * `envoy-harness` answers the ACP method `session/set_mode` with `{sessionId, mode}`, and its
   *     accepted kinds are exactly `default | plan | review`
   *     (`../envoy-harness/packages/envoy-harness/src/protocol/acp-server.ts:431` handling,
   *     `.../src/plan/mode-kind.ts` for `ModeKind`, `.../src/protocol/acp-params.ts:352-375` for the
   *     parameter check that rejects anything else).
   *   * `deepseek-harness` has **no** `session/set_mode`: its ACP surface offers `session/new`,
   *     `session/resume`, `session/close`, `session/set_config_option` and `session/prompt`
   *     (`../deepseek-harness/packages/acp/acp/src/index.ts:384-390`), and the only configuration it
   *     reports is the **model** and the **reasoning effort**
   *     (`.../src/model-control.ts:188-220`). There is no mode to set, so we say so instead of
   *     offering a control that would be silently ignored — which is why `modes` is empty there and
   *     this is `false`.
   *
   * The third-party entries are `false` too, for two different reasons recorded where they apply: the
   * ones `isDrivableByAcpAdapter` refuses (`opencode`, `pi`, `omp`) could not have a mode applied even if
   * one were chosen, and `copilot` — drivable since its own `--acp` server was measured on 2026-09-15 —
   * has a mode *field* nobody has read yet, because its `session/new` refuses until the user signs in.
   */
  agentMode: boolean;
  /**
   * Can the daemon decide whether this agent **asks before destructive actions**?
   *
   * The flag behind the app setting "Ask before anything destructive". It is a fourth delivery
   * question, on a fourth wire, and it is separate from `approvals` — which says whether the agent can
   * stop and ask at all. This says whether *we* may change that behaviour:
   *
   *   * `envoy-harness` answers the ACP method `session/set_policy` with
   *     `{sessionId, sandbox?, approval?, autoRun?, preset?}`; `autoRun` is exactly
   *     `always-confirm | safe-only | off`, decided per tool call by `shouldAskUnderAutoRun` in the
   *     live permission hook (`../envoy-harness/packages/envoy-harness/src/protocol/acp-params.ts:237-295`,
   *     `.../src/permissions/auto-run.ts:48-70`, `.../src/protocol/agent-backend-host.ts:217-231`).
   *     Verified against the built peer, not only its source: `session/get_policy` on a fresh session
   *     answers `{sandbox:"workspace-write",approval:"on-request"}` with **no** `autoRun`, and
   *     `session/set_policy {autoRun:"off"}` is accepted and echoed back.
   *   * `deepseek-harness` has **no** `session/set_policy`: its ACP surface registers initialize,
   *     authenticate, session/new, session/list, session/resume, session/close,
   *     session/setConfigOption, session/prompt and session/cancel, and nothing else
   *     (`@deepseek-ai/dsh-acp` `lib/index.js:1322`, the whole request table on one line). So a policy
   *     sent to it would be answered `method not found`, which is why the setting's control is disabled
   *     with a reason when this agent is the one in play rather than silently dropped.
   *
   * Every catalogued entry is `false`: they are the same claim as `agentMode` — a third-party CLI this
   * adapter cannot even launch has no policy we could set.
   */
  approvalPolicy: boolean;
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
   * Evidence-based, and empty where we genuinely do not know. The lists for the four third-party CLIs
   * come from Paseo's provider manifest, which drives them every day. `envoy-harness`'s list is its
   * own `ModeKind`, read out of the peer checkout. `deepseek-harness` is empty **and that is the
   * answer, not a gap**: its ACP surface has no `session/set_mode`, so it offers nothing here to
   * choose. `capabilities.agentMode` is the flag a caller branches on; this array is only what to
   * put in a picker.
   *
   * (This comment used to claim both harnesses were empty because "ACP reports its session modes in
   * the `session/new` response". That was wrong about both of them: `envoy-harness` answers
   * `session/new` with `{sessionId}` alone — `.../src/protocol/acp-server.ts:88-95` — and
   * `deepseek-harness` answers `{sessionId, configOptions}` where the options are the model and the
   * reasoning effort, not a mode. An empty list justified by a mechanism that does not exist is how
   * a whole feature gets argued out of the product by a comment.)
   */
  modes: readonly AgentMode[];
  /**
   * The models this agent publishes are **not** here.
   *
   * They are in `./models.ts`, keyed by the same ids (`HARNESS_MODELS`, `HARNESS_MODEL_DELIVERY`),
   * because a model list needs a provenance line of its own and a second fact this interface has no
   * field for: how the chosen value gets to the agent. `harnessModels(id)` is the accessor.
   */
  /**
   * How to get this agent onto a machine, in the two halves that "installed" turned out to mean.
   *
   * `hint` is the **agent itself** and `bridge` is the adapter we drive it through, and keeping them apart
   * is the fix for a bug report rather than a taxonomy: the entry used to carry one hint, which for a
   * bridged agent was the *bridge's* command — so the row could only ever tell a user to install a package
   * they had never heard of, while the agent they had installed was reported missing. `not-installed` now
   * shows both steps in order, and `needs-bridge` shows exactly the second.
   *
   * Both are command lines and neither is translated. `test/agent-catalog.test.ts` asserts every entry
   * declares a `hint` (so a "not installed" row always has something to do) and that every entry with a
   * `bridge` declares its hint.
   */
  install?: {
    hint: string;
    url?: string;
    /** The ACP bridge or vendor subcommand's package, for an entry whose `launch.binaries` is not the agent. */
    /**
     * The bridge — **the adapter we drive the agent through**, when the agent's own CLI has no ACP mode.
     *
     * `package` is the structured half of `hint`, and it is what makes a *fetched* delivery possible: the launch
     * for that route is `npx -y <package>`, and a package name parsed back out of an English hint would be one
     * catalogue edit away from being wrong. Absent means this agent's connector cannot be fetched — which is the
     * honest answer for the seven agents we ship whose adapter is in this repository.
     */
    bridge?: { hint: string; url?: string; package?: string };
  };
  /** Where the facts came from. `unverified` means "confirm before relying on it". */
  evidence: string;
}

/* ────────────────────────────── the catalogue ───────────────────────────── */

export const HARNESS_CATALOG: Record<HarnessId, HarnessDefinition> = {
  "envoy-harness": {
    id: "envoy-harness",
    label: "Envoy Harness",
    tier: "built-in",
    // Exactly the peer's `ModeKind`, one for one and in its order
    // (`../envoy-harness/packages/envoy-harness/src/plan/mode-kind.ts`), because a mode id we invent
    // is a mode id `session/set_mode` refuses with `mode must be default|plan|review`. The labels are
    // ours — the ids are passed through verbatim and are the contract.
    modes: [
      {
        id: "default",
        label: "Default",
        labelKey: "task.agentMode.default.label",
        description: "Do the work, asking before anything destructive.",
        descriptionKey: "task.agentMode.default.description",
      },
      {
        id: "plan",
        label: "Plan",
        labelKey: "task.agentMode.plan.label",
        description: "Investigate and propose a plan. Change nothing yet.",
        descriptionKey: "task.agentMode.plan.description",
      },
      {
        id: "review",
        label: "Review",
        labelKey: "task.agentMode.review.label",
        description: "Check and report. Change nothing.",
        descriptionKey: "task.agentMode.review.description",
      },
    ],
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
      // The model travels as **flags**, and both of them. Its `--acp` dispatch builds a live agent
      // only when `--provider` is set and reads `--model` only in that branch
      // (`../envoy-harness/packages/envoy-harness/src/cli/run/acp.ts:100-106`), so `--model` alone is
      // parsed, dropped and then reported to the user as the model they chose. `modelArgs` emits the
      // pair or nothing at all, and throws rather than dropping one — see `./models.ts`.
      buildArgs: ({ extraArgs, model }) => [
        "run",
        "--acp",
        ...modelArgs(model, "envoy-harness"),
        ...splitArgs(extraArgs),
      ],
      stream: "jsonl",
      transport: "acp",
      // The peer's own field name, read out of its parser rather than guessed from the specification:
      // `parseSessionSetModeParams` looks at `obj.mode` and nothing else
      // (`../envoy-harness/packages/envoy-harness/src/protocol/acp-params.ts:352-375`). It is the
      // *older* of the two names this catalogue records, and the one every other ACP agent here does
      // **not** use — see `AgentLaunch.modeParam` for why the difference has to be written down.
      modeParam: "mode",
      resumeArgs: () => [],
      // The peer checkout: `agent-catalog` lives at `<repo>/packages/agent-catalog`, and the harness
      // is cloned beside the repo (`../envoy-harness`). Resolved at probe time against the repository
      // root, so a machine with the clone but no global install still has a working built-in agent.
      devCheckout: {
        entry: () => resolvePeerEntry("envoy-harness", "packages/envoy-harness/dist/cli/acp-stdio.js"),
        // The entry is already the ACP server: `src/cli/acp-stdio.ts:13-14` runs with `--acp` itself
        // and filters a duplicate, so only the user's own extra arguments travel. The model flags are
        // the *installed* argv's, because the checkout entry declares `--acp` and nothing else: the
        // `--provider`/`--model` flags it needs are read from the same argv parser.
        args: ({ extraArgs, model }) => [
          ...modelArgs(model, "envoy-harness"),
          ...splitArgs(extraArgs),
        ],
      },
    },
    capabilities: {
      resume: true,
      cancel: true,
      approvals: true,
      structuredTools: true,
      streaming: true,
      images: true,
      // The one harness whose modes we can actually set: `session/set_mode`, ids `default|plan|review`.
      agentMode: true,
      // And the one whose approval posture we can set: `session/set_policy { autoRun }`.
      approvalPolicy: true,
      worktrees: "external",
    },
    install: {
      // The honest fix for the built-in agent, and it is not an install command because there is nothing to
      // install: this harness is a **peer** of the family rather than a package we publish (design D4, guide
      // §7.5), so "it is missing" means the checkout beside this repository is absent or unbuilt. The
      // repository already has one command that reports exactly which half is wrong
      // (`scripts/check-envoydeps.mjs`), and pointing at it beats inventing a package name.
      hint: "run `npm run peers:check` — the built-in harness is the peer checkout beside this repository",
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
      // **False, and not a gap to be filled.** This surface has no `session/set_mode`
      // (`../deepseek-harness/packages/acp/acp/src/index.ts:384-390` registers
      // new/list/resume/close/setConfigOption/prompt/cancel and nothing else), and the per-session
      // configuration it does report is the model and the reasoning effort
      // (`.../src/model-control.ts:188-220`). So there is no mode for the composer to offer, and
      // `runs.ts` refuses a run that asks for one rather than quietly starting an unrestricted agent
      // in what the user believed was plan mode.
      agentMode: false,
      // **False for the same reason, and it is the reason the approvals row is disabled with a reason
      // when this agent is the one in play.** The request table above lists every method this surface
      // answers and `session/set_policy` is not among them, so asking this agent to stop asking — or to
      // keep asking — would be answered `method not found`, failing the run rather than changing the
      // posture. It asks before it acts, on its own terms; that is what we report.
      approvalPolicy: false,
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
    // The live session's own list, in its own order, with its own words as the labels
    // (`session/new` → `modes.availableModes`, observed 2026-09-14). The previous version of this
    // array came from Paseo's provider manifest and was very nearly right — it had the same five
    // concepts, and `dontAsk` rather than `auto` is what this build calls the fourth — which is why
    // the ids are now taken from the agent instead of from a manifest that describes a different
    // version of it.
    modes: [
      { id: "default", label: "Manual", description: "Always ask before making changes." },
      { id: "acceptEdits", label: "Accept edits", description: "Automatically accept all file edits." },
      { id: "plan", label: "Plan", description: "Create a plan before making changes.", unattended: false },
      { id: "auto", label: "Auto", description: "Claude handles permission decisions." },
      { id: "bypassPermissions", label: "Bypass permissions", description: "Accepts all permissions.", unattended: true },
    ],
    summary: "Anthropic's Claude Code CLI, driven over ACP by the Agent Client Protocol bridge.",
    launch: {
      kind: "child-process",
      // **The ACP bridge, not `claude`.** Claude Code itself has no ACP mode — `claude --help` on
      // 2.1.159 lists no `acp` subcommand, and driving the documented one-shot argv
      // (`claude -p <prompt> --output-format stream-json --verbose`, which is what this entry used to
      // describe) was measured against the real binary: it does not answer an ACP `initialize` at all
      // (no reply in 20 s; the process is a one-shot CLI). The bridge is the integration, and it is
      // Zed's/Agent Client Protocol's own, which is why it is a dependency rather than a bespoke
      // adapter of ours.
      binaries: ["claude-agent-acp"],
      // **The agent itself, recorded so "not installed" can be a truthful sentence.** `claude` is what the
      // user installs and what `claude-agent-acp` drives; the bridge is our adapter, and a row that called
      // a missing adapter a missing agent is the bug report this field answers. Never launched.
      agentBinaries: ["claude"],
      // Nothing but the user's own extra arguments: this program *is* the ACP server, so a prompt, a
      // model or a resume id in argv would be handed to something that reads none of them. The model
      // travels as a session config option instead (`./models.ts`), and a resume as `session/resume`.
      buildArgs: ({ extraArgs }) => [...splitArgs(extraArgs)],
      stream: "jsonl",
      transport: "acp",
      // Verified: the bridge requires `modeId`, and accepts a change
      // (`session/set_mode {modeId:"plan"}` → `{}`, and the next `session/set_config_option` echoed the
      // mode as `plan`).
      modeParam: "modeId",
      resumeArgs: () => [],
    },
    capabilities: {
      // Advertised by the bridge as `sessionCapabilities: {fork, list, resume}` and `loadSession: true`,
      // and then exercised rather than believed: a session opened in one process was accepted by
      // `session/resume` in the next one, with the same working directory.
      resume: true,
      cancel: true,
      // **Not observed, and therefore not claimed any more.** This entry used to say `true` on the
      // strength of the one-shot CLI's flags. A live turn through the bridge in the agent's own asking
      // mode — `modeId: "default"`, "Always ask before making changes" — ran a shell tool call without
      // raising `session/request_permission`, so the one thing the flag asserts was not seen. Only a
      // destructive path would settle it, and this slice did not run one on the owner's machine.
      approvals: false,
      structuredTools: true,
      streaming: true,
      images: true,
      agentMode: true,
      // No `session/set_policy` in the bridge's surface — its approval posture is one of the five modes
      // above (that is what "Auto" and "Bypass permissions" are), which is a mode and not a policy, so
      // the app's "ask before anything destructive" setting has nothing to travel through.
      approvalPolicy: false,
      worktrees: "external",
    },
    install: {
      // **The agent, not the bridge.** Both routes are real and both were checked: the native installer is
      // what put `claude` 2.1.159 in `~/.local/bin` on the machine this was written on (`claude install` is
      // a subcommand of the installed binary), and `@anthropic-ai/claude-code` resolves on npm (2.1.270 at
      // the time of writing). Naming only the npm route would tell a user with the native install to
      // reinstall something they already have.
      hint:
        "install Claude Code itself: `claude install` (native), or `npm install -g @anthropic-ai/claude-code`",
      url: "https://code.claude.com/docs/en/setup",
      bridge: {
        hint: "npm install -g @agentclientprotocol/claude-agent-acp",
        url: "https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp",
        // Published on npm, so this connector can be *fetched* instead of installed: `npx -y <package>`.
        package: "@agentclientprotocol/claude-agent-acp",
      },
    },
    evidence:
      "VERIFIED against the real binaries on 2026-09-14, macOS. `claude --version` → 2.1.159; " +
      "`claude --help` has no `acp` subcommand, and `claude -p '' --output-format stream-json --verbose` " +
      "never answers an ACP initialize (no reply in 20 s) — so the CLI this entry used to describe is " +
      "not an ACP agent. The bridge: `@agentclientprotocol/claude-agent-acp` 0.77.0 (formerly, and " +
      "still resolvable as, `@zed-industries/claude-code-acp` 0.16.2, which this was first measured " +
      "against; the old name prints a deprecation notice pointing at the new one). Through it, " +
      "`initialize` → `{protocolVersion: 1, agentInfo: {name: '@agentclientprotocol/claude-agent-acp'}, " +
      "agentCapabilities: {loadSession: true, sessionCapabilities: {fork, list, resume}, " +
      "promptCapabilities: {image: true}}}`; `session/new` → `{sessionId, modes, configOptions}` where " +
      "configOptions are `mode`, `model` and `effort` (category `thought_level`); a whole turn " +
      "completed (`stopReason: 'end_turn'`, with usage), streaming `agent_thought_chunk`, `tool_call` " +
      "(title 'Terminal', kind 'execute'), `tool_call_update` and `agent_message_chunk`. `images` is the " +
      "advertised `promptCapabilities.image: true`. UNVERIFIED: `capabilities.cancel` (ACP's " +
      "`session/cancel` was not exercised on this agent) and `approvals` — see the `capabilities` note; " +
      "`effort` was read but is not wired as a thinking level yet (`./session-options.ts`).",
  },

  codex: {
    id: "codex",
    label: "Codex",
    tier: "catalogued",
    // The live session's own list again, and this one **replaces ids that were simply wrong**: the
    // previous array (`auto`, `auto-review`, `full-access`) came from Paseo's provider manifest, and
    // `auto-review` is not a mode this build publishes at all. The three below are what
    // `session/new` → `modes.availableModes` actually answered, with the agent's own names.
    modes: [
      { id: "read-only", label: "Read Only", description: "Read files in the workspace; approval required to edit or reach the internet.", unattended: false },
      { id: "agent", label: "Default", description: "Read and edit in the workspace and run commands; approval required to reach further." },
      { id: "agent-full-access", label: "Full Access", description: "Edit outside the workspace and reach the internet without approval.", unattended: true },
    ],
    summary: "OpenAI's Codex CLI, driven over ACP by the Agent Client Protocol bridge.",
    launch: {
      kind: "child-process",
      // The bridge, not `codex`. Codex has servers of its own — `codex app-server` and
      // `codex mcp-server` — and neither speaks ACP: `codex --help` on 0.147.0 lists no `acp`
      // subcommand, and `codex acp` exits immediately. `codex exec --json` (what this entry used to
      // describe) is a one-shot CLI and never answers an ACP `initialize` — measured, 20 s, no reply.
      binaries: ["codex-acp"],
      agentBinaries: ["codex"],
      buildArgs: ({ extraArgs }) => [...splitArgs(extraArgs)],
      stream: "jsonl",
      transport: "acp",
      // Verified. This bridge *silently ignores* the peer's `mode` field, which is exactly why the
      // name is declared: `session/set_mode {modeId: "agent-full-access"}` → `{}`, and the option state
      // came back with that preset selected.
      modeParam: "modeId",
      resumeArgs: () => [],
      // **No `authMethodId`, and that is a decision.** This bridge offers three methods — `api-key` and
      // `openai-api-key`, both `type: "env_var"`, and `chat-gpt` — and a fresh process opens a session
      // without any of them (`session/new` answered with a session id and a full option state, while
      // `authenticate {methodId: "api-key"}` answered `CODEX_API_KEY or OPENAI_API_KEY is not set`).
      // Naming a method here would make EnvoyCoder fail a run that the agent itself is willing to start,
      // so the credential is left to the user's own `codex login` / environment, which is where the
      // agent reads it.
    },
    capabilities: {
      // `sessionCapabilities: {resume, close, list, fork, delete}` advertised, and then exercised: a
      // session created by one process was accepted by `session/resume` in the next, same directory.
      resume: true,
      cancel: true,
      // **Not observed here, so no longer a guess in either direction.** The previous entry claimed
      // `true` from the one-shot CLI's flags. The bridge's `mode` option *is* the approval preset
      // ("Read Only … approval is required to edit files"), and `session/set_config_option
      // {configId: "mode"}` moved it — which is a mode, not a policy — so nothing asserts that a
      // `session/request_permission` arrives. Left false until a turn can be run here at all.
      approvals: false,
      structuredTools: true,
      streaming: true,
      images: true,
      agentMode: true,
      approvalPolicy: false,
      worktrees: "external",
    },
    install: {
      // The agent (`@openai/codex` — verified on this machine, where `codex` is a symlink into
      // `~/.npm-global/lib/node_modules/@openai/codex/bin/codex.js`) and then the bridge over it.
      hint: "npm install -g @openai/codex (then sign in once: `codex login`)",
      url: "https://www.npmjs.com/package/@openai/codex",
      bridge: {
        hint: "npm install -g @agentclientprotocol/codex-acp",
        url: "https://www.npmjs.com/package/@agentclientprotocol/codex-acp",
        package: "@agentclientprotocol/codex-acp",
      },
    },
    evidence:
      "VERIFIED against the real binaries on 2026-09-14, macOS. `codex --version` → codex-cli 0.147.0; " +
      "`codex --help` lists exec/review/mcp/mcp-server/app-server/remote-control and **no** `acp` " +
      "subcommand, and `codex acp` exits immediately; `codex exec --json` never answers an ACP " +
      "`initialize` (no reply in 20 s). Two bridge generations were measured: " +
      "`@zed-industries/codex-acp` 0.16.0 (deprecated, pointing at the new name) and " +
      "`@agentclientprotocol/codex-acp` 1.11.0, which is what the entry now names. Through 1.11.0: " +
      "`initialize` → `{protocolVersion: 1, agentInfo: {name: '@agentclientprotocol/codex-acp'}, " +
      "sessionCapabilities: {resume, list, close, fork, delete}, authMethods: [api-key, chat-gpt]}`; " +
      "`session/new` → `{sessionId, models, modes, configOptions}` with configOptions `mode` " +
      "(read-only | agent | agent-full-access, current `agent`), `collaboration_mode` (default | plan) " +
      "and `model` (31 models through `models.availableModels`); " +
      "`session/set_mode {modeId: 'agent-full-access'}` → `{}`; " +
      "`session/set_config_option {configId: 'model', value: 'gpt-5.5'}` → accepted, with the returned " +
      "option state naming gpt-5.5 as current. **A TURN COULD NOT BE COMPLETED ON THIS MACHINE**: " +
      "`session/prompt` produced no answer in 120 s, and the bridge's own stderr said why — " +
      "`wss://chatgpt.com/backend-api/codex/responses` → `Connection refused` and " +
      "`failed to refresh available models`. That is this machine's network path to the provider and " +
      "not a fault in the command, but it is the honest limit of what was proven here: handshake, " +
      "session, options, mode change and resume are verified; a finished turn is not. " +
      "UNVERIFIED: `capabilities.cancel`, and `approvals` (see the `capabilities` note).",
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
    summary: "GitHub Copilot's CLI agent, driven over ACP by its own `--acp` server.",
    launch: {
      kind: "child-process",
      binaries: ["copilot"],
      /**
       * **`--acp`, and nothing else.** Copilot 1.0.83 starts an Agent Client Protocol server on stdin/stdout
       * with that one flag; it takes no prompt, no model and no resume id in argv — a prompt in this argv would
       * be handed to a program that reads none of it. The model and the mode travel as session options, exactly
       * as they do for the two bridges.
       */
      buildArgs: ({ extraArgs }) => ["--acp", ...splitArgs(extraArgs)],
      stream: "jsonl",
      transport: "acp",
      // Measured, not guessed: `initialize` answers this method id, and it is the one `coder.signInAgent` must
      // name. See `evidence` for what it does when asked — the answer is honest and not what the button implies.
      authMethodId: "copilot-login",
    },
    capabilities: {
      // `agentCapabilities.loadSession: true` and `sessionCapabilities: {close, list}` — advertised by the server
      // on `initialize`. Advertised is what this entry can record; a resume has not been exercised here.
      resume: true,
      cancel: true,
      // Not observed: no session has opened on the machine this was written on, so no `session/request_permission`
      // has been seen. Claiming `true` would enable "ask before anything destructive" for an agent whose asking
      // posture has never been watched — the mistake the `claudecode` entry records and undid.
      approvals: false,
      structuredTools: true,
      streaming: true,
      // `promptCapabilities.image: true`, measured on `initialize`.
      images: true,
      /**
       * **Off, and it was `true` while this entry was refused.** The flag means "this daemon can *set* a mode", and
       * `drivable.test.ts` demands that a `true` here name the field the agent reads (`mode` or `modeId`) — which
       * cannot be defaulted, because a wrong guess is a silent no-op for one of the two contracts. Nobody has read
       * that field on this server: `session/new` answers `Authentication required` until `copilot login` has run,
       * so there has been no session to ask. The modes below still travel as facts; the picker stays off with a
       * reason until somebody signs in and reads a session.
       */
      agentMode: false,
      approvalPolicy: false,
      worktrees: "external",
    },
    install: { hint: "npm install -g @github/copilot", url: "https://github.com/features/copilot/cli/" },
    evidence:
      "VERIFIED against the real binary on 2026-09-15, macOS: `copilot --version` → 1.0.83, and " +
      "`copilot --help` lists `--acp  Start as Agent Client Protocol server`. Driving it over stdio: " +
      "`initialize {protocolVersion: 1}` → `{protocolVersion: 1, agentInfo: {name: 'Copilot', version: " +
      "'1.0.83'}, agentCapabilities: {loadSession: true, sessionCapabilities: {close, list}, " +
      "mcpCapabilities: {http, sse}, promptCapabilities: {image: true, embeddedContext: true}}, " +
      "authMethods: [{id: 'copilot-login', name: 'Log in with Copilot CLI'}]}`. This is why the entry is " +
      "`transport: \"acp\"` and not `\"cli\"`: it was the least certain entry in the catalogue, Paseo drives " +
      "the same server (`packages/server/src/server/agent/providers/copilot-acp-agent.ts`, " +
      "`defaultCommand: [\"copilot\", \"--acp\"]`), and the binary answers. " +
      "**`session/new` asserts the limit of this measurement:** it answers `-32000 Authentication required` " +
      "until the user has run `copilot login`, so the modes, the model list and the `allow_all` config option " +
      "advertised by the server have NOT been read here — the modes below are Paseo's ids for this server, not " +
      "this machine's observation of them, and the capability flag that depends on a session " +
      "(`thinking`) is `false` for that reason rather than because the server lacks it. UNVERIFIED: " +
      "`capabilities.cancel`, `approvals`, and every mode change.",
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
        ...(model ? ["--model", modelIdOf(model)] : []),
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
      agentMode: false,
      // Same claim, same reason: no ACP policy method for this entry to be handed one through.
      approvalPolicy: false,
      worktrees: "external",
    },
    install: { hint: "see the project's install instructions", url: "https://github.com/anomalyco/opencode" },
    evidence:
      "unverified — `opencode run` with an optional `--model` is assumed; Paseo's CLI reference shows " +
      "provider-qualified models (`paseo run --provider claude/opus-4.6`), which is where our " +
      "`provider/model` string convention comes from (paseo README, CLI section). **A LEAD, not this " +
      "entry's command, and not a claim:** OpenCode's own documentation has an 'ACP Support' page whose " +
      "entire configuration is `command: \"opencode\", args: [\"acp\"]` — 'starts OpenCode as an " +
      "ACP-compatible subprocess that communicates with your editor over JSON-RPC via stdio' — so the " +
      "command above is very probably not the one to use and this entry is very probably an ACP agent. " +
      "NOT verified here: `opencode` is not installed on the machine this was written on, so nothing " +
      "was driven and nothing changed. The entry is still `transport: \"cli\"` and still refused by " +
      "`isDrivableByAcpAdapter`, which is what a user meets.",
  },

  cursor: {
    id: "cursor",
    label: "Cursor Agent",
    tier: "catalogued",
    // Empty before this slice — "carried over from EnvoyMesh's harness list" with no evidence — and
    // taken from the live session now.
    modes: [
      { id: "agent", label: "Agent", description: "Full agent capabilities with tool access." },
      { id: "plan", label: "Plan", description: "Read-only mode for planning and designing before implementation.", unattended: false },
      { id: "ask", label: "Ask", description: "Questions and answers — no edits, no command execution.", unattended: false },
    ],
    summary: "Cursor's headless agent CLI, which speaks ACP itself.",
    launch: {
      kind: "child-process",
      // `cursor-agent`, not the `cursor` editor launcher that sits beside it on PATH: only the agent
      // binary has the `acp` subcommand. (`cursor-agent --help` lists it under a `agent [prompt...]`
      // usage; `cursor-agent acp` is what was driven here.)
      binaries: ["cursor-agent"],
      // The subcommand, and nothing else. The prompt goes over the protocol, the model is a session
      // config option (`./models.ts`), and a resume is `session/resume`.
      buildArgs: ({ extraArgs }) => ["acp", ...splitArgs(extraArgs)],
      stream: "jsonl",
      transport: "acp",
      // **Needed on a fresh installation, and declared because the client may not guess one.** On its
      // first run here, `session/new` without it answered `-32000 Authentication required … call
      // authenticate() with methodId 'cursor_login'`; with it, the session opened. See the entry's
      // `evidence` for the second, later observation — the requirement is stateful, so this is declared
      // and sent idempotently rather than inferred from a refusal.
      authMethodId: "cursor_login",
      // Verified: `session/set_mode {modeId: "plan"}` → `{}`, and the `mode` config option came back
      // with `plan` as its current value.
      modeParam: "modeId",
      resumeArgs: () => [],
    },
    capabilities: {
      // The one falseflag here that is the *agent's* own answer rather than our ignorance: its
      // `initialize` advertises `sessionCapabilities: {list}` — no `resume`, unlike the two bridges.
      resume: false,
      cancel: true,
      approvals: false,
      // Unverified in this direction: the tool calls a Cursor turn produces were not observed here, so
      // this stays at the conservative `false` it had.
      structuredTools: false,
      streaming: true,
      // `promptCapabilities.image: true`, read from its own `initialize` answer. It said `false` before,
      // which was an assumption about a command we could not launch.
      images: true,
      agentMode: true,
      approvalPolicy: false,
      worktrees: "external",
    },
    install: {
      hint: "install the Cursor agent CLI (`cursor-agent`) and sign in once with `cursor-agent login` — the CLI handles its own updates",
      url: "https://docs.cursor.com/en/cli/overview",
    },
    evidence:
      "VERIFIED against the real binary on 2026-09-14, macOS: `cursor-agent --version` → " +
      "2026.06.24-00-45-58-9f61de7, and `cursor-agent status` → logged in. This entry used to describe " +
      "`cursor-agent -p <prompt>` and a note saying it needed a bespoke adapter; neither is true. " +
      "`cursor-agent acp` speaks ACP over stdio — the Cursor CLI documents the subcommand itself — and " +
      "the raw frames are: `initialize` → `{protocolVersion: 1, agentCapabilities: {loadSession: true, " +
      "promptCapabilities: {image: true}, sessionCapabilities: {list}}, authMethods: [{id: " +
      "'cursor_login'}]}`; without authentication `session/new` → `-32000 Authentication required. " +
      "Please run 'agent login' first, then call authenticate() with methodId 'cursor_login'.`; with " +
      "`authenticate {methodId: 'cursor_login'}` (which took ~13 s and answered `{}`) `session/new` → " +
      "`{sessionId, modes, models, configOptions}` — three modes (agent | plan | ask), seven models " +
      "(`default[]`, `composer-2.5[fast=true]`, `grok-4.6[effort=high,fast=true]`, …) and two options " +
      "(`mode`, `model`). `session/set_mode {modeId: 'plan'}` → `{}`, and " +
      "`session/set_config_option {configId: 'model', value: 'composer-2.5[fast=true]'}` → accepted with " +
      "the mode echoed as `plan`. Also observed and rejected: the peer's field name — " +
      "`session/set_mode {mode: 'plan'}` → `-32603 Internal error, path: ['modeId'], expected string`. " +
      "**The `authenticate` requirement is STATEFUL, and both observations are recorded because the " +
      "difference matters.** The refusal above was the first run in this state. After the step had been " +
      "sent once — and after the model change above wrote `~/.cursor/acp-config.json` — the same binary " +
      "opened sessions reproducibly with the `authenticate` call *removed*, so on a machine that has " +
      "already been through it the step is invisible either way. It is therefore declared and sent " +
      "idempotently (a fresh installation is the case that needs it) rather than driven by a refusal, and " +
      "the deterministic proof that the client sends it lives in the scripted-agent case in " +
      "`apps/desktop/test/acp-agent-support.test.ts`. **A TURN WAS NOT COMPLETED HERE**: a session, its " +
      "options and a mode change were, and the session was then closed deliberately. UNVERIFIED: " +
      "`capabilities.cancel`, `structuredTools` and `approvals`.",
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
      agentMode: false,
      // Same claim, same reason: no ACP policy method for this entry to be handed one through.
      approvalPolicy: false,
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
      agentMode: false,
      // Same claim, same reason: no ACP policy method for this entry to be handed one through.
      approvalPolicy: false,
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

export interface HarnessProbe extends ProbeFinding {
  /**
   * Which of the nine we ship this probe is about.
   *
   * The one field `ProbeFinding` cannot carry, and the reason the prober takes a *recipe* rather than an
   * id: a provider a user declared is probed by the same code (`providers.ts`), and its id is a name the
   * user chose rather than a member of `HARNESS_IDS`. Everything else — the five states, the paths that
   * make them checkable, the fixes — is shared, which is what makes "a provider arrives with the same
   * states from the same probe" a fact about one function rather than a promise.
   *
   * The five-state reasoning that used to be written here now lives on `ProbeFinding.state` in
   * `probe.ts`, beside the checks that produce it.
   */
  id: HarnessId;
}

/**
 * The probe, over the catalogue: the recipe from one entry, handed to the one prober.
 *
 * A wrapper and nothing more, on purpose. `probeRecipe` is where the five checks live — see its module
 * for the order, which *is* the fix — and this adds the one thing a catalogue id can add: which entry was
 * asked about. A second body here (the shape before the provider slice) is how the two tiers would have
 * come to disagree about the same machine.
 */
export function probeHarness(id: HarnessId, options: ProbeHarnessOptions = {}): HarnessProbe {
  return { id, ...probeRecipe(harnessRecipe(harnessDefinition(id)), options) };
}

/**
 * One catalogue entry, flattened into the launch facts a probe needs.
 *
 * The eager `entry()` call is deliberate and unchanged from when this code lived inside `probeHarness`:
 * it builds a path under the repository root and touches no filesystem, and calling it per probe is what
 * makes a peer checkout that appears while the app is running visible without a restart.
 */
export function harnessRecipe(definition: HarnessDefinition): ProbeRecipe {
  const launch = definition.launch;
  if (launch.kind === "in-process") {
    return {
      label: definition.label,
      kind: "in-process",
      binaries: [],
      transport: "acp",
      module: launch.module,
      ...(definition.install ? { install: definition.install } : {}),
    };
  }
  return {
    label: definition.label,
    kind: "child-process",
    binaries: launch.binaries,
    transport: launch.transport,
    ...(launch.agentBinaries ? { agentBinaries: launch.agentBinaries } : {}),
    ...(launch.devCheckout ? { devCheckoutEntry: launch.devCheckout.entry() } : {}),
    ...(definition.install ? { install: definition.install } : {}),
  };
}


/**
 * **The npm package a fetched connector comes from** — or `undefined`, which is the honest answer for every
 * agent whose adapter cannot be fetched.
 *
 * A separate accessor rather than the definition, because the two callers want the *fact* and nothing else: the
 * daemon's launch needs the argv, and the row needs to say what will be downloaded on the first run.
 */
export function bridgePackage(id: HarnessId): string | undefined {
  return HARNESS_CATALOG[id].install?.bridge?.package;
}

/**
 * **The recipe for a connector that is fetched rather than installed** — what the launch probes and runs when a
 * user has chosen the `npx` delivery.
 *
 * ## Why a recipe rather than a branch inside the launch
 *
 * Everything downstream of the recipe is the machinery this repository already trusts: `probeRecipe` looks for
 * `binaries[0]` on the resolved search path and reports the five states, `resolveLaunch` refuses in the two
 * right ways, and the child gets the `PATH` the probe searched. So the fetched route is expressed as *a
 * different program to start* — `npx` — and inherits every one of those rules instead of re-implementing them.
 *
 * The **agent's own** binary stays on the recipe, because the bridge drives it: `claude-agent-acp` runs
 * `claude`, and a fetched bridge for an agent that is itself absent would download a package and then fail. The
 * probe keeps reporting that honestly (`not-installed`, with the agent's own install hint).
 */
export function fetchedBridgeRecipe(id: HarnessId): ProbeRecipe | undefined {
  const definition = HARNESS_CATALOG[id];
  const pkg = bridgePackage(id);
  if (pkg === undefined || definition.launch.kind !== "child-process") return undefined;
  return {
    label: definition.label,
    kind: "child-process",
    // **The program we launch is `npx`**, and that is what the probe looks for: a machine with no `npx` cannot
    // take this route, and the row must say so rather than offering a download nothing can perform.
    binaries: ["npx"],
    transport: definition.launch.transport,
    ...(definition.launch.agentBinaries ? { agentBinaries: definition.launch.agentBinaries } : {}),
    // The bridge's own hint, and the page that explains it — this is the thing being fetched, so it is what an
    // install hint has to be about.
    install: {
      hint: definition.install?.bridge?.hint ?? `npx -y ${pkg}`,
      ...(definition.install?.bridge?.url !== undefined ? { url: definition.install.bridge.url } : {}),
    },
  };
}

/**
 * The argv a fetched connector runs: `npx -y <package>`, plus the user's own extra arguments.
 *
 * `-y` is not optional: `npx` prompts before downloading an uninstalled package, and a prompt inside a spawned
 * ACP server is a process that never answers `initialize` — the failure would read as "the agent is broken"
 * rather than "somebody has to type `y`". The user's decision was the press that chose this delivery.
 */
export function fetchedBridgeArgs(id: HarnessId, extraArgs: string | undefined): string[] {
  const pkg = bridgePackage(id);
  if (pkg === undefined) return [];
  return ["-y", pkg, ...splitArgs(extraArgs)];
}

/**
 * **Every program name a probe in this daemon could ask about**, in one list.
 *
 * The caller is the daemon's boot prime (`apps/desktop/src/daemon/serve.ts`), and it exists because the
 * question "where does the user's shell find this name" costs one login shell per *invocation* rather than one
 * per name: the names have to be known up front, and the authority on which names matter is the catalogue
 * itself rather than a second list somebody maintains beside it.
 *
 * Built from the **recipes**, not from the catalogue's own fields, so it cannot drift: a recipe is what a probe
 * actually looks for, and an entry that gains an `agentBinaries` (a bridge over a vendor CLI) has that name
 * asked about without anyone remembering to add it here. Both tiers are included — the nine agents we ship and
 * all 38 recipes — because a user may check any row of the catalogue, and `extra` carries the one thing the
 * catalogue cannot know: the commands **the user declared**.
 *
 * Deliberately unfiltered: which names a shell may be asked about is `@envoycoder/platform`'s rule (a closed
 * character set, because a provider's command is user-controlled data), and a second copy of that rule here
 * would be the copy that went stale.
 */
export function probeableBinaryNames(extra: readonly string[] = []): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (recipe: ProbeRecipe): void => {
    for (const name of [...recipe.binaries, ...(recipe.agentBinaries ?? [])]) {
      const trimmed = name.trim();
      if (trimmed === "" || seen.has(trimmed)) continue;
      seen.add(trimmed);
      names.push(trimmed);
    }
  };
  for (const definition of Object.values(HARNESS_CATALOG)) add(harnessRecipe(definition));
  for (const entry of ACP_AGENT_CATALOG) add(cataloguedRecipe(entry));
  for (const name of extra) add({ label: "", kind: "child-process", binaries: [name], transport: "acp" });
  return names;
}

/**
 * A probe, projected onto the **wire**.
 *
 * A function rather than "let the daemon pick the fields out", for the reason this repository keeps giving:
 * the five states have five agreement rules (`HarnessAvailabilitySchema`), and the way to be sure a probe
 * satisfies them is to have exactly one place that turns one into the other — a second copy at the call
 * site is the copy that goes stale, and the failure would be a `coder.listHarnesses` answer the contract
 * refuses. `test/agent-catalog.test.ts` runs every catalogue entry through this and parses the result, so
 * the rules are checked against the real catalogue rather than against a hand-built example.
 *
 * `via` and `reason` are deliberately dropped: `via` is a launch fact (`resolveHarnessCommand` reads it)
 * and `reason` is English prose for the log. What travels is the state, the paths that make it checkable,
 * the provenance of a resolved program, and the commands that fix it.
 *
 * **It takes a `ProbeFinding` rather than a `HarnessProbe`, and the name stayed.** A provider a user
 * declared is projected by this same function (`providers.ts` probes it, `service.ts` projects it), and
 * that is the requirement rather than a convenience: "a provider arrives with the same states" is only
 * true if there is one place that turns a finding into a state. The parameter is the shared half of the
 * probe — the id is the one field a projection cannot need, because it is the field the two tiers spell
 * differently.
 */
export function harnessAvailability(probe: ProbeFinding): HarnessAvailability {
  return {
    state: probe.state,
    ...(probe.binaryPath !== undefined ? { binary: probe.binaryPath } : {}),
    ...(probe.agentBinaryPath !== undefined ? { agentBinary: probe.agentBinaryPath } : {}),
    ...(probe.provisional !== undefined ? { provisional: probe.provisional } : {}),
    ...(probe.fix !== undefined ? { fix: probe.fix } : {}),
  };
}

/**
 * The two **protocol** facts an entry declares: what to authenticate with, and what its mode method
 * reads.
 *
 * A function rather than two field reads at the call site for a reason that is not cosmetic: `launch`
 * is a union, so a caller that reached into it would have to narrow the variant itself — and the one
 * caller (`launchForHarness`) is in another package, where a `kind === "child-process"` check would be
 * a branch it can never take rather than a fact it can use. Here the narrowing happens once, next to
 * the type that needs it, and every caller gets `{}` for the entries that declare neither.
 *
 * Deliberately not merged into `AcpLaunch`'s `env` or `args`: these describe how to *speak* to the
 * agent once it is running, not how to start it, and keeping them separate is what lets the client
 * refuse a mode for an agent whose method nobody has read.
 */
export function harnessAcpFacts(id: HarnessId): {
  authMethodId?: string;
  modeParam?: "mode" | "modeId";
} {
  const launch = harnessDefinition(id).launch;
  if (launch.kind !== "child-process") return {};
  return {
    ...(launch.authMethodId !== undefined ? { authMethodId: launch.authMethodId } : {}),
    ...(launch.modeParam !== undefined ? { modeParam: launch.modeParam } : {}),
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

/**
 * Exactly what to run for a harness: the command, and the args *before* the harness's own.
 *
 * Separated from `buildHarnessInvocation` because the two answer different questions. That one says
 * what argv this harness understands; this one says what process to start — which is not the same
 * answer for a harness living in a peer checkout, where the command is Node and the first argument
 * is the script.
 *
 * It takes a `ProbeFinding` rather than a `HarnessProbe`, which is the same widening
 * `harnessAvailability` documents: the caller that has just probed is the shared body in
 * `apps/desktop/src/daemon/launch.ts`, which holds a *finding* — the id is the one field it does not
 * need here, because the entry's own `id` argument says which entry this is about.
 */
export function resolveHarnessCommand(
  id: HarnessId,
  probe: ProbeFinding,
  input: RunInput,
): { command: string; args: string[] } {
  const definition = harnessDefinition(id);
  if (definition.launch.kind !== "child-process") {
    throw new Error(`${id} is not a child-process harness, so there is no command to resolve.`);
  }
  if (probe.state !== "ready" || !probe.binaryPath) {
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


export * from "./acp-catalog.js";
// How a user-typed argument string becomes argv — shared with a user-declared provider, which takes
// arguments the same way a catalogue entry does. See its head for why a second splitter would drift.
export * from "./args.js";
// **The prober**, in its own module because it is now asked about two tiers: the nine agents in
// `HARNESS_CATALOG` below and whatever a user declares in settings (`./providers.js`). One body, one
// order of checks — see its head for why a second one would be the drift this whole slice is about.
export * from "./probe.js";
export * from "./providers.js";
// The model facts live in their own module — see its head for why a per-agent model list, its
// provenance and the way the value travels are one subject rather than three lines per entry.
export * from "./models.js";
// And what an agent publishes **inside a session** — the model list it enumerates there, and its
// thinking level — in a third, for the same reason: it is the one subject no catalogue can answer on
// its own, because the answer arrives from a session and is kept with the time it was seen.
export * from "./session-options.js";
