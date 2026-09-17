/**
 * Bundle the daemon into one file the Tauri shell can spawn.
 *
 * ## Why a bundle at all
 *
 * The daemon is TypeScript, and the shell is a Rust binary that has to start it. Something has to
 * turn one into the other, and the options are: ship a TypeScript runner and the source (fragile,
 * slow to boot, and a runtime dependency the packaged app would have to carry), interpret it in
 * Rust (a second implementation of the protocol, which is the thing this repo exists to avoid), or
 * **bundle it once, at build time** (this). The shell then spawns `node dist-daemon/main.mjs` and
 * knows nothing about TypeScript.
 *
 * ## Why the dependencies are *not* bundled
 *
 * `packages: "external"` keeps `@envoymesh/*` and `@envoydev/*` as imports, resolved by Node from
 * the checkout at run time. That is deliberately the *development* arrangement, and it is honest
 * about what it is: those packages are siblings on disk (`../EnvoyMesh`, linked by `npm install`),
 * and bundling them here would embed one revision of the mesh into a build whose whole point is that
 * pulling the sibling changes the code we import.
 *
 * Packaging (roadmap M6) is where this changes: a shipped app has no checkout to resolve from, so
 * the bundle there embeds its dependencies, or the app ships a `node_modules` beside the daemon.
 * Saying so here is cheaper than a reader discovering it from a stack trace in a DMG.
 *
 * Usage: `npm run daemon:build` (from the repository root, or `-w @envoydev/desktop`).
 */

import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const outDir = join(appDir, "dist-daemon");
const entry = join(appDir, "src", "daemon", "main.ts");

// A stale bundle is worse than no bundle: the shell would spawn code that no longer matches the
// source, and the symptom is a daemon that starts and behaves like last week's daemon.
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile: join(outDir, "main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  // Matches the app's own build target, and Node 22 is the floor in the root manifest.
  target: "node22",
  sourcemap: true,
  // See the module doc: siblings stay imports so a pulled sibling is what runs.
  packages: "external",
  banner: {
    // `require` is not defined in an ES module, and a dependency deep in the mesh still uses it.
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: "warning",
  metafile: true,
});

if (result.warnings.length > 0) {
  for (const warning of result.warnings) console.warn("daemon bundle:", warning.text);
}

const written = await stat(join(outDir, "main.mjs"));
console.log(
  `daemon bundle: dist-daemon/main.mjs (${(written.size / 1024).toFixed(1)} kB) — the shell spawns this with node`,
);
