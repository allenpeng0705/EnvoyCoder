/**
 * Restart EnvoyCoder: stop whatever is running, then start it again.
 *
 * ## Why this exists
 *
 * Restarting by hand fails in four ways that look like bugs in the app:
 *
 *   1. **A leftover Vite holds the UI port.** Tauri's `beforeDevCommand` starts its own Vite on the exact
 *      port in `devUrl` (6173 for us — deliberately not Vite's 5173 default, which EnvoyMesh's Social app
 *      uses on the same machine), so a second run aborts before compiling with "Port 6173 is already in
 *      use" — which reads as the app failing to start.
 *   2. **A leftover daemon holds 4770.** The shell spawns one, finds the port taken, and exits — the
 *      window then has no host.
 *   3. **A claim file naming a dead pid.** `<home>/EnvoyCoder/daemon.json` is how the window finds its
 *      daemon; a claim from a crashed run makes the shell think a host exists when none does.
 *   4. **A daemon whose claim the shell cannot see.** The shell (Rust) and the daemon (TypeScript) each
 *      resolve the shared home, and the day those two answers differ the daemon publishes its claim in
 *      one home while the shell looks for it in the other. The window then reports a failure
 *      ("the daemon exited immediately") while a healthy daemon serves on 4770: restarting cannot fix a
 *      disagreement about a *path*, which is why this script stops a daemon whose claim it finds in
 *      **any** home the family's rule can choose, and prints the home the app itself resolves.
 *
 * ## What it will not do
 *
 * It will not delete a **live** claim, and it will not kill a process it cannot identify as this app's:
 * every pattern below is an absolute path **inside this checkout**, so a sibling product's daemon or dev
 * server can never match (the family's rule: never by port, never by a bare name). A packaged app's
 * *window* is not touched either — its daemon is, and that is the process that owns the state.
 *
 * It also will not call a process stopped because a signal was sent. SIGTERM, then wait, then SIGKILL,
 * then say so if it is still there — and if this app's own processes still hold 6173 or 4770, it refuses
 * to start rather than handing the next run the state that reads as "the app did not start".
 *
 * Usage:
 *   npm run app:restart          stop everything, then run `tauri:dev` in the foreground
 *   npm run app:stop             stop everything and exit (no start)
 *   node scripts/restart-app.mjs --stop-only
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const stopOnly = process.argv.includes("--stop-only");
const isWindows = process.platform === "win32";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* ── the homes this app can be using ────────────────────────────────────────────────────────────── */

/**
 * The marker names `@envoymesh/node-core`'s `looksLikeHome` accepts.
 *
 * Copied from the family's implementation rather than guessed, because this is the rule that decides
 * *which home* is the app's. A directory that exists is not a home: the per-OS default can hold a shared
 * `runtime/` and this app's own `logs/` while the install — profile and all — lives in `~/.envoymesh`,
 * and a script (or a shell) that treated existence as the test would look for the claim in the wrong
 * place and report a healthy daemon as missing.
 */
const HOME_MARKERS = ["envoymesh.json", "profile", "profile.json"];
const LEGACY_HOME_DIRNAME = ".envoymesh";
const PRODUCT = "EnvoyCoder";

/** The conventional root for this OS, exactly as `node-core`'s `defaultHomeDir` computes it. */
function defaultHome(home) {
  if (isWindows) {
    const local = process.env.LOCALAPPDATA?.trim();
    return path.join(
      local && local.length > 0 ? local : path.join(home, "AppData", "Local"),
      "EnvoyMesh",
    );
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "EnvoyMesh");
  }
  const xdg = process.env.XDG_DATA_HOME?.trim();
  return path.join(xdg && xdg.length > 0 ? xdg : path.join(home, ".local", "share"), "EnvoyMesh");
}

function looksLikeHome(dir) {
  return HOME_MARKERS.some((name) => existsSync(path.join(dir, name)));
}

/**
 * The home the app itself resolves: `ENVOYMESH_HOME` → the per-OS default *when it holds a home* →
 * legacy `~/.envoymesh` when it holds one → the per-OS default.
 */
function resolvedHome() {
  const override = process.env.ENVOYMESH_HOME?.trim();
  if (override) return override;
  const preferred = defaultHome(homedir());
  if (looksLikeHome(preferred)) return preferred;
  const legacy = path.join(homedir(), LEGACY_HOME_DIRNAME);
  return looksLikeHome(legacy) ? legacy : preferred;
}

/** Every home a claim could be sitting in — the one the app resolves, plus both candidates. */
function candidateHomes() {
  return [...new Set([resolvedHome(), defaultHome(homedir()), path.join(homedir(), LEGACY_HOME_DIRNAME)])];
}

/* ── processes ──────────────────────────────────────────────────────────────────────────────────── */

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

/**
 * The pids of every process whose **executable** is `absPath` — this checkout's own binary, or nothing.
 *
 * `pgrep -f` reads the command line, and the command line is not the program: what a process was *invoked* as
 * and what it *is* can differ (a relative path, a shim, a symlink). So the candidates come from a loose match on
 * the file name and the *decision* comes from `lsof`'s view of the executable, which is an absolute path or
 * nothing at all. The loose match is what keeps a sibling product's identically-named binary safe: its
 * executable is somewhere else, and that is the test.
 */
function pidsRunningExecutable(absPath) {
  if (isWindows) return [];
  return pidsMatching(path.basename(absPath)).filter((pid) => executableOf(pid) === absPath);
}

/** What a process is actually running, as the kernel sees it. `null` when it cannot be read. */
function executableOf(pid) {
  try {
    const line = execFileSync("lsof", ["-p", String(pid), "-a", "-d", "txt", "-Fn"], { encoding: "utf8" })
      .split("\n")
      .find((candidate) => candidate.startsWith("n"));
    return line === undefined ? null : line.slice(1);
  } catch {
    return null;
  }
}

/**
 * The process's state letter, or `null` when it cannot be read. `Z` is a zombie — see `isAlive`.
 *
 * Windows has no such state (an exited process is gone), so `ps` is not consulted there at all.
 */
function processState(pid) {
  if (isWindows) return null;
  try {
    const state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return state === "" ? null : state;
  } catch {
    // `ps` exits non-zero for a pid it cannot see. That is not evidence of life, and the signal probe has
    // already had its say, so the caller treats an unreadable state as "unknown" rather than as "dead".
    return null;
  }
}

/**
 * Is the pid a **running** process?
 *
 * `kill(pid, 0)` asks without signalling, and it answers *yes* for a process that has exited and has not been
 * reaped — a **zombie**. That distinction is the whole reason this is more than one line: the window is the
 * parent of the daemon it spawns, so a daemon killed while the window is still up is a zombie until the window
 * notices, and a script that read that as "still running" refused to start the app over a process holding
 * neither a port nor a claim. It is the same question `apps/desktop/src/daemon/lock.ts` asks in TypeScript, and
 * the two must agree for the reason the home resolution must (`docs/envoycoder-platforms.md` §5).
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const state = processState(pid);
  return state === null ? true : !state.startsWith("Z");
}

async function waitForDeath(pid, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(100);
  }
  return !isAlive(pid);
}

/** The daemon's own shutdown is bounded; a process that needs longer than this is not shutting down. */
const TERM_GRACE_MS = 6_000;
const KILL_GRACE_MS = 2_000;

/** What could not be stopped — label and pid. Reported at the end, and the reason a start is refused. */
const stuck = [];

/**
 * Stop a process, **and find out whether it stopped.**
 *
 * The whole point of the two waits: `process.kill` returning is not the process being gone, and a script
 * that printed "stopped the daemon" the moment the signal was sent was reporting its own intent rather
 * than the machine's state — which is how a leftover daemon holds 4770 through a restart nobody can
 * explain.
 */
async function stopProcess(pid, label) {
  if (!isAlive(pid)) return true;

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (!isAlive(pid)) {
      console.log(`  ${label} (pid ${pid}) was already gone`);
      return true;
    }
    console.log(`  could not signal ${label} (pid ${pid}): ${error.message}`);
    stuck.push({ label, pid });
    return false;
  }

  if (await waitForDeath(pid, TERM_GRACE_MS)) {
    console.log(`  stopped ${label} (pid ${pid})`);
    return true;
  }

  console.log(`  ${label} (pid ${pid}) did not stop when asked — killing it`);
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* it may have exited between the check and the signal, which the wait below reports */
  }
  if (await waitForDeath(pid, KILL_GRACE_MS)) {
    console.log(`  killed ${label} (pid ${pid})`);
    return true;
  }

  console.log(`  ** ${label} (pid ${pid}) is still running **`);
  stuck.push({ label, pid });
  return false;
}

function readClaim(file) {
  try {
    const claim = JSON.parse(readFileSync(file, "utf8"));
    return claim && typeof claim === "object" ? claim : null;
  } catch {
    return null;
  }
}

/* ── 1. the window and the shell it spawned ─────────────────────────────────────────────────────── */

const home = resolvedHome();
console.log("Stopping EnvoyCoder…");
console.log(
  `  home: ${home}` +
    (looksLikeHome(home) ? "" : ` (no install there yet — the app will create it)`),
);

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
  // **By the executable, not by the command line.** Cargo starts the dev shell as `target/debug/envoycoder`
  // from its own working directory, so the absolute path this script knows appears nowhere in the process's
  // command line — and a pattern looking for it matched nothing, which is how a "restart" once left the window
  // running while the daemon underneath it was killed and became a zombie.
  for (const binary of ["target/debug/envoycoder", "target/release/envoycoder"]) {
    for (const pid of pidsRunningExecutable(path.join(root, "apps/desktop/src-tauri", binary))) {
      await stopProcess(pid, "the window");
    }
  }
}

/* ── 2. the daemon, wherever its claim says it is ───────────────────────────────────────────────── */

for (const candidate of candidateHomes()) {
  const file = path.join(candidate, PRODUCT, "daemon.json");
  const claim = readClaim(file);
  // An unreadable claim is reported once, in the claim pass below: the daemon replaces it either way.
  if (!claim) continue;
  if (claim.product !== PRODUCT) {
    console.log(`  ignoring ${file}: it belongs to ${claim.product ?? "another product"}`);
    continue;
  }
  if (!Number.isInteger(claim.pid) || claim.pid <= 0) continue;
  if (isAlive(claim.pid)) {
    await stopProcess(claim.pid, `the daemon on port ${claim.port ?? "?"} (claim ${file})`);
  } else {
    console.log(`  the claim at ${file} names pid ${claim.pid}, which is already gone`);
  }
}

// Anything else running this app's daemon: the shell may have started it from the bundle, and a daemon
// started outside this checkout publishes a claim this sweep already handled above.
if (!isWindows) {
  // A Node program appears twice over: npm puts a **shim** on `PATH` (`node_modules/.bin/<name>`) and the
  // command line carries whichever path started it — the shim when npm ran it, the realpath when something
  // resolved the link first. Both are listed because a pattern that knows only one of them misses the other:
  // the dev server survived a "stop everything" exactly this way.
  for (const entry of [
    "apps/desktop/dist-daemon/main.mjs",
    "apps/desktop/src/daemon/main.ts",
    "node_modules/@tauri-apps/cli",
    "node_modules/.bin/tauri",
    "node_modules/.bin/vite",
    "node_modules/vite/bin/vite.js",
  ]) {
    for (const pid of pidsMatching(path.join(root, entry))) {
      await stopProcess(pid, `a leftover process (${entry})`);
    }
  }
}

/* ── 3. the claim files, only when they are stale ───────────────────────────────────────────────── */

for (const candidate of candidateHomes()) {
  const file = path.join(candidate, PRODUCT, "daemon.json");
  if (!existsSync(file)) continue;
  const claim = readClaim(file);
  if (claim && claim.product !== PRODUCT) continue;
  // A file we cannot read is not one we can identify as this product's, so it is left alone — the
  // daemon already handles it (`main.ts`: "could not be read … it will be replaced"), and deleting a
  // claim that a *packaged* app's daemon might be living behind is how two daemons end up on one home.
  if (!claim) {
    console.log(`  leaving ${file} alone: it is unreadable, so the daemon decides`);
    continue;
  }
  if (Number.isInteger(claim.pid) && isAlive(claim.pid)) {
    console.log(`  leaving ${file} alone: its process is still alive (one owner at a time)`);
    continue;
  }
  rmSync(file, { force: true });
  console.log(`  removed the stale claim ${file}, so the shell starts a fresh daemon`);
}

/* ── 4. the ports, before anything is started on them ───────────────────────────────────────────── */

function portHolder(port) {
  try {
    return (
      execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
        .split("\n")[1]
        ?.trim() ?? null
    );
  } catch {
    return null; // nothing listening, which is what we want
  }
}

const PORTS = [6173, 4770];
let held = [];
for (let attempt = 0; attempt < 10; attempt += 1) {
  held = PORTS.map((port) => [port, portHolder(port)]).filter(([, holder]) => holder !== null);
  if (held.length === 0) break;
  await sleep(300);
}

if (held.length === 0) {
  console.log(`  ports ${PORTS.join(" and ")} are free`);
} else {
  for (const [port, holder] of held) {
    const [command, pid] = holder.split(/\s+/);
    console.log(`  port ${port} is still held by ${command} (pid ${pid})`);
  }
}

if (stopOnly) {
  console.log("\nStopped. Start it again with: npm run tauri:dev");
  process.exit(0);
}

// Refusing rather than starting anyway: `tauri:dev` would fail before compiling, or the shell's daemon
// would fail to bind and the window would report a daemon that "exited immediately" — the two states
// this script exists to prevent. Nothing here is guessable from the app's own error message.
if (held.length > 0 || stuck.length > 0) {
  console.error("\nNot starting:");
  for (const { label, pid } of stuck) console.error(`  ${label} (pid ${pid}) did not stop`);
  for (const [port, holder] of held) console.error(`  port ${port} is held by ${holder}`);
  if (stuck.length > 0) {
    console.error(`\nNothing of this app should be running once you stop them: kill -9 ${stuck.map((it) => it.pid).join(" ")}`);
  } else {
    console.error("\nFree that port (it is not this app's process) and try again.");
  }
  process.exit(1);
}

console.log("\nStarting: npm run tauri:dev  (Ctrl+C stops it)\n");
const npm = isWindows ? "npm.cmd" : "npm";
const started = spawnSync(npm, ["run", "tauri:dev"], { cwd: root, stdio: "inherit" });
// The exit status is the app's, not this script's: a `tauri:dev` that failed used to leave `app:restart`
// exiting 0, which is the same "it says it worked" failure in a different place.
if (started.signal) process.exit(started.signal === "SIGINT" ? 130 : 1);
process.exit(started.status ?? 1);
