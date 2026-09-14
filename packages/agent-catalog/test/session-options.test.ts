/**
 * What an agent publishes **inside a session**: its model list and its thinking level.
 *
 * ## The claim under test
 *
 * Two of the composer's controls cannot be answered from a catalogue, and this module is where the
 * answer is read and kept. Everything that can go wrong here is silent, so each half is pinned:
 *
 *   1. **A value we invented.** A thinking level or a model id we prettified is one the agent refuses,
 *      so the values are taken from the agent verbatim — including the model's *opaque* encoding, which
 *      is a JSON pair rather than a name. The decoding is checked against the same encoding
 *      `SessionModelConfig.encode` builds, because those two must be exact inverses or a chosen model
 *      comes back as a different one.
 *   2. **An observation read as a promise.** A session's options describe *that* session — per machine,
 *      per credential, and for the model it resolved. The record carries the time it was seen for
 *      exactly this reason, and the tests below assert it travels.
 *   3. **"We have not looked" read as "the agent has none".** The third state, and the one this whole
 *      design exists for: `deepseek-harness` publishes its levels only in a session, so before a run
 *      there is nothing to show and the agent still has levels. `session`, not `none`.
 *
 * The parse-shape tests are the other half. This reads a **live agent's** response, so a shape this
 * build has not seen has to degrade to "the agent published nothing" rather than to a crash in a run —
 * and the one shape that is not a degradation at all, ACP's **grouped** select, is the one the real
 * binary actually sends.
 */

import { describe, expect, it } from "vitest";

import {
  ALL_HARNESSES,
  HARNESS_THINKING,
  HARNESS_THINKING_DELIVERY,
  MODEL_CATEGORY,
  THOUGHT_LEVEL_CATEGORY,
  canApplyThinking,
  harnessThinking,
  observeSessionOptions,
  parseSessionConfigOptions,
  sessionFacts,
  thinkingDelivery,
} from "../src/index.js";

/** A `configOptions` array in exactly the shape the real `dsh --profile acp` answers with. */
const REAL_RESPONSE = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: '["deepseek-official","deepseek-v4-flash"]',
    options: [
      {
        group: "deepseek-official",
        name: "DeepSeek",
        options: [
          {
            value: '["deepseek-official","deepseek-v4-flash"]',
            name: "DeepSeek-V4-Flash",
            description: "Fast, efficient, and economical; suited to focused, routine, or parallel tasks.",
          },
          {
            value: '["deepseek-official","deepseek-v4-pro"]',
            name: "DeepSeek-V4-Pro",
            description: "Stronger agentic coding; suited to complex or quality-critical tasks at higher cost.",
          },
          { value: '["deepseek-official","deepseek-v4-flash-vision-exp"]', name: "DeepSeek-V4-Flash-Vision-Exp" },
        ],
      },
    ],
  },
  {
    id: "reasoning_effort",
    name: "Reasoning effort",
    category: "thought_level",
    type: "select",
    currentValue: "high",
    options: [
      { value: "off", name: "Off", description: "Use for simple tasks that do not need reasoning." },
      { value: "low", name: "Low", description: "Prefer for routine or latency-sensitive tasks." },
      { value: "high", name: "High", description: "The default balance for most tasks." },
      { value: "max", name: "Max", description: "Reserve for the hardest quality-first tasks." },
    ],
  },
];

const AT = "2026-09-14T05:23:00.000Z";

describe("reading a session's published options", () => {
  it("keeps the agent's own ids, labels and values, and nothing of ours", () => {
    const parsed = parseSessionConfigOptions(REAL_RESPONSE);
    expect(parsed.map((option) => option.configId)).toEqual(["model", "reasoning_effort"]);
    expect(parsed.map((option) => option.category)).toEqual([MODEL_CATEGORY, THOUGHT_LEVEL_CATEGORY]);
    // The labels are the agent's, verbatim: it named the option "Reasoning effort", and a translation
    // here would be a word the agent does not use anywhere else.
    expect(parsed[1]?.label).toBe("Reasoning effort");
    expect(parsed[1]?.values.map((value) => value.value)).toEqual(["off", "low", "high", "max"]);
    expect(parsed[1]?.values[3]?.description).toBe("Reserve for the hardest quality-first tasks.");
  });

  it("flattens ACP's grouped select, which is the shape the real binary sends", () => {
    // The model option is a list of *groups* rather than of values
    // (`{group, name, options: [{value, name}]}`), and a parser that only read a flat list would report
    // a session with three models as a session with none.
    const model = parseSessionConfigOptions(REAL_RESPONSE)[0];
    expect(model?.values.map((value) => value.label)).toEqual([
      "DeepSeek-V4-Flash",
      "DeepSeek-V4-Pro",
      "DeepSeek-V4-Flash-Vision-Exp",
    ]);
  });

  it("degrades to 'it published nothing' for a shape this build has not seen", () => {
    // Every one of these is a real possibility: an agent that answers `{sessionId}` alone, a non-select
    // option, a value that is not a string, a nested group with no values. None may throw — this runs
    // inside a live run, and a crash there costs the user their turn.
    expect(parseSessionConfigOptions(undefined)).toEqual([]);
    expect(parseSessionConfigOptions("not an array")).toEqual([]);
    expect(parseSessionConfigOptions([null, 7, {}])).toEqual([]);
    expect(parseSessionConfigOptions([{ id: "x", type: "boolean", options: [] }])).toEqual([]);
    // An option the agent published with no values at all is **kept**: the record is of what the agent
    // said, and "it published an option with nothing in it" is a different observation from "it published
    // no such option" — even though both lead the picker to the same place, which is why the record is
    // allowed to say more than the control shows.
    expect(parseSessionConfigOptions([{ id: "x", type: "select", options: [{ name: "no value" }] }])).toEqual([
      { configId: "x", label: "x", category: "", values: [] },
    ]);
    // A value with neither a name nor a value cannot be read or sent, so it is dropped rather than shown
    // as a blank row. An **empty value** is not that case: `""` is a real selector value for this agent.
    expect(parseSessionConfigOptions([{ id: "x", options: [{ value: "" }, { value: "", name: "Provider default" }] }])).toEqual([
      { configId: "x", label: "x", category: "", values: [{ value: "", label: "Provider default" }] },
    ]);
  });

  it("records the observation with the time it was made and the session it came from", () => {
    const observed = observeSessionOptions({
      harness: "deepseek-harness",
      observedAt: AT,
      sessionId: "sess-7",
      configOptions: REAL_RESPONSE,
    });
    expect(observed).toMatchObject({ harness: "deepseek-harness", observedAt: AT, sessionId: "sess-7" });
    // A session that answered with nothing at all is still an observation — the fact `envoy-harness`
    // produces, and the only evidence that turns "publishes none" into a statement about the agent.
    expect(observeSessionOptions({ harness: "envoy-harness", observedAt: AT, configOptions: [] }).options).toEqual([]);
    // No session id means the field is absent rather than an empty string, which the wire schema rejects.
    expect("sessionId" in observeSessionOptions({ harness: "x" as never, observedAt: AT, configOptions: [] })).toBe(false);
  });
});

describe("the model list a session yields", () => {
  it("decodes the agent's opaque values with the inverse of our own encoder", () => {
    // `SessionModelConfig.encode` builds `JSON.stringify([provider, model])`, so this must read it back
    // — and the provider id is the agent's own (`deepseek-official`, not `deepseek`), which is the fact
    // slice 2 recorded as the reason a catalogue list would have been a lie.
    const { models } = sessionFacts(
      "deepseek-harness",
      observeSessionOptions({ harness: "deepseek-harness", observedAt: AT, configOptions: REAL_RESPONSE }),
    );
    expect(models.kind).toBe("listed");
    expect(models.observedAt).toBe(AT);
    expect(models.options.map((option) => option.id)).toEqual([
      "deepseek-official/deepseek-v4-flash",
      "deepseek-official/deepseek-v4-pro",
      "deepseek-official/deepseek-v4-flash-vision-exp",
    ]);
    // Taken apart as well as qualified, because that is what the two deliveries need and splitting the
    // id on a slash is what `AgentModel` exists to avoid.
    expect(models.options[1]).toMatchObject({ provider: "deepseek-official", model: "deepseek-v4-pro" });
  });

  it("leaves a catalogue list alone when a session says nothing about models", () => {
    // **The asymmetry, asserted.** `envoy-harness` takes its model in argv and publishes none of them
    // over the protocol, so a session that says nothing about models has not contradicted its list — and
    // stamping that list with a session's time would attach a promise to a fact from somewhere else.
    const { models } = sessionFacts(
      "envoy-harness",
      observeSessionOptions({ harness: "envoy-harness", observedAt: AT, configOptions: [] }),
    );
    expect(models.kind).toBe("listed");
    expect(models.observedAt).toBeUndefined();
    expect(models.options).toHaveLength(7);
    expect(models.source).toContain("llm/index.ts:110-120");
  });

  it("keeps free text when a session published values it cannot take apart", () => {
    // A provider/model pair is what an `AgentModel` *is*, so a value that is not one is dropped — and if
    // that leaves nothing, the agent keeps the free-text field rather than becoming a picker with
    // invented entries. Silently dropping such a value is the honest half of "the encoding is opaque".
    const { models } = sessionFacts(
      "deepseek-harness",
      observeSessionOptions({
        harness: "deepseek-harness",
        observedAt: AT,
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            options: [{ value: "not json", name: "Mystery" }, { value: '["solo"]', name: "One half" }],
          },
        ],
      }),
    );
    expect(models.kind).toBe("free-text");
    expect(models.options).toEqual([]);
    expect(models.observedAt).toBeUndefined();
  });
});

describe("the thinking level", () => {
  it("has an answer for every harness, before any session is taken into account", () => {
    for (const id of ALL_HARNESSES) {
      expect(HARNESS_THINKING[id], id).toBeDefined();
      expect(["listed", "session", "none"], id).toContain(HARNESS_THINKING[id].kind);
      // Every source is a citation, and a short one would be a claim with nothing behind it.
      expect(HARNESS_THINKING[id].source.length, id).toBeGreaterThan(60);
    }
    expect(Object.keys(HARNESS_THINKING).sort()).toEqual([...ALL_HARNESSES].sort());
  });

  it("says 'we have not seen a session' rather than 'this agent has none' for the agent that publishes per session", () => {
    // `deepseek-harness` builds the option from the model it resolved, in the `session/new` response.
    // Before a run there is genuinely nothing to show — and rendering that as `none` would be a false
    // claim about the agent that one run disproves.
    expect(harnessThinking("deepseek-harness").kind).toBe("session");
    expect(harnessThinking("deepseek-harness").options).toEqual([]);
    expect(canApplyThinking("deepseek-harness")).toBe(true);
    expect(thinkingDelivery("deepseek-harness")?.configId).toBe("reasoning_effort");
    expect(thinkingDelivery("deepseek-harness")?.source).toContain("dsh-acp");
  });

  it("records 'none' for the agent with no thought-level method at all", () => {
    // Verified against the built peer, not inferred: its ACP dispatch handles set_model / set_policy /
    // set_mode and nothing of the kind, and `session/set_config_option` answers
    // `-32601 method not found`. So there is nothing to offer and no way to deliver one — and this is
    // the agent the design's "disabled with the reason" state is for.
    expect(harnessThinking("envoy-harness").kind).toBe("none");
    expect(canApplyThinking("envoy-harness")).toBe(false);
    expect(thinkingDelivery("envoy-harness")).toBeUndefined();
  });

  it("does not claim an unread agent has none", () => {
    // The third-party entries: their thought-level surface has not been read and they cannot be
    // launched, so nothing will ever be observed. `"session"` says exactly that, and the window's reason
    // for them is our own ("not wired up yet") rather than a statement about somebody else's product.
    for (const id of ["claudecode", "codex", "copilot", "opencode", "cursor", "omp", "pi"] as const) {
      expect(harnessThinking(id).kind, id).toBe("session");
      expect(canApplyThinking(id), id).toBe(false);
    }
  });

  it("lists the levels a session published, with the agent's own names and descriptions", () => {
    const { thinking } = sessionFacts(
      "deepseek-harness",
      observeSessionOptions({ harness: "deepseek-harness", observedAt: AT, configOptions: REAL_RESPONSE }),
    );
    expect(thinking.kind).toBe("listed");
    expect(thinking.observedAt).toBe(AT);
    expect(thinking.options.map((option) => option.value)).toEqual(["off", "low", "high", "max"]);
    // The label is the agent's word, and it is what the picker shows: `Off`, not a translation of it.
    expect(thinking.options[0]?.label).toBe("Off");
    // Nothing in this build sets a label key on a level, because every value is the agent's vocabulary.
    expect(thinking.options.every((option) => option.labelKey === undefined)).toBe(true);
  });

  it("turns an observed session that published no level into 'none' — an observed fact, not a gap", () => {
    // The `envoy-harness` case, and the reason an **empty** observation is recorded rather than skipped:
    // "we opened a session and it offered nothing" is about the agent, while "we have not looked" is
    // about us, and the pill says something different for each.
    const { thinking } = sessionFacts(
      "deepseek-harness",
      observeSessionOptions({ harness: "deepseek-harness", observedAt: AT, configOptions: [REAL_RESPONSE[0]!] }),
    );
    expect(thinking.kind).toBe("none");
    expect(thinking.observedAt).toBe(AT);
    expect(thinking.source).toContain("published no option");
  });

  it("applies the same rule over the wire's own answers, so the two ends cannot disagree", () => {
    // The precedence is one function, and this is the assertion that it is *reachable from the wire*:
    // what a session published beats what the catalogue says, in both directions.
    const observed = observeSessionOptions({
      harness: "deepseek-harness",
      observedAt: AT,
      configOptions: REAL_RESPONSE,
    });
    expect(sessionFacts("deepseek-harness", undefined).thinking.kind).toBe("session");
    expect(sessionFacts("deepseek-harness", observed).thinking.kind).toBe("listed");
    // The model half of the same observation, so one record answers both controls at one timestamp.
    expect(sessionFacts("deepseek-harness", observed).models.observedAt).toBe(AT);
  });

  it("keeps the delivery and the option id in one place, so a value cannot travel to the wrong option", () => {
    // `HARNESS_THINKING_DELIVERY` is the only thing the daemon sends with, and the id is the agent's.
    expect(Object.keys(HARNESS_THINKING_DELIVERY)).toEqual(["deepseek-harness"]);
    expect(HARNESS_THINKING_DELIVERY["deepseek-harness"]?.kind).toBe("session-config");
  });
});
