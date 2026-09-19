/**
 * **One `PATH` for probing and for launching** — the rule that stops a green row from lying.
 *
 * ## Why this file is separate, and what it would catch
 *
 * `launchForHarness` asks two questions of the same list: "is the program there?" (through `probeHarness`) and
 * "what will the child see?" (through the `PATH` in the launch's environment). They were two different lists
 * before this slice — the probe used whatever `process.env` happened to hold and the child inherited the same
 * — which is invisible while both agree and produces the worst possible bug when they do not: an agent that
 * **shows as installed and cannot run**, because the bridge we spawn looks for the CLI it wraps on a `PATH` we
 * did not give it. That failure reads to a user as "the agent is broken", and no test of either half alone
 * would have caught it.
 *
 * So the assertions here are on the *pair*: the same directory makes the probe resolve the program **and**
 * reaches the spawned process. The spawn half is a **real child process** (`node:child_process`, exactly what
 * `AcpClient` does with `{ ...process.env, ...launch.env }`), not an inspection of the options object — because
 * the claim under test is about what the OS hands the child, not about what we meant to hand it.
 *
 * The fixture is a shell script named `claude-agent-acp` rather than an npm package: a bridge is a program on
 * `PATH`, which is the only thing either half of this looks at, and a real install of the Claude bridge is the
 * user's rather than this repository's (`acp-agent-support.test.ts` drives the real ones, and skips when they
 * are absent).
 */

import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  bridgePackage,
  fetchedRecipe,
  fetchableCovers,
  fetchablePackage,
  probeHarness,
  probeProvider,
} from "@envoydev/agent-catalog";
import { ENVOYDEV_ERRORS, coderErrorCode, coderErrorRef, type AgentProviderConfig } from "@envoydev/protocol";
import { coderPaths } from "@envoydev/host-bridge";
import {
  composeSearchPath,
  LOGIN_SHELL_BINARY_MARKER,
  primeShellBinaries,
  provisionalCacheOf,
  resetSearchPathCacheForTests,
  resetShellBinaryCacheForTests,
} from "@envoydev/platform";

import { launchForHarness, launchForProvider } from "../src/daemon/launch.js";

/**
 * **POSIX-only legs, one gate for the whole file.**
 *
 * Two mechanisms here are POSIX by design: asking a login shell where a program is, and running a fetched
 * connector through a script on `PATH` (`packages/platform` says the same about both — Windows' registry `PATH`
 * already reaches a GUI process, so there is nothing to repair there). The skip prints, because a silent skip is a
 * green light for something nobody ran.
 */
const posixOnly = process.platform === "win32" ? it.skip : it;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return dir;
}

/**
 * An executable in `dir` that writes the `PATH` it was given to a sibling file, and exits.
 *
 * `#!/bin/sh` + `printf` rather than a Node script, so the binary needs no interpreter on the search path and
 * the assertion is about the environment alone.
 */
async function bridgeIn(dir: string, name = "claude-agent-acp"): Promise<void> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\nprintf '%s' "$PATH" > '${join(dir, "child-path.txt")}'\n`);
  await chmod(path, 0o755);
}


/** `mkdir -p` for a fixture path, so the npx-cache layout can be built without a package manager. */
async function mkdirRecursive(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Spawn the launch the way `AcpClient` does, and hand back what the child wrote. */
async function pathSeenByChild(
  launch: { command: string; args: readonly string[]; env?: Record<string, string> },
): Promise<string> {
  const child = spawn(launch.command, [...launch.args], {
    env: { ...process.env, ...launch.env },
    stdio: "ignore",
  });
  await new Promise((resolve) => child.on("exit", resolve));
  // The report file is the sibling of the program, which is how the fixture was written.
  return readFile(join(launch.command, "..", "child-path.txt"), "utf8");
}

describe("probing and spawning use the same PATH", () => {
  it("resolves the program from the given list, and hands the same list to the child", async () => {
    const binDir = await tempDir("envoydev-search-bin-");
    await bridgeIn(binDir);
    const cwd = await tempDir("envoydev-search-cwd-");
    const home = await tempDir("envoydev-search-home-");

    // The probe finds it in the *given* list. Nothing about this machine matters: the directory is a temp one.
    const probe = probeHarness("claudecode", { pathDirs: [binDir] });
    expect(probe.state).toBe("ready");
    expect(probe.binaryPath).toBe(join(binDir, "claude-agent-acp"));

    const launch = launchForHarness({
      harness: "claudecode",
      cwd,
      paths: coderPaths(home),
      searchDirs: [binDir],
    });
    // The launch names the *same* absolute path the probe resolved, rather than the bare binary name — which is
    // what makes the spawn independent of the child's own search path.
    expect(launch.command).toBe(join(binDir, "claude-agent-acp"));
    expect(launch.env?.PATH?.split(":")[0]).toBe(binDir);

    // **And the child really sees it.** The assertion that makes this test worth having: the program ran, so
    // the list reached the process, and a bridge that spawns `claude` would find it.
    expect((await pathSeenByChild(launch)).split(":")[0]).toBe(binDir);
  });

  it("hands the child the whole list, so a bridge can find the CLI it wraps", async () => {
    // The realistic shape: the bridge is in one directory and the CLI it spawns is in another, and the child
    // needs both. A launch that passed only the resolved program's directory would start the bridge and then
    // lose the agent — "it is installed and it cannot run", which is the failure this rule prevents.
    const bridgeDir = await tempDir("envoydev-search-bridge-");
    const agentDir = await tempDir("envoydev-search-agent-");
    await bridgeIn(bridgeDir);
    const cwd = await tempDir("envoydev-search-cwd-");
    const home = await tempDir("envoydev-search-home-");

    const launch = launchForHarness({
      harness: "claudecode",
      cwd,
      paths: coderPaths(home),
      searchDirs: [bridgeDir, agentDir],
    });
    const seen = await pathSeenByChild(launch);
    expect(seen.split(":").slice(0, 2)).toEqual([bridgeDir, agentDir]);
  });

  it("says the same thing in both halves when the program is not there", async () => {
    // The failing direction of the same rule. An empty list must make the probe report a state that names the
    // fix **and** make the launch refuse with that sentence — not resolve optimistically and then fail at
    // `spawn`. `needs-bridge` here because the fixture also holds a `claude`, which is the reported bug's shape:
    // the agent is installed and the adapter is not.
    const binDir = await tempDir("envoydev-search-agentonly-");
    await bridgeIn(binDir, "claude");
    const cwd = await tempDir("envoydev-search-cwd-");
    const home = await tempDir("envoydev-search-home-");

    const probe = probeHarness("claudecode", { pathDirs: [binDir] });
    expect(probe.state).toBe("needs-bridge");

    let thrown: Error | undefined;
    try {
      launchForHarness({ harness: "claudecode", cwd, paths: coderPaths(home), searchDirs: [binDir] });
    } catch (error) {
      thrown = error instanceof Error ? error : new Error(String(error));
    }
    expect(thrown, "the launch resolved an agent that cannot be driven").toBeDefined();
    // The refusal carries the adapter's install command, which is the whole reason the state exists.
    expect(thrown?.message).toContain("npm install -g @agentclientprotocol/claude-agent-acp");
    expect(thrown?.message).toMatch(/is installed at/);
  });

  /**
   * **Three refusals, three codes — because the sentence a user reads depends on the code.**
   *
   * This test exists because widening the availability field quietly broke it: with `unsupported` as a real
   * state, an installed agent we cannot drive (`copilot`, `opencode`, `omp`, `pi`) fell into the generic
   * "not ready" branch and came back as `harnessMissing` — whose translated sentence is *"X is not installed on
   * this machine. Install it, then start the task again."* Telling a user with Copilot installed that it is not
   * installed, and to install it, is the exact bug report this whole change answers; the ordering in
   * `launchForHarness` is what keeps the three apart, and it is asserted here rather than trusted.
   *
   * The codes are read the way a client reads them (`coderErrorCode` / `coderErrorRef`), not from the English
   * prose, because the prose is the half a translated window never shows.
   */
  it("refuses an undrivable, an absent and an unverifiable agent with three different codes", async () => {
    const cwd = await tempDir("envoydev-refusal-cwd-");
    const home = await tempDir("envoydev-refusal-home-");
    const empty = await tempDir("envoydev-refusal-empty-");
    const called = (harm: "claudecode" | "opencode", dirs: readonly string[]): Error => {
      try {
        launchForHarness({ harness: harm, cwd, paths: coderPaths(home), searchDirs: dirs });
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
      throw new Error(`${harm} was launched when it should have been refused`);
    };

    // 1. Installed and undrivable: `opencode` is `transport: "cli"`, and the list holds an `opencode` binary.
    //
    // `copilot` was this leg's example until 2026-09-15, when its own `--acp` server was measured and it became
    // drivable — the state this leg asserts is "installed, and we have no adapter", which has to be shown by an
    // agent that really is undrivable.
    const undrivableDir = await tempDir("envoydev-refusal-undrivable-");
    await bridgeIn(undrivableDir, "opencode");
    const undrivable = called("opencode", [undrivableDir]);
    expect(coderErrorCode(undrivable.message)).toBe(ENVOYDEV_ERRORS.harnessUnsupported);
    expect(coderErrorRef(undrivable.message)?.key).toBe("error.harnessUnsupported");
    // And not the sentence that tells them to install what they already have.
    expect(coderErrorRef(undrivable.message)?.key).not.toBe("error.harnessMissing");

    // 2. Absent, over a search that ran: the agent's own CLI and its adapter are both missing.
    const missing = called("claudecode", [empty]);
    expect(coderErrorCode(missing.message)).toBe(ENVOYDEV_ERRORS.harnessMissing);
    expect(coderErrorRef(missing.message)?.key).toBe("error.harnessMissing");
    // The English detail — the half that reaches the log — names both install steps.
    expect(missing.message).toContain("npm install -g @agentclientprotocol/claude-agent-acp");

    // 3. Unverifiable: an **empty** list, which says "there was nothing to search with" rather than "we
    //    searched and found nothing". A **different** code, because "we could not look" must never be
    //    translated as "it is not installed" — the one claim requirement this state exists for.
    const unverifiable = called("claudecode", []);
    expect(coderErrorCode(unverifiable.message)).toBe(ENVOYDEV_ERRORS.harnessUnknown);
    expect(coderErrorRef(unverifiable.message)?.key).toBe("error.harnessUnknown");
    expect(coderErrorRef(unverifiable.message)?.key).not.toBe("error.harnessMissing");
    // And the three codes really are three: no two of these refusals can be mistaken for one another.
    expect(
      new Set([
        coderErrorCode(undrivable.message),
        coderErrorCode(missing.message),
        coderErrorCode(unverifiable.message),
      ]).size,
    ).toBe(3);
  });

  it("never searches the daemon's own environment once a list is given", async () => {
    // The bug in one assertion. A machine *with* the bridge on the ambient `PATH` and *without* it in the given
    // list must report it missing: an implementation that merged the two would say "ready" here, which is
    // exactly what a GUI-launched daemon did about every agent the user had installed.
    const empty = await tempDir("envoydev-search-empty-");
    // `PATH` is deliberately the real one, which on any machine that has the bridge would resolve it.
    const probe = probeHarness("claudecode", { pathDirs: [empty], env: process.env });
    expect(probe.state).not.toBe("ready");
    expect(probe.binaryPath).toBeUndefined();
  });
});

/**
 * **The two states the owner reported**, and the invariant that keeps them honest.
 *
 * The report was *"Some agents I have installed, but still show need to install or need adapter. Eg, codex,
 * claudecode, deepseek-harness."* The tests below are the two halves of that:
 *
 *   * `deepseek-harness` read as **not installed** although its owner runs it every day, because `dsh` lives in
 *     npm's `npx` cache — a directory that is on no `PATH` a daemon can reconstruct (`cacheBinDirs`,
 *     `packages/platform/test/shell-binaries.test.ts` carries the measurement). Here it is the same fact end to
 *     end: the probe says `ready`, it says *where*, and the launch starts **that** file.
 *   * `codex` and `claudecode` were measured **correctly** (`needs-bridge`: the agent is there and its adapter
 *     is not) and read wrongly, which is a view problem and is fixed in `settings/AgentRow.tsx`. What this file
 *     asserts about it is the half a view can break: the state and the fix stay what they were.
 *
 * And the invariant both rest on, stated once and asserted here rather than assumed: **the program the probe
 * resolved is the program the launch runs.** A row that says "missing" while the launch works is the same bug
 * one step further along.
 */
describe("a program only the user's own shell resolves", () => {
  afterEach(() => {
    resetShellBinaryCacheForTests();
    resetSearchPathCacheForTests();
  });

  // POSIX-only: this leg asks a login shell, which is a POSIX mechanism by design (`readLoginShellBinaries`
  // returns `not-posix` on Windows, where the registry `PATH` already reaches a GUI process). It says so rather
  // than passing vacuously.
  posixOnly("reads as installed, not missing — and the launch runs exactly what the probe found", async () => {
    const dir = await tempDir("envoydev-shell-only-");
    await bridgeIn(dir, "only-in-my-shell");
    const cwd = await tempDir("envoydev-shell-cwd-");
    const home = await tempDir("envoydev-shell-home-");

    // A shell that names a program nothing else on this machine can find: not on the daemon's `PATH`, not in a
    // well-known directory, not in a tool cache. `command -v` is the only thing that knows about it, which is
    // the case the per-name ask exists for.
    resetShellBinaryCacheForTests();
    resetSearchPathCacheForTests();
    await primeShellBinaries(["only-in-my-shell"], {
      command: {
        command: "/bin/sh",
        args: [
          "-c",
          `printf '%b' '${LOGIN_SHELL_BINARY_MARKER}only-in-my-shell\\t${join(dir, "only-in-my-shell")}\\n'`,
        ],
      },
    });

    const search = composeSearchPath();
    expect(search.shellBinaries.map((entry) => entry.name)).toEqual(["only-in-my-shell"]);
    expect(search.dirs[0]).toBe(dir);

    const provider: AgentProviderConfig = {
      id: "mine",
      label: "A Program Only My Shell Knows",
      command: "only-in-my-shell",
      args: [],
      env: [],
      transport: "acp",
    };
    const probe = probeProvider(provider, {
      pathDirs: search.dirs,
      searchable: search.searchable,
    });
    // **Installed.** Before this slice the same machine answered `not-installed` for a program its shell
    // resolves, which is the report verbatim.
    expect(probe.state).toBe("ready");
    expect(probe.binaryPath).toBe(join(dir, "only-in-my-shell"));

    const launch = launchForProvider({
      provider,
      cwd,
      paths: coderPaths(home),
      searchDirs: search.dirs,
    });
    // **The invariant: one resolution, two callers.** The launch names the path the probe resolved, and the
    // child's `PATH` contains the directory the answer contributed — so a bridge that spawns the CLI it wraps
    // finds it for the same reason the probe did.
    expect(launch.command).toBe(probe.binaryPath);
    expect(launch.env?.PATH?.split(":")[0]).toBe(dir);
  });

  it("reads `deepseek-harness` as ready from npm's npx cache, and the launch runs that copy", async () => {
    // **The reported row.** The fixture is the real layout — `<home>/.npm/_npx/<hash>/node_modules/.bin/dsh` —
    // and the search list is composed from a home in which that is the *only* place `dsh` exists. The probe
    // reports `ready` with the provenance the window renders as its warning chip, and the launch runs the file.
    const home = await tempDir("envoydev-npx-home-");
    const binDir = join(home, ".npm", "_npx", "1e7f6d9597241db0", "node_modules", ".bin");
    await mkdirRecursive(binDir);
    await bridgeIn(binDir, "dsh");
    const cwd = await tempDir("envoydev-npx-cwd-");

    resetShellBinaryCacheForTests();
    resetSearchPathCacheForTests();
    const search = composeSearchPath({ home, processPath: "/usr/bin:/bin", loginShell: undefined });
    expect(search.cached).toEqual([binDir]);

    const probe = probeHarness("deepseek-harness", {
      pathDirs: search.dirs,
      searchable: search.searchable,
    });
    expect(probe.state).toBe("ready");
    expect(probe.binaryPath).toBe(join(binDir, "dsh"));
    // A hit in another tool's cache is still reported as one: it works, and it can vanish.
    expect(provisionalCacheOf(probe.binaryPath!)).toBe("npx");

    const launch = launchForHarness({
      harness: "deepseek-harness",
      cwd,
      paths: coderPaths(home),
      searchDirs: search.dirs,
    });
    expect(launch.command).toBe(probe.binaryPath);
  });

  it("keeps `codex` and `claudecode` at needs-bridge, with the adapter's own command", async () => {
    // The other two rows of the report: measured correctly, and they must stay that way. The agent's CLI is
    // present and its ACP adapter is not, so the state names the missing *half* — and the fix is the adapter's
    // install step, never the agent's (which would tell a user to install what they already have).
    const dir = await tempDir("envoydev-needsbridge-");
    await bridgeIn(dir, "codex");
    await bridgeIn(dir, "claude");
    const cwd = await tempDir("envoydev-needsbridge-cwd-");
    const home = await tempDir("envoydev-needsbridge-home-");

    resetShellBinaryCacheForTests();
    resetSearchPathCacheForTests();
    for (const [harness, agentBinary, command] of [
      ["codex", "codex", "npm install -g @agentclientprotocol/codex-acp"],
      ["claudecode", "claude", "npm install -g @agentclientprotocol/claude-agent-acp"],
    ] as const) {
      const probe = probeHarness(harness, { pathDirs: [dir] });
      expect(probe.state, harness).toBe("needs-bridge");
      expect(probe.agentBinaryPath).toBe(join(dir, agentBinary));
      expect(probe.fix?.map((step) => step.command)).toEqual([command]);
      // And the launch refuses with that same sentence rather than resolving an agent it cannot drive.
      let thrown: Error | undefined;
      try {
        launchForHarness({ harness, cwd, paths: coderPaths(home), searchDirs: [dir] });
      } catch (error) {
        thrown = error instanceof Error ? error : new Error(String(error));
      }
      expect(thrown?.message).toContain(command);
    }
  });
});

/**
 * **The fetched delivery: `npx -y <package>` instead of an installed connector.**
 *
 * The owner's last piece of *"resolve it without leaving the app"*: an agent whose connector is published on npm
 * can be run without installing anything, by fetching it into npm's cache on the first run. What these legs pin
 * is that the route is a *different program* rather than a flag on the same one — `npx` is what the probe looks
 * for, `npx` is what is spawned, and the bridge's package comes from the catalogue rather than from a stored
 * preference (so a catalogue rename is not a migration of anybody's setting).
 *
 * The fixture is a `npx` **script** in a temporary directory, which is the same shape the installed-route legs
 * above use for a bridge: the claim is about argv and about which program was probed, and both are answerable
 * without downloading anything.
 */
describe("a connector that is fetched rather than installed", () => {
  posixOnly("launches `npx -y <package>`, resolved through the search path", async () => {
    resetSearchPathCacheForTests();
    resetShellBinaryCacheForTests();
    const dir = await mkdtemp(join(tmpdir(), "envoydev-npx-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    // A stand-in for `npx`, and nothing else: what is asserted is the argv, not npm's behaviour.
    await writeFile(join(dir, "npx"), "#!/bin/sh\nexit 0\n");
    await chmod(join(dir, "npx"), 0o755);

    const launch = launchForHarness({
      harness: "codex",
      cwd: dir,
      paths: coderPaths(dir),
      searchDirs: [dir],
      delivery: "npx",
    });

    // **The resolved path, not the bare name** — the same rule every other launch follows.
    expect(launch.command).toBe(join(dir, "npx"));
    expect(launch.args).toEqual(["-y", "@agentclientprotocol/codex-acp"]);

    resetSearchPathCacheForTests();
    resetShellBinaryCacheForTests();
  });

  posixOnly("refuses the route when `npx` is not on the machine, rather than pretending", async () => {
    // A delivery is a claim about what will run. With no `npx` there is no route, and the refusal is the *missing*
    // one — the program the probe looked for is absent — not a launch that fails later with a confusing error.
    resetSearchPathCacheForTests();
    const dir = await mkdtemp(join(tmpdir(), "envoydev-no-npx-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    // `coderErrorCode` reads the *message*, which is the wire's form of a coded refusal (see its own doc).
    let message = "";
    try {
      launchForHarness({
        harness: "codex",
        cwd: dir,
        paths: coderPaths(dir),
        searchDirs: [dir],
        delivery: "npx",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(coderErrorCode(message)).toBe(ENVOYDEV_ERRORS.harnessMissing);
    resetSearchPathCacheForTests();
  });

  it("leaves the installed route untouched, and has no recipe for an agent with no npm connector", () => {
    // The default is `installed` — a missing record must not become a download — and an agent whose adapter lives
    // in this repository has no fetched recipe at all, which is what makes the daemon refuse to store that choice.
    expect(bridgePackage("codex")).toBe("@agentclientprotocol/codex-acp");
    expect(bridgePackage("claudecode")).toBe("@agentclientprotocol/claude-agent-acp");
    expect(bridgePackage("envoy-harness")).toBeUndefined();
    expect(fetchedRecipe("envoy-harness")).toBeUndefined();
    expect(fetchedRecipe("codex")?.binaries).toEqual(["npx"]);
    // And the agent's own program stays on the fetched recipe: the bridge drives it, so an absent agent is still
    // reported as an absent agent rather than as a package to download.
    expect(fetchedRecipe("codex")?.agentBinaries).toEqual(["codex"]);
    // **Copilot is the other shape**, and the difference is what `covers` names: its own CLI *is* the ACP server, so
    // the fetched package is the agent rather than an adapter over it — and requiring it as an `agentBinary` would
    // report the route as unusable in the one case it exists for.
    expect(fetchablePackage("copilot")).toBe("@github/copilot");
    expect(fetchableCovers("copilot")).toBe("agent");
    expect(fetchableCovers("codex")).toBe("connector");
    expect(fetchedRecipe("copilot")?.agentBinaries).toBeUndefined();
  });

  it("merges a DeepSeek permission level into the launch environment", async () => {
    const binDir = await tempDir("envoydev-dsh-bin-");
    const dsh = join(binDir, "dsh");
    await writeFile(dsh, "#!/bin/sh\nexit 0\n");
    await chmod(dsh, 0o755);
    const cwd = await tempDir("envoydev-dsh-cwd-");
    const home = await tempDir("envoydev-dsh-home-");

    const launch = launchForHarness({
      harness: "deepseek-harness",
      cwd,
      paths: coderPaths(home),
      searchDirs: [binDir],
      extraEnv: { DSH_PERMISSION_MODE: "danger-full-access" },
    });
    expect(launch.env?.DSH_PERMISSION_MODE).toBe("danger-full-access");
    expect(launch.env?.DSH_HOME).toBe(join(coderPaths(home).stateDir, "agents", "dsh"));
    resetSearchPathCacheForTests();
  });
});
