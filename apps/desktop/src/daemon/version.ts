/**
 * The daemon's version, in **one** place.
 *
 * It used to be a literal in `main.ts` and another in `serve.ts`, which is one copy too many for a value that ends
 * up in three places it must agree with: the boot report, `coder.hello` (a client refuses a daemon that is older
 * than it knows), and the payload directory (`runtime/<version>/`, which is what a service unit names). A mismatch
 * between the last two is the worst kind: the supervisor would run a version nobody asked for.
 *
 * Kept in step with `apps/desktop/package.json` by hand, because a process cannot read its own version without
 * reading a file that may not have been packaged — and `scripts/check-daemon-payload.mjs` proves the two agree by
 * installing a payload and starting it.
 */
export const DAEMON_VERSION = "0.1.0";
