/**
 * The daemon's side of the service switch: point a supervisor at the installed payload.
 *
 * The decisions — the unit's text, the commands, how to read each supervisor's answer — are in
 * `@envoydev/platform` (`service.ts`, `service-install.ts`), where they are tested on every platform the suite
 * runs on. What is left for this file is the part that is genuinely the *daemon's* business: which payload the
 * unit should run, where its log goes, and the real I/O that the plans were written against.
 *
 * Two things about that payload are worth stating, because both were learned the hard way:
 *
 *   * **The unit runs the installed copy, never the app bundle.** A `dmg`, an `nsis` installer and a `deb` all
 *     replace their own directory on upgrade, so a unit pointing into one would break — or, on Windows, be
 *     uninstallable — the first time somebody updated the app while the service was meant to keep running.
 *     `<stateDir>/runtime/<version>/app/main.mjs` stays where it is until the daemon itself moves it.
 *   * **Nothing here decides *whether* to run as a service.** That is the person's setting; this file only carries
 *     it out and reports what the supervisor says, including that it said no.
 *
 * ## Two operations run in a child process, and that is not an optimisation
 *
 * `uninstall` and `restart` end the daemon they are invoked from, and on systemd both are **synchronous**:
 * `systemctl --user disable --now` / `restart` SIGTERMs this process, waits for it to become inactive, and only
 * then returns. A step sequenced *after* that call — the `removeFile` that makes "turn off" mean the unit file
 * is gone, the second `daemon-reload`, the status read, the RPC reply — never runs, and "turn off" left the unit
 * on disk. So those two are performed by `<node> <payload entry> service uninstall|restart`, the entry point the
 * lifecycle doc already says installers use (`docs/daemon-lifecycle.md` §6, §8), spawned with the same
 * `ENVOYMESH_HOME` this daemon resolved and given a bounded wait. The **install** path stays in-process: it starts
 * a service that is not this process, and the hand-over it owes is `supervisor-rpc.ts`'s business.
 */

import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { coderPaths, type CoderPaths } from "@envoydev/host-bridge";
import {
  detectPlatform,
  installService,
  readServiceStatus,
  restartService,
  uninstallService,
  type ServiceIo,
  type ServicePlanInput,
  type ServiceStatus,
} from "@envoydev/platform";

import { installRunningBundle, payloadPaths, readCurrent, versionDir } from "./payload.js";
import { DAEMON_VERSION } from "./version.js";

/** Beside the restart ledger and the heartbeat file, so one directory tells the whole story of a restarted daemon. */
export const SERVICE_LOG_NAME = "service.log";

export function serviceLogPath(paths: CoderPaths = coderPaths()): string {
  return join(paths.stateDir, "logs", SERVICE_LOG_NAME);
}

/**
 * How long an out-of-process `service` command may take.
 *
 * Generous on purpose: the command runs the real supervisor, and a `disable --now` on a machine with a live
 * agent waits for the drain the same way this daemon does. A minute is long enough that the bound is only
 * reached by a wedged supervisor, and short enough that a wedged one cannot hold an RPC reply for ever.
 */
export const SERVICE_COMMAND_TIMEOUT_MS = 60_000;

/** How much of a child's output becomes `detail`. Enough for a supervisor's complaint, not a memory hazard. */
const SERVICE_COMMAND_OUTPUT_LIMIT = 64 * 1024;

export interface ServiceOptions {
  paths?: CoderPaths;
  /** The version to install when a payload has to be created. Injected so a test never depends on the real one. */
  version?: string;
  /** The argv whose entry point gets installed, and the program the out-of-process commands run (injected for tests). */
  argv?: readonly string[];
  node?: string;
  /** The OS user's home, where a per-user unit file lives. Injected so a test can write into a temporary one. */
  userHome?: string;
  io?: ServiceIo;
  /**
   * The spawn for the out-of-process `service uninstall|restart` commands.
   *
   * Injected for the reason every other I/O here is, and one more: a test that reached the real one would
   * install, remove or restart a service on the machine hosting the suite.
   */
  spawnServiceCommand?: ServiceCommandSpawn;
  /** How long an out-of-process command may take before it is treated as wedged. Defaults to `SERVICE_COMMAND_TIMEOUT_MS`. */
  commandTimeoutMs?: number;
  /**
   * Begin **this** daemon's graceful stop — the hook `coder.shutdown` and `main.mjs stop` both reach.
   *
   * It is what lets a restart ask before it kills (`docs/daemon-lifecycle.md` §11): a supervisor's stop is a
   * `SIGTERM`, which cuts a live agent's turn in half, so the drain rule (`runs.stopAll`, up to ten seconds)
   * has to start first. Absent in a bench or a daemon with no stop path, which is a restart through the
   * supervisor alone.
   */
  shutdown?: () => void;
}

/**
 * What the unit should run.
 *
 * **A removal needs no payload, and the plan does not pretend otherwise.** The unit file's *location* is the
 * only thing uninstall and restart turn on, and it comes from `userHome` and the label. `node`/`entry` are
 * therefore empty when no version is installed (see the doc above); install, the one operation that writes the
 * file, installs the payload first, so it always has both. There used to be a `requirePayload` switch and a
 * "the daemon payload is not installed on this machine yet" status — the switch never changed the outcome of
 * any caller and the status had no wire state to reach (`ServiceStatus` has no "no payload" member), so both
 * were deleted rather than left as a branch no test could run.
 */
async function planInput(paths: CoderPaths, userHome: string): Promise<ServicePlanInput> {
  const version = await readCurrent(paths);
  const payload = version === undefined ? undefined : payloadPaths(versionDir(paths, version));
  return {
    platform: detectPlatform(),
    node: payload?.node ?? "",
    entry: payload?.entry ?? "",
    home: paths.home,
    logPath: serviceLogPath(paths),
    userHome,
    // launchd's domain is `gui/<uid>`. Only macOS reads it, and only macOS has `getuid` at all.
    uid: process.getuid?.() ?? 0,
  };
}

/**
 * The real I/O: `execFile` with an argument array, so nothing a path contains can be read as shell syntax.
 *
 * `code` is a number for every exit, including the ones that never started a program: a supervisor that is not
 * installed (a container without systemd, a stripped Windows image) reports **127**, which is what a shell uses
 * for "command not found". Reporting `0` there would turn a missing `systemctl` into a successful install.
 */
export const realServiceIo: ServiceIo = {
  run: (step) =>
    new Promise((resolve) => {
      execFile(step.command, step.args, { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code;
        resolve({
          code: typeof code === "number" ? code : error ? 127 : 0,
          stdout: stdout ?? "",
          stderr: stderr || (error ? String(error.message) : ""),
        });
      });
    }),
  writeFile: (path, contents) => fs.writeFile(path, contents, "utf8"),
  // `force` so removing a unit file that is already gone is the expected path, not an error.
  removeFile: (path) => fs.rm(path, { force: true }),
  ensureDirectory: (path) => fs.mkdir(path, { recursive: true }).then(() => undefined),
};

/** One finished out-of-process `service` command. */
export interface ServiceCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** The command did not finish inside the bound and was killed. */
  timedOut: boolean;
}

/** The spawn for one out-of-process `service` command. Real in the daemon, a canned answer in the suite. */
export type ServiceCommandSpawn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd?: string; timeoutMs: number },
) => Promise<ServiceCommandResult>;

/**
 * The real spawn, **detached**, with a kill on timeout.
 *
 * `detached` is the load-bearing option, not tidiness: the whole point of running these two commands out of
 * process is that the command must outlive the daemon it is stopping. In the same process group it would be
 * killed with its parent — the in-process failure wearing a child's clothes.
 *
 * `spawn` rather than `execFile`: `execFile`'s options type has no `detached`, and the output bound has to be
 * ours anyway — a supervisor that prints a megabyte must not become a megabyte of `detail` on the wire.
 */
export const realServiceCommandSpawn: ServiceCommandSpawn = (command, args, options) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], {
      env: options.env,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      windowsHide: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current: string, chunk: Buffer): string =>
      current.length >= SERVICE_COMMAND_OUTPUT_LIMIT
        ? current
        : (current + chunk.toString("utf8")).slice(0, SERVICE_COMMAND_OUTPUT_LIMIT);
    const timer = setTimeout(() => {
      timedOut = true;
      // `SIGKILL`, because a wedged supervisor that ignores `SIGTERM` must not hold the reply for ever.
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || error.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });

export async function daemonServiceStatus(options: ServiceOptions = {}): Promise<ServiceStatus> {
  const paths = options.paths ?? coderPaths();
  return readServiceStatus(options.io ?? realServiceIo, await planInput(paths, options.userHome ?? homedir()));
}

export async function installDaemonService(options: ServiceOptions = {}): Promise<ServiceStatus> {
  const paths = options.paths ?? coderPaths();
  /**
   * **A service needs a payload, and a fresh machine has none.**
   *
   * The switch is meant to take somebody from "the phone can only reach me while the window is open" to "it can
   * always reach me" in one press, so pressing it installs the payload the unit will run and then the unit. A unit
   * installed without one names a version that was never copied, which a supervisor answers by restarting for ever
   * against nothing.
   */
  if ((await readCurrent(paths)) === undefined) {
    await installRunningBundle(paths, {
      version: options.version ?? DAEMON_VERSION,
      ...(options.argv ? { argv: options.argv } : {}),
      ...(options.node ? { node: options.node } : {}),
    });
  }
  return installService(options.io ?? realServiceIo, await planInput(paths, options.userHome ?? homedir()));
}

/** Uninstall **in this process**. The `service uninstall` CLI runs here; the RPC handler must not. */
export async function uninstallDaemonService(options: ServiceOptions = {}): Promise<ServiceStatus> {
  const paths = options.paths ?? coderPaths();
  // No payload required: a machine whose payload is gone must still be able to switch the service off.
  return uninstallService(options.io ?? realServiceIo, await planInput(paths, options.userHome ?? homedir()));
}

/** Restart **in this process**. The `service restart` CLI runs here; the RPC handler must not. */
export async function restartDaemonService(options: ServiceOptions = {}): Promise<ServiceStatus> {
  const paths = options.paths ?? coderPaths();
  return restartService(options.io ?? realServiceIo, await planInput(paths, options.userHome ?? homedir()));
}

/**
 * The program an out-of-process `service` command runs.
 *
 * The installed payload first, because that is exactly what the unit runs and what `main.mjs service …`
 * documents. The fallback to this process's own argv is not a nicety: `service uninstall` is the one command a
 * machine must be able to run *after* its payload was pruned (`docs/daemon-lifecycle.md` §8), and a daemon
 * still serving is proof that some program exists to run it.
 */
async function serviceCliProgram(paths: CoderPaths, options: ServiceOptions): Promise<{ node: string; entry: string }> {
  const version = await readCurrent(paths);
  if (version !== undefined) return payloadPaths(versionDir(paths, version));
  const argv = options.argv ?? process.argv;
  return { node: options.node ?? argv[0] ?? process.execPath, entry: argv[1] ?? "main.mjs" };
}

/** The command's own words, both streams, for a user who has to be told what the supervisor said. */
function commandOutput(result: ServiceCommandResult): string {
  return [result.stdout, result.stderr]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n");
}

/**
 * Run `service <action>` **out of process** and turn its exit code and output into the status the window renders.
 *
 * The two decisions this encodes:
 *
 *   * **The same home as this daemon.** `ENVOYMESH_HOME` is passed explicitly rather than left to the child's
 *     inherited environment, because the child would otherwise act on the process's default home — read one
 *     home's ledger while removing another home's unit file, the class of defect `supervisor-rpc.ts` documents.
 *   * **The exit code is the outcome, the output is the words.** `service-cli.ts`'s `describeService` exits 0 only
 *     in the state the action aimed at, so a non-zero exit is a failure carrying the supervisor's own complaint.
 *     On success the *state* is still asked of the supervisor, in this process, because for a restart exit 0
 *     covers both "running" and "accepted, not started yet" — but when this daemon is the process the command
 *     just stopped, that read never runs, and the command has already done the work. That is the fix.
 */
export async function runServiceCommandOutOfProcess(
  action: "uninstall" | "restart",
  options: ServiceOptions = {},
): Promise<ServiceStatus> {
  const paths = options.paths ?? coderPaths();
  const program = await serviceCliProgram(paths, options);
  const timeoutMs = options.commandTimeoutMs ?? SERVICE_COMMAND_TIMEOUT_MS;
  const result = await (options.spawnServiceCommand ?? realServiceCommandSpawn)(
    program.node,
    [program.entry, "service", action],
    {
      env: { ...process.env, ENVOYMESH_HOME: paths.home },
      cwd: dirname(program.entry),
      timeoutMs,
    },
  );
  if (result.timedOut) {
    return { state: "failed", detail: `\`service ${action}\` did not finish within ${timeoutMs} ms` };
  }
  if (result.code !== 0) {
    return {
      state: "failed",
      detail: commandOutput(result) || `\`service ${action}\` exited ${result.code ?? "without a code"}`,
    };
  }
  return daemonServiceStatus(options);
}

/** Turn the service off out of process — see the module doc for why this cannot be in-process. */
export async function uninstallServiceOutOfProcess(options: ServiceOptions = {}): Promise<ServiceStatus> {
  return runServiceCommandOutOfProcess("uninstall", options);
}

/**
 * Restart out of process, **after asking this daemon to stop**.
 *
 * A restart that goes straight to the supervisor is a kill: systemd's stop is a `SIGTERM`, which cuts a live
 * agent's turn in half. The drain rule this milestone built (`runs.stopAll`, up to ten seconds) exists so that
 * a restart asks first, and `shutdown` is the hook `coder.shutdown` and `main.mjs stop` both reach. The call is
 * synchronous and only *begins* the drain — the supervisor command below is spawned before this process starts
 * closing anything, so the two do not race.
 */
export async function restartServiceOutOfProcess(options: ServiceOptions = {}): Promise<ServiceStatus> {
  options.shutdown?.();
  return runServiceCommandOutOfProcess("restart", options);
}
