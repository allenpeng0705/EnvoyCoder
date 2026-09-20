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
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

import { payloadPaths, readCurrent, versionDir } from "./payload.js";

/** Beside the restart ledger and the heartbeat file, so one directory tells the whole story of a restarted daemon. */
export const SERVICE_LOG_NAME = "service.log";

export function serviceLogPath(paths: CoderPaths = coderPaths()): string {
  return join(paths.stateDir, "logs", SERVICE_LOG_NAME);
}

export interface ServiceOptions {
  paths?: CoderPaths;
  /** The OS user's home, where a per-user unit file lives. Injected so a test can write into a temporary one. */
  userHome?: string;
  io?: ServiceIo;
}

/**
 * What the unit should run, or `undefined` when there is no installed payload to point at.
 *
 * `undefined` rather than a path that does not exist: a unit naming a missing program is a supervisor that
 * restarts forever against nothing, which is worse for the person than a switch that says "not ready yet".
 */
async function planInput(
  paths: CoderPaths,
  userHome: string,
  options: { requirePayload: boolean },
): Promise<ServicePlanInput | undefined> {
  const version = await readCurrent(paths);
  const payload = version === undefined ? undefined : payloadPaths(versionDir(paths, version));
  if (payload === undefined && options.requirePayload) return undefined;
  return {
    platform: detectPlatform(),
    // Empty for a removal: the file's *location* is what uninstalling needs, and it does not depend on these.
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

const noPayload: ServiceStatus = {
  state: "not-installed",
  detail: "the daemon payload is not installed on this machine yet",
};

export async function daemonServiceStatus(options: ServiceOptions = {}): Promise<ServiceStatus> {
  const paths = options.paths ?? coderPaths();
  const input = await planInput(paths, options.userHome ?? homedir(), { requirePayload: false });
  if (input === undefined) return noPayload;
  return readServiceStatus(options.io ?? realServiceIo, input);
}

export async function installDaemonService(options: ServiceOptions = {}): Promise<ServiceStatus> {
  const paths = options.paths ?? coderPaths();
  const input = await planInput(paths, options.userHome ?? homedir(), { requirePayload: true });
  if (input === undefined) return noPayload;
  return installService(options.io ?? realServiceIo, input);
}

export async function uninstallDaemonService(options: ServiceOptions = {}): Promise<ServiceStatus> {
  const paths = options.paths ?? coderPaths();
  // No payload required: a machine whose payload is gone must still be able to switch the service off.
  const input = await planInput(paths, options.userHome ?? homedir(), { requirePayload: false });
  if (input === undefined) return noPayload;
  return uninstallService(options.io ?? realServiceIo, input);
}

export async function restartDaemonService(options: ServiceOptions = {}): Promise<ServiceStatus> {
  const paths = options.paths ?? coderPaths();
  const input = await planInput(paths, options.userHome ?? homedir(), { requirePayload: false });
  if (input === undefined) return noPayload;
  return restartService(options.io ?? realServiceIo, input);
}
