/**
 * The service acceptance proof: a real supervisor, a real daemon, nothing simulated.
 *
 * `npm run service:proof` — **not** part of `npm run gates`, for the same reason `npm run smoke` is not: it
 * installs a genuine supervisor job (a launchd agent, a systemd user unit), starts a real daemon from a real
 * installed payload, kills that daemon to watch the supervisor bring it back, and then stops it cleanly to watch
 * the supervisor leave it down. That is the only proof that catches what unit tests cannot, and this file exists
 * because it caught two things reading had not:
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
 *     collide with a daemon the owner is already running on the default port. `packages/platform/test/service.test.ts`
 *     pins the text's shape by `toContain` on its own fixture paths, not these bytes, so the checks below read the
 *     installed file and are what pins *this* plist;
 *   * `finally` **and** a `SIGINT`/`SIGTERM` handler boot the job out and remove the temporary homes, because
 *     `finally` does not run when Ctrl-C stops the proof, and a job left loaded would restart forever against a
 *     directory that is about to be deleted.
 *
 * It needs a **packaged** daemon bundle (`ENVOYDEV_DAEMON_PACKAGE=1`), installs it as a payload into its own
 * temporary home, and points the unit at that payload — not at the checkout's build directory, which is the path
 * an app upgrade replaces and therefore the one thing a unit must never name.
 *
 *     npm run daemon:package
 *     npm run service:proof
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      "Build it first: npm run daemon:package",
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
//
// The injection is a string replacement, so it would silently no-op the day the plist's marker changes — and the
// proof would then fight the owner's daemon on the default port while claiming to have exercised the real text.
// It refuses instead, and the check below reads the installed file to prove the replacement landed.
const injectedKey = "<key>ENVOYDEV_DAEMON_PORT</key>";
const io: ServiceIo = {
  ...realServiceIo,
  writeFile: (path, contents) => {
    const marker = "<key>ENVOYMESH_HOME</key>";
    if (!contents.includes(marker)) {
      throw new Error(`the plist no longer contains ${marker}, so the proof's port injection cannot be applied`);
    }
    return realServiceIo.writeFile(
      path,
      contents.replace(marker, `${injectedKey}\n    <string>0</string>\n    ${marker}`),
    );
  },
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

/**
 * Put the machine back the way it was found: no loaded job, no temporary homes, no marker an older run left in
 * `/tmp`. Runs once, from `finally` or from a signal, and is idempotent so both paths can call it.
 */
const markerPath = join(tmpdir(), "envoydev-service-proof-done");
let cleaned = false;
async function cleanup(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  // Belt and braces: a stray job from a failed run would restart forever against a deleted program.
  await realServiceIo.run({ command: "launchctl", args: ["bootout", `gui/${input.uid}/${input.label}`], tolerate: "failure" });
  await rm(home, { recursive: true, force: true });
  await rm(userHome, { recursive: true, force: true });
  // Nothing reads the completion marker, and a stale one left in /tmp is litter that makes the next run look done
  // before it started.
  await rm(markerPath, { force: true });
}

// `finally` does not run when a signal ends the process, and Ctrl-C is how a person stops a proof that installed a
// real supervisor job: without these the job stays loaded and restarts forever against a home about to be deleted.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void cleanup()
      .catch(() => undefined)
      .then(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

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
  // The injection is a replacement over the plist text; if the marker moved, the first check above would still pass
  // on the un-injected file and the proof's daemon would land on the owner's default port. Reading the installed
  // file is what proves the replacement actually happened.
  check(
    "the port injection reached the installed plist",
    text.includes(injectedKey) && text.includes("<string>0</string>"),
  );

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
  // The predicate above proved a pid is present; narrowing it here keeps `process.kill` honest rather than casting.
  const restartedPid = restarted.pid;
  if (restartedPid === undefined) throw new Error("launchd brought the daemon back without reporting a pid");

  // The other half of `KeepAlive { SuccessfulExit: false }`, and the half the stop button relies on: a deliberate
  // stop must *stay* stopped. SIGTERM is the daemon's clean path — it drains and exits 0 — so launchd must not bring
  // it back, or the switch's "stop" and the app's own quit would be undone by the supervisor.
  /**
   * **Wait until the restarted daemon is *serving*, not merely running.**
   *
   * launchd reports `state = running` the instant the process exists — seconds before the daemon has installed its
   * signal handlers, because it opens the store, reconciles interrupted runs, starts the mesh and binds the socket
   * first. A `SIGTERM` in that window kills it *by signal*, which is an unsuccessful exit, so launchd restarts it —
   * correctly. The check below then blames the restart policy for a race in this script, which is exactly what
   * happened: the job had run three times and the failure was reported as "it came back". The claim is the daemon's
   * own statement that it is serving, so it is the honest thing to wait for.
   */
  const serving = await waitFor("the restarted daemon to publish its claim", 30_000, async () => {
    const claim = await readFile(join(paths.stateDir, "daemon.json"), "utf8").then(
      (text) => JSON.parse(text) as { pid?: number },
      () => undefined,
    );
    return claim?.pid === restartedPid ? claim : undefined;
  }).catch(() => undefined);
  check(
    "the restarted daemon is serving before it is asked to stop",
    serving !== undefined,
    `pid ${restartedPid}`,
  );

  process.kill(restartedPid, "SIGTERM");
  const stopped = await waitFor("the daemon to exit on SIGTERM", 20_000, async () => {
    try {
      process.kill(restartedPid, 0);
      return undefined;
    } catch {
      return true;
    }
  }).catch(() => undefined);
  check("a clean stop takes the daemon down", stopped === true, `pid ${restartedPid}`);
  // `ThrottleInterval` is 10s, so a relaunch — if the policy were wrong — would appear inside this window.
  const relaunched = await waitFor("launchd to relaunch a deliberately stopped daemon", 12_000, async () => {
    const status = await readServiceStatus(io, input);
    return status.state === "running" ? status : undefined;
  }).catch(() => undefined);
  check(
    "a clean stop stays down (SuccessfulExit=false)",
    relaunched === undefined,
    relaunched?.pid === undefined ? "" : `it came back as pid ${relaunched.pid}`,
  );
  if (relaunched !== undefined) {
    /**
     * **Launchd's own view, printed only when the policy looks broken.**
     *
     * This is the datum that decides where the fault is, and without it the failure is undiagnosable: a non-zero
     * `last exit code` means the daemon did not exit cleanly (so the "deliberate stop" never happened), while a
     * zero one means it did and launchd restarted it anyway — and those two need opposite fixes. A probe job that
     * merely exits 0 under the identical `KeepAlive` dict stays down (runs = 1, last exit code = 0), so the plist's
     * policy is right in isolation and only the real job can say what differs.
     */
    try {
      const printed = await realServiceIo.run({
        command: "launchctl",
        args: ["print", `gui/${input.uid}/${input.label}`],
      });
      const interesting = printed.stdout
        .split("\n")
        .filter((line) => /last exit code|state = |pid = |runs = |successive crashes/.test(line))
        .map((line) => line.trim());
      console.log(`  launchd's view: ${interesting.join(" | ") || "nothing interesting printed"}`);
    } catch (error) {
      console.log(`  launchd's view: unavailable (${String(error).slice(0, 80)})`);
    }
  }

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
      process.kill(restartedPid, 0);
      return undefined;
    } catch {
      return true;
    }
  }).catch(() => undefined);
  check("the daemon launchd started is gone too", died === true, `pid ${restartedPid}`);
} finally {
  await cleanup();
}

console.log(fail.length === 0 ? "\nservice proof: all checks passed" : `\nservice proof: ${fail.length} FAILED — ${fail.join(", ")}`);
process.exit(fail.length === 0 ? 0 : 1);
