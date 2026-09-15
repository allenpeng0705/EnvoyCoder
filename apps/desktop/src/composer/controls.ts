/**
 * What the composer shows, derived from **the agent the run is using**.
 *
 * The input area is the one screen every agent has to share, and agents differ: Claude offers
 * `plan`/`acceptEdits`/`bypassPermissions`, Codex `auto-review`/`full-access`, OpenCode `build`/`plan`,
 * Pi none at all. Some can cancel, some can ask us for approval, some can take an image. A composer
 * with a fixed set of controls therefore lies about at least one agent at all times — which is what ours
 * did, with a bare Queue/Steer select and no notion of the agent at all — and that select is gone now, for the
 * second half of the same reason: two words in a picker, explained only by a tooltip, taught the user nothing
 * (`docs/settings-parity.md` §7.33). The window sends `queue`, the protocol keeps both modes, and a *setting* for
 * the default is where the choice belongs (§8.3's send behaviour).
 *
 * This module is the *decision*, kept away from the rendering so it can be tested without a DOM: given
 * what the wire says about an agent (`coder.listHarnesses` now carries `modes`) and what the run is
 * doing, it returns the controls to draw and — for anything the agent offers that we cannot yet honour —
 * a **reason** rather than a hidden control.
 *
 * ## The two rules it encodes, each with a source
 *
 *   1. **A control we cannot honour is disabled with a reason, not hidden.** The mode picker is the
 *      live example: the agent's modes and whether the daemon can *set* one both travel on the wire
 *      (`HarnessSummary.modes` and `.capabilities.agentMode`), and the picker is enabled only when
 *      both say yes — otherwise it is off, with the reason rendered in the user's language.
 *   2. **What the agent publishes is a property, never a promise.** `observedAt` travels with every list a
 *      session produced, and nothing here invents one.
 *
 * (A third rule stood here — *"the send label states what will happen"*, with `resolveSendBehaviour` and
 * `sendLabel` behind it. Nothing drew it: the composer rendered its own "Send"/"Start" and ignored the
 * result, so the whole chain was reachable only from its own tests, and a Queue/Steer *select* was the only
 * place the choice existed. The select is gone (§7.33) and so is the chain.)
 */

import type { HarnessAvailability } from "@envoycoder/protocol";

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
  /**
   * What this agent offers for its **thinking level**, and which of the three states that is in.
   *
   * The fourth control, and the one whose options exist nowhere but in a session: an agent publishes
   * its thought levels in the `session/new` response, so a catalogue cannot know them and neither can a
   * fixture. `undefined` here means the same thing it means for `models` — nobody has told us — and
   * `kind: "session"` means the agent *does* publish them and we have not seen a session yet. Neither
   * may be rendered as "this agent has none", which is what `kind: "none"` is for.
   */
  thinking?: ComposerThinking | undefined;
  capabilities: {
    resume: boolean;
    cancel: boolean;
    approvals: boolean;
    structuredTools: boolean;
    streaming: boolean;
    images: boolean;
  };
  /**
   * **What this machine can do with this agent**, not just whether a binary was found.
   *
   * The five states (`HarnessAvailability`), because the one sentence this replaces was wrong in four of
   * them: `available: false` rendered as "not installed on this machine" for an agent whose *adapter* was
   * missing, for one this build has no adapter for at all, and for one nobody had looked for. The composer
   * only ever needs `state === "ready"` to decide whether a control is live; the rest of the value is here
   * so the *reason* it shows can name the right missing thing and carry the command that fixes it.
   */
  availability: HarnessAvailability;
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
  /**
   * Can this daemon *set* a chosen thinking level on this agent?
   *
   * From `HarnessSummary.capabilities.thinking`, and separate from `thinking` for the reason the other
   * two flags are separate from their lists: `envoy-harness` offers no thought level at all, while a
   * catalogued CLI could offer one this build has no way to deliver. `undefined` is again **no**.
   */
  thinkingApplicable?: boolean;
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
  /**
   * When these options were observed from a real session, if they were.
   *
   * The one field that lets a caller say *what kind of answer* this is: a list the agent's own source
   * documents, or a list somebody watched it publish last Tuesday. Only the second may be presented as
   * "this is what it offered last time", which is why the timestamp travels with the list rather than
   * being reconstructed from a log.
   */
  observedAt?: string;
}

/**
 * One thinking level, as the picker needs it — `WordedOption` plus the opaque value that travels.
 *
 * `value` is the agent's id, and it is what goes back to it; `label` is what a user reads.
 */
export interface ComposerThinkingOption extends WordedOption {
  value: string;
}

/** What an agent offers for its thinking level — `AgentThinking`, restated for this module. */
export interface ComposerThinking {
  kind: "listed" | "session" | "none";
  options: readonly ComposerThinkingOption[];
  /** When a session published these. Absent when nothing has been observed. */
  observedAt?: string;
  /** Where the answer came from. For maintainers; never rendered. */
  source: string;
}

/** One mode, as the picker needs it. `labelKey`/`descriptionKey` are ours; the rest is the agent's. */
export interface ComposerMode extends WordedOption {
  id: string;
  unattended?: boolean;
}

export interface ComposerState {
  /** Is a turn running right now? */
  running: boolean;
  /** Is an approval waiting for an answer? */
  approvalPending: boolean;
}

export interface ComposerControl {
  /** A stable id the component can key on. */
  kind: "agent" | "mode" | "model" | "thinking" | "cancel" | "approvals" | "images";
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
    /** When a session published this list, so the caller can say so on screen. Never invented here. */
    observedAt?: string;
    reason?: string;
    reasonKey?: MessageKey;
    reasonValues?: Record<string, string | number>;
  };
  /**
   * The thinking control — the model control's shape, one step further out.
   *
   * There is no `free-text` counterpart here, and that is a fact about the two subjects rather than an
   * omission: a model id is a `provider/model` pair a user *can* compose, while a thinking level is an
   * id in the agent's own vocabulary (`off`, `high`, `max`) that nobody outside the agent can guess. So
   * this control has a picker or a reason, never a text field — and never a value we made up.
   */
  thinking: {
    kind: "listed" | "session" | "none";
    options: readonly ComposerThinkingOption[];
    selected: string | null;
    enabled: boolean;
    /** When a session published these, so the caller can say so on screen. Never invented here. */
    observedAt?: string;
    reason?: string;
    reasonKey?: MessageKey;
    reasonValues?: Record<string, string | number>;
  };
  /** The controls the agent's capabilities allow, in the order a composer should draw them. */
  controls: ComposerControl[];
  /** Anything worth telling the user about this agent, in their language. */
  notes: string[];
}

/**
 * Anything a picker shows one row of, and whose words may be **ours** rather than the agent's.
 *
 * The two controls that carry an agent's own vocabulary — a mode and a thinking level — need exactly
 * the same resolution, so the shape and the two functions below are shared rather than copied. The
 * public entry points keep their own names (`modeLabel` for a mode, `optionLabel` for a thinking value)
 * because their parameter is what tells a reader which one they are holding: a mode is identified by
 * `id`, a thinking level by `value`, and those two must not be confused on the wire.
 */
export interface WordedOption {
  label: string;
  description?: string;
  /** Set only when the wording is **ours**, and then it is the catalogue key of our own sentence. */
  labelKey?: string;
  descriptionKey?: string;
}

/**
 * A picker row's label in the user's language.
 *
 * A catalogue entry carries `labelKey` only when the wording is **ours** — the three `envoy-harness`
 * modes are its `ModeKind`, and we wrote their labels, so they are ours to translate. A label an agent
 * wrote itself (`Plan`, `Off`, `Max`) arrives with no key and is shown exactly as the agent wrote it,
 * which is the same rule the approval prompt's option labels follow.
 *
 * The key is checked rather than trusted: `HarnessSummary` comes off the wire, so a daemon one version
 * ahead can send a key this window's catalogue does not have, and `mode.plan.label` on screen is worse
 * than the English sentence.
 */
function wordedLabel(option: WordedOption, t: (key: MessageKey) => string): string {
  return option.labelKey !== undefined && isMessageKey(option.labelKey)
    ? t(option.labelKey)
    : option.label;
}

/** A picker row's one-line explanation, on the same terms as `wordedLabel`. */
function wordedDescription(
  option: WordedOption | undefined,
  t: (key: MessageKey) => string,
): string | undefined {
  if (option === undefined) return undefined;
  if (option.descriptionKey !== undefined && isMessageKey(option.descriptionKey)) {
    return t(option.descriptionKey);
  }
  return option.description;
}

/** A mode's label in the user's language. See `wordedLabel` for the rule and `optionLabel` for its twin. */
export function modeLabel(mode: ComposerMode, t: (key: MessageKey) => string): string {
  return wordedLabel(mode, t);
}

/** A mode's one-line explanation, on the same terms as `modeLabel`. */
export function modeDescription(
  mode: ComposerMode | undefined,
  t: (key: MessageKey) => string,
): string | undefined {
  return wordedDescription(mode, t);
}

/**
 * A thinking level's label, on exactly the mode's terms.
 *
 * A separate name rather than a shared one because the *shape* differs: a level is identified by the
 * opaque `value` that travels back to the agent, a mode by its `id`. Nothing in this build sets
 * `labelKey` on a level — every value we can show is the agent's own word for it — so this resolves the
 * agent's label today and would translate ours the day a catalogue entry names its own levels.
 */
export function optionLabel(option: ComposerThinkingOption, t: (key: MessageKey) => string): string {
  return wordedLabel(option, t);
}

/** A thinking level's one-line explanation, on the same terms as `optionLabel`. */
export function optionDescription(
  option: ComposerThinkingOption | undefined,
  t: (key: MessageKey) => string,
): string | undefined {
  return wordedDescription(option, t);
}

/** Why the mode picker is off: a catalogue key, and the values its template needs. */
export interface ModeOffReason {
  key: MessageKey;
  values?: Record<string, string | number>;
}

/** Why the model control is off. The same pair, for the same reason. */
export type ModelOffReason = ModeOffReason;

/** Why the thinking control is off. The same pair again — one shape for all three controls. */
export type ThinkingOffReason = ModeOffReason;

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
    observedAt?: string;
  },
  input: { enabled: boolean },
): MessageKey | undefined {
  if (!input.enabled) return undefined;
  if (model.kind === "free-text") return "task.composer.model.freeText";
  // The third case, and the one this control gained with the observation channel: a list a real session
  // published is a **record rather than a promise**, and the sentence that says so names the time. The
  // two cases cannot both apply — a list we observed is `"listed"` by construction — so the order here
  // is a reading order rather than a precedence.
  if (model.observedAt !== undefined) return "task.composer.model.observed";
  return undefined;
}

/**
 * The note under the thinking control, when it is not a refusal.
 *
 * `modelNote`'s twin, down to the contract: a *disabled* control gets its reason line and no note, so
 * the two can never both draw a sentence under one pill and leave a user to work out which applies.
 *
 * The one note this control has is the observation — the levels a real session published, which the
 * caller must then say out loud *with the time it saw them*, because a level is derived from the model
 * that session resolved and the list can therefore change.
 */
export function thinkingNote(
  thinking: { observedAt?: string },
  input: { enabled: boolean },
): MessageKey | undefined {
  if (!input.enabled) return undefined;
  return thinking.observedAt !== undefined ? "task.composer.thinking.observed" : undefined;
}

/**
 * Which reason leaves the thinking control off — or nothing, when it works.
 *
 * `modelOffReason`'s twin, and the same three-facts argument, with one twist that is the reason this
 * control needed its own reasoning at all:
 *
 *   * `known` is false — the harness list has not arrived. Our ignorance.
 *   * the agent offers none — `kind: "none"`, a fact about the agent, recorded from its source or from a
 *     session that published nothing.
 *   * anything else that leaves it off — and here that is **two** distinct facts, which is why the caller
 *     puts them in `reasonKey` rather than here: the agent publishes levels we have not seen yet
 *     (`"session"`, our ignorance again, worded differently because the user can *fix* this one by
 *     running the agent), and this build cannot deliver a level to it at all (our adapter).
 *
 * The order is not arbitrary: `"none"` is checked before the caller's key, because an agent that offers
 * nothing would otherwise be described as "not wired up yet" — telling a user we have work to do when the
 * truth is that there is nothing to wire.
 *
 * Returning `undefined` is the contract for "the control works", the same one `modeOffReason` and
 * `modelOffReason` have, so the caller enables it exactly when this is `undefined`.
 */
export function thinkingOffReason(
  decision: {
    kind: "listed" | "session" | "none";
    enabled: boolean;
    reasonKey?: MessageKey;
    reasonValues?: Record<string, string | number>;
  },
  input: { known: boolean; agent: string },
): ThinkingOffReason | undefined {
  if (decision.enabled) return undefined;
  if (!input.known) return { key: "task.composer.thinking.unknown", values: { agent: input.agent } };
  if (decision.kind === "none") {
    return { key: "task.composer.thinking.none", values: { agent: input.agent } };
  }
  return decision.reasonKey
    ? { key: decision.reasonKey, values: decision.reasonValues ?? { agent: input.agent } }
    : undefined;
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
 * **Where this task runs, in the few characters a chip has room for** — the header's location control.
 *
 * Three cases, and the third is why this is a function rather than a `.label ?? basename(cwd)`:
 *
 *   * the task runs in its project's own folder → the project's label, which is the name the user gave it;
 *   * the task runs *inside* the project (a monorepo package, a worktree checked out under it) → the project's
 *     label **and the part below it** (`payments-api/packages/api`). The header's chip is the only place naming
 *     the project, so a relative path with the project dropped would leave a reader unable to tell where they are;
 *   * anywhere else → the last two segments with a leading ellipsis, because a chip cannot show a path and the end
 *     of one is what a reader recognises.
 *
 * The whole path is always in the chip's `title`, so nothing is hidden by the shortening — and this is the rule
 * the composer's old folder pill used, moved to the header along with the control (§7.32).
 */
export function taskLocationLabel(cwd: string, project: { label: string; path: string } | undefined): string {
  if (project === undefined) return shortenFolder(cwd, undefined);
  const clean = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = project.path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (clean === root) return project.label;
  if (root !== "" && clean.startsWith(`${root}/`)) return `${project.label}/${clean.slice(root.length + 1)}`;
  return shortenFolder(cwd, undefined);
}

export function composerControls(
  agent: ComposerAgent,
  state: ComposerState,
  options: {
    selectedModeId?: string;
    /** The task's stored model, provider-qualified. Absent means "the agent's own default". */
    selectedModelId?: string;
    /** The task's stored thinking level. Absent means "the agent's own default". */
    selectedThinkingLevel?: string;
  } = {},
): ComposerControls {
  const notes: string[] = [];
  const capabilities = agent.capabilities;

  /* ── can we run it at all ── */
  /**
   * **One sentence per state, and each names the thing that is actually missing.**
   *
   * This is the second half of the bug the catalogue's `agentBinaries` fixes: the old code had two
   * sentences for five situations, so "Claude Code is not installed on this machine" was shown to a user
   * who had installed it, because what was missing was the ACP bridge — a package they had never been told
   * about. A `notes` entry is what the composer shows under the send button, so the wrong noun here is the
   * wrong noun in the place a user reads before typing.
   *
   * `needs-bridge` carries the command, because a state whose whole content is "something is missing" and
   * which does not say what to run is the sentence this repository refuses to ship.
   */
  const available = agent.availability.state === "ready";
  if (!available) {
    const fix = agent.availability.fix?.[0]?.command;
    notes.push(
      agent.availability.state === "unknown"
        ? `EnvoyCoder could not tell whether ${agent.label} is installed — nothing here is a statement about the agent.`
        : agent.availability.state === "unsupported"
          ? `${agent.label} is installed, but it speaks a protocol EnvoyCoder cannot drive yet.`
          : agent.availability.state === "needs-bridge"
            ? `${agent.label} is installed, but the program EnvoyCoder drives it through is missing` +
              (fix ? `: ${fix}` : ".")
            : `${agent.label} is not installed on this machine.` + (fix ? ` ${fix}` : ""),
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

  /* ── how much the agent thinks ── */
  /**
   * The fourth control, and the one with the most ways to be *ignorant* rather than wrong.
   *
   * Its options are per session, so there are three states and two of them are not the agent's fault:
   *
   *   * `thinking === undefined` — the harness list has not arrived. `known: false` at the caller, and
   *     no `reasonKey` here on purpose, exactly as for the model.
   *   * `kind: "session"` — the agent publishes its levels only inside a session and we have not seen
   *     one. **This is our ignorance**, and it is the state a careless implementation renders as "this
   *     agent has no thinking levels", which one run disproves.
   *   * `kind: "none"` — the agent offers none, recorded from its own source (verified for
   *     `envoy-harness`) or observed (a session that published no such option). The only state that is
   *     a fact about the agent.
   *
   * `availability` is deliberately **not** part of `thinkingEnabled`, which is the line the model
   * control already takes and for the same reason: an agent that is not installed still publishes what
   * it publishes, and the reason it cannot run is on the agent chip and the send button, not on a
   * control whose whole job is to say what the agent offers. The two option-bearing controls agreeing
   * matters more here than either choice alone.
   */
  const thinking = agent.thinking;
  const thinkingKind = thinking?.kind ?? "none";
  const thinkingEnabled = thinkingKind === "listed" && agent.thinkingApplicable === true;
  const thinkingReason = thinking === undefined
    ? undefined
    : thinkingKind === "none"
      ? `${agent.label} does not offer a thinking level.`
      : agent.thinkingApplicable !== true
        ? `Choosing how much ${agent.label} thinks is not wired up yet, so the control is off rather than silently ignored.`
        : thinkingKind === "session"
          ? `EnvoyCoder has not opened a session with ${agent.label} yet, and ${agent.label} only lists its thinking levels inside a session — so there is nothing to choose from until it has run once.`
          : undefined;
  const thinkingReasonKey: MessageKey | undefined = thinking === undefined
    ? undefined
    : thinkingKind === "none"
      ? "task.composer.thinking.none"
      : agent.thinkingApplicable !== true
        ? "task.composer.thinking.notWired"
        : thinkingKind === "session"
          ? "task.composer.thinking.notSeen"
          : undefined;

  /* ── sending ── */
  if (capabilities.approvals && available) {
    // A fact worth surfacing: the agent can ask, so a stalled turn may be waiting on the user.
    notes.push(`${agent.label} can ask you before it acts.`);
  }
  if (!capabilities.cancel) {
    notes.push(`EnvoyCoder cannot stop ${agent.label} once it starts.`);
  }

  /* ── the controls the agent's capabilities allow ── */
  const controls: ComposerControl[] = [
    { kind: "agent", label: agent.label, enabled: available, ...(available ? {} : { reason: notes[0] }) },
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
      kind: "thinking",
      label: "Thinking",
      enabled: thinkingEnabled,
      ...(thinkingReason ? { reason: thinkingReason } : {}),
      ...(thinkingReasonKey ? { reasonKey: thinkingReasonKey } : {}),
      ...(thinkingReasonKey ? { reasonValues: { agent: agent.label } } : {}),
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
      // Passed through so the caller can say *when* the agent listed these, which is the difference
      // between "these are the models it publishes" and "these are what it offered last Tuesday".
      ...(models?.observedAt !== undefined ? { observedAt: models.observedAt } : {}),
      ...(modelReason ? { reason: modelReason } : {}),
      ...(modelReasonKey ? { reasonKey: modelReasonKey } : {}),
      ...(modelReasonKey ? { reasonValues: { agent: agent.label } } : {}),
    },
    thinking: {
      kind: thinkingKind,
      // **One option is filtered, and it is not a value we are dropping.** `deepseek-harness` publishes
      // `{value: "", name: "Provider default"}` when the resolved provider has no default effort of its
      // own (`@deepseek-ai/dsh-acp` `lib/index.js:307`, `:502-508`), and that is the *same state* as the
      // control's own first option: nothing is sent, and the agent decides. Offering both would put two
      // rows meaning one thing in the picker — and two options with the same `value=""` in one `<select>`
      // is a control whose selection cannot be read back. Ours wins because it is the one a user can also
      // reach on an agent that publishes no such value at all, and because it is the one we translate.
      options: (thinking?.options ?? []).filter(option => option.value !== ""),
      // The task's stored level, or nothing — which the control renders as the agent's own default.
      // The same rule as the model's, for the same reason: there is no "first option" fallback, because
      // defaulting to a level nobody chose is how a task quietly starts thinking less than its user
      // asked for on a machine that happens to list its levels in another order.
      selected: options.selectedThinkingLevel ?? null,
      enabled: thinkingEnabled,
      ...(thinking?.observedAt !== undefined ? { observedAt: thinking.observedAt } : {}),
      ...(thinkingReason ? { reason: thinkingReason } : {}),
      ...(thinkingReasonKey ? { reasonKey: thinkingReasonKey } : {}),
      ...(thinkingReasonKey ? { reasonValues: { agent: agent.label } } : {}),
    },
    controls,
    notes,
  };
}
