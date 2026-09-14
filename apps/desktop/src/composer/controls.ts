/**
 * What the composer shows, derived from **the agent the run is using**.
 *
 * The input area is the one screen every agent has to share, and agents differ: Claude offers
 * `plan`/`acceptEdits`/`bypassPermissions`, Codex `auto-review`/`full-access`, OpenCode `build`/`plan`,
 * Pi none at all. Some can cancel, some can ask us for approval, some can take an image. A composer
 * with a fixed set of controls therefore lies about at least one agent at all times — which is what ours
 * did, with a bare Queue/Steer select and no notion of the agent at all.
 *
 * This module is the *decision*, kept away from the rendering so it can be tested without a DOM: given
 * what the wire says about an agent (`coder.listHarnesses` now carries `modes`) and what the run is
 * doing, it returns the controls to draw, the send button's behaviour and label, and — for anything the
 * agent offers that we cannot yet honour — a **reason** rather than a hidden control.
 *
 * ## The three rules it encodes, each with a source
 *
 *   1. **An approval in flight forces `interrupt`.** Paseo does exactly this
 *      (`resolveActiveSendBehavior`), because a queued message behind a permission prompt is stranded:
 *      the turn is parked until somebody answers. See `docs/paseo-design-decisions.md`.
 *   2. **The send label states what will happen**, never just "Send": `Interrupt agent` while a turn
 *      runs, `Queue message` when it will wait, `Send and steer` when it joins.
 *   3. **A control we cannot honour is disabled with a reason, not hidden.** The mode picker is the
 *      live example: the agent's modes and whether the daemon can *set* one both travel on the wire
 *      (`HarnessSummary.modes` and `.capabilities.agentMode`), and the picker is enabled only when
 *      both say yes — otherwise it is off, with the reason rendered in the user's language.
 */

import { isMessageKey, type MessageKey } from "../i18n/messages/en.js";

/** The facts about one agent, straight from `coder.listHarnesses`. */
export interface ComposerAgent {
  id: string;
  label: string;
  modes: readonly ComposerMode[];
  /**
   * What this agent publishes about its models, and what an empty list means.
   *
   * `undefined` is **not** "no models" — it is "nobody has told us", which is a different sentence on
   * screen and a different control. The three real states (and the reason the empty list is safe) are
   * `AgentModels.kind`'s: `"listed"`, `"free-text"`, `"none"`.
   */
  models?: ComposerModels | undefined;
  capabilities: {
    resume: boolean;
    cancel: boolean;
    approvals: boolean;
    structuredTools: boolean;
    streaming: boolean;
    images: boolean;
  };
  available: boolean | "unknown";
  /** Why it cannot be used, when it cannot. */
  unavailableReason?: string;
  /**
   * Can this daemon *apply* a mode it is given?
   *
   * The caller sets this from the wire (`HarnessSummary.capabilities.agentMode`), and it is kept as its
   * own field here — rather than read out of `capabilities` — because there is exactly one answer this
   * module is allowed to branch on, and it is the flag the picker's honesty turns on. `undefined` means
   * "nobody told us", which is treated as **no**: a control whose wiring we cannot prove is off, with
   * the reason shown.
   */
  modesApplicable?: boolean;
  /**
   * Can this daemon *make* a chosen model the one the agent runs on?
   *
   * The model's half of `modesApplicable`, from `HarnessSummary.capabilities.model`, and separate from
   * `models` for the same reason: an agent can publish a list this build still has no way to deliver
   * to, and enabling the control on a list alone would offer a choice that is dropped. `undefined` is
   * again **no**.
   */
  modelApplicable?: boolean;
}

/**
 * One model, as the control needs it.
 *
 * The three parts are the wire's (`AgentModel`): `id` is provider-qualified and is what the task
 * stores, `label` is what the user reads, and `provider`/`model` are already taken apart so nothing
 * downstream has to split the id — which gets ids containing a slash wrong.
 */
export interface ComposerModel {
  id: string;
  label: string;
  description?: string;
  provider: string;
  model: string;
}

/** What an agent publishes about its models — `AgentModels`, restated for this module. */
export interface ComposerModels {
  kind: "listed" | "free-text" | "none";
  options: readonly ComposerModel[];
  /** Where the answer came from. For maintainers; never rendered. */
  source: string;
}

/** One mode, as the picker needs it. `labelKey`/`descriptionKey` are ours; the rest is the agent's. */
export interface ComposerMode {
  id: string;
  label: string;
  description?: string;
  /** Set when the wording is ours rather than the agent's — see `modeLabel`. */
  labelKey?: string;
  descriptionKey?: string;
  unattended?: boolean;
}

export interface ComposerState {
  /** Is a turn running right now? */
  running: boolean;
  /** Is an approval waiting for an answer? */
  approvalPending: boolean;
}

/** What sending will do. `interrupt` is the forced one. */
export type SendBehaviour = "send" | "queue" | "steer" | "interrupt";

export interface ComposerControl {
  /** A stable id the component can key on. */
  kind: "agent" | "mode" | "model" | "cancel" | "approvals" | "images";
  label: string;
  enabled: boolean;
  /**
   * Present when `enabled` is false, and always user-facing: it is shown, not logged.
   *
   * English, and the *same sentence* as `reasonKey`'s catalogue entry — the arrangement
   * `folder-picker.ts` explains: this module is also called by code with no translator (a script, a
   * future CLI), while a window renders the key in the user's language and picks it by
   * `reasonKey`, never by comparing prose.
   */
  reason?: string;
  /** The catalogue key for `reason`. Absent only for a reason that is not ours to word. */
  reasonKey?: MessageKey;
  /** The values `reasonKey`'s template needs. */
  reasonValues?: Record<string, string | number>;
}

export interface ComposerControls {
  agent: { id: string; label: string; available: boolean };
  mode: {
    options: readonly ComposerMode[];
    selected: string | null;
    enabled: boolean;
    reason?: string;
    reasonKey?: MessageKey;
    reasonValues?: Record<string, string | number>;
  };
  /**
   * The model control, in the three shapes the wire can ask for.
   *
   * `kind` is not derived here from `options.length` — it is carried, because those two facts differ
   * and the difference is the whole point: `"free-text"` with no options is a **usable** control, and
   * a caller that decided "no options means no control" would disable a feature the agent supports.
   * `enabled` is the single answer to "may the user change this?", so there is one flag rather than two
   * that can disagree.
   */
  model: {
    kind: "listed" | "free-text" | "none";
    options: readonly ComposerModel[];
    selected: string | null;
    enabled: boolean;
    reason?: string;
    reasonKey?: MessageKey;
    reasonValues?: Record<string, string | number>;
  };
  send: { behaviour: SendBehaviour; label: string; enabled: boolean; reason?: string };
  /** The controls the agent's capabilities allow, in the order a composer should draw them. */
  controls: ComposerControl[];
  /** Anything worth telling the user about this agent, in their language. */
  notes: string[];
}

/**
 * A mode's label in the user's language.
 *
 * A catalogue mode carries `labelKey` only when the wording is **ours** — the three `envoy-harness`
 * modes are its `ModeKind`, and we wrote their labels, so they are ours to translate. A mode an agent
 * named itself arrives with no key and is shown exactly as the agent wrote it, which is the same rule
 * the approval prompt's option labels follow.
 *
 * The key is checked rather than trusted: `HarnessSummary` comes off the wire, so a daemon one version
 * ahead can send a key this window's catalogue does not have, and `mode.plan.label` on screen is worse
 * than the English sentence.
 */
export function modeLabel(mode: ComposerMode, t: (key: MessageKey) => string): string {
  return mode.labelKey !== undefined && isMessageKey(mode.labelKey) ? t(mode.labelKey) : mode.label;
}

/** A mode's one-line explanation, on the same terms as `modeLabel`. */
export function modeDescription(
  mode: ComposerMode | undefined,
  t: (key: MessageKey) => string,
): string | undefined {
  if (mode === undefined) return undefined;
  if (mode.descriptionKey !== undefined && isMessageKey(mode.descriptionKey)) {
    return t(mode.descriptionKey);
  }
  return mode.description;
}

/** Why the mode picker is off: a catalogue key, and the values its template needs. */
export interface ModeOffReason {
  key: MessageKey;
  values?: Record<string, string | number>;
}

/** Why the model control is off. The same pair, for the same reason. */
export type ModelOffReason = ModeOffReason;

/**
 * Which reason leaves the mode picker off — or nothing, when it works.
 *
 * Three facts produce a disabled picker and they are **not interchangeable**, so this is the one place
 * that decides between them:
 *
 *   * `known` is false — nothing has told us what this agent offers yet. Our ignorance, and the one a
 *     naive implementation turns into "this agent has no modes", which is a claim about somebody else's
 *     product that we are in no position to make.
 *   * the agent declares none — a fact about the agent.
 *   * the daemon cannot set one — a fact about our adapter.
 *
 * Returning `undefined` is the contract for "the control works": the caller enables the picker exactly
 * when this is `undefined`, so there is one answer rather than two that can disagree.
 */
export function modeOffReason(
  decision: { enabled: boolean; reasonKey?: MessageKey; reasonValues?: Record<string, string | number> },
  input: { known: boolean; agent: string },
): ModeOffReason | undefined {
  if (decision.enabled) return undefined;
  if (!input.known) return { key: "task.composer.agentMode.unknown", values: { agent: input.agent } };
  return decision.reasonKey
    ? { key: decision.reasonKey, values: decision.reasonValues ?? { agent: input.agent } }
    : undefined;
}

/**
 * Which reason leaves the model control off — or nothing, when it works.
 *
 * `modeOffReason`'s twin, and it exists for the same reason: the three facts that produce a disabled
 * control are not interchangeable, and only the first is a fact about the agent.
 *
 *   * `known` is false — the harness list has not arrived. Our ignorance.
 *   * the agent takes no model — `kind: "none"`, which is a fact about the agent and the only state
 *     that means "there is nothing to set".
 *   * the daemon cannot deliver one — a fact about our adapter.
 *
 * The middle case is where the value-level rule lives, and it is worth restating where the branch is:
 * **`options` being empty is never the test.** A `"free-text"` agent has no options and a control that
 * works, so a caller that asked `options.length === 0` here would disable exactly the feature this
 * slice exists to add. The test is `kind === "none"`.
 *
 * Returning `undefined` is the contract for "the control works", the same contract `modeOffReason`
 * has: the caller enables it exactly when this is `undefined`.
 */
export function modelOffReason(
  decision: {
    kind: "listed" | "free-text" | "none";
    enabled: boolean;
    reasonKey?: MessageKey;
    reasonValues?: Record<string, string | number>;
  },
  input: { known: boolean; agent: string },
): ModelOffReason | undefined {
  if (decision.enabled) return undefined;
  if (!input.known) return { key: "task.composer.model.unknown", values: { agent: input.agent } };
  if (decision.kind === "none") {
    return { key: "task.composer.model.none", values: { agent: input.agent } };
  }
  return decision.reasonKey
    ? { key: decision.reasonKey, values: decision.reasonValues ?? { agent: input.agent } }
    : undefined;
}

/**
 * The note under the model control, when it is not a refusal.
 *
 * Two cases, and the point is that they differ:
 *
 *   * **free text** — the sentence naming the `provider/model` shape and where the provider name comes
 *     from. That sentence is what makes the control usable rather than merely present: it turns "we have
 *     no list" into an instruction, and without it the user has a field and no way to know what the
 *     agent will accept.
 *   * **a list** — nothing. The options are self-explanatory, and a line repeating the label is noise.
 *
 * A disabled control gets its reason instead (`modelOffReason`), and this returns `undefined` there, so
 * the two can never both draw a line under the same control.
 */
export function modelNote(
  model: {
    kind: "listed" | "free-text" | "none";
  },
  input: { enabled: boolean },
): MessageKey | undefined {
  if (!input.enabled) return undefined;
  if (model.kind === "free-text") return "task.composer.model.freeText";
  return undefined;
}

/**
 * Is this string a value the model control may hand to the daemon?
 *
 * The daemon refuses what it cannot resolve, so this is not the enforcement layer — it is the layer
 * that decides whether a **free-text** field's contents are worth committing to the task at all while
 * the user is still typing. Committing `deepseek` on the way to `deepseek/deepseek-chat` would save a
 * value that makes the next run refuse, so a half-written value is kept in the field and not saved.
 *
 * `""` is meaningful and is handled by the caller: empty means "the agent's own default", which clears
 * the stored model rather than naming one.
 */
export function looksLikeModelValue(value: string): boolean {
  const slash = value.indexOf("/");
  return slash > 0 && slash < value.length - 1;
}

/**
 * A folder, in the few characters a pill has room for.
 *
 * **Relative to the project first**, because that is the shape the user recognises: a task in a
 * monorepo package is `packages/api`, and the project is already named in the pane's header. A folder
 * that is genuinely elsewhere has no project to be relative to, so it gets the last two segments with a
 * `…` standing for everything the pill cannot show — the whole path is one hover away, in its `title`.
 *
 * Pure and tested, because this is the string a user decides "is my agent in the right repository?"
 * from, and getting it wrong is silent.
 */
export function shortenFolder(cwd: string, projectPath?: string): string {
  const clean = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = projectPath?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root !== undefined && root !== "" && clean !== root && clean.startsWith(`${root}/`)) {
    return clean.slice(root.length + 1);
  }
  const parts = clean.split("/").filter(Boolean);
  if (parts.length <= 2) return cwd;
  return `…/${parts.slice(-2).join("/")}`;
}

/**
 * The send button's text, from the behaviour and the run's state.
 *
 * Paseo's own chain: `Interrupt agent` while loading, `Queue message` when it will wait,
 * `Send and steer` / `Send and interrupt` when it will act on the running turn, `Send message` when
 * nothing is running. Users learn the difference by reading the button, so it has to say it.
 */
export function sendLabel(behaviour: SendBehaviour): string {
  switch (behaviour) {
    case "interrupt":
      return "Interrupt agent";
    case "queue":
      return "Queue message";
    case "steer":
      return "Send and steer";
    case "send":
      return "Send message";
  }
}

/** Which behaviour applies, given the run state and the user's preference. */
export function resolveSendBehaviour(
  state: ComposerState,
  preferred: "queue" | "steer" = "steer",
): SendBehaviour {
  // Rule 1, before the preference and before anything else: with an approval in flight, queueing would
  // park the message behind a turn that is itself parked.
  if (state.approvalPending) return "interrupt";
  if (!state.running) return "send";
  return preferred;
}

export function composerControls(
  agent: ComposerAgent,
  state: ComposerState,
  options: {
    preferred?: "queue" | "steer";
    selectedModeId?: string;
    /** The task's stored model, provider-qualified. Absent means "the agent's own default". */
    selectedModelId?: string;
  } = {},
): ComposerControls {
  const notes: string[] = [];
  const capabilities = agent.capabilities;

  /* ── can we run it at all ── */
  const available = agent.available === true;
  if (!available) {
    notes.push(
      agent.available === "unknown"
        ? `EnvoyCoder has not checked whether ${agent.label} is installed yet.`
        : (agent.unavailableReason ?? `${agent.label} is not installed on this machine.`),
    );
  }

  /* ── the agent's own mode ── */
  const selected = options.selectedModeId ?? agent.modes.find((mode) => mode.unattended !== true)?.id ?? null;
  const modesKnown = agent.modes.length > 0;
  const modeEnabled = modesKnown && agent.modesApplicable === true && available;
  /**
   * Which of the two reasons applies, and it is not a wording choice: an agent with **no** modes has
   * nothing to offer, while an agent with modes we cannot set has something a user can see and cannot
   * yet use. Saying the first when the second is true is how a user concludes the agent has no plan
   * mode — when it has one, and we simply cannot reach it.
   */
  const modeReason = !modesKnown
    ? `${agent.label} does not offer selectable modes.`
    : agent.modesApplicable !== true
      ? `Choosing a mode for ${agent.label} is not wired up yet, so the picker is off rather than silently ignored.`
      : undefined;
  const modeReasonKey: MessageKey | undefined = !modesKnown
    ? "task.composer.agentMode.none"
    : agent.modesApplicable !== true
      ? "task.composer.agentMode.notWired"
      : undefined;

  /* ── the model this task runs on ── */
  /**
   * Unlike the mode, there is nothing to branch on for *availability*: an agent that is not installed
   * still publishes whatever it publishes, and the reason it cannot run is on the agent chip, not on
   * this control. The mode picker takes the same line, and the two agreeing matters more here than
   * either choice alone — a user reading two differently-disabled controls learns a rule that is not
   * ours to teach.
   *
   * What does switch the control off is `modelApplicable`, the daemon saying it cannot deliver the
   * value: a list that cannot be applied is a list we must not offer.
   */
  const models = agent.models;
  const modelKind = models?.kind ?? "none";
  const modelEnabled = models !== undefined && modelKind !== "none" && agent.modelApplicable === true;
  /**
   * Three reasons in a fixed order, because they are three different claims about the world. The
   * `notWired` one is the one a reader is most likely to conflate with `none`: an agent can take a
   * model and we can still have no way to give it one, which is precisely the third-party entries.
   *
   * `models === undefined` produces no key here on purpose — that is the caller's `known: false`, which
   * says "we have not asked yet" and which `modelOffReason` words, because only the caller knows
   * whether the list is absent or the answer is.
   */
  const modelReason = models === undefined
    ? undefined
    : modelKind === "none"
      ? `${agent.label} does not take a model.`
      : agent.modelApplicable !== true
        ? `Choosing a model for ${agent.label} is not wired up yet, so the control is off rather than silently ignored.`
        : undefined;
  const modelReasonKey: MessageKey | undefined = models === undefined
    ? undefined
    : modelKind === "none"
      ? "task.composer.model.none"
      : agent.modelApplicable !== true
        ? "task.composer.model.notWired"
        : undefined;

  /* ── sending ── */
  const behaviour = resolveSendBehaviour(state, options.preferred ?? "steer");
  const sendEnabled = available;
  if (capabilities.approvals && agent.available === true) {
    // A fact worth surfacing: the agent can ask, so a stalled turn may be waiting on the user.
    notes.push(`${agent.label} can ask you before it acts.`);
  }
  if (!capabilities.cancel) {
    notes.push(`EnvoyCoder cannot stop ${agent.label} once it starts.`);
  }

  /* ── the controls the agent's capabilities allow ── */
  const controls: ComposerControl[] = [
    { kind: "agent", label: agent.label, enabled: available, ...(sendEnabled ? {} : { reason: notes[0] }) },
    {
      kind: "mode",
      label: "Mode",
      enabled: modeEnabled,
      ...(modeReason ? { reason: modeReason } : {}),
      ...(modeReasonKey ? { reasonKey: modeReasonKey } : {}),
      ...(modeReasonKey ? { reasonValues: { agent: agent.label } } : {}),
    },
    {
      kind: "model",
      label: "Model",
      enabled: modelEnabled,
      ...(modelReason ? { reason: modelReason } : {}),
      ...(modelReasonKey ? { reasonKey: modelReasonKey } : {}),
      ...(modelReasonKey ? { reasonValues: { agent: agent.label } } : {}),
    },
    {
      kind: "cancel",
      label: "Stop",
      enabled: available && capabilities.cancel && state.running,
      ...(capabilities.cancel ? {} : { reason: `${agent.label} does not support stopping a turn.` }),
    },
    {
      kind: "approvals",
      label: "Approvals",
      enabled: available && capabilities.approvals,
      ...(capabilities.approvals ? {} : { reason: `${agent.label} never asks for approval, so there is nothing to answer.` }),
    },
    {
      kind: "images",
      label: "Attach an image",
      enabled: available && capabilities.images,
      ...(capabilities.images ? {} : { reason: `${agent.label} cannot read images.` }),
    },
  ];

  return {
    agent: { id: agent.id, label: agent.label, available },
    mode: {
      options: agent.modes,
      selected,
      enabled: modeEnabled,
      ...(modeReason ? { reason: modeReason } : {}),
      ...(modeReasonKey ? { reasonKey: modeReasonKey } : {}),
      ...(modeReasonKey ? { reasonValues: { agent: agent.label } } : {}),
    },
    model: {
      kind: modelKind,
      options: models?.options ?? [],
      // What the control shows as chosen: the task's stored model, or nothing, which the control
      // renders as the agent's own default. There is deliberately **no** "first option" fallback —
      // defaulting to a model the user never chose is how a task quietly stops running on the model
      // somebody picked for it last week.
      selected: options.selectedModelId ?? null,
      enabled: modelEnabled,
      ...(modelReason ? { reason: modelReason } : {}),
      ...(modelReasonKey ? { reasonKey: modelReasonKey } : {}),
      ...(modelReasonKey ? { reasonValues: { agent: agent.label } } : {}),
    },
    send: {
      behaviour,
      label: sendLabel(behaviour),
      enabled: sendEnabled,
      ...(sendEnabled ? {} : { reason: notes[0] }),
    },
    controls,
    notes,
  };
}
