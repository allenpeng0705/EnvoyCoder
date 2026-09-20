import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import { readLifecycle, recordBoot, recordStop } from "../src/daemon/lifecycle.js";

const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

async function tempPaths() {
  const home = await mkdtemp(join(tmpdir(), "envoydev-exit-code-"));
  homes.push(home);
  return coderPaths(home);
}

describe("the exit code a controlled failure leaves behind", () => {
  it("survives being written, read, and outlived by a later boot", async () => {
    // The owed sliver of item 4: a boot that refused was *deliberate*, with a documented code, and the next boot
    // should be able to say which refusal this was instead of reporting a crash that never happened.
    const paths = await tempPaths();
    await recordStop(paths, { signal: "refused", exitCode: 4 });
    expect((await readLifecycle(paths)).lastStop).toMatchObject({ signal: "refused", exitCode: 4 });
    // A later start keeps the previous stop's code, because it describes the *previous* process.
    const before = await recordBoot(paths);
    expect(before.lastStop?.exitCode).toBe(4);
  });

  it("omits the code entirely when the process simply stopped", async () => {
    // Absent is not zero: a `SIGTERM` has no exit code of its own, and printing "exit code 0" for it would read as
    // a clean shutdown that somebody chose.
    const paths = await tempPaths();
    await recordStop(paths, { signal: "SIGTERM" });
    const stop = (await readLifecycle(paths)).lastStop;
    expect(stop?.signal).toBe("SIGTERM");
    expect(stop).not.toHaveProperty("exitCode");
  });
});
