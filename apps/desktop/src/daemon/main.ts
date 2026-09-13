/**
 * The daemon — EnvoyCoder's own host process.
 *
 * Every window, and the phone, talks to this process; it is the thing that survives the last window
 * being closed (`docs/envoycoder-networking.md`). It is started by the desktop app, or by hand:
 *
 * ```bash
 * npm run daemon                    # port 4770
 * ENVOYCODER_DAEMON_PORT=0 npm run daemon   # let the OS choose
 * ```
 *
 * ## What it does, in order, and why that order
 *
 *   1. **Read the shared home.** `coderPaths()` resolves it the family's way, so `ENVOYMESH_HOME` and
 *      the per-OS default behave as they do for every other app in the group.
 *   2. **Report what is there** — in the family's words, from the family's own discovery. A damaged
 *      profile stops the process with exit 4 (see `boot.ts` for the codes, and which two are not ours
 *      to use).
 *   3. **Attach to the mesh as a product**, if a node is running. A refusal is a *state to report*, not
 *      an error: the owner may simply not have granted this product the `coding` capability yet.
 *   4. **Serve our own surface** on the port, with `coderSessionIdentity()`.
 *
 * ## The one thing that is deliberately unfinished
 *
 * **Remote callers cannot authenticate yet.** A loopback window is trusted, exactly as the family
 * treats its own desktop UI, but a phone or another machine needs a token and there is no session
 * store to resolve one against (roadmap M1). So the resolver answers `null` and the transport refuses
 * them, which is the fail-closed behaviour the family's §8 asks for. It is stated here, printed at
 * boot, and left visible rather than papered over with a token format of our own invention.
 */

import process from "node:process";

import { DEFAULT_DAEMON_PATH, DEFAULT_DAEMON_PORT, ENVOYCODER_DAEMON_PORT_ENV } from "@envoycoder/protocol";
import {
  attachToMeshNode,
  coderSessionIdentity,
  createCoderDaemonHost,
  createCoderDispatcher,
  inspectCoderHome,
} from "@envoycoder/host-bridge";

import { decideBoot, serveFailureOutcome } from "./boot.js";

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
const facts = await inspectCoderHome();

say([
  `EnvoyCoder daemon — ${facts.headline}`,
  `  home:     ${facts.home}`,
  `  profile:  ${facts.profileDir} (${facts.state})`,
  ...(facts.detail ? [`  ${facts.detail}`] : []),
  ...facts.facts.map((fact) => `  ${fact}`),
]);

const decision = decideBoot(facts);
if (!decision.serve) {
  say([`\n${decision.headline}`, ...decision.detail.map((line) => `  ${line}`)]);
  process.exit(decision.exitCode);
}

say(decision.notes.map((note) => `  ${note}`));

// The mesh is optional, and its answer is information either way — "not granted yet" is the state the
// family's §4.7 expects a product to report rather than retry.
const attach = await attachToMeshNode(facts.home);
say([
  "  mesh:     " +
    (attach.kind === "attached"
      ? `attached as ${attach.scopeKey}`
      : attach.kind === "refused"
        ? `refused (${attach.code}) — ${attach.reason}`
        : `not attached — ${attach.reason}`),
]);

const host = createCoderDaemonHost({
  port,
  path: DEFAULT_DAEMON_PATH,
  sessionIdentity: coderSessionIdentity(),
  dispatch: createCoderDispatcher(),
});

try {
  await host.serve();
} catch (error) {
  const outcome = serveFailureOutcome(port, error);
  say([`\n${outcome.headline}`, ...outcome.detail.map((line) => `  ${line}`)]);
  process.exit(outcome.exitCode);
}

say([
  "",
  `  serving:  ws://127.0.0.1:${host.port}${host.path}`,
  "  windows connect without a token (loopback is trusted, as in the rest of the family);",
  "  remote clients are refused until EnvoyCoder has a session store (roadmap M1).",
  "  stop with Ctrl+C.",
]);

/**
 * Shut down in a way the last window never notices: closing a window must not kill a running agent.
 *
 * `SIGINT` is the one that exists everywhere, including Windows consoles; `SIGTERM` is what a service
 * manager sends on the other two platforms. Neither has a Windows equivalent for an unrelated process
 * to send, which is why the family's platform layer owns process-tree termination rather than this.
 */
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    say(["\nstopping the daemon"]);
    host.stop();
    process.exit(0);
  });
}
