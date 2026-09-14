/**
 * What each catalogue entry can *actually* do with the adapter we have.
 *
 * The distinction this file pins is the one that was wrong in the product: **installed is not
 * drivable.** `RunManager.launchFromCatalogue` returns an `AcpLaunch` and hands the process to the ACP
 * client, which then speaks `initialize` / `session/new` / `session/prompt` at it. An entry whose
 * program does not speak Agent Client Protocol therefore cannot start — but the picker, the Settings
 * list and `coder.listHarnesses` all offered it as ready, because the only question anyone asked was
 * whether the binary was on PATH.
 *
 * Two facts are asserted here, and both are the kind that rot silently:
 *
 *   1. **exactly two** entries are drivable — the two whose argv *is* ACP;
 *   2. every other entry says what it speaks instead, so a refusal can name the gap rather than
 *      telling a user to install something they already have.
 */

import { describe, expect, it } from "vitest";

import {
  ALL_HARNESSES,
  HARNESS_CATALOG,
  harnessTransport,
  isDrivableByAcpAdapter,
} from "../src/index.js";

describe("which agents this product can actually run", () => {
  it("drives the two whose protocol our adapter speaks — and no others", () => {
    const drivable = ALL_HARNESSES.filter((id) => isDrivableByAcpAdapter(id));
    expect(drivable.sort()).toEqual(["deepseek-harness", "envoy-harness"]);

    for (const id of drivable) {
      expect(harnessTransport(id)).toBe("acp");
      // The rule is about the argv we actually spawn, not about the vendor: both of these launch
      // programs that implement ACP over stdio.
      const launch = HARNESS_CATALOG[id].launch;
      expect(launch.kind).toBe("child-process");
    }
  });

  it("records a transport for every entry, so nothing is silently undrivable", () => {
    for (const id of ALL_HARNESSES) {
      const transport = harnessTransport(id);
      expect(["acp", "cli", "in-process"]).toContain(transport);
      expect(isDrivableByAcpAdapter(id)).toBe(transport === "acp");
    }
  });

  it("keeps the six non-ACP agents listed but not drivable — an honest gap, not a hidden one", () => {
    // These stay in the catalogue because the recipes (argv, env, install link) are real work and will
    // be needed by the adapters that make them runnable: an app-server client for codex, an HTTP
    // bridge for opencode, a JSONL-RPC reader for pi/omp, a vendor ACP subcommand for copilot/cursor.
    // What they must not be is *offered* as ready, which is what `isDrivableByAcpAdapter` now prevents.
    for (const id of ["claudecode", "codex", "copilot", "opencode", "cursor", "pi", "omp"] as const) {
      expect(isDrivableByAcpAdapter(id), id).toBe(false);
      expect(harnessTransport(id), id).toBe("cli");
    }
  });
});

/**
 * Which agents can be put into one of their own modes — a **different** question from what they have.
 *
 * `modes` is the list a picker offers; `capabilities.agentMode` is whether the daemon can *set* one.
 * The pair is easy to conflate, and conflating them is how a composer ends up offering a picker for an
 * agent whose protocol has no way to receive it — a control that silently does nothing, which is the
 * failure the whole honesty rule exists to prevent. So both halves are pinned here, against the peer
 * checkouts' own source rather than against memory.
 */
describe("which agents can be put into a mode", () => {
  it("names exactly the peer's three mode ids for the built-in harness", () => {
    // `session/set_mode` validates against `ModeKind` and answers
    // `-32602 mode must be default|plan|review` for anything else
    // (`../envoy-harness/packages/envoy-harness/src/plan/mode-kind.ts`;
    // `.../src/protocol/acp-params.ts:352-375`). A label we invented would be a mode it refuses, so the
    // ids are asserted rather than trusted to a reviewer.
    expect(HARNESS_CATALOG["envoy-harness"].modes.map((mode) => mode.id)).toEqual([
      "default",
      "plan",
      "review",
    ]);
    expect(HARNESS_CATALOG["envoy-harness"].capabilities.agentMode).toBe(true);
  });

  it("offers nothing for the harness whose ACP surface has no session/set_mode", () => {
    // `deepseek-harness` registers new/list/resume/close/setConfigOption/prompt/cancel and nothing else
    // (`../deepseek-harness/packages/acp/acp/src/index.ts:384-390`), and the configuration it reports
    // per session is the model and the reasoning effort (`.../src/model-control.ts:188-220`). Empty is
    // the *answer*, so the catalogue says so rather than listing modes the agent would ignore.
    expect(HARNESS_CATALOG["deepseek-harness"].modes).toEqual([]);
    expect(HARNESS_CATALOG["deepseek-harness"].capabilities.agentMode).toBe(false);
  });

  it("keeps the two facts consistent everywhere, in the direction that could lie", () => {
    for (const id of ALL_HARNESSES) {
      const entry = HARNESS_CATALOG[id];
      // Declaring modes we cannot set is legitimate — the third-party CLI entries do it, their list
      // comes from Paseo's manifest, and `isDrivableByAcpAdapter` refuses to launch them anyway. What
      // is *not* legitimate is claiming we can set a mode while declaring none: an enabled picker with
      // no choices behind it.
      if (entry.capabilities.agentMode) {
        expect(entry.modes.length, `${id} claims settable modes but declares none`).toBeGreaterThan(0);
      }
      for (const mode of entry.modes) {
        expect(mode.id.trim(), `${id} has a blank mode id`).not.toBe("");
        expect(mode.label.trim(), `${id} mode ${mode.id} has no label`).not.toBe("");
      }
    }
  });
});
