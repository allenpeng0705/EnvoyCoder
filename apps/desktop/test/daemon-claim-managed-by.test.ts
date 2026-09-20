/**
 * The claim's `managedBy`: the one fact that tells a launcher whose daemon it is looking at.
 *
 * This exists because service mode's whole promise — the host keeps answering when no window is open — is broken
 * by a shell that quits and stops the pid it found. The Rust half of the rule (which pids to signal) is tested in
 * `src-tauri/src/main.rs`; this half is what the daemon *writes*, including the tolerant reading that keeps a
 * claim written by an older daemon (or a newer one) from being misread as ours.
 *
 * @vitest-environment node
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import {
  daemonDescriptorPath,
  readDaemonClaim,
  writeDaemonClaim,
  type DaemonDescriptor,
} from "../src/daemon/lock.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function home(): Promise<ReturnType<typeof coderPaths>> {
  const dir = await mkdtemp(join(tmpdir(), "envoydev-managed-by-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const paths = coderPaths(dir);
  // The daemon creates its state directory at boot; the claim writer assumes it is there.
  await mkdir(paths.stateDir, { recursive: true });
  return paths;
}

/** A descriptor the validator accepts, before the field under test. */
async function descriptor(paths: ReturnType<typeof coderPaths>): Promise<DaemonDescriptor> {
  return {
    product: "EnvoyDev",
    instanceId: "i-managed-by",
    pid: process.pid,
    host: "127.0.0.1",
    port: 4770,
    path: "/ws",
    home: paths.stateDir,
    stateDir: paths.stateDir,
    startedAt: new Date().toISOString(),
    version: "0.1.0",
  };
}

describe("the claim's managedBy", () => {
  it("records a service-managed daemon as the supervisor's, and an app-managed one as ours", async () => {
    const paths = await home();
    const base = await descriptor(paths);

    await writeDaemonClaim(paths, { ...base, managedBy: "service" });
    const supervised = await readDaemonClaim(paths);
    expect(supervised.state).toBe("running");
    if (supervised.state !== "running") throw new Error("unreachable");
    expect(supervised.descriptor.managedBy).toBe("service");
    // The field really reached the file: a shell in Rust reads this JSON, not our types.
    expect(await readFile(daemonDescriptorPath(paths), "utf8")).toContain('"managedBy": "service"');

    await writeDaemonClaim(paths, { ...base, managedBy: "app" });
    const ours = await readDaemonClaim(paths);
    if (ours.state !== "running") throw new Error("unreachable");
    expect(ours.descriptor.managedBy).toBe("app");
  });

  it("reads a claim written before the field existed as the app's", async () => {
    /**
     * **Tolerance is the safe direction here.** Every daemon written before `managedBy` existed was started by
     * the shell and stopped by it, so reading an absent field as `app` reproduces exactly the behaviour that
     * shipped; reading it as `service` would strand a daemon nobody ever stops.
     */
    const paths = await home();
    const { managedBy: _dropped, ...older } = await descriptor(paths);
    await writeFile(daemonDescriptorPath(paths), `${JSON.stringify(older, null, 2)}\n`, "utf8");

    const claim = await readDaemonClaim(paths);
    if (claim.state !== "running") throw new Error("unreachable");
    expect(claim.descriptor.managedBy).toBe("app");
  });

  it("reads a value from a version it does not know as the app's", async () => {
    // A future daemon announcing something else must not make this shell treat a live host as untouchable…
    // or, worse, as somebody else's to kill. The known-safe reading is the one that shipped.
    const paths = await home();
    const base = await descriptor(paths);
    await writeFile(
      daemonDescriptorPath(paths),
      `${JSON.stringify({ ...base, managedBy: "cluster" }, null, 2)}\n`,
      "utf8",
    );

    const claim = await readDaemonClaim(paths);
    if (claim.state !== "running") throw new Error("unreachable");
    expect(claim.descriptor.managedBy).toBe("app");
  });
});
