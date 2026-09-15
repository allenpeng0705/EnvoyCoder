/**
 * The catalogue over the wire: **what EnvoyCoder knows how to drive, and what this machine can actually
 * do with one of them — on the row, the moment the list is read.**
 *
 * ## Why the catalogue is served at all
 *
 * `coder.listHarnesses` answers for the nine agents we ship and `coder.listProviders` for the ones a user
 * typed. Between them they left the 38 catalogued ACP agents — Gemini CLI, Cline, Goose, Cursor's own
 * recipe — reachable from nowhere: the data was in `@envoycoder/agent-catalog` and no surface read it. A
 * user with one of those CLIs installed had a product that supported it and no way to find that out.
 *
 * It is served rather than imported into the window for two reasons:
 *
 *   * **One copy.** `@envoycoder/agent-catalog` is where the *launch* reads an entry's command and argv.
 *     A window that carried its own copy would be a second answer to "what does this run", free to drift
 *     from the one `launchForProvider` uses — the class of defect this repository keeps paying for.
 *   * **The phone.** The catalogue is not a desktop feature. A thin client that lists agents, or lets a
 *     user add one, reads this same method and gets the same entries, the same dialect facts and the same
 *     verdicts. The package they come from is browser-hostile on purpose (`@envoycoder/platform` imports
 *     `node:fs`), so the daemon is the only half that *can* hold it — which turns "do not put catalogue
 *     knowledge in desktop-only code" into a fact about the architecture rather than a rule to remember.
 *
 * ## What changed, and the report it came from
 *
 * A row used to carry **no** claim about this machine: the client rendered *"Not checked yet"* on all 38 and
 * offered a *Check* button on each, and `coder.probeCatalogAgent` measured one entry when it was pressed and
 * cached the answer. Every row was therefore a chore — press, wait, read, thirty-eight times — and the owner
 * said what that is worth: *"I don't want user to guess, to check if we can do that. And If the agent cannot be
 * used - 'Not Ready', we should clearly know what the problem is and guide user to resolve it if he want to use
 * this coding agent."*
 *
 * The design that produced the chore had one good reason behind it and one mistake in front of it. The good
 * reason: **starting** fourteen of these recipes would download fourteen npm packages because somebody opened
 * Settings, so nothing here may start anything. The mistake: an availability answer does not need to start
 * anything, and the two were not separated. So they are separated now —
 *
 *   * `coder.listCatalog` answers each row from four **filesystem and environment reads**: does the program
 *     resolve, does the agent's own program resolve when the recipe is a bridge over one, is the program
 *     fetched on first run (`npx`/`uvx`, where there is nothing to install), and are the variables the launch
 *     needs present. No process, no package, no network, and no cache: the list is recomputed per read, so a
 *     program installed while the window is open is real the next time the list is read.
 *   * Nothing in this file ever starts an agent. The one method that did measure by *running* something is
 *     `coder.probeSessionOptions`, and what it learns — what the agent publishes, whether it wants a sign-in —
 *     travels as a **property with the time it was observed**, not as a state a row waits on. See
 *     `apps/desktop/src/components/settings/agent-verdict.ts` for the two-verdict projection a client renders.
 *
 * The assertion that this stayed cheap is not a comment: `test/catalog-rpc.test.ts` counts child processes
 * across a full read of the list and requires zero.
 */

import {
  ACP_AGENT_CATALOG,
  type AcpAgentEntry,
  type ProbeFinding,
  cataloguedEnvValues,
  cataloguedInstall,
  cataloguedProviderInput,
  harnessAvailability,
} from "@envoycoder/agent-catalog";
import {
  type CatalogEntry,
  type HarnessAvailability,
  type RpcMethod,
  isHarnessId,
  parseRpcParams,
} from "@envoycoder/protocol";

import type { CoderHandler } from "./service.js";

/** What these handlers need: the one prober, over the daemon's resolved search path. */
export interface CatalogHandlerDeps {
  /**
   * Measure one entry, over the list the launch will search. **Reads only; never spawns.**
   *
   * Injected rather than called directly, on exactly the terms `CoderServiceDeps.probe` is: a test that has
   * to know what a row says must not depend on what this machine happens to have installed. The caller
   * builds it from `probeRecipe(cataloguedRecipe(entry))` and the same `search` object it hands the spawn,
   * which is what keeps the answer and the launch about the same directory list — the defect this repository
   * keeps paying for is a row that says "missing" while the launch works.
   */
  probe: (entry: AcpAgentEntry) => ProbeFinding;
}

/**
 * The one handler, ready to spread into the daemon's table.
 *
 * It parses its parameters first, exactly as every method in `service.ts` does, so a bad call is refused by
 * the same code with the same shape wherever it lands.
 */
export function createCatalogHandlers(
  deps: CatalogHandlerDeps,
): Partial<Record<RpcMethod, CoderHandler>> {
  return {
    /**
     * Every catalogued entry, **each with what this machine can do with it**.
     *
     * The rows carry the recipe (command, argv, the dialect the entry states, the environment variable names
     * it sets, and how the program is obtained), one computed flag — whether the id also names an agent we
     * ship, because `cursor` is both a built-in and a recipe, and the window must not be the place that
     * decides which wins — and the availability this daemon just resolved.
     *
     * Not cached, deliberately, and it is a decision rather than an omission: the measurement is a handful of
     * `stat` calls per row, and a cache here would be the mechanism by which "I installed it and it still says
     * missing" comes back — the support ticket the old ten-minute staleness window was papering over. A cache
     * would buy nothing anybody can feel, because the work is filesystem metadata, and it would cost the one
     * property the screen is for: that a row is about *now*.
     */
    "coder.listCatalog": async (params) => {
      parseRpcParams("coder.listCatalog", params);
      return { entries: catalogEntries(deps.probe) };
    },
  };
}

/**
 * The catalogue as rows — the projection, in one place, so `coder.listCatalog` and anything else that
 * wants the same rows cannot disagree.
 *
 * Exported because the test that pins the wire shape should build it from the same function the daemon
 * serves rather than from a hand-written fixture: a fixture is a second answer to "what does a row look
 * like", and the one that drifts is always the fixture.
 *
 * The prober is a parameter rather than a module import so that the daemon's own search path — and a test's
 * injected one — decide the answer. `harnessAvailability` does the projection, and
 * `HarnessAvailabilitySchema` re-checks its five agreement rules on every answer, so a catalogue change that
 * produced a self-contradicting row fails a test rather than reaching a window.
 */
export function catalogEntries(probe: (entry: AcpAgentEntry) => ProbeFinding): CatalogEntry[] {
  return ACP_AGENT_CATALOG.map((entry) => rowOf(entry, probe(entry)));
}

/** One entry, as the wire wants it. See `CatalogEntry` for every field and why it is there. */
function rowOf(entry: AcpAgentEntry, finding: ProbeFinding): CatalogEntry {
  const input = cataloguedProviderInput(entry);
  const availability: HarnessAvailability = harnessAvailability(finding);
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    version: entry.version,
    installLink: entry.installLink,
    // The four fields that are also `coder.addProvider`'s parameters, taken from the package's own
    // projection rather than read here: adding this row must send exactly what the entry states, and the
    // dialect in particular is passed through and never inferred.
    command: input.command,
    args: [...input.args],
    // The recipe's own constants, **name and value together**, because the row has to be able to say which
    // variables the recipe supplies and which are the user's to set (§7.10). What a *provider* carries is
    // still names plus the reference — see `cataloguedProviderInput`.
    env: cataloguedEnvValues(entry),
    transport: input.transport,
    install: cataloguedInstall(entry),
    // The overlap rule, computed by the half that holds both lists: `cursor` is a shipped agent *and* a
    // recipe, and a built-in wins (`resolveAgentEntry`). A row that is both is shown in the shipped list
    // and is not offered as something to add.
    builtIn: isHarnessId(entry.id),
    // The verdict's own input, resolved on the read. A bridged entry whose CLI is present and whose adapter
    // is not arrives as `needs-bridge` with `agentBinary` naming what *was* found, which is the fact the row
    // leads with; an `npx -y …` entry arrives as `ready` because `npx` resolved, and the window says on the
    // row that its package is fetched on the first run rather than presenting that as a problem.
    availability,
  };
}
