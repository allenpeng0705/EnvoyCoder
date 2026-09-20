/**
 * The `PATH` a GUI-launched daemon searches — and the four ways finding it can go wrong.
 *
 * ## Why every test here is about a *real* process or a *real* machine fact
 *
 * The bug this module fixes was invisible to every existing test: the resolver's callers were all tested,
 * and none of them asked where the list came from. So the assertions below are deliberately about the things
 * that were wrong rather than about the shape of the return value:
 *
 *   * a **real** `/bin/sh` that hangs, so "the timeout fired" is measured rather than simulated;
 *   * a **real** login shell whose rc file writes to stdout — this machine's does, and the receipt is in the
 *     module header (`Restored session: …`);
 *   * the **order** of the three sources, because "the login shell wins a collision" is the whole preference
 *     rule and it is decided by nothing but order;
 *   * and `searchable: false`, the state that must become `unknown` rather than "not installed".
 *
 * The one leg that needs a real login shell skips **loudly** when the machine has none (Windows), because an
 * agent's tools are the user's install and a test that passed vacuously would be worse than one that says it
 * did not run. Everything else is injectable, so the *policy* is proven everywhere.
 */

import { describe, expect, it } from "vitest";

import {
  LOGIN_SHELL_MAX_OUTPUT,
  LOGIN_SHELL_PATH_MARKER,
  LOGIN_SHELL_SSH_MARKER,
  composeSearchPath,
  currentSearchPath,
  loginShellCommand,
  looksLikePath,
  primeSearchPath,
  provisionalCacheOf,
  readLoginShellPath,
  resetSearchPathCacheForTests,
  splitPathEntries,
  wellKnownBinDirs,
} from "../src/index.js";

/**
 * The stdout this machine's login shell actually produces, quoted from a run on 2026-09-14.
 *
 * Taken verbatim rather than invented, because the whole reason the shell's output is read by marker is that
 * a **real rc file** writes to stdout before the `PATH` does. A fixture that omitted the noise would let the
 * naive "take the last line" implementation pass, which is the implementation this replaced.
 */
const REAL_ZSH_NOISE =
  "Restored session: Mon Sep 14 23:52:38 CST 2026\n" +
  "\n" +
  `${LOGIN_SHELL_PATH_MARKER}/Users/you/.local/bin:/opt/homebrew/bin:/usr/bin:/bin\n`;

describe("the login-shell probe", () => {
  it("builds an interactive login command, because running the rc files is the entire point", () => {
    expect(loginShellCommand("/bin/zsh")).toEqual({
      command: "/bin/zsh",
      // Two questions, one shell: the `PATH` the user's terminal would have, and the ssh agent socket their
      // session has. The startup files are the expensive part, so asking twice would pay for them twice.
      args: [
        "-ilc",
        `printf '\\n%s%s\\n' '${LOGIN_SHELL_PATH_MARKER}' "$PATH"; printf '%s%s\\n' '${LOGIN_SHELL_SSH_MARKER}' "$SSH_AUTH_SOCK"`,
      ],
    });
  });

  it("answers the ssh agent socket from the same ask, and tolerates it being absent", async () => {
    // A machine that does not use ssh prints an empty value; that must leave the `PATH` answer intact.
    const withSocket = await readLoginShellPath({
      platform: "linux",
      shell: "/bin/sh",
      command: {
        command: "/bin/sh",
        args: [
          "-c",
          `printf '%s' '${LOGIN_SHELL_PATH_MARKER}/usr/bin:/bin
${LOGIN_SHELL_SSH_MARKER}/run/user/1000/keyring/ssh
'`,
        ],
      },
    });
    expect(withSocket.path).toBe("/usr/bin:/bin");
    expect(withSocket.sshAuthSock).toBe("/run/user/1000/keyring/ssh");

    const without = await readLoginShellPath({
      platform: "linux",
      shell: "/bin/sh",
      command: {
        command: "/bin/sh",
        args: ["-c", `printf '%s' '${LOGIN_SHELL_PATH_MARKER}/usr/bin:/bin
${LOGIN_SHELL_SSH_MARKER}
'`],
      },
    });
    expect(without.path).toBe("/usr/bin:/bin");
    expect(without.sshAuthSock).toBeUndefined();

    // And something that is not a socket path is ignored rather than passed to a child.
    const nonsense = await readLoginShellPath({
      platform: "linux",
      shell: "/bin/sh",
      command: {
        command: "/bin/sh",
        args: ["-c", `printf '%s' '${LOGIN_SHELL_PATH_MARKER}/usr/bin
${LOGIN_SHELL_SSH_MARKER}not a path'`],
      },
    });
    expect(nonsense.path).toBe("/usr/bin");
    expect(nonsense.sshAuthSock).toBeUndefined();
  });

  it("reads the PATH out of output that also contains an rc file's chatter", async () => {
    // The real shape from this machine. `"the last line"` would work here and fail on any rc file that prints
    // *after* the prompt — which is why the marker exists, and why this asserts on the marker being load
    // bearing rather than on the value alone.
    const read = await readLoginShellPath({
      platform: "macos",
      shell: "/bin/sh",
      command: { command: "/bin/sh", args: ["-c", `printf '%s' '${REAL_ZSH_NOISE}'`] },
    });
    expect(read.path).toBe("/Users/you/.local/bin:/opt/homebrew/bin:/usr/bin:/bin");
  });

  it("ignores chatter printed *after* the PATH, which is what the marker buys", async () => {
    // A backgrounded job, an auto-update notice, a `git status` in an rc file: all of them arrive after our
    // `printf`. Taking the last line would read the notice; taking the marker's own line does not.
    const out = `${LOGIN_SHELL_PATH_MARKER}/usr/bin:/bin\nsome notice printed later\nmore noise\n`;
    const read = await readLoginShellPath({
      platform: "macos",
      shell: "/bin/sh",
      command: { command: "/bin/sh", args: ["-c", `printf '%s' '${out}'`] },
    });
    expect(read.path).toBe("/usr/bin:/bin");
  });

  it("gives up on a shell that hangs, on the deadline, and does not throw", async () => {
    // **Measured, with a real process.** `sleep 30` against a 400 ms budget: the assertion is on the clock,
    // because "the timeout is configured" is not the same claim as "the timeout fires" — and the failure mode
    // this prevents is a daemon blocked on a login shell until the user gives up on the window.
    const started = Date.now();
    const read = await readLoginShellPath({
      platform: "macos",
      shell: "/bin/sh",
      command: { command: "/bin/sh", args: ["-c", "sleep 30"] },
      timeoutMs: 400,
    });
    const elapsed = Date.now() - started;
    expect(read.path).toBeUndefined();
    expect(read.reason).toBe("failed");
    expect(elapsed).toBeLessThan(5_000);
  });

  it("gives up on a shell that prints garbage, rather than believing it", async () => {
    // Two shapes of garbage, and they are different code paths. The first is what an rc file prints when we
    // never reach our `printf` — no marker at all. The second *has* the marker and a value that is not a
    // `PATH`, which is the case that would silently make every agent look uninstalled.
    const noMarker = await readLoginShellPath({
      platform: "macos",
      shell: "/bin/sh",
      command: { command: "/bin/sh", args: ["-c", "echo 'command not found: printf'"] },
    });
    expect(noMarker.path).toBeUndefined();
    expect(noMarker.reason).toBe("no-marker");

    const notAPath = await readLoginShellPath({
      platform: "macos",
      shell: "/bin/sh",
      command: {
        command: "/bin/sh",
        args: ["-c", `printf '%s%s\\n' '${LOGIN_SHELL_PATH_MARKER}' 'hello world'`],
      },
    });
    expect(notAPath.path).toBeUndefined();
    expect(notAPath.reason).toBe("not-a-path");
  });

  it("gives up on a shell that writes more than the bound", async () => {
    // An rc file that dumps a build log. Node reports this as an error (`maxBuffer`) and we drop the answer —
    // the point being that a hostile shell costs a bounded amount of memory and time, not an unbounded one.
    const read = await readLoginShellPath({
      platform: "macos",
      shell: "/bin/sh",
      command: { command: "/bin/sh", args: ["-c", `yes x | head -c ${LOGIN_SHELL_MAX_OUTPUT * 2}`] },
      timeoutMs: 10_000,
    });
    expect(read.path).toBeUndefined();
  });

  it("answers 'no shell' rather than waiting, on Windows and where $SHELL is unset", async () => {
    expect((await readLoginShellPath({ platform: "windows", env: { SHELL: "/bin/zsh" } })).reason).toBe(
      "not-posix",
    );
    expect((await readLoginShellPath({ platform: "linux", env: {} })).reason).toBe("no-shell");
  });

  it("asks the real login shell on this machine, when it has one", async () => {
    // The end-to-end leg, and it is honest about being conditional: a machine with no `$SHELL` (Windows) or a
    // user whose rc file is broken would otherwise fail a test about our code. What it proves is the wiring
    // the injected cases cannot — that the default command really is this machine's login shell and that its
    // real output really does parse.
    const shell = process.env.SHELL;
    if (!shell) {
      console.log("· no $SHELL on this machine — the real login-shell leg did not run");
      return;
    }
    const read = await readLoginShellPath({});
    if (read.path === undefined) {
      console.log(`· the login shell at ${shell} gave no PATH (${String(read.reason)}) — leg did not run`);
      return;
    }
    expect(looksLikePath(read.path)).toBe(true);
    // A login shell's PATH is always absolute and never empty, and it is what a terminal user has.
    expect(read.path.startsWith("/")).toBe(true);
  }, 15_000);
});

describe("composing the list", () => {
  const only = (dirs: readonly string[]) => (candidate: string) => dirs.includes(candidate);

  it("puts the login shell first, so it wins a name collision", () => {
    const composed = composeSearchPath({
      platform: "linux",
      home: "/home/you",
      processPath: "/usr/bin:/usr/local/bin",
      loginShell: "/home/you/.local/bin:/usr/bin",
      exists: only(["/home/you/.local/bin", "/home/you/.npm-global/bin", "/usr/local/bin"]),
    });
    expect(composed.source).toBe("login-shell");
    expect(composed.fromLoginShell).toBe(true);
    // `.local/bin` before `/usr/bin` — the login shell's order is the user's, and the daemon's own PATH is
    // only *added to* it. A collision resolves to the shell's copy, which is the file their terminal runs.
    expect(composed.dirs.slice(0, 4)).toEqual([
      "/home/you/.local/bin",
      "/usr/bin",
      "/usr/local/bin",
      "/home/you/.npm-global/bin",
    ]);
  });

  it("keeps the daemon's own PATH when the login shell's answer *replaces* rather than extends it", () => {
    // A profile that assigns `PATH=…` outright: the daemon was launched from a directory the profile knows
    // nothing about, and forgetting it would make a tool that worked a moment ago disappear.
    const composed = composeSearchPath({
      platform: "linux",
      home: "/home/you",
      processPath: "/opt/work/bin",
      loginShell: "/home/you/.local/bin",
      exists: () => false,
    });
    expect(composed.dirs).toEqual(["/home/you/.local/bin", "/opt/work/bin"]);
  });

  it("falls back to the process environment, then to the well-known directories", () => {
    const envOnly = composeSearchPath({
      platform: "linux",
      home: "/home/you",
      processPath: "/usr/bin:/bin",
      exists: () => false,
    });
    expect(envOnly.source).toBe("process-env");
    expect(envOnly.fromLoginShell).toBe(false);
    expect(envOnly.dirs).toEqual(["/usr/bin", "/bin"]);

    // **The GUI case, and the reason this module exists.** On macOS a Finder-launched process inherits no
    // `PATH` from launchd at all, so the well-known list is the *only* thing that makes a user's tools
    // findable. Measured: `launchctl getenv PATH` prints nothing.
    const gui = composeSearchPath({
      platform: "macos",
      home: "/Users/you",
      processPath: "",
      loginShell: undefined,
      exists: only(["/Users/you/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"]),
    });
    expect(gui.source).toBe("well-known");
    expect(gui.searchable).toBe(true);
    expect(gui.dirs).toEqual(["/Users/you/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"]);
    expect(gui.added).toEqual(["/Users/you/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"]);
  });

  it("puts the packaged bin ahead of the shell, when the installer set one", () => {
    const composed = composeSearchPath({
      platform: "linux",
      home: "/home/you",
      processPath: "/usr/bin",
      loginShell: "/home/you/.local/bin",
      env: { ENVOYDEV_BUNDLED_BIN: "/opt/EnvoyDev/bin" },
      exists: (entry) => entry === "/opt/EnvoyDev/bin",
    });
    expect(composed.dirs[0]).toBe("/opt/EnvoyDev/bin");
  });

  it("adds a well-known directory only when it exists, and never twice", () => {
    const composed = composeSearchPath({
      platform: "linux",
      home: "/home/you",
      processPath: "/home/you/.local/bin:/usr/bin",
      exists: only(["/home/you/.local/bin", "/home/you/.cargo/bin"]),
    });
    // Already present, so not "added" and not duplicated; the one that exists and was missing joins at the end.
    expect(composed.added).toEqual(["/home/you/.cargo/bin"]);
    expect(composed.dirs.filter((dir) => dir === "/home/you/.local/bin")).toHaveLength(1);
    expect(composed.dirs[composed.dirs.length - 1]).toBe("/home/you/.cargo/bin");
  });

  it("says `searchable: false` only when nothing at all answered", () => {
    // The state that must be reported as `unknown`. A service account with no `HOME`, an empty `PATH` and none
    // of the well-known directories: there was no search, so there is no result to report.
    const nothing = composeSearchPath({
      platform: "linux",
      home: "",
      processPath: "",
      exists: () => false,
    });
    expect(nothing).toMatchObject({ searchable: false, source: "none" });
    expect(nothing.dirs).toEqual([]);
    expect(nothing.path).toBe("");

    // And the contrast that keeps it honest: a machine whose *only* source is the well-known list **did**
    // search, so its negative result is real and it is not `unknown`.
    const wellKnownOnly = composeSearchPath({
      platform: "linux",
      home: "/home/you",
      processPath: "",
      exists: only(["/home/you/.local/bin"]),
    });
    expect(wellKnownOnly.searchable).toBe(true);
  });

  it("has nothing to add on Windows, and says why by returning nothing", () => {
    // Not an omission: on Windows the registry `PATH` reaches a GUI process, so there is no repair to make and
    // a hard-coded `~/.npm-global/bin` would be a guess about a layout Windows does not have.
    expect(wellKnownBinDirs({ platform: "windows", home: "C:\\Users\\you" })).toEqual([]);
    expect(wellKnownBinDirs({ platform: "linux", home: "" })).toEqual([]);
  });

  it("expands a leading `~/`, which is a repair a shell would not make", () => {
    // `/etc/paths` on this machine contains the literal entry `~/.dotnet/tools`, and `path_helper` copies it
    // into every login shell verbatim — so the entry is searched for a directory named `~` unless we fix it.
    expect(splitPathEntries("/usr/bin:~/work/bin:~/.dotnet/tools", { home: "/home/you" })).toEqual([
      "/usr/bin",
      "/home/you/work/bin",
      "/home/you/.dotnet/tools",
    ]);
    // An empty entry is dropped rather than read as "the current directory".
    expect(splitPathEntries("/usr/bin::/bin", { home: "/home/you" })).toEqual(["/usr/bin", "/bin"]);
  });
});

describe("the cache the daemon actually reads", () => {
  it("answers synchronously from what has landed, without spawning anything", async () => {
    resetSearchPathCacheForTests();
    // Before any shell has answered, the default call is the process environment plus the well-known list —
    // a real search, and the one a first `coder.listHarnesses` gets. `currentSearchPath` is synchronous; a
    // version that spawned a shell here would be a request handler waiting on an rc file.
    const before = currentSearchPath();
    expect(before.fromLoginShell).toBe(false);
    expect(before.dirs.length).toBeGreaterThan(0);
    expect(before.searchable).toBe(true);

    // After the async half lands, the **default** call sees the login shell's list — first, and ahead of the
    // process environment. The command is injected so the assertion does not depend on this machine's shell;
    // that is *how* we ask, not *which world* we ask about, which is why it still caches (`namesItsOwnWorld`).
    await primeSearchPath({
      command: {
        command: "/bin/sh",
        args: ["-c", `printf '%s%s\\n' '${LOGIN_SHELL_PATH_MARKER}' '/peers/bin:/usr/bin'`],
      },
    });
    const after = currentSearchPath();
    expect(after.source).toBe("login-shell");
    expect(after.fromLoginShell).toBe(true);
    // The two the shell named, in its own order, ahead of everything the process environment contributed —
    // which is the preference rule, asserted rather than described.
    expect(after.dirs.slice(0, 2)).toEqual(["/peers/bin", "/usr/bin"]);
    expect(after.dirs.length).toBeGreaterThan(before.dirs.length - 1);
    resetSearchPathCacheForTests();
  });

  it("does not let a cached answer leak into a question about another world", async () => {
    // The reason `namesItsOwnWorld` exists: a caller that names its own `env`/`home` is asking about *that*
    // machine, and serving it the daemon's cached answer would answer a question nobody asked. The prime
    // below is the default call, so it *is* cached — which is what makes this test able to fail.
    resetSearchPathCacheForTests();
    await primeSearchPath({
      command: {
        command: "/bin/sh",
        args: ["-c", `printf '%s%s\\n' '${LOGIN_SHELL_PATH_MARKER}' '/only/here'`],
      },
    });
    expect(currentSearchPath().dirs).toContain("/only/here");

    const otherWorld = currentSearchPath({
      platform: "linux",
      env: { PATH: "/usr/bin" },
      home: "/home/other",
      exists: () => false,
    });
    expect(otherWorld.dirs).toEqual(["/usr/bin"]);
    expect(otherWorld.dirs).not.toContain("/only/here");
    resetSearchPathCacheForTests();
  });
});

describe("a program found in another tool's cache", () => {
  it("names the cache, and calls an ordinary installation ordinary", () => {
    // `dsh` on the machine this was written on resolves here, which is why the marker exists.
    expect(provisionalCacheOf("/Users/you/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh")).toBe("npx");
    expect(provisionalCacheOf("/home/you/.bun/install/cache/pkg/node_modules/.bin/tool")).toBe("bun-cache");
    expect(provisionalCacheOf("/home/you/.cache/pnpm/dlx/abc/node_modules/.bin/tool")).toBe("pnpm-dlx");
    // A toolchain manager is an installation the user chose, not a cache. Saying otherwise would put a warning
    // chip on every `volta` user's row.
    expect(provisionalCacheOf("/home/you/.volta/bin/tool")).toBeUndefined();
    expect(provisionalCacheOf("/usr/local/bin/dsh")).toBeUndefined();
  });
});
