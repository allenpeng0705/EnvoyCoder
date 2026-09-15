/**
 * The catalogue over the wire: **what EnvoyCoder knows how to drive, and what this machine can actually
 * do with one of them.**
 *
 * ## Why the catalogue is served at all
 *
 * `coder.listHarnesses` answers for the nine agents we ship and `coder.listProviders` for the ones a user
 * typed. Between them they left the 38 catalogued ACP agents — Gemini CLI, Cline, Goose, Cursor's own
 * recipe — reachable from nowhere: the data was in `@envoycoder/agent-catalog` and no surface read it. A
 * user with one of those CLIs installed had a product that supported it and no way to find that out. That
 * is the gap these two methods close.
 *
 * It is served rather than imported into the window for two reasons:
 *
 *   * **One copy.** `@envoycoder/agent-catalog` is where the *launch* reads an entry's command and argv.
 *     A window that carried its own copy would be a second answer to "what does this run", free to drift
 *     from the one `launchForProvider` uses — the class of defect this repository keeps paying for.
 *   * **The phone.** The catalogue is not a desktop feature. A thin client that lists agents, or lets a
 *     user add one, reads these same two methods and gets the same entries and the same dialect facts. The
 *     package they come from is browser-hostile on purpose (`@envoycoder/platform` imports `node:fs`), so
 *     the daemon is the only half that *can* hold it — which turns "do not put catalogue knowledge in
 *     desktop-only code" into a fact about the architecture rather than a rule to remember.
 *
 * ## Two methods, and the difference between them is the whole cost story
 *
 *   * `coder.listCatalog` **measures nothing.** It projects the static list: no search path, no process,
 *     no package. That is why it is safe to call on open, and why 38 rows can render immediately.
 *   * `coder.probeCatalogAgent` measures **one entry, when the user asks about that row**, and caches the
 *     answer. See `probeOne` for what is cached and — more importantly — what is deliberately not.
 *
 * Never a sweep, and the reason is money and bandwidth rather than taste: 14 of the entries are `npx -y …`
 * recipes, so a screen that probed them all while opening would be a screen that downloads fourteen npm
 * packages because a user clicked *Settings*. The probe here does not fetch anything (it looks for `npx`
 * rather than the package), which makes the sweep merely wasteful rather than expensive — and wasteful on
 * behalf of rows nobody looked at is still enough to say no.
 */

import {
  ACP_AGENT_CATALOG,
  type AcpAgentEntry,
  type ProbeFinding,
  cataloguedInstall,
  cataloguedProviderInput,
  acpAgent,
  harnessAvailability,
} from "@envoycoder/agent-catalog";
import {
  type CatalogEntry,
  type CatalogProbe,
  type HarnessAvailability,
  type RpcMethod,
  ENVOYCODER_ERRORS,
  coderError,
  isHarnessId,
  parseRpcParams,
} from "@envoycoder/protocol";

import { ref } from "./messages.js";
import type { CoderHandler } from "./service.js";

/**
 * How long a measurement stands before the daemon measures again.
 *
 * The same ten minutes `session-probe.ts` uses, and for a less dramatic version of the same reason: an
 * agent can be installed while the window is open, and "I just installed it and it still says missing" is
 * a support ticket. This is the *automatic* half of that fix; `force` is the half the user controls.
 */
export const CATALOG_PROBE_STALE_MS = 10 * 60_000;

/** What these handlers need: the one prober, over the daemon's resolved search path. */
export interface CatalogHandlerDeps {
  /**
   * Measure one entry, over the list the launch will search.
   *
   * Injected rather than called directly, on exactly the terms `CoderServiceDeps.probe` is: a test that has
   * to know what a row says must not depend on what this machine happens to have installed. The caller
   * builds it from `probeRecipe(cataloguedRecipe(entry))` and the same `search` object it hands the spawn,
   * which is what keeps the answer and the launch about the same directory list.
   */
  probe: (entry: AcpAgentEntry) => ProbeFinding;
  /** Injectable clock, so a test can watch the staleness window without waiting ten minutes. */
  now?: () => number;
  /** The staleness window. */
  staleMs?: number;
}

/** One cached measurement. */
interface Measurement {
  availability: HarnessAvailability;
  detail: string;
  /** What the measurement itself cost, in milliseconds — reported so a row can say so. */
  costMs: number;
  /** When it was taken, as an ISO string. */
  observedAt: string;
}

/**
 * Which states are worth keeping.
 *
 * ## The rule, and the defect it prevents
 *
 * `session-probe.ts` caches only successful outcomes, and this is the same rule one step wider: **a
 * negative answer is the one a user is about to change.** Caching `not-installed` would mean a user who
 * installs Goose, comes back and presses *Check again* is shown the answer we took before they did it —
 * and the row they are looking at is the row they just acted on. `unknown` is excluded for the plainer
 * reason that we did not measure anything: there is nothing to keep.
 *
 * So `ready`, `needs-bridge` and `unsupported` are cached (they are facts about an installation, and
 * re-walking a search path to re-learn them is pure waste), and the two states that assert *absence* are
 * measured every time they are asked about. That costs one search per press on a missing row, which is
 * the cheapest possible price for the answer being true.
 */
const CACHEABLE: ReadonlySet<HarnessAvailability["state"]> = new Set([
  "ready",
  "needs-bridge",
  "unsupported",
]);

/**
 * The two handlers, ready to spread into the daemon's table.
 *
 * Both parse their parameters first, exactly as every method in `service.ts` does, so a bad call is refused
 * by the same code with the same shape wherever it lands.
 */
export function createCatalogHandlers(
  deps: CatalogHandlerDeps,
): Partial<Record<RpcMethod, CoderHandler>> {
  const now = deps.now ?? (() => Date.now());
  const staleMs = deps.staleMs ?? CATALOG_PROBE_STALE_MS;
  /**
   * The measurements, in memory, dying with the daemon.
   *
   * Deliberate rather than unfinished, on the same terms `session-probe.ts` states: this answers "what is
   * on this machine right now", and a persisted answer would survive the install that invalidates it. It
   * also has to be *global* rather than per-connection, because a second window asking about the same row a
   * minute later should not make the daemon walk the search path again.
   */
  const cache = new Map<string, Measurement>();

  /** A cached measurement, when there is one and it is young enough. */
  const fresh = (id: string): Measurement | undefined => {
    const entry = cache.get(id);
    if (!entry) return undefined;
    const age = now() - Date.parse(entry.observedAt);
    // A clock that went backwards (a laptop waking from sleep, an NTP correction) makes the age negative;
    // that is not evidence of freshness, so only a genuinely young reading is served.
    return age >= 0 && age < staleMs ? entry : undefined;
  };

  return {
    /**
     * Every catalogued entry, **with nothing measured about it**.
     *
     * The rows carry the recipe (command, argv, the dialect the entry states, the environment variable
     * *names* it sets, and how the program is obtained) and one computed flag — whether the id also names
     * an agent we ship, because `cursor` is both a built-in and a recipe, and the window must not be the
     * place that decides which wins.
     */
    "coder.listCatalog": async (params) => {
      parseRpcParams("coder.listCatalog", params);
      return { entries: catalogEntries() };
    },

    /**
     * One entry, measured — or answered from a recent measurement, and told which it was.
     *
     * The refusals are the parameter's fault and are reported as such: an id that names no catalogued entry
     * is `envoycoder.bad-request` with a sentence naming it. Answering `unknown` there was the other option
     * and it is worse — `unknown` means "we could not look", and saying it about a program that does not
     * exist turns a typo into a state a user can act on.
     */
    "coder.probeCatalogAgent": async (params) => {
      const input = parseRpcParams("coder.probeCatalogAgent", params) as {
        id: string;
        force?: boolean;
      };
      const entry = acpAgent(input.id);
      if (!entry) {
        throw coderError(
          ENVOYCODER_ERRORS.badRequest,
          `There is no catalogued agent called "${input.id}". The list changed since this window read it — reopen the agents page and try again.`,
          ref("error.catalogAgentMissing", { id: input.id }),
        );
      }

      if (input.force !== true) {
        const cached = fresh(input.id);
        if (cached) return { id: input.id, ...cached, cached: true } satisfies CatalogProbe;
      }

      const started = now();
      const finding = deps.probe(entry);
      const costMs = Math.max(0, now() - started);
      const availability = harnessAvailability(finding);
      const measured: Measurement = {
        availability,
        detail: describe(entry, finding, availability),
        costMs,
        observedAt: new Date(now()).toISOString(),
      };
      if (CACHEABLE.has(availability.state)) cache.set(input.id, measured);
      else cache.delete(input.id);
      return { id: input.id, ...measured, cached: false } satisfies CatalogProbe;
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
 */
export function catalogEntries(): CatalogEntry[] {
  return ACP_AGENT_CATALOG.map(rowOf);
}

/** One entry, as the wire wants it. See `CatalogEntry` for every field and why it is there. */
function rowOf(entry: AcpAgentEntry): CatalogEntry {
  const input = cataloguedProviderInput(entry);
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
    env: [...input.env],
    transport: input.transport,
    install: cataloguedInstall(entry),
    // The overlap rule, computed by the half that holds both lists: `cursor` is a shipped agent *and* a
    // recipe, and a built-in wins (`resolveAgentEntry`). A row that is both is shown in the shipped list
    // and is not offered as something to add.
    builtIn: isHarnessId(entry.id),
  };
}

/**
 * The one English sentence about a measurement — for the log and for the tests, never for the screen.
 *
 * The window renders the states and their `fix` in the user's language; this is the same deal
 * `HarnessSummary.evidence` and `AgentProviderSummary.detail` make, and it exists so a bug report can quote
 * what the daemon actually found. The one thing it adds over the probe's own `reason` is the `ready` case,
 * where there is no reason and there *is* something worth saying: an `npx` recipe that resolved means the
 * package will be fetched on the first run, and that is a fact a support thread wants.
 */
function describe(
  entry: AcpAgentEntry,
  finding: ProbeFinding,
  availability: HarnessAvailability,
): string {
  if (availability.state !== "ready") {
    return finding.reason ?? `${entry.title} is not available on this machine.`;
  }
  const install = cataloguedInstall(entry);
  if (install.kind === "npx") {
    return (
      `Ready to run: \`npx\` is at ${availability.binary ?? "a resolved path"}, and ` +
      `${entry.title} (${install.package}) is fetched from npm on the first run.`
    );
  }
  return `Ready to run${availability.binary ? ` (${availability.binary})` : ""}.`;
}
