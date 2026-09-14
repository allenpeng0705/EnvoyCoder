/**
 * The catalogue's invariants, and the argv it builds.
 *
 * The most valuable assertion here is the *last* one: an agent we cannot cancel and cannot ask on
 * silently denies every escalation (DeepSeek Harness's SDK profile does exactly that). A catalogue
 * entry that claims those capabilities without a surface that provides them is a promise the UI
 * will render and the user will discover the hard way.
 */

import { describe, expect, it } from "vitest";
import { HARNESS_IDS, BUILT_IN_HARNESSES, isHarnessId, isBuiltInHarness } from "@envoycoder/protocol";
import {
  ALL_HARNESSES,
  HARNESS_CATALOG,
  buildHarnessInvocation,
  resolveHarnessCommand,
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

  it("splits built-in from catalogued exactly once, with no orphans", () => {
    // **One built-in, deliberately** (Paseo's shape): the agent we ship and stand behind. Everything
    // else needs an install, so calling it built-in would be untrue on a machine with nothing on it —
    // including `deepseek-harness`, which we author a recipe for but which still arrives as `dsh`.
    const builtIn = harnessesByTier("built-in").map((entry) => entry.id);
    const catalogued = harnessesByTier("catalogued").map((entry) => entry.id);
    expect(builtIn.sort()).toEqual(["envoy-harness"]);
    expect(builtIn.sort()).toEqual([...BUILT_IN_HARNESSES].sort());
    expect([...builtIn, ...catalogued].sort()).toEqual([...ALL_HARNESSES].sort());
    for (const id of builtIn) expect(isBuiltInHarness(id)).toBe(true);
    for (const id of catalogued) expect(isBuiltInHarness(id)).toBe(false);
    // The first-party harness is catalogued, and it must not be lonely: it is in the list, not an
    // orphan of the split.
    expect(catalogued).toContain("deepseek-harness");
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
      // **The bare id, not the provider-qualified value the task stores.** `claude --model` takes a
      // model name, not a route, so the provider half is ours to hold and not this CLI's to receive —
      // and this entry's flag surface is `unverified`, so the user's own name is passed through rather
      // than reshaped into something we have not checked it accepts.
      "claude-sonnet-4.5",
    ]);
    // Children (build tools, language servers) must die with the agent.
    expect(invocation.spawn.detached).toBe(true);
    expect(invocation.args).not.toContain("--resume");
  });

  it("drives the built-in harness over ACP, like the other native one", () => {
    // Both native harnesses are spawned and spoken to over ACP, so one adapter covers them and a
    // third-party agent that speaks it needs no new client at all.
    const launch = HARNESS_CATALOG["envoy-harness"].launch;
    expect(launch.kind).toBe("child-process");
    const invocation = buildHarnessInvocation(
      "envoy-harness",
      { prompt: "x", cwd: "/repo" },
      { platform: "linux", binaryPath: "/usr/local/bin/envoy-harness" },
    );
    expect(invocation.args).toEqual(["run", "--acp"]);
    // The prompt travels over the protocol, never in argv: an argv prompt is visible to every other
    // process on the machine, and ACP has a field for it.
    expect(invocation.args).not.toContain("x");
  });

  it("puts the chosen model into the built-in harness's argv, as the pair its dispatch reads", () => {
    // **The link that a unit test of `modelArgs` cannot cover**: that the entry's `buildArgs` *calls*
    // it. Both the installed CLI's argv and the peer-checkout entry's run through here, and they are
    // different code paths (`buildHarnessInvocation` vs `resolveHarnessCommand`), so both are asserted —
    // the model must reach the agent whichever way it was launched.
    const withModel = { prompt: "x", cwd: "/repo", model: "anthropic/claude-sonnet-4-6" };

    const installed = buildHarnessInvocation("envoy-harness", withModel, {
      platform: "linux",
      binaryPath: "/usr/local/bin/envoy-harness",
    });
    expect(installed.args).toEqual([
      "run",
      "--acp",
      "--provider",
      "anthropic",
      "--model",
      "claude-sonnet-4-6",
    ]);

    const checkout = resolveHarnessCommand(
      "envoy-harness",
      { id: "envoy-harness", available: true, binaryPath: "/peers/envoy-harness/dist/cli/acp-stdio.js", via: "node-script" },
      withModel,
    );
    // The entry supplies its own `--acp` (it is written for it), so the flags travel without it.
    expect(checkout.args).toEqual([
      "/peers/envoy-harness/dist/cli/acp-stdio.js",
      "--provider",
      "anthropic",
      "--model",
      "claude-sonnet-4-6",
    ]);

    // No model is no flags — **not** an empty `--provider`, which the harness would read as a provider
    // named "" and then fail on before it ever started the agent.
    expect(
      buildHarnessInvocation("envoy-harness", { prompt: "x", cwd: "/repo" }, {
        platform: "linux",
        binaryPath: "/usr/local/bin/envoy-harness",
      }).args,
    ).toEqual(["run", "--acp"]);

    // And a model we cannot turn into a pair throws here rather than emitting a bare `--model`, which
    // the harness parses and then ignores — a run on a model the user did not choose.
    expect(() =>
      buildHarnessInvocation("envoy-harness", { prompt: "x", cwd: "/repo", model: "gpt-4o" }, {
        platform: "linux",
        binaryPath: "/usr/local/bin/envoy-harness",
      }),
    ).toThrow(/does not publish a model/);
  });

  it("has no in-process harness left, so the argv guard is currently unreachable", () => {
    // The guard in `buildHarnessInvocation` refuses an in-process harness rather than inventing an
    // argv for it. Nothing in the catalogue is in-process today, so it cannot be triggered from
    // here — and this assertion is what tells the next person the guard is live again the moment
    // someone adds one.
    expect(HARNESS_IDS.filter((id) => HARNESS_CATALOG[id].launch.kind === "in-process")).toEqual([]);
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

  it("finds the built-in harness in the peer checkout when it is not installed", () => {
    // The harness is a peer the product clones (design D4, guide §7.5), so "not on PATH" is not the
    // same as "not available" on a development machine — and answering "install it" to somebody who
    // has it built next door is the kind of message that makes a user stop trusting the app.
    const installed = probeHarness("envoy-harness", { find: () => null, fileExists: () => false });
    expect(installed.available).toBe(false);

    const checkedOut = probeHarness("envoy-harness", { find: () => null, fileExists: () => true });
    expect(checkedOut.available).toBe(true);
    expect(checkedOut.via).toBe("node-script");
    // The path is the *checkout's* ACP entry, next to this repository.
    // Absolute and normalised: the path is built by joining the repository root with the peer's
    // relative entry, so it names a real file rather than a `..` a caller has to interpret.
    expect(checkedOut.binaryPath?.endsWith("envoy-harness/packages/envoy-harness/dist/cli/acp-stdio.js")).toBe(true);
  });

  it("launches a checkout entry with Node, and with the checkout's own argv", () => {
    const probe = probeHarness("envoy-harness", { find: () => null, fileExists: () => true });
    const resolved = resolveHarnessCommand("envoy-harness", probe, { prompt: "", cwd: "/repo" });
    // Node runs the script, rather than the script being executed directly — `via` says which, and it
    // is read from the probe rather than guessed from the file extension.
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args[0]).toBe(probe.binaryPath);
    // **Not** `run --acp`: the checkout entry *is* the ACP server and strips a duplicate flag, so
    // handing it the installed CLI's argv would be a different, wrong launch.
    expect(resolved.args.slice(1)).toEqual([]);
    expect(resolved.args).not.toContain("run");
  });

  it("launches an installed binary with the CLI's argv, not the checkout's", () => {
    const probe = probeHarness("envoy-harness", { find: () => "/usr/local/bin/envoy-harness", fileExists: () => false });
    const resolved = resolveHarnessCommand("envoy-harness", probe, { prompt: "", cwd: "/repo" });
    expect(resolved.command).toBe("/usr/local/bin/envoy-harness");
    expect(resolved.args).toEqual(["run", "--acp"]);
  });

  it("refuses to build a command for a harness that is not there, quoting the reason", () => {
    const probe = probeHarness("envoy-harness", { find: () => null, fileExists: () => false });
    // The probe's sentence is already the one a user needs, so it is passed through rather than
    // replaced with "not available".
    expect(() => resolveHarnessCommand("envoy-harness", probe, { prompt: "", cwd: "/repo" })).toThrow(
      /not installed/,
    );
  });

  it("probes a native harness for its binary, like any other spawned agent", () => {
    // Both native harnesses are driven over ACP as child processes, so "is it available?" is the
    // same question for them as for a third-party CLI: does the binary resolve? It used to be
    // answered by a module check, which claimed the built-in harness was present on every machine —
    // including ones where it is not installed at all.
    const present = probeHarness("envoy-harness", { find: () => "/usr/local/bin/envoy-harness", fileExists: () => false });
    expect(present.available).toBe(true);
    expect(present.binaryPath).toBe("/usr/local/bin/envoy-harness");
    expect(present.via).toBe("path");

    // `fileExists: false` as well, because this machine genuinely has the peer checkout — and a test
    // that asserted "absent" while the file is there would be asserting the wrong thing about the
    // code, which is how a suite starts disagreeing with the product.
    const absent = probeHarness("envoy-harness", { find: () => null, fileExists: () => false });
    expect(absent.available).toBe(false);
    // The instruction has to name the actual fix, not "something went wrong".
    expect(absent.reason).toMatch(/not installed|install/i);
  });
});
