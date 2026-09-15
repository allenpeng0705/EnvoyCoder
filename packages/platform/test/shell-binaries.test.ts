/**
 * **The names the user's own shell resolves** — asked one at a time, because a `PATH` answer is not a lookup.
 *
 * ## Why this file exists, and the measurement behind every case
 *
 * The bug it closes was reported as *"Some agents I have installed, but still show need to install or need
 * adapter. Eg, codex, claudecode, deepseek-harness."* On the machine this was written on, the third of those
 * was `not-installed` in a window owned by somebody who uses it every day, and the reason is arithmetic:
 *
 *   * `dsh` resolves to `/Users/…/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh`;
 *   * the **login shell**, asked for `$PATH` from a clean environment (what a GUI launch gives it), prints 26
 *     directories and **none of them contains it**;
 *   * the daemon's own inherited `PATH` has 48 entries and does not contain it either;
 *   * `command -v dsh` in the owner's own shell **does** resolve it.
 *
 * So the two questions are genuinely different questions, and the tests below are about the second one: the
 * answer is recorded, its directory joins the search list **first**, a program found that way is *installed*
 * (`findBinary` resolves it, so no probe can call it missing), and nothing about a user-controlled name can
 * reach a shell script unquoted — because the name set is closed rather than escaped.
 */

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOGIN_SHELL_BINARY_MARKER,
  cacheBinDirs,
  composeSearchPath,
  currentSearchPath,
  findBinary,
  isShellAskeableName,
  loginShellBinaryCommand,
  looksLikeBinaryPath,
  parseShellBinaries,
  primeShellBinaries,
  provisionalCacheOf,
  readLoginShellBinaries,
  resetSearchPathCacheForTests,
  shellBinariesGeneration,
  shellResolvedBinaries,
  resetShellBinaryCacheForTests,
  reaskShellBinaries,
} from "../src/index.js";

/**
 * **POSIX-only legs, skipped loudly on Windows.**
 *
 * Asking a login shell anything is a POSIX idea and this module says so (`readLoginShellBinaries` returns
 * `not-posix` there, for the same reason `path-discovery.ts` does: the registry `PATH` reaches a GUI process
 * on Windows, so there is nothing to repair). A leg that spawned a shell there would be testing a mechanism
 * the product deliberately does not have, so it is skipped — with a note, because a silent skip is a green
 * light for something nobody ran.
 */
const posixOnly = process.platform === "win32" ? it.skip : it;
if (process.platform === "win32") {
  console.log("· shell-binaries: the legs that spawn a shell did not run on Windows (the mechanism is POSIX-only)");
}

/** Temporary directories this file made, removed after each case. */
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A shell that prints exactly this, and nothing else.
 *
 * `printf '%b'` with escaped control characters rather than `printf %s`: the fixture is built from real
 * newlines and tabs (which is what the parser reads), and `%s` would print the escapes themselves — a fixture
 * bug that reads as the parser failing.
 */
const scripted = (stdout: string) => {
  const escaped = stdout.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  // The option is `command: {command, args}` — the shell *and* its argv — not two sibling fields.
  return { command: { command: "/bin/sh", args: ["-c", `printf '%b' '${escaped}'`] } };
};

/** One marked answer line, in the shape `loginShellBinaryCommand` produces. */
const answer = (name: string, path: string): string =>
  `\n${LOGIN_SHELL_BINARY_MARKER}${name}\t${path}\n`;

describe("asking the shell about a name", () => {
  it("asks with `command -v`, one marked line per name, and never with `which`", () => {
    const spec = loginShellBinaryCommand("/bin/zsh", ["dsh", "codex"]);
    expect(spec.command).toBe("/bin/zsh");
    expect(spec.args[0]).toBe("-ilc");
    const script = spec.args[1] ?? "";
    // A lookup by the shell itself, and a login+interactive shell: `-i` is what runs the rc files, which is the
    // whole point of asking this shell rather than any other.
    expect(script).toContain("command -v 'dsh'");
    expect(script).toContain("command -v 'codex'");
    expect(script).not.toContain("which");
    expect(script).toContain(LOGIN_SHELL_BINARY_MARKER);
  });

  it("refuses a name that is not a plain command name, rather than quoting it into a script", () => {
    // **The injection surface, closed by a character set.** Provider commands are user-controlled strings, and
    // "interpolate it and quote carefully" is one clever input away from a defect. A name that is not
    // `[A-Za-z0-9][A-Za-z0-9._+-]*` is skipped, so none of these can appear in the script at all.
    for (const bad of ["a; rm -rf /", "$(whoami)", "`id`", "a b", "../x", "/usr/bin/dsh", "-rf", ""]) {
      expect(isShellAskeableName(bad), bad).toBe(false);
    }
    for (const good of ["dsh", "codex-acp", "cursor-agent", "python3.12", "a_b+c"]) {
      expect(isShellAskeableName(good), good).toBe(true);
    }
    const spec = loginShellBinaryCommand("/bin/zsh", ["dsh", "a; rm -rf /", "$(whoami)"]);
    expect(spec.args[1]).not.toContain("rm -rf");
    expect(spec.args[1]).not.toContain("whoami");
    expect(spec.args[1]).toContain("dsh");
  });

  posixOnly("reads the answers by marker, so rc-file chatter before and after them cannot be mistaken for one", async () => {
    // This machine's rc files print `Restored session: …` on stdout *before* anything we asked for, which is why
    // the `PATH` probe reads by marker; a "take the last line" reader would read the wrong line here too.
    const noisy =
      "Restored session: Mon Sep 14 23:52:38 CST 2026\n" +
      answer("dsh", "/Users/you/.npm/_npx/abc/node_modules/.bin/dsh") +
      "some notice printed after our printf\n";
    const read = await readLoginShellBinaries(["dsh"], { platform: "macos", ...scripted(noisy) });
    expect([...read.binaries]).toEqual([
      ["dsh", "/Users/you/.npm/_npx/abc/node_modules/.bin/dsh"],
    ]);
  });

  posixOnly("does not believe an alias or a function — those are not programs anybody can spawn", async () => {
    // `command -v` prints three different kinds of thing, and only one of them is a path. The other two are a
    // resolution we cannot use, and the honest response is to ignore them so the ordinary search decides rather
    // than to report something that cannot be started.
    const aliased = `\n${LOGIN_SHELL_BINARY_MARKER}dsh\tdsh: aliased to npx @deepseek-ai/dsh\n`;
    const fn = `\n${LOGIN_SHELL_BINARY_MARKER}dsh\tdsh () {\n\tnpx @deepseek-ai/dsh "$@"\n}\n`;
    for (const out of [aliased, fn, answer("dsh", "relative/dsh")]) {
      const read = await readLoginShellBinaries(["dsh"], { platform: "macos", ...scripted(out) });
      expect(read.binaries.size, out).toBe(0);
    }
    // And the shape that *is* believed, so this test cannot pass by refusing everything.
    const real = await readLoginShellBinaries(["dsh"], {
      platform: "macos",
      ...scripted(answer("dsh", "/usr/local/bin/dsh")),
    });
    expect(real.binaries.get("dsh")).toBe("/usr/local/bin/dsh");
  });

  it("ignores an answer about a name nobody asked about", () => {
    const parsed = parseShellBinaries(answer("dsh", "/usr/local/bin/dsh") + answer("other", "/bin/other"), ["dsh"]);
    expect([...parsed.keys()]).toEqual(["dsh"]);
  });

  posixOnly("gives up on a shell that hangs, on the deadline, and asks again next time", async () => {
    resetShellBinaryCacheForTests();
    // A real process, so "the timeout fires" is measured rather than configured.
    const started = Date.now();
    const read = await readLoginShellBinaries(["dsh"], {
      platform: "macos",
      command: { command: "/bin/sh", args: ["-c", "sleep 30"] },
      timeoutMs: 400,
    });
    expect(read.binaries.size).toBe(0);
    expect(read.reason).toBe("failed");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("answers 'no shell' rather than waiting, on Windows and where $SHELL is unset", async () => {
    expect((await readLoginShellBinaries(["dsh"], { platform: "windows", env: { SHELL: "/bin/zsh" } })).reason).toBe(
      "not-posix",
    );
    expect((await readLoginShellBinaries(["dsh"], { platform: "linux", env: {} })).reason).toBe("no-shell");
  });

  it("marks a resolution that is not a path as unusable, in one place both callers read", () => {
    expect(looksLikeBinaryPath("/usr/local/bin/dsh")).toBe(true);
    expect(looksLikeBinaryPath("relative/dsh")).toBe(false);
    expect(looksLikeBinaryPath("dsh: aliased to npx x")).toBe(false);
    expect(looksLikeBinaryPath("/bin/x\n/bin/y")).toBe(false);
    expect(looksLikeBinaryPath("")).toBe(false);
    expect(looksLikeBinaryPath("C:\\bin\\dsh.exe", "windows")).toBe(true);
  });
});

describe("what a shell answer does to the search list", () => {
  it("puts the answered program's directory **first**, so the user's own answer wins a collision", () => {
    const composed = composeSearchPath({
      platform: "linux",
      home: "/home/you",
      processPath: "/usr/bin",
      loginShell: "/usr/bin:/home/you/.local/bin",
      exists: () => true,
      readDir: () => [],
      shellBinaries: new Map([["dsh", "/opt/only-here/bin/dsh"]]),
    });
    expect(composed.dirs[0]).toBe("/opt/only-here/bin");
    expect(composed.shellBinaries).toEqual([
      { name: "dsh", path: "/opt/only-here/bin/dsh", dir: "/opt/only-here/bin" },
    ]);
    expect(composed.source).toBe("login-shell");
    expect(composed.fromLoginShell).toBe(true);
  });

  it("believes an answer only while the program is really there", () => {
    // A shell answer is a fact about a *lookup*, and a lookup whose file has been removed is a fact that has
    // expired. Adding the directory anyway would put a stale entry on the child's `PATH`.
    const composed = composeSearchPath({
      platform: "linux",
      home: "/home/you",
      processPath: "/usr/bin",
      exists: (candidate) => candidate === "/usr/bin",
      readDir: () => [],
      shellBinaries: new Map([["dsh", "/gone/bin/dsh"]]),
    });
    expect(composed.dirs).toEqual(["/usr/bin"]);
    expect(composed.shellBinaries).toEqual([]);
  });
});

describe("npm's npx cache, which is where the reported agent actually was", () => {
  it("enumerates the `node_modules/.bin` of every package tree npx has unpacked, sorted", () => {
    const dirs = cacheBinDirs({
      platform: "linux",
      home: "/home/you",
      readDir: () => ["bbb", "aaa", ".hidden", ""],
    });
    expect(dirs).toEqual([
      "/home/you/.npm/_npx/aaa/node_modules/.bin",
      "/home/you/.npm/_npx/bbb/node_modules/.bin",
    ]);
  });

  it("contributes nothing on Windows, with no home, or with no cache directory", () => {
    expect(cacheBinDirs({ platform: "windows", home: "C:\\Users\\you" })).toEqual([]);
    expect(cacheBinDirs({ platform: "linux", home: "" })).toEqual([]);
    expect(cacheBinDirs({ platform: "linux", home: "/home/you", readDir: () => [] })).toEqual([]);
  });

  it("is searched **last**, so a real installation always wins", () => {
    const composed = composeSearchPath({
      platform: "linux",
      home: "/home/you",
      processPath: "/usr/bin",
      exists: () => true,
      readDir: () => ["abc"],
      shellBinaries: new Map(),
    });
    expect(composed.cached).toEqual(["/home/you/.npm/_npx/abc/node_modules/.bin"]);
    expect(composed.dirs[composed.dirs.length - 1]).toBe("/home/you/.npm/_npx/abc/node_modules/.bin");
    expect(composed.added.length).toBeGreaterThan(0);
    // …and the well-known directories came before it, which is the whole ordering rule.
    expect(composed.dirs.indexOf("/home/you/.local/bin")).toBeLessThan(composed.dirs.indexOf(composed.cached[0]!));
  });

  it("**is the difference between `dsh` reading as installed and reading as missing**", () => {
    // **The reported bug, as an assertion.** The daemon's own `PATH` here is the measured shape of the real one:
    // 48 entries, no `_npx` anywhere, and no login-shell answer (`loginShell: undefined` — a GUI launch whose
    // shell timed out). Before `cacheBinDirs` existed this composed to a list that simply did not contain the
    // program, and the row said "Not installed" about an agent its owner runs every day.
    const daemonPath = ["/usr/local/bin", "/usr/bin", "/bin", "/Users/you/.npm-global/bin"].join(":");
    const exists = (candidate: string) => candidate.startsWith("/Users/you/.npm/_npx/1e7f/");
    const composed = composeSearchPath({
      platform: "macos",
      home: "/Users/you",
      processPath: daemonPath,
      loginShell: undefined,
      exists,
      readDir: () => ["1e7f"],
      shellBinaries: new Map(),
    });
    const found = findBinary("dsh", { pathDirs: composed.dirs, isExecutable: exists });
    expect(found).toBe("/Users/you/.npm/_npx/1e7f/node_modules/.bin/dsh");
    // And it is reported as a **temporary copy** rather than as an installation of the user's own — the warning
    // the previous round wrote for exactly this path, which it could never reach.
    expect(provisionalCacheOf(found!)).toBe("npx");
  });
});

describe("the cache, and the two halves of the ask landing at different times", () => {
  posixOnly("records what the shell answered, and answers synchronously afterwards", async () => {
    resetShellBinaryCacheForTests();
    resetSearchPathCacheForTests();
    // Before the ask, nothing: the cache is empty and nothing is claimed about any name.
    expect(shellResolvedBinaries().size).toBe(0);

    // The **scripted** shell is how we ask, not which world we ask about, so this still caches — which is what
    // lets the mechanism be proved without depending on what this machine has installed.
    await primeShellBinaries(["dsh", "codex"], {
      ...scripted(answer("dsh", "/opt/only-here/bin/dsh") + answer("codex", "/usr/bin/codex")),
    });
    expect(shellResolvedBinaries().get("dsh")).toBe("/opt/only-here/bin/dsh");
  });

  posixOnly("recomposes the snapshot when a *later* ask lands, which is the two-shell race", async () => {
    // The `PATH` prime and the per-name prime are two invocations landing at two times: a `currentSearchPath()`
    // taken in between must not be served for ever, or the answer that arrives second is never used — the silent
    // half of the bug this whole change is about. This leg uses a **real** file, because it goes through the
    // default composition, which believes an answer only when the program is really there.
    resetShellBinaryCacheForTests();
    resetSearchPathCacheForTests();
    const before = currentSearchPath();
    expect(before.shellBinaries).toEqual([]);

    const dir = await mkdtemp(join(tmpdir(), "envoycoder-shell-answer-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "dsh");
    await writeFile(file, "#!/bin/sh\nexit 0\n");
    await chmod(file, 0o755);

    await primeShellBinaries(["dsh"], scripted(answer("dsh", file)));
    expect(shellBinariesGeneration()).toBeGreaterThan(0);

    const after = currentSearchPath();
    expect(after.shellBinaries.map((entry) => entry.name)).toEqual(["dsh"]);
    expect(after.dirs[0]).toBe(dir);
    resetShellBinaryCacheForTests();
    resetSearchPathCacheForTests();
  });

  posixOnly("finds a program installed while the app was open, because a re-ask is a second question", async () => {
    // The owner's report as a mechanism: *"After I run `npm install -g @agentclientprotocol/codex-acp`, how do
    // we let EnvoyCoder know that without restarting?"* A name the shell could not find stays on the asked list
    // — one resolving name is enough for the invocation to count as answered — so the daemon keeps a miss it
    // has no way to notice is out of date. This is the leg that separates "asked once" from "asked again".
    resetShellBinaryCacheForTests();

    const boot = await primeShellBinaries(
      ["codex", "codex-acp"],
      scripted(answer("codex", "/usr/bin/codex")),
    );
    expect(boot.get("codex")).toBe("/usr/bin/codex");
    expect(boot.get("codex-acp")).toBeUndefined();

    // The bridge is installed. Nothing has been told to the daemon, and the *next* ordinary ask does not run the
    // shell at all for a name already on the list — even the script that would now answer both.
    const installed = scripted(
      answer("codex", "/usr/bin/codex") + answer("codex-acp", "/opt/only-here/bin/codex-acp"),
    );
    const afterInstall = await primeShellBinaries(["codex", "codex-acp"], installed);
    expect(afterInstall.get("codex-acp")).toBeUndefined();

    // A re-ask is not a cleverer search: the same question, asked again, and now answered.
    const reasked = await reaskShellBinaries(["codex", "codex-acp"], installed);
    expect(reasked.get("codex-acp")).toBe("/opt/only-here/bin/codex-acp");
    // A name that already resolved keeps its answer: a real installation is not in question, and dropping it
    // would make every re-check re-derive what the first ask established.
    expect(reasked.get("codex")).toBe("/usr/bin/codex");
    resetShellBinaryCacheForTests();
  });

  posixOnly("asks about a name once, and asks again after a failed invocation", async () => {
    resetShellBinaryCacheForTests();
    await primeShellBinaries(["dsh"], scripted(answer("dsh", "/opt/only-here/bin/dsh")));
    const first = shellResolvedBinaries().get("dsh");
    expect(first).toBe("/opt/only-here/bin/dsh");
    // A second ask for the same name costs nothing: the recorded answer is returned as it stands.
    const again = await primeShellBinaries(["dsh"], { command: { command: "/bin/sh", args: ["-c", "exit 3"] } });
    expect(again.get("dsh")).toBe(first);

    // A *failed* invocation is not remembered as "this name has no answer": the name goes back on the unasked
    // list, so a shell that timed out once during boot does not disable the mechanism for the life of the daemon.
    resetShellBinaryCacheForTests();
    const failed = await primeShellBinaries(["fresh"], {
      command: { command: "/bin/sh", args: ["-c", "exit 7"] },
    });
    expect(failed.get("fresh")).toBeUndefined();
    const retried = await primeShellBinaries(["fresh"], { ...scripted(answer("fresh", "/opt/only-here/bin/fresh")) });
    expect(retried.get("fresh")).toBe("/opt/only-here/bin/fresh");
    resetShellBinaryCacheForTests();
  });
});
