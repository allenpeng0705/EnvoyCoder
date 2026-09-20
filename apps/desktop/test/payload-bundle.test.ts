/**
 * The installed payload's **shape** — the two bugs that only running it revealed.
 *
 * `payload.test.ts` covers copying and the pointer; this file pins the two facts that made the difference between a
 * payload that looks installed and one that starts:
 *
 *   * the bundle is copied **whole** — `main.mjs` alone cannot resolve `@envoydev/protocol`, which is how the first
 *     version failed (`ERR_MODULE_NOT_FOUND`);
 *   * the entry lives **inside** that bundle, because Node resolves a bare import by walking up from the importing
 *     file's directory — the flat copy beside `node_modules` at the version root failed on `zod` with every
 *     dependency present.
 *
 * Both shapes are asserted, because the root form is still correct for a bundle-less payload.
 *
 * @vitest-environment node
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import { installPayload, payloadPaths, readCurrent } from "../src/daemon/payload.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(): Promise<{ paths: ReturnType<typeof coderPaths>; source: string }> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-payload-bundle-"));
  cleanups.push(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const paths = coderPaths(home);
  await mkdir(paths.stateDir, { recursive: true });

  const source = join(home, "bundle");
  await mkdir(join(source, "app", "node_modules", "dep"), { recursive: true });
  await writeFile(join(source, "node"), "#!/bin/sh\necho node\n", "utf8");
  await writeFile(join(source, "app", "main.mjs"), "// the daemon\n", "utf8");
  await writeFile(join(source, "app", "node_modules", "dep", "index.js"), "export {}\n", "utf8");
  return { paths, source };
}

describe("the installed payload's shape", () => {
  it("copies the bundle whole and keeps the entry inside it", async () => {
    const { paths, source } = await fixture();
    const installed = await installPayload(paths, {
      version: "1.0.0",
      node: join(source, "node"),
      entry: join(source, "app", "main.mjs"),
      bundle: join(source, "app"),
    });

    // The entry is beside its dependencies, which is where its imports resolve.
    expect(payloadPaths(installed.dir).entry).toBe(join(installed.dir, "app", "main.mjs"));
    expect(existsSync(join(installed.dir, "app", "node_modules", "dep", "index.js"))).toBe(true);
    expect(await readCurrent(paths)).toBe("1.0.0");
  });

  it("still points at a root entry when there is no bundle", async () => {
    // A self-contained payload (if the build ever produces one) is `main.mjs` + `node`, and that shape must keep
    // working: the fix for the bundle case must not break the one that has no bundle.
    const { paths, source } = await fixture();
    const installed = await installPayload(paths, {
      version: "2.0.0",
      node: join(source, "node"),
      entry: join(source, "app", "main.mjs"),
    });

    expect(payloadPaths(installed.dir).entry).toBe(join(installed.dir, "main.mjs"));
    expect(existsSync(join(installed.dir, "main.mjs"))).toBe(true);
  });
});
