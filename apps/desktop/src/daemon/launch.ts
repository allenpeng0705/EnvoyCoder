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
 * ## And one body for two tiers
 *
 * A **user-declared provider** (`AgentProviderConfig`) is a third caller of the same question, and this
 * slice's whole risk is that it becomes the one that drifts: a provider argv assembled here while the
 * catalogue's is assembled there, one of them adding `PATH`, one of them copying an environment variable,
 * one of them refusing a missing program with a different code. So the resolution is a single function
 * over a **subject** — the launch facts plus two small callbacks — and the two exported entry points
 * (`launchForHarness`, `launchForProvider`) differ only in what they hand it. The first divergence would
 * be a fact about an agent that is false: "EnvoyCoder says my agent is not installed, but the same command
 * works when I declare it as a provider."
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
 *     offered them as ready. A provider says which dialect it speaks, and a `"cli"` one is refused for
 *     exactly the same reason rather than for a new one.
 *   * **A home of its own**, per agent, so EnvoyCoder never writes into the state a user's own `dsh`
 *     install owns.
 *   * **The same `PATH` the probe searched.** This is the newest decision here and it is a consequence of
 *     the resize: the daemon's inherited `PATH` is not the user's (`./search-path.ts`), so the probe asks a
 *     question about a resolved list. If the spawn then handed the agent the *inherited* one, a bridge that
 *     probed as present could start and immediately fail to find the CLI it wraps (`claude-agent-acp`
 *     spawns `claude`) — a program that shows as installed and cannot run, which is worse than one reported
 *     missing. So the list is read once, at the top, and used for both halves.
 *   * **Which of the user's own environment variables travel.** A provider names variables; their **values**
 *     are read from this daemon's environment at spawn and never from disk, never from the wire and never
 *     logged. A name that is unset is a refusal, not a silent omission — see `providerEnv`.
 *
 * Every refusal is a `coderError` carrying a catalogue key, because a translated window has to be able
 * to render them. The *sentence* also carries the install link, which is what makes it actionable.
 */

import { join } from "node:path";

import {
  ENVOYCODER_ERRORS,
  type AgentProviderConfig,
  type HarnessId,
  coderError,
} from "@envoycoder/protocol";
import {
  harnessAcpFacts,
  harnessDefinition,
  harnessRecipe,
  isSet,
  probeRecipe,
  providerRecipe,
  resolveHarnessCommand,
  splitArgs,
  type ProbeFinding,
  type ProbeRecipe,
} from "@envoycoder/agent-catalog";
import { capabilitiesFor, currentSearchPath, detectPlatform, type PlatformId } from "@envoycoder/platform";
import type { CoderPaths } from "@envoycoder/host-bridge";

import type { AcpLaunch } from "./acp/client.js";
import { ref } from "./messages.js";
import type { MessageKey } from "../i18n/messages/en.js";

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
 * The same, for an agent **the user declared**.
 *
 * No `model`: a provider takes one the only way we can honestly offer it — whatever the user put in its
 * `args` — because we have no evidence about which flags it accepts, and inventing `--model` starts an
 * agent with an argument it may reject. `extraArgs` is still appended, split and quoted the same way the
 * catalogue's entries do it (`splitArgs`), because that control belongs to the task rather than to the
 * agent.
 */
export interface ProviderLaunchInput {
  provider: AgentProviderConfig;
  cwd: string;
  paths: CoderPaths;
  platform?: PlatformId;
  extraArgs?: string;
  /** See `LaunchInput.searchDirs`. */
  searchDirs?: readonly string[];
  /**
   * Where a named environment variable's **value** comes from. Defaults to this process's environment.
   *
   * Injected only so a test can prove both halves of the contract without mutating the test runner's own
   * environment: that a set variable is copied, and that an unset one is reported.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * The argv for one agent, plus the environment it needs to keep its own state.
 *
 * Throws a keyed `coderError` when the agent cannot be started: not installed (`harnessMissing`), not
 * ACP-drivable (`harnessUnsupported`), or — for a provider — a named environment variable this daemon does
 * not have (`providerEnvUnset`). A caller that is *asking* rather than *running* — the probe — turns those
 * into "we could not ask", which is the honest rendering of a spawn that never happened.
 *
 * **One `PATH` for both halves.** The list is read once, here, and used for the probe *and* for the child's
 * environment. Reading it twice would be a race the user pays for: a bridge that probed as present and then
 * started with a different `PATH` cannot find the CLI it wraps, and the failure reads as "the agent is
 * broken".
 */
export function launchForHarness(input: LaunchInput): AcpLaunch {
  const { harness, cwd, model, extraArgs } = input;
  const definition = harnessDefinition(harness);
  return resolveLaunch(
    {
      label: definition.label,
      recipe: harnessRecipe(definition),
      /**
       * The argv, resolved from the probe. `via === "node-script"` is the peer checkout, where the command
       * is Node and the first argument is the script — a difference `resolveHarnessCommand` owns.
       */
      command: (probe) =>
        resolveHarnessCommand(harness, probe, {
          prompt: "",
          cwd,
          ...(model ? { model } : {}),
          ...(extraArgs ? { extraArgs } : {}),
        }),
      // Both of these are **protocol** facts about the agent rather than ways to start it, and they travel
      // on this one channel because this is the only one the daemon and the catalogue share.
      acp: harnessAcpFacts(harness),
      // A home of our own per agent, so EnvoyCoder never writes into the state a user's own `dsh` install
      // owns — and so sessions the control plane starts are separable from the ones they started by hand.
      env: definition.id === "deepseek-harness" ? { DSH_HOME: join(input.paths.stateDir, "agents", "dsh") } : {},
      // The catalogue's own wording for this gap, and it is **unchanged** on purpose: `drivable.test.ts`
      // and the settings docs quote it, and the sentence a user already reads must not move because the
      // body that produces it moved. A provider gets its own sentence (`error.providerUnsupported`)
      // because its advice is different: its dialect is a field the user can correct.
      unsupportedAdvice: `Envoy Harness and DeepSeek Harness work today; ${definition.label} needs its own adapter.`,
      unsupported: { key: "error.harnessUnsupported", values: { harness: definition.label } },
    },
    input,
  );
}

/**
 * The same resolution, for a provider the user declared.
 *
 * The one thing this adds to `launchForHarness` is the environment: a provider names variables, and this
 * is where their values are copied out of the daemon's own environment. Nothing else differs — the probe,
 * the search path, the `PATH` handed to the child, the refusals and the two dialect fields all come from
 * the shared body, which is what makes "the same states from the same probe" true of a provider rather
 * than merely intended.
 */
export function launchForProvider(input: ProviderLaunchInput): AcpLaunch {
  const { provider } = input;
  return resolveLaunch(
    {
      label: provider.label,
      recipe: providerRecipe(provider),
      // The user's own extra arguments for *this task* are appended through the same splitter the
      // catalogue's entries use (`splitArgs`, quoted paths and all) — one answer to "what did they mean by
      // this string" for both tiers.
      command: () => ({
        command: provider.command,
        args: [...provider.args, ...splitArgs(input.extraArgs)],
      }),
      acp: {
        ...(provider.authMethodId !== undefined ? { authMethodId: provider.authMethodId } : {}),
        ...(provider.modeParam !== undefined ? { modeParam: provider.modeParam } : {}),
      },
      env: {},
      /**
       * A refusal rather than a shrug, and the reason it is *here* rather than in the summary: the window
       * needs to be told before the user presses run (`AgentProviderSummary.env` says `set: false`), and
       * the run needs to be told too, because a variable can be unset between the two. An agent started
       * without its credential fails with *its own* sentence about a login nobody performed, which reads
       * as "this agent is broken" for a fact about our environment.
       */
      envNames: provider.env,
      unsupportedAdvice:
        `EnvoyCoder drives agents over ACP, and this provider is declared as a command-line program — ` +
        `if it does speak ACP, declare its dialect as ACP and try again.`,
      unsupported: { key: "error.providerUnsupported", values: { provider: provider.label } },
    },
    input,
  );
}

/**
 * What a launch needs to know about one agent, whatever tier it came from.
 *
 * Two callbacks rather than a branch, and the split is the point: everything that *differs* between a
 * catalogue entry and a provider is in these two fields, and everything that must **not** differ — the
 * search path, the probe and its order of checks, the `PATH` handed to the child, the three availability
 * refusals, the dialect fields — is in the body below, written once.
 */
interface LaunchSubject {
  label: string;
  recipe: ProbeRecipe;
  /** The command and argv, from the probe that just succeeded. */
  command: (probe: ProbeFinding) => { command: string; args: string[] };
  /** The two protocol facts: `authMethodId` and `modeParam`, absent when the agent declares neither. */
  acp: { authMethodId?: string; modeParam?: "mode" | "modeId" };
  /** Values put into the child's environment beyond `PATH`. */
  env: Record<string, string>;
  /** Names to copy from the daemon's environment. Unset ones refuse the launch. */
  envNames?: readonly string[];
  /** The second half of the "we cannot drive this" sentence — each tier explains its own gap. */
  unsupportedAdvice: string;
  /**
   * The key that second half belongs to, and the values its template needs.
   *
   * Two keys rather than one, because the same fact leads to different *advice*: a shipped agent needs an
   * adapter nobody has written, while a provider's dialect is a field the user can correct. A translated
   * sentence that tells a user to "choose one of those instead" when they declared the agent themselves
   * is a sentence they cannot act on.
   *
   * The values travel with the key rather than being derived from it here, because the placeholder is
   * named per tier (`{harness}` for an agent we ship, `{provider}` for one the user declared) and a body
   * that guessed which name to use from which key would be one careless edit away from rendering a
   * template with an empty value.
   */
  unsupported: { key: MessageKey; values: Record<string, string> };
}

/** What both entry points need, regardless of tier. */
interface LaunchLocation {
  cwd: string;
  paths: CoderPaths;
  platform?: PlatformId;
  searchDirs?: readonly string[];
  /**
   * Where a named environment variable's value is read from. Defaults to this process's environment.
   *
   * Only `launchForProvider` sets it, and only a test does so deliberately: production wants the daemon's
   * own environment, which is the one thing a user's shell export reaches.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * **The one body.** Everything above it is a way of describing an agent; everything below it is what this
 * daemon does about one.
 */
function resolveLaunch(subject: LaunchSubject, location: LaunchLocation): AcpLaunch {
  const platform = location.platform ?? detectPlatform();
  const search =
    location.searchDirs !== undefined
      ? { dirs: location.searchDirs, searchable: location.searchDirs.length > 0 }
      : currentSearchPath({ platform });
  // `searchable` travels with the list, and it is not decoration: it is the difference between "we searched
  // and there is nothing there" and "we had nothing to search with", which are `not-installed` and `unknown`
  // — and therefore `harnessMissing` and `harnessUnknown` in the refusal below.
  const probe = probeRecipe(subject.recipe, {
    platform,
    pathDirs: search.dirs,
    searchable: search.searchable,
  });

  /**
   * **Drivability first, and the order is load-bearing rather than stylistic.**
   *
   * For an entry whose `transport` is not ACP, "install it" is wrong advice — installing a program we have no
   * adapter for lands the user on the same refusal with more software on their disk. Checking the protocol
   * before the installation makes that refusal the one they get whether or not they have installed it, which
   * is what `ENVOYCODER_ERRORS.harnessUnsupported`'s own doc says it is for. (Before the availability field this
   * happened by accident: the old boolean was `true` for an installed non-ACP agent, so this branch was
   * reached. Widening the state to `unsupported` would have moved those agents into "missing" — telling a user
   * with `copilot` installed that it is not installed, which is the bug report this whole change answers.)
   */
  if (!(subject.recipe.kind === "child-process" && subject.recipe.transport === "acp")) {
    throw coderError(
      ENVOYCODER_ERRORS.harnessUnsupported,
      `${subject.label} speaks a protocol EnvoyCoder cannot drive yet (this adapter drives ACP agents only). ` +
        subject.unsupportedAdvice,
      ref(subject.unsupported.key, subject.unsupported.values),
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
      probe.reason ?? `${subject.label} is not available on this machine.`,
      unknown
        ? ref("error.harnessUnknown", { harness: subject.label })
        : ref("error.harnessMissing", { harness: subject.label }),
    );
  }

  const resolved = subject.command(probe);
  return {
    command: resolved.command,
    args: resolved.args,
    cwd: location.cwd,
    // Neither of these is defaulted — an agent that needs neither gets neither, and `AcpClient.setMode`
    // refuses rather than guess when a mode is requested for an entry that never recorded a name.
    ...subject.acp,
    env: {
      // The same list the probe above searched, in the same order. Not merged from `process.env`: a child
      // that inherits a `PATH` we did not choose is exactly the case this field removes, and `AcpClient`
      // merges this object *over* the daemon's own environment, so everything else still travels.
      PATH: search.dirs.join(capabilitiesFor(platform).pathDelimiter),
      ...subject.env,
      ...providerEnv(subject.label, subject.envNames ?? [], location.env ?? process.env),
    },
  };
}

/**
 * The values a provider's named variables resolve to — or a refusal naming the ones that have none.
 *
 * ## What this function may not do, and the test that holds it to it
 *
 * It reads values out of the daemon's own environment and puts them in a `Record` that goes to `spawn`.
 * It must never write one anywhere else: not into the returned launch's other fields, not into the refusal
 * below, not into a log line. The refusal names `provider.label` and the **names** of the missing
 * variables, so a user can act on it, and quotes no value at all — a value that reached an error message
 * would reach a log file, a transcript and a bug report. `test/providers.test.ts` asserts the negative
 * directly: it puts a recognisable secret in the environment, launches a provider that names it, and
 * checks that the string appears nowhere in the refusal that follows when it is removed again.
 *
 * An **empty** value counts as unset, and the rule is `isSet` from `@envoycoder/agent-catalog` rather
 * than a second copy of it here: the summary a window renders (`AgentProviderSummary.env`) and this
 * launch answer the same question, and two implementations of "does this daemon have it" would be two
 * answers. `FOO=` exports nothing, and passing it on is how an agent authenticates with an empty string
 * while every row says a credential is present.
 */
function providerEnv(
  label: string,
  names: readonly string[],
  from: NodeJS.ProcessEnv,
): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = from[name];
    if (!isSet(value)) {
      missing.push(name);
      continue;
    }
    out[name] = value;
  }
  if (missing.length === 0) return out;

  // The sentence is written twice — `.one` and `.many` — rather than pluralised by a library, the rule this
  // repository's catalogue states: a language that needs two forms gets two keys. The English here is
  // byte-identical to the catalogue's own, which is what `providers.test.ts` asserts for the
  // single-variable case — the plural one is reachable only from a launch, so no handler test can see it —
  // and what keeps an English user's text unchanged by the presence of a translation.
  const one = missing.length === 1;
  const sentence = one
    ? `${label} needs the environment variable ${missing[0]} to be set for EnvoyCoder's daemon, and it is ` +
      `not set, so the run was not started. EnvoyCoder stores the names of the variables an agent needs, ` +
      `never their values — set it where the daemon is started, then restart EnvoyCoder.`
    : `${label} needs these environment variables to be set for EnvoyCoder's daemon, and they are not set: ` +
      `${missing.join(", ")}. The run was not started. EnvoyCoder stores the names of the variables an ` +
      `agent needs, never their values — set them where the daemon is started, then restart EnvoyCoder.`;

  throw coderError(
    ENVOYCODER_ERRORS.providerEnvUnset,
    sentence,
    one
      ? ref("error.providerEnvUnset.one", { provider: label, name: missing[0] ?? "" })
      : ref("error.providerEnvUnset.many", { provider: label, names: missing.join(", ") }),
  );
}
