/**
 * Which models each agent documents, and how a chosen one reaches it.
 *
 * ## Why this is a separate module
 *
 * The mode facts live on the entries in `index.ts` because a mode is *our* list of what an agent
 * declares — three ids, in the agent's order, with labels we wrote. A model is not that shape. It is a
 * list somebody else publishes (or an admission that nobody does), it needs a **provenance line per
 * agent** rather than one per entry, and it has a second question attached that the modes never had:
 * *how does the value get there?* Two agents answer that two different ways — one through argv, one
 * through the session the agent just opened — so the two facts belong next to each other and not
 * spread down a 900-line catalogue.
 *
 * ## The rule, and the mistake it exists to prevent
 *
 * **An empty list must never mean "you cannot set a model."** Those are different claims about
 * somebody else's product, and getting them backwards is the whole failure mode of this feature:
 *
 *   * `kind: "listed"` — the agent publishes the models it accepts; `options` is that list.
 *   * `kind: "free-text"` — the agent takes a model and publishes no list we can read. The composer
 *     shows a **text field**, because there is genuinely something to set.
 *   * `kind: "none"` — the agent takes no model at all. Only this one disables the control.
 *
 * `deepseek-harness` is the middle case, and it is the reason the middle case exists: it *does* report
 * a model list, but only inside the `session/new` response of a live session
 * (`../deepseek-harness/packages/acp/acp/README.md:76` — "opaque provider/model choices from the live
 * LLM service catalog"), which a composer has no access to before a run exists. Cataloguing a list for
 * it would mean inventing provider names and model ids from memory, which the family's rule forbids
 * outright: **never a list we invented.** So it gets free text and a sentence, not a fabricated menu.
 *
 * ## What "honoured" means for each delivery
 *
 * A picker whose choice is dropped is the bug this whole control row exists to avoid, so both wired
 * agents are wired *concretely*, and neither is best-effort:
 *
 *   * `envoy-harness` — the model travels as **argv** (`--provider` / `--model`). That is not a
 *     stylistic choice: its `--acp` dispatch builds a live agent only when `--provider` is present and
 *     otherwise falls back to a hermetic demo backend (`.../src/cli/run/acp.ts:100-106`), where
 *     `session/set_model` is not even implemented. A bare `--model` is therefore **silently ignored**,
 *     which is why the provider is not optional in our argv.
 *   * `deepseek-harness` — the model travels through the agent's own session configuration
 *     (`session/set_config_option`, `configId: "model"`). See `SessionModelConfig` for the encoding and
 *     the two versions it was verified in.
 */

import type { AgentModel, AgentModels, HarnessId } from "@envoycoder/protocol";

/** Re-exported so a caller reads the model facts and the model types from one place. */
export type { AgentModel, AgentModels };

/** What an agent accepts, and where that answer came from. */
export type HarnessModels = AgentModels;

/**
 * The providers `envoy-harness` documents a default model for, with the display name we show.
 *
 * The names are brand names and are deliberately **not** in the translation catalogue — the same rule
 * `HarnessDefinition.label` follows ("Claude Code" is not German in German).
 */
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  glm: "GLM (Zhipu)",
  qwen: "Qwen (Alibaba)",
  ollama: "Ollama",
};

/**
 * `envoy-harness`'s own `DEFAULT_PROVIDER_MODELS`, one option per provider.
 *
 * **Copied, not imported**, and that is a decision worth stating. The peer publishes this table
 * "public so callers can show them in help text"
 * (`../envoy-harness/packages/envoy-harness/src/llm/index.ts:110-120`), which is exactly what we do
 * with it — but this package links only `@envoycoder/protocol` and `@envoycoder/platform`
 * (`packages/agent-catalog/package.json`), and adding a `file:` dependency on the peer checkout would
 * make the whole catalogue unloadable on a machine that has not cloned it. The family's rule is that
 * the harness is a peer a product clones, not a package it vendors; the catalogue's job is to *record*
 * what the peer says, with the citation, which is how every other fact in it is handled.
 *
 * The values are the peer's, verbatim, in its order — a model id we prettified is a model id the agent
 * refuses.
 */
const ENVOY_HARNESS_DEFAULTS: readonly (readonly [provider: string, model: string])[] = [
  ["openai", "gpt-4o"],
  ["anthropic", "claude-sonnet-4-6"],
  ["deepseek", "deepseek-chat"],
  ["minimax", "MiniMax-M3"],
  ["glm", "glm-4-flash"],
  ["qwen", "qwen-plus"],
  ["ollama", "llama3.1"],
];

/**
 * A provider-qualified id, which is the value that travels and the value stored on the task.
 *
 * `provider/model` is already the documented shape of `TaskDefaults.model` in the protocol
 * (`packages/protocol/src/domain.ts:187-188`), so this introduces no second vocabulary.
 */
export function modelIdFor(provider: string, model: string): string {
  return `${provider}/${model}`;
}

function listedModels(): AgentModel[] {
  return ENVOY_HARNESS_DEFAULTS.map(([provider, model]) => ({
    id: modelIdFor(provider, model),
    label: model,
    ...(PROVIDER_LABELS[provider] !== undefined ? { description: PROVIDER_LABELS[provider] } : {}),
    provider,
    model,
  }));
}

/* ────────────────────────────── how a model travels ───────────────────────────── */

/** A model choice taken apart, which is the shape both delivery wires need. */
export interface ModelChoice {
  /** Provider-qualified, exactly as it is stored on the task. */
  id: string;
  provider: string;
  model: string;
}

/** Why a stored or typed model cannot be handed to this agent. */
export interface ModelUnresolvable {
  ok: false;
  /** English, for the log and for a caller with no translator; the daemon sends a key alongside it. */
  reason: string;
  /** Which refusal it is, so the daemon can pick the translated sentence. */
  code: "noModelSupport" | "unknownModel" | "notProviderQualified";
}

export type ModelResolution = ({ ok: true } & ModelChoice) | ModelUnresolvable;

/**
 * The agent's own session-configuration option for the model, plus how to encode a choice into it.
 *
 * ## The encoding is the agent's, and it is opaque
 *
 * `deepseek-harness` advertises the model as a standard ACP `select` option whose values are
 * documented as **opaque** — "opaque provider/model choices from the live LLM service catalog"
 * (`../deepseek-harness/packages/acp/acp/README.md:76`, and the option itself at
 * `.../packages/acp/acp/src/model-control.ts:188-195`). What "opaque" means concretely, in both
 * versions we could read, is a JSON array of the two strings:
 * `JSON.stringify([provider, model])` (`.../src/model-control.ts:235-237`, identical in the published
 * `@deepseek-ai/dsh-acp` 0.1.2-rc.1, `lib/index.js:525-527`).
 *
 * We therefore construct that value rather than asking for a list first — which is the only way free
 * text can be honoured at all. The risk is real and it is bounded in the right direction: an id the
 * agent's catalog does not have is **refused by the agent**, loudly, with its own words
 * (`AcpModelConfigError: unknown model option: …`, raised at
 * `.../src/model-control.ts:105-111` and mapped to `invalid params` at `.../src/index.ts:340-342`).
 * It is never quietly ignored, which is the property that makes constructing it acceptable instead of
 * reckless.
 */
export interface SessionModelConfig {
  /** The agent's own config-option id. */
  configId: string;
  /** The agent's own encoding of a provider + model choice. */
  encode: (choice: { provider: string; model: string }) => string;
  /** Where the id and the encoding were read from. */
  source: string;
}

/**
 * How this daemon hands a model to a given agent — or that it cannot.
 *
 * `argv` means the flags are built in the catalogue entry's `buildArgs` (`index.ts`), where every other
 * launch fact lives; the `source` here names the file that proves the flags are the ones the agent
 * reads. `session-config` means the value is set on the session the agent just opened, which is what
 * `AcpClient` does after `session/new`.
 */
export type ModelDelivery =
  | { kind: "argv"; source: string }
  | ({ kind: "session-config" } & SessionModelConfig);

/**
 * The model wiring, per agent. Absent means **this daemon cannot apply one**, and the composer says so
 * on screen instead of offering a control that would be dropped.
 *
 * The third-party CLI entries are absent deliberately, and not because they lack a model flag — several
 * of them take one in argv, and their `buildArgs` record it. It is because `isDrivableByAcpAdapter`
 * refuses to launch any of them at all, so no model could reach them even if one were chosen. That is
 * the same distinction, and the same honest answer, as `capabilities.agentMode` for those entries.
 */
export const HARNESS_MODEL_DELIVERY: Readonly<Partial<Record<HarnessId, ModelDelivery>>> = {
  "envoy-harness": {
    kind: "argv",
    // `--model <id>` is "LLM model identifier" and `--provider <name>` is the provider, both documented
    // in the peer's own help (`../envoy-harness/packages/envoy-harness/src/cli/argv-help.ts:23-24`).
    // That the *pair* is required is the `--acp` dispatch's rule, not ours:
    // `.../src/cli/run/acp.ts:100-106` reads `--model` only when `--provider` is set.
    source:
      "argv-help.ts:23-24 documents `--model <id>` / `--provider <name>`; " +
      "cli/run/acp.ts:100-106 (`resolveLiveModel`) reads `--model` only when `--provider` is set.",
  },
  "deepseek-harness": {
    kind: "session-config",
    // `session/set_config_option` is the method (`.../packages/acp/README.md:70`), and the model is one
    // of the two options it updates: the option list is the "opaque provider/model choices" the README
    // describes at :76, `configId` is `MODEL_CONFIG_ID = 'model'` in the source.
    configId: "model",
    encode: ({ provider, model }) => JSON.stringify([provider, model]),
    source:
      "packages/acp/acp/README.md:70,76; packages/acp/acp/src/index.ts:196-231 (session/new answers " +
      "{sessionId, configOptions}) and :388 (session/set_config_option); " +
      "packages/acp/acp/src/model-control.ts:188-195 (the `model` select) and :235-237 (the value " +
      "encoding, JSON.stringify([provider, model])).",
  },
};

/* ────────────────────────────── the catalogue ───────────────────────────── */

/**
 * What each agent publishes about its models.
 *
 * One entry per harness, including the ones with nothing to publish: a missing key would be a third
 * state ("nobody wrote this down") that a client cannot tell from `"none"`, and that ambiguity is
 * exactly what `AgentModels.kind` was added to remove.
 */
export const HARNESS_MODELS: Readonly<Record<HarnessId, HarnessModels>> = {
  "envoy-harness": {
    kind: "listed",
    options: listedModels(),
    source:
      "DEFAULT_PROVIDER_MODELS, read from ../envoy-harness/packages/envoy-harness/src/llm/index.ts:110-120 " +
      "(\"Default models per provider. Public so callers can show them in help text\"). The ids are " +
      "copied verbatim — a translated or prettified model id is one `createProviderAdapter` routes to " +
      "nothing. NOT a closed list: the peer's `--model` is documented as a free-form \"LLM model " +
      "identifier\" (cli/argv-help.ts:23), so these are the defaults it publishes, not every id it will " +
      "accept; a task carrying a different id is refused by us rather than guessed at, because we cannot " +
      "know which provider it belongs to.",
  },

  "deepseek-harness": {
    kind: "free-text",
    options: [],
    // **Verified against the real binary, and the result is more interesting than "no list".**
    // `dsh --profile acp` *does* publish a model list — in the `session/new` response, as a standard ACP
    // `select` option. A raw JSON-RPC probe on the machine this was written on returned:
    //
    //   {id: "model", category: "model", type: "select",
    //    currentValue: '["deepseek-official","deepseek-v4-flash"]',
    //    options: [{group: "deepseek-official", name: "DeepSeek", options: [
    //      {value: '["deepseek-official","deepseek-v4-flash"]', name: "DeepSeek-V4-Flash"}, …]}]}
    //
    // That list is why this entry is `free-text` rather than `none`, and why it is not `listed` either:
    // it exists **only per session**, so a composer has nothing to render before a run, and its values
    // are the agent's own catalog ids (`deepseek-official`, not `deepseek`) — ids nobody can guess from
    // outside the agent. Enumerating them at `coder.listHarnesses` time would mean spawning an agent per
    // call, and a list that depends on which credentials a machine has is not a fact about the agent that
    // belongs in a catalogue. So: free text, the shape named on screen, and the agent's own refusal when
    // the value is not one it has. Both directions were reproduced against the real binary with *our own*
    // resolver and encoding:
    //
    //   typed `deepseek-official/deepseek-v4-flash` → we send '["deepseek-official","deepseek-v4-flash"]'
    //     → ACCEPTED, the session opened.
    //   typed `deepseek/deepseek-chat` → we send '["deepseek","deepseek-chat"]'
    //     → refused, `invalid params: unknown model option: ["deepseek","deepseek-chat"]`.
    //
    // The second is the honest cost of free text and the first is why it is still worth offering. The
    // method name itself is pinned credential-independently in
    // `apps/desktop/test/acp-transport.test.ts`, so a wrong spelling cannot pass on a machine that has
    // no model credentials at all.
    //
    // Showing the real list needs a channel this slice does not add: the run would have to report the
    // options it observed, and a summary would carry the **last observed** list with its staleness
    // stated. Inventing a static list here is the shortcut that makes the picker a lie the first time
    // somebody's catalog differs.
    source:
      "No published list, and no static one invented. The agent reports its models over the wire " +
      "instead: `session/new` answers {sessionId, configOptions} and the `model` option enumerates the " +
      "live catalog (../deepseek-harness/packages/acp/acp/README.md:70,76; " +
      "packages/acp/acp/src/index.ts:196-231; packages/acp/acp/src/model-control.ts:144-195). VERIFIED " +
      "against the real `dsh --profile acp` here: the select carried one group, `deepseek-official`, with " +
      "three models, and its values are opaque JSON pairs (`[\"deepseek-official\",\"deepseek-v4-flash\"]`). " +
      "Per-session only, so free text plus the shape sentence is the honest answer for a composer that " +
      "renders before a run exists.",
  },

  // The third-party CLIs below take a model, but `isDrivableByAcpAdapter` refuses to launch any of
  // them, so `capabilities.model` is false for every one of them and the composer disables the control
  // with a reason. Their `kind` stays what the *agent* offers, which is the same split `modes` and
  // `capabilities.agentMode` already use: one says what the agent has, the other what we can deliver.
  claudecode: {
    kind: "free-text",
    options: [],
    source:
      "unverified against the installed binary. `claude --model <id>` is the flag this catalogue " +
      "assumes (packages/agent-catalog/src/index.ts, claudecode.buildArgs), recorded as unverified " +
      "there — and unreachable in any case while `isDrivableByAcpAdapter` refuses the entry.",
  },

  codex: {
    kind: "free-text",
    options: [],
    source:
      "unverified — `codex exec --model <id>` is assumed (codex.buildArgs in this catalogue), and the " +
      "entry cannot be launched at all until it has an adapter.",
  },

  copilot: {
    kind: "none",
    options: [],
    source:
      "This entry records no model flag at all (copilot.buildArgs passes only the prompt), and its " +
      "non-interactive surface has not been read — so the honest answer is that we do not know of a " +
      "model to set, not that it has none. Worth revisiting with the adapter that makes it runnable.",
  },

  opencode: {
    kind: "free-text",
    options: [],
    source:
      "unverified — `opencode run --model <id>` is assumed (opencode.buildArgs). Paseo's CLI reference " +
      "shows provider-qualified values there (`paseo run --provider claude/opus-4.6`), which is where " +
      "the provider-qualified convention came from.",
  },

  cursor: {
    kind: "free-text",
    options: [],
    source:
      "unverified — `cursor-agent -p --model <id>` is assumed (cursor.buildArgs). The entry is a " +
      "placeholder carried over from EnvoyMesh's harness list and has no adapter yet.",
  },

  omp: {
    kind: "free-text",
    options: [],
    source:
      "Read from Paseo v0.8.0, not run here: `<binary> --mode rpc [--model M] [--session S]` " +
      "(paseo providers/pi/runtime.ts:119-140). Our entry spawns it in one-shot mode instead, and " +
      "refuses it before launch, so the flag is recorded rather than usable.",
  },

  pi: {
    kind: "free-text",
    options: [],
    source:
      "unverified, and recorded as wrong about the protocol: Paseo drives Pi as " +
      "`<binary> --mode rpc [--model M] [--session S]` (providers/pi/runtime.ts:119-140), while this " +
      "catalogue's entry launches it in one-shot text mode and passes no model flag at all.",
  },
};

/** What an agent publishes. Total, so no caller has to decide what a missing entry would mean. */
export function harnessModels(id: HarnessId): HarnessModels {
  return HARNESS_MODELS[id];
}

/** How a model reaches this agent, or `undefined` when this daemon cannot apply one. */
export function harnessModelDelivery(id: HarnessId): ModelDelivery | undefined {
  return HARNESS_MODEL_DELIVERY[id];
}

/** Can the daemon put this agent on a chosen model? The flag the composer's control is enabled on. */
export function canApplyModel(id: HarnessId): boolean {
  return HARNESS_MODEL_DELIVERY[id] !== undefined;
}

/* ────────────────────────────── resolution ───────────────────────────── */

/**
 * Turn the model on a task into the provider and model an agent's own protocol wants.
 *
 * ## Why a stored id is not simply split on `/`
 *
 * For an agent that publishes a list, the id is looked up **in that list**. That is not pedantry: the
 * list is the only place the pairing is stated, and the alternative — splitting — gets
 * `meta-llama/Llama-3-70b` wrong in the direction that matters, by handing the agent a provider named
 * `meta-llama`. A stored id that is no longer published is refused with a sentence naming the agent,
 * which is a better outcome than a run that starts on some other model than the one on screen.
 *
 * For `free-text` agents there is no list to look up, so the value is split on the **first** slash and
 * both halves must be non-empty. That is a real constraint on the user and it is stated on screen
 * rather than discovered at run time, because these agents need a provider to build a route at all.
 *
 * Returning a discriminated union rather than throwing keeps this usable both by the daemon (which
 * turns `code` into a translated sentence) and by argv construction, without an exception crossing a
 * package boundary for an expected case.
 */
export function resolveModelChoice(harness: HarnessId, value: string): ModelResolution {
  const models = harnessModels(harness);

  if (models.kind === "none") {
    return {
      ok: false,
      code: "noModelSupport",
      reason: `${harness} does not take a model, so "${value}" cannot be applied to it.`,
    };
  }

  if (models.kind === "listed") {
    const found = models.options.find((option) => option.id === value);
    if (found === undefined) {
      return {
        ok: false,
        code: "unknownModel",
        reason: `${harness} does not publish a model called "${value}", so we cannot tell which provider it belongs to.`,
      };
    }
    return { ok: true, id: found.id, provider: found.provider, model: found.model };
  }

  const slash = value.indexOf("/");
  const provider = slash > 0 ? value.slice(0, slash) : "";
  const model = slash > 0 ? value.slice(slash + 1) : "";
  if (provider === "" || model === "") {
    return {
      ok: false,
      code: "notProviderQualified",
      reason: `${harness} needs a model written as provider/model (for example deepseek/deepseek-chat), and "${value}" does not name both.`,
    };
  }
  return { ok: true, id: value, provider, model };
}

/**
 * The flags that carry a model to an agent that reads one from argv, and `[]` when none was chosen.
 *
 * `envoy-harness` is the only agent this is used for, and both flags are emitted together on purpose:
 * its `--acp` dispatch checks `parsed.provider` before it reads `--model` at all
 * (`cli/run/acp.ts:100-106`), so a bare `--model` would be accepted by the argument parser, dropped by
 * the dispatch, and then reported to the user as a run on the model they chose. Throwing on an
 * unresolvable value keeps that from being possible from this side too — the daemon refuses earlier,
 * with a translated sentence, so this is the second of two loud failures rather than a silent drop.
 */
export function modelArgs(value: string | undefined, harness: HarnessId): string[] {
  if (value === undefined || value === "") return [];
  const resolved = resolveModelChoice(harness, value);
  if (!resolved.ok) throw new Error(resolved.reason);
  return ["--provider", resolved.provider, "--model", resolved.model];
}

/**
 * The bare model id inside a provider-qualified value, for an agent whose flag wants only that.
 *
 * No lookup and no validation: these are the third-party entries whose flag surface is `unverified`,
 * and the honest thing to do with a fact we have not checked is to pass the user's own value through
 * unchanged rather than to "fix" it into something else. A value with no slash is itself.
 */
export function modelIdOf(value: string): string {
  const slash = value.indexOf("/");
  return slash > 0 ? value.slice(slash + 1) : value;
}
