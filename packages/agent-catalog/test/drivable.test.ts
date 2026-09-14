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
