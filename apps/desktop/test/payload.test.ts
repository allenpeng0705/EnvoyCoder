/**
 * Installing a payload: what it copies, what it protects, and what it must never do.
 *
 * The two assertions that matter are about failure, not success: a failed install leaves **no** half-installed
 * version and leaves `current` exactly where it was (or a bad copy makes an update that half-happened, which is
 * worse than one that did not), and pruning never removes the version that is current — it deletes directories,
 * and the one it must not delete is the one a running daemon is executing out of.
 *
 * @vitest-environment node
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import {
  currentPointer,
  installPayload,
  payloadPaths,
  pruneVersions,
  readCurrent,
  runtimeRoot,
  versionDir,
} from "../src/daemon/payload.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A throwaway home with a state directory, plus a source payload to install from. */
async function fixture(): Promise<{ paths: ReturnType<typeof coderPaths>; source: string }> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-payload-"));
  cleanups.push(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const paths = coderPaths(home);
  await mkdir(paths.stateDir, { recursive: true });

  const source = join(home, "bundle");
  await mkdir(join(source, "harness"), { recursive: true });
  await writeFile(join(source, "node"), "#!/bin/sh\necho node\n", "utf8");
  await writeFile(join(source, "main.mjs"), "// the daemon\n", "utf8");
  await writeFile(join(source, "harness", "envoy-harness"), "#!/bin/sh\necho harness\n", "utf8");
  return { paths, source };
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

describe("the daemon's payload", () => {
  it("copies the payload beside the state and points current at it", async () => {
    const { paths, source } = await fixture();
    const installed = await installPayload(paths, {
      version: "1.2.3",
      node: join(source, "node"),
      entry: join(source, "main.mjs"),
      harness: join(source, "harness"),
    });

    expect(installed).toMatchObject({ version: "1.2.3", installed: true });
    // Where the design says it goes: `<shared home>/EnvoyDev/runtime/<version>`.
    expect(installed.dir).toBe(versionDir(paths, "1.2.3"));
    expect(installed.dir.startsWith(runtimeRoot(paths))).toBe(true);

    const paths_ = payloadPaths(installed.dir);
    expect((await readFile(paths_.entry, "utf8")).trim()).toBe("// the daemon");
    expect(await exists(paths_.node)).toBe(true);
    expect(await exists(join(installed.dir, "harness", "envoy-harness"))).toBe(true);
    // The pointer a launcher reads, as a file — a symlink would need elevation on Windows.
    expect((await readFile(currentPointer(paths), "utf8")).trim()).toBe("1.2.3");
    expect(await readCurrent(paths)).toBe("1.2.3");
  });

  it("leaves an already-installed version alone, because a live daemon may be running from it", async () => {
    const { paths, source } = await fixture();
    await installPayload(paths, { version: "1.0.0", node: join(source, "node"), entry: join(source, "main.mjs") });
    // Something a running daemon would have written: rewriting the directory would take it out from under.
    const marker = join(versionDir(paths, "1.0.0"), "in-use");
    await writeFile(marker, "keep me", "utf8");

    const again = await installPayload(paths, {
      version: "1.0.0",
      node: join(source, "node"),
      entry: join(source, "main.mjs"),
    });
    expect(again.installed).toBe(false);
    expect(await readFile(marker, "utf8")).toBe("keep me");
  });

  it("leaves no half-installed version and does not move current when the copy fails", async () => {
    const { paths, source } = await fixture();
    await installPayload(paths, { version: "1.0.0", node: join(source, "node"), entry: join(source, "main.mjs") });

    await expect(
      installPayload(paths, {
        version: "2.0.0",
        node: join(source, "node"),
        // A source that is not there: the realistic failure (a bundle that lost a file, a full disk).
        entry: join(source, "missing.mjs"),
      }),
    ).rejects.toThrow();

    expect(await exists(versionDir(paths, "2.0.0"))).toBe(false);
    expect(await readCurrent(paths)).toBe("1.0.0");
    // And no temporary directory is left behind for the next install to trip over.
    const leftovers = (await import("node:fs/promises")).readdir(runtimeRoot(paths));
    expect((await leftovers).filter((entry) => entry.startsWith("."))).toEqual([]);
  });

  it("treats a pointer whose version is gone as nothing, rather than as a path that will fail to exec", async () => {
    const { paths, source } = await fixture();
    await installPayload(paths, { version: "3.0.0", node: join(source, "node"), entry: join(source, "main.mjs") });
    await rm(versionDir(paths, "3.0.0"), { recursive: true, force: true });

    expect(await readCurrent(paths)).toBeUndefined();
    // A pointer naming something that is not a version is not followed either — it would be a path traversal.
    await writeFile(currentPointer(paths), "../../etc\n", "utf8");
    expect(await readCurrent(paths)).toBeUndefined();
  });

  it("prunes what the caller does not protect, and never the version that is current", async () => {
    const { paths, source } = await fixture();
    for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
      await installPayload(paths, { version, node: join(source, "node"), entry: join(source, "main.mjs") });
    }
    // `current` is now 1.2.0; the caller keeps 1.1.0 for rollback.
    const removed = await pruneVersions(paths, { protect: ["1.1.0"] });

    expect(removed).toEqual(["1.0.0"]);
    expect(await exists(versionDir(paths, "1.0.0"))).toBe(false);
    expect(await exists(versionDir(paths, "1.1.0"))).toBe(true);
    expect(await exists(versionDir(paths, "1.2.0"))).toBe(true);
    expect(await readCurrent(paths)).toBe("1.2.0");
  });
});
