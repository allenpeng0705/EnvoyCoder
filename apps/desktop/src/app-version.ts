/**
 * The version this window's own files were built from — a **build constant**, not something the window
 * can ask for.
 *
 * ## Why this is a `define` and not a read
 *
 * The daemon answers `coder.hello` with its own version (`hello.version`), so the daemon half of
 * "which build am I talking to" needs nothing new. The window half cannot be asked: the renderer is a
 * Vite bundle served from disk, it has no process to read a `package.json` from, and the Tauri shell —
 * the only thing that could report it — is a different process that the pane has no call into. So Vite
 * inlines `apps/desktop/package.json`'s version at build time (`vite.config.ts`), and this module is
 * the single place that reads it.
 *
 * ## Why the `typeof` guard, and what it means when it is absent
 *
 * Anything that compiles these modules outside Vite — vitest without the define, a future bundler, a
 * `.mjs` gate — has no value for the identifier, and a bare reference would be a `ReferenceError` in
 * the middle of a settings page. `typeof` on an undeclared identifier is `"undefined"` rather than a
 * throw, so the guard turns "not inlined" into a value this app can *report* instead of crash on:
 * `About` says the window does not carry a version in this build, which is true, and stops one row
 * short of comparing two numbers it does not both have.
 */

/** Injected by `vite.config.ts` (`define`) and by `vitest.config.ts` for the same reason. */
declare const __ENVOYDEV_VERSION__: string | undefined;

/** The window's own build, or `undefined` when nothing inlined one. */
export const APP_VERSION: string | undefined =
  typeof __ENVOYDEV_VERSION__ === "string" ? __ENVOYDEV_VERSION__ : undefined;
