/**
 * **Which `coder.*` methods enforce a rule on their own, and which rely entirely on the transport.**
 *
 * ## Why this file exists (mesh security audit, question 1)
 *
 * The daemon serves one handler table over two transports — a loopback-anchored WebSocket and the
 * family's mesh, where "loopback" does not exist. The pairing methods' owner-window rule is written
 * as `context.session === undefined` ⇒ "the owner's own window"
 * (`apps/desktop/src/daemon/pairing.ts:98-106`), which is only sound if `undefined` can only ever
 * mean loopback. The mesh transport satisfies that by construction; this file measures the *other*
 * half of the claim, which nothing tested before: **every other method answers when the dispatcher
 * is handed no session at all.**
 *
 * That is the reason the mesh gate is load-bearing rather than defence-in-depth. It is not a defect
 * in itself — the WebSocket transport refuses a tokenless non-loopback caller before dispatch — but
 * it is the fact an auditor needs in order to say what the mesh transport is protecting, and it is
 * the fact that would turn any future hole in that gate into "any method, executed as the owner".
 *
 * The table this prints is the answer to *"enumerate every method reachable through the dispatcher
 * and say whether it requires a valid session"*.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ENVOYDEV_ERRORS, RPC_METHODS, coderErrorCode, type RpcMethod } from "@envoydev/protocol";
import { coderPaths, createCoderDispatcher, type CoderPaths } from "@envoydev/host-bridge";
import type { CoderDaemonHost } from "@envoydev/host-bridge";

import { createCoderHandlers, type CoderHandler } from "../src/daemon/service.js";
import { createPairingHandlers } from "../src/daemon/pairing.js";
import { PairedDeviceStore, pairedDevicesFile } from "../src/daemon/paired-devices.js";
import { CoderStore } from "../src/daemon/store.js";

let home: string;
let paths: CoderPaths;
let dispatch: ReturnType<typeof createCoderDispatcher>;

/** The session a paired phone carries — `PairedSession`, with `isOwnerScope: true` by design. */
const PHONE_SESSION = {
  scopeKey: "product:EnvoyDev",
  ownerId: "envoy:owner:audit",
  isOwnerScope: true,
  deviceId: "audit-device",
  caller: { kind: "owner-device", deviceId: "audit-device", label: "Audit phone" },
};

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "envoydev-mesh-surface-"));
  paths = coderPaths(home);
  const store = await CoderStore.open({ paths });
  const devices = new PairedDeviceStore(pairedDevicesFile(paths), {
    ownerId: async () => "envoy:owner:audit",
  });

  // The pairing handlers' only use of the host is `pairingUri` at mint time, which the owner-window
  // case never reaches. A stub keeps this a table test rather than a second boot of the daemon.
  const host = {
    pairingUri: () => "envoy://pair?audit=1",
    port: 0,
    path: "/ws",
  } as unknown as CoderDaemonHost;

  const handlers = {
    ...createCoderHandlers({
      store,
      paths,
      instance: {
        instanceId: "mesh-surface-audit",
        version: "0.1.0",
        startedAt: "2026-09-14T00:00:00.000Z",
        connectionCount: () => 1,
      },
      mesh: () => ({ kind: "no-node", reason: "not started in this test" }),
      // Nothing on this machine is a directory: a handler that gets this far is doing real work.
      isDirectory: async () => false,
    }),
    ...createPairingHandlers({ store: devices, paths, getHost: () => host }),
  } as Partial<Record<RpcMethod, CoderHandler>>;

  dispatch = createCoderDispatcher({ handlers });
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

type Outcome =
  | { kind: "answered" }
  | { kind: "refused"; code: string | null; message: string }
  | { kind: "not-implemented" };

/**
 * Call one method with exactly the session under test and classify the result.
 *
 * The distinction that matters is **not** "did it throw" — most methods throw on empty params — but
 * "did a session/owner rule throw". `envoydev.unauthorized` is the code `requireOwnerWindow` uses;
 * every other outcome means control reached the handler body.
 */
async function outcomeOf(method: string, session: unknown): Promise<Outcome> {
  try {
    await dispatch(method, {}, session as never);
    return { kind: "answered" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/is not implemented in this build|Method not found/.test(message)) {
      return { kind: "not-implemented" };
    }
    return { kind: "refused", code: coderErrorCode(message), message };
  }
}

const isSessionRefusal = (outcome: Outcome): boolean =>
  outcome.kind === "refused" && outcome.code === ENVOYDEV_ERRORS.unauthorized;

interface Row {
  method: string;
  withoutSession: Outcome;
  withSession: Outcome;
}

let rows: Row[] = [];

async function buildTable(): Promise<Row[]> {
  const built: Row[] = [];
  for (const method of RPC_METHODS) {
    built.push({
      method,
      withoutSession: await outcomeOf(method, undefined),
      withSession: await outcomeOf(method, PHONE_SESSION),
    });
  }
  return built;
}

function printTable(table: Row[]): void {
  const label = (outcome: Outcome): string => {
    if (outcome.kind === "answered") return "answered";
    if (outcome.kind === "not-implemented") return "not-implemented";
    return isSessionRefusal(outcome) ? "REFUSED (session rule)" : `reached body (${outcome.code ?? "?"})`;
  };
  const lines = [
    "",
    "coder.* method                                | no session (WS loopback)      | paired session",
    "----------------------------------------------+-------------------------------+--------------------------",
    ...table.map(
      (row) =>
        `${row.method.padEnd(45)} | ${label(row.withoutSession).padEnd(29)} | ${label(row.withSession)}`,
    ),
  ];
  console.log(lines.join("\n"));
}

describe("the coder.* handler table, measured with and without a session", () => {
  it("prints the reachability table and asserts the owner-window rule is the only session rule", async () => {
    rows = await buildTable();
    printTable(rows);

    // 1. The methods that refuse a *paired phone*: the owner-window rule, and nothing else. A paired
    //    phone is the owner's own device (`PairedSession`), so the refusal is about *where* the call
    //    is made, not who makes it — and it is the only place a session is consulted at all.
    //
    //    Written as a property rather than a frozen list: adding a method that mints or names a
    //    credential (there is a `coder.forgetPairedDevice` in flight as this is written) must not fail
    //    an audit test, while adding a session rule to an unrelated method must.
    const refusedWithSession = rows.filter((row) => isSessionRefusal(row.withSession)).map((row) => row.method);
    expect(refusedWithSession).toEqual(
      expect.arrayContaining(["coder.mintPairing", "coder.listPairedDevices", "coder.revokePairedDevice"]),
    );
    expect(refusedWithSession.filter((method) => !/Pairing|PairedDevice/.test(method))).toEqual([]);

    // 2. The property the mesh gate is the only guard for: with no session, **no method refuses**.
    //    Every `coder.*` call that reaches the dispatcher without one runs as the owner's window.
    const refusedWithoutSession = rows.filter((row) => isSessionRefusal(row.withoutSession)).map((row) => row.method);
    expect(refusedWithoutSession).toEqual([]);

    // 3. And the surface is not accidentally empty: the table really has handlers behind it. The
    //    count is of methods the dispatcher did not answer with "not implemented".
    const implemented = rows.filter((row) => row.withSession.kind !== "not-implemented");
    expect(implemented.length).toBeGreaterThanOrEqual(30);

    // 4. Every catalogue method is classified by the *dispatcher*, so an unknown name cannot be a
    //    quieter way in: `isRpcMethod` refuses it before any handler is looked up.
    await expect(dispatch("coder.notARealMethod", {}, undefined as never)).rejects.toThrow(/Method not found/);
    await expect(dispatch("__proto__", {}, undefined as never)).rejects.toThrow(/Method not found/);
    await expect(dispatch("constructor", {}, undefined as never)).rejects.toThrow(/Method not found/);
  });
});
