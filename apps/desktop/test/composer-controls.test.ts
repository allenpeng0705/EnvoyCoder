/**
 * The composer's controls, per agent.
 *
 * The claim under test is the one the product was failing: the input area adapts to the agent you chose,
 * and anything it *cannot* honour it disables **with a reason** instead of hiding quietly. Each case
 * below is a real agent from the catalogue, using the modes the wire now carries.
 */

import { describe, expect, it } from "vitest";

import { ALL_HARNESSES, HARNESS_CATALOG, canApplyModel } from "@envoycoder/agent-catalog";

import {
  composerControls,
  looksLikeModelValue,
  modeDescription,
  modeLabel,
  modeOffReason,
  modelNote,
  modelOffReason,
  shortenFolder,
  resolveSendBehaviour,
  sendLabel,
  type ComposerAgent,
} from "../src/composer/controls.js";
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
    available: true,
    ...over,
  };
}

const idle = { running: false, approvalPending: false };
const working = { running: true, approvalPending: false };
const blocked = { running: true, approvalPending: true };

describe("the send button says what will happen", () => {
  it("offers the plain send when nothing is running", () => {
    expect(resolveSendBehaviour(idle)).toBe("send");
    expect(sendLabel("send")).toBe("Send message");
  });

  it("follows the user's preference while a turn runs", () => {
    expect(resolveSendBehaviour(working, "steer")).toBe("steer");
    expect(resolveSendBehaviour(working, "queue")).toBe("queue");
    expect(sendLabel("steer")).toBe("Send and steer");
    expect(sendLabel("queue")).toBe("Queue message");
  });

  it("forces interrupt while an approval is pending, whatever the preference says", () => {
    // The rule from `docs/paseo-design-decisions.md`: queueing behind an approval strands the message,
    // because the turn is parked until somebody answers.
    expect(resolveSendBehaviour(blocked, "queue")).toBe("interrupt");
    expect(resolveSendBehaviour(blocked, "steer")).toBe("interrupt");
    expect(sendLabel("interrupt")).toBe("Interrupt agent");
  });
});

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

  it("disables sending for an agent that is not available, and says why", () => {
    const missing = composerControls(
      agent({ available: false, unavailableReason: "Claude Code is not installed (looked for claude on PATH)." }),
      idle,
    );
    expect(missing.send.enabled).toBe(false);
    expect(missing.send.reason).toMatch(/not installed/);
  });

  it("distinguishes 'we have not looked' from 'it is missing'", () => {
    const unknown = composerControls(agent({ available: "unknown" }), idle);
    expect(unknown.send.enabled).toBe(false);
    expect(unknown.send.reason).toMatch(/has not checked/);
  });
});

/**
 * The wording of a mode, and the keys that carry it across a language boundary.
 *
 * A mode's `label` and `description` are prose. When *we* wrote them — the three `envoy-harness` modes
 * are its `ModeKind`, labelled in `@envoycoder/agent-catalog` — a German window must not read English,
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
