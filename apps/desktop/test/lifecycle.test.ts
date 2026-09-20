/**
 * The restart ledger: what a supervisor hides, and what the daemon has to remember instead.
 *
 * The assertions that matter are about the two ways this could mislead: a **count** that a kill destroys (it
 * does not — the next boot is the evidence, which is why starts are recorded rather than exits), and a **file
 * that cannot be read** taking the daemon down with it (it must read as "no history", because a daemon refusing
 * to start over its own restart log is a worse failure than one that forgets).
 *
 * @vitest-environment node
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import {
  LIFECYCLE_BOOTS_KEPT,
  lifecyclePath,
  readLifecycle,
  recordBoot,
  recordStop,
} from "../src/daemon/lifecycle.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function home(): Promise<ReturnType<typeof coderPaths>> {
  const dir = await mkdtemp(join(tmpdir(), "envoydev-lifecycle-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const paths = coderPaths(dir);
  await mkdir(paths.logsDir, { recursive: true });
  return paths;
}

describe("the daemon's restart ledger", () => {
  it("counts starts, not exits, so a kill still shows up as a restart", async () => {
    const paths = await home();
    const t0 = new Date("2026-01-01T00:00:00.000Z");

    // The first boot has no history at all — and "no previous start" is an *absent* field, not an empty one.
    const first = await recordBoot(paths, { at: t0 });
    expect(first.bootsInLastHour).toBe(0);
    expect(first.lastStartedAt).toBeUndefined();
    // …and each later boot reports the starts that came *before* it: this one is not evidence of a restart.
    expect(await recordBoot(paths, { at: new Date(t0.getTime() + 60_000) })).toMatchObject({
      bootsInLastHour: 1,
      lastStartedAt: t0.toISOString(),
    });
    expect(await recordBoot(paths, { at: new Date(t0.getTime() + 120_000) })).toMatchObject({ bootsInLastHour: 2 });

    // Now a boot an hour and a half later: the old starts are outside the window, so it reports zero — that is
    // the difference between "3 restarts since March" and "3 in the last hour".
    expect(await recordBoot(paths, { at: new Date(t0.getTime() + 5_400_000) })).toMatchObject({ bootsInLastHour: 0 });
    const facts = await readLifecycle(paths, new Date(t0.getTime() + 5_400_000));
    expect(facts.boots).toHaveLength(4);
    expect(facts.bootsInLastHour).toBe(1);
  });

  it("records a deliberate stop, so a clean shutdown is distinguishable from a death", async () => {
    const paths = await home();
    await recordBoot(paths, { at: new Date("2026-01-01T00:00:00.000Z") });
    // No stop record yet: the previous daemon was killed or crashed. That absence is the signal.
    expect((await readLifecycle(paths)).lastStop).toBeUndefined();

    await recordStop(paths, { signal: "SIGTERM", at: new Date("2026-01-01T00:10:00.000Z") });
    const stopped = await readLifecycle(paths);
    expect(stopped.lastStop).toEqual({ at: "2026-01-01T00:10:00.000Z", signal: "SIGTERM" });
    // And the history survives the stop: the next boot still sees the starts.
    expect(stopped.boots).toHaveLength(1);
  });

  it("reads a corrupt or hand-edited ledger as no history, rather than refusing to start", async () => {
    const paths = await home();
    for (const junk of ["not json at all", "[]", '{"boots":"nope","lastStop":{"at":1}}', ""]) {
      await writeFile(lifecyclePath(paths), junk, "utf8");
      expect(await readLifecycle(paths)).toEqual({ boots: [], bootsInLastHour: 0 });
      // A boot still succeeds on top of it.
      await recordBoot(paths, { at: new Date("2026-01-01T00:00:00.000Z") });
    }
    // A timestamp nobody can parse is not counted: the count is a claim about time and a guess would inflate it.
    await writeFile(lifecyclePath(paths), JSON.stringify({ boots: ["not a date", "2026-01-01T00:00:00.000Z"] }), "utf8");
    expect((await readLifecycle(paths, new Date("2026-01-01T00:01:00.000Z"))).bootsInLastHour).toBe(1);
  });

  it("keeps the ledger small enough to read at boot", async () => {
    const paths = await home();
    for (let index = 0; index < LIFECYCLE_BOOTS_KEPT + 5; index += 1) {
      await recordBoot(paths, { at: new Date(2026, 0, 1, 0, index) });
    }
    const facts = await readLifecycle(paths);
    expect(facts.boots).toHaveLength(LIFECYCLE_BOOTS_KEPT);
    // The newest survives the cap — a ledger that dropped the boot you are in would be useless.
    expect(facts.lastStartedAt).toBe(new Date(2026, 0, 1, 0, LIFECYCLE_BOOTS_KEPT + 4).toISOString());
  });
});
