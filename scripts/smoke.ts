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
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRunningNode } from "@envoymesh/node-core";
import { HARNESS_IDS } from "@envoydev/protocol";
import { probeHarness } from "@envoydev/agent-catalog";
import { currentSearchPath } from "@envoydev/platform";
import {
  attachToMeshNode,
  checkPairingCode,
  coderPaths,
  coderSessionIdentity,
  createCoderDaemonHost,
  createCoderDispatcher,
} from "@envoydev/host-bridge";

// The window's own halves, not a hand-written client: the flow this exercises is the window's, and a
// smoke test that re-implemented it would pass while the window stayed broken.
import { startCoderDaemon } from "../apps/desktop/src/daemon/serve.js";
import { createCoderStore } from "../apps/desktop/src/state/coderStore.js";

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
  params: Record<string, unknown> = {},
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
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })),
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

/**
 * One call, keeping **every** frame the socket receives — including the ones nobody asked for.
 *
 * The RPC helper above resolves on the matching reply and ignores pushes, which is the right shape for
 * "what did the daemon answer". The question here is the opposite one: *what did it send that nobody
 * asked for*, which is exactly what a leaked event looks like.
 */
async function watchFrom(
  host: string,
  port: number,
  path: string,
  method: string,
  params: Record<string, unknown>,
): Promise<{ reply?: { id?: unknown; result?: unknown; error?: { code?: string; message?: string } }; frames: string[] }> {
  const { WebSocket } = (await import("ws")) as unknown as {
    WebSocket: new (url: string) => {
      on(event: string, listener: (...args: unknown[]) => void): void;
      send(data: string): void;
      close(): void;
    };
  };
  const socket = new WebSocket(`ws://${host}:${port}${path}`);
  const frames: string[] = [];
  let reply: { id?: unknown; result?: unknown; error?: { code?: string; message?: string } } | undefined;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve({ ...(reply ? { reply } : {}), frames });
    }, 900);
    socket.on("open", () => socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })));
    socket.on("message", (raw: unknown) => {
      const text = String(raw);
      frames.push(text);
      try {
        const parsed = JSON.parse(text) as { id?: unknown };
        if (parsed.id === 1) reply = parsed;
      } catch {
        /* a non-JSON frame is a frame all the same */
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

/** The repository root, so a step can name a build artifact without a relative-path guess. */
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const steps: { name: string; run: () => Promise<string> | string }[] = [];
const failures: string[] = [];

function step(name: string, run: () => Promise<string> | string): void {
  steps.push({ name, run });
}

step("product state lives under the shared home", () => {
  const home = mkdtempSync(join(tmpdir(), "envoydev-smoke-"));
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
    const theirs = mine.replace("app=EnvoyDev", "app=EnvoyMesh");
    const refused = checkPairingCode(theirs);
    if (refused.ok) throw new Error("a code from another app was accepted");
    return refused.message;
  } finally {
    host.stop();
  }
});

/**
 * The push channel, which is a second way to leak the same data — and it used to be open.
 *
 * The family's transport gated RPCs by loopback-or-session and left the event path ungated: `on` was
 * handled before the gate, every connecting socket was auto-subscribed to the core event names, and
 * delivery wrote to whoever was subscribed. Measured on the real transport, a tokenless client on the
 * LAN received the node's handshake, its status and every broadcast — on a socket whose first RPC was
 * correctly refused. Fixed upstream (`@envoymesh/host-connect`); this leg keeps it fixed from the
 * consumer's side: an EnvoyDev window must still subscribe over loopback, and a stranger must get
 * nothing at all — not a refusal followed by a stream.
 */
step("refuses an event subscription from the LAN, and pushes it nothing", async () => {
  const address = firstLanAddress();
  if (!address) return "no non-loopback interface on this machine — the push-channel leg could not run";

  const host = createCoderDaemonHost({
    port: 0,
    sessionIdentity: coderSessionIdentity(),
    dispatch: createCoderDispatcher(),
  });
  await host.serve();
  try {
    const stranger = await watchFrom(address, host.port, host.path, "on", { event: "node:status" });
    if (stranger.reply?.error?.code !== "UNAUTHORIZED") {
      throw new Error(
        `a tokenless client at ${address} got ${JSON.stringify(stranger.reply)} for the "on" method — ` +
          "subscribing must answer to the same rule as a read",
      );
    }
    const leaked = stranger.frames.filter((frame) => frame.includes('"event"'));
    if (leaked.length > 0) {
      throw new Error(
        `a tokenless client at ${address} was pushed ${leaked.length} event(s) without asking: ${leaked[0]}`,
      );
    }

    // …and our own window, on loopback, still subscribes: the fix must not close the door it locks.
    const window = await watchFrom("127.0.0.1", host.port, host.path, "on", { event: "node:status" });
    if (window.reply?.error) {
      throw new Error(`a loopback subscription was refused: ${JSON.stringify(window.reply.error)}`);
    }
    return `LAN (${address}) → refused, ${stranger.frames.length} frame(s); loopback → subscribed`;
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
 * product session came back scoped to `product:EnvoyDev` (not the owner's), and a refusal would
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

/**
 * **The other half of the pairing claim, and the one the phone depends on.**
 *
 * The step above proves a tokenless caller from the LAN is refused. That is necessary and nowhere
 * near sufficient: the whole product is "start it at the desk, watch it from the phone", and until a
 * *minted* token is actually answered, the phone has no working dial path at all. This was the plan's
 * Phase A acceptance and it had no evidence — neither leg of it.
 *
 * Measured from the LAN rather than from loopback on purpose: loopback is trusted without a token, so
 * a loopback probe would pass whether or not the token was read, which is a test that agrees with the
 * bug. The socket dials the machine's own non-loopback address so the transport sees a peer that must
 * authenticate.
 *
 * Revocation is the last leg because it is the one a user acts on: "who can reach this machine" has
 * to have an answer that takes effect, not one that only removes a row from a list.
 */
step("a paired phone's token is answered from the LAN, and revoking it stops being answered", async () => {
  const address = firstLanAddress();
  if (!address) return "no non-loopback interface on this machine — the paired-device leg could not run";

  const home = mkdtempSync(join(tmpdir(), "envoydev-smoke-paired-"));
  const daemon = await startCoderDaemon({
    port: 0,
    home,
    paths: coderPaths(home),
    // No node on a test machine, and the attach is not what this step is about.
    skipMeshAttach: true,
  });

  const withToken = (token: string): string =>
    `${daemon.path}?token=${encodeURIComponent(token)}`;

  try {
    // Minted from loopback, which is where the owner's own machine mints — and where the desktop's
    // "Pair a phone" button will call from.
    const minted = await callFrom("127.0.0.1", daemon.port, daemon.path, "coder.mintPairing");
    if (minted.error) {
      throw new Error(`minting from loopback was refused: ${JSON.stringify(minted.error)}`);
    }
    const { uri, device } = minted.result as { uri?: string; device?: { id?: string } };
    if (typeof uri !== "string" || typeof device?.id !== "string") {
      throw new Error(`minting answered without a code and a device: ${JSON.stringify(minted.result)}`);
    }

    const code = checkPairingCode(uri);
    if (!code.ok) {
      throw new Error(`the daemon minted a code its own window would refuse: ${code.message}`);
    }

    // **Leg 1 — the phone's call is answered.** This is the assertion the whole mobile milestone
    // rests on.
    const answered = await callFrom(address, daemon.port, withToken(code.token), "coder.hello");
    if (answered.error) {
      throw new Error(
        `a paired device at ${address} was refused: ${JSON.stringify(answered.error)} — ` +
          "the phone has no working dial path until this is answered",
      );
    }

    // **Leg 2 — a token nobody minted is not answered.** Without this, "answered" could have been
    // "the token was never looked at".
    const stranger = await callFrom(address, daemon.port, withToken("not-a-token"), "coder.hello");
    if (!stranger.error) {
      throw new Error(
        `an invented token at ${address} was ANSWERED — the resolver is not reading the token at all`,
      );
    }

    // **Leg 3 — the paired device cannot mint another one.** The module that owns pairing said this
    // was loopback-only long before it was: the dispatcher never handed the caller to a handler, so
    // nothing could tell a phone from the owner's window, and a phone could mint itself a fresh token
    // that outlived the revocation of its own. This leg is the difference between a sentence and a
    // rule.
    const phoneMints = await callFrom(address, daemon.port, withToken(code.token), "coder.mintPairing");
    if (!phoneMints.error) {
      throw new Error(
        "a paired device minted another pairing code — a token is not allowed to outlive its own revocation",
      );
    }
    // Our own codes travel in the **message**, not in `error.code`: the transport sets `code` only for
    // its own closed catalogue and answers `ERROR` for everything else (`@envoydev/protocol`'s
    // `coderError` documents why). Asserting on `code` here would have been asserting the transport's
    // vocabulary for our refusal.
    if (!String(phoneMints.error.message).includes("envoydev.unauthorized")) {
      throw new Error(`expected our unauthorized code for a paired device minting, got ${JSON.stringify(phoneMints.error)}`);
    }

    // **Leg 4 — revoking the device stops the token working**, with the same token that just worked.
    const revoked = await callFrom("127.0.0.1", daemon.port, daemon.path, "coder.revokePairedDevice", {
      id: device.id,
    });
    if (revoked.error) {
      throw new Error(`revoking from loopback was refused: ${JSON.stringify(revoked.error)}`);
    }
    const afterRevoke = await callFrom(address, daemon.port, withToken(code.token), "coder.hello");
    if (!afterRevoke.error) {
      throw new Error("a revoked device's token was still answered — revocation does not reach the dial path");
    }

    return (
      `${address} → paired token answered; invented token ${stranger.error.code}; ` +
      `paired device minting refused; after revoke ${afterRevoke.error.code}`
    );
  } finally {
    await daemon.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

/**
 * The daemon as the desktop app actually starts it: the bundle, as a child process.
 *
 * The unit suite boots the daemon in-process, which proves the handlers and the store. This proves
 * what that cannot: that `npm run daemon:build` produces something Node can run, that the claim file
 * appears only after the socket is listening, that a `coder.hello` over the wire carries the same
 * instance id, and that stopping the process takes the claim with it. Each of those has been wrong
 * at least once in this family's history, and each is invisible to a test that shares a process.
 */
step("the bundled daemon starts as a child process and answers over its own socket", async () => {
  const { spawn } = await import("node:child_process");
  const { readFile, rm } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");

  const home = mkdtempSync(join(tmpdir(), "envoydev-smoke-daemon-"));
  const entry = join(root, "apps", "desktop", "dist-daemon", "main.mjs");
  if (!existsSync(entry)) {
    throw new Error("apps/desktop/dist-daemon/main.mjs is missing — run `npm run daemon:build`");
  }

  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ENVOYMESH_HOME: home, ENVOYDEV_DAEMON_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));

  try {
    // The claim is written after the bind, so waiting for it is waiting for a *reachable* daemon
    // rather than for a process that exists.
    const claimPath = join(home, "EnvoyDev", "daemon.json");
    const deadline = Date.now() + 20_000;
    let claim: { port: number; path: string; instanceId: string; pid: number } | undefined;
    while (Date.now() < deadline && !claim) {
      if (existsSync(claimPath)) {
        try {
          claim = JSON.parse(await readFile(claimPath, "utf8")) as typeof claim;
        } catch {
          // Half-written: the write is a rename, so this should not happen, but a smoke test that
          // crashed on a transient read would be worse than one that retries.
        }
      }
      if (!claim) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!claim) throw new Error(`no claim file after 20s. Output:\n${output}`);

    const hello = (await callFrom("127.0.0.1", claim.port, claim.path, "coder.hello")).result as {
      product?: string;
      instanceId?: string;
      stateDir?: string;
    };
    if (hello?.product !== "EnvoyDev") throw new Error(`hello said product=${String(hello?.product)}`);
    if (hello?.instanceId !== claim.instanceId) {
      throw new Error("the daemon answered with a different instance id than its claim carries");
    }
    if (hello?.stateDir !== join(home, "EnvoyDev")) {
      throw new Error(`hello said stateDir=${String(hello?.stateDir)}`);
    }

    // Stop it the way the shell does, and require the claim to go with it: a stale claim makes the
    // next window attach to a port nobody is listening on.
    child.kill("SIGTERM");
    const stopDeadline = Date.now() + 10_000;
    while (Date.now() < stopDeadline && existsSync(claimPath)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (existsSync(claimPath)) throw new Error("the claim file outlived the daemon");

    return `pid ${claim.pid} on port ${claim.port}, hello verified, claim removed on stop`;
  } finally {
    child.kill("SIGKILL");
    await rm(home, { recursive: true, force: true });
  }
});

step("a second daemon refuses to start while one owns the machine", async () => {
  const { spawn } = await import("node:child_process");
  const { rm } = await import("node:fs/promises");

  const home = mkdtempSync(join(tmpdir(), "envoydev-smoke-second-"));
  const entry = join(root, "apps", "desktop", "dist-daemon", "main.mjs");

  const first = spawn(process.execPath, [entry], {
    env: { ...process.env, ENVOYMESH_HOME: home, ENVOYDEV_DAEMON_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const claimPath = join(home, "EnvoyDev", "daemon.json");
    const deadline = Date.now() + 20_000;
    const { existsSync } = await import("node:fs");
    while (Date.now() < deadline && !existsSync(claimPath)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!existsSync(claimPath)) throw new Error("the first daemon never published a claim");

    const second = spawn(process.execPath, [entry], {
      env: { ...process.env, ENVOYMESH_HOME: home, ENVOYDEV_DAEMON_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    second.stdout?.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
    const code = await new Promise<number | null>((resolve) => second.on("exit", (value) => resolve(value)));

    // Exit 0, not 1: nothing failed. One daemon serves a machine, and the process that asked for a
    // second one asked for something that already exists.
    if (code !== 0) throw new Error(`the second daemon exited ${String(code)} instead of 0`);
    if (!text.includes("already running")) {
      throw new Error(`the second daemon did not say why it stopped:\n${text}`);
    }
    return `second daemon exited 0 and named the first`;
  } finally {
    first.kill("SIGTERM");
    await rm(home, { recursive: true, force: true });
  }
});

step("every agent in the catalogue can be probed, and missing ones say how to install", () => {
  // **The report this step was rewritten for.** "I have installed codex and claudecode, deepseek-harness,
  // why all of them shown 'Not Installed'." The old line printed `✓`/`·` from one boolean and could not
  // tell a missing *agent* from a missing *bridge* — so the smoke said the same thing the window said, and
  // both were wrong. It now prints the state, the program it resolved, and the install steps, which makes
  // this output the first thing to read when a row says "not installed" and the user disagrees.
  const lines: string[] = [];
  for (const id of HARNESS_IDS) {
    const probe = probeHarness(id, { pathDirs: currentSearchPath().dirs });
    const installable = probe.state === "needs-bridge" || probe.state === "not-installed";
    // The two rules the states exist for, checked here against the real catalogue on the real machine:
    // a state that asserts something is missing must say what to run, and that is the *only* kind of state
    // allowed to.
    if (installable && (probe.fix === undefined || probe.fix.length === 0)) {
      throw new Error(
        `${id} reports "${probe.state}" but names no install command — the row would say what is absent ` +
          `and not what to do about it`,
      );
    }
    if (!installable && probe.fix !== undefined) {
      throw new Error(
        `${id} reports "${probe.state}" and yet offers an install command — a state that asserts nothing ` +
          `is missing must not tell the user to install something`,
      );
    }
    if (probe.state !== "ready" && !probe.reason) {
      throw new Error(`${id} is not ready but gives no reason — the UI would show a blank row`);
    }
    const where = probe.binaryPath ?? probe.agentBinaryPath;
    lines.push(
      `${probe.state === "ready" ? "✓" : "·"} ${id.padEnd(16)} ${probe.state.padEnd(14)}` +
        `${where ? ` ${where}` : ""}`,
    );
    if (probe.fix) for (const step of probe.fix) lines.push(`    → ${step.command}`);
    if (probe.provisional) lines.push(`    ! from the ${probe.provisional} cache`);
  }
  return `\n      ${lines.join("\n      ")}`;
});

/**
 * The flow a user reported as broken: *"I added a project and it never appeared in the sidebar."*
 *
 * It was broken in the way a smoke test exists to catch. The daemon stored the project correctly; the
 * window asked for its lists with one `Promise.all`, and a daemon that was an *older build* — a shell
 * attaches to a running daemon rather than replacing it (family rule D2), so an upgrade can leave the
 * old one holding the port — answered `coder.listProjects` and refused `coder.listTasks`. One failure
 * discarded both lists, and the rail rendered "No projects yet" for a project that was on disk.
 *
 * Nothing in the suite could see it: the store's own tests used one fake connection that answered
 * everything, and no check ever added a project through the window's own code against a real daemon.
 * So this step does exactly that, and asserts the two things the user experienced — the store ends up
 * **loaded** (every list the window needs answered, which a stale daemon fails) and the project is in
 * the state the rail draws from, with a second window seeing it too.
 */
step("a project added through the window's store reaches the rail, and a second window sees it", async () => {
  const home = await mkdtemp(join(tmpdir(), "envoydev-smoke-rail-"));
  const projectDir = await mkdtemp(join(tmpdir(), "envoydev-smoke-project-"));
  const daemon = await startCoderDaemon({ port: 0, home, paths: coderPaths(home), skipMeshAttach: true });
  const window = (): ReturnType<typeof createCoderStore> =>
    createCoderStore({
      resolveEndpoint: async () => ({
        endpoint: { host: "127.0.0.1", port: daemon.port, path: daemon.path },
        // What the browser dev server reports: no shell, so no claim file was read.
        verifiedBy: "none",
      }),
    });
  const settle = async (store: ReturnType<typeof createCoderStore>, test: () => boolean) => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (test()) return true;
      await new Promise((done) => setTimeout(done, 20));
    }
    return false;
  };

  const first = window();
  try {
    first.start();
    if (!(await settle(first, () => first.getSnapshot().connection.state === "connected"))) {
      throw new Error("the window never connected to the daemon");
    }
    // `loaded` is the assertion that matters for version skew: it is only set once projects, tasks,
    // settings, harnesses and the mesh status have all answered. A daemon missing any one of them —
    // the stale-build case — leaves the window unloaded and the rail honest about it.
    if (!(await settle(first, () => first.getSnapshot().loaded))) {
      throw new Error(
        "the window never finished loading its lists, so a daemon method it needs is missing",
      );
    }

    const added = await first.addProject(projectDir);
    if (!added.ok) throw new Error(`addProject was refused: ${added.message}`);
    // The store does not insert the project locally — the daemon's change event is what makes the rail
    // redraw, deliberately, so that two windows cannot disagree about what exists. Waiting for that
    // redraw is therefore part of the assertion, not politeness: this is the half that was broken when
    // the two lists shared one `Promise.all`, because a failed refetch left the state as it was and the
    // add looked like it had done nothing.
    if (!(await settle(first, () => first.getSnapshot().projects.length === 1))) {
      throw new Error(
        "the project was stored by the daemon but the rail never redrew — the change event did not reach the window, or the refetch discarded it",
      );
    }
    const labels = first.getSnapshot().projects.map((project) => project.label);
    if (labels[0] !== added.project.label) {
      throw new Error(`the rail shows “${labels[0]}” where the daemon stored “${added.project.label}”`);
    }

    // **"+ New" is the second half of the same flow**, and the half a user meets first: a task is
    // created with no title and no run, which is what makes the chat UI the form (Paseo's new
    // workspace behaves the same way). The daemon has to accept an empty title for that, the rail has
    // to show it, and nothing may start running until the user says something.
    const unnamed = await first.createTask({ projectId: added.project.id, title: "" });
    if (!unnamed.ok) throw new Error(`creating an untitled task was refused: ${unnamed.message}`);
    if (unnamed.task.title !== "") {
      throw new Error(`the daemon renamed an untitled task to “${unnamed.task.title}”`);
    }
    if (unnamed.task.runId !== undefined) {
      throw new Error("creating a task started a run before the user said anything");
    }
    if (
      !(await settle(first, () =>
        first.getSnapshot().tasks.some((task) => task.id === unnamed.task.id),
      ))
    ) {
      throw new Error("the untitled task was stored but never reached the rail");
    }

    // The first message is what starts the work — and what names the task, which is the rule
    // `taskTitleFromPrompt` encodes and `task-model`'s tests pin.
    const started = await first.startRun(unnamed.task.id, "Add a health check endpoint");
    if (!started.ok) {
      // A daemon with no agent runtime installed is a legitimate environment for the smoke, so this is
      // reported rather than failed: the create-and-open contract above is what is being tested here.
      return `added “${labels[0]}”, created an untitled task, and the daemon refused to run one (${started.message.slice(0, 60)})`;
    }

    // A second window is the multi-window rule, and the reason the daemon broadcasts a change rather
    // than letting each window guess: a project added at the desk must appear on the phone.
    const second = window();
    try {
      second.start();
      if (!(await settle(second, () => second.getSnapshot().projects.length === 1))) {
        throw new Error("a second window did not see the project the first one added");
      }
    } finally {
      second.dispose();
    }

    return (
      `added “${labels[0]}” at ${projectDir}\n` +
      `      rail state: loaded=${first.getSnapshot().loaded}, projects=${labels.length}, ` +
      `untitled task ${unnamed.task.id.split("::").slice(-2).join("::")} opened with no run`
    );
  } finally {
    first.dispose();
    await daemon.stop();
    await rm(home, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
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
