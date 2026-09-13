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
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRunningNode } from "@envoymesh/node-core";
import { HARNESS_IDS } from "@envoycoder/protocol";
import { probeHarness } from "@envoycoder/agent-catalog";
import {
  attachToMeshNode,
  checkPairingCode,
  coderPaths,
  coderSessionIdentity,
  createCoderDaemonHost,
} from "@envoycoder/host-bridge";

/**
 * One real JSON-RPC call over a real socket, returning either the result or the error.
 *
 * Deliberately not a `ws` client wrapper with retries: the smoke test's job is to observe what the
 * transport actually answers a caller in a given position on the network.
 */
async function callFrom(
  host: string,
  port: number,
  path: string,
  method: string,
): Promise<{ result?: unknown; error?: { code?: string; message?: string } }> {
  const { WebSocket } = (await import("ws")) as unknown as {
    WebSocket: new (url: string) => {
      on(event: string, listener: (...args: unknown[]) => void): void;
      send(data: string): void;
      close(): void;
    };
  };
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${host}:${port}${path}`);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new Error(`no answer from ${host}:${port} within 5s`));
    }, 5_000);
    const finish = (value: { result?: unknown; error?: { code?: string; message?: string } }) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    socket.on("open", () =>
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} })),
    );
    socket.on("message", (raw: unknown) => {
      try {
        const parsed = JSON.parse(String(raw)) as {
          id?: unknown;
          result?: unknown;
          error?: { code?: string; message?: string };
        };
        if (parsed.id !== 1) return;
        finish(parsed);
      } catch {
        /* a non-JSON frame is not an answer to this call */
      }
    });
    socket.on("error", (error: unknown) => {
      clearTimeout(timer);
      reject(new Error(`socket error: ${String(error)}`));
    });
  });
}

/** The first non-internal IPv4 address, so the LAN leg dials this machine the way a peer would. */
function firstLanAddress(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
}

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
    sessionIdentity: coderSessionIdentity(),
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

/**
 * The leg the guide's definition of done is most specific about (§8): *"run the real thing — your
 * app attaching to a real node, over loopback"*.
 *
 * It runs whenever an EnvoyMesh node is up, and reports honestly when none is. That is the correct
 * shape for a test that depends on another application being installed and running: skipping
 * silently would claim coverage it does not have, and failing would punish a machine that simply is
 * not running the social app.
 *
 * What it proves when it does run: discovery found a node whose identity was **verified**, the
 * product session came back scoped to `product:EnvoyCoder` (not the owner's), and a refusal would
 * have been reported rather than swallowed.
 */
step("attaches to a running EnvoyMesh node, as a product, over loopback", async () => {
  const home = coderPaths().home;
  const node = await resolveRunningNode(home);
  if (node.status !== "running") {
    return `no EnvoyMesh node is running at ${home} (status: ${node.status}) — the attach leg ran only as far as discovery, honestly`;
  }
  const outcome = await attachToMeshNode(home);
  if (outcome.kind === "attached") {
    if (!outcome.scopeKey.startsWith("product:")) {
      throw new Error(`the node issued "${outcome.scopeKey}", which is not a product scope`);
    }
    return `${outcome.scopeKey} at ${outcome.wsUrl.replace(/token=[^&]*/, "token=…")}`;
  }
  if (outcome.kind === "refused") {
    // A refusal is a legitimate answer (the owner may not have granted this product anything), and
    // what matters is that it is *reported*, not hidden.
    return `the node refused the session, as it may: ${outcome.reason}`;
  }
  throw new Error(`discovery said the node was running, but the attach reported "${outcome.kind}"`);
});

step("the daemon host binds, serves and stops", async () => {
  const host = createCoderDaemonHost({
    port: 0,
    sessionIdentity: coderSessionIdentity(),
    dispatch: async () => undefined,
  });
  await host.serve();
  const port = host.port;
  if (!Number.isInteger(port) || port <= 0) throw new Error(`bound port is ${port}`);
  host.stop();
  return `ws://127.0.0.1:${port}${host.path}`;
});

/**
 * The other half of §8's security line: *"from the LAN (which must be refused a tokenless call)"*.
 *
 * The daemon binds every interface — that is the family's transport, not a choice made here — so the
 * thing that keeps a machine safe is the **access gate**: a caller that is not loopback and presents
 * no session is refused. That claim is worth testing rather than asserting, because "it binds
 * 0.0.0.0" reads like exposure and only a refusal proves otherwise.
 */
step("refuses a tokenless call from the LAN, while loopback is trusted", async () => {
  const address = firstLanAddress();
  if (!address) return "no non-loopback interface on this machine — the LAN leg could not run";

  const answered: string[] = [];
  const host = createCoderDaemonHost({
    port: 0,
    sessionIdentity: coderSessionIdentity(),
    // Positional, like every host in the family: (method, params, session). The annotation is not
    // decoration: `tsconfig.unchecked.json` now typechecks this file, so a signature change is a
    // compile error here instead of a silent no-op discovered by a socket that answers nothing.
    dispatch: async (method: string, _params: Record<string, unknown>) => {
      answered.push(method);
      return { ok: true };
    },
  });
  await host.serve();
  try {
    // The socket opening from the LAN is **by design** — it is the family's transport, and the gate
    // is per method (guide §8's claim is about the *call*, not the connection). Asserting "the
    // socket closed" would have been a test that passes for the wrong reason; asserting the answer
    // is the claim.
    const lanReply = await callFrom(address, host.port, host.path, "coder.listProjects");
    if (!lanReply.error) {
      throw new Error(
        `a tokenless call from ${address} was ANSWERED (${JSON.stringify(lanReply.result)}) — ` +
          "the daemon must refuse callers that are neither loopback nor authenticated",
      );
    }
    if (lanReply.error.code !== "UNAUTHORIZED") {
      throw new Error(`expected UNAUTHORIZED from the LAN, got ${JSON.stringify(lanReply.error)}`);
    }

    // …and the same call from this machine is trusted, which is the other half of the rule:
    // loopback-OR-session, so the desktop's own windows do not need to authenticate to themselves.
    const loopbackReply = await callFrom("127.0.0.1", host.port, host.path, "coder.listProjects");
    if (loopbackReply.error) {
      throw new Error(`a loopback call was refused: ${JSON.stringify(loopbackReply.error)}`);
    }
    if (!answered.includes("coder.listProjects")) {
      throw new Error("the dispatcher was never reached, so the loopback leg proved nothing");
    }
    return `LAN (${address}) → ${lanReply.error.code}; loopback → answered`;
  } finally {
    host.stop();
  }
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
