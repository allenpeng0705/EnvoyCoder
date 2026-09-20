/**
 * The service acceptance proof: a real supervisor, a real daemon, nothing simulated.
 *
 * `npm run service:proof` — **not** part of `npm run gates`, for the same reason `npm run smoke` is not: it
 * installs a genuine supervisor job (a launchd agent, a systemd user unit), starts a real daemon from a real
 * installed payload, and kills that daemon to watch the supervisor bring it back. That is the only proof that
 * catches what unit tests cannot, and this file exists because it caught two things reading had not:
 *
 *   * `launchctl bootout gui/501 <label>` — the domain and the label as two arguments — boots nothing out and
 *     says nothing, so an uninstall reported success and left the service *running*.
 *   * a launchd job that has been accepted is not yet *up*, so a status read immediately after install legitimately
 *     says "installed, stopped"; the caller polls rather than calling that a failure.
 *
 * It is written to be safe to run on a developer's own machine, which took some care:
 *
 *   * the unit file goes into a **temporary** home, never `~/Library/LaunchAgents`, so nothing appears in the
 *     person's own session and nothing loads at their next login;
 *   * the daemon runs against a **temporary shared home**, so it has its own claim, state and port;
 *   * the one deviation from the product's plist text is an injected `ENVOYDEV_DAEMON_PORT=0`, so the proof cannot
 *     collide with a daemon the owner is already running on the default port. The plist text itself is proven
 *     byte-for-byte by `packages/platform/test/service.test.ts`;
 *   * a `finally` block boots the job out, so a failure half way through cannot leave a job that restarts forever
 *     against a directory that is about to be deleted.
 *
 * It needs a **packaged** daemon bundle (`ENVOYDEV_DAEMON_PACKAGE=1`), installs it as a payload into its own
 * temporary home, and points the unit at that payload — not at the checkout's build directory, which is the path
 * an app upgrade replaces and therefore the one thing a unit must never name.
 *
 *     ENVOYDEV_DAEMON_PACKAGE=1 node apps/desktop/scripts/build-daemon.mjs
 *     npm run service:proof
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { coderPaths } from "@envoydev/host-bridge";
import { installService, uninstallService, readServiceStatus, type ServiceIo } from "@envoydev/platform";

import { payloadPaths, readCurrent, versionDir } from "../apps/desktop/src/daemon/payload.js";
import { realServiceIo, serviceLogPath } from "../apps/desktop/src/daemon/supervisor.js";

/** Run something that has to succeed, or say which step failed rather than dying inside a promise. */
async function mustRun(what: string, command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await promisify(execFile)(command, args, { env: { ...process.env, ...env } });
  } catch (error) {
    throw new Error(`${what} failed: ${String((error as Error).message)}`);
  }
}

const fail: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(name);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, ms: number, fn: () => Promise<T | undefined>): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const got = await fn();
    if (got !== undefined) return got;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

// A home of its own, so the proof's daemon has its own claim and state and cannot disturb a real one.
const home = await mkdtemp(join(tmpdir(), "envoydev-service-proof-"));
const paths = coderPaths(home);
const userHome = await mkdtemp(join(tmpdir(), "envoydev-service-home-"));

// The unit must run an *installed payload*, never the checkout's build directory: an app upgrade replaces its own
// directory, and a unit naming one would break — or, on Windows, be impossible to uninstall — the first time
// somebody updated the app while the service was meant to keep running.
const bundleDir = join(process.cwd(), "apps/desktop/dist-daemon");
if (!existsSync(join(bundleDir, "node_modules"))) {
  console.error(
    `no packaged daemon bundle at ${bundleDir}.\n` +
      "Build it first: ENVOYDEV_DAEMON_PACKAGE=1 node apps/desktop/scripts/build-daemon.mjs",
  );
  process.exit(1);
}
await mustRun("installing the payload", process.execPath, [join(bundleDir, "main.mjs"), "--install-payload"], {
  ENVOYMESH_HOME: home,
  ENVOYDEV_WARM_AGENTS: "0",
});
const version = await readCurrent(paths);
if (version === undefined) throw new Error("the payload install wrote no current version");
const payload = payloadPaths(versionDir(paths, version));
console.log(`payload ${version}: ${payload.entry}`);
// The product's unit file, with one extra environment key: port 0 lets the proof's daemon pick its own port
// instead of fighting a daemon the owner may already be running on the default one.
const io: ServiceIo = {
  ...realServiceIo,
  writeFile: (path, contents) =>
    realServiceIo.writeFile(
      path,
      contents.replace("<key>ENVOYMESH_HOME</key>", "<key>ENVOYDEV_DAEMON_PORT</key>\n    <string>0</string>\n    <key>ENVOYMESH_HOME</key>"),
    ),
};

const input = {
  platform: "macos" as const,
  node: payload.node,
  entry: payload.entry,
  home,
  logPath: serviceLogPath(paths),
  userHome,
  uid: process.getuid?.() ?? 0,
  label: "dev.envoy.envoydev.daemon.proof",
};

try {
  const before = await readServiceStatus(io, input);
  check("launchd does not know the label yet", before.state === "not-installed", before.detail.split("\n")[0]);

  // launchd accepts the job and starts the process asynchronously, so "installed" and "up" are different
  // moments. `installService` reports what the supervisor says at that instant; the caller polls for the rest.
  const attempt = await installService(io, input);
  const installed = await waitFor("the agent to come up", 20_000, async () => {
    const status = await readServiceStatus(io, input);
    return status.state === "running" ? status : undefined;
  }).catch(() => undefined);
  check(
    "the agent comes up after install",
    installed !== undefined,
    installed?.pid ? `pid ${installed.pid}` : `install said: ${attempt.detail.split("\n")[0] || attempt.state}`,
  );
  const plist = join(userHome, "Library/LaunchAgents", `${input.label}.plist`);
  const text = await readFile(plist, "utf8");
  check("the plist is where launchd looks", text.includes("<key>KeepAlive</key>"));
  check("the plist runs the --managed-by service form", text.includes("--managed-by") && text.includes("<string>service</string>"));
  check("the plist passes the home the app reads", text.includes(home));

  // `launchctl print` says "running" as soon as the process exists, which is before the daemon has published its
  // claim — so wait for the file rather than for the supervisor's opinion about the process.
  const claimPath = join(paths.stateDir, "daemon.json");
  const claim = await waitFor("the daemon to publish its claim", 30_000, async () =>
    readFile(claimPath, "utf8").then(
      (text) => JSON.parse(text) as { pid: number; port: number; managedBy?: string },
      () => undefined,
    ),
  );
  check("the daemon's claim says a service owns it", claim.managedBy === "service", `managedBy=${String(claim.managedBy)}`);
  check("the daemon is serving on its own port", claim.port > 0, `port ${claim.port}`);
  check(
    "its output goes to the product's log directory",
    await waitFor("the service log", 10_000, async () =>
      readFile(serviceLogPath(paths), "utf8").then(() => true, () => undefined),
    ),
  );

  // Kill it the way a crash would, and see whether launchd brings it back.
  process.kill(claim.pid, "SIGKILL");
  const restarted = await waitFor("launchd to restart the daemon", 40_000, async () => {
    const status = await readServiceStatus(io, input);
    return status.state === "running" && status.pid !== undefined && status.pid !== claim.pid ? status : undefined;
  });
  check("launchd restarts a crashed daemon (KeepAlive)", restarted.pid !== claim.pid, `pid ${claim.pid} -> ${restarted.pid}`);

  const removed = await uninstallService(io, input);
  check("the plist is gone", await readFile(plist, "utf8").then(() => false, () => true));
  // Unloading is asynchronous too, and the check that matters is that launchd really forgot it — the first run of
  // this proof found the opposite: a job still loaded and running after an uninstall that reported success.
  const unloaded = await waitFor("launchd to forget the service", 20_000, async () => {
    const status = await readServiceStatus(io, input);
    return status.state === "not-installed" ? status : undefined;
  }).catch(() => undefined);
  check("launchd no longer has the service", unloaded !== undefined, (unloaded ?? removed).detail.split("\n")[0]);
  const died = await waitFor("the restarted daemon to exit", 20_000, async () => {
    try {
      process.kill(restarted.pid, 0);
      return undefined;
    } catch {
      return true;
    }
  }).catch(() => undefined);
  check("the daemon launchd started is gone too", died === true, `pid ${restarted.pid}`);
} finally {
  // Belt and braces: a stray job from a failed run would restart forever against a deleted program.
  await realServiceIo.run({ command: "launchctl", args: ["bootout", `gui/${input.uid}/${input.label}`], tolerate: "failure" });
  await writeFile(join(tmpdir(), "envoydev-service-proof-done"), new Date().toISOString());
}

console.log(fail.length === 0 ? "\nservice proof: all checks passed" : `\nservice proof: ${fail.length} FAILED — ${fail.join(", ")}`);
process.exit(fail.length === 0 ? 0 : 1);
