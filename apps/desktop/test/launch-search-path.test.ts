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
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { probeHarness } from "@envoycoder/agent-catalog";
import { ENVOYCODER_ERRORS, coderErrorCode, coderErrorRef } from "@envoycoder/protocol";
import { coderPaths } from "@envoycoder/host-bridge";

import { launchForHarness } from "../src/daemon/launch.js";

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
    const binDir = await tempDir("envoycoder-search-bin-");
    await bridgeIn(binDir);
    const cwd = await tempDir("envoycoder-search-cwd-");
    const home = await tempDir("envoycoder-search-home-");

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
    const bridgeDir = await tempDir("envoycoder-search-bridge-");
    const agentDir = await tempDir("envoycoder-search-agent-");
    await bridgeIn(bridgeDir);
    const cwd = await tempDir("envoycoder-search-cwd-");
    const home = await tempDir("envoycoder-search-home-");

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
    const binDir = await tempDir("envoycoder-search-agentonly-");
    await bridgeIn(binDir, "claude");
    const cwd = await tempDir("envoycoder-search-cwd-");
    const home = await tempDir("envoycoder-search-home-");

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
    const cwd = await tempDir("envoycoder-refusal-cwd-");
    const home = await tempDir("envoycoder-refusal-home-");
    const empty = await tempDir("envoycoder-refusal-empty-");
    const called = (harm: "claudecode" | "copilot", dirs: readonly string[]): Error => {
      try {
        launchForHarness({ harness: harm, cwd, paths: coderPaths(home), searchDirs: dirs });
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
      throw new Error(`${harm} was launched when it should have been refused`);
    };

    // 1. Installed and undrivable: `copilot` is `transport: "cli"`, and the list holds a `copilot` binary.
    const copilotDir = await tempDir("envoycoder-refusal-copilot-");
    await bridgeIn(copilotDir, "copilot");
    const undrivable = called("copilot", [copilotDir]);
    expect(coderErrorCode(undrivable.message)).toBe(ENVOYCODER_ERRORS.harnessUnsupported);
    expect(coderErrorRef(undrivable.message)?.key).toBe("error.harnessUnsupported");
    // And not the sentence that tells them to install what they already have.
    expect(coderErrorRef(undrivable.message)?.key).not.toBe("error.harnessMissing");

    // 2. Absent, over a search that ran: the agent's own CLI and its adapter are both missing.
    const missing = called("claudecode", [empty]);
    expect(coderErrorCode(missing.message)).toBe(ENVOYCODER_ERRORS.harnessMissing);
    expect(coderErrorRef(missing.message)?.key).toBe("error.harnessMissing");
    // The English detail — the half that reaches the log — names both install steps.
    expect(missing.message).toContain("npm install -g @agentclientprotocol/claude-agent-acp");

    // 3. Unverifiable: an **empty** list, which says "there was nothing to search with" rather than "we
    //    searched and found nothing". A **different** code, because "we could not look" must never be
    //    translated as "it is not installed" — the one claim requirement this state exists for.
    const unverifiable = called("claudecode", []);
    expect(coderErrorCode(unverifiable.message)).toBe(ENVOYCODER_ERRORS.harnessUnknown);
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
    const empty = await tempDir("envoycoder-search-empty-");
    // `PATH` is deliberately the real one, which on any machine that has the bridge would resolve it.
    const probe = probeHarness("claudecode", { pathDirs: [empty], env: process.env });
    expect(probe.state).not.toBe("ready");
    expect(probe.binaryPath).toBeUndefined();
  });
});
