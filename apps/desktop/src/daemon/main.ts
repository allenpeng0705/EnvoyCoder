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
 * ENVOYCODER_DAEMON_PORT=0 npm run daemon   # let the OS choose
 * ```
 *
 * ## The one deliberately unfinished thing
 *
 * **Remote callers cannot authenticate yet.** A loopback window is trusted, as the family treats its
 * own desktop UI, but a phone needs a token and there is no session store to resolve one against
 * (roadmap M4). The resolver answers `null` and the transport refuses, which is the fail-closed
 * behaviour the family's guide §8 asks for. It is printed at boot rather than papered over with a
 * token format of our own invention.
 *
 * ## Language, and why this file has none
 *
 * Everything `say(…)` prints here is a **log line for a headless process**: it is read on a
 * terminal, by whoever started the daemon, before any window exists — and no window ever sees it,
 * because the shell routes this output to a log file. There is no user to ask (the language setting
 * lives in the store this process may be failing to open) and no client to render a key on. `boot.ts`
 * carries the same note for the same reasons. The user-facing half of every one of these situations
 * is in the window's own catalogue — "EnvoyCoder cannot reach its daemon", the connection chip, the
 * mesh status line — which is where the language setting can actually apply.
 *
 * The daemon's *refusals* are a different matter and are all translated: see `messages.ts`.
 */

import process from "node:process";

import { DEFAULT_DAEMON_PORT, ENVOYCODER_DAEMON_PORT_ENV } from "@envoycoder/protocol";
import { coderPaths, inspectCoderHome } from "@envoycoder/host-bridge";

import { alreadyRunningOutcome, decideBoot, serveFailureOutcome } from "./boot.js";
import { readDaemonClaim } from "./lock.js";
import { startCoderDaemon } from "./serve.js";

/** Kept in step with `apps/desktop/package.json`: a process cannot read its own version. */
const VERSION = "0.1.0";

/** The configured port, or the product default. `0` is honoured: the OS then chooses one. */
function readPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[ENVOYCODER_DAEMON_PORT_ENV]?.trim();
  if (!raw) return DEFAULT_DAEMON_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : DEFAULT_DAEMON_PORT;
}

function say(lines: string[]): void {
  for (const line of lines) console.log(line);
}

const port = readPort();
const paths = coderPaths();
const facts = await inspectCoderHome(paths.home);

say([
  `EnvoyCoder daemon — ${facts.headline}`,
  `  home:     ${facts.home}`,
  `  profile:  ${facts.profileDir} (${facts.state})`,
  `  state:    ${paths.stateDir}`,
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
  daemon = await startCoderDaemon({ port, paths, version: VERSION });
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
      : mesh.kind === "refused"
        ? `refused (${mesh.code}) — ${mesh.reason}`
        : `not attached — ${mesh.reason}`),
  "",
  `  serving:  ws://127.0.0.1:${daemon.port}${daemon.path}`,
  `  claim:    ${paths.daemonFile}`,
  "  windows connect without a token (loopback is trusted, as in the rest of the family);",
  "  remote clients are refused until EnvoyCoder has a session store (roadmap M4).",
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
    void daemon.stop().finally(() => process.exit(0));
  });
}
