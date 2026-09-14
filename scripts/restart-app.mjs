/**
 * Restart EnvoyCoder: stop whatever is running, then start it again.
 *
 * ## Why this exists
 *
 * Restarting by hand fails in three ways that look like bugs in the app:
 *
 *   1. **A leftover Vite holds the UI port.** Tauri's `beforeDevCommand` starts its own Vite on the exact
 *      port in `devUrl` (6173 for us — deliberately not Vite's 5173 default, which EnvoyMesh's Social app
 *      uses on the same machine), so a second run aborts before compiling with "Port 6173 is already in
 *      use" — which reads as the app failing to start.
 *   2. **A leftover daemon holds 4770.** The shell spawns one, finds the port taken, and exits — the
 *      window then has no host.
 *   3. **A claim file naming a dead pid.** `<home>/EnvoyCoder/daemon.json` is how the window finds its
 *      daemon; a claim from a crashed run makes the shell think a host exists when none does.
 *
 * ## What it will not do
 *
 * It will not delete a **live** claim, and it will not kill a process it cannot identify as this app's.
 * "One owner at a time" is the family rule for a reason: silently stealing a running daemon's claim is
 * how two products end up with one identity.
 *
 * Usage:
 *   npm run app:restart          stop everything, then run `tauri:dev` in the foreground
 *   npm run app:stop             stop everything and exit (no start)
 *   node scripts/restart-app.mjs --stop-only
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const stopOnly = process.argv.includes("--stop-only");
const isWindows = process.platform === "win32";

/** The home the app uses, resolved the way the shell does: `ENVOYMESH_HOME`, else `~/.envoymesh`. */
function sharedHome() {
  const fromEnv = process.env.ENVOYMESH_HOME?.trim();
  if (fromEnv) return fromEnv;
  const legacy = path.join(homedir(), ".envoymesh");
  return legacy;
}

const claimPath = path.join(sharedHome(), "EnvoyCoder", "daemon.json");

function pidsMatching(pattern) {
  if (isWindows) return [];
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" })
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return []; // pgrep exits non-zero when nothing matches, which is the good case
  }
}

function kill(pid, label) {
  try {
    process.kill(pid, "SIGTERM");
    console.log(`  stopped ${label} (pid ${pid})`);
    return true;
  } catch (error) {
    console.log(`  could not stop ${label} (pid ${pid}): ${error.message}`);
    return false;
  }
}

/** Is the pid alive? `kill(pid, 0)` asks without signalling. */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/* ── 1. the window and the shell it spawned ─────────────────────────────────────────────── */
console.log("Stopping EnvoyCoder…");
if (isWindows) {
  // The shells we own, by image name; `taskkill /T` takes the daemon with the shell.
  for (const image of ["envoycoder.exe"]) {
    try {
      execFileSync("taskkill", ["/IM", image, "/T", "/F"], { stdio: "ignore" });
      console.log(`  stopped ${image}`);
    } catch {
      /* not running */
    }
  }
} else {
  for (const pid of pidsMatching("target/debug/envoycoder")) kill(pid, "the window");
}

/* ── 2. the daemon ──────────────────────────────────────────────────────────────────────── */
const claim = (() => {
  try {
    return JSON.parse(readFileSync(claimPath, "utf8"));
  } catch {
    return null;
  }
})();

if (claim?.pid && Number.isInteger(claim.pid)) {
  if (isAlive(claim.pid)) kill(claim.pid, "the daemon (from its claim)");
  else console.log(`  the daemon's claim names pid ${claim.pid}, which is already gone`);
}

// Anything else running this app's daemon: the shell may have started it from the bundle.
if (!isWindows) {
  for (const pid of pidsMatching("dist-daemon/main.mjs")) kill(pid, "a daemon from the bundle");
  for (const pid of pidsMatching("apps/desktop/src/daemon/main.ts")) kill(pid, "a dev daemon");
}

/* ── 3. the claim file, only when it is stale ───────────────────────────────────────────── */
if (existsSync(claimPath)) {
  const alive = claim?.pid ? isAlive(claim.pid) : false;
  if (alive) {
    console.log("  leaving the claim file alone: its process is still alive (one owner at a time)");
  } else {
    rmSync(claimPath, { force: true });
    console.log("  removed the stale claim file, so the shell starts a fresh daemon");
  }
}

/* ── 4. the dev server ──────────────────────────────────────────────────────────────────── */
if (!isWindows) {
  for (const pid of pidsMatching("node_modules/.bin/vite")) kill(pid, "the dev server");
  for (const pid of pidsMatching("vite")) kill(pid, "a vite process");
}

/* ── 5. say what the ports look like now, then start (or not) ───────────────────────────── */
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
await sleep(600);

for (const port of [6173, 4770]) {
  let holder = null;
  try {
    holder = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
      .split("\n")[1]
      ?.trim();
  } catch {
    /* nothing listening, which is what we want */
  }
  console.log(holder ? `  note: port ${port} is still held by: ${holder.split(/\s+/)[0]}` : `  port ${port} is free`);
}

if (stopOnly) {
  console.log("\nStopped. Start it again with: npm run tauri:dev");
  process.exit(0);
}

console.log("\nStarting: npm run tauri:dev  (Ctrl+C stops it)\n");
const started = execFileSync("npm", ["run", "tauri:dev"], { cwd: root, stdio: "inherit" });
process.exit(started === null ? 0 : 0);
