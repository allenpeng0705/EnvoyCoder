/**
 * The catalogue's invariants, and the argv it builds.
 *
 * The most valuable assertion here is the *last* one: an agent we cannot cancel and cannot ask on
 * silently denies every escalation (DeepSeek Harness's SDK profile does exactly that). A catalogue
 * entry that claims those capabilities without a surface that provides them is a promise the UI
 * will render and the user will discover the hard way.
 */

import { describe, expect, it } from "vitest";
import { HARNESS_IDS, NATIVE_HARNESSES, isHarnessId, isNativeHarness } from "@envoycoder/protocol";
import {
  ALL_HARNESSES,
  HARNESS_CATALOG,
  buildHarnessInvocation,
  harnessDefinition,
  harnessesByTier,
  probeHarness,
  splitArgs,
} from "../src/index.js";

describe("catalogue completeness", () => {
  it("covers every harness the protocol declares, and nothing else", () => {
    expect([...ALL_HARNESSES].sort()).toEqual([...HARNESS_IDS].sort());
    for (const id of HARNESS_IDS) {
      const entry = HARNESS_CATALOG[id];
      expect(entry.id, id).toBe(id);
      expect(entry.summary.length, id).toBeGreaterThan(0);
      expect(entry.evidence.length, id).toBeGreaterThan(0);
    }
  });

  it("splits native from external exactly once, with no orphans", () => {
    const native = harnessesByTier("native").map((entry) => entry.id);
    const external = harnessesByTier("external").map((entry) => entry.id);
    expect(native.sort()).toEqual([...NATIVE_HARNESSES].sort());
    expect([...native, ...external].sort()).toEqual([...ALL_HARNESSES].sort());
    for (const id of native) expect(isNativeHarness(id)).toBe(true);
    for (const id of external) expect(isNativeHarness(id)).toBe(false);
  });

  it("guards the harness ids at runtime, since they arrive from config and from the wire", () => {
    expect(isHarnessId("codex")).toBe(true);
    expect(isHarnessId("  codex ")).toBe(true);
    expect(isHarnessId("gpt-5")).toBe(false);
  });

  it("records whether the facts were verified, so an unverified entry cannot look settled", () => {
    // Every entry must say where its invocation facts came from. An entry that does not is a
    // placeholder pretending to be an integration.
    for (const id of HARNESS_IDS) {
      const evidence = harnessDefinition(id).evidence;
      expect(evidence.length, id).toBeGreaterThan(40);
    }
    // The two we drive over a protocol we read: no `unverified` prefix.
    expect(HARNESS_CATALOG["envoy-harness"].evidence).not.toMatch(/^unverified/);
    expect(HARNESS_CATALOG["deepseek-harness"].evidence).not.toMatch(/^unverified/);
  });
});

describe("capabilities mean something", () => {
  it("only claims approvals for harnesses driven over a surface that can ask us", () => {
    // DeepSeek Harness is spawned with `--profile acp`, which has `session/request_permission`.
    // Its `sdk` profile does not, and there an escalation is denied silently — so this assertion
    // is what stops someone "simplifying" the profile flag later.
    expect(HARNESS_CATALOG["deepseek-harness"].capabilities.approvals).toBe(true);
    expect(HARNESS_CATALOG["deepseek-harness"].launch).toMatchObject({
      kind: "child-process",
      binaries: ["dsh"],
    });
    const args =
      HARNESS_CATALOG["deepseek-harness"].launch.kind === "child-process"
        ? HARNESS_CATALOG["deepseek-harness"].launch.buildArgs({
            prompt: "x",
            cwd: "/repo",
          })
        : [];
    expect(args).toEqual(["--profile", "acp"]);
  });

  it("marks text-only agents as unstructured, so the UI does not promise a diff panel", () => {
    for (const id of ["copilot", "opencode", "pi"] as const) {
      const launch = HARNESS_CATALOG[id].launch;
      expect(launch.kind === "child-process" && launch.stream, id).toBe("text");
      expect(HARNESS_CATALOG[id].capabilities.structuredTools, id).toBe(false);
    }
  });
});

describe("invocation", () => {
  it("builds argv for a child-process harness, with process-group spawn options", () => {
    const invocation = buildHarnessInvocation(
      "claudecode",
      { prompt: "add tests", model: "anthropic/claude-sonnet-4.5", cwd: "/repo" },
      { platform: "linux", binaryPath: "/usr/local/bin/claude" },
    );
    expect(invocation.command).toBe("/usr/local/bin/claude");
    expect(invocation.args).toEqual([
      "-p",
      "add tests",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "anthropic/claude-sonnet-4.5",
    ]);
    // Children (build tools, language servers) must die with the agent.
    expect(invocation.spawn.detached).toBe(true);
    expect(invocation.args).not.toContain("--resume");
  });

  it("refuses to build argv for an in-process harness instead of inventing one", () => {
    expect(() => buildHarnessInvocation("envoy-harness", { prompt: "x", cwd: "/repo" })).toThrow(
      /in-process harness/,
    );
  });

  it("keeps a quoted path in one piece — an argument split in half reads as a missing project", () => {
    expect(splitArgs('--flag "C:\\Program Files\\app" --other')).toEqual([
      "--flag",
      "C:\\Program Files\\app",
      "--other",
    ]);
    expect(splitArgs("   ")).toEqual([]);
    expect(splitArgs(undefined)).toEqual([]);
    expect(splitArgs("'single quoted' plain")).toEqual(["single quoted", "plain"]);
  });
});

describe("probing", () => {
  it("reports a missing external agent with the command that installs it", () => {
    const probe = probeHarness("claudecode", { platform: "linux", find: () => null });
    expect(probe.available).toBe(false);
    expect(probe.reason).toMatch(/not installed/);
    expect(probe.reason).toMatch(/npm install -g/);
  });

  it("reports the resolved path when the agent is present", () => {
    const probe = probeHarness("codex", { platform: "linux", find: () => "/usr/bin/codex" });
    expect(probe).toMatchObject({ available: true, binaryPath: "/usr/bin/codex" });
  });

  it("treats a native harness as present unless its runtime is missing", () => {
    expect(probeHarness("envoy-harness", { moduleAvailable: () => true }).available).toBe(true);
    const missing = probeHarness("envoy-harness", { moduleAvailable: () => false });
    expect(missing.available).toBe(false);
    // The instruction has to name the actual fix, not "something went wrong".
    expect(missing.reason).toMatch(/peers:check/);
  });
});
