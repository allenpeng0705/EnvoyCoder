/**
 * The daemon's version, in **one** place in source — and kept equal to the product `VERSION`
 * file by `npm run version:desktop` (`scripts/sync-desktop-version.mjs`).
 *
 * It ends up in three places that must agree: the boot report, `coder.hello` (a client refuses a
 * daemon that is older than it knows), and the payload directory (`runtime/<version>/`, which is
 * what a service unit names). A mismatch between the last two is the worst kind: the supervisor
 * would run a version nobody asked for.
 *
 * Do not edit this string by hand for a release — bump `VERSION` (or `npm run version:desktop -- x.y.z`).
 */
export const DAEMON_VERSION = "0.2.0";
