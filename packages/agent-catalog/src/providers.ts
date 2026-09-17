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
 *
 * ## What it *does* get, and only by reference
 *
 * A provider added from a catalogue entry carries `catalogEntryId`, and that reference is what resolves the
 * entry's own environment constants — see `providerCatalogueEnv` and `resolveProviderEnv`. The **value is
 * never in the config**: this module reads the constant out of the catalogue (git-tracked, reviewed data)
 * at the moment of use, so `providers.json` holds no value at all. That is the narrow, defensible slice of
 * the reference product's behaviour — its recipes work because they carry values, and ours work because
 * they carry a *pointer* to values we published.
 */

import type { AgentProviderConfig, AgentProviderEnvState } from "@envoydev/protocol";

import { acpAgent, cataloguedEnvNames, type AcpAgentEntry } from "./acp-catalog.js";
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
 * Every environment variable the provider names, with whether **this daemon** has a value for it and where
 * that value comes from.
 *
 * ## Why the answer is a list of facts rather than one boolean
 *
 * A provider that needs two variables and has one is in a state no boolean describes, and the window has
 * to say *which* one is missing to be actionable. It is computed here, beside the config, because this is
 * the same question `launchForProvider` answers at spawn time — and the two must agree: a summary that
 * said `set: true` while the launch refused the variable would be the worst possible pair of answers. Both
 * call `resolveProviderEnv`, so they agree by construction rather than by review.
 *
 * ## `from`, and the one thing this function may not do
 *
 * A value reaches a child from exactly two places: the daemon's own environment, or the catalogue entry the
 * provider was added from. The second is new (§7.10) and it is why this return type grew a field — a row
 * that said only "set" about `VT_ACP_ENABLED` would leave a user exporting a variable we are already
 * supplying, which is the same class of wrong sentence as telling somebody to install a program they have.
 *
 * **No value ever appears in the return type.** `name` is a name, `set` is a boolean, `from` is one of two
 * words; there is nothing here that could hold a credential, which is the same enforcement
 * `AgentProviderConfig.env` states one layer down — and the type is what makes it true rather than a rule.
 */
export function providerEnvState(
  provider: AgentProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
): AgentProviderEnvState[] {
  const resolved = resolveProviderEnv(provider, env);
  return provider.env.map((name) => {
    const from = resolved.from[name];
    if (from === "catalogue") return { name, set: true, from: "catalogue" as const };
    return { name, set: isSet(env[name]) };
  });
}

/**
 * The catalogue constants a provider's reference resolves to — **verified, or nothing**.
 *
 * ## Why the reference is checked here rather than trusted
 *
 * `AgentProviderConfig.catalogEntryId` is written by `coder.addProvider`, and `providers.json` is a file a
 * user can edit. Believing `catalogEntryId` on its own would mean a hand-edited line could point a
 * provider at any entry and receive that entry's environment — which is not a security hole (these are
 * published constants, not secrets) but *is* a lie: the row would claim a recipe it is not. So the
 * reference is believed only when the provider **is** that entry's recipe — same command, same argv, same
 * transport, same environment names — and anything else resolves to nothing, which puts the provider back
 * in the ordinary names-only case where a missing variable refuses by name.
 *
 * The check is deliberately *not* a throw. This runs inside the summary and inside the launch, and neither
 * is the place to raise a refusal about a file: the daemon refuses a mismatched `catalogEntryId` at
 * `coder.addProvider` with a translated sentence, which is where a user can do something about it. Here
 * the only honest answer is the conservative one.
 *
 * An **unknown** entry id resolves to nothing for the same reason: the catalogue is versioned with the
 * product, so an id it no longer has is an id whose constants we must not invent.
 */
export function providerCatalogueEnv(
  provider: AgentProviderConfig,
): Readonly<Record<string, string>> {
  const entryId = provider.catalogEntryId;
  if (entryId === undefined) return {};
  const entry = acpAgent(entryId);
  if (!entry) return {};
  if (!agreesWithEntry(provider, entry)) return {};
  return entry.env ?? {};
}

/**
 * Is this recipe **the** recipe that entry states?
 *
 * Four comparisons, and each would be a different lie if it were skipped: a different `command` is a
 * different program, a different `args` is a different invocation, a different `transport` is a different
 * dialect, and a **missing** environment name is a variable the recipe needs and would no longer receive.
 *
 * ## Why the environment rule is a superset and not an equality
 *
 * The entry's names must all be **present**; the provider may name others of its own. Equality was the
 * first shape here and it is wrong in the direction that costs a user something: somebody who adds one
 * variable of their own to a catalogued agent (`MY_COMPANY_PROXY`, say) would silently lose the recipe's
 * constants and be refused by name about a variable we had just been supplying — a change nobody asked for,
 * with no row saying why. A superset keeps the reference honest in the direction that matters (*this
 * invocation is the entry's, and every variable the entry declares is still named*) while leaving the
 * user's own additions theirs.
 *
 * Order is not compared — a name is a name and `env` is a set — so this is a containment test, not an
 * equality of arrays, which would also refuse a hand-edited file that merely reordered a list.
 *
 * **One implementation, two callers**, and that is the point of exporting it: this decides whether a launch
 * may use a recipe's constants, and `coder.addProvider` (`apps/desktop/src/daemon/providers.ts`) decides
 * whether a client may store the reference at all. Two copies of "does this agree" would be two answers to
 * one question, and the pair that must never disagree is exactly this one — a handler that accepted a
 * reference the launch then ignored would store a provider whose row claims a recipe it does not run.
 */
export function agreesWithEntry(
  recipe: { command: string; args: readonly string[]; transport: "acp" | "cli"; env: readonly string[] },
  entry: AcpAgentEntry,
): boolean {
  const [command, ...args] = entry.command;
  if (recipe.command !== command) return false;
  if (recipe.transport !== entry.transport) return false;
  if (recipe.args.length !== args.length || recipe.args.some((arg, index) => arg !== args[index])) {
    return false;
  }
  const named = new Set(recipe.env);
  return cataloguedEnvNames(entry).every((name) => named.has(name));
}

/**
 * **What a provider's environment will be, and where each value came from** — the one body both the
 * summary and the launch read.
 *
 * ## The precedence rule, stated once
 *
 *   1. **The daemon's own environment wins.** A user who exported `AUGMENT_DISABLE_AUTO_UPDATE=0` to stop
 *      an agent updating itself meant it, and a recipe's default that overwrote their export would make
 *      the one thing they can control the one thing they cannot.
 *   2. **Then the catalogue entry's constant**, and only for a name the entry actually declares: the
 *      provider's `env` list and the entry's keys are intersected rather than unioned, so a reference can
 *      never smuggle in a variable the provider does not name.
 *   3. **Then nothing**, which is a missing name — refused by the launch, reported unset by the summary.
 *
 * `missing` is the third case, and it is the one the refusal sentence is built from, which is why it is a
 * list of *names* here rather than a boolean somewhere else.
 */
export function resolveProviderEnv(
  provider: AgentProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
): {
  /** The values to hand the child, in the order the provider named them. */
  values: Record<string, string>;
  /** The names this daemon cannot supply from either source. */
  missing: string[];
  /** Where each supplied name's value came from, for the summary and for a log. */
  from: Record<string, "daemon" | "catalogue">;
} {
  const catalogue = providerCatalogueEnv(provider);
  const values: Record<string, string> = {};
  const from: Record<string, "daemon" | "catalogue"> = {};
  const missing: string[] = [];
  for (const name of provider.env) {
    const own = env[name];
    if (isSet(own)) {
      values[name] = own;
      from[name] = "daemon";
      continue;
    }
    const declared = catalogue[name];
    if (isSet(declared)) {
      values[name] = declared;
      from[name] = "catalogue";
      continue;
    }
    missing.push(name);
  }
  return { values, missing, from };
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
