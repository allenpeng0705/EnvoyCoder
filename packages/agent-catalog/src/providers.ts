/**
 * An agent a **user declared** — the launch facts, and how it is probed.
 *
 * ## Why this file exists at all, and the one thing it must not do
 *
 * The catalogue (`HARNESS_CATALOG`) is nine entries we authored; a provider is a command the user typed.
 * The tempting shape is a small parallel catalogue — its own launch type, its own probe, its own
 * availability mapping — and that shape is precisely how this product would come to hold two opinions
 * about one machine. So this module converts a provider config **into the types that already exist** and
 * then stops:
 *
 *   * `providerLaunch` produces the catalogue's own `AgentLaunch` (`transport`, `authMethodId`,
 *     `modeParam`, `buildArgs`) rather than a provider-private launch vocabulary;
 *   * `providerRecipe` produces the prober's own `ProbeRecipe`, so `probeRecipe` in `./probe.js` answers
 *     for a provider with the same five states, the same order of checks and the same
 *     `HarnessAvailabilitySchema` agreement rules it answers for `cursor` or `envoy-harness`;
 *   * nothing here builds a command line, copies an environment variable or decides a refusal — those are
 *     `apps/desktop/src/daemon/launch.ts`'s single body, which both tiers call.
 *
 * ## What a provider does not get, and why
 *
 * No `agentBinaries` (nobody told us this program is a bridge over another one), no `devCheckout` (there
 * is no checkout), no `install` hints (we cannot author an install step for a program we have never heard
 * of — see `probe.ts`'s `notInstalledFix` for what the probe says instead), and no model support: a
 * provider's model is whatever the user put in `args`, because we have no evidence about its flags and
 * inventing `--model` is how an agent is started with an argument it rejects.
 */

import type { AgentProviderConfig, AgentProviderEnvState } from "@envoycoder/protocol";

import { splitArgs } from "./args.js";
import { probeRecipe, type ProbeFinding, type ProbeHarnessOptions, type ProbeRecipe } from "./probe.js";
// Type-only, and therefore erased: this module is re-exported *by* `index.ts` (`export *`), so a value
// import here would be a runtime cycle for nothing. `AgentLaunch` is the catalogue's launch vocabulary and
// reusing it is the whole point — see the module doc.
import type { AgentLaunch, RunInput } from "./index.js";

/**
 * A user's provider, as an `AgentLaunch` — the same shape the nine catalogue entries use.
 *
 * Three of the five fields are the provider's own declaration passed through **verbatim**, and the two
 * derived ones are worth stating:
 *
 *   * `binaries` is the command alone. A provider names one program; a list of alternatives is what the
 *     catalogue uses for the two names a first-party CLI ships under (`envoy-harness` / `envoy`), and
 *     there is no second name for a program we have never seen.
 *   * `stream` follows the transport, and for a `"cli"` provider that is `"text"`: nothing in this product
 *     parses a one-shot CLI's output, so promising JSONL would be a claim about somebody else's program.
 *     (Such a provider is `unsupported` at the probe and refused at launch, for the reason
 *     `isDrivableByAcpAdapter` records — it is *startable*, and pretending otherwise is the bug that made
 *     the six catalogued CLIs look ready.)
 */
export function providerLaunch(provider: AgentProviderConfig): AgentLaunch {
  return {
    kind: "child-process",
    binaries: [provider.command],
    buildArgs: ({ extraArgs }: RunInput) => [...provider.args, ...splitArgs(extraArgs)],
    stream: provider.transport === "acp" ? "jsonl" : "text",
    transport: provider.transport,
    ...(provider.authMethodId !== undefined ? { authMethodId: provider.authMethodId } : {}),
    ...(provider.modeParam !== undefined ? { modeParam: provider.modeParam } : {}),
  };
}

/**
 * A provider, flattened into the recipe the one prober reads.
 *
 * The label travels as the reason's subject, so a missing program is reported as *"My Agent is not
 * installed (looked for …)"* rather than as an id the user has to decode.
 */
export function providerRecipe(provider: AgentProviderConfig): ProbeRecipe {
  const launch = providerLaunch(provider);
  return {
    label: provider.label,
    kind: "child-process",
    // Narrowed rather than asserted: `providerLaunch` only ever builds the child-process variant, and a
    // recipe that read `launch.binaries` off the union would need the same check anyway.
    binaries: launch.kind === "child-process" ? launch.binaries : [],
    transport: provider.transport,
    // What `notInstalledFix` shows when this program is not here: the user's own command line, verbatim.
    // The probe looked for the binary; the fix names the whole thing they typed, which is what they would
    // run to see the failure for themselves.
    commandLine: [provider.command, ...provider.args].join(" "),
  };
}

/** A probe about a provider: the same finding as any other, under the user's own id. */
export interface ProviderProbe extends ProbeFinding {
  id: string;
}

/**
 * Is the program this provider names available on this machine?
 *
 * **The same prober**, deliberately — `probeRecipe` — so a provider whose command happens to be
 * `cursor-agent` reports exactly what the `cursor` catalogue entry reports, and a change to the order of
 * the checks reaches both tiers or neither. What a user typed is a command to look for, never a claim
 * that it is there: nothing in this function reads the provider's existence as evidence of its
 * availability.
 */
export function probeProvider(
  provider: AgentProviderConfig,
  options: ProbeHarnessOptions = {},
): ProviderProbe {
  return { id: provider.id, ...probeRecipe(providerRecipe(provider), options) };
}

/**
 * Every environment variable the provider names, with whether **this daemon** has it.
 *
 * ## Why the answer is a list of facts rather than one boolean
 *
 * A provider that needs two variables and has one is in a state no boolean describes, and the window has
 * to say *which* one is missing to be actionable. It is computed here, beside the config, because this is
 * the same question `launchForProvider` answers at spawn time — and the two must agree: a summary that
 * said `set: true` while the launch refused the variable would be the worst possible pair of answers.
 *
 * The **value never appears**, here or anywhere else. `set` is a boolean and `name` is a name; there is
 * nothing in this return type that could hold a credential, which is the same enforcement
 * `AgentProviderConfig.env` states one layer down.
 */
export function providerEnvState(
  provider: AgentProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
): AgentProviderEnvState[] {
  return provider.env.map((name) => ({ name, set: isSet(env[name]) }));
}

/**
 * Is this variable set, for the purpose of "we can hand it to the agent"?
 *
 * An empty string is **not set**: `FOO=` in a shell exports an empty value, and passing it on is how an
 * agent ends up authenticating with nothing while every row reports a credential present.
 *
 * A **predicate** rather than a boolean, so the two callers narrow with it — the summary above, and
 * `launchForProvider`'s environment copy, which must not hand `undefined` to `spawn`. One function, one
 * answer: two implementations of "does this daemon have it" would be two answers to the question the
 * window and the launch both ask.
 */
export function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}
