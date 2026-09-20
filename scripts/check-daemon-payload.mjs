/**
 * **Does the installed payload actually start?**
 *
 * Every other check in this repository reads a file and compares something. This one *executes the artifact*,
 * because three bugs in a row were invisible to reading and obvious to running: a payload that copied only the entry
 * (`ERR_MODULE_NOT_FOUND: @envoydev/protocol`), one that copied the dependencies but parked the entry beside no
 * `node_modules` (`Cannot find package 'zod'`), and a check of mine that threw before it looked at the bundle at
 * all. "The files are there" is not "it starts", and a supervisor's first act is to exec it.
 *
 * What it does, in a temporary home so the owner's own daemon is untouched and on port `0` so nothing collides:
 * build the daemon in its packaging mode, install the payload through the real `--install-payload` path, start the
 * **copied** node with the **copied** entry and `--managed-by service`, wait for it to report that it is serving,
 * assert the claim says a service owns it (which is what makes the window leave it alone), then stop it and assert
 * the stop was recorded.
 *
 * Usage: `node scripts/check-daemon-payload.mjs` (also the last step of `npm run gates`).
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps", "desktop");
const home = mkdtempSync(path.join(tmpdir(), "envoydev-payload-check-"));
const env = { ...process.env, ENVOYMESH_HOME: home, ENVOYDEV_DAEMON_PORT: "0" };

let failure = "";
const cleanup = [];
try {
  // 1. The packaging build: the one whose payload carries its dependencies.
  const built = await run(process.execPath, ["scripts/build-daemon.mjs"], {
    cwd: desktop,
    env: { ...env, ENVOYDEV_DAEMON_PACKAGE: "1" },
  });
  if (built.code !== 0) throw new Error(`the packaged build failed:\n${built.output}`);

  // 2. Install it the way the app or an installer would.
  const installed = await run(process.execPath, [path.join(desktop, "dist-daemon", "main.mjs"), "--install-payload"], {
    cwd: root,
    env,
  });
  if (installed.code !== 0) throw new Error(`--install-payload failed:\n${installed.output}`);
  const version = installed.output.match(/payload (\S+)/)?.[1];
  if (!version) throw new Error(`could not read the installed version from:\n${installed.output}`);

  const dir = path.join(home, "EnvoyDev", "runtime", version);
  const entry = path.join(dir, "app", "main.mjs");
  if (!readFileSync(entry, "utf8").includes("import")) {
    throw new Error(`the installed entry at ${entry} does not look like the built daemon`);
  }

  // 3. Start the *copied* payload, and watch for it to say it is serving.
  const daemon = spawn(path.join(dir, "node"), [entry, "--managed-by", "service"], { env, stdio: ["ignore", "pipe", "pipe"] });
  cleanup.push(() => daemon.kill("SIGKILL"));
  let output = "";
  daemon.stdout.on("data", (chunk) => (output += chunk.toString()));
  daemon.stderr.on("data", (chunk) => (output += chunk.toString()));
  const serving = await waitFor(() => output.includes("serving:"), 30_000);
  if (!serving) throw new Error(`the installed payload never reported serving:\n${output}`);

  // 4. A service must own the claim, or the window would stop it when it quits.
  const claim = JSON.parse(readFileSync(path.join(home, "EnvoyDev", "daemon.json"), "utf8"));
  if (claim.managedBy !== "service") {
    throw new Error(`the claim says managedBy=${JSON.stringify(claim.managedBy)}, not "service"`);
  }

  // 5. A deliberate stop has to reach the signal handler and be recorded.
  daemon.kill("SIGTERM");
  const exited = await waitFor(() => daemon.exitCode !== null, 15_000);
  if (!exited) throw new Error("the daemon did not stop on SIGTERM");
  const lifecycle = JSON.parse(readFileSync(path.join(home, "EnvoyDev", "logs", "lifecycle.json"), "utf8"));
  if (lifecycle.lastStop?.signal !== "SIGTERM") {
    throw new Error(`the stop was not recorded: ${JSON.stringify(lifecycle.lastStop)}`);
  }

  console.log(`daemon payload OK — ${version} starts, serves as a service, and stops cleanly (home ${home})`);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  for (const step of cleanup.reverse()) {
    try {
      step();
    } catch {
      // A cleanup that fails must not hide the failure it is cleaning up after.
    }
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

if (failure !== "") {
  console.error(`daemon payload: ${failure}`);
  process.exit(1);
}

/** Run a child to completion, keeping its output for the error message. */
function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.on("close", (code) => resolve({ code, output }));
  });
}

/** Poll a predicate, so a daemon that starts slowly is not a failure. */
async function waitFor(predicate, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (predicate()) return true;
    await new Promise((done) => setTimeout(done, 250));
  }
  return predicate();
}
