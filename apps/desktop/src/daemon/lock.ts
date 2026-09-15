/**
 * Who owns this machine's daemon, and how a second process finds out.
 *
 * ## Why a lock file and not "is the port taken"
 *
 * "Something answers on 4770" and "our daemon answers on 4770" are different questions, and only
 * the second is worth acting on. Binding the port is not ownership: a second process that finds
 * the port busy cannot tell our daemon from a stranger's, and a process that decides to kill
 * whoever is on the port is one keystroke from killing somebody else's program. The family's own
 * Tauri shell paid for exactly this (`apps/tauri/src-tauri/src/main.rs`: it used to kill whatever
 * held its ports by pid from `lsof`, and now kills only the pid it recorded itself).
 *
 * So the daemon **publishes a claim** — pid, port, instance id — and everyone else reads it:
 *
 *   * the shell reads it to decide between attaching and starting a second daemon;
 *   * the window reads it, then **verifies over the wire** that the daemon answering is the one the
 *     claim names (`coder.hello`'s `instanceId`), which is the half a file cannot prove;
 *   * the daemon itself reads it at startup to notice that a previous run left a claim behind.
 *
 * ## Staleness is a dead pid, nothing subtler
 *
 * A claim whose pid is gone is stale, and is replaced. No heartbeat file, no timeout window: a
 * pid that no longer exists cannot be serving, and a timeout would make a daemon that is merely
 * *busy* look dead — at which point two daemons race for one state directory, which is worse than
 * the problem a heartbeat would have solved.
 *
 * The one thing this cannot see is **pid reuse** — a different program inheriting the number after
 * a reboot. That is why the claim carries an `instanceId` and why the window verifies it: the file
 * narrows the question, the protocol answers it.
 */

import { execFileSync } from "node:child_process";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { ENVOYCODER_PRODUCT_NAME } from "@envoycoder/protocol";

import type { CoderPaths } from "@envoycoder/host-bridge";

/** The claim a running daemon leaves behind. Everything here is safe to show a user. */
export interface DaemonDescriptor {
  product: string;
  /** Identity of the *process*: generated per start, never persisted between runs. */
  instanceId: string;
  pid: number;
  host: string;
  port: number;
  /** The WebSocket path, so a client never has to guess `/ws`. */
  path: string;
  home: string;
  stateDir: string;
  startedAt: string;
  version: string;
  /** Where the shell installed the daemon's entry point, for diagnostics. */
  entry?: string;
}

export function daemonDescriptorPath(paths: CoderPaths): string {
  return join(paths.stateDir, "daemon.json");
}

/**
 * Is this pid still a **running** process?
 *
 * `kill(pid, 0)` is the portable probe: it performs no signalling and reports `ESRCH` for a pid
 * that does not exist. Three wrinkles, all handled rather than ignored:
 *
 *   * **`EPERM` means alive.** The process exists and belongs to somebody else — a daemon started
 *     by another user account on a shared machine. Reporting "dead" there would start a second
 *     daemon against one state directory.
 *   * **`EINVAL`/`ERR_OUT_OF_RANGE`** come back for a nonsense pid (0, negative, or beyond the
 *     pid space) rather than `ESRCH`. That is "not a process", which is the answer we want anyway.
 *   * **A zombie is not running.** A process that has exited and has not been reaped still answers
 *     `kill(pid, 0)`. The shell is the parent of the daemon it spawns, so a daemon that dies while a
 *     window is open stays a zombie until the shell reaps it — and a claim naming it would make this
 *     daemon refuse to start ("already running") and the window report a daemon that never answers.
 *     The same rule is implemented in the shell (`main.rs`, `is_alive`) because the two answer the
 *     same question for the same claim, and a rule that is *nearly* the same on both sides is how
 *     this product lost an afternoon to two homes (`docs/envoycoder-platforms.md` §5).
 */
export function isProcessAlive(
  pid: number,
  probe: (pid: number) => void = defaultProbe,
  stateOf: (pid: number) => string | null = defaultProcessState,
): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    probe(pid);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES") return false;
  }
  // An unreadable state counts as *not* a zombie: believing a live process is dead costs a second daemon
  // against one state directory, which is the worse of the two mistakes.
  return !(stateOf(pid) ?? "").startsWith("Z");
}

function defaultProbe(pid: number): void {
  process.kill(pid, 0);
}

/**
 * The process's state letter, or `null` when it cannot be read.
 *
 * Windows has no zombie state — an exited process is gone — so `ps` is not consulted there at all.
 */
function defaultProcessState(pid: number): string | null {
  if (process.platform === "win32") return null;
  try {
    const state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return state === "" ? null : state;
  } catch {
    // `ps` exits non-zero for a pid it cannot see. That is not evidence of life, and the probe has already had
    // its say, so an unreadable state is reported as unknown rather than as dead.
    return null;
  }
}

export type DaemonClaim =
  | { state: "none" }
  /** A claim exists but its process is gone: the previous run died without cleaning up. */
  | { state: "stale"; descriptor: DaemonDescriptor }
  /** A process is alive and claiming this home. Whether it is *our* daemon needs the wire check. */
  | { state: "running"; descriptor: DaemonDescriptor }
  /** A claim exists and cannot be read. Treated as absent, but reported. */
  | { state: "unreadable"; reason: string };

/** Read the claim, if there is one, and say what it is worth. */
export async function readDaemonClaim(
  paths: CoderPaths,
  probe?: (pid: number) => void,
): Promise<DaemonClaim> {
  const file = daemonDescriptorPath(paths);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "none" };
    return { state: "unreadable", reason: error instanceof Error ? error.message : String(error) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { state: "unreadable", reason: `not readable as JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const descriptor = parsed as Partial<DaemonDescriptor>;
  if (
    typeof descriptor.pid !== "number" ||
    typeof descriptor.port !== "number" ||
    typeof descriptor.instanceId !== "string" ||
    descriptor.instanceId === "" ||
    descriptor.product !== ENVOYCODER_PRODUCT_NAME
  ) {
    return {
      state: "unreadable",
      reason: "it does not describe an EnvoyCoder daemon (product, pid, port and instanceId must all be present)",
    };
  }

  const complete = {
    product: ENVOYCODER_PRODUCT_NAME,
    instanceId: descriptor.instanceId,
    pid: descriptor.pid,
    host: descriptor.host ?? "127.0.0.1",
    port: descriptor.port,
    path: descriptor.path ?? "/ws",
    home: descriptor.home ?? paths.home,
    stateDir: descriptor.stateDir ?? paths.stateDir,
    startedAt: descriptor.startedAt ?? new Date(0).toISOString(),
    version: descriptor.version ?? "unknown",
    ...(descriptor.entry ? { entry: descriptor.entry } : {}),
  } satisfies DaemonDescriptor;

  return isProcessAlive(descriptor.pid, probe)
    ? { state: "running", descriptor: complete }
    : { state: "stale", descriptor: complete };
}

/**
 * Publish this process's claim, **after** the port is bound.
 *
 * Order matters and is the whole reason this takes a bound port: a claim written before the socket
 * listens would send the next window to a port with nobody behind it, and that window would report
 * "the daemon is not answering" for a daemon that is starting up perfectly well.
 */
export async function writeDaemonClaim(paths: CoderPaths, descriptor: DaemonDescriptor): Promise<void> {
  const file = daemonDescriptorPath(paths);
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, file);
}

/**
 * Remove this process's claim — **only if it is still ours**.
 *
 * The check is not defensive programming: a daemon that is shutting down slowly (draining agents)
 * can outlive its own replacement. Deleting the newcomer's claim on the way out would leave a
 * healthy daemon that nobody can find, and the next window would start a third.
 */
export async function clearDaemonClaim(paths: CoderPaths, instanceId: string): Promise<boolean> {
  const file = daemonDescriptorPath(paths);
  const claim = await readDaemonClaim(paths);
  if (claim.state === "none") return false;
  const current = "descriptor" in claim ? claim.descriptor.instanceId : undefined;
  if (claim.state === "unreadable" || current !== instanceId) return false;
  try {
    await unlink(file);
    return true;
  } catch {
    return false;
  }
}
