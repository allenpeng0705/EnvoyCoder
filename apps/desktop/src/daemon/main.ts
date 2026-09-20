/**
 * The daemon's entry point: read the environment, report, then hand over.
 *
 * Everything that is not I/O lives in `serve.ts` (`startCoderDaemon`) and `boot.ts` (the
 * decisions), because this file cannot be tested: it has top-level `await`, it calls
 * `process.exit`, and it installs signal handlers. What is left here is exactly that, in the order
 * the boot report reads:
 *
 *   1. **Read the shared home** and describe it in the family's words. A damaged profile stops the
 *      process with exit 4 — never a "repair", because writing into a half-readable profile is how a
 *      user loses contacts and bonds without being told.
 *   2. **Stop if a daemon already owns this home.** Read from the published claim rather than
 *      inferred from a failed bind, so the message can name the daemon that is running instead of
 *      reporting "address in use" for something that is working correctly.
 *   3. **Start** — state, handlers, the mesh attach, the socket, the claim.
 *   4. **Stop cleanly** on `SIGINT`, `SIGTERM` or a client's `coder.shutdown`: live runs are asked to
 *      stop and given up to ten seconds (`runs.stopAll`), so nothing is cut in half silently. A daemon
 *      owned by a supervisor is *not* stopped when the window closes (§3 of the lifecycle doc), and
 *      that is what makes walking away safe rather than merely possible.
 *
 * ```bash
 * npm run daemon                            # port 4770
 * ENVOYDEV_DAEMON_PORT=0 npm run daemon   # let the OS choose
 * ```
 *
 * ## The one deliberately unfinished thing
 *
 * **Remote callers authenticate with a paired-device token** (roadmap M4). Loopback windows stay
 * trusted without a token; a phone presents the token from its pairing QR, and `coderSessionIdentity`
 * resolves it against `<home>/EnvoyDev/paired-devices.json`. Unknown / expired / revoked tokens are
 * refused. The daemon still prints the rule at boot so a log reader is not surprised.
 *
 * ## Language, and why this file has none
 *
 * Everything `say(…)` prints here is a **log line for a headless process**: it is read on a
 * terminal, by whoever started the daemon, before any window exists — and no window ever sees it,
 * because the shell routes this output to a log file. There is no user to ask (the language setting
 * lives in the store this process may be failing to open) and no client to render a key on. `boot.ts`
 * carries the same note for the same reasons. The user-facing half of every one of these situations
 * is in the window's own catalogue — "EnvoyDev cannot reach its daemon", the connection chip, the
 * mesh status line — which is where the language setting can actually apply.
 *
 * The daemon's *refusals* are a different matter and are all translated: see `messages.ts`.
 */

import { dirname } from "node:path";
import process from "node:process";

import { DEFAULT_DAEMON_PORT, ENVOYDEV_DAEMON_PORT_ENV } from "@envoydev/protocol";
import { coderPaths, inspectCoderHome } from "@envoydev/host-bridge";

import { EXIT_FAILED, EXIT_OK, alreadyRunningOutcome, decideBoot, serveFailureOutcome } from "./boot.js";
import { readDaemonClaim } from "./lock.js";
import { heartbeatPath, startHeartbeat } from "./heartbeat.js";
import { readLifecycle, recordBoot, recordStop } from "./lifecycle.js";
import { DAEMON_VERSION } from "./version.js";
import { startCoderDaemon, type StartedCoderDaemon } from "./serve.js";

/**
 * **The one switch that turns the background warm-up off, and why it is an environment variable.**
 *
 * `warm: true` is the production behaviour: the deep facts about what each installed agent publishes arrive
 * without anybody pressing anything (`deep-warm.ts` carries the bounds). But *testing* that production
 * behaviour means starting a daemon on a developer's machine, and a tool that did that would spawn the
 * owner's own coding agents every time it ran — the pixel measurement (`scripts/measure-settings.mjs`) is
 * exactly that case, and it drives this entry point.
 *
 * So the switch exists, it is read here and nowhere else, and the tool that needs it says so in its own
 * documentation. `0` is the only value that disables it: an unset variable, an empty one, or anything else a
 * shell might hand a GUI-launched process all mean **on**, which is the safe direction for a *product* default.
 */
const WARM_ENV = "ENVOYDEV_WARM_AGENTS";

/** Whether this process should look at what the ready agents publish. See `WARM_ENV`. */
function warmAgents(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[WARM_ENV]?.trim() !== "0";
}

/** Kept in step with `apps/desktop/package.json`: a process cannot read its own version. */
// Re-exported rather than restated: `version.ts` explains why one copy is the whole point.
const VERSION = DAEMON_VERSION;

/**
 * Who manages this process, from `--managed-by app|service`.
 *
 * An argv flag rather than an environment variable because it is a *promise about supervision* that belongs in
 * the service unit's own text, where a reader can see it, rather than in an environment that anything in the
 * user's shell profile could set. Anything unrecognised means `app`: the safe reading is "the shell may stop
 * me", which is the behaviour that shipped before this flag existed.
 */
function managedByFrom(argv: readonly string[]): "app" | "service" {
  const flag = argv.findIndex((value) => value === "--managed-by");
  const found = flag >= 0 ? argv[flag + 1] : undefined;
  const inline = argv.find((value) => value.startsWith("--managed-by="))?.slice("--managed-by=".length);
  return (found ?? inline) === "service" ? "service" : "app";
}

/** The configured port, or the product default. `0` is honoured: the OS then chooses one. */
function readPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[ENVOYDEV_DAEMON_PORT_ENV]?.trim();
  if (!raw) return DEFAULT_DAEMON_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : DEFAULT_DAEMON_PORT;
}

function say(lines: string[]): void {
  for (const line of lines) console.log(line);
}

/**
 * Install this payload where a supervisor can point at it, then exit.
 *
 * This is the whole of what `--install-payload` does, and it is deliberately **before** any boot decision: it
 * must not read a claim, touch a running daemon, or bind a port. A headless install (and, later, the service
 * installer) runs the *bundled* node with the *bundled* `main.mjs` and this flag; the app passes `--harness`
 * because it is the half that knows where it staged the agent binaries.
 */
async function installCurrentPayload(): Promise<void> {
  const { installPayload, pruneVersions, readCurrent } = await import("./payload.js");
  const readCurrentText = readCurrent;
  const paths = coderPaths();
  const harnessFlag = process.argv.indexOf("--harness");
  // The version that was current *before* this install: the one a live daemon may still be running from, and the
  // rollback the design promises. Captured here because installing flips `current`.
  const previousVersion = await readCurrentText(paths);
  // The bundle is the directory this entry lives in — `dist-daemon/`, with the `node_modules` the packaging
  // script insists on beside it. Copying the entry alone produced a payload that could not start.
  const entry = process.argv[1] ?? "main.mjs";
  const installed = await installPayload(paths, {
    version: VERSION,
    node: process.execPath,
    entry,
    bundle: dirname(entry),
    ...(harnessFlag >= 0 && process.argv[harnessFlag + 1] !== undefined
      ? { harness: process.argv[harnessFlag + 1] as string }
      : {}),
  });
  // The version just installed is `current`, and one previous version is kept for rollback; anything older goes.
  // **`protect` is not decoration.** A real update runs while the old daemon is still serving out of its own
  // directory, so pruning it here deletes the program a live process is executing (`docs/daemon-lifecycle.md` §7;
  // on Windows the delete fails outright). One previous version is kept for rollback; older ones are dropped.
  const removed = await pruneVersions(paths, {
    protect: previousVersion !== undefined ? [previousVersion] : [],
  });
  // Written directly rather than through `say`: this runs before the boot report's own machinery is set up,
  // and it must not depend on anything below it in this file.
  process.stdout.write(
    [
      installed.installed
        ? `installed the daemon payload ${installed.version} at ${installed.dir}`
        : `the daemon payload ${installed.version} was already installed at ${installed.dir}`,
      ...(removed.length > 0 ? [`removed ${removed.join(", ")}`] : []),
      `current: ${(await readCurrentText(paths)) ?? "?"}`,
    ].join("\n") + "\n",
  );
}

/** `--install-payload`: put a payload where a supervisor can find it, then exit without touching a claim. */
async function installPayloadAndExit(): Promise<never> {
  await installCurrentPayload();
  process.exit(0);
}

/**
 * `service <action>`: carry out the switch, print a sentence a person can read, and exit.
 *
 * **Before the boot decision, like `--install-payload`, and for the same reason**: installing or removing a
 * service must never read a claim, touch a running daemon or bind a port. `install` also installs the payload the
 * unit will run — the app's installer runs this before any daemon exists, and a unit naming a version that was
 * never copied would restart forever against nothing.
 */
async function serviceCommandAndExit(): Promise<never> {
  const { describeService, serviceActionFrom } = await import("./service-cli.js");
  const action = serviceActionFrom(process.argv);
  if (action === undefined) {
    say(["Usage: main.mjs service <install|uninstall|status|restart>"]);
    process.exit(EXIT_FAILED);
  }
  const { daemonServiceStatus, installDaemonService, restartDaemonService, uninstallDaemonService } =
    await import("./supervisor.js");
  if (action === "install") await installCurrentPayload();
  const status =
    action === "install"
      ? await installDaemonService()
      : action === "uninstall"
        ? await uninstallDaemonService()
        : action === "restart"
          ? await restartDaemonService()
          : await daemonServiceStatus();
  const { lines, ok } = describeService(action, status);
  say(lines);
  process.exit(ok ? EXIT_OK : EXIT_FAILED);
}

/**
 * The home from `--home <path>`, applied before anything reads it.
 *
 * The service definitions (`@envoydev/platform`'s `serviceDefinition`) pass the home as an argument rather than
 * relying only on `ENVOYMESH_HOME`, because a Windows task started at logon inherits whatever environment the
 * session happens to have and the Task Scheduler's XML has no element for setting one. It is applied by setting
 * the family's own variable rather than threading a path through the boot code: `resolveHomeDir()` is the single
 * place that knows the resolution order (`ENVOYMESH_HOME` → per-OS default → legacy adoption), and a second route
 * to the same answer is a second thing to get wrong.
 */
function homeOverrideFrom(argv: readonly string[]): string | undefined {
  const flag = argv.findIndex((value) => value === "--home");
  const found = flag >= 0 ? argv[flag + 1] : undefined;
  const inline = argv.find((value) => value.startsWith("--home="))?.slice("--home=".length);
  return (found ?? inline)?.trim() || undefined;
}

// Before every other read of the home: the install branch below and the boot after it both resolve it.
const homeOverride = homeOverrideFrom(process.argv);
if (homeOverride !== undefined) process.env.ENVOYMESH_HOME = homeOverride;

if (process.argv.includes("--install-payload")) await installPayloadAndExit();
if (process.argv[2] === "service") await serviceCommandAndExit();

const port = readPort();
const paths = coderPaths();
const facts = await inspectCoderHome(paths.home);

/**
 * **Read the history here; record the start later, and only when this process is going to serve.**
 *
 * The first version of this recorded the boot at this point — before `decideBoot` and before the claim was read —
 * and a real boot caught what reading had not: a launch that immediately learned *"another daemon already serves
 * this machine"* and exited **still counted as a start**, so the very number a supervisor is meant to trust was
 * inflated by every colliding launch (a second window, or `npm run daemon` beside a running app). A restart is a
 * daemon *taking over serving*, so the record belongs where that happens, not where the file is first read.
 */
const restart = await readLifecycle(paths);

say([
  `EnvoyDev daemon — ${facts.headline}`,
  `  home:     ${facts.home}`,
  `  profile:  ${facts.profileDir} (${facts.state})`,
  `  state:    ${paths.stateDir}`,
  ...(restart.bootsInLastHour > 0
    ? [`  restarts: ${restart.bootsInLastHour} earlier start(s) in the last hour`]
    : []),
  ...(restart.lastStop === undefined
    ? restart.lastStartedAt !== undefined
      ? ["  previous: the last daemon did not stop on purpose (no stop record)"]
      : []
    : [
        `  previous: stopped on ${restart.lastStop.signal} at ${restart.lastStop.at}` +
          (restart.lastStop.exitCode !== undefined
            ? ` (exit code ${restart.lastStop.exitCode})`
            : ""),
      ]),
  ...(facts.detail ? [`  ${facts.detail}`] : []),
  ...facts.facts.map((fact) => `  ${fact}`),
]);

const decision = decideBoot(facts);
if (!decision.serve) {
  say([`\n${decision.headline}`, ...decision.detail.map((line) => `  ${line}`)]);
  // A refused boot is a *deliberate* exit with a documented code, so it is recorded as a stop — with the code, so
  // the next boot can say which refusal this was instead of reporting a crash that never happened.
  await recordStop(paths, { signal: "refused", exitCode: decision.exitCode }).catch(() => undefined);
  process.exit(decision.exitCode);
}
say(decision.notes.map((note) => `  ${note}`));

// Step 2 — one daemon per home. The claim is read, not the port probed; `lock.ts` explains why.
const existing = await readDaemonClaim(paths);
if (existing.state === "running") {
  const outcome = alreadyRunningOutcome(existing.descriptor);
  say([`\n${outcome.headline}`, ...outcome.detail.map((line) => `  ${line}`)]);
  process.exit(outcome.exitCode);
}
if (existing.state === "stale") {
  say([`  note:     a claim from pid ${existing.descriptor.pid} was left behind; that process is gone.`]);
}
if (existing.state === "unreadable") {
  say([`  note:     ${paths.daemonFile} could not be read (${existing.reason}); it will be replaced.`]);
}

/**
 * The heartbeat a supervisor can read: a file under `logs/` whose **age** is the signal, refreshed on a timer.
 *
 * Started before serving so the messages can be sent in the protocol's order; its timer is `unref`'d, because a
 * heartbeat is evidence of work rather than a reason to keep running.
 */
const heartbeat = startHeartbeat(paths);

// Step 3 — start. **This is the moment a restart becomes real**, so the ledger records it here: everything above
// can still decide this process is not needed, and a start that never serves is not a restart. A failure *after*
// this point is counted, deliberately — that is a boot that may be looping.
await recordBoot(paths);

let daemon: StartedCoderDaemon;
try {
  /**
   * `warm: true` — **the one place the background pass is turned on.**
   *
   * This is the production entry point, and the deep facts about the agents this machine can run (what each
   * publishes, whether it wants a sign-in) arrive on the Agents page as properties with a time. Nothing else
   * asks for them: `coder.probeSessionOptions` needs a press and a run needs a task, so without this pass a
   * user's first sight of those facts would be the moment they went looking for them. `deep-warm.ts` carries
   * the four bounds; the one that matters at this call site is that a pass never starts anything which would
   * have to be **downloaded** first.
   *
   * Every other caller deliberately leaves it out — the test suite, and `scripts/smoke.ts`, which starts a
   * real daemon on a developer's machine. A suite that spawns somebody's coding agents on every run is a suite
   * that makes a machine unusable, and this slice's own headline property is that *loading the agents page
   * spawns nothing*, which a warming daemon would quietly falsify.
   */
  daemon = await startCoderDaemon({
    port,
    paths,
    version: VERSION,
    warm: warmAgents(process.env),
    managedBy: managedByFrom(process.argv),
    // The wire's way into the same stop the signals use: `coder.shutdown`, answered before the drain begins.
    onShutdown: () => void shutdown("requested over the connection"),
  });
} catch (error) {
  const outcome = serveFailureOutcome(port, error);
  say([`\n${outcome.headline}`, ...outcome.detail.map((line) => `  ${line}`)]);
  // Same reasoning as a refused boot: a failure this process *understood* leaves its code on the record.
  await recordStop(paths, { signal: "failed to serve", exitCode: outcome.exitCode }).catch(
    () => undefined,
  );
  process.exit(outcome.exitCode);
}

const mesh = daemon.mesh();
// `READY=1` only once the socket is listening: a supervisor with `Type=notify` waits for exactly this.
heartbeat?.ready();
say([
  `  projects: ${daemon.store.projects().length}`,
  `  tasks:    ${daemon.store.tasks().length}`,
  "  mesh:     " +
    (mesh.kind === "attached"
      ? `attached as ${mesh.scopeKey}`
      : mesh.kind === "hosting"
        ? // We are the node: name the peer, and count what a phone would dial. The addresses are the
          // honest reason this line exists — "hosting" alone does not say whether anyone can reach us.
          `hosting as ${mesh.peerId} — ${mesh.multiaddrs.length} address(es), ${mesh.relayHints.length} relay hint(s)`
        : mesh.kind === "refused"
          ? `refused (${mesh.code}) — ${mesh.reason}`
          : `not attached — ${mesh.reason}`),
  "",
  `  serving:  ws://127.0.0.1:${daemon.port}${daemon.path}`,
  `  claim:    ${paths.daemonFile}`,
  "  windows connect without a token (loopback is trusted, as in the rest of the family);",
  "  remote clients present a pairing token (Settings → This machine → Pair a phone).",
  "  stop with Ctrl+C.",
]);

/**
 * **The one graceful stop**, whichever way somebody asks for it.
 *
 * Three ways in, one implementation: a signal (`SIGINT` from a terminal, `SIGTERM` from launchd or systemd), a
 * client's `coder.shutdown` over the socket, and — through the service switch — a supervisor's restart. Windows has
 * no signal an unrelated process can send, which is why the wire path exists at all (`shutdown.ts`), and the
 * service CLI's restart relies on it too.
 *
 * The order is the part worth keeping: **stop is recorded before the process stops**, so the reason survives a
 * drain that runs long; and `daemon.stop()` is where live runs are asked to stop and given up to ten seconds
 * (`runs.stopAll`), so a restart does not cut an agent's turn in half without a trace. A `SIGKILL` never gets here,
 * and that is exactly why the *absence* of this record means "it died" rather than "unknown".
 */
let stopping = false;
function shutdown(reason: string): Promise<void> {
  // Idempotent: a second signal, or a window asking at the same moment, must not start a second drain. The promise
  // never settles, which is right — the process is on its way out and nothing after this should run.
  if (stopping) return new Promise<void>(() => undefined);
  stopping = true;
  say(["\nstopping the daemon; live runs are asked to stop and given up to ten seconds"]);
  // Told before the stop, so the unit's state shows a deliberate shutdown rather than a process that vanished.
  heartbeat.stopping();
  heartbeat.stop();
  return recordStop(paths, { signal: reason })
    .catch(() => undefined)
    .then(() => daemon.stop().catch(() => undefined))
    .finally(() => process.exit(EXIT_OK));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}
