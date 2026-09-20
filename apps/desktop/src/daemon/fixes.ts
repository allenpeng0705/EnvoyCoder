/**
 * **Running the command a row is showing** — the one place in this product that executes something on the
 * user's behalf.
 *
 * ## What the owner asked, and what the shape answers
 *
 * *"…or can we support run the commands in EnvoyDev?"* The row already shows the exact command and a Copy
 * control (§7.18); this is the press that runs it, which is the difference between *"here is what to type in a
 * terminal"* and *"resolved"*.
 *
 * ## The property, because everything else follows from it
 *
 * **The window sends an id. It cannot send a command.** `coder.runFix` resolves the target through the *same
 * probes that drew the row* — `harnessProbe`, `probeProvider`, `probeCatalogEntry` — takes the commands out of
 * that projection's `availability.fix`, and runs those. Two consequences, both of them the point:
 *
 *   * the command a user read is the command that runs, with no second derivation to drift;
 *   * a compromised or merely buggy window cannot ask this daemon to execute arbitrary shell, because there is
 *     no field in the request that could carry one.
 *
 * This is also why the fix is looked up **at the moment of the press** rather than passed in from the window:
 * the daemon re-measures on the read (`catalog.ts` carries why nothing here is cached), so a press that arrives
 * after the user installed the program themselves finds no fix and answers `nothing-to-do` — which is the
 * honest answer, and better than running an install for something that is already there.
 *
 * ## What it will not do
 *
 *   * **Not a second opinion about state.** It runs the commands the projection carries and nothing else. An
 *     `unsupported` or `unknown` row has no `fix` by the schema's own agreement rules, so it has nothing to run
 *     — our gap is not a command a user can be handed.
 *   * **Not interactive.** `stdin` is `/dev/null`: a package manager that wants to ask a question gets EOF and
 *     fails, which is a bounded, visible failure rather than a process holding a window open forever.
 *   * **Not unbounded.** One deadline for the whole sequence, and the process **group** is killed on expiry
 *     (`spawnTreeOptions` + `processGroupTarget`): `npm install` spawns children, and a timeout that killed only
 *     the leader would leave the work running.
 *   * **Not a transcript.** The output is capped and it is a **tail** — the last of it, where the error is.
 */

import { spawn as nodeSpawn } from "node:child_process";

import { runBounded, tailText } from "./bounded-process.js";

import {
  buildShellCommand,
  capabilitiesFor,
  currentSearchPath,
  detectPlatform,
  type PlatformId,
} from "@envoydev/platform";
import {
  ACP_AGENT_CATALOG,
  cataloguedRecipe,
  harnessAvailability,
  probeRecipe,
} from "@envoydev/agent-catalog";
import type { AcpAgentEntry, ProbeFinding } from "@envoydev/agent-catalog";
import { parseRpcParams } from "@envoydev/protocol";
import type {
  AgentProviderConfig,
  HarnessId,
  FixTarget,
  RpcMethod,
} from "@envoydev/protocol";

import type { HarnessProbe } from "@envoydev/agent-catalog";
import type { ProviderProbe } from "@envoydev/agent-catalog";

import type { CoderHandler } from "./service.js";

/** How long the whole sequence may take before it is killed. A package install on a slow link, and no more. */
export const FIX_TIMEOUT_MS = 5 * 60_000;

/** How long a killed group gets to exit politely before SIGKILL. */
export const FIX_KILL_GRACE_MS = 5_000;

/** The most output kept, from the **end** — where a failure says what went wrong. */
export const FIX_OUTPUT_LIMIT = 64 * 1024;

/** What one run produced. Every field is something a window can render without asking again. */
export interface FixRunResult {
  outcome: "succeeded" | "failed" | "nothing-to-do" | "refused";
  commands: readonly string[];
  exitCode: number | null;
  output: string;
  reason?: "timeout" | "unknown-target";
}

/** The seam a test uses to run the sequence without a shell. */
export interface FixRunInput {
  commands: readonly string[];
  /** The directory to run in — the user's home, never a project. */
  cwd: string;
  /** The `PATH` the probe searched, so the command runs in the world that was measured. */
  pathDirs: readonly string[];
  timeoutMs: number;
  platform: PlatformId;
  spawn: typeof nodeSpawn;
}

/**
 * Run the commands, in order, stopping at the first failure.
 *
 * Exported and injectable because it is the half of this feature that must be *tested* without installing
 * anything: `fixes.test.ts` drives it with `/bin/sh` scripts, and the daemon's own wiring is exercised through
 * a real socket in `daemon-rpc.test.ts`.
 */
export async function runFixCommands(input: FixRunInput): Promise<FixRunResult> {
  const commands = input.commands;
  if (commands.length === 0) {
    return { outcome: "nothing-to-do", commands: [], exitCode: null, output: "" };
  }
  const caps = capabilitiesFor(input.platform);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // **The same list the probe searched.** A program the row found on the login shell's `PATH` must be
    // findable by the command that installs it, and a child started with the daemon's inherited `PATH` would
    // be a second, disagreeing world. `agent-catalog`'s launch does exactly this for agents.
    PATH: input.pathDirs.join(caps.pathDelimiter),
  };

  let output = "";
  for (const command of commands) {
    const shell = buildShellCommand(command, { platform: input.platform });
    // One deadline per command, the whole process group killed on expiry, `stdin` at `/dev/null` — the
    // properties are `bounded-process.ts`'s now, because `git` needs the same three for its own reasons.
    const collected = await runBounded(shell.command, shell.args, {
      cwd: input.cwd,
      env,
      timeoutMs: input.timeoutMs,
      outputLimit: FIX_OUTPUT_LIMIT,
      killGraceMs: FIX_KILL_GRACE_MS,
      platform: input.platform,
      spawn: input.spawn,
    });
    output = tailText(output + collected.text, FIX_OUTPUT_LIMIT);
    if (collected.timedOut) {
      return {
        outcome: "failed",
        commands,
        exitCode: null,
        output,
        reason: "timeout",
      };
    }
    if (collected.code !== 0) {
      return { outcome: "failed", commands, exitCode: collected.code, output };
    }
  }
  return { outcome: "succeeded", commands, exitCode: 0, output };
}

export interface FixHandlerDeps {
  /** The harness probe — the same one `coder.listHarnesses` answers with. */
  probe: (harness: HarnessId) => HarnessProbe;
  /** The provider probe, and the list to look a provider target up in. */
  providers: () => readonly AgentProviderConfig[];
  probeProvider?: (provider: AgentProviderConfig) => ProviderProbe;
  probeCatalogEntry?: (entry: AcpAgentEntry) => ProbeFinding;
  /** Where a fix runs: the user's home, never a project. */
  cwd: () => string;
  /** The `PATH` the probes searched. */
  pathDirs: () => readonly string[];
  /** Injectable for tests; the daemon passes the real `spawn`. */
  spawn?: typeof nodeSpawn;
  /** Injected so a test can decide the deadline without waiting for one. */
  timeoutMs?: number;
  /** Called after a successful run: a row that just changed should not need a press to say so. */
  recheck?: () => Promise<void>;
  platform?: PlatformId;
}

/** One handler, ready to spread into the daemon's table. */
export function createFixHandlers(deps: FixHandlerDeps): Partial<Record<RpcMethod, CoderHandler>> {
  /**
   * The commands a target's own row would show — or none, with the reason.
   *
   * The three tiers are resolved through the same functions the *list* methods use, which is the whole
   * guarantee (see the module doc). A target that is missing, or one whose projection carries no `fix`, comes
   * back empty rather than as an error: a press that finds nothing to do is an answer, not a failure.
   */
  const commandsFor = (
    target: FixTarget,
  ): { commands: readonly string[] } | { reason: "unknown-target"; refused: true } => {
    if (target.kind === "harness") {
      return { commands: harnessAvailability(deps.probe(target.id)).fix?.map((step) => step.command) ?? [] };
    }
    if (target.kind === "catalog") {
      const entry = ACP_AGENT_CATALOG.find((candidate) => candidate.id === target.id);
      if (entry === undefined) return { reason: "unknown-target" as const, refused: true };
      const search = currentSearchPath();
      const finding =
        deps.probeCatalogEntry?.(entry) ??
        probeRecipe(cataloguedRecipe(entry), { pathDirs: search.dirs, searchable: search.searchable });
      return { commands: harnessAvailability(finding).fix?.map((step) => step.command) ?? [] };
    }
    const provider = deps.providers().find((candidate) => candidate.id === target.id);
    if (provider === undefined) return { reason: "unknown-target" as const, refused: true };
    if (deps.probeProvider === undefined) return { commands: [] };
    return { commands: harnessAvailability(deps.probeProvider(provider)).fix?.map((step) => step.command) ?? [] };
  };

  return {
    "coder.runFix": async (params) => {
      const { target } = parseRpcParams("coder.runFix", params) as { target: FixTarget };
      const resolved = commandsFor(target);
      if ("refused" in resolved) {
        return { outcome: "refused" as const, commands: [], exitCode: null, output: "", reason: resolved.reason };
      }
      if (resolved.commands.length === 0) {
        return { outcome: "nothing-to-do" as const, commands: [], exitCode: null, output: "" };
      }

      const result = await runFixCommands({
        commands: resolved.commands,
        cwd: deps.cwd(),
        pathDirs: deps.pathDirs(),
        timeoutMs: deps.timeoutMs ?? FIX_TIMEOUT_MS,
        platform: deps.platform ?? detectPlatform(),
        spawn: deps.spawn ?? nodeSpawn,
      });

      // **The list updates by itself.** A successful install changes what every row says, and a user who has to
      // press *Check again* after pressing *Install* has been made to do the product's bookkeeping. The re-ask
      // is the same one `coder.recheckAgents` performs, including the login shell's per-name answers — a program
      // that installs where only the shell can find it is exactly this case.
      if (result.outcome === "succeeded") await deps.recheck?.().catch(() => undefined);
      return result;
    },
  };
}
