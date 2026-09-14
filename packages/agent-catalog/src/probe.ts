/**
 * **The** prober: what this machine can do with one program, whoever declared it.
 *
 * ## Why it is its own module, and why that is the point of this slice
 *
 * `probeHarness` used to be the whole answer, because the nine agents in `HARNESS_CATALOG` were the only
 * ones that existed. A user may now declare a provider of their own (`AgentProviderConfig`), and the
 * tempting shape is a second prober beside the first — "same five states, one `find` call" — which is
 * exactly how two answers to one question start to differ. The first divergence would be a *fact about
 * an agent* that is false: a catalogue entry reported `not-installed` while a provider with the same
 * command reported `ready`, or the reverse.
 *
 * So the body lives here once, over a **recipe** rather than over a catalogue id. A recipe is the
 * launch facts a probe needs and nothing else — no label lookup, no `HarnessId`, no knowledge of which
 * tier the entry came from. `index.ts` builds one from a catalogue entry; `providers.ts` builds one from
 * a provider config; `probeHarness` and `probeProvider` are two thin wrappers that add their own id.
 *
 * ## The order of the checks is the whole fix
 *
 *   1. **The program we drive** resolved → `ready`, or `unsupported` if this build cannot speak its
 *      protocol. Nothing else can be said and nothing else needs to be.
 *   2. It did not, and the entry declares a bridge → ask whether the **agent's own** program is there. If
 *      it is, the answer is `needs-bridge` and the fix is the bridge's install command.
 *   3. Nothing so far, and the peer checkout is built → `ready` via `node-script`.
 *   4. Nothing at all, **and we could search** → `not-installed`, with the entry's own hint.
 *   5. Nothing at all and we could not search → `unknown`. Never `not-installed`: we did not look, and
 *      the difference is the entire point of the state.
 *
 * All five were reached from a bug report ("I have installed codex and claudecode … why all of them
 * shown 'Not Installed'"), and the reasoning is preserved verbatim from `index.ts` because the *order*
 * is what fixes it rather than any single line.
 */

import { createRequire } from "node:module";

import {
  type AvailabilityFix,
  type HarnessState,
  type ToolCache,
} from "@envoycoder/protocol";
import { type PlatformId, detectPlatform, findBinary, provisionalCacheOf } from "@envoycoder/platform";

// The same arrangement `index.ts` uses for its two filesystem questions: `require` rather than a static
// import, so nothing here pulls `node:fs` into a client bundle that only reads the catalogue.
const require = createRequire(import.meta.url);

/**
 * How a user gets this program onto a machine, in the two halves that "installed" turned out to mean.
 *
 * `hint` is the **agent itself** and `bridge` is the adapter we drive it through, and keeping them apart
 * is the fix for the bug report above rather than a taxonomy: a single hint was always the *bridge's*
 * command for a bridged agent, so a row could only tell a user to install a package they had never heard
 * of while the agent they had installed was reported missing.
 *
 * A user-declared provider has no hints at all, and that is a real gap rather than an oversight: nobody
 * can author an install command for a program we have never heard of. See `notInstalledFix` for what the
 * probe says instead, and `AgentProviderConfig` for the shape that makes it unavoidable.
 */
export interface HarnessInstallHints {
  hint: string;
  url?: string;
  /** The ACP bridge or vendor subcommand's package, for an entry whose launch binaries are not the agent. */
  bridge?: { hint: string; url?: string };
}

/**
 * Everything a probe needs to know about one program.
 *
 * Deliberately *not* the catalogue's `AgentLaunch` union: a recipe flattens the two facts the probe
 * branches on (`kind` and `transport`) and pre-resolves the one thing that has side effects of its own
 * (`devCheckoutEntry`, a filesystem path built from the repository root). Keeping it flat is what lets a
 * provider config — which is data, not code — produce one.
 */
export interface ProbeRecipe {
  /** What to call the program in the reason a user reads. */
  label: string;
  kind: "child-process" | "in-process";
  /** The program(s) we drive, tried in order. The first that resolves wins. */
  binaries: readonly string[];
  /** How the daemon must speak to it. A non-ACP program that resolves is `unsupported`, not `ready`. */
  transport: "acp" | "cli";
  /**
   * The **agent's own** program, when what `binaries` names is a bridge over it rather than the agent
   * itself. Used only to tell "the agent is not installed" from "the agent is installed and its adapter
   * is not" — it is never launched.
   */
  agentBinaries?: readonly string[];
  /** The module an `in-process` subject needs, for the one branch that asks whether it is resolvable. */
  module?: string;
  /**
   * A built entry point outside `PATH` — the peer checkout — already resolved to a path.
   *
   * A string rather than a function because building it is the recipe's job: `index.ts` calls the
   * catalogue's own `entry()` when it assembles the recipe, which is per probe, so a checkout that
   * appears while the app is running is still found.
   */
  devCheckoutEntry?: string;
  /** The install steps that fix this entry's availability states. Absent for a program the user declared. */
  install?: HarnessInstallHints;
  /**
   * The command line a user wrote, for the one tier that has no authored install step.
   *
   * Used only by `notInstalledFix`, and only when `install` is absent — which is to say only for a
   * provider. Every catalogue entry names an install command (`test/agent-catalog.test.ts` asserts it), so
   * this field changes nothing for the nine agents we ship; it exists so a missing *provider* can still
   * carry a fix, which `HarnessAvailabilitySchema` requires of any state that asserts an absence.
   */
  commandLine?: string;
}

/**
 * What one probe found, without the id — the part both tiers share.
 *
 * `HarnessProbe` (in `index.ts`) is this plus `id: HarnessId`; `ProviderProbe` (in `providers.ts`) is
 * this plus `id: string`. Two ids because the two tiers are genuinely identified differently: one is a
 * closed union of agents we ship, the other is a name a user chose.
 */
export interface ProbeFinding {
  /**
   * **Which of the five things is true.** The one field a caller branches on.
   *
   * `available: boolean` used to be here and it could not answer the question the window asks: "the agent
   * is installed and its adapter is not" and "the agent is not installed" are different sentences with
   * different fixes, and both were `false`.
   */
  state: HarnessState;
  /** Absolute path we would launch, when it is a child process and we found one. */
  binaryPath?: string;
  /**
   * How it would be launched.
   *
   * `path` is the ordinary case — a binary on `PATH`. `node-script` is the **peer checkout**: the
   * built-in harness is a peer of the family rather than something we distribute, so a developer who has
   * cloned it next to this repo can run it without a global install. The distinction is stated rather
   * than inferred from the extension, because launching the wrong thing as a script is a failure that
   * reads as "the agent is broken".
   */
  via?: "path" | "node-script";
  /** The agent's own program, when what we drive is a bridge over it and this is what we found. */
  agentBinaryPath?: string;
  /** Set when the program we drive resolved out of another tool's cache. See `provisionalCacheOf`. */
  provisional?: ToolCache;
  /**
   * What to run to reach `ready`, in order, when something must be installed.
   *
   * Built from the recipe's two install hints: the bridge's steps for `needs-bridge`, and the agent's
   * followed by the bridge's for `not-installed` — because a bridged agent whose *agent* is missing will
   * also be missing its bridge, and naming one of the two would land the user on the other a minute
   * later. For a **user-declared provider** the hint is the user's own command line: see
   * `notInstalledFix`.
   */
  fix?: readonly AvailabilityFix[];
  /** Why it is not ready, in end-user language. Carried for the log and for `coder.probeHarness`. */
  reason?: string;
}

/** What a probe is given. */
export interface ProbeHarnessOptions {
  platform?: PlatformId;
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests. */
  find?: (name: string) => string | null;
  /** For in-process harnesses: is the module resolvable? */
  moduleAvailable?: (module: string) => boolean;
  /** Injectable for tests, so probing the peer checkout needs no filesystem. */
  fileExists?: (path: string) => boolean;
  /**
   * The directories to search, in this order.
   *
   * **The seam that makes probing and spawning agree.** A GUI-launched daemon's own `PATH` does not
   * contain the user's tools, so the list has to be resolved rather than inherited — and the *same* list
   * has to be handed to the spawn, or a program that probed as present can fail to start. Omitted means
   * "use the environment in `env`", which is what a test with no filesystem wants; the daemon always
   * passes it.
   */
  pathDirs?: readonly string[];
  /**
   * False when no search list could be assembled at all — see `SearchPath.searchable`.
   *
   * A `find` that answers `null` for everything cannot, on its own, distinguish "we searched and found
   * nothing" from "we had nothing to search", and those are `not-installed` and `unknown`. The caller
   * that resolved the path is the only one that knows, so it says.
   */
  searchable?: boolean;
}

/**
 * The install steps that fix one entry's availability, as the wire wants them.
 *
 * Two shapes out of one recipe, and the difference is what the user is missing: `"bridge"` is the adapter
 * alone, `"agent"` is the agent followed by the adapter. Returns `undefined` when the recipe declares no
 * such hint, which is what keeps rule 4 of `HarnessAvailabilitySchema` honest: an installable state must
 * carry a command, so an entry with nothing to say cannot produce one.
 */
function fixesFor(
  install: HarnessInstallHints | undefined,
  steps: "bridge" | "agent",
): readonly AvailabilityFix[] | undefined {
  const out: AvailabilityFix[] = [];
  if (steps === "agent" && install) {
    out.push({ command: install.hint, ...(install.url ? { url: install.url } : {}) });
  }
  if (install?.bridge) {
    out.push({ command: install.bridge.hint, ...(install.bridge.url ? { url: install.bridge.url } : {}) });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Is this program usable here?
 *
 * Deliberately *not* a network call and deliberately not cached: an agent can be installed while the app
 * is open, and "I just installed it, why doesn't it show up" is a support ticket. The caller decides how
 * often to ask. See the module doc for the order of the five checks, which is the fix itself.
 */
export function probeRecipe(recipe: ProbeRecipe, options: ProbeHarnessOptions = {}): ProbeFinding {
  const platform = options.platform ?? detectPlatform();
  const fixFor = (steps: "bridge" | "agent") => fixesFor(recipe.install, steps);

  if (recipe.kind === "in-process") {
    // No entry uses this variant any more — every agent here is a child process — but the branch stays
    // because the launch union still has the variant, and a missing runtime is a fact this product would
    // have to report rather than crash on. `unknown` rather than `not-installed` when the caller did not
    // say: a module we could not ask about is not a module we established is absent.
    if (options.moduleAvailable === undefined) {
      return {
        state: "unknown",
        reason: `EnvoyCoder has not checked whether ${recipe.label}'s runtime (${recipe.module}) is present.`,
      };
    }
    const isAvailable = options.moduleAvailable(recipe.module ?? "");
    return {
      state: isAvailable ? "ready" : "not-installed",
      ...(isAvailable
        ? {}
        : {
            reason: `${recipe.label} is built into EnvoyCoder, but its runtime (${recipe.module}) is not present. Run \`npm run peers:check\` for the exact fix.`,
            ...(fixFor("agent") ? { fix: fixFor("agent") } : {}),
          }),
    };
  }

  const find =
    options.find ??
    ((name: string) =>
      findBinary(name, {
        platform,
        env: options.env,
        ...(options.pathDirs !== undefined ? { pathDirs: options.pathDirs } : {}),
      }));

  for (const binary of recipe.binaries) {
    const resolved = find(binary);
    if (!resolved) continue;
    const provisional = provisionalCacheOf(resolved);
    // The installed-but-not-drivable case, and it is not the `ready` chip: the daemon refuses every entry
    // whose transport is not ACP with `harnessUnsupported`, so a green chip here would promise a run that
    // cannot happen.
    if (recipe.transport !== "acp") {
      return {
        state: "unsupported",
        binaryPath: resolved,
        via: "path",
        ...(provisional ? { provisional } : {}),
        reason: `${recipe.label} is installed at ${resolved}, but it speaks a protocol EnvoyCoder cannot drive yet.`,
      };
    }
    return {
      state: "ready",
      binaryPath: resolved,
      via: "path",
      ...(provisional ? { provisional } : {}),
    };
  }

  // Step 2: the bridge is missing. Is the agent itself there? This is the question nobody was asking.
  if (recipe.agentBinaries && recipe.agentBinaries.length > 0) {
    for (const binary of recipe.agentBinaries) {
      const resolved = find(binary);
      if (!resolved) continue;
      return {
        state: "needs-bridge",
        agentBinaryPath: resolved,
        ...(fixFor("bridge") ? { fix: fixFor("bridge") } : {}),
        reason:
          `${recipe.label} is installed at ${resolved}, but the Agent Client Protocol adapter ` +
          `EnvoyCoder drives it through (${recipe.binaries.join(", ")}) is not installed` +
          (recipe.install?.bridge ? `. ${recipe.install.bridge.hint}` : "."),
      };
    }
  }

  // Not on PATH: for a harness we are allowed to run from a clone, look in the peer checkout. This is what
  // makes the built-in harness usable on a development machine without `npm i -g`.
  const peerEntry = recipe.devCheckoutEntry;
  if (peerEntry && (options.fileExists ?? defaultFileExists)(peerEntry)) {
    return { state: "ready", binaryPath: peerEntry, via: "node-script" };
  }

  // Step 5 before step 4: a search that never happened cannot support a claim of absence.
  if (options.searchable === false) {
    return {
      state: "unknown",
      reason:
        `EnvoyCoder could not tell whether ${recipe.label} is installed: it has no search path to ` +
        `look on (no PATH from this process, no answer from a login shell, and no tool directory it ` +
        `could find). Nothing on this row is a statement about the agent.`,
    };
  }

  const fix = fixFor("agent") ?? notInstalledFix(recipe);
  return {
    state: "not-installed",
    ...(fix ? { fix } : {}),
    reason:
      `${recipe.label} is not installed (looked for ${recipe.binaries.join(", ")} on PATH` +
      (recipe.agentBinaries && recipe.agentBinaries.length > 0
        ? `, and for ${recipe.agentBinaries.join(", ")}`
        : "") +
      (peerEntry ? `, and at ${peerEntry}` : "") +
      ")" +
      (recipe.install ? `. ${recipe.install.hint}` : "") +
      (recipe.install?.bridge ? ` Then: ${recipe.install.bridge.hint}` : ""),
  };
}

/**
 * What "install it" means for a program **the user declared**, which has no install hint by definition.
 *
 * ## The choice this records, because it is a real one
 *
 * `HarnessAvailabilitySchema`'s fourth rule is deliberate and stays: `not-installed` is a statement about
 * something missing, so it **must** carry the command that fixes it — "a row that says what is absent and
 * not what to do is the sentence this field replaced". For the nine agents we ship, the fix is a command
 * we wrote (`npm i -g …`, `npm run peers:check`). For a provider nobody can write one: we have never
 * heard of the program, and inventing a package name would be worse advice than none.
 *
 * So the fix names **the user's own command line**. It is the one command in the world that describes
 * what is missing, it is shown verbatim (which is the rule for `AvailabilityFix.command` in every
 * language), and the sentence beside it says whose command it is: the row reads "this is the command you
 * gave, and nothing on this machine answers to it". Setting no fix at all was the other option and is
 * not available: a state that asserts an absence with nothing to do about it fails the schema, which is
 * the rule working as intended rather than an obstacle to route around.
 */
function notInstalledFix(recipe: ProbeRecipe): readonly AvailabilityFix[] | undefined {
  if (recipe.commandLine !== undefined && recipe.commandLine !== "") {
    return [{ command: recipe.commandLine }];
  }
  const [binary, ...rest] = recipe.binaries;
  if (!binary) return undefined;
  return [{ command: [binary, ...rest].join(" ") }];
}

function defaultFileExists(path: string): boolean {
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  return existsSync(path);
}
