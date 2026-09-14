/**
 * How an agent is started — **one answer, for every path that starts one.**
 *
 * ## Why this is its own module
 *
 * It used to be a private method on `RunManager`, which was correct while a run was the only thing that
 * spawned an agent. A **probe** (see `session-probe.ts`) starts the same agent the same way for a
 * different reason, and the moment there are two callers there are two spawn paths — the second one
 * written from memory, drifing on the first catalogue change. So the resolution lives here, both
 * callers call it, and "the agent's command, argv and environment" has exactly one definition in this
 * daemon.
 *
 * ## What it decides, and what it refuses
 *
 *   * **Where the agent is.** Probed first, then built: where the agent *is* and what argv it
 *     understands are different questions, and the answers differ for a harness living in a peer
 *     checkout — there the command is Node and the script is the first argument. Assuming a bare binary
 *     name is how a machine with the harness cloned but not installed gets `spawn envoy-harness ENOENT`.
 *   * **Whether it can be driven at all.** Six catalogue entries describe programs that do not speak
 *     ACP (a one-shot `-p` CLI, an app-server, an HTTP server, a JSONL-RPC mode), so without this check
 *     we would spawn them and wait for a handshake that can never come — after the picker had already
 *     offered them as ready.
 *   * **A home of its own**, per agent, so EnvoyCoder never writes into the state a user's own `dsh`
 *     install owns.
 *   * **The same `PATH` the probe searched.** This is the newest decision here and it is a consequence of
 *     the resize: the daemon's inherited `PATH` is not the user's (`./search-path.ts`), so the probe asks a
 *     question about a resolved list. If the spawn then handed the agent the *inherited* one, a bridge that
 *     probed as present could start and immediately fail to find the CLI it wraps (`claude-agent-acp`
 *     spawns `claude`) — a program that shows as installed and cannot run, which is worse than one reported
 *     missing. So the list is read once, at the top, and used for both halves.
 *
 * Both refusals are `coderError`s carrying a catalogue key, because a translated window has to be able
 * to render them. The *sentence* also carries the install link, which is what makes it actionable.
 */

import { join } from "node:path";

import {
  ENVOYCODER_ERRORS,
  type HarnessId,
  coderError,
} from "@envoycoder/protocol";
import {
  harnessAcpFacts,
  harnessDefinition,
  isDrivableByAcpAdapter,
  probeHarness,
  resolveHarnessCommand,
} from "@envoycoder/agent-catalog";
import { capabilitiesFor, currentSearchPath, detectPlatform, type PlatformId } from "@envoycoder/platform";
import type { CoderPaths } from "@envoycoder/host-bridge";

import type { AcpLaunch } from "./acp/client.js";
import { ref } from "./messages.js";

export interface LaunchInput {
  harness: HarnessId;
  /** The directory the agent treats as its workspace root. */
  cwd: string;
  paths: CoderPaths;
  /**
   * Which platform's argv and spawn rules to use. Injected so the Windows branch is testable, the same
   * arrangement `RunManagerDeps.platform` has.
   */
  platform?: PlatformId;
  /** The model, when the agent takes one **in argv** (the catalogue's `buildArgs` builds the flags). */
  model?: string;
  /** The user's own extra argv for this task. */
  extraArgs?: string;
  /**
   * The directories to search and to hand the agent. Defaults to the daemon's resolved list.
   *
   * Injected for the one test that has to prove probing and spawning agree without depending on what this
   * machine happens to have installed — and because a **fixture** agent has to be findable in a temp
   * directory. Not a knob for production: the whole point of the resolver is that there is one list.
   *
   * An **empty** list is not the same as an omitted one: it says "there was nothing to search", which the
   * probe reports as `unknown` rather than as an absence.
   */
  searchDirs?: readonly string[];
}

/**
 * The argv for one agent, plus the environment it needs to keep its own state.
 *
 * Throws a keyed `coderError` when the agent cannot be started: not installed (`harnessMissing`) or not
 * ACP-drivable (`harnessUnsupported`). A caller that is *asking* rather than *running* — the probe —
 * turns those into "we could not ask", which is the honest rendering of a spawn that never happened.
 *
 * **One `PATH` for both halves.** The list is read once, here, and used for the probe *and* for the child's
 * environment. Reading it twice would be a race the user pays for: a bridge that probed as present and then
 * started with a different `PATH` cannot find the CLI it wraps, and the failure reads as "the agent is
 * broken".
 */
export function launchForHarness(input: LaunchInput): AcpLaunch {
  const { harness, cwd, model, extraArgs } = input;
  const platform = input.platform ?? detectPlatform();
  const search = input.searchDirs !== undefined
    ? { dirs: input.searchDirs, searchable: input.searchDirs.length > 0 }
    : currentSearchPath({ platform });
  // `searchable` travels with the list, and it is not decoration: it is the difference between "we searched
  // and there is nothing there" and "we had nothing to search with", which are `not-installed` and `unknown` —
  // and therefore `harnessMissing` and `harnessUnknown` in the refusal below.
  const probe = probeHarness(harness, { platform, pathDirs: search.dirs, searchable: search.searchable });
  const label = harnessDefinition(harness).label;

  /**
   * **Drivability first, and the order is load-bearing rather than stylistic.**
   *
   * For an entry whose `transport` is not ACP, "install it" is wrong advice — installing a program we have no
   * adapter for lands the user on the same refusal with more software on their disk. Checking the protocol
   * before the installation makes that refusal the one they get whether or not they have installed it, which is
   * what `ENVOYCODER_ERRORS.harnessUnsupported`'s own doc says it is for. (Before the availability field this
   * happened by accident: the old boolean was `true` for an installed non-ACP agent, so this branch was
   * reached. Widening the state to `unsupported` would have moved those agents into "missing" — telling a user
   * with `copilot` installed that it is not installed, which is the bug report this whole change answers.)
   */
  if (!isDrivableByAcpAdapter(harness)) {
    throw coderError(
      ENVOYCODER_ERRORS.harnessUnsupported,
      `${label} speaks a protocol EnvoyCoder cannot drive yet (this adapter drives ACP agents only). ` +
        `Envoy Harness and DeepSeek Harness work today; ${label} needs its own adapter.`,
      ref("error.harnessUnsupported", { harness: label }),
    );
  }

  // Then the two availability refusals, and they are **two** for the reason the states are separate: one
  // asserts the agent is absent, the other asserts only that nobody could look. A single `harnessMissing` for
  // both would put "not installed. Install it and try again" in front of a German user whose daemon simply had
  // no search path — a claim about their machine dressed as a diagnosis of ours.
  if (probe.state !== "ready") {
    // The sentence carries the install link, which is what makes it actionable; the key carries only
    // the fact, so a translated refusal names the agent without inventing a URL in German. The link is
    // not lost — it is in the English sentence, in the log, and in the settings row that shows this
    // agent's install steps.
    const unknown = probe.state === "unknown";
    throw coderError(
      unknown ? ENVOYCODER_ERRORS.harnessUnknown : ENVOYCODER_ERRORS.harnessMissing,
      probe.reason ?? `${harness} is not available on this machine.`,
      unknown
        ? ref("error.harnessUnknown", { harness: label })
        : ref("error.harnessMissing", { harness: label }),
    );
  }
  const resolved = resolveHarnessCommand(harness, probe, {
    prompt: "",
    cwd,
    ...(model ? { model } : {}),
    ...(extraArgs ? { extraArgs } : {}),
  });
  const definition = harnessDefinition(harness);
  return {
    command: resolved.command,
    args: resolved.args,
    cwd,
    // Both of these are **protocol** facts about the agent rather than ways to start it, and they travel
    // on this one channel because this is the only one the daemon and the catalogue share: the client
    // sends `authenticate` with `authMethodId` right after `initialize`, and puts a mode into
    // `session/set_mode` under whichever field name the agent reads. Neither is defaulted — an agent
    // that needs neither gets neither, and `AcpClient.setMode` refuses rather than guess when a mode is
    // requested for an entry that never recorded a name.
    ...harnessAcpFacts(harness),
    env: {
      // The same list the probe above searched, in the same order. Not merged from `process.env`: a child
      // that inherits a `PATH` we did not choose is exactly the case this field removes, and `AcpClient`
      // merges this object *over* the daemon's own environment, so everything else still travels.
      PATH: search.dirs.join(capabilitiesFor(platform).pathDelimiter),
      ...(definition.id === "deepseek-harness"
        ? {
            // A home of our own per agent, so EnvoyCoder never writes into the state a user's own `dsh`
            // install owns — and so sessions the control plane starts are separable from the ones they
            // started by hand.
            DSH_HOME: join(input.paths.stateDir, "agents", "dsh"),
          }
        : {}),
    },
  };
}
