/**
 * **Running the fix, and the four answers it can give.**
 *
 * This is the one method in the product that executes something on the user's behalf, so the legs here are about
 * the properties that make it safe to offer rather than about a happy path:
 *
 *   * **the command that runs is the row's command** — resolved through the same probes that drew the row, at the
 *     moment of the press, so a window cannot name one and a stale list cannot run the wrong thing;
 *   * **nothing runs when there is nothing to do** — a target that is already ready, or one whose projection
 *     carries no fix (our own gap), answers `nothing-to-do` and **spawns nothing**, asserted with a spy rather
 *     than inferred from the outcome;
 *   * **a failure is a failure** — a non-zero exit stops the sequence, reports the code and keeps the output, and
 *     a command that hangs is killed **as a group** and says that it timed out.
 *
 * ## No leg here installs anything
 *
 * The runner is driven with `/bin/sh` scripts that write to a temporary file, and the resolver legs use injected
 * probes. That is the only honest way to test this feature: a suite that ran `npm install -g` would be a suite
 * that changes the machine of whoever ran it.
 */

import { spawn as realSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIX_OUTPUT_LIMIT, createFixHandlers, runFixCommands } from "../src/daemon/fixes.js";
import type { FixRunInput } from "../src/daemon/fixes.js";

/** Real shells, so these legs are POSIX-only and say so rather than passing quietly. */
const posixOnly = process.platform === "win32" ? it.skip : it;
if (process.platform === "win32") {
  console.log("· fixes: the legs that run a real shell are POSIX-only and did not run on Windows");
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "envoycoder-fix-"));
  dirs.push(dir);
  return dir;
}

/** One run over real shells, with a `PATH` of its own so a leg never depends on the machine's. */
function run(commands: readonly string[], cwd: string, over: Partial<FixRunInput> = {}): Promise<unknown> {
  return runFixCommands({
    commands,
    cwd,
    pathDirs: ["/bin", "/usr/bin"],
    timeoutMs: 10_000,
    platform: "macos",
    spawn: realSpawn,
    ...over,
  });
}

interface RunResult {
  outcome: string;
  exitCode: number | null;
  output: string;
  reason?: string;
  commands: readonly string[];
}

describe("running the commands a row shows", () => {
  posixOnly("runs them in order, and reports success only when every one of them succeeded", async () => {
    const dir = await tempDir();
    const result = (await run([`printf 'first\\n'`, `printf 'second\\n'`], dir)) as RunResult;
    expect(result.outcome).toBe("succeeded");
    expect(result.exitCode).toBe(0);
    // Both ran, and in the order the row listed them — the order is the whole point of a two-step fix.
    expect(result.output.indexOf("first")).toBeLessThan(result.output.indexOf("second"));
  });

  posixOnly("stops at the first failure, reports its code, and does not run what follows", async () => {
    const dir = await tempDir();
    const marker = join(dir, "second-ran");
    const result = (await run([`exit 3`, `touch ${marker}`], dir)) as RunResult;
    expect(result.outcome).toBe("failed");
    expect(result.exitCode).toBe(3);
    // The mutation this fails on: running every command and reporting the last exit code, which would let a
    // half-finished sequence claim success.
    expect(existsSync(marker)).toBe(false);
  });

  posixOnly("keeps the end of a long transcript, because that is where the failure is", async () => {
    const dir = await tempDir();
    const result = (await run(
      [`yes x | head -c ${FIX_OUTPUT_LIMIT + 5000}; printf 'THE-END'`],
      dir,
      { timeoutMs: 20_000 },
    )) as RunResult;
    expect(result.outcome).toBe("succeeded");
    expect(result.output.length).toBeLessThanOrEqual(FIX_OUTPUT_LIMIT + 2);
    expect(result.output).toContain("THE-END");
    // And it says something was dropped, rather than presenting a tail as the whole story.
    expect(result.output.startsWith("…")).toBe(true);
  });

  posixOnly("kills the whole group when a command hangs, and says it timed out", async () => {
    // **The leg that would find a leader-only kill.** The script starts a child of its own which would write a
    // file a second after the deadline: if only the leader were killed, that write would still happen.
    const dir = await tempDir();
    const marker = join(dir, "child-survived");
    const result = (await run([`sleep 1 && touch ${marker} & wait`], dir, { timeoutMs: 300 })) as RunResult;
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("timeout");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(existsSync(marker)).toBe(false);
  });
});

describe("what a fix target resolves to", () => {
  /** The shape `probeHarness` returns for a bridged agent whose connector is missing. */
  const needsBridge = (command: string) => ({
    id: "codex" as const,
    state: "needs-bridge" as const,
    agentBinaryPath: "/usr/local/bin/codex",
    fix: [{ command }],
  });

  function handlers(over: { probe?: unknown; spawn?: ReturnType<typeof vi.fn>; recheck?: ReturnType<typeof vi.fn> }) {
    return createFixHandlers({
      probe: (over.probe ?? (() => needsBridge("npm install -g @agentclientprotocol/codex-acp"))) as never,
      providers: () => [],
      cwd: () => "/tmp",
      pathDirs: () => ["/bin", "/usr/bin"],
      spawn: (over.spawn ?? vi.fn()) as never,
      ...(over.recheck !== undefined ? { recheck: over.recheck as never } : {}),
    });
  }

  it("runs exactly the command the row carried, and re-checks afterwards", async () => {
    // A process that exits at once: this leg is about *which* command was run, not about running one.
    const spawn = vi.fn(() => realSpawn("/bin/echo", ["ok"]));
    const recheck = vi.fn(async () => undefined);
    const handler = handlers({ spawn, recheck })["coder.runFix"];
    const result = (await handler?.({ target: { kind: "harness", id: "codex" } })) as RunResult;

    expect(result.outcome).toBe("succeeded");
    expect(result.commands).toEqual(["npm install -g @agentclientprotocol/codex-acp"]);
    // **The command reaches the login shell as an argument, verbatim.** The runner builds `/bin/sh -lc <command>`
    // from the platform's own capability table, so this asserts both halves a user cares about: it is the row's
    // string, and it went to a login shell.
    const [shell, args] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(shell).toBe("/bin/sh");
    expect(args[0]).toBe("-lc");
    expect(args[1]).toBe("npm install -g @agentclientprotocol/codex-acp");
    // And the lists are told, so the row flips without the user pressing anything else.
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("spawns nothing when the target is already ready, and says there is nothing to do", async () => {
    // The race the four outcomes exist for: the user installed the program in their own terminal and pressed
    // EnvoyCoder's button a moment later. Running the install again would be harmless and wrong.
    const spawn = vi.fn();
    const recheck = vi.fn(async () => undefined);
    const handler = handlers({
      probe: () => ({ id: "codex", state: "ready", binaryPath: "/usr/local/bin/codex-acp" }),
      spawn,
      recheck,
    })["coder.runFix"];
    const result = (await handler?.({ target: { kind: "harness", id: "codex" } })) as RunResult;

    expect(result.outcome).toBe("nothing-to-do");
    expect(result.commands).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
    expect(recheck).not.toHaveBeenCalled();
  });

  it("refuses a target that is not in any list, without running anything", async () => {
    const spawn = vi.fn();
    const handler = handlers({ spawn })["coder.runFix"];
    const result = (await handler?.({
      target: { kind: "catalog", id: "no-such-agent" },
    })) as RunResult;

    expect(result.outcome).toBe("refused");
    expect(result.reason).toBe("unknown-target");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not re-check after a failure, because nothing changed", async () => {
    const spawn = vi.fn(() => realSpawn("/bin/sh", ["-c", "exit 7"]));
    const recheck = vi.fn(async () => undefined);
    const handler = handlers({ spawn, recheck })["coder.runFix"];
    const result = (await handler?.({ target: { kind: "harness", id: "codex" } })) as RunResult;

    expect(result.outcome).toBe("failed");
    expect(result.exitCode).toBe(7);
    expect(recheck).not.toHaveBeenCalled();
  });

  it("refuses a call whose parameters do not name a target", async () => {
    // The wire's own guard: a malformed press is a protocol error, not an invitation to guess a target.
    const handler = handlers({})["coder.runFix"];
    await expect(handler?.({})).rejects.toThrow();
    await expect(handler?.({ target: { kind: "harness", id: "not-a-harness" } })).rejects.toThrow();
  });
});
