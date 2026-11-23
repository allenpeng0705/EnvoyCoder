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
  isDrivable,
  isDrivableByAcpAdapter,
} from "../src/index.js";

describe("which agents this product can actually run", () => {
  it("drives ACP agents via the ACP adapter — and no others on that adapter", () => {
    const acp = ALL_HARNESSES.filter((id) => isDrivableByAcpAdapter(id));
    // OpenCode joined when catalogue switched to `opencode acp` (docs). Exact list — an entry that
    // claims ACP we cannot drive would be offered as ready and fail at the first run.
    expect(acp.sort()).toEqual([
      "claudecode",
      "codex",
      "copilot",
      "cursor",
      "deepseek-harness",
      "envoy-harness",
      "opencode",
    ]);

    for (const id of acp) {
      expect(harnessTransport(id)).toBe("acp");
      expect(isDrivable(id)).toBe(true);
      const launch = HARNESS_CATALOG[id].launch;
      expect(launch.kind).toBe("child-process");
    }
  });

  it("drives OMP and Pi over JSONL RPC (rpc-ui), not ACP", () => {
    expect(isDrivableByAcpAdapter("omp")).toBe(false);
    expect(isDrivableByAcpAdapter("pi")).toBe(false);
    expect(isDrivable("omp")).toBe(true);
    expect(isDrivable("pi")).toBe(true);
    expect(harnessTransport("omp")).toBe("rpc-ui");
    expect(harnessTransport("pi")).toBe("rpc-ui");
  });

  it("records a transport for every entry, so nothing is silently undrivable", () => {
    for (const id of ALL_HARNESSES) {
      const transport = harnessTransport(id);
      expect(["acp", "cli", "rpc-ui", "in-process"]).toContain(transport);
      expect(isDrivableByAcpAdapter(id)).toBe(transport === "acp");
      expect(isDrivable(id)).toBe(transport === "acp" || transport === "rpc-ui");
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
      "deepseek-harness",
      "envoy-harness",
      "opencode",
    ]);
    // DeepSeek's permission levels travel as `DSH_PERMISSION_MODE`, not `session/set_mode`. Every
    // other claiming entry still has to name the field, or `setMode` would guess and the peer
    // would ignore it.
    for (const id of claiming) {
      if (id === "deepseek-harness") {
        expect(harnessAcpFacts(id).modeParam, id).toBeUndefined();
      } else {
        expect(harnessAcpFacts(id).modeParam, id).toMatch(/^(mode|modeId)$/);
      }
      expect(HARNESS_CATALOG[id].modes.length, id).toBeGreaterThan(0);
    }

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
    expect(needingAuth.sort()).toEqual(["copilot", "cursor", "opencode"]);
    expect(harnessAcpFacts("cursor").authMethodId).toBe("cursor_login");
    expect(harnessAcpFacts("opencode").authMethodId).toBe("opencode-login");
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
  it("names the three permission levels, and not a working mode", () => {
    // The first three are `session/set_mode` (`ModeKind`). The last three are `session/set_policy`
    // sandboxes — sending one of them as a mode is refused with `mode must be default|plan|review`.
    expect(HARNESS_CATALOG["envoy-harness"].modes.map((mode) => mode.id)).toEqual([
      "read-only",
      "workspace-write",
      "danger-full-access",
    ]);
    expect(HARNESS_CATALOG["envoy-harness"].modes.find((mode) => mode.preferred)?.id).toBe(
      "workspace-write",
    );
    expect(HARNESS_CATALOG["envoy-harness"].capabilities.agentMode).toBe(true);
  });

  it("offers DeepSeek the three permission levels without a session/set_mode field", () => {
    // The process reads `DSH_PERMISSION_MODE`. `workspace-write` is preferred because that is the
    // default when the variable is unset.
    expect(HARNESS_CATALOG["deepseek-harness"].modes.map((mode) => mode.id)).toEqual([
      "read-only",
      "workspace-write",
      "danger-full-access",
    ]);
    expect(HARNESS_CATALOG["deepseek-harness"].modes.find((mode) => mode.preferred)?.id).toBe(
      "workspace-write",
    );
    expect(HARNESS_CATALOG["deepseek-harness"].capabilities.agentMode).toBe(true);
    expect(harnessAcpFacts("deepseek-harness").modeParam).toBeUndefined();
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
