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
      { platform: "linux", binaryPath: "/usr/local/bin/claude-agent-acp" },
    );
    expect(invocation.command).toBe("/usr/local/bin/claude-agent-acp");
    // **Empty, and that is the assertion.** This entry used to build
    // `-p <prompt> --output-format stream-json --verbose --model <id>` for the plain `claude` CLI, which
    // answers no ACP `initialize` at all. The program it launches now *is* the ACP server, so a prompt,
    // a model id or a resume id in argv would be handed to something that reads none of them: the
    // prompt travels over the protocol, the model as a session config option (`../src/models.ts`), and a
    // resume as `session/resume`.
    expect(invocation.args).toEqual([]);
    // Children (build tools, language servers) must die with the agent.
    expect(invocation.spawn.detached).toBe(true);
    expect(invocation.args).not.toContain("--resume");
    // And the prompt is nowhere in argv — true for every ACP agent, asserted for the three this slice
    // moved onto ACP, because an argv prompt is a regression that no surface would otherwise notice.
    for (const id of ["claudecode", "codex", "cursor"] as const) {
      const built = buildHarnessInvocation(
        id,
        { prompt: "SECRET-PROMPT", cwd: "/repo" },
        { platform: "linux", binaryPath: "/usr/local/bin/agent" },
      );
      expect(built.args.join(" "), id).not.toContain("SECRET-PROMPT");
    }
  });

  it("passes the user's own extra arguments through, and nothing else", () => {
    const invocation = buildHarnessInvocation(
      "claudecode",
      { prompt: "ignored", cwd: "/repo", extraArgs: '--debug "two words"' },
      { platform: "linux", binaryPath: "/usr/local/bin/claude-agent-acp" },
    );
    expect(invocation.args).toEqual(["--debug", "two words"]);
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
      { id: "envoy-harness", state: "ready", binaryPath: "/peers/envoy-harness/dist/cli/acp-stdio.js", via: "node-script" },
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
  it("reports a missing agent as `not-installed`, with the commands that install it", () => {
    const probe = probeHarness("claudecode", { platform: "linux", find: () => null });
    expect(probe.state).toBe("not-installed");
    expect(probe.reason).toMatch(/not installed/);
    expect(probe.reason).toMatch(/npm install -g/);
    // **Two steps, in the order they must be run.** The agent and the adapter over it are two installs, and
    // a row that named one would leave the user at the other a minute later. This is also what rule 4 of
    // `HarnessAvailabilitySchema` requires of a state that asserts an absence.
    expect(probe.fix?.map((step) => step.command)).toEqual([
      "install Claude Code itself: `claude install` (native), or `npm install -g @anthropic-ai/claude-code`",
      "npm install -g @agentclientprotocol/claude-agent-acp",
    ]);
  });

  it("reports a missing *bridge* as `needs-bridge`, and never as `not installed`", () => {
    // **The reported bug, as an assertion.** The user had installed Claude Code and Codex; the probe looked
    // for the ACP bridges, which nobody had installed and which the user had never been told to install, and
    // the row said "Not installed" about the agent. `claude` resolving and `claude-agent-acp` not resolving is
    // its own state, and it names what was *found* as well as what is missing.
    const probe = probeHarness("claudecode", {
      platform: "linux",
      find: (name) => (name === "claude" ? "/home/you/.local/bin/claude" : null),
      fileExists: () => false,
    });
    expect(probe.state).toBe("needs-bridge");
    expect(probe.agentBinaryPath).toBe("/home/you/.local/bin/claude");
    // The thing we drive was *not* found, so no path claims it was.
    expect(probe.binaryPath).toBeUndefined();
    // The fix is the adapter alone — the agent is already there — and the sentence says so.
    expect(probe.fix?.map((step) => step.command)).toEqual([
      "npm install -g @agentclientprotocol/claude-agent-acp",
    ]);
    expect(probe.reason).toMatch(/is installed at \/home\/you\/\.local\/bin\/claude/);
    expect(probe.reason).toMatch(/adapter/);
    // And the word that was wrong never appears about the agent.
    expect(probe.reason).not.toMatch(/not installed\(looked for claude\)/);
  });

  it("reports `unsupported` for an installed agent whose protocol this build cannot speak", () => {
    // The catalogue's own doctrine — **being installed is not being drivable** — as a state rather than as a
    // green chip contradicted by `launchForHarness`. `copilot` is `transport: "cli"`.
    const probe = probeHarness("copilot", { platform: "linux", find: () => "/usr/local/bin/copilot" });
    expect(probe).toMatchObject({ state: "unsupported", binaryPath: "/usr/local/bin/copilot" });
    // Nothing to install: the gap is ours, so no install command may be offered.
    expect(probe.fix).toBeUndefined();
  });

  it("reports `unknown`, not `not-installed`, when there was no search path to look on", () => {
    // The one rule the `unknown` state exists for. A daemon that could not assemble a list has not
    // established that anything is absent, and "not installed" would be our blindness stated as a fact about
    // the user's machine.
    const probe = probeHarness("claudecode", {
      platform: "linux",
      find: () => null,
      fileExists: () => false,
      searchable: false,
    });
    expect(probe.state).toBe("unknown");
    expect(probe.fix).toBeUndefined();
    expect(probe.reason).toMatch(/could not tell whether/);
    // The same inputs over a search that *did* run are a real negative, and that is a different state.
    expect(
      probeHarness("claudecode", { platform: "linux", find: () => null, fileExists: () => false, searchable: true }).state,
    ).toBe("not-installed");
  });

  it("reports the resolved path when the program we drive is present", () => {
    const probe = probeHarness("codex", { platform: "linux", find: () => "/usr/bin/codex-acp" });
    expect(probe).toMatchObject({ state: "ready", binaryPath: "/usr/bin/codex-acp" });
  });

  it("marks a program found in another tool's cache as provisional, and still counts it as ready", () => {
    // **The `dsh` question, decided rather than dodged.** `dsh` resolves out of
    // `~/.npm/_npx/<hash>/node_modules/.bin` on the machine this was written on — a directory belonging to
    // somebody else's `npx` invocation. It is a real program and this repository drives it for real
    // (`acp-transport.test.ts`), so "not installed" would be a lie; but it disappears with `npm cache clean`,
    // so saying nothing would hide the fragility. Ready **and** marked.
    const npx = probeHarness("deepseek-harness", {
      platform: "linux",
      find: () => "/home/you/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh",
    });
    expect(npx).toMatchObject({
      state: "ready",
      provisional: "npx",
      binaryPath: "/home/you/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh",
    });

    // A real installation carries no such marker, which is what makes the marker mean something.
    const installed = probeHarness("deepseek-harness", { platform: "linux", find: () => "/usr/local/bin/dsh" });
    expect(installed.state).toBe("ready");
    expect(installed.provisional).toBeUndefined();
  });

  it("drives the ACP program each entry actually launches, and asks about the vendor CLI only to diagnose", () => {
    // **The point of the slice that introduced the bridges, kept as an assertion, and the order it added.**
    // `claude` and `codex` are the CLIs a user installs, and neither speaks ACP; the programs we *spawn* are
    // the bridges. So `binaries` — what we launch — is asked first and decides `ready`.
    //
    // What this test now also pins is the second question, which is the fix for the bug report: when the
    // bridge is absent we ask about the **agent's own** program, purely to be able to say which of the two is
    // missing. Asked *after*, never instead: a probe that reached for the vendor CLI first would report
    // `needs-bridge` on a machine where everything is installed.
    const looked: string[] = [];
    for (const id of ["claudecode", "codex", "cursor"] as const) {
      looked.length = 0;
      probeHarness(id, {
        platform: "linux",
        find: (name: string) => {
          looked.push(name);
          return null;
        },
        fileExists: () => false,
      });
      const launch = HARNESS_CATALOG[id].launch;
      if (launch.kind !== "child-process") throw new Error(`${id} is not a child-process entry`);
      // The search order, spelled out: the driven program first, then the agent's own if the entry declares
      // one. Deduplicated, so an entry that drives the agent itself (`cursor`) asks once.
      expect(looked, id).toEqual([...new Set([...launch.binaries, ...(launch.agentBinaries ?? [])])]);
    }
    expect(HARNESS_CATALOG.claudecode.launch).toMatchObject({
      binaries: ["claude-agent-acp"],
      agentBinaries: ["claude"],
    });
    expect(HARNESS_CATALOG.codex.launch).toMatchObject({
      binaries: ["codex-acp"],
      agentBinaries: ["codex"],
    });
    expect(HARNESS_CATALOG.cursor.launch).toMatchObject({ binaries: ["cursor-agent"] });
    // `cursor-agent`'s ACP mode is a *subcommand*, not a second package, so there is nothing to bridge and
    // `needs-bridge` can never be its state. Stated rather than left to the reader of an omission.
    expect(HARNESS_CATALOG.cursor.launch).not.toHaveProperty("agentBinaries");
  });

  it("finds the built-in harness in the peer checkout when it is not installed", () => {
    // The harness is a peer the product clones (design D4, guide §7.5), so "not on PATH" is not the
    // same as "not available" on a development machine — and answering "install it" to somebody who
    // has it built next door is the kind of message that makes a user stop trusting the app.
    const installed = probeHarness("envoy-harness", { find: () => null, fileExists: () => false });
    expect(installed.state).toBe("not-installed");

    const checkedOut = probeHarness("envoy-harness", { find: () => null, fileExists: () => true });
    expect(checkedOut.state).toBe("ready");
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
    expect(present.state).toBe("ready");
    expect(present.binaryPath).toBe("/usr/local/bin/envoy-harness");
    expect(present.via).toBe("path");

    // `fileExists: false` as well, because this machine genuinely has the peer checkout — and a test
    // that asserted "absent" while the file is there would be asserting the wrong thing about the
    // code, which is how a suite starts disagreeing with the product.
    const absent = probeHarness("envoy-harness", { find: () => null, fileExists: () => false });
    expect(absent.state).toBe("not-installed");
    // The instruction has to name the actual fix, not "something went wrong".
    expect(absent.reason).toMatch(/not installed|install/i);
  });
});
