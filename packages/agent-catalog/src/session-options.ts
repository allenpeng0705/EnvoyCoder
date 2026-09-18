/**
 * What an agent publishes about itself **inside a session**, and what the daemon does with it.
 *
 * ## Why this subject exists at all
 *
 * Two of the composer's controls cannot be answered from a catalogue, and they cannot be answered
 * from a fixture either:
 *
 *   * **the model list** — `deepseek-harness` enumerates its models in the `session/new` response,
 *     from a live catalog of whichever credentials the machine has. Slice 2 recorded that as a gap: the
 *     agent publishes a list and the window showed a bare text field;
 *   * **the thinking level** — the same channel, a second option: ACP's `thought_level` category,
 *     whose id in this agent is `reasoning_effort` and whose values are `off | low | high | max` on the
 *     machine this was written on.
 *
 * Both are **per session**, so the honest channel is the one this module models: the daemon records
 * what it *observed* when it opened a session, per agent, with the time it observed it; the window
 * renders that for the *next* run and says that is what it is. Nothing here is invented, and nothing
 * here is a promise about a run that has not happened — which is why the record carries a timestamp
 * and why the window prints it.
 *
 * ## The three states, and the mistake the third one prevents
 *
 * A `HarnessSummary` therefore answers "what does this agent offer?" in three states rather than two,
 * and the middle one is the whole point:
 *
 *   * **"we have values"** (`listed`) — the agent published them and we kept them.
 *   * **"we have not seen a session yet"** (`session`) — our ignorance. This is the state a *naive*
 *     implementation renders as "this agent has no thinking levels", which is a false claim about
 *     somebody else's product, and one run proves it false.
 *   * **"it offers none"** (`none`) — either recorded from the agent's own source and verified against
 *     the binary (`envoy-harness`), or observed: a session was opened and the agent published no such
 *     option.
 *
 * ## What is read from where
 *
 * The **option values** come from the agent, verbatim. The **config id** we set them through comes from
 * this module, per agent, with a citation — the same division `HARNESS_MODEL_DELIVERY` already uses for
 * the model, and for the same reason: which id an agent reads is a fact about the agent's build, and a
 * delivery we derived from a live response would vanish for a user who has not run the agent yet.
 *
 * ## The model values are opaque, and the encoding is the agent's
 *
 * A model value here is `'["deepseek-official","deepseek-v4-flash"]'` — a JSON pair, not a name
 * (`@deepseek-ai/dsh-acp` 0.1.2-rc.1, `lib/index.js:525-527`, `modelValue`). This module **decodes** it
 * with the exact inverse of the encoding `SessionModelConfig.encode` builds, and only accepts a
 * two-element array of non-empty strings; anything else is dropped rather than guessed at, because
 * `AgentModel` requires a provider and a model and a value we cannot take apart has neither.
 */

import type {
  AgentModel,
  AgentModels,
  AgentOptionValue,
  AgentThinking,
  HarnessId,
  ObservedSessionOption,
  ObservedSessionOptions,
} from "@envoydev/protocol";

import { HARNESS_MODELS, HARNESS_MODEL_DELIVERY, modelIdFor, type ModelValueShape } from "./models.js";

/** ACP's category for the model option (`dsh-acp` `lib/index.js:490`). */
export const MODEL_CATEGORY = "model";

/**
 * ACP's category for how much the agent should think — the one this module is named for.
 *
 * Read from the live response rather than from our own guess: `deepseek-harness` labels its
 * `reasoning_effort` option `category: "thought_level"`
 * (`@deepseek-ai/dsh-acp` 0.1.2-rc.1, `lib/index.js:494-508`), and the daemon keys on the **category**
 * so a renamed option id would still be found.
 */
export const THOUGHT_LEVEL_CATEGORY = "thought_level";

/**
 * One value of one option, as the agent published it.
 *
 * Two shapes are real and both are parsed: a flat list of values, and a list of **groups** each
 * carrying its own values — the model option uses the second on a machine with more than one provider
 * (`{group: "deepseek-official", name: "DeepSeek", options: […]}`).
 *
 * A value with neither a name nor a value is dropped: a user could not read it and we could not send
 * it, so keeping it would only produce an option the picker has to special-case. An empty `value` is
 * **not** that case and is kept — `""` is a real selector value for this agent, meaning "the provider's
 * own default" (`lib/index.js:307`, `PROVIDER_DEFAULT_REASONING_VALUE`).
 */
function parseValues(raw: unknown, depth = 0): AgentOptionValue[] {
  if (!Array.isArray(raw) || depth > 4) return [];
  const out: AgentOptionValue[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as {
      value?: unknown;
      name?: unknown;
      description?: unknown;
      options?: unknown;
    };
    if (Array.isArray(item.options)) {
      out.push(...parseValues(item.options, depth + 1));
      continue;
    }
    if (typeof item.value !== "string") continue;
    const named = typeof item.name === "string" && item.name !== "" ? item.name : "";
    const label = named !== "" ? named : item.value;
    if (label === "") continue;
    out.push({
      value: item.value,
      label,
      ...(typeof item.description === "string" && item.description !== ""
        ? { description: item.description }
        : {}),
    });
  }
  return out;
}

/**
 * One `configOptions` response, normalized — or `[]` for anything that is not one.
 *
 * Tolerant on purpose, and bounded: this reads a **live agent's** response, so a shape this build has
 * not seen must degrade to "the agent published nothing" rather than to a crash in a run path. Only
 * `select` options are kept: a `boolean` or `text` option is not a value a pill can offer, and
 * pretending otherwise would put a switch in a picker.
 */
export function parseSessionConfigOptions(raw: unknown): ObservedSessionOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ObservedSessionOption[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const option = entry as {
      id?: unknown;
      name?: unknown;
      category?: unknown;
      type?: unknown;
      options?: unknown;
    };
    if (typeof option.id !== "string" || option.id === "") continue;
    if (option.type !== undefined && option.type !== "select") continue;
    out.push({
      configId: option.id,
      label: typeof option.name === "string" && option.name !== "" ? option.name : option.id,
      category: typeof option.category === "string" ? option.category : "",
      values: parseValues(option.options),
    });
  }
  return out;
}

/**
 * Everything one agent published about its own session configuration, ready to be written to the
 * daemon's state file.
 *
 * `configOptions` is passed in **verbatim** — the array the agent answered with — because normalizing
 * at the boundary is what keeps the daemon's record of "what we saw" and the window's view of "what
 * that means" from being the same computation done twice, differently.
 */
export function observeSessionOptions(input: {
  harness: HarnessId;
  observedAt: string;
  sessionId?: string;
  configOptions: readonly unknown[];
}): ObservedSessionOptions {
  return {
    harness: input.harness,
    observedAt: input.observedAt,
    ...(input.sessionId !== undefined && input.sessionId !== "" ? { sessionId: input.sessionId } : {}),
    options: parseSessionConfigOptions(input.configOptions),
  };
}

/* ────────────────────────────── reading the record ───────────────────────────── */

/**
 * The inverse of the agent's own model-value encoding, or `undefined` when the value is not one.
 *
 * The encoding is `JSON.stringify([provider, model])` (`dsh-acp` `lib/index.js:525-527`), which is also
 * what `SessionModelConfig.encode` builds on our side when a user types a model by hand. Decoding is
 * therefore symmetric with an encoding that already ships — not a second invention — and it is
 * accepted **only** when it produces exactly two non-empty strings. A provider or model containing a
 * slash is fine (`meta-llama/Llama-3-70b`); the qualifier is `provider/model` for display and storage
 * and this is the only place the pair is recovered without splitting on a slash, which is how
 * `AgentModel` is documented to be built.
 */
/**
 * Take a model option value apart the way the agent's own encoding put it together.
 *
 *   * `"json-pair"` — DeepSeek: only a two-element JSON array of non-empty strings counts.
 *   * `"bare-id"` — Claude / Codex / Cursor: the select value *is* the model id (`haiku`, `gpt-5.5`).
 *
 * A provider or model containing a slash is fine inside a JSON pair (`meta-llama/Llama-3-70b`); the
 * qualifier is `provider/model` for display and storage and this is the only place the pair is
 * recovered without splitting on a slash, which is how `AgentModel` is documented to be built.
 */
function decodeModelValue(
  value: string,
  shape: ModelValueShape,
): { provider: string; model: string; id: string } | undefined {
  if (shape === "bare-id") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    // Task stores the bare id; encode() only sends `model`. Sentinel provider matches resolveModelChoice.
    return { provider: "acp", model: trimmed, id: trimmed };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const [provider, model] = parsed as unknown[];
  if (typeof provider !== "string" || typeof model !== "string") return undefined;
  if (provider === "" || model === "") return undefined;
  return { provider, model, id: modelIdFor(provider, model) };
}

/** The model option in a record, by category first and by id second (see `THOUGHT_LEVEL_CATEGORY`). */
function findOption(
  options: readonly ObservedSessionOption[],
  category: string,
  configId: string,
): ObservedSessionOption | undefined {
  return options.find((option) => option.category === category) ?? options.find((option) => option.configId === configId);
}

/** How this harness spells model select values — json-pair unless the delivery says bare-id. */
function valueShapeFor(id: HarnessId): ModelValueShape {
  const delivery = HARNESS_MODEL_DELIVERY[id];
  return delivery?.kind === "session-config" ? delivery.valueShape : "json-pair";
}

/** The models an observed record actually yields, which is `[]` when its values are not model pairs. */
function observedModels(id: HarnessId, options: readonly ObservedSessionOption[]): AgentModel[] {
  const option = findOption(options, MODEL_CATEGORY, "model");
  if (option === undefined) return [];
  const shape = valueShapeFor(id);
  const out: AgentModel[] = [];
  for (const value of option.values) {
    const decoded = decodeModelValue(value.value, shape);
    if (decoded === undefined) continue;
    out.push({
      id: decoded.id,
      label: value.label,
      ...(value.description !== undefined ? { description: value.description } : {}),
      provider: decoded.provider,
      model: decoded.model,
    });
  }
  return out;
}

/* ────────────────────────────── how thinking travels ───────────────────────────── */

/**
 * How this daemon hands a thinking level to an agent — or that it cannot.
 *
 * Only one delivery exists today, and that is a finding rather than an omission: **no agent in this
 * catalogue documents a thinking flag in argv.** `envoy-harness`'s help has `--plan` (a mode), not an
 * effort (`../envoy-harness/packages/envoy-harness/src/cli/argv-help.ts:43`), and its ACP dispatch has
 * no thought-level method at all. An `argv` variant belongs here the day somebody's CLI documents one;
 * inventing a `--thinking` flag now would be the capability this whole control row exists not to fake.
 */
export interface ThinkingDelivery {
  kind: "session-config";
  /** The agent's own config-option id, passed through verbatim. */
  configId: string;
  source: string;
}

/**
 * The thinking wiring, per agent. Absent means **this daemon cannot set one**, and the composer says so
 * on screen instead of offering a pill that would do nothing.
 */
export const HARNESS_THINKING_DELIVERY: Readonly<Partial<Record<HarnessId, ThinkingDelivery>>> = {
  "deepseek-harness": {
    kind: "session-config",
    configId: "reasoning_effort",
    // `REASONING_CONFIG_ID = "reasoning_effort"` (`@deepseek-ai/dsh-acp` 0.1.2-rc.1, `lib/index.js:306`),
    // set through `session/set_config_option {sessionId, configId, value}` (`lib/index.js:388-409`,
    // dispatched at `:1325`). VERIFIED against the real binary: `{"configId":"reasoning_effort","value":"max"}`
    // was accepted and the resulting option state came back with `max` as the current value, while an
    // unknown level came back `-32602 Invalid params: unknown reasoning effort for …`.
    source:
      "packages/acp/acp/src/index.ts:388 (session/set_config_option); the option id is " +
      'REASONING_CONFIG_ID = "reasoning_effort" and its category is "thought_level" ' +
      "(@deepseek-ai/dsh-acp 0.1.2-rc.1, lib/index.js:306, :494-508).",
  },
};

/**
 * Shared by every entry this build cannot launch: see the doc below.
 *
 * Declared before the table that uses it because a `const` is in its temporal dead zone until its own
 * statement runs, and a table that read it earlier would throw at module load — the same failure mode a
 * missing `exports` entry produces, and just as unclear from the symptom.
 */
const NOT_LAUNCHABLE =
  "unverified: this entry's thought-level surface has not been read, and `isDrivableByAcpAdapter` " +
  "refuses to launch it, so no session can be observed. Recorded as \"session\" rather than \"none\" " +
  "on purpose — saying an agent has no thinking levels when we have not looked would be a claim about " +
  "somebody else's product, and this catalogue's rule is to admit ignorance instead.";

/**
 * What each agent offers for its thinking level, **before any session has been observed**.
 *
 * One entry per harness, because a missing key would be a fourth state ("nobody wrote this down") that
 * a client cannot tell from the three real ones.
 *
 * The two natives are answered from their own sources, and the difference between them is the whole
 * reason `kind: "none"` exists:
 *
 *   * **`deepseek-harness`** publishes its levels per session, in the `session/new` response, next to
 *     its model — so before a session exists there is nothing to show and `"session"` says exactly
 *     that. Verified against the real binary (see `HARNESS_THINKING_DELIVERY`).
 *   * **`envoy-harness`** has no thought-level surface at all: its ACP dispatch handles
 *     `session/set_model`, `session/set_policy` and `session/set_mode`, and nothing else of the kind
 *     (`../envoy-harness/src/protocol/acp-server.ts:294-310, 431`), and its `session/new` answers
 *     `{sessionId}` with no `configOptions` at all. VERIFIED against the built peer over a real pipe:
 *     `session/set_config_option` came back `-32601 method not found: session/set_config_option`. So
 *     the pill is disabled with that reason, which is the outcome the design asks for: not a guess.
 *
 * The third-party CLIs that this build **cannot launch** get `"session"` rather than `"none"`, and that
 * is a deliberate refusal to make a claim about somebody else's product: their thought-level surface has
 * not been read, and `isDrivableByAcpAdapter` refuses to launch them, so no session can ever be observed.
 * Their `capabilities.thinking` is false, so the reason on screen is ours ("not wired up yet") rather than
 * a statement about the agent.
 *
 * The three agents reached over ACP — `claudecode`, `codex`, `cursor` — also get `"session"`, and there
 * it means something stronger: a session **is** observable, so the record will fill in, and what each
 * entry's `source` carries is what was seen on the wire. None of the three has a delivery yet, which is
 * a fact about our build: the pill is disabled with our reason even while the values behind it are the
 * agent's own.
 */
export const HARNESS_THINKING: Readonly<Record<HarnessId, AgentThinking>> = {
  "envoy-harness": {
    kind: "none",
    options: [],
    source:
      "No thought-level method exists in the peer's ACP dispatch: acp-server.ts handles " +
      "session/set_model, session/set_policy and session/set_mode and nothing of the kind " +
      "(../envoy-harness/packages/envoy-harness/src/protocol/acp-server.ts:294-310, :431), and its " +
      "session/new answers {sessionId} with no configOptions. VERIFIED against the built peer: " +
      "session/set_config_option → -32601 \"method not found: session/set_config_option\". Its CLI " +
      "documents --plan (a mode) and --provider/--model, and no effort flag (cli/argv-help.ts:23-24, :43).",
  },

  "deepseek-harness": {
    kind: "session",
    options: [],
    source:
      "Published per session, in the session/new response, as an ACP select in the thought_level " +
      'category: {id: "reasoning_effort", name: "Reasoning effort", category: "thought_level"} with ' +
      "the values the resolved model supports (@deepseek-ai/dsh-acp 0.1.2-rc.1, lib/index.js:494-508). " +
      "VERIFIED against the real dsh --profile acp: off | low | high | max, each with its own name and " +
      'description. Per session AND per model — the option is built from `info.reasoning` for the ' +
      "current route — which is why the window says when it saw these rather than promising them.",
  },

  // The three agents this build now drives over ACP. Their thought-level surface was **observed**, and
  // none of the three has a delivery wired, which is a different fact from "it offers none" — so each
  // says what was actually seen and the window's disabled pill is honest for a reason about *our* build.
  claudecode: {
    kind: "session",
    options: [],
    source:
      "Published per session, and NOT yet wired as a delivery: `session/new` answers with an option " +
      "whose category is `thought_level` — {id: 'effort', name: 'Effort'} with default | low | medium | " +
      "high | xhigh | max — observed 2026-09-14 through @agentclientprotocol/claude-agent-acp 0.77.0. " +
      "`effort` was read, not exercised: whether `session/set_config_option {configId: 'effort'}` " +
      "accepts one of those values is the next thing to check, and until it is checked the pill stays " +
      "disabled rather than sending a level whose effect nobody measured.",
  },
  codex: {
    kind: "session",
    options: [],
    source:
      "Published per session, and only **after a model is set** — which is why no static answer can be " +
      "given: on a fresh session through @agentclientprotocol/codex-acp 1.11.0 the option list held " +
      "`mode`, `collaboration_mode` and `model`, and the `reasoning_effort` select (category " +
      "`thought_level`, values low | medium | high | xhigh) appeared in the state returned by " +
      "`session/set_config_option {configId: 'model'}`. Same shape as `deepseek-harness`'s: the levels " +
      "belong to the model that was resolved. No delivery is wired, so the pill is disabled with a " +
      "reason about our build rather than about the agent.",
  },
  cursor: {
    kind: "session",
    options: [],
    source:
      "Observed: a session opened through `cursor-agent acp` (2026.06.24) published `mode` and `model` " +
      "and **no** option in the `thought_level` category; its reasoning depth travels inside the model " +
      "ids instead (`grok-4.6[effort=high,fast=true]`). Recorded as \"session\" rather than \"none\" " +
      "because this is one observation of one build, and the honest claim is what we saw.",
  },

  // The catalogued CLIs: not "none", because we have not read their thought-level surface — and they
  // cannot be launched, so nothing will ever be observed for them. `capabilities.thinking` is false,
  // so the window's reason is about our build rather than about the agent.
  copilot: { kind: "session", options: [], source: NOT_LAUNCHABLE },
  opencode: { kind: "session", options: [], source: NOT_LAUNCHABLE },
  omp: { kind: "session", options: [], source: NOT_LAUNCHABLE },
  pi: { kind: "session", options: [], source: NOT_LAUNCHABLE },
};

/** How a thinking level reaches this agent, or `undefined` when this daemon cannot deliver one. */
export function thinkingDelivery(id: HarnessId): ThinkingDelivery | undefined {
  return HARNESS_THINKING_DELIVERY[id];
}

/**
 * What an agent offers for its thinking level, before any session is taken into account.
 *
 * Total, like `harnessModels`: every id has an entry, so no caller has to decide what a missing one
 * would mean — and a missing one would be the fourth state this whole design exists to avoid.
 */
export function harnessThinking(id: HarnessId): AgentThinking {
  return HARNESS_THINKING[id];
}

/** Can the daemon set this agent's thinking level? The flag the composer's pill is enabled on. */
export function canApplyThinking(id: HarnessId): boolean {
  return HARNESS_THINKING_DELIVERY[id] !== undefined;
}

/* ────────────────────────────── the answer a harness gets ───────────────────────────── */

/**
 * What an agent publishes, **with the last session's observation preferred over the catalogue**.
 *
 * One function for both facts, because they come from one observation: a session states its model
 * options and its thinking level in the same response, at the same instant, and splitting the
 * resolution would let the two carry different timestamps for one event.
 *
 * The precedence rules are not symmetric, and the asymmetry is real rather than convenient:
 *
 *   * **thinking** — an observation is the *only* source of values, so a recorded session answers the
 *     question outright: its `thought_level` values if it published any, and `"none"` if it published
 *     none. That second case is not the same claim as the catalogue's `"none"` for `envoy-harness`, and
 *     both are true statements of the same shape: "this agent offered nothing".
 *   * **models** — an observation informs the answer only when it yields model pairs. When it does not
 *     (the agent published no model option, or published values we cannot take apart), the catalogue's
 *     own answer stands **untouched, with no `observedAt`**: `envoy-harness` takes its model in argv
 *     and its list is published in its source, so a session that says nothing about models has not
 *     contradicted it, and stamping the static list with a session's time would attach a promise to a
 *     fact that came from somewhere else.
 */
export function sessionFacts(
  id: HarnessId,
  observed: ObservedSessionOptions | undefined,
): { models: AgentModels; thinking: AgentThinking } {
  const staticModels = HARNESS_MODELS[id];
  const staticThinking = HARNESS_THINKING[id];

  if (observed === undefined) return { models: staticModels, thinking: staticThinking };

  const at = observed.observedAt;
  const models = observedModels(id, observed.options);
  const shape = valueShapeFor(id);
  const resolvedModels: AgentModels =
    models.length > 0
      ? {
          kind: "listed",
          options: models,
          source:
            `Observed from a session this daemon opened at ${at}: the agent's own ` +
            `${MODEL_CATEGORY} option enumerated ${models.length} model(s), and each value was decoded ` +
            (shape === "bare-id"
              ? "as a bare ACP model id (Claude / Codex / Cursor select values). "
              : "with the inverse of the encoding SessionModelConfig builds (JSON.stringify([provider, model])). ") +
            "A session's catalog is per machine and per credential, which is why the window prints the time.",
          observedAt: at,
        }
      : staticModels;

  const thought = findOption(observed.options, THOUGHT_LEVEL_CATEGORY, "reasoning_effort");
  const thinking: AgentThinking =
    thought === undefined || thought.values.length === 0
      ? {
          kind: "none",
          options: [],
          source:
            `Observed: the session opened at ${at} published no option in the ` +
            `${THOUGHT_LEVEL_CATEGORY} category, so this agent offers no thinking level over the ` +
            "protocol we speak to it.",
          observedAt: at,
        }
      : {
          kind: "listed",
          options: thought.values,
          source:
            `Observed from a session this daemon opened at ${at}: the agent's own ` +
            `"${thought.configId}" select (category ${THOUGHT_LEVEL_CATEGORY}, labelled ` +
            `"${thought.label}") enumerated ${thought.values.length} value(s). The list is built from ` +
            "the model that session resolved, so it describes the model this agent last ran on.",
          observedAt: at,
        };

  return { models: resolvedModels, thinking };
}
