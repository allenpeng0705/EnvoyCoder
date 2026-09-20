/**
 * The daemon's heartbeat: a file whose *age* is the signal.
 *
 * ## Why a file, and not `sd_notify` (which was the first attempt)
 *
 * systemd's watchdog protocol is a datagram to `$NOTIFY_SOCKET`, and **Node cannot send one**: `node:dgram` is
 * UDP-only, and the runtime answers `Bad socket type specified. Valid types are: udp4, udp6` for `unix_dgram` —
 * measured, not assumed. Speaking it anyway would mean spawning the `systemd-notify` binary on every beat or
 * taking a dependency, and neither is worth it for a message whose only content is "still here".
 *
 * So the heartbeat is a file the daemon rewrites on an interval, and **the signal is its age**. That works on all
 * three platforms and needs nothing installed:
 *
 *   * on **Linux**, the unit can still use `WatchdogSec` with `ExecStartPost`/`systemd-notify` if an operator wants
 *     systemd's own watchdog; the file is what a `systemd` timer or a health probe reads meanwhile;
 *   * on **macOS**, where launchd has no watchdog protocol at all, a `StartInterval` agent (or a wrapper the OS
 *     supervises) reads it — which is the only option there anyway;
 *   * on **Windows**, a scheduled task does the same.
 *
 * The comparison is deliberately left to the reader (`heartbeatIsStale`), because how long is too long depends on
 * what the daemon was doing: `docs/daemon-lifecycle.md` §5 puts that judgement with the supervisor.
 *
 * ## The rules a heartbeat must not break
 *
 *   * **It never keeps the process alive.** The timer is `unref`'d: a heartbeat is evidence of work, not a reason
 *     to stay up.
 *   * **It never takes the process down.** A failed write (a read-only logs directory, a full disk) is swallowed
 *     and retried on the next beat; a daemon that dies because it could not say "I am alive" is a worse failure
 *     than one that stays quiet.
 *   * **A written beat is complete or absent.** Written through a temporary file and renamed, so a reader never
 *     sees half a timestamp and concludes the daemon is dying.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CoderPaths } from "@envoydev/host-bridge";

/** How often to beat when the caller does not say. Slow enough to be free, fast enough for a minute-scale probe. */
export const DEFAULT_HEARTBEAT_MS = 10_000;

/** The states a beat can carry. `beating` is the daemon working; the other two bound its life. */
export type HeartbeatState = "ready" | "beating" | "stopping";

export interface HeartbeatRecord {
  at: string;
  state: HeartbeatState;
  pid: number;
}

export interface Heartbeat {
  /** This process is serving. */
  ready(): void;
  /** A deliberate shutdown has begun. */
  stopping(): void;
  /** Stop beating and release the timer. */
  stop(): void;
}

export function heartbeatPath(paths: CoderPaths): string {
  return join(paths.logsDir, "heartbeat.json");
}

/** Is a beat this old too old? Pure, so the policy is testable without a clock or a filesystem. */
export function heartbeatIsStale(ageMs: number, windowMs: number): boolean {
  return ageMs > windowMs;
}

export interface StartHeartbeatOptions {
  everyMs?: number;
  /** Injected by tests; the daemon uses the real clock. */
  now?: () => Date;
  /** Injected by tests, which need to see failures handled rather than thrown. */
  write?: (path: string, text: string) => Promise<void>;
}

/**
 * Start beating, writing `<logsDir>/heartbeat.json` every `everyMs`.
 *
 * Always returns a heartbeat: unlike a protocol that may not exist, a directory the daemon already owns is always
 * available, so there is no `undefined` case for call sites to handle.
 */
export function startHeartbeat(paths: CoderPaths, options: StartHeartbeatOptions = {}): Heartbeat {
  const everyMs = options.everyMs ?? DEFAULT_HEARTBEAT_MS;
  const now = options.now ?? (() => new Date());
  const path = heartbeatPath(paths);
  const write =
    options.write ??
    (async (target: string, text: string): Promise<void> => {
      await mkdir(paths.logsDir, { recursive: true });
      const temp = `${target}.tmp-${process.pid}`;
      await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });
      await rename(temp, target);
    });

  const beat = (state: HeartbeatState): void => {
    const record: HeartbeatRecord = { at: now().toISOString(), state, pid: process.pid };
    // Swallowed on purpose: see the module doc.
    void write(path, `${JSON.stringify(record)}\n`).catch(() => undefined);
  };

  const timer = setInterval(() => beat("beating"), everyMs);
  timer.unref?.();

  const stopTimer = (): void => clearInterval(timer);

  return {
    ready: () => beat("ready"),
    /**
     * **The last word is `stopping`.** Clearing the timer here, rather than only in `stop`, is not tidiness: the
     * interval would otherwise overwrite the shutdown record with `beating` on its next tick, and a supervisor
     * watching the file would see a daemon that is going down claim to be working. (Found by a test that read the
     * record, waited, and read a different one — the race was mine, the wart was the module's.)
     */
    stopping: () => {
      stopTimer();
      beat("stopping");
    },
    stop: stopTimer,
  };
}

/** The last beat, or nothing when there is none or it cannot be read. */
export async function readHeartbeat(
  paths: CoderPaths,
  read: (path: string) => Promise<string> = (path) => import("node:fs/promises").then((fs) => fs.readFile(path, "utf8")),
): Promise<HeartbeatRecord | undefined> {
  try {
    const parsed: unknown = JSON.parse(await read(heartbeatPath(paths)));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as { at?: unknown; state?: unknown; pid?: unknown };
    if (typeof record.at !== "string" || typeof record.pid !== "number") return undefined;
    const state = record.state === "ready" || record.state === "stopping" ? record.state : "beating";
    return { at: record.at, state, pid: record.pid };
  } catch {
    // Absent, unreadable, or not a beat: all of them mean "no evidence this daemon is alive", which is what the
    // caller acts on, and none of them is a reason to throw.
    return undefined;
  }
}
