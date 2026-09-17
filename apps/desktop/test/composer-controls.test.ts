/**
 * The composer's controls, per agent.
 *
 * The claim under test is the one the product was failing: the input area adapts to the agent you chose,
 * and anything it *cannot* honour it disables **with a reason** instead of hiding quietly. Each case
 * below is a real agent from the catalogue, using the modes the wire now carries.
 */

import { describe, expect, it } from "vitest";

import { ALL_HARNESSES, HARNESS_CATALOG, canApplyModel } from "@envoydev/agent-catalog";

import {
  composerControls,
  looksLikeModelValue,
  modeDescription,
  modeLabel,
  modeOffReason,
  modelNote,
  modelOffReason,
  optionDescription,
  optionLabel,
  shortenFolder,
  taskLocationLabel,
  thinkingNote,
  thinkingOffReason,
  type ComposerAgent,
} from "../src/composer/controls.js";
import { probeAsk, publishesOnlyInSession, type ProbeState } from "../src/composer/probe.js";
import { en, isMessageKey } from "../src/i18n/messages/en.js";
import { createTranslator } from "../src/i18n/translate.js";

function agent(over: Partial<ComposerAgent> = {}): ComposerAgent {
  return {
    id: "claudecode",
    label: "Claude Code",
    modes: [
      { id: "plan", label: "Plan" },
      { id: "acceptEdits", label: "Accept edits" },
      { id: "bypassPermissions", label: "Bypass", unattended: true },
    ],
    capabilities: {
      resume: true,
      cancel: true,
      approvals: true,
      structuredTools: true,
      streaming: true,
      images: false,
    },
    availability: { state: "ready", binary: "/usr/local/bin/agent" },
    ...over,
  };
}

const idle = { running: false, approvalPending: false };
const working = { running: true, approvalPending: false };
const blocked = { running: true, approvalPending: true };

/**
 * **Where the send behaviour went.** Three legs stood here — the plain send when nothing runs, the user's
 * preference while a turn runs, and `interrupt` forced by an approval. They pinned `resolveSendBehaviour` and
 * `sendLabel`, which **nothing in the window ever read**: the composer drew its own "Send"/"Start" and the only
 * place the choice existed was a Queue/Steer select, which the owner asked about and which is gone
 * (`docs/settings-parity.md` §7.33). A decision nothing can reach is a claim, not a feature — so the pair went
 * with the select, and what replaced it is one fact on the button's tooltip: a message sent while the agent is
 * working queues behind the turn in flight. `steer` is still on the wire for a client that offers it, and the
 * *default* behaviour is a setting (§8.3).
 */

describe("the mode picker is honest about what it can do", () => {
  it("is off with a reason when the daemon cannot apply a mode yet", () => {
    const controls = composerControls(agent(), idle);
    expect(controls.mode.options).toHaveLength(3);
    expect(controls.mode.enabled).toBe(false);
    expect(controls.mode.reason).toMatch(/not wired up yet/);
    // A control that cannot work is still *shown* — hiding it would leave a user wondering whether the
    // agent has modes at all.
    expect(controls.controls.find((control) => control.kind === "mode")).toBeDefined();
  });

  it("turns on when the daemon can apply one, and preselects the first", () => {
    const controls = composerControls(agent({ modesApplicable: true }), idle);
    expect(controls.mode.enabled).toBe(true);
    expect(controls.mode.selected).toBe("plan");
    expect(controls.mode.reason).toBeUndefined();
  });

  it("honours an explicit selection, including the unattended mode", () => {
    const controls = composerControls(agent({ modesApplicable: true }), idle, { selectedModeId: "bypassPermissions" });
    expect(controls.mode.selected).toBe("bypassPermissions");
  });

  it("says plainly when an agent has no modes at all", () => {
    // Pi declares none, and that is a fact a user should be able to read.
    const controls = composerControls(agent({ id: "pi", label: "Pi", modes: [], modesApplicable: true }), idle);
    expect(controls.mode.enabled).toBe(false);
    expect(controls.mode.reason).toMatch(/does not offer selectable modes/);
  });

  it("carries the reason's catalogue key, so a German window does not read our English", () => {
    // The sentence above is what a caller with no translator shows (a script, a CLI). A *window*
    // renders `reasonKey` in the user's language and picks it by key, never by comparing prose — the
    // arrangement `client/folder-picker.ts` explains for the folder chooser. Both halves are asserted,
    // because a key without the matching English would make the two surfaces say different things.
    const english = createTranslator("en").t;
    const none = composerControls(agent({ id: "pi", label: "Pi", modes: [], modesApplicable: true }), idle);
    expect(none.mode.reasonKey).toBe("task.composer.agentMode.none");
    expect(none.mode.reasonValues).toEqual({ agent: "Pi" });
    // The template plus the values is the sentence — the same relationship the daemon's refusals have
    // with their catalogue entries, and the reason `reasonValues` travels beside `reasonKey`.
    expect(english(none.mode.reasonKey!, none.mode.reasonValues)).toBe(none.mode.reason);

    const notWired = composerControls(agent(), idle);
    expect(notWired.mode.reasonKey).toBe("task.composer.agentMode.notWired");
    expect(english(notWired.mode.reasonKey!, notWired.mode.reasonValues)).toBe(notWired.mode.reason);
    expect(notWired.controls.find((control) => control.kind === "mode")?.reasonKey).toBe(
      "task.composer.agentMode.notWired",
    );

    // Nothing to explain means nothing to translate.
    const on = composerControls(agent({ modesApplicable: true }), idle);
    expect(on.mode.reasonKey).toBeUndefined();
    expect(on.mode.reasonValues).toBeUndefined();
  });
});

/**
 * The model control, which has one more state than the mode picker and differs from it in exactly the
 * place a careless implementation collapses two facts into one.
 *
 * ## The claim under test
 *
 * **An empty list is not "you cannot set a model".** `deepseek-harness` publishes its models only
 * inside a live session's `configOptions`, so a composer has no list before a run exists — and the agent
 * still takes one through `session/set_config_option`. That is `kind: "free-text"`, with no options and
 * a **usable** control, and the tests below assert both halves: the control is on, and the state that
 * turns it off is `"none"` rather than an empty array.
 *
 * The three off-states are asserted separately too, because they are three different claims and only
 * one of them is about the agent. A single sentence covering all three is how a user concludes an agent
 * has no models when it has some we cannot reach.
 */
describe("the model control is honest about what it can do", () => {
  const withModels = (
    models: ComposerAgent["models"],
    over: Partial<ComposerAgent> = {},
  ): ComposerAgent => agent({ models, modelApplicable: true, ...over });

  const LISTED: NonNullable<ComposerAgent["models"]> = {
    kind: "listed",
    options: [
      { id: "anthropic/claude-sonnet-4-6", label: "claude-sonnet-4-6", provider: "anthropic", model: "claude-sonnet-4-6" },
      { id: "openai/gpt-4o", label: "gpt-4o", provider: "openai", model: "gpt-4o" },
    ],
    source: "the peer's DEFAULT_PROVIDER_MODELS",
  };

  it("offers the agent's published list as a picker, with nothing preselected", () => {
    const controls = composerControls(withModels(LISTED), idle);

    expect(controls.model.kind).toBe("listed");
    expect(controls.model.enabled).toBe(true);
    expect(controls.model.options).toHaveLength(2);
    expect(controls.model.reason).toBeUndefined();
    expect(controls.model.reasonKey).toBeUndefined();
    // **Nothing is preselected, and that is a decision rather than an omission.** The agent's own
    // default is a real state — it is what a task is in before anybody chooses — and defaulting to the
    // first entry would silently move every task onto a model nobody picked.
    expect(controls.model.selected).toBeNull();
    // …while the task's stored model wins over that, so a choice survives to the next run.
    const remembered = composerControls(withModels(LISTED), idle, { selectedModelId: "openai/gpt-4o" });
    expect(remembered.model.selected).toBe("openai/gpt-4o");
  });

  it("is ON and takes free text when the agent publishes no list but accepts a model", () => {
    // The middle state, and the reason this control is not a `<select>`: `deepseek-harness` answers
    // `session/new` with `{sessionId, configOptions}` and enumerates provider/model choices from a live
    // LLM catalog, so the list exists only per session. Cataloguing one would mean inventing it.
    const controls = composerControls(
      withModels({ kind: "free-text", options: [], source: "README.md:76 — opaque choices, live catalog" }),
      idle,
    );

    expect(controls.model.kind).toBe("free-text");
    expect(controls.model.options).toEqual([]);
    // The assertion this state exists for: an empty list and an enabled control, at once.
    expect(controls.model.enabled).toBe(true);
    expect(controls.model.reason).toBeUndefined();
    // And why it may be enabled at all: the daemon has a real way to deliver the value.
    expect(canApplyModel("deepseek-harness")).toBe(true);
  });

  it("is off with the agent as the cause only when the agent takes no model at all", () => {
    const controls = composerControls(
      withModels({ kind: "none", options: [], source: "no model flag recorded" }),
      idle,
    );
    expect(controls.model.enabled).toBe(false);
    expect(controls.model.reasonKey).toBe("task.composer.model.none");
    expect(controls.model.reasonValues).toEqual({ agent: "Claude Code" });
    const english = createTranslator("en").t;
    // The template plus the values *is* the sentence a window shows — asserted, because a key without
    // the matching English would make the two surfaces say different things.
    expect(english(controls.model.reasonKey!, controls.model.reasonValues)).toBe(controls.model.reason);
  });

  it("is off with a different reason when we cannot deliver a model we can see", () => {
    // The third-party entries: several record a model flag, and `isDrivableByAcpAdapter` refuses to
    // launch any of them. Keeping the options visible with the control off is what makes "this build
    // cannot do it yet" readable as distinct from "this agent has no models".
    const controls = composerControls(agent({ models: LISTED, modelApplicable: false }), idle);
    expect(controls.model.enabled).toBe(false);
    expect(controls.model.options).toHaveLength(2);
    expect(controls.model.reasonKey).toBe("task.composer.model.notWired");
    expect(controls.model.reason).toMatch(/not wired up yet/);
    expect(controls.controls.find((control) => control.kind === "model")?.reasonKey).toBe(
      "task.composer.model.notWired",
    );
  });

  it("treats 'nobody told us' as a third state rather than as 'this agent has none'", () => {
    // The harness list has not arrived, or this pane was rendered without a daemon. That is *our*
    // ignorance, and the sentence has to say so — the mistake the mode picker's `unknown` reason exists
    // to prevent, repeated here because the same shape of bug reappears on every new control.
    const controls = composerControls(agent(), idle); // no `models` at all
    expect(controls.model.enabled).toBe(false);

    const off = modelOffReason(controls.model, { known: false, agent: "Claude Code" });
    expect(off?.key).toBe("task.composer.model.unknown");
    expect(createTranslator("en").t(off!.key, off!.values)).toMatch(/has not been told which models/);
    // Not the agent's fault, and not the same sentence.
    expect(off?.key).not.toBe("task.composer.model.none");

    // And when the wire *has* answered, the same call gives the fact about the agent instead. One
    // function, two sentences, because only the caller knows whether the answer is in.
    const none = composerControls(withModels({ kind: "none", options: [], source: "…" }), idle);
    expect(modelOffReason(none.model, { known: true, agent: "Claude Code" })?.key).toBe(
      "task.composer.model.none",
    );
  });

  it("returns no reason at all while the control works", () => {
    // The contract `modeOffReason` has, kept identical: `undefined` means "the control works", so the
    // caller enables it exactly when this is `undefined` — one answer rather than two that can
    // disagree. A `free-text` control with no options **must** take this branch.
    const free = composerControls(withModels({ kind: "free-text", options: [], source: "…" }), idle);
    expect(modelOffReason(free.model, { known: true, agent: "Claude Code" })).toBeUndefined();
    const listed = composerControls(withModels(LISTED), idle);
    expect(modelOffReason(listed.model, { known: true, agent: "Claude Code" })).toBeUndefined();
  });

  it("knows what is worth committing from a free-text field, and what is half-typed", () => {
    // The field keeps a draft, and only a value naming both halves is handed upwards: committing
    // `deepseek` on the way to `deepseek/deepseek-chat` would save a value that makes the next run
    // refuse. Empty is not a draft — it is "the agent's own default", handled by the caller.
    expect(looksLikeModelValue("deepseek/deepseek-chat")).toBe(true);
    expect(looksLikeModelValue("ollama/meta-llama/Llama-3-70b")).toBe(true);
    expect(looksLikeModelValue("deepseek")).toBe(false);
    expect(looksLikeModelValue("deepseek/")).toBe(false);
    expect(looksLikeModelValue("/deepseek-chat")).toBe(false);
    expect(looksLikeModelValue("")).toBe(false);
  });

  it("says which shape a free-text model has to be, since the user cannot guess it", () => {
    // That sentence is what makes the field usable rather than merely present: `provider/model` is a
    // requirement of the agent's protocol, not a preference of ours.
    const free = composerControls(withModels({ kind: "free-text", options: [], source: "…" }), idle);
    expect(modelNote(free.model, { enabled: free.model.enabled })).toBe(
      "task.composer.model.freeText",
    );
    // A list needs no explanation, and a disabled control already has its reason line.
    const listed = composerControls(withModels(LISTED), idle);
    expect(modelNote(listed.model, { enabled: true })).toBeUndefined();
    expect(modelNote(free.model, { enabled: false })).toBeUndefined();
  });

  it("has one sentence per list, and the one it draws when the list came from a session", () => {
    // **The rule that keeps one pill from having two notes.** The free-text instruction and the
    // "observed from the last session" sentence answer the same question — what is this list and why
    // should I trust it — so the module picks exactly one, and the caller renders whatever it gets.
    const observed = composerControls(
      withModels({ ...LISTED, observedAt: "2026-09-14T05:23:00.000Z" }),
      idle,
    );
    expect(modelNote(observed.model, { enabled: true })).toBe("task.composer.model.observed");
    // Not the free-text instruction: this list *is* a list, and telling a user to type a `provider/model`
    // beside a picker of real models would be advice about a control they are not looking at.
    expect(modelNote(observed.model, { enabled: true })).not.toBe("task.composer.model.freeText");
    // A catalogue list has no time to name, so it draws nothing at all.
    expect(modelNote(composerControls(withModels(LISTED), idle).model, { enabled: true })).toBeUndefined();
    // And a disabled control still draws neither: its reason line is the sentence.
    expect(modelNote(observed.model, { enabled: false })).toBeUndefined();
  });


});

/**
 * The thinking control: the fourth one, and the first whose options exist **nowhere but in a session**.
 *
 * ## The claim under test
 *
 * An agent publishes its thought levels inside the `session/new` response, so a composer has nothing to
 * read before a run — not from a catalogue, not from a fixture, not from anywhere. That produces a state
 * the other controls do not have, and it is the one worth a test: **"publishes levels we have not seen
 * yet" is not "offers none".** Folding them together tells a user their agent cannot think in steps,
 * which one run disproves, and it is the same class of mistake as reading an empty model list as "no
 * model".
 *
 * The other half is the observation: a list that came from a real session travels with the *time* it was
 * seen, because "what it offered last Tuesday" and "what it publishes" are different promises. A level
 * is derived from the model that session resolved, so the difference is not pedantic.
 */
describe("the thinking control is honest about what it can do", () => {
  const LEVELS = {
    kind: "listed" as const,
    options: [
      { value: "off", label: "Off", description: "Use for simple tasks that do not need reasoning." },
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
      { value: "max", label: "Max" },
    ],
    observedAt: "2026-09-14T05:23:00.000Z",
    source: "observed from the session opened at …",
  };

  const withThinking = (
    thinking: ComposerAgent["thinking"],
    over: Partial<ComposerAgent> = {},
  ): ComposerAgent => agent({ thinking, thinkingApplicable: true, modelApplicable: true, ...over });

  it("offers the levels a session published, with nothing preselected", () => {
    const controls = composerControls(withThinking(LEVELS), idle);

    expect(controls.thinking.kind).toBe("listed");
    expect(controls.thinking.enabled).toBe(true);
    expect(controls.thinking.options.map((option) => option.value)).toEqual(["off", "low", "high", "max"]);
    expect(controls.thinking.reason).toBeUndefined();
    expect(controls.thinking.reasonKey).toBeUndefined();
    // **Nothing preselected**, for the model's reason: the agent's own depth is a real state — it is
    // what a task is in before anybody chooses — and defaulting to the first entry would move every task
    // onto a depth nobody picked.
    expect(controls.thinking.selected).toBeNull();
    // …and the task's stored level wins over that, so a choice survives to the next run.
    const remembered = composerControls(withThinking(LEVELS), idle, { selectedThinkingLevel: "max" });
    expect(remembered.thinking.selected).toBe("max");
    // The timestamp travels, because the window's sentence names it. A list with no time would have to
    // be presented as a promise.
    expect(controls.thinking.observedAt).toBe("2026-09-14T05:23:00.000Z");
  });

  it("says 'we have not seen a session' rather than 'this agent has none'", () => {
    // `deepseek-harness`'s real state before its first run, and the mistake this control exists to
    // prevent. The level list is empty *and the control is not claiming anything about the agent*.
    const controls = composerControls(
      withThinking(
        { kind: "session", options: [], source: "published per session" },
        { label: "DeepSeek Harness" },
      ),
      idle,
    );

    expect(controls.thinking.kind).toBe("session");
    expect(controls.thinking.options).toEqual([]);
    expect(controls.thinking.enabled).toBe(false);

    const off = thinkingOffReason(controls.thinking, { known: true, agent: "DeepSeek Harness" });
    expect(off?.key).toBe("task.composer.thinking.notSeen");
    expect(off?.key).not.toBe("task.composer.thinking.none");
    // The sentence names the agent *and* the one thing that would fix it, because this is the only
    // disabled state a user can resolve on their own.
    expect(createTranslator("en").t(off!.key, off!.values)).toMatch(/has not opened a session with DeepSeek Harness yet/);
    expect(createTranslator("en").t(off!.key, off!.values)).toMatch(/until it has run once/);
    // And the same reason the module words in English, asserted word for word — one sentence, two
    // renderers, which is the arrangement `error.*` uses for the daemon's refusals.
    expect(createTranslator("en").t(off!.key, off!.values)).toBe(controls.thinking.reason);
    expect(
      controls.controls.find((control) => control.kind === "thinking")?.reasonKey,
    ).toBe("task.composer.thinking.notSeen");
  });

  it("offers nothing and blames the agent only when the agent offers nothing", () => {
    // `envoy-harness`, whose ACP surface has no thought-level method at all — verified against the built
    // peer. This is a fact about the agent, so the sentence says so.
    const controls = composerControls(
      withThinking({ kind: "none", options: [], source: "no thought-level method" }, { thinkingApplicable: false }),
      idle,
    );
    expect(controls.thinking.enabled).toBe(false);
    expect(controls.thinking.reasonKey).toBe("task.composer.thinking.none");
    expect(controls.thinking.reasonValues).toEqual({ agent: "Claude Code" });
    // `none` wins over "not wired up yet", and the order is the point: telling a user we have work to do
    // when there is nothing to wire is a different — and worse — lie than staying quiet.
    expect(controls.thinking.reasonKey).not.toBe("task.composer.thinking.notWired");
    expect(createTranslator("en").t(controls.thinking.reasonKey!, controls.thinking.reasonValues)).toBe(
      controls.thinking.reason,
    );
  });

  it("is off with a third reason when the agent has levels this build cannot deliver", () => {
    // A catalogued CLI that publishes levels and cannot be launched: the list stays *visible* with the
    // control off, so the gap reads as "this build cannot do it yet" rather than as something false
    // about the agent. Exactly the rule the model control follows for the same entries.
    const controls = composerControls(withThinking(LEVELS, { thinkingApplicable: false }), idle);
    expect(controls.thinking.enabled).toBe(false);
    expect(controls.thinking.options).toHaveLength(4);
    expect(controls.thinking.reasonKey).toBe("task.composer.thinking.notWired");
    expect(controls.thinking.reason).toMatch(/not wired up yet/);
  });

  it("treats 'nobody told us' as a fourth state, worded as our ignorance", () => {
    // The harness list has not arrived, or the pane was rendered without a daemon. Note that the
    // *kind* falls back to `"none"` here and the control is still not described as the agent's fault:
    // `thinkingOffReason` checks `known` first, which is why the caller passes it.
    const controls = composerControls(agent(), idle); // no `thinking` at all
    expect(controls.thinking.enabled).toBe(false);

    const off = thinkingOffReason(controls.thinking, { known: false, agent: "Claude Code" });
    expect(off?.key).toBe("task.composer.thinking.unknown");
    expect(createTranslator("en").t(off!.key, off!.values)).toMatch(/has not been told what Claude Code offers yet/);
    expect(off?.key).not.toBe("task.composer.thinking.none");
    expect(off?.key).not.toBe("task.composer.thinking.notSeen");

    // And when the wire *has* answered, the same call gives the fact about the agent instead — one
    // function, three sentences, because only the caller knows whether the answer is in.
    const none = composerControls(withThinking({ kind: "none", options: [], source: "…" }), idle);
    expect(thinkingOffReason(none.thinking, { known: true, agent: "Claude Code" })?.key).toBe(
      "task.composer.thinking.none",
    );
    // The function's **own contract**, asserted independently of what `composerControls` happened to put
    // in `reasonKey`: a decision that says `"none"` is worded as "the agent offers none", whoever built
    // the object. Without this the branch is only reachable through a path that already carries the same
    // key, and a reordering of the checks inside `thinkingOffReason` would go unnoticed.
    expect(
      thinkingOffReason({ kind: "none", enabled: false }, { known: true, agent: "Envoy Harness" })?.key,
    ).toBe("task.composer.thinking.none");
  });

  it("offers the agent's own 'provider default' as the control's own empty value, not twice", () => {
    // The real agent publishes `{value: "", name: "Provider default"}` for a provider that has no default
    // effort of its own, and that is the *same state* as the control's first option — nothing is sent and
    // the agent decides. Two rows meaning one thing is a picker a user cannot read, and two `<option>`s
    // with one `value` is a `<select>` whose selection cannot be read back; so the agent's is folded into
    // ours. What must survive the fold is the *state*: the control still offers "the agent's own default".
    const published = [
      { value: "", label: "Provider default" },
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ];
    const controls = composerControls(
      withThinking({ kind: "listed", options: published, observedAt: undefined, source: "…" }),
      idle,
    );
    expect(controls.thinking.options.map((option) => option.value)).toEqual(["low", "high"]);
    // Not "no options" and not a disabled control: the agent's choice is still reachable, as the empty
    // value the component renders first.
    expect(controls.thinking.enabled).toBe(true);
    expect(controls.thinking.selected).toBeNull();
    // The other values are untouched, in the agent's own order, with the agent's own labels.
    expect(controls.thinking.options.map((option) => option.label)).toEqual(["Low", "High"]);
  });

  it("returns no reason at all while the control works", () => {
    // The contract the other two have, kept identical: `undefined` means "the control works", so the
    // caller enables it exactly when this is `undefined`. A `listed` control is the case that must take
    // this branch — a function that returned a reason for the `session` kind unconditionally would
    // disable a working picker the moment an agent published one statically.
    const listed = composerControls(withThinking(LEVELS), idle);
    expect(thinkingOffReason(listed.thinking, { known: true, agent: "Claude Code" })).toBeUndefined();
  });

  it("draws the thinking control's observed sentence only while that control works", () => {
    // `modelNote`'s contract, for the fourth control — asserted separately because the two call sites are
    // separate, and a change to one would otherwise be invisible to the other's test.
    const listed = composerControls(withThinking(LEVELS), idle);
    expect(thinkingNote(listed.thinking, { enabled: listed.thinking.enabled })).toBe(
      "task.composer.thinking.observed",
    );
    // Nothing observed, nothing to say: a list from the agent's own catalogue has no time to name.
    const statically = composerControls(withThinking({ ...LEVELS, observedAt: undefined }), idle);
    expect(thinkingNote(statically.thinking, { enabled: true })).toBeUndefined();
    // And no note under a disabled control, because its reason line is already there — the rule that
    // keeps one pill from carrying two sentences.
    expect(thinkingNote(listed.thinking, { enabled: false })).toBeUndefined();
  });

  it("shows the agent's own word for a level, and translates only wording that is ours", () => {
    // Every level this build can show is the agent's vocabulary — `Off`, `Low`, `High`, `Max` are the
    // words `deepseek-harness` publishes, and it validates exactly them, so a translation would be a
    // value the agent refuses. The mechanism for *our* wording exists and is shared with the mode
    // picker, which is what the second half asserts.
    const t = createTranslator("en").t;
    expect(optionLabel({ value: "high", label: "High" }, t)).toBe("High");
    expect(optionDescription({ value: "high", label: "High", description: "The default balance." }, t)).toBe(
      "The default balance.",
    );
    expect(optionDescription({ value: "high", label: "High" }, t)).toBeUndefined();
    // A keyed label is resolved through the translator, and the marker function proves it: asserting
    // this with the *English* translator would be vacuous, because `t("task.agentMode.plan.label")` is
    // the same word as the label it would have fallen back to. The mode picker's own test uses the same
    // marker for the same reason.
    const marked = (key: string): string => `«${key}»`;
    expect(optionLabel({ value: "plan", label: "Plan", labelKey: "task.agentMode.plan.label" }, marked)).toBe(
      "«task.agentMode.plan.label»",
    );
    expect(
      optionDescription(
        { value: "plan", label: "Plan", description: "ours", descriptionKey: "task.agentMode.plan.description" },
        marked,
      ),
    ).toBe("«task.agentMode.plan.description»");
    // A key this build does not have falls back to the sentence rather than to the key.
    expect(optionLabel({ value: "x", label: "X", labelKey: "task.thinking.fromTheFuture" }, t)).toBe("X");
    expect(optionLabel({ value: "x", label: "X", labelKey: "task.thinking.fromTheFuture" }, marked)).toBe("X");
  });
});

describe("the controls follow the agent's capabilities", () => {
  it("offers stop, approvals and images only when the agent supports them", () => {
    const full = composerControls(agent(), working);
    expect(full.controls.find((c) => c.kind === "cancel")?.enabled).toBe(true);
    expect(full.controls.find((c) => c.kind === "approvals")?.enabled).toBe(true);
    // Claude Code is text-only here: no images.
    expect(full.controls.find((c) => c.kind === "images")?.enabled).toBe(false);
  });

  it("explains a control the agent cannot do, rather than leaving it blank", () => {
    const noCancel = composerControls(
      agent({ capabilities: { ...agent().capabilities, cancel: false, images: true } }),
      working,
    );
    expect(noCancel.controls.find((c) => c.kind === "cancel")?.reason).toMatch(/does not support stopping/);
    expect(noCancel.notes.join(" ")).toMatch(/cannot stop Claude Code/);
    expect(noCancel.controls.find((c) => c.kind === "images")?.enabled).toBe(true);
  });

  it("says an agent that is not installed cannot be used, and what to run", () => {
    const missing = composerControls(
      agent({
        availability: {
          state: "not-installed",
          fix: [{ command: "npm install -g @anthropic-ai/claude-code" }],
        },
      }),
      idle,
    );
    // The sentence lives in `notes` — the reason the agent chip carries and the composer shows — because the
    // `send` field that used to duplicate it went with the Queue/Steer select (§7.33).
    expect(missing.notes.join(" ")).toMatch(/not installed/);
    // The command travels with the reason, because a state whose content is "this is missing" and which does
    // not say what to run is the sentence this whole change removed.
    expect(missing.notes.join(" ")).toContain("npm install -g @anthropic-ai/claude-code");
  });

  it("says the *adapter* is missing when the agent itself is installed", () => {
    // **The bug report, in the composer.** The old sentence for every false was "is not installed on this
    // machine", and a user who had installed Claude Code read it about the agent. The two are different
    // sentences now, and only one of them is a claim about the user's machine.
    const bridged = composerControls(
      agent({
        availability: {
          state: "needs-bridge",
          agentBinary: "/home/you/.local/bin/claude",
          fix: [{ command: "npm install -g @agentclientprotocol/claude-agent-acp" }],
        },
      }),
      idle,
    );
    expect(bridged.notes.join(" ")).toMatch(/is installed, but the program EnvoyDev drives it through is missing/);
    expect(bridged.notes.join(" ")).toContain("npm install -g @agentclientprotocol/claude-agent-acp");
    expect(bridged.notes.join(" ")).not.toMatch(/is not installed on this machine/);
  });

  it("distinguishes 'we could not tell' from 'it is missing', from 'we cannot drive it'", () => {
    const unknown = composerControls(agent({ availability: { state: "unknown" } }), idle);
    expect(unknown.notes.join(" ")).toMatch(/could not tell whether/);
    expect(unknown.notes.join(" ")).not.toMatch(/is not installed/);

    const undrivable = composerControls(
      agent({ availability: { state: "unsupported", binary: "/usr/bin/copilot" } }),
      idle,
    );
    expect(undrivable.notes.join(" ")).toMatch(/speaks a protocol EnvoyDev cannot drive yet/);
    expect(undrivable.notes.join(" ")).not.toMatch(/is not installed/);
  });
});

/**
 * The wording of a mode, and the keys that carry it across a language boundary.
 *
 * A mode's `label` and `description` are prose. When *we* wrote them — the three `envoy-harness` modes
 * are its `ModeKind`, labelled in `@envoydev/agent-catalog` — a German window must not read English,
 * so the catalogue entry carries `labelKey`/`descriptionKey` and this module resolves them. A mode a
 * third-party agent named itself arrives with neither, and is shown exactly as the agent wrote it:
 * the same rule the approval prompt's option labels follow, because rewording another product's
 * vocabulary is how one decision ends up described two ways.
 */
describe("a mode's wording", () => {
  const t = (key: string): string => `«${key}»`;

  it("renders our key when the catalogue gave one", () => {
    expect(
      modeLabel({ id: "plan", label: "Plan", labelKey: "task.agentMode.plan.label" }, t),
    ).toBe("«task.agentMode.plan.label»");
    expect(
      modeDescription(
        {
          id: "plan",
          label: "Plan",
          description: "Investigate and propose a plan. Change nothing yet.",
          descriptionKey: "task.agentMode.plan.description",
        },
        t,
      ),
    ).toBe("«task.agentMode.plan.description»");
  });

  it("shows the agent's own words when it named the mode itself", () => {
    // Claude Code's `bypassPermissions`, or any catalogued CLI's entry: the label is theirs.
    expect(modeLabel({ id: "bypassPermissions", label: "Bypass" }, t)).toBe("Bypass");
    expect(modeDescription({ id: "auto", label: "Auto", description: "No prompts." }, t)).toBe("No prompts.");
    expect(modeDescription({ id: "auto", label: "Auto" }, t)).toBeUndefined();
  });

  it("falls back to the sentence for a key this build does not have", () => {
    // `HarnessSummary` comes off the wire, so a daemon one version ahead can name a key this window's
    // catalogue has never heard of. `mode.plan.label` on screen would be worse than the English one.
    expect(modeLabel({ id: "plan", label: "Plan", labelKey: "task.agentMode.fromTheFuture" }, t)).toBe(
      "Plan",
    );
  });

  it("keeps every key the catalogue names present in the English catalogue", () => {
    // The compile-time guarantee stops at the protocol: `AgentMode.labelKey` is a plain string there,
    // because a wire type cannot know a window's catalogue. This is where the producer is checked — and
    // it is the check that matters, because a typo'd key degrades to English while looking translated in
    // review, which is precisely the failure `docs/localization.md` says nobody notices.
    const modes = ALL_HARNESSES.flatMap((id) =>
      HARNESS_CATALOG[id].modes.map((mode) => ({ id, mode })),
    );
    expect(modes.length, "no catalogue modes found — has the catalogue moved?").toBeGreaterThan(0);

    for (const { id, mode } of modes) {
      for (const key of [mode.labelKey, mode.descriptionKey]) {
        if (key === undefined) continue;
        expect(isMessageKey(key), `${id} mode ${mode.id} names the unknown key "${key}"`).toBe(true);
      }
      // And when both are present they must not disagree: the English sentence is what a
      // non-translating caller shows, so `label` and `en[labelKey]` are the same words.
      if (mode.labelKey !== undefined && isMessageKey(mode.labelKey)) {
        expect(en[mode.labelKey], `${id} mode ${mode.id}`).toBe(mode.label);
      }
      if (mode.descriptionKey !== undefined && isMessageKey(mode.descriptionKey)) {
        expect(en[mode.descriptionKey], `${id} mode ${mode.id}`).toBe(mode.description);
      }
    }
  });
});

/**
 * How a folder reads on a pill.
 *
 * Relative to the project first, because that is the shape a user recognises — the project is already
 * named in the pane's header, so `packages/api` is more informative than any truncation of the absolute
 * path. A folder genuinely elsewhere has no project to be relative to.
 */
describe("shortening a folder for the pill", () => {
  it("shows a folder inside the project relative to it", () => {
    expect(shortenFolder("/Users/dev/work/api", "/Users/dev/work")).toBe("api");
    expect(shortenFolder("/Users/dev/work/api/src", "/Users/dev/work")).toBe("api/src");
    // A trailing separator is what a copy from Finder carries, and it does not change the answer.
    expect(shortenFolder("/Users/dev/work/api/", "/Users/dev/work/")).toBe("api");
  });

  it("falls back to the tail for a folder that is not in the project", () => {
    expect(shortenFolder("/elsewhere/deep/api", "/Users/dev/work")).toBe("…/deep/api");
    // Short enough to show whole, and a Windows path is split the same way.
    expect(shortenFolder("/tmp/x", "/Users/dev/work")).toBe("/tmp/x");
    expect(shortenFolder("C:\\work\\api\\src", "C:\\work")).toBe("api/src");
  });

  it("does not make the project root relative to itself", () => {
    // The project is not a folder *inside* the project: making it relative would leave an empty pill,
    // which a user reads as a bug. It is shortened like any other path — the whole path is in the title.
    expect(shortenFolder("/Users/dev/work", "/Users/dev/work")).toBe("…/dev/work");
    // Two segments or fewer is already short enough to show whole.
    expect(shortenFolder("/repo", "/repo")).toBe("/repo");
    expect(shortenFolder("/repo")).toBe("/repo");
  });
});

/**
 * **Where the task runs, as the header's chip names it.**
 *
 * The rule has three cases and the middle one is the reason it is a function: the chip is the only place that
 * names the project, so a task inside the project has to keep the project's name in front of the part below it.
 * (`shortenFolder` above drops it, which was right for the composer's pill — the pill sat under a header that
 * named the project — and is wrong here, which is why the two are separate functions rather than one.)
 */
describe("naming the task's location in the header", () => {
  const project = { label: "payments-api", path: "/Users/dev/work/payments-api" };

  it("uses the project's own name when the task runs in the project's folder", () => {
    expect(taskLocationLabel("/Users/dev/work/payments-api", project)).toBe("payments-api");
    // A trailing separator, as a copy from Finder carries.
    expect(taskLocationLabel("/Users/dev/work/payments-api/", project)).toBe("payments-api");
  });

  it("keeps the project's name in front of the part below it", () => {
    expect(taskLocationLabel("/Users/dev/work/payments-api/packages/api", project)).toBe(
      "payments-api/packages/api",
    );
  });

  it("falls back to the tail for a folder that is not in the project, and copes with no project", () => {
    expect(taskLocationLabel("/elsewhere/deep/api", project)).toBe("…/deep/api");
    expect(taskLocationLabel("/Users/dev/work/other", undefined)).toBe("…/work/other");
  });
});

/**
 * Which reason leaves the mode picker off.
 *
 * The three facts are not interchangeable, and this is the one place that chooses between them — so the
 * choice is asserted rather than left to whichever branch a component happened to write first.
 */
describe("why the mode picker is off", () => {
  const off = { enabled: false, reasonKey: "task.composer.agentMode.none" as const, reasonValues: { agent: "Pi" } };

  it("is nothing at all when the control works", () => {
    expect(modeOffReason({ enabled: true }, { known: true, agent: "Envoy Harness" })).toBeUndefined();
  });

  it("says we have not been told, rather than claiming the agent has none", () => {
    // The one that must never be confused with the others: it is a claim about *us*, and turning our
    // ignorance into a fact about somebody else's product is how a picker lies.
    expect(modeOffReason(off, { known: false, agent: "Envoy Harness" })).toEqual({
      key: "task.composer.agentMode.unknown",
      values: { agent: "Envoy Harness" },
    });
  });

  it("passes the decision's own key and values through when we do know", () => {
    expect(modeOffReason(off, { known: true, agent: "Pi" })).toEqual({
      key: "task.composer.agentMode.none",
      values: { agent: "Pi" },
    });
  });

  it("has nothing to say when a disabled control carried no key", () => {
    // A caller that forgot one is a bug; inventing a sentence for it would hide that in the UI.
    expect(modeOffReason({ enabled: false }, { known: true, agent: "Pi" })).toBeUndefined();
  });
});

/* ────────────────────────────── the pre-flight probe ────────────────────────────── */

/**
 * The four states of "ask the agent what it offers", decided without a DOM.
 *
 * The claim under test is the one the whole slice exists for: a control can be *ignorant* and say so,
 * a control can be *busy* and say so, and a probe that failed must never be rendered as an agent that
 * publishes nothing. Each of those is a different sentence, and only one of them is about the agent.
 */
describe("the pre-flight probe decides whether to ask at all", () => {
  const canAsk = { unlisted: true, supported: true, availability: "ready" as const, agent: "DeepSeek Harness" };

  it("asks when the agent publishes its options only inside a session", () => {
    // The gap the slice closes: `deepseek-harness` publishes a model list and a thought level in the
    // `session/new` response, so before a first run the window had nothing to render.
    const ask = probeAsk({ ...canAsk, state: { state: "idle" } });
    expect(ask.ask).toBe(true);
    expect(ask.enabled).toBe(true);
    // The first ask may be answered from the daemon's cache: "do we know what this agent offers?" is a
    // question a second window asking it a minute later should not spend a process on.
    expect(ask.force).toBe(false);
    expect(ask.buttonKey).toBe("task.composer.probe.ask");
    expect(ask.note).toBeUndefined();
  });

  it("names the two controls' answers as one question, not two", () => {
    // One probe answers both pills — the model list and the levels come from the same response — which is
    // why the button is drawn once and why the *whole agent* decides, not each control separately.
    expect(publishesOnlyInSession({ models: { kind: "free-text", options: [], source: "…" } })).toBe(true);
    expect(
      publishesOnlyInSession({ thinking: { kind: "session", options: [], source: "…" } }),
    ).toBe(true);
    // A catalogue list and a genuine "none" are both already answered, so a probe would spend a process to
    // learn nothing. This is the gate that keeps `envoy-harness` from ever being spawned for a probe.
    expect(
      publishesOnlyInSession({
        models: { kind: "listed", options: [], source: "…" },
        thinking: { kind: "none", options: [], source: "…" },
      }),
    ).toBe(false);
    // And our own ignorance — the harness list has not arrived — is *not* a reason to ask either: there is
    // no agent to ask about yet, and the pills already word this state.
    expect(publishesOnlyInSession({})).toBe(false);
  });

  it("says it is asking, rather than showing an empty list while a process runs", () => {
    const ask = probeAsk({ ...canAsk, state: { state: "asking" } });
    expect(ask.ask).toBe(false);
    // Disabled while it runs, and the label already offers the next one: pressing it twice cannot help,
    // and a button that silently did nothing would read as a dead click.
    expect(ask.enabled).toBe(false);
    expect(ask.buttonKey).toBe("task.composer.probe.askAgain");
    expect(ask.note?.key).toBe("task.composer.probe.asking");
    expect(ask.note?.values).toEqual({ agent: "DeepSeek Harness" });
    // The sentence names the agent and says what the ask costs, because it starts one.
    expect(en["task.composer.probe.asking"]).toMatch(/starts it, asks, and closes it again/);
  });

  it("draws the daemon's own sentence for the two outcomes that are not a list", () => {
    for (const outcome of ["none", "unreachable"] as const) {
      const detail = { message: "the daemon's sentence", key: "task.composer.probe.none" as const };
      const ask = probeAsk({ ...canAsk, state: { state: "answered", outcome, detail } });
      // "It published nothing" and "we could not ask" are two sentences, and the daemon is the one that
      // knows which happened — so the window draws what it sent, key and all, rather than rewording it.
      expect(ask.note).toBe(detail);
      expect(ask.ask).toBe(false);
      expect(ask.enabled).toBe(true);
      // The second ask forces, because the first one may have been answered from the daemon's cache.
      expect(ask.force).toBe(true);
      expect(ask.buttonKey).toBe("task.composer.probe.askAgain");
    }
  });

  it("draws nothing for a list, because the list is the answer", () => {
    const ask = probeAsk({
      ...canAsk,
      state: {
        state: "answered",
        outcome: "listed",
        detail: { message: "DeepSeek Harness opened a session and published 2 option(s): model, …" },
      },
    });
    // A second sentence under a pill that just grew options would be noise: the pills show the list, and
    // their "observed at {time}" note carries the timestamp of the session this probe opened.
    expect(ask.note).toBeUndefined();
    expect(ask.enabled).toBe(true);
    expect(ask.buttonKey).toBe("task.composer.probe.askAgain");
  });

  it("offers nothing to press for an agent the daemon cannot be asked about", () => {
    // Three different reasons, one outcome: no button, and no probe. An enabled-looking control that goes
    // nowhere is the failure this repository keeps writing gates against.
    const cases = [
      { ...canAsk, unlisted: false, state: { state: "idle" } as ProbeState },
      // An older daemon: the shell attaches to whichever build owns the port, and this method is new.
      { ...canAsk, supported: false, state: { state: "idle" } as ProbeState },
      // Every state that is not `ready`, and there are four: a probe of any of them could only come back
      // "unreachable", and the composer names what is missing (and what to run) on the agent chip instead.
      // `not-installed` and `unknown` are the pair the old boolean conflated; `needs-bridge` and
      // `unsupported` are the two it could not express at all.
      { ...canAsk, availability: "not-installed" as const, state: { state: "idle" } as ProbeState },
      { ...canAsk, availability: "unknown" as const, state: { state: "idle" } as ProbeState },
      { ...canAsk, availability: "needs-bridge" as const, state: { state: "idle" } as ProbeState },
      { ...canAsk, availability: "unsupported" as const, state: { state: "idle" } as ProbeState },
    ];
    for (const input of cases) {
      const ask = probeAsk(input);
      expect(ask.ask, JSON.stringify(input.unlisted) + String(input.supported)).toBe(false);
      expect(ask.enabled).toBe(false);
      expect(ask.buttonKey).toBeUndefined();
      expect(ask.note).toBeUndefined();
    }
  });
});
