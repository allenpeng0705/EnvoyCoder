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
 *   4. **Stop cleanly** on `SIGINT`/`SIGTERM`, leaving a running agent alone. Closing the last window
 *      must not kill a task; that is the whole point of a control plane you can walk away from.
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

import process from "node:process";

import { DEFAULT_DAEMON_PORT, ENVOYDEV_DAEMON_PORT_ENV } from "@envoydev/protocol";
import { coderPaths, inspectCoderHome } from "@envoydev/host-bridge";

import { alreadyRunningOutcome, decideBoot, serveFailureOutcome } from "./boot.js";
import { readDaemonClaim } from "./lock.js";
import { recordBoot, recordStop } from "./lifecycle.js";
import { startCoderDaemon } from "./serve.js";

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
const VERSION = "0.1.0";

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
async function installPayloadAndExit(): Promise<never> {
  const { installPayload, pruneVersions, readCurrent } = await import("./payload.js");
  const readCurrentText = readCurrent;
  const paths = coderPaths();
  const harnessFlag = process.argv.indexOf("--harness");
  const installed = await installPayload(paths, {
    version: VERSION,
    node: process.execPath,
    entry: process.argv[1] ?? "main.mjs",
    ...(harnessFlag >= 0 && process.argv[harnessFlag + 1] !== undefined
      ? { harness: process.argv[harnessFlag + 1] as string }
      : {}),
  });
  // The version just installed is `current`, and one previous version is kept for rollback; anything older goes.
  const removed = await pruneVersions(paths, { protect: [] });
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
  process.exit(0);
}

if (process.argv.includes("--install-payload")) await installPayloadAndExit();

const port = readPort();
const paths = coderPaths();
const facts = await inspectCoderHome(paths.home);

/**
 * Record this start **before serving**, so a kill that lands during startup is still counted by the next boot.
 *
 * The number printed is of *previous* starts: this one is not evidence of a restart, and counting it would make
 * every healthy boot claim one. `docs/daemon-lifecycle.md` §5 asks for restarts to be visible — a supervisor
 * brings the daemon back in a second, which is exactly what makes a crash loop look like a slow morning.
 */
const restart = await recordBoot(paths);

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
    : [`  previous: stopped on ${restart.lastStop.signal} at ${restart.lastStop.at}`]),
  ...(facts.detail ? [`  ${facts.detail}`] : []),
  ...facts.facts.map((fact) => `  ${fact}`),
]);

const decision = decideBoot(facts);
if (!decision.serve) {
  say([`\n${decision.headline}`, ...decision.detail.map((line) => `  ${line}`)]);
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

// Step 3 — start.
let daemon;
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
  });
} catch (error) {
  const outcome = serveFailureOutcome(port, error);
  say([`\n${outcome.headline}`, ...outcome.detail.map((line) => `  ${line}`)]);
  process.exit(outcome.exitCode);
}

const mesh = daemon.mesh();
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
 * Shut down without disturbing a running agent.
 *
 * `SIGINT` exists everywhere, including Windows consoles; `SIGTERM` is what a service manager sends
 * on the other two platforms. Neither has a Windows equivalent for an unrelated process to send,
 * which is why terminating a process *tree* belongs to the family's platform layer rather than here.
 */
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    say(["\nstopping the daemon"]);
    // Written before the stop so the reason survives even if the shutdown itself is slow: a SIGKILL cannot
    // reach us at all, which is why the *absence* of this record means "it died" rather than "unknown".
    void recordStop(paths, { signal })
      .catch(() => undefined)
      .then(() => daemon.stop())
      .finally(() => process.exit(0));
  });
}
