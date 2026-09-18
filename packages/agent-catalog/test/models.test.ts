/**
 * The model facts, and what an empty list is allowed to mean.
 *
 * ## The claim under test
 *
 * Slice 2 of the composer's control row is "a real model picker, backed by a list the harnesses
 * actually document". Two things can go wrong with that, and both are silent without a test:
 *
 *   1. **A list we invented.** A model id we prettified, or a provider id we guessed, is an id the
 *      agent refuses — and the failure surfaces on a user's machine as "the agent did something odd"
 *      rather than here. So the list `envoy-harness` gets is pinned against the peer's own source, and
 *      the three providers with no entry stay out of it.
 *   2. **An empty list read as "no model".** `deepseek-harness` publishes its models only inside a live
 *      session, so before a run exists there is nothing to enumerate and the agent still takes one.
 *      Reporting that as `kind: "none"` would disable a control the agent supports, which is the exact
 *      inversion of the product rule this row exists for. `free-text` with no options is the answer,
 *      and the first test below is the one that would fail if somebody "simplified" it back.
 *
 * The resolution tests are the other half: a value has to reach the agent in the shape *that* agent
 * wants, and the two wired agents want opposite shapes — one splits the choice into two argv flags,
 * the other re-encodes it as one opaque string.
 */

import { describe, expect, it } from "vitest";

import type { HarnessId } from "@envoydev/protocol";

import {
  ALL_HARNESSES,
  HARNESS_MODELS,
  HARNESS_MODEL_DELIVERY,
  canApplyModel,
  harnessModelDelivery,
  harnessModels,
  modelArgs,
  modelIdOf,
  resolveModelChoice,
} from "../src/index.js";

describe("what each agent publishes about its models", () => {
  it("has an answer for every harness, so no agent is a missing key", () => {
    // A missing entry would be a third state — "nobody wrote this down" — that a client cannot tell
    // apart from `"none"`, and telling those apart is what `kind` was added for.
    for (const id of ALL_HARNESSES) {
      expect(HARNESS_MODELS[id], id).toBeDefined();
      expect(["listed", "free-text", "none"], id).toContain(HARNESS_MODELS[id].kind);
      // The provenance is required and non-empty: a list on the wire with no citation behind it is a
      // list somebody made up, and nothing downstream can tell the difference.
      expect(HARNESS_MODELS[id].source.length, id).toBeGreaterThan(40);
    }
    expect(Object.keys(HARNESS_MODELS).sort()).toEqual([...ALL_HARNESSES].sort());
  });

  it("lists exactly the provider defaults `envoy-harness` publishes, verbatim", () => {
    const models = harnessModels("envoy-harness");
    expect(models.kind).toBe("listed");
    expect(models.options.map((option) => option.id)).toEqual([
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4-6",
      "deepseek/deepseek-chat",
      "minimax/MiniMax-M3",
      "glm/glm-4-flash",
      "qwen/qwen-plus",
      "ollama/llama3.1",
    ]);
    // The citation is on the *fact*, not only in the test: it names the peer file and the line range
    // the table was read from, which is what a maintainer needs when the peer moves.
    expect(models.source).toContain("envoy-harness/src/llm/index.ts:110-120");
    // Every provider the peer documents a default for has an entry, and no provider it does not is
    // present. `zhipu` and `dashscope` are in its `SUPPORTED_PROVIDERS` as aliases but have no default
    // model, so they are deliberately **not** here — a model id invented for an alias is one the agent
    // routes to nothing.
    expect(models.options.map((option) => option.provider)).toEqual([
      "openai",
      "anthropic",
      "deepseek",
      "minimax",
      "glm",
      "qwen",
      "ollama",
    ]);
  });

  it("takes the choice apart per option, so nothing downstream splits the id", () => {
    for (const id of ALL_HARNESSES) {
      for (const option of harnessModels(id).options) {
        // `id` is `provider/model` by construction, and the two halves are carried rather than left to
        // be recovered: `model` can itself contain a slash, and a `split("/")` would then name a
        // provider that does not exist.
        expect(option.id, `${id} ${option.id}`).toBe(`${option.provider}/${option.model}`);
        expect(option.provider.length, option.id).toBeGreaterThan(0);
        expect(option.model.length, option.id).toBeGreaterThan(0);
        expect(option.label.length, option.id).toBeGreaterThan(0);
        // A model id is the agent's; ours is the label. A label that was the id would be a catalogue
        // that had not decided what to show.
        expect(option.label, option.id).not.toBe(option.id);
      }
    }
  });

  it("gives deepseek-harness free text rather than an invented list, or a disabled control", () => {
    // **The test that would fail if somebody collapsed the middle state.** An empty `options` is true;
    // `"free-text"` is what says the user can still name a model, and `"none"` would disable the
    // control for an agent that documents `session/set_config_option` for exactly this.
    const models = harnessModels("deepseek-harness");
    expect(models.kind).toBe("free-text");
    expect(models.options).toEqual([]);
    // The citation names the two files that make this the honest answer: the README's "opaque
    // provider/model choices from the live LLM service catalog", and the source that builds them.
    expect(models.source).toContain("packages/acp/acp/README.md:70,76");
    expect(models.source).toContain("model-control.ts");
    expect(canApplyModel("deepseek-harness")).toBe(true);
  });

  it("never claims a list where the entry records no model flag at all", () => {
    // `copilot` is the one entry whose `buildArgs` passes no model, and whose flag surface has not been
    // read. "We do not know of one" is `none`; the alternatives are a list we invented or free text we
    // could not deliver, and the source string says which of the two it is.
    expect(harnessModels("copilot").kind).toBe("none");
    expect(harnessModels("copilot").options).toEqual([]);
  });
});

describe("how a chosen model reaches an agent", () => {
  it("wires every runnable agent, and leaves the unlaunchable ones unwired on purpose", () => {
    // The adapter is ACP-only (`isDrivableByAcpAdapter`), so a model could not reach the remaining
    // entries even if one were chosen — the same distinction `capabilities.agentMode` draws for modes.
    expect(canApplyModel("envoy-harness")).toBe(true);
    expect(canApplyModel("deepseek-harness")).toBe(true);
    for (const id of ["claudecode", "codex", "cursor"] as const) {
      expect(canApplyModel(id), id).toBe(true);
    }
    for (const id of ["copilot", "opencode", "omp", "pi"] as const) {
      expect(canApplyModel(id), id).toBe(false);
    }
    // The flag the composer enables its control on is derived from this, never stored twice.
    expect(canApplyModel("envoy-harness")).toBe(harnessModelDelivery("envoy-harness") !== undefined);
  });

  it("sends the three ACP agents' model as the bare id their `model` option lists", () => {
    // **Why this is asserted rather than assumed.** All three publish their models in the `session/new`
    // response as bare ids (`gpt-5.5`, `haiku`, `composer-2.5[fast=true]`) — no groups, no JSON pair —
    // and the value that travels has to be one of those, because at least one of the three refuses a
    // value outside its own published list. The provider half of our `provider/model` convention is
    // therefore dropped on the way out, and this test is where that is recorded rather than discovered.
    for (const id of ["claudecode", "codex", "cursor"] as const) {
      const delivery = harnessModelDelivery(id);
      expect(delivery?.kind, id).toBe("session-config");
      if (delivery?.kind !== "session-config") throw new Error("unreachable");
      expect(delivery.configId, id).toBe("model");
      expect(delivery.valueShape, id).toBe("bare-id");
      expect(delivery.encode({ provider: "anthropic", model: "haiku" }), id).toBe("haiku");
      // The provider half really is ignored, so nobody later reads its absence as a bug.
      expect(delivery.encode({ provider: "whoever", model: "haiku" }), id).toBe("haiku");
    }

    // Not `session/set_model`, which both bridges answer `-32601 "Method not found"` — the
    // plausible-looking mistake, pinned so it is not made twice.
    expect(harnessModelDelivery("codex")?.source).toContain("session/set_config_option");
  });

  it("sends envoy-harness's model as the pair of flags its own dispatch reads", () => {
    const delivery = harnessModelDelivery("envoy-harness");
    expect(delivery?.kind).toBe("argv");
    // Both flags, always together: its `--acp` branch builds a live agent only when `--provider` is
    // set and reads `--model` only there (`cli/run/acp.ts:100-106`), so `--model` alone would be
    // parsed, dropped, and then reported to the user as the model they chose.
    expect(modelArgs("anthropic/claude-sonnet-4-6", "envoy-harness")).toEqual([
      "--provider",
      "anthropic",
      "--model",
      "claude-sonnet-4-6",
    ]);
    // Nothing chosen means no flags at all — not an empty pair, which the agent would read as a
    // provider named "".
    expect(modelArgs(undefined, "envoy-harness")).toEqual([]);
    expect(modelArgs("", "envoy-harness")).toEqual([]);
  });

  it("re-encodes deepseek-harness's model as the opaque value its config option expects", () => {
    const delivery = harnessModelDelivery("deepseek-harness");
    expect(delivery?.kind).toBe("session-config");
    if (delivery?.kind !== "session-config") throw new Error("unreachable");
    expect(delivery.configId).toBe("model");
    // The exact encoding, read from the peer rather than guessed:
    // `JSON.stringify([provider, model])` (`model-control.ts:235-237`).
    expect(delivery.encode({ provider: "deepseek", model: "deepseek-chat" })).toBe(
      '["deepseek","deepseek-chat"]',
    );
  });
});

describe("turning the value on a task into what the agent wants", () => {
  it("looks a listed value up rather than splitting it", () => {
    // The reason the lookup matters: a model whose *own* name contains a slash. Splitting this id on
    // the first `/` would hand the agent a provider called `meta-llama`.
    const resolved = resolveModelChoice("envoy-harness", "anthropic/claude-sonnet-4-6");
    expect(resolved).toEqual({
      ok: true,
      id: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    // A value the agent does not publish, and whose provider it does not document, is refused.
    const unknown = resolveModelChoice("envoy-harness", "meta-llama/Llama-3-70b");
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error("unreachable");
    expect(unknown.code).toBe("unknownModel");
    expect(unknown.reason).toContain("does not publish a model");
    // A custom id is accepted when the provider half is one Envoy Harness documents.
    const custom = resolveModelChoice("envoy-harness", "openai/gpt-4.1-mini");
    expect(custom).toEqual({
      ok: true,
      id: "openai/gpt-4.1-mini",
      provider: "openai",
      model: "gpt-4.1-mini",
    });
  });

  it("splits a free-text value on the first slash, and demands both halves", () => {
    const resolved = resolveModelChoice("deepseek-harness", "deepseek/deepseek-chat");
    expect(resolved).toEqual({
      ok: true,
      id: "deepseek/deepseek-chat",
      provider: "deepseek",
      model: "deepseek-chat",
    });
    // A model id containing a slash keeps the whole tail as the model — the provider is the *first*
    // segment, which is the only rule that can hold for a value we did not get from a list.
    const nested = resolveModelChoice("deepseek-harness", "ollama/meta-llama/Llama-3-70b");
    expect(nested.ok && nested.provider).toBe("ollama");
    expect(nested.ok && nested.model).toBe("meta-llama/Llama-3-70b");

    // Half a value is refused with a sentence naming the shape, because these agents need a provider
    // to build a route at all — and the refusal happens before a process exists.
    for (const half of ["deepseek", "deepseek/", "/deepseek-chat", ""]) {
      const bad = resolveModelChoice("deepseek-harness", half);
      expect(bad.ok, half).toBe(false);
      if (bad.ok) throw new Error("unreachable");
      expect(bad.code, half).toBe("notProviderQualified");
      expect(bad.reason, half).toContain("provider/model");
    }
  });

  it("accepts a bare ACP model id for Claude / Codex / Cursor", () => {
    // Their select values are bare (`haiku`, `gpt-5.5`) — demanding provider/model would refuse every
    // id the agent itself listed in session/new.
    const bare = resolveModelChoice("claudecode", "haiku");
    expect(bare).toEqual({ ok: true, id: "haiku", provider: "acp", model: "haiku" });
    const delivery = harnessModelDelivery("claudecode");
    expect(delivery?.kind).toBe("session-config");
    if (delivery?.kind !== "session-config") throw new Error("unreachable");
    expect(delivery.valueShape).toBe("bare-id");
    expect(delivery.encode({ provider: "acp", model: "haiku" })).toBe("haiku");

    // A slash form is still accepted; encode keeps only the model half.
    const qualified = resolveModelChoice("codex", "openai/gpt-5.5");
    expect(qualified).toEqual({ ok: true, id: "openai/gpt-5.5", provider: "openai", model: "gpt-5.5" });
  });

  it("refuses a model for an agent that takes none, and says which of the two it is", () => {
    const none = resolveModelChoice("copilot", "openai/gpt-4o");
    expect(none.ok).toBe(false);
    if (none.ok) throw new Error("unreachable");
    // A different code from `unknownModel`, because "this agent has no model" and "we do not know that
    // model" are different things to tell a user — and the daemon words them differently.
    expect(none.code).toBe("noModelSupport");
  });

  it("keeps the bare id for a flag that wants only that, and nothing else", () => {
    // The third-party entries' flags are `unverified`, so the user's own name travels unchanged rather
    // than being reshaped into something we have not checked the CLI accepts.
    expect(modelIdOf("anthropic/claude-sonnet-4.5")).toBe("claude-sonnet-4.5");
    // A value with no slash is itself, and one that is *only* a slash keeps both halves empty-safe.
    expect(modelIdOf("sonnet")).toBe("sonnet");
    expect(modelIdOf("/sonnet")).toBe("/sonnet");
  });

  it("throws rather than dropping a model it cannot build flags for", () => {
    // The second of two loud failures: the daemon refuses earlier with a translated sentence, and this
    // is what stops an argv path from quietly emitting a bare `--model`.
    expect(() => modelArgs("deepseek", "envoy-harness")).toThrow(/publish/);
    expect(() => modelArgs("gpt-4o", "copilot")).toThrow(/does not take a model/);
    // A per-harness delivery table with an entry for something unrunnable would be a wiring claim we
    // cannot keep, so the keys of the table and `canApplyModel` must stay one list.
    for (const id of Object.keys(HARNESS_MODEL_DELIVERY) as HarnessId[]) {
      expect(canApplyModel(id), id).toBe(true);
    }
  });
});
