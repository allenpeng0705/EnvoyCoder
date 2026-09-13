/**
 * No build output inside a `src/` tree.
 *
 * ## Why this is a gate and not a preference
 *
 * `tsc` emitting beside the sources is not a style issue. Vite resolves `src/index.js` **before**
 * `src/index.ts`, so a stale emitted copy silently shadows the real source in tests — the suite
 * runs against code nobody is editing. EnvoyMesh hit exactly this (its rule R5), and EnvoyCoder hit
 * it within the hour: a `tsc -b` run left `packages/platform/src/index.js` behind, and three
 * platform tests failed against the old copy while the source was already fixed.
 *
 * There is a second half to it. `tsconfig.tsbuildinfo` is a *claim* that a project is up to date;
 * when it lives outside `outDir`, deleting the build output does not invalidate that claim, so tsc
 * reports "up to date" and emits nothing — a clean-looking no-op build with an empty `dist/`. That
 * is why every package here sets `tsBuildInfoFile` inside its output directory, and why this script
 * fails when it finds one sitting next to the sources.
 *
 * Usage: `node scripts/check-src-clean.mjs`
 */

import { readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const EMITTED = /\.(js|jsx|mjs|cjs|d\.ts)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-types", "target", "build", ".git", "gen"]);

/** Files that legitimately live in a src tree. */
const ALLOWED = new Set(["vite.config.ts", "vitest.config.ts"]);

const offenders = [];
const strayBuildInfo = [];

function walk(dir, inSrc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, inSrc || entry.name === "src");
      continue;
    }
    if (entry.name === "tsconfig.tsbuildinfo") {
      // Legal only inside an output directory, which the skip list already excluded.
      strayBuildInfo.push(path.relative(root, full));
      continue;
    }
    if (!inSrc) continue;
    if (ALLOWED.has(entry.name)) continue;
    if (EMITTED.test(entry.name)) offenders.push(path.relative(root, full));
  }
}

for (const top of ["packages", "apps", "scripts"]) {
  const dir = path.join(root, top);
  try {
    statSync(dir);
  } catch {
    continue;
  }
  walk(dir, false);
}

if (offenders.length > 0 || strayBuildInfo.length > 0) {
  for (const file of offenders) {
    console.error(
      `[fail] ${file}: build output inside a src tree.\n` +
        "      Vite resolves the emitted .js before the .ts, so tests would run against it.",
    );
  }
  for (const file of strayBuildInfo) {
    console.error(
      `[fail] ${file}: a build-info file outside the output directory.\n` +
        "      Deleting dist/ then leaves tsc reporting 'up to date' and emitting nothing.",
    );
  }
  console.error(
    `\n${offenders.length + strayBuildInfo.length} problem(s): keep emitted files in dist/ ` +
      "(and set `tsBuildInfoFile` inside it).",
  );
  process.exit(1);
}

console.log("src trees are clean (no emitted files, no stray build-info)");
