/**
 * Does the real thing work? Boots the parts a user's first five minutes depend on.
 *
 * Deliberately not a unit test. The family's rule is that a green suite does not prove the product
 * runs — a stale sibling copy once kept a whole suite green while the node could not start — so
 * this script exercises the paths that only fail in reality:
 *
 *   1. the product state directory resolves inside the shared home;
 *   2. a pairing code this app mints is accepted by this app, and one from EnvoyMesh is refused;
 *   3. the daemon host binds a port, serves, and stops;
 *   4. every harness in the catalogue is probed, and the ones that are missing say how to install.
 *
 * Usage: `npm run smoke` (exit 1 on the first broken step).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESS_IDS } from "@envoycoder/protocol";
import { probeHarness } from "@envoycoder/agent-catalog";
import { checkPairingCode, coderPaths, createCoderDaemonHost } from "@envoycoder/host-bridge";

const steps: { name: string; run: () => Promise<string> | string }[] = [];
const failures: string[] = [];

function step(name: string, run: () => Promise<string> | string): void {
  steps.push({ name, run });
}

step("product state lives under the shared home", () => {
  const home = mkdtempSync(join(tmpdir(), "envoycoder-smoke-"));
  try {
    const paths = coderPaths(home);
    if (!paths.stateDir.startsWith(home)) throw new Error(`${paths.stateDir} escaped ${home}`);
    return paths.stateDir;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

step("a pairing code carries this app's name, and another app's is refused", () => {
  const host = createCoderDaemonHost({
    port: 0,
    sessionIdentity: () => undefined,
    dispatch: async () => undefined,
  });
  try {
    const mine = host.pairingUri({
      token: "t",
      ownerPublicKey: "KEY",
      ownerId: "envoy:owner:abc",
      host: "127.0.0.1",
    });
    const accepted = checkPairingCode(mine);
    if (!accepted.ok) throw new Error(`our own code was refused: ${accepted.message}`);
    const theirs = mine.replace("app=EnvoyCoder", "app=EnvoyMesh");
    const refused = checkPairingCode(theirs);
    if (refused.ok) throw new Error("a code from another app was accepted");
    return refused.message;
  } finally {
    host.stop();
  }
});

step("the daemon host binds, serves and stops", async () => {
  const host = createCoderDaemonHost({
    port: 0,
    sessionIdentity: () => undefined,
    dispatch: async () => undefined,
  });
  await host.serve();
  const port = host.port;
  if (!Number.isInteger(port) || port <= 0) throw new Error(`bound port is ${port}`);
  host.stop();
  return `ws://127.0.0.1:${port}${host.path}`;
});

step("every agent in the catalogue can be probed, and missing ones say how to install", () => {
  const lines: string[] = [];
  for (const id of HARNESS_IDS) {
    const probe = probeHarness(id);
    if (!probe.available && !probe.reason) {
      throw new Error(`${id} is unavailable but gives no reason — the UI would show a blank row`);
    }
    lines.push(`${probe.available ? "✓" : "·"} ${id}${probe.binaryPath ? ` (${probe.binaryPath})` : ""}`);
  }
  return `\n      ${lines.join("\n      ")}`;
});

for (const { name, run } of steps) {
  try {
    const detail = await run();
    console.log(`✓ ${name}${detail ? `\n      ${detail}` : ""}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke step(s) failed.`);
  process.exit(1);
}
console.log(`\n${steps.length} smoke steps passed.`);
