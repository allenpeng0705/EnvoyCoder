/**
 * How a probe becomes a row a window renders — **both tiers, side by side**.
 *
 * ## Why one module for the nine and for a user's own agents
 *
 * `coder.listHarnesses` and `coder.listProviders` answer different questions about different things: one
 * lists the agents this product ships, with the modes, models and thinking levels their entries declare;
 * the other lists agents a user typed, with the command line they will run and whether the environment
 * variables they name are set. What they must **not** differ about is the part a user acts on: the state,
 * and the commands that fix it. Both go through `harnessAvailability`, and both are re-checked by
 * `HarnessAvailabilitySchema`'s agreement rules before they reach a window.
 *
 * Keeping the two projections in one file is what makes that visible. Read together, the differences are
 * deliberate and arguable — a shipped agent's capabilities are facts we verified, a provider's are absent
 * because we have never opened a session with it — rather than accidental, which is what a reader of two
 * distant files cannot tell.
 *
 * ## Why it is not in `service.ts`
 *
 * `AGENTS.md`: past ~800 lines, split. The handler table grew three methods with the provider slice, and a
 * projection is not a handler: it takes data and returns data, with no transport, no parsing and no
 * refusal. It lives here so the table stays a table.
 */

import {
  type AgentAuthObservation,
  type AgentProviderConfig,
  type AgentProviderSummary,
  type HarnessAuth,
  type HarnessId,
  type HarnessSummary,
  type ObservedSessionOptions,
  unknownAuth,
  type AgentDelivery,
  type AvailabilityFix,
} from "@envoydev/protocol";
import {
  canApplyModel,
  canApplyThinking,
  harnessAvailability,
  harnessDefinition,
  providerEnvState,
  sessionFacts,
  type HarnessProbe,
  type ProbeFinding,
  type ProviderProbe,
} from "@envoydev/agent-catalog";

/**
 * A catalogue entry plus what this machine can actually do with it.
 *
 * ## What this projection is, and what it deliberately cannot be
 *
 * **Everything in it is evidence.** Both fields a user acts on — `availability` (five states, with the
 * commands that fix each one) and `auth` — are what a probe found, and neither is ever derived from
 * anything a user stored. That sounds like a truism until you write down what it rules out: this row used
 * to carry a third field, a `hidden` preference over the pickers, and the shape of the mistake is worth
 * keeping. A *stored* filter is not evidence and cannot be corrected by looking again — it is a claim about
 * a list that stays wrong until somebody edits a settings file — whereas a *derived* rule over probed facts
 * is wrong exactly as long as our measurement is, and a probe fixes it. So the projection reports, and the
 * decision about what a picker offers lives in one pure function over these rows
 * (`apps/desktop/src/composer/agent-for.ts`).
 */
export function summarize(
  id: HarnessId,
  probe: (harness: HarnessId) => HarnessProbe,
  /**
   * What this agent published the last time a session was opened with it, if we ever have.
   *
   * Passed in rather than looked up here so `summarize` stays a function of its arguments — and
   * because the store is the only thing that knows whether a run has happened, which is the fact the
   * whole "observed, not promised" story turns on.
   */
  observed: ObservedSessionOptions | undefined,
  /**
   * What the daemon last established about this agent's authentication, if anything ever has.
   *
   * `undefined` is rendered as `unknown` — see `unknownAuth`, which exists so the daemon and a client
   * tolerating an older daemon produce the same three words rather than two similar ones.
   */
  auth: AgentAuthObservation | undefined = undefined,
  /**
   * **How this agent's connector is delivered**, as the user chose it.
   *
   * On the wire because it is a fact about the *launch*: with `npx` the program that starts is `npx`, and a row
   * that said `Ready (claude-agent-acp)` about a machine where nothing is installed would be describing the
   * other route. The window renders it as a property of the row, which is where this page's vocabulary puts
   * every fact a user might want to check.
   */
  delivery: AgentDelivery = { kind: "installed" },
  /** The other route's commands — see `HarnessSummary.installFix`; the caller decides when they apply. */
  installFix?: readonly AvailabilityFix[],
  /**
   * The npm package this agent's connector could be fetched from, when it has one.
   *
   * Read from the catalogue (`bridgePackage`) rather than from anything stored: it is a fact about the *recipe*,
   * and a stored copy would go stale the day a package is renamed.
   */
  fetchable?: { package: string; covers: "connector" | "agent" },
): HarnessSummary {
  const definition = harnessDefinition(id);
  const result = probe(id);
  // **The one place the two halves of "what does this agent offer" are joined.** The catalogue knows
  // what an agent documents; the store knows what an agent actually said in its last session; and for
  // the model list and the thinking level the second is the better answer while it lasts. See
  // `sessionFacts` for the precedence rules, including why a session that says nothing about models
  // does not overwrite a catalogue list.
  const facts = sessionFacts(id, observed);
  return {
    id,
    label: definition.label,
    tier: definition.tier,
    summary: definition.summary,
    // The agent's own modes, so a composer can render its picker from the wire rather than from a
    // hardcoded list. Empty means "the agent declares none here", which for `deepseek-harness` is the
    // answer rather than a gap: its ACP surface has no `session/set_mode`, so it has nothing to offer.
    // (This said the real answer "arrives in the `session/new` response" — it does not, for either
    // harness. See the citations on `agentMode` in `@envoydev/agent-catalog`.)
    modes: definition.modes,
    // The models this agent publishes — **and what an empty list means**, which is the half a list
    // alone cannot carry. `deepseek-harness` publishes none we can read before a run exists and still
    // takes one, so its `kind` is `"free-text"`; once a run has happened, the list that run reported
    // replaces it (`observedAt` says when). Rendering an empty list as "no model" would be a claim
    // about somebody else's product. The rules and their citations live in `@envoydev/agent-catalog`.
    models: facts.models,
    // The thinking level, on the same terms one step further: it is knowable *only* from a session, so
    // this is `"session"` (we have not seen one), `"listed"` (we have) or `"none"` (the agent offers
    // none — recorded from its source and verified for `envoy-harness`, or observed for an agent that
    // opened a session and published no such option).
    thinking: facts.thinking,
    capabilities: {
      resume: definition.capabilities.resume,
      cancel: definition.capabilities.cancel,
      approvals: definition.capabilities.approvals,
      structuredTools: definition.capabilities.structuredTools,
      streaming: definition.capabilities.streaming,
      images: definition.capabilities.images,
      // Carried so a composer can enable its mode picker on the daemon's answer rather than on its
      // own assumption. `modes` alone is not enough to decide: an agent can declare modes it has no
      // way to be *set* into, and a picker that offered one would be a control that does nothing.
      agentMode: definition.capabilities.agentMode,
      // The same distinction for the model, and a different wire: whether this daemon can make a chosen
      // model the one the agent runs on. `envoy-harness` reads it from argv; `deepseek-harness` and the
      // three agents reached over ACP read it from the session the agent just opened. The four entries
      // this build cannot launch get it from nowhere — so the control is enabled on this flag, and off
      // with a reason, everywhere it is false.
      model: canApplyModel(id),
      // And the third, which turns on a *different* method (`session/set_config_option`) for an agent
      // that takes one: `deepseek-harness` yes, `envoy-harness` no — its ACP dispatch has no
      // thought-level method at all, verified against the built peer.
      thinking: canApplyThinking(id),
      // And a fourth, on `session/set_policy` — the method behind "Ask before anything destructive".
      // True for `envoy-harness` alone, whose `autoRun` values are exactly
      // `always-confirm | safe-only | off`; `deepseek-harness` answers every method in its own request
      // table and `session/set_policy` is not one of them, so its row is disabled with a reason rather
      // than sent and refused. The catalogue owns the fact; this line is the wire carrying it.
      approvalPolicy: definition.capabilities.approvalPolicy,
    },
    // **The state, and the commands that fix it.** This replaced `available: boolean | "unknown"` plus a
    // single `installHint`: the boolean could not say whether the *agent*, the *adapter we drive it
    // through*, or our own search path was the thing that came up empty, so a user with `claude` and
    // `codex` installed read "Not installed" about a missing npm bridge. `harnessAvailability` does the
    // projection and `HarnessAvailabilitySchema` re-checks its five agreement rules on every answer, so a
    // catalogue change that produced a self-contradicting state fails a test rather than reaching a window.
    availability: harnessAvailability(result),
    delivery,
    ...(installFix !== undefined && installFix.length > 0 ? { installFix } : {}),
    ...(fetchable !== undefined ? { fetchable } : {}),
    // And the third fact: whether it will talk to us, or wants a sign-in first. `authOf` is the one place
    // that turns a record — or the absence of one — into the three-state answer.
    auth: authOf(auth),
    evidence: definition.evidence,
  };
}

/**
 * What the wire says about one agent's authentication, from a record we may not have.
 *
 * Two inputs and three outputs, and the honesty is in the second branch: **no record at all** becomes
 * `unknown` with no timestamp, which is the same answer a *failed* probe records — a client cannot act
 * differently on "nothing has looked" and "something looked and could not tell", so the wire does not ask it
 * to. What it must never become is `needs-signin`, which is why `unknownAuth()` is a function in the
 * protocol rather than a literal at each call site: a second spelling of "we do not know" is how one of them
 * drifts into a claim.
 */
export function authOf(record: AgentAuthObservation | undefined): HarnessAuth {
  if (!record) return unknownAuth();
  return {
    state: record.state,
    ...(record.methodId !== undefined ? { methodId: record.methodId } : {}),
    // The terminal instruction, when the agent says a terminal is how it signs in — see `HarnessAuth.terminal`.
    ...(record.terminal !== undefined ? { terminal: record.terminal } : {}),
    observedAt: record.observedAt,
  };
}

/**
 * A provider plus what this machine can actually do with it.
 *
 * The same join `summarize` makes for a catalogue entry, and deliberately the same *shape of answer*:
 * `availability` comes from `harnessAvailability` (one projection for both tiers), and the two facts a
 * provider adds are its command line — so a user can see what the row would run — and the environment
 * variables it names, each with whether this daemon has it.
 *
 * There is no `models`, `modes`, `thinking` or `capabilities` here, and their absence is a statement rather
 * than an omission: we have never opened a session with this program, so every one of them would be the
 * user's guess handed back as our fact. The composer's pickers stay off for a provider, with the reason on
 * screen, until a session exists to ask.
 */
export function summarizeProvider(
  provider: AgentProviderConfig,
  probe: (provider: AgentProviderConfig) => ProviderProbe,
  env: NodeJS.ProcessEnv,
  auth: AgentAuthObservation | undefined = undefined,
): AgentProviderSummary {
  const result = probe(provider);
  return {
    id: provider.id,
    label: provider.label,
    command: provider.command,
    args: provider.args,
    env: providerEnvState(provider, env),
    transport: provider.transport,
    ...(provider.catalogEntryId !== undefined ? { catalogEntryId: provider.catalogEntryId } : {}),
    availability: harnessAvailability(result),
    ...(auth !== undefined ? { auth: authOf(auth) } : {}),
    detail:
      result.state === "ready"
        ? `Ready to run${result.binaryPath ? ` (${result.binaryPath})` : ""}.`
        : (result.reason ?? `${provider.label} is not available on this machine.`),
  };
}
