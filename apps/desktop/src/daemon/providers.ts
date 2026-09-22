/**
 * The three methods whose subject is an agent **a user declared** — and the decision that shapes them.
 *
 * ## Why this is its own module
 *
 * `service.ts` is a table: one entry per method, each one parsing its parameters and calling something.
 * A provider is not a line in that table but a subject — a config shape, a stored list, a probe, three
 * refusals and one security decision — and the decision is why it reads better next to its own head doc
 * than as another two hundred lines under a heading. `service.ts` spreads these three methods in, so the
 * daemon's table is still the complete list of what it serves.
 *
 * ## A credential cannot be expressed, and that is the type rather than a rule
 *
 * `AgentProviderConfig.env` (`@envoydev/protocol`) is a list of environment variable **names**. This
 * project deliberately refused to copy the reference product's `providers` page, partly because that page
 * keeps API keys as plaintext `env` *values* in a config file, so the schema here has no field for a
 * value: no caller, no control and no migration can write one to disk. What travels to a window is
 * `AgentProviderEnvState` — a name and a boolean — and what travels to a child process at spawn is read
 * from the daemon's own environment by `launchForProvider` and written nowhere else.
 *
 * Three consequences, each of them a refusal rather than a shrug:
 *
 *   * an entry of `env` that is not a name is refused with a sentence in the user's language
 *     (`error.providerEnvNotAName`) and **the offending string is never quoted back** — what a user
 *     pastes into that field is very often the credential itself, and a refusal is a string that reaches
 *     a log, a transcript and a bug report;
 *   * a name this daemon does not have is reported **per agent** in the list (`set: false`) and refused
 *     at launch, rather than silenced into an agent that cannot authenticate;
 *   * nothing here logs or echoes a value, because nothing here has one.
 *
 * ## Probed, never believed
 *
 * `coder.listProviders` measures: every stored provider's command is looked for on the same resolved
 * search path the launch will use, through the same prober the nine shipped agents go through, and the
 * answer is projected by the same `harnessAvailability` under the same `HarnessAvailabilitySchema`. A row
 * the user typed is a *recipe*; whether it runs here is a fact, which is why this method exists instead
 * of a `providers` array in the settings document.
 */

import {
  type AgentProviderConfig,
  type AgentProviderSummary,
  type AgentProviderEnvState,
  type RpcMethod,
  AgentProviderConfigSchema,
  ENVOYDEV_ERRORS,
  PROVIDER_ENV_NAME_PATTERN,
  PROVIDER_ID_PATTERN,
  coderError,
  isHarnessId,
  parseRpcParams,
} from "@envoydev/protocol";
import type { ProviderProbe } from "@envoydev/agent-catalog";
import { acpAgent, agreesWithEntry } from "@envoydev/agent-catalog";
import { primeShellBinaries } from "@envoydev/platform";

import { summarizeProvider } from "./summaries.js";

import { ref } from "./messages.js";
import type { CoderHandler } from "./service.js";
import type { CoderStore } from "./store.js";

/** What these handlers need, which is the store, the prober and the environment values are read from. */
export interface ProviderHandlerDeps {
  store: CoderStore;
  /**
   * The provider probe, over the daemon's resolved search path.
   *
   * Injected rather than called directly, on the same terms `CoderServiceDeps.probe` is: a test that has
   * to know what a row says must not depend on what this machine happens to have installed. The caller
   * builds it from `probeProvider` and the search list it also hands the launch, which is what keeps the
   * answer and the spawn about the same list.
   */
  probe: (provider: AgentProviderConfig) => ProviderProbe;
  /**
   * The environment a provider's named variables are read from — the daemon's own.
   *
   * Injected for one test that cannot be written any other way: "a variable this daemon does not have is
   * reported per agent" needs a daemon that provably does not have one, and mutating the runner's own
   * `process.env` to arrange that would leak into every other file in the run.
   */
  env: NodeJS.ProcessEnv;
}

/**
 * The three handlers, ready to spread into the daemon's table.
 *
 * Every one of them parses its parameters **first**, exactly as the methods in `service.ts` do, so a bad
 * call is refused by the same code with the same shape wherever it lands.
 */
export function createProviderHandlers(
  deps: ProviderHandlerDeps,
): Partial<Record<RpcMethod, CoderHandler>> {
  return {
    /**
     * Every provider this user declared, **each one probed**.
     *
     * Nothing here reads the provider's own existence as evidence that it works: the command is looked for
     * on the same resolved search path the launch will use, through the same prober the nine shipped agents
     * go through, and the answer is projected by the same `harnessAvailability`. A row a user typed is a
     * recipe, and whether it can run here is a fact we measure — which is the whole reason this method
     * exists instead of a `providers` array in the settings document.
     *
     * `env` carries **names and whether this daemon has them**, never values. That is the half of the
     * credential story a window can render: a provider whose key is missing is not ready *here*, and the
     * user is told before they press run rather than after an agent fails with its own sentence.
     */
    "coder.listProviders": async (params) => {
      parseRpcParams("coder.listProviders", params);
      // **Nothing on this row comes from the settings document**, and that is the property the removed
      // preference violated: a user-declared provider is listed exactly as the same prober measured it, so
      // a picker built over these rows cannot be shortened by anything a user stored. Removing a provider
      // is the one action that takes it off this list, and it is an *undo of the user's own declaration*
      // (`coder.removeProvider`) rather than a filter over a list we curate.
      return {
        providers: deps.store
          .providers()
          .map((provider) =>
            summarizeProvider(provider, deps.probe, deps.env, deps.store.agentAuth(provider.id)),
          ),
      };
    },

    /**
     * Declare an agent of the user's own.
     *
     * The three refusals that are the *user's* to fix carry translated sentences: an id we already ship, an
     * id that is not the shape a provider id has, and an environment entry that is a value rather than a
     * name. Everything else is left to the params schema and to `AgentProviderConfigSchema` — see the spec's
     * own doc for which is which, and `error.providerEnvNotAName` for why the offending string is never
     * quoted back.
     */
    "coder.addProvider": async (params) => {
      const input = parseRpcParams("coder.addProvider", params) as {
        id?: string;
        label: string;
        command: string;
        args?: readonly string[];
        env?: readonly string[];
        transport: "acp" | "cli";
        catalogEntryId?: string;
        authMethodId?: string;
        modeParam?: "mode" | "modeId";
      };

      // Derived from the label when the caller did not choose one, so the one-field form a UI offers works
      // and a second window is not asked to invent an id. The derivation is the same normalisation the id's
      // own pattern states, applied here rather than hoped for: `My Agent` becomes `my-agent`.
      const id = input.id ?? providerIdFrom(input.label);
      if (!PROVIDER_ID_PATTERN.test(id)) {
        // What is quoted back is always something the user typed: the id they chose, or — the only other
        // way to get here, since the derivation itself can produce nothing but a valid slug — the name it
        // could not be made from.
        const shown = input.id ?? input.label;
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          `"${shown}" cannot be an id for a provider. A provider id is lowercase letters, digits and dashes, starting with a letter or a digit.`,
          ref("error.providerIdInvalid", { name: shown }),
        );
      }
      // **Before the schema**, deliberately: the schema refuses this too (so a hand-edited file cannot
      // smuggle one in), but this is the path a user reaches, and it has to arrive as a sentence in their
      // language rather than as a Zod message about a regular expression.
      if (isHarnessId(id)) {
        throw coderError(
          ENVOYDEV_ERRORS.providerIdTaken,
          `"${id}" is the id of an agent EnvoyDev already ships, so your provider was not added. Give your provider another name.`,
          ref("error.providerIdTaken", { id }),
        );
      }

      // The same name twice is **one** variable, so it is normalised rather than refused: a user typing the
      // same key twice into two rows is not making the mistake this method should stop them for. The stored
      // shape still refuses duplicates (`AgentProviderConfigSchema`), which is what makes the file say one
      // thing about one variable.
      const envNames = [...new Set(input.env ?? [])];
      const notAName = envNames.findIndex((name) => !PROVIDER_ENV_NAME_PATTERN.test(name));
      if (notAName >= 0) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          `EnvoyDev stores the names of the environment variables an agent needs, never their values, ` +
            `and entry ${notAName + 1} of this provider's environment list is not a variable name. A name ` +
            `is letters, digits and underscores, and does not start with a digit. The provider was not added.`,
          ref("error.providerEnvNotAName", { position: notAName + 1 }),
        );
      }

      /**
       * **The reference is checked against the recipe the caller sent, before it is stored.**
       *
       * This is what keeps `catalogEntryId` from being a way to *acquire* a recipe's environment. The
       * daemon resolves the entry itself and refuses unless `command`, `args`, `transport` and the
       * environment **names** are all that entry's own — so the only thing the field can ever mean is
       * *"this provider is that entry"*, which is exactly what the window means when it adds a row.
       *
       * A refusal rather than a silent downgrade, and in the user's language: a client that sent one
       * recipe's argv with another entry's id is a client bug, but the person reading the screen is the one
       * who needs to know the agent was not added. `error.providerCatalogMismatch` names the entry and asks
       * for the page to be reopened, which is the one action that fixes it.
       *
       * An id that names no entry takes the same path (it cannot agree with anything), and that is
       * deliberate rather than an omission: a sentence about a *missing catalogue entry* would be an answer
       * to a question nobody asked, and at this point the question is about the row the caller is adding.
       */
      const catalogEntryId = input.catalogEntryId;
      if (catalogEntryId !== undefined) {
        const entry = acpAgent(catalogEntryId);
        // The **same** comparison the launch uses (`agreesWithEntry`), so a reference the handler accepted
        // is a reference `providerCatalogueEnv` will honour — one answer to "is this that recipe?", which
        // is the pair that must never disagree.
        const agrees =
          entry !== undefined &&
          agreesWithEntry(
            {
              command: input.command,
              args: input.args ?? [],
              transport: input.transport,
              env: envNames,
            },
            entry,
          );
        if (!agrees) {
          throw coderError(
            ENVOYDEV_ERRORS.badRequest,
            `"${catalogEntryId}" is a catalogued agent whose recipe is not the one this request describes, ` +
              `so the agent was not added. Reopen the agents page and add the row again.`,
            ref("error.providerCatalogMismatch", { entry: catalogEntryId }),
          );
        }
      }

      const candidate = {
        id,
        label: input.label,
        command: input.command,
        args: [...(input.args ?? [])],
        env: envNames,
        transport: input.transport,
        ...(catalogEntryId !== undefined ? { catalogEntryId } : {}),
        ...(input.authMethodId !== undefined ? { authMethodId: input.authMethodId } : {}),
        ...(input.modeParam !== undefined ? { modeParam: input.modeParam } : {}),
      };
      // The remaining ways this can be unusable are contradictions a *client* would have to construct —
      // an ACP-only dialect field on a command-line provider, a duplicate environment name — so this is the
      // developer-addressed refusal `parseRpcParams` uses, with no key: a translated sentence would be a
      // German wrapper around English field names. The schema is the same one the file is read through, so
      // what is stored cannot contain one either.
      const parsed = AgentProviderConfigSchema.safeParse(candidate);
      if (!parsed.success) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          `coder.addProvider was given a provider this build cannot store: ${parsed.error.issues[0]?.message ?? "invalid"}`,
        );
      }
      const { provider } = await deps.store.addProvider(parsed.data);
      /**
       * **Ask the user's shell about this command too**, because a provider added a minute ago was not in the
       * list the boot prime asked about. Fire-and-forget and bounded like every other shell ask in this
       * daemon: the answer joins the search path when it lands, and a shell that is absent or slow leaves the
       * ordinary search to decide. A provider whose command is not a plain name (an absolute path, say) is
       * skipped by `@envoydev/platform` rather than quoted into a script — the rule for user-controlled
       * strings, and the reason this call needs no escaping here.
       */
      void primeShellBinaries([provider.command]);
      return { provider };
    },

    /**
     * Forget a provider.
     *
     * A refusal when there is nothing under that id — the same rule `coder.removeProject` follows, for the
     * same reason: a list that changed under the user in another window must be reported, not confirmed.
     */
    "coder.removeProvider": async (params) => {
      const { id } = parseRpcParams("coder.removeProvider", params) as { id: string };
      const result = await deps.store.removeProvider(id);
      if (!result) {
        throw coderError(
          ENVOYDEV_ERRORS.providerMissing,
          `There is no agent provider called "${id}" here. It may have been removed from another window.`,
          ref("error.providerNotFound", { id }),
        );
      }
      if ("inUse" in result) {
        throw coderError(
          ENVOYDEV_ERRORS.providerInUse,
          `"${id}" is still used by ${result.inUse}, so it was not removed. Move those onto another agent first.`,
          ref("error.providerInUse", { id, where: result.inUse }),
        );
      }
      return { removed: result.removed };
    },
  };
}

/**
 * The id a provider gets when the caller did not choose one.
 *
 * Lowercased, runs of anything that cannot be in an id collapsed to one dash, and dashes trimmed off both
 * ends — which is what turns `My Agent!` into `my-agent` and `  Trae  CLI ` into `trae-cli`. A name with no
 * letter or digit in it at all comes out empty, and the caller refuses that with a sentence rather than
 * storing a provider nobody could address.
 */
function providerIdFrom(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
