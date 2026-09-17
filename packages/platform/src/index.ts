/**
 * The cross-platform layer: everything that behaves differently on macOS, Windows and Linux.
 *
 * ## Why this is a package and not a `if (process.platform === "win32")` in three files
 *
 * EnvoyDev drives **other people's CLI programs** as child processes, on three operating
 * systems, and each of those facts multiplies: how you find a binary on `PATH`, how you quote
 * an argument, how you kill a process *tree*, whether signals exist at all, and whether a
 * pseudo-terminal is available. The EnvoyMesh codebase learned this the expensive way — a lock
 * free of pid-reuse handling, a `ps` parse that only worked on Linux, and `setsid` used in a
 * shell snippet that simply does not exist on macOS. Every one of those was a *platform
 * assumption* hiding inside logic that looked portable.
 *
 * So the assumptions live here, as data and as small pure functions:
 *
 *   * every function takes the platform as a parameter (defaulted to the real one), so the
 *     Windows branch is *tested on macOS* rather than discovered by a user;
 *   * `PLATFORM_MATRIX` states what each OS supports, and a test asserts it covers every
 *     platform this project claims to support — a claim with no entry is a claim that will
 *     silently do nothing on that OS.
 */

import { accessSync, constants } from "node:fs";
import * as path from "node:path";

/* ────────────────────────────── platform identity ───────────────────────────── */

export const SUPPORTED_PLATFORMS = ["macos", "windows", "linux"] as const;

export type PlatformId = (typeof SUPPORTED_PLATFORMS)[number] | "other";

/** Normalise Node's `process.platform` (and the odd variants) to our ids. */
export function detectPlatform(raw: string = process.platform): PlatformId {
  switch (raw) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      // FreeBSD, SunOS, aix…: Linux-shaped enough to run, not something we test or claim.
      return "other";
  }
}

export function isPosix(platform: PlatformId): boolean {
  return platform === "macos" || platform === "linux" || platform === "other";
}

/* ────────────────────────────── the support matrix ───────────────────────────── */

export interface PlatformCapabilities {
  /** Do we ship and test this platform? */
  supported: boolean;
  /** Packaging targets shipped for the desktop app. */
  packages: readonly string[];
  /** The shell we hand to a harness when it needs a command line. */
  shell: { command: string; args: readonly string[] };
  /** Real POSIX signals, or Windows' "kill is kill". */
  signals: boolean;
  /** Can we kill a whole process tree (not just the leader)? */
  killTree: "process-group" | "taskkill" | "none";
  /** Pseudo-terminal backend used for interactive agents. */
  pty: "posix-pty" | "conpty" | "none";
  /** Symlink creation without elevation (Windows needs a mode or elevation). */
  symlinksWithoutElevation: boolean;
  /** An `ssh` client we can rely on. */
  sshClient: boolean;
  /** Path-list separator for `PATH`. */
  pathDelimiter: string;
  /** Executable suffixes tried when resolving a bare command name. */
  executableSuffixes: readonly string[];
}

/**
 * The single place a platform claim is made.
 *
 * `conpty` is Windows 10 1809+; older Windows can still run non-interactive harnesses, which is
 * why terminal support is a *capability* rather than a startup gate.
 */
export const PLATFORM_MATRIX: Record<PlatformId, PlatformCapabilities> = {
  macos: {
    supported: true,
    packages: ["dmg", "app"],
    shell: { command: "/bin/sh", args: ["-lc"] },
    signals: true,
    killTree: "process-group",
    pty: "posix-pty",
    symlinksWithoutElevation: true,
    sshClient: true,
    pathDelimiter: ":",
    executableSuffixes: [""],
  },
  linux: {
    supported: true,
    packages: ["AppImage", "deb", "rpm"],
    shell: { command: "/bin/sh", args: ["-lc"] },
    signals: true,
    killTree: "process-group",
    pty: "posix-pty",
    symlinksWithoutElevation: true,
    sshClient: true,
    pathDelimiter: ":",
    executableSuffixes: [""],
  },
  windows: {
    supported: true,
    packages: ["msi", "nsis"],
    // `cmd /d /s /c` is the only shell guaranteed present; PowerShell is preferred when the
    // caller asks for it (see `buildShellCommand`). `/d` skips AutoRun, `/s` fixes quoting.
    shell: { command: "cmd.exe", args: ["/d", "/s", "/c"] },
    signals: false,
    killTree: "taskkill",
    // ConPTY, available from Windows 10 1809. We do not try to detect the build: a failure to
    // open a pty is reported as `envoydev.unsupported-platform` with that explanation.
    pty: "conpty",
    // Symlinks need Developer Mode or elevation on Windows, so anything that *requires* one has
    // to fall back (copy instead of link) rather than fail.
    symlinksWithoutElevation: false,
    sshClient: true,
    pathDelimiter: ";",
    executableSuffixes: [".exe", ".cmd", ".bat", ".ps1", ""],
  },
  other: {
    supported: false,
    packages: [],
    shell: { command: "/bin/sh", args: ["-lc"] },
    signals: true,
    killTree: "process-group",
    pty: "posix-pty",
    symlinksWithoutElevation: true,
    sshClient: true,
    pathDelimiter: ":",
    executableSuffixes: [""],
  },
};

export function capabilitiesFor(platform: PlatformId = detectPlatform()): PlatformCapabilities {
  return PLATFORM_MATRIX[platform];
}

/**
 * Refuse an operation this OS cannot do, with a message a user can act on.
 *
 * Returning a typed error rather than throwing from a random call site keeps the "this is a
 * platform limit" distinction visible to the UI, which is where it belongs.
 */
export function platformRefusal(
  need: keyof PlatformCapabilities,
  platform: PlatformId = detectPlatform(),
): { code: "envoydev.unsupported-platform"; message: string } | null {
  const caps = capabilitiesFor(platform);
  if (!caps.supported) {
    return {
      code: "envoydev.unsupported-platform",
      message: `${platform} is not a platform EnvoyDev ships for. Supported: ${SUPPORTED_PLATFORMS.join(", ")}.`,
    };
  }
  if (need === "sshClient" && !caps.sshClient) {
    return {
      code: "envoydev.unsupported-platform",
      message:
        `Connecting over SSH needs an ssh client, and none was found on ${platform}. ` +
        "Install OpenSSH (Windows: Settings → Apps → Optional features → OpenSSH Client), " +
        "or reach that machine by address instead.",
    };
  }
  if (need === "signals" && !caps.signals) {
    return {
      code: "envoydev.unsupported-platform",
      message: `Graceful signals are not available on ${platform}; a cancelled run is terminated rather than asked to stop.`,
    };
  }
  return null;
}

/* ────────────────────────────── PATH and executables ───────────────────────────── */

/**
 * Join path segments using **the target platform's** separator.
 *
 * `path.join` uses the separator of the machine running the code, which is exactly wrong here:
 * resolving `C:\tools` + `claude.cmd` on macOS produced `C:\tools/claude.cmd` — a path Windows
 * would not find, generated by a code path that only ever runs *for* Windows. The test suite runs
 * on one OS and asserts another's behaviour, so the join has to be parameterised like everything
 * else in this file.
 */
export function joinFor(platform: PlatformId, ...parts: readonly string[]): string {
  const separator = platform === "windows" ? "\\" : "/";
  const cleaned = parts
    .map((part) => (platform === "windows" ? part.replace(/\//g, "\\") : part))
    .filter((part) => part.length > 0);
  if (cleaned.length === 0) return "";
  const [first, ...rest] = cleaned;
  if (rest.length === 0) return first!;
  const head = first!.endsWith(separator) ? first!.slice(0, -separator.length) : first!;
  const tail = rest.map((part) => part.replace(new RegExp(`^\\${separator}+`), ""));
  return [head, ...tail].join(separator);
}

export interface FindBinaryOptions {
  platform?: PlatformId;
  env?: NodeJS.ProcessEnv;
  /**
   * The directories to search, in order, **instead of** the ones in `env.PATH`.
   *
   * The seam the daemon needs and the reason it exists: a GUI-launched daemon's own `PATH` does not
   * contain the user's tools (see `./path-discovery.js`), so the list it searches must be the resolved one
   * rather than the inherited one — and it must be **the same list the spawn uses**, or a program that
   * probed as present can fail to start. Passing it explicitly rather than fabricating an `env` with a
   * rewritten `PATH` keeps that visible at the call site, where getting it wrong is a bug.
   */
  pathDirs?: readonly string[];
  /** Injectable for tests: does this absolute path exist and is it executable? */
  isExecutable?: (candidate: string) => boolean;
  /** Injectable for tests: split a PATH list. */
  normalize?: boolean;
}

/**
 * Resolve a bare command name to an absolute path, the way the OS would.
 *
 * The Windows part is not optional: `spawn("claude")` works on macOS and fails on Windows
 * because the file is `claude.cmd`, and Node's `spawn` on Windows without a shell does **not**
 * apply `PATHEXT`. Since every harness in the catalogue is a CLI, this function is on the
 * critical path for the whole product on two thirds of the platforms we ship.
 */
export function findBinary(name: string, options: FindBinaryOptions = {}): string | null {
  const platform = options.platform ?? detectPlatform();
  const env = options.env ?? process.env;
  const exists =
    options.isExecutable ??
    ((candidate: string) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });

  const trimmed = name.trim();
  if (!trimmed) return null;

  // An explicit path is honoured as given (a user pinning a nightly build).
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return exists(trimmed) ? trimmed : null;
  }

  const caps = capabilitiesFor(platform);
  const dirs =
    options.pathDirs !== undefined
      ? options.pathDirs.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
      : (env.PATH ?? env.Path ?? "")
          .split(caps.pathDelimiter)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
  // Windows also honours `PATHEXT`; we keep our own list in the matrix so this is testable
  // on any OS, and use PATHEXT's contents as a hint when present.
  const suffixes = platform === "windows" ? windowsSuffixes(caps, env) : caps.executableSuffixes;

  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = joinFor(platform, dir, trimmed + suffix);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function windowsSuffixes(
  caps: PlatformCapabilities,
  env: NodeJS.ProcessEnv,
): readonly string[] {
  const fromEnv = (env.PATHEXT ?? "")
    .split(";")
    .map((suffix) => suffix.trim().toLowerCase())
    .filter((suffix) => suffix.startsWith("."));
  const merged = [...caps.executableSuffixes, ...fromEnv];
  return [...new Set(merged)];
}

/* ────────────────────────────── shells and command lines ───────────────────────────── */

export interface ShellCommand {
  command: string;
  args: string[];
  /** True when the resulting process is a shell we can feed a script to. */
  isShell: true;
}

/**
 * Build the argv for "run this command line".
 *
 * `powershell` is opt-in: the family's guidance is to avoid assuming a shell that may not be
 * there, and `cmd.exe` is the only one Windows guarantees. Callers that specifically want
 * PowerShell (for a user-authored script, say) ask for it and get a clear failure if it is
 * missing instead of a mystery.
 */
export function buildShellCommand(
  script: string,
  options: { platform?: PlatformId; prefer?: "default" | "powershell" } = {},
): ShellCommand {
  const platform = options.platform ?? detectPlatform();
  if (platform === "windows") {
    if (options.prefer === "powershell") {
      return {
        command: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        isShell: true,
      };
    }
    return { command: "cmd.exe", args: ["/d", "/s", "/c", script], isShell: true };
  }
  const shell = capabilitiesFor(platform).shell;
  return { command: shell.command, args: [...shell.args, script], isShell: true };
}

/**
 * Quote a value for the shell of a given platform.
 *
 * Two different jobs, and conflating them is a bug generator: this is for values that will be
 * *interpreted by a shell*. Arguments handed straight to `spawn` without a shell must not be
 * quoted at all.
 */
export function quoteForShell(value: string, platform: PlatformId = detectPlatform()): string {
  if (platform === "windows") {
    // `cmd.exe`: wrap in double quotes, double the internal quotes, and refuse the characters
    // that cannot be escaped inside a quoted `cmd` argument (`%` expands, `!` under delayed
    // expansion). Refusing is honest; silently mangling a path is not.
    if (/[%!]/.test(value)) {
      throw new Error(
        `Cannot pass ${JSON.stringify(value)} through cmd.exe: '%' and '!' are expanded by the shell. ` +
          "Use PowerShell explicitly, or avoid the shell for this argument.",
      );
    }
    return `"${value.replace(/"/g, '""')}"`;
  }
  if (value === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/* ────────────────────────────── processes ───────────────────────────── */

/**
 * The spawn options a harness needs so that killing it later kills its *children* too.
 *
 * A coding agent spawns build tools, test runners and language servers. Killing only the leader
 * leaves orphaned compilers holding file locks, which on Windows means the next run cannot
 * rewrite the file it just wrote. macOS/Linux get a new process group; Windows gets
 * `detached` plus a `taskkill /T` at kill time (see `buildKillCommand`).
 */
export function spawnTreeOptions(platform: PlatformId = detectPlatform()): {
  detached: boolean;
  windowsHide: boolean;
  shell: false;
} {
  return {
    detached: isPosix(platform),
    windowsHide: platform === "windows",
    // Never `shell: true`: it would re-parse the argv we carefully built.
    shell: false,
  };
}

export interface KillPlan {
  /** argv to run, when the platform needs an external tool. */
  argv: { command: string; args: string[] } | null;
  /** Signal to send directly when no external tool is needed. */
  signal: NodeJS.Signals | null;
  /** Whether we can ask nicely first. */
  graceful: boolean;
}

/**
 * How to terminate a process tree on this platform — as a *plan*, so the caller can log what it
 * is about to do and a test can assert it without killing anything.
 */
export function buildKillPlan(
  pid: number,
  options: { platform?: PlatformId; force?: boolean } = {},
): KillPlan {
  const platform = options.platform ?? detectPlatform();
  const force = options.force === true;
  if (platform === "windows") {
    // Windows has no signals: `/T` includes children, `/F` is "force" (the default path for a
    // cancelled run, because a console app with no message loop will not exit on its own).
    return {
      argv: { command: "taskkill", args: ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])] },
      signal: null,
      graceful: !force,
    };
  }
  return {
    argv: null,
    // Negative pid = the whole process group created by `spawnTreeOptions`.
    signal: force ? "SIGKILL" : "SIGTERM",
    graceful: !force,
  };
}

/** PID to signal for a whole group on POSIX (children included). */
export function processGroupTarget(pid: number, platform: PlatformId = detectPlatform()): number {
  return isPosix(platform) ? -pid : pid;
}

/* ────────────────────────────── paths ───────────────────────────── */

/**
 * A path as a child process wants to see it.
 *
 * On Windows, Node hands `C:\a\b` around happily, but `cmd` and some CLI tools want backslashes
 * and git-style tools want forward slashes; we normalise to the platform separator because that
 * is what a *shell* and a native binary both accept, and keep `path.posix`-style only where a
 * protocol demands it (git, ssh).
 */
export function pathForCommand(value: string, platform: PlatformId = detectPlatform()): string {
  return platform === "windows" ? value.replace(/\//g, "\\") : value;
}

/** Path as a *portable* string — used in RPC payloads, where the client may be another OS. */
export function pathForWire(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Does this look like an absolute path on the given platform? */
export function isAbsoluteFor(value: string, platform: PlatformId = detectPlatform()): boolean {
  if (platform === "windows") {
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
  }
  return value.startsWith("/");
}

/* ────────────────────────────── ssh ───────────────────────────── */

export interface SshTarget {
  host: string;
  port?: number;
  user?: string;
  /** Path to a private key; `~` is expanded by ssh itself, so it is passed through. */
  identityFile?: string;
  /** Extra options, e.g. `-o StrictHostKeyChecking=accept-new`. */
  extraOptions?: readonly string[];
}

/**
 * Build an `ssh` argv for a tunnel or a remote command.
 *
 * `ExitOnForwardFailure` is not decoration: a tunnel that silently fails to bind the local port
 * leaves the client talking to nothing, and the resulting "daemon unreachable" is the wrong
 * error to show a user whose real problem was a port already in use.
 */
export function buildSshArgs(
  target: SshTarget,
  forward?: { localPort: number; remoteHost: string; remotePort: number },
  remoteCommand?: string,
): string[] {
  const args: string[] = ["-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15"];
  if (target.port !== undefined) args.push("-p", String(target.port));
  if (target.identityFile) args.push("-i", target.identityFile);
  for (const option of target.extraOptions ?? []) args.push("-o", option);
  if (forward) {
    args.push("-N", "-L", `${forward.localPort}:${forward.remoteHost}:${forward.remotePort}`);
  }
  args.push(target.user ? `${target.user}@${target.host}` : target.host);
  if (remoteCommand) args.push(remoteCommand);
  return args;
}

/** Windows has no OpenSSH by default before 1809; this says whether the binary is there. */
export function hasSshClient(
  platform: PlatformId = detectPlatform(),
  finder: (name: string) => string | null = (name) => findBinary(name, { platform }),
): boolean {
  return capabilitiesFor(platform).sshClient && finder("ssh") !== null;
}

/* ────────────────────────────── home directories ───────────────────────────── */

/**
 * The per-user data directory for a product on this OS.
 *
 * This mirrors the family's rule (`docs/envoydev-platforms.md`) rather than inventing a
 * second one: an EnvoyDev home must be findable by the same logic EnvoyMesh uses, because
 * both apps share it. Kept here as well so the platform package has no dependency on the mesh
 * and can be used by the CLI before any mesh code is loaded.
 */
export function defaultDataDir(
  appName: string,
  options: { platform?: PlatformId; env?: NodeJS.ProcessEnv; home?: string } = {},
): string {
  const platform = options.platform ?? detectPlatform();
  const env = options.env ?? process.env;
  const home = options.home ?? env.HOME ?? env.USERPROFILE ?? "";
  if (platform === "windows") {
    const local = env.LOCALAPPDATA?.trim();
    // LOCALAPPDATA, never APPDATA: this directory holds keys, and a roaming profile ships them
    // to a domain controller.
    return joinFor(
      platform,
      local && local.length > 0 ? local : joinFor(platform, home, "AppData", "Local"),
      appName,
    );
  }
  if (platform === "macos") {
    return joinFor(platform, home, "Library", "Application Support", appName);
  }
  const xdg = env.XDG_DATA_HOME?.trim();
  return joinFor(
    platform,
    xdg && xdg.length > 0 ? xdg : joinFor(platform, home, ".local", "share"),
    appName,
  );
}

/**
 * Turn the path a person typed into a path the filesystem understands.
 *
 * A folder picker returns a real path; a person pasting one writes `~/work/api`, wraps it in quotes
 * because it has a space, or leaves the trailing slash they copied from Finder. All three were passed
 * straight to the daemon's existence check, which is why "Add project" could refuse a directory the user
 * was looking at — the failure mode was an error about a path that "does not exist" while it plainly does.
 *
 * `home` is a parameter rather than a lookup: on the daemon the right home is the daemon's, and a browser
 * client guessing `$HOME` would be wrong on exactly the machines where it matters.
 */
export function normalizeUserPath(input: string, home: string): string {
  let path = input.trim();

  // Quotes copied along with a path: strip one matching pair, never a lone one (a quote can be a real
  // character in a filename).
  if (path.length >= 2 && ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'")))) {
    path = path.slice(1, -1).trim();
  }

  if (path === "~") path = home;
  else if (path.startsWith("~/") || path.startsWith("~\\")) path = `${home}${path.slice(1)}`;

  // A trailing separator is what a copy from Finder carries; keep the root, where it is the whole path.
  while (path.length > 1 && (path.endsWith("/") || path.endsWith("\\"))) {
    path = path.slice(0, -1);
  }

  return path;
}

/**
 * The `PATH` a GUI-launched process should search, and the provenance of what it found.
 *
 * A separate module because it is a separate subject — the daemon's *environment* rather than the OS's
 * rules for paths and processes — and because it spawns a login shell, which is a thing `findBinary`
 * must never do. See its header for the measurement this exists for.
 */
export * from "./path-discovery.js";

/**
 * The programs the user's own login shell resolves, asked one name at a time.
 *
 * Separate from the `PATH` probe for a reason that is measured rather than taxonomic: a shell asked for
 * `$PATH` reports a variable, and a shell asked for a name reports the lookup it performs — and on this
 * machine those two answers differ for `dsh`, which is why it read as "not installed" while its owner ran it.
 * `composeSearchPath` puts each answer's directory at the head of the list, so the probe and the spawn see it.
 */
export * from "./shell-binaries.js";
