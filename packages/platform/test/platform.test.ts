/**
 * The cross-platform layer, tested from whichever OS happens to be running the suite.
 *
 * The point of every assertion below is that the *other* platforms' branches are exercised here,
 * on this machine. A Windows-only code path that is only ever run by a Windows user is a code path
 * nobody has run — and the family has already paid for that lesson twice (a lock that assumed
 * `ps`, a shell snippet that assumed `setsid`).
 */

import { describe, expect, it } from "vitest";
import {
  PLATFORM_MATRIX,
  SUPPORTED_PLATFORMS,
  buildKillPlan,
  buildShellCommand,
  buildSshArgs,
  capabilitiesFor,
  defaultDataDir,
  detectPlatform,
  findBinary,
  isAbsoluteFor,
  isPosix,
  joinFor,
  pathForCommand,
  pathForWire,
  platformRefusal,
  processGroupTarget,
  quoteForShell,
  spawnTreeOptions,
} from "../src/index.js";

describe("platform identity", () => {
  it("normalises Node's platform names and refuses to guess at the rest", () => {
    expect(detectPlatform("darwin")).toBe("macos");
    expect(detectPlatform("win32")).toBe("windows");
    expect(detectPlatform("linux")).toBe("linux");
    expect(detectPlatform("freebsd")).toBe("other");
    expect(isPosix("macos")).toBe(true);
    expect(isPosix("windows")).toBe(false);
  });

  it("claims support for exactly the platforms this product ships for", () => {
    // If someone adds a platform to the matrix, this test is the reminder that CI and the
    // packaging targets have to grow with it.
    const supported = Object.entries(PLATFORM_MATRIX)
      .filter(([, caps]) => caps.supported)
      .map(([id]) => id);
    expect(supported.sort()).toEqual([...SUPPORTED_PLATFORMS].sort());
  });

  it("states its platform limits instead of failing in a random call site", () => {
    expect(platformRefusal("signals", "windows")?.code).toBe("envoydev.unsupported-platform");
    expect(platformRefusal("signals", "macos")).toBeNull();
    expect(platformRefusal("sshClient", "linux")).toBeNull();
    // Windows ships OpenSSH as an optional feature, so the refusal is about the *client* being
    // absent, not about the platform — and the message has to say how to install it.
    expect(platformRefusal("signals", "windows")?.message).toMatch(/terminated rather than asked/);
  });
});

describe("finding a binary", () => {
  it("applies the platform's executable suffixes — the reason spawn('claude') fails on Windows", () => {
    const env = { PATH: "C:\\tools;C:\\other", PATHEXT: ".EXE;.CMD" } as NodeJS.ProcessEnv;
    const seen: string[] = [];
    const found = findBinary("claude", {
      platform: "windows",
      env,
      isExecutable: (candidate) => {
        seen.push(candidate);
        return candidate.endsWith("claude.cmd");
      },
    });
    expect(found).toBe("C:\\tools\\claude.cmd");
    expect(seen[0]).toBe("C:\\tools\\claude.exe");
  });

  it("splits PATH with the platform's delimiter, not a hard-coded colon", () => {
    const env = { PATH: "/usr/local/bin:/usr/bin" } as NodeJS.ProcessEnv;
    const found = findBinary("pi", {
      platform: "linux",
      env,
      isExecutable: (candidate) => candidate === "/usr/bin/pi",
    });
    expect(found).toBe("/usr/bin/pi");
  });

  it("honours an explicit path instead of searching, and reports nothing when it is absent", () => {
    expect(findBinary("/opt/custom/agent", { isExecutable: () => true })).toBe("/opt/custom/agent");
    expect(findBinary("/opt/custom/agent", { isExecutable: () => false })).toBeNull();
    expect(findBinary("  ", { isExecutable: () => true })).toBeNull();
  });
});

describe("shells and quoting", () => {
  it("uses a shell each platform actually has", () => {
    expect(buildShellCommand("echo hi", { platform: "windows" }).command).toBe("cmd.exe");
    expect(buildShellCommand("echo hi", { platform: "linux" }).command).toBe("/bin/sh");
    expect(buildShellCommand("echo hi", { platform: "macos", prefer: "powershell" }).command).toBe("/bin/sh");
    expect(buildShellCommand("echo hi", { platform: "windows", prefer: "powershell" }).command).toBe(
      "powershell.exe",
    );
  });

  it("quotes for POSIX without escaping what does not need it", () => {
    expect(quoteForShell("/tmp/a b", "linux")).toBe("'/tmp/a b'");
    expect(quoteForShell("/tmp/plain-1.2", "linux")).toBe("/tmp/plain-1.2");
    expect(quoteForShell("it's", "macos")).toBe("'it'\\''s'");
  });

  it("refuses a cmd.exe argument it cannot escape, rather than mangling it", () => {
    // `%` expands and `!` expands under delayed expansion; there is no correct escaping, so
    // refusing is the honest answer. A silently corrupted path would be a bug report about the
    // agent, not about quoting.
    expect(() => quoteForShell("100% done", "windows")).toThrow(/cmd\.exe/);
    expect(quoteForShell('C:\\a "quoted" b', "windows")).toBe('"C:\\a ""quoted"" b"');
  });
});

describe("killing a process tree", () => {
  it("plans a POSIX process-group kill, gracefully first", () => {
    const plan = buildKillPlan(4242, { platform: "linux" });
    expect(plan.argv).toBeNull();
    expect(plan.signal).toBe("SIGTERM");
    expect(plan.graceful).toBe(true);
    expect(processGroupTarget(4242, "linux")).toBe(-4242);
  });

  it("plans taskkill on Windows, because there are no signals to send", () => {
    const plan = buildKillPlan(4242, { platform: "windows", force: true });
    expect(plan.signal).toBeNull();
    expect(plan.argv).toEqual({ command: "taskkill", args: ["/pid", "4242", "/T", "/F"] });
    expect(plan.graceful).toBe(false);
    expect(processGroupTarget(4242, "windows")).toBe(4242);
  });

  it("spawns into its own process group where that exists, so children die with the parent", () => {
    expect(spawnTreeOptions("linux")).toEqual({ detached: true, windowsHide: false, shell: false });
    expect(spawnTreeOptions("windows").detached).toBe(false);
    // Never a shell: it would re-parse the argv we built.
    expect(spawnTreeOptions("windows").shell).toBe(false);
  });
});

describe("joins", () => {
  it("joins with the separator of the platform being reasoned about, not the host's", () => {
    // The bug this prevents: resolving a Windows bin directory on macOS produced
    // `C:\tools/claude.cmd`, which Windows cannot find — in code that only ever runs for Windows.
    expect(joinFor("windows", "C:\\tools", "claude.cmd")).toBe("C:\\tools\\claude.cmd");
    expect(joinFor("windows", "C:/tools", "claude.cmd")).toBe("C:\\tools\\claude.cmd");
    expect(joinFor("linux", "/usr/local/bin", "pi")).toBe("/usr/local/bin/pi");
    expect(joinFor("macos", "/Users/dev", "Library", "Application Support", "EnvoyDev")).toBe(
      "/Users/dev/Library/Application Support/EnvoyDev",
    );
    expect(joinFor("linux")).toBe("");
  });
});

describe("paths", () => {
  it("hands a command the separator its platform expects, and the wire a portable one", () => {
    expect(pathForCommand("C:/dev/app", "windows")).toBe("C:\\dev\\app");
    expect(pathForCommand("/dev/app", "linux")).toBe("/dev/app");
    expect(pathForWire("C:\\dev\\app")).toBe("C:/dev/app");
  });

  it("recognises absolute paths the way each platform does", () => {
    expect(isAbsoluteFor("C:\\dev", "windows")).toBe(true);
    expect(isAbsoluteFor("\\\\server\\share", "windows")).toBe(true);
    expect(isAbsoluteFor("/dev", "windows")).toBe(false);
    expect(isAbsoluteFor("/dev", "linux")).toBe(true);
  });
});

describe("ssh", () => {
  it("builds a tunnel that fails loudly when the port cannot be bound", () => {
    const args = buildSshArgs(
      { host: "workstation.local", port: 2222, user: "dev" },
      { localPort: 4770, remoteHost: "127.0.0.1", remotePort: 4770 },
    );
    expect(args).toContain("ExitOnForwardFailure=yes");
    expect(args).toEqual(
      expect.arrayContaining(["-p", "2222", "-L", "4770:127.0.0.1:4770", "dev@workstation.local"]),
    );
  });

  it("passes a remote command when asked for a one-shot — and no -N, which would forbid it", () => {
    const args = buildSshArgs({ host: "box" }, undefined, "dsh --profile headless 'run tests'");
    // `-N` means "do not execute a remote command"; combining it with one is the bug this asserts.
    expect(args).not.toContain("-N");
    expect(args[args.length - 1]).toBe("dsh --profile headless 'run tests'");
  });
});

describe("per-user data directories", () => {
  it("matches the family's rule on every platform, and never roams on Windows", () => {
    expect(defaultDataDir("EnvoyDev", { platform: "macos", home: "/Users/dev", env: {} })).toBe(
      "/Users/dev/Library/Application Support/EnvoyDev",
    );
    // LOCALAPPDATA, not APPDATA: this directory holds keys.
    expect(
      defaultDataDir("EnvoyDev", {
        platform: "windows",
        home: "C:\\Users\\dev",
        env: { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" },
      }),
    ).toBe("C:\\Users\\dev\\AppData\\Local\\EnvoyDev");
    expect(defaultDataDir("EnvoyDev", { platform: "linux", home: "/home/dev", env: {} })).toBe(
      "/home/dev/.local/share/EnvoyDev",
    );
    expect(
      defaultDataDir("EnvoyDev", { platform: "linux", home: "/home/dev", env: { XDG_DATA_HOME: "/xdg" } }),
    ).toBe("/xdg/EnvoyDev");
  });

  it("documents what each platform can actually do", () => {
    expect(capabilitiesFor("windows").symlinksWithoutElevation).toBe(false);
    expect(capabilitiesFor("windows").pty).toBe("conpty");
    expect(capabilitiesFor("macos").packages).toContain("dmg");
    expect(capabilitiesFor("linux").packages).toContain("AppImage");
  });
});
