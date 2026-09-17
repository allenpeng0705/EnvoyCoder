/**
 * **What a picker offers — derived from what we measured, and impossible to steer from settings.**
 *
 * ## The file this replaces, and why the replacement is not a rename
 *
 * `agent-preference.test.ts` used to live here. It pinned the *stored* preference — `CoderSettings.hiddenAgents`,
 * `coder.setAgentHidden`, the `hidden` flag on both summary types, the `pickable` filter, and the quarantine
 * rule for a malformed list — and every one of those is gone from this build. A stored filter that shortens the
 * list of agents a product offers is the one control that can make an agent **we ship** disappear from our own
 * lists, which is the failure the owner of this product named when they said they could not see the agents we
 * support; it was added on a misreading of Paseo's "Enable {provider}" row, which decides whether *that* daemon
 * instantiates a provider at all rather than curating a list (`docs/settings-parity.md` §5.8).
 *
 * What is left to test is the rule that replaced it, and the shape of the tests is different on purpose. There
 * is no store, no RPC and no settings document anywhere in this file, because the property being asserted is
 * that **none of those can reach the answer** — so the only instrument that can prove it is a pure function and
 * a row that lies about having been filtered.
 *
 * ## The four things asserted, in the order they matter
 *
 *   1. **A stored preference cannot shorten the list.** A row carrying every shape a preference could take is
 *      offered anyway. This is the case that fails the day somebody reintroduces a `hidden` read.
 *   2. **Only a measured absence drops a row** — and `unknown`, the state that means nobody has looked, does
 *      not. A picker that dropped it would decide on the user's behalf about an agent they configured.
 *   3. **The order is by how usable the answer says the agent is**, `ready` first, and the incoming order is
 *      preserved inside a rank so the catalogue's own ordering survives.
 *   4. **The setting that used to drive it is retired, not merely unread** — the old key is dropped by the
 *      tolerant settings read, so an upgrading user's settings file keeps its language and its default
 *      agent. Without that, the deletion itself would have cost them their settings.
 */

import { describe, expect, it } from "vitest";

import {
  CoderSettingsSchema,
  RETIRED_SETTINGS_KEYS,
  readCoderSettingsDocument,
} from "@envoydev/protocol";
import type { HarnessAvailability, HarnessState, HarnessSummary } from "@envoydev/protocol";

import { availabilityOf, knownMissing, offeredAgents, stateOf } from "../src/composer/agent-for.js";

/** One row, with only the fields the rule may read spelled out — and `id` for the failure messages. */
function row(id: string, state: HarnessState, extra: Record<string, unknown> = {}): HarnessSummary {
  const availability: HarnessAvailability =
    state === "ready" || state === "unsupported"
      ? { state, binary: `/usr/local/bin/${id}` }
      : { state };
  return { id, label: id, availability, ...extra } as unknown as HarnessSummary;
}

/** The ids a picker would render, in order. */
const ids = (agents: readonly { id: string }[]): string[] => agents.map((agent) => agent.id);

describe("what a picker offers is derived, and nothing stored can shorten it", () => {
  it("offers a row that carries a stored preference anyway — the preference has no reader here", () => {
    // **The mutation this fails on:** any read of a stored flag in the rule — `summary.hidden === true`,
    // `settings.hiddenAgents.includes(id)`, a filter passed in as an argument. The row below carries every
    // shape that preference took on the wire and in the settings document, and it is **still offered**,
    // because there is nothing in `offeredAgents` that can see any of them.
    //
    // This is the case the deleted feature would have failed, and it is the reason the file exists: a
    // guarantee that no user setting can hide an agent is only worth anything if a test can put a user
    // setting in front of the rule and watch it do nothing.
    const hidden = row("codex", "ready", {
      hidden: true,
      hiddenAgents: ["codex"],
      settings: { hiddenAgents: ["codex"] },
    });
    expect(ids(offeredAgents([hidden]))).toEqual(["codex"]);

    // …and the same row alongside a visible one, so "it was offered" cannot be an artefact of a one-row list.
    const shown = row("cursor", "ready");
    expect(ids(offeredAgents([hidden, shown]))).toEqual(["codex", "cursor"]);
  });

  it("drops only the state that asserts the program is absent, and never `unknown`", () => {
    // **The mutation this fails on:** widening the filter — to `state !== "ready"`, or to a list of the states
    // a picker "likes". An agent nobody has looked at is not one we may drop on the user's behalf: the honest
    // answer to "can this run" is *we have not looked*, and the row that explains it is right there.
    const agents = [
      row("ready-one", "ready"),
      row("missing", "not-installed"),
      row("unexamined", "unknown"),
      row("bridgeless", "needs-bridge"),
      row("undrivable", "unsupported"),
    ];
    expect(ids(offeredAgents(agents))).toEqual([
      "ready-one",
      "unexamined",
      "bridgeless",
      "undrivable",
    ]);
    // The predicate and the rule say the same thing, which is what makes the rule readable as a sentence.
    expect(knownMissing(row("missing", "not-installed"))).toBe(true);
    expect(knownMissing(row("unexamined", "unknown"))).toBe(false);
  });

  it("orders by how usable the measurement says the agent is, keeping the catalogue's order inside a rank", () => {
    // **The mutation this fails on:** dropping the sort (a picker that lists a missing-its-adapter agent above
    // a working one), or sorting alphabetically / by id, which would rearrange the product's own ordering —
    // `envoy-harness` is first because it is the default, and nothing about that should change because a
    // user's machine happens to have a different agent installed.
    const agents = [
      row("zeta-unknown", "unknown"),
      row("bridge", "needs-bridge"),
      row("alpha-unknown", "unknown"),
      row("cursor-ready", "ready"),
      row("envoy-harness", "ready"),
    ];
    expect(ids(offeredAgents(agents))).toEqual([
      "cursor-ready",
      "envoy-harness",
      "zeta-unknown",
      "alpha-unknown",
      "bridge",
    ]);
  });

  it("is a function of `availability` alone, including the wire generation that predates it", () => {
    // An older daemon sends `available` and no `availability` at all, and `availabilityOf` is the one place
    // that translation lives. The rule reads *its output* — so a legacy `false` becomes `unknown` (never
    // `not-installed`, §7.9) and the row stays in the list. A daemon being a build behind must not remove an
    // agent from a picker, which is one more way a list could shorten without anybody measuring anything.
    const legacyTrue = { id: "legacy-true", available: true } as unknown as HarnessSummary;
    const legacyFalse = { id: "legacy-false", available: false } as unknown as HarnessSummary;
    const legacyUnknown = { id: "legacy-unknown", available: "unknown" } as unknown as HarnessSummary;
    expect(ids(offeredAgents([legacyFalse, legacyTrue, legacyUnknown]))).toEqual([
      "legacy-true",
      "legacy-false",
      "legacy-unknown",
    ]);
    expect(stateOf(legacyFalse)).toBe("unknown");
    expect(availabilityOf(legacyFalse)).toEqual({ state: "unknown" });
  });

  it("reads a provider the user declared exactly as it reads one we ship", () => {
    // The rule takes the two-fact shape both summary types carry, so a user-declared program is offered on the
    // same terms. A provider is *probed*, never believed (§7.10): the fact that the user typed its command line
    // is not evidence that it is here, and it is not a reason to treat it differently either way.
    const declared: { id: string; availability: HarnessAvailability }[] = [
      { id: "mine", availability: { state: "ready", binary: "/usr/local/bin/mine" } },
      { id: "gone", availability: { state: "not-installed" } },
    ];
    expect(ids(offeredAgents(declared))).toEqual(["mine"]);
  });
});

describe("the preference is retired rather than left unread", () => {
  it("drops the old key, so an upgrading settings file keeps everything else", () => {
    // **The half of a deletion that is easy to get wrong.** `CoderSettingsSchema` is `.strict()` and a file it
    // rejects is *quarantined* — moved aside and replaced by the defaults — so removing the field from the
    // schema used to cost an upgrading user their language, their default agent and their folder the first
    // time the new build read the old file. A deletion is not an excuse to lose somebody's settings.
    expect(RETIRED_SETTINGS_KEYS).toContain("hiddenAgents");

    // The shape an old file has: the fields this build keeps, plus the list it no longer has.
    const old = {
      defaults: { harness: "deepseek-harness" },
      requireApprovalForDestructive: false,
      keepTranscripts: true,
      language: "de",
      hiddenAgents: ["codex", "cursor"],
    };
    // The strict schema still refuses the document on its own — which is *why* the tolerant read exists,
    // and why "the schema is strict" and "the read is lenient" are not in conflict: the pruning happens
    // before the parse, and the parse is what stays uncompromising about **values**.
    expect(CoderSettingsSchema.safeParse(old).success).toBe(false);

    // And the key is dropped for *any* value, including the malformed one the old build quarantined: the
    // field is gone from this build, so a value under it is not a file we cannot understand, it is a value
    // nothing reads. `domain.ts` carries that argument where the reader lives.
    for (const value of [["codex"], "codex", [], 42, null]) {
      const read = readCoderSettingsDocument({ ...old, hiddenAgents: value });
      expect(read.kind, `hiddenAgents: ${JSON.stringify(value)} quarantined the file`).toBe("ok");
      if (read.kind !== "ok") continue;
      expect(read.settings.language).toBe("de");
      expect(read.settings.defaults.harness).toBe("deepseek-harness");
      expect(read.dropped).toEqual([{ path: "hiddenAgents", retired: true }]);
    }
  });
});
