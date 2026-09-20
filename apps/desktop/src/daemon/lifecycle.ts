/**
 * What the daemon remembers about its own restarts.
 *
 * ## Why a restart has to be visible
 *
 * A supervisor exists so the daemon is always there, and that is exactly what makes its failures invisible: the
 * process comes back in a second and the phone reconnects, so a crash loop looks like a slightly slow morning.
 * `docs/daemon-lifecycle.md` §5 says a watchdog must not become the outage, which needs three things a
 * supervisor cannot supply on its own — a **count** (how many times), a **reason** (a signal, or a clean stop),
 * and a **when** (so "3 times in the last hour" can be told from "3 times since March"). All three are recorded
 * here, by the daemon, because the daemon is the only thing present at both ends of the gap.
 *
 * ## Why a ledger and not "the last exit code"
 *
 * One exit code is not enough to act on and easy to lose: a `SIGKILL` never reaches the process, so the *exit
 * record* is missing exactly when the crash was worst. Recording each **start** means the count survives a kill
 * — the boot that follows the kill is the evidence — while a clean stop writes its reason alongside, so the
 * common case ("I shut it down") is distinguishable from the rare one ("it died").
 *
 * ## The limits it keeps
 *
 * The ledger is deliberately tiny and capped: it is read by a health endpoint and shown in a settings pane, not
 * analysed. A corrupt or hand-edited file reads as "no history" rather than throwing, because a daemon that
 * refuses to start because its own restart log is malformed is a worse failure than one that forgets.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CoderPaths } from "@envoydev/host-bridge";

/** How many boots are kept. Enough for a restart storm, small enough to print. */
export const LIFECYCLE_BOOTS_KEPT = 20;

export interface LifecycleFacts {
  /** ISO timestamps of the most recent starts, oldest first. */
  boots: string[];
  /** The last start, when there was one. */
  lastStartedAt?: string;
  /** Why the previous process stopped, when it stopped on purpose. Absent means it was killed or crashed. */
  lastStop?: { at: string; signal: string };
  /** How many starts fall inside the last hour — the number a restart storm shows up in. */
  bootsInLastHour: number;
}

export function lifecyclePath(paths: CoderPaths): string {
  return join(paths.logsDir, "lifecycle.json");
}

/** Parse whatever is on disk into facts, or into "nothing known". Never throws. */
function parse(raw: string): Omit<LifecycleFacts, "bootsInLastHour"> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { boots: [] };
    const record = parsed as { boots?: unknown; lastStop?: unknown };
    const boots = Array.isArray(record.boots)
      ? record.boots.filter((value): value is string => typeof value === "string").slice(-LIFECYCLE_BOOTS_KEPT)
      : [];
    const stop = record.lastStop as { at?: unknown; signal?: unknown } | undefined;
    return {
      boots,
      ...(boots.length > 0 ? { lastStartedAt: boots[boots.length - 1] as string } : {}),
      ...(stop !== undefined && typeof stop.at === "string" && typeof stop.signal === "string"
        ? { lastStop: { at: stop.at, signal: stop.signal } }
        : {}),
    };
  } catch {
    return { boots: [] };
  }
}

function withinLastHour(boots: readonly string[], now: Date): number {
  const cutoff = now.getTime() - 3_600_000;
  return boots.filter((at) => {
    const parsed = Date.parse(at);
    // A timestamp nobody can read is not counted: the count is a claim about *time*, and a guess would inflate it.
    return Number.isFinite(parsed) && parsed >= cutoff;
  }).length;
}

/** What is known about this daemon's recent life. */
export async function readLifecycle(paths: CoderPaths, now: Date = new Date()): Promise<LifecycleFacts> {
  let raw: string;
  try {
    raw = await readFile(lifecyclePath(paths), "utf8");
  } catch {
    return { boots: [], bootsInLastHour: 0 };
  }
  const facts = parse(raw);
  return { ...facts, bootsInLastHour: withinLastHour(facts.boots, now) };
}

/**
 * Record this start, and answer with what was known **before** it.
 *
 * The returned `bootsInLastHour` counts *previous* starts, which is the number a boot report should print: this
 * start is not evidence of a restart, and counting it would make every healthy boot claim one.
 */
export async function recordBoot(
  paths: CoderPaths,
  options: { at?: Date } = {},
): Promise<LifecycleFacts> {
  const at = (options.at ?? new Date()).toISOString();
  const previous = await readLifecycle(paths, options.at ?? new Date());
  const boots = [...previous.boots, at].slice(-LIFECYCLE_BOOTS_KEPT);

  await mkdir(paths.logsDir, { recursive: true });
  const file = lifecyclePath(paths);
  const temp = `${file}.tmp-${process.pid}`;
  // Same atomic write as the claim: a reader must never see a half-written ledger.
  await writeFile(temp, `${JSON.stringify({ boots, ...(previous.lastStop ? { lastStop: previous.lastStop } : {}) }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temp, file);
  return previous;
}

/**
 * Record a **deliberate** stop, so the next boot can tell "I shut it down" from "it died".
 *
 * Called from the signal handler, which is the only place that knows the difference: a `SIGKILL` cannot reach
 * the process at all, and a crash never gets here — which is why the *absence* of this record is meaningful
 * rather than a gap in the data.
 */
export async function recordStop(
  paths: CoderPaths,
  options: { signal: string; at?: Date } = { signal: "unknown" },
): Promise<void> {
  const at = (options.at ?? new Date()).toISOString();
  const previous = await readLifecycle(paths, options.at ?? new Date());
  await mkdir(paths.logsDir, { recursive: true });
  const file = lifecyclePath(paths);
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(
    temp,
    `${JSON.stringify({ boots: previous.boots, lastStop: { at, signal: options.signal } }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(temp, file);
}
