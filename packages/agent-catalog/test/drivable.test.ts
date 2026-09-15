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
 * Three facts are asserted here, and all three are the kind that rot silently:
 *
 *   1. **exactly five** entries are drivable — the two first-party harnesses plus the three agents
 *      whose ACP commands were verified against their real binaries (`claudecode`, `codex`, `cursor`);
 *   2. every other entry says what it speaks instead, so a refusal can name the gap rather than
 *      telling a user to install something they already have;
 *   3. every entry that claims it can be put into a mode **says which field its `session/set_mode`
 *      reads**, because `AcpClient.setMode` refuses to guess — the built-in harness silently ignores a
 *      `modeId`, so a wrong guess is a mode that looks applied and is not.
 */

import { describe, expect, it } from "vitest";

import {
  ALL_HARNESSES,
  HARNESS_CATALOG,
  harnessAcpFacts,
  harnessTransport,
  isDrivableByAcpAdapter,
} from "../src/index.js";

describe("which agents this product can actually run", () => {
  it("drives the six whose protocol our adapter speaks — and no others", () => {
    const drivable = ALL_HARNESSES.filter((id) => isDrivableByAcpAdapter(id));
    // `copilot` is the sixth, since 2026-09-15: Copilot 1.0.83 starts an ACP server with `--acp` and was driven
    // against the real binary (its entry carries the measurement). The list is exact on purpose — an entry that
    // claims a transport we cannot drive would be offered as ready and fail at the first run.
    expect(drivable.sort()).toEqual([
      "claudecode",
      "codex",
      "copilot",
      "cursor",
      "deepseek-harness",
      "envoy-harness",
    ]);

    for (const id of drivable) {
      expect(harnessTransport(id)).toBe("acp");
      // The rule is about the argv we actually spawn, not about the vendor: all six launch programs
      // that implement ACP over stdio.
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

  it("keeps the three agents with no ACP surface listed but not drivable — an honest gap, not a hidden one", () => {
    // These stay in the catalogue because the recipes (argv, env, install link) are real work and will be
    // needed by the adapters that make them runnable: a JSONL-RPC reader for pi/omp, and whatever
    // copilot and opencode grow. What they must not be is *offered* as ready, which is what
    // `isDrivableByAcpAdapter` prevents.
    //
    // `claudecode`, `codex` and `cursor` used to be in this list. They left it when their commands were
    // replaced with ones that were driven against the real binaries — the Cursor CLI's own `acp`
    // subcommand, and the Agent Client Protocol project's bridges for the other two — and the test above
    // is what makes that change visible rather than a comment somebody has to trust.
    // `copilot` left this list on 2026-09-15, when `copilot --acp` was driven against the real binary and
    // answered an ACP `initialize` — see the entry's `evidence`. What replaced it is not a hope: the command was
    // measured, and `session/new`'s refusal (`Authentication required`) is recorded there.
    for (const id of ["opencode", "omp", "pi"] as const) {
      expect(isDrivableByAcpAdapter(id), id).toBe(false);
      expect(harnessTransport(id), id).toBe("cli");
    }
  });

  it("makes every agent that claims a settable mode say which field carries it", () => {
    // **The invariant behind `AcpClient.setMode`'s refusal.** The two contracts are `mode`
    // (`envoy-harness` reads `obj.mode`) and `modeId` (the specification; `cursor-agent acp` and both
    // bridges refuse `mode` with `-32602`). Neither can be defaulted: the built-in harness *accepts* an
    // unknown `modeId` by ignoring it and answering success, so a wrong guess is a silent no-op rather
    // than an error. This assertion is what keeps the client's refusal unreachable from a run — if an
    // entry ever claims `agentMode` without recording the field, this fails instead of a user's mode
    // being applied to nothing.
    const claiming = ALL_HARNESSES.filter((id) => HARNESS_CATALOG[id].capabilities.agentMode);
    expect(claiming.sort()).toEqual([
      "claudecode",
      "codex",
      "cursor",
      "envoy-harness",
    ]);
    for (const id of claiming) {
      expect(harnessAcpFacts(id).modeParam, id).toMatch(/^(mode|modeId)$/);
      expect(HARNESS_CATALOG[id].modes.length, id).toBeGreaterThan(0);
    }

    // And the entry whose mode the daemon genuinely cannot set declares nothing, so the accessor is
    // exercised in both directions rather than only where it answers.
    expect(harnessAcpFacts("deepseek-harness").modeParam).toBeUndefined();
    expect(harnessAcpFacts("deepseek-harness").authMethodId).toBeUndefined();
  });

  it("names the one agent that cannot open a session without authenticating", () => {
    // `cursor-agent acp` answers `session/new` with `-32000 Authentication required` until
    // `authenticate {methodId: 'cursor_login'}` has been sent, so this is not decoration: without it
    // the entry is drivable in principle and unusable in practice. Asserted as an exact set because
    // the failure mode of adding one wrongly is worse than adding none — a browser-login method
    // would open a window on the user's desktop, and an `env_var` method fails with the agent's own
    // sentence when the variable is unset.
    const needingAuth = ALL_HARNESSES.filter((id) => harnessAcpFacts(id).authMethodId !== undefined);
    // `copilot` joined `cursor` on 2026-09-15: its `initialize` advertises `copilot-login`, and `session/new`
    // answers `-32000 Authentication required` until the user has run `copilot login`. Asserted as an exact set,
    // because adding one wrongly is worse than adding none — see the comment above.
    expect(needingAuth.sort()).toEqual(["copilot", "cursor"]);
    expect(harnessAcpFacts("cursor").authMethodId).toBe("cursor_login");
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
