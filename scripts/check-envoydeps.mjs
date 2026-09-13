/**
 * EnvoyCoder needs the EnvoyMesh family's core packages and its own copy of the harness.
 *
 * ## Why this check exists, and what it is not
 *
 * EnvoyCoder links the mesh surface from a **sibling checkout** (`../EnvoyMesh/packages/*`) and, by
 * the family's rule, its **own** copy of the harness — EnvoyMesh is not a distribution channel for
 * the harness (EnvoyMesh design D4, guide §7.5). A product clones or copies `envoy-harness`
 * itself.
 *
 * That arrangement has one failure mode worth engineering against: when the sibling is missing or
 * unbuilt, the failure arrives as `ERR_MODULE_NOT_FOUND` from four directories deep inside a
 * `file:` path, halfway through something else. This script fails *first*, with the commands that
 * fix it.
 *
 * It also **refuses to check a subset**: if a `file:` dependency points at a package that does not
 * exist, saying "OK" would be worse than saying nothing.
 *
 * Usage: `node scripts/check-envoydeps.mjs` (exit 1 with instructions when something is missing).
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const meshSibling = path.resolve(root, "..", "EnvoyMesh");
const harnessSibling = path.resolve(root, "..", "envoy-harness");

/** Where a package's runtime entry actually lives, read from its own manifest. */
function resolveEntryPoint(packageDir) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
    const dot = manifest.exports?.["."] ?? manifest.exports;
    const candidates = [
      typeof dot === "object" ? dot.import ?? dot.default ?? dot.require : dot,
      manifest.main,
      "./dist/src/index.js",
      "./dist/index.js",
    ].filter((value) => typeof value === "string");
    for (const candidate of candidates) {
      const resolved = path.resolve(packageDir, candidate);
      if (existsSync(resolved)) return resolved;
    }
    return null;
  } catch {
    return null;
  }
}

/** Every `@envoymesh/*` package this repo depends on, read from the manifests themselves. */
function declaredMeshDeps() {
  const found = new Map();
  for (const manifest of [
    "package.json",
    "packages/host-bridge/package.json",
    "apps/desktop/package.json",
  ]) {
    const file = path.join(root, manifest);
    if (!existsSync(file)) continue;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    for (const [name, spec] of Object.entries(parsed.dependencies ?? {})) {
      if (!name.startsWith("@envoymesh/")) continue;
      found.set(name, { spec: String(spec), manifest });
    }
  }
  return found;
}

const problems = [];

// ── 1. the sibling checkout ────────────────────────────────────────────────────────────
if (!existsSync(meshSibling)) {
  problems.push(
    `The EnvoyMesh checkout is missing.\n` +
      `    expected at:  ${meshSibling}\n` +
      `    EnvoyCoder links the family's core packages from there (see docs/envoymesh-integration.md).\n` +
      `    fix:          git clone <EnvoyMesh> ${meshSibling} && (cd ${meshSibling} && npm install)`,
  );
} else {
  for (const [name, info] of declaredMeshDeps()) {
    const packageDir = path.join(meshSibling, "packages", name.replace("@envoymesh/", ""));
    if (!existsSync(packageDir)) {
      problems.push(
        `${name} (required by ${info.manifest}) is not in the sibling checkout.\n` +
          `    expected at:  ${packageDir}`,
      );
      continue;
    }
    // A package that links but has never been built imports a `dist/` that is not there. Resolve
    // the entry from the package's own `exports`/`main` rather than assuming `dist/index.js`: the
    // family emits to `dist/src/…` (its `rootDir` is the package), and a hard-coded path here would
    // report every sibling as unbuilt on a machine where everything works.
    const entry = resolveEntryPoint(packageDir);
    if (!entry) {
      problems.push(
        `${name} is present but not built — nothing the runtime would import exists.\n` +
          `    looked for:   ${name} exports/main (dist/src/index.js, or dist/index.js)\n` +
          `    package:      ${packageDir}\n` +
          `    fix:          (cd ${meshSibling} && npx tsc -b packages/${name.replace("@envoymesh/", "")})`,
      );
    }
  }
}

// ── 2. our own copy of the harness (D4: never EnvoyMesh's link) ────────────────────────
//
// **A warning until something depends on it.** The built-in agent is a roadmap item, and no package
// imports the harness yet — so failing here would block every other check on a prerequisite the tree
// does not use. The moment a manifest declares the dependency, the same condition becomes an error:
// at that point "the harness is missing" is not advice, it is a broken build.
const harnessRequired = [...declaredMeshDeps().keys()].some((name) => name === "@envoymesh/envoy-harness");
const harnessLocal = path.join(root, "vendor", "envoy-harness");
const harnessLinked = path.join(root, "node_modules", "@envoymesh", "envoy-harness");
const harnessPresent =
  existsSync(harnessLocal) || existsSync(harnessLinked) || existsSync(harnessSibling);
if (!harnessPresent && harnessRequired) {
  problems.push(
    `The Envoy Harness — EnvoyCoder's built-in agent — is not present.\n` +
      `    EnvoyMesh does not distribute it (design D4): each product clones or copies it.\n` +
      `    fix:          git clone <envoy-harness> ${harnessLocal}\n` +
      `                  then point this repo's package.json at it (file:./vendor/envoy-harness),\n` +
      `                  or clone it to ${harnessSibling} and link that.\n` +
      `    note:         the built-in agent is one of EnvoyCoder's two native harnesses; without it\n` +
      `                  the app still starts and offers the external agents.`,
  );
}
const harnessWarning =
  !harnessPresent && !harnessRequired
    ? "the Envoy Harness is not present yet (roadmap item; `@envoymesh/envoy-harness` is not a " +
      `dependency of anything). Clone it to ${harnessSibling} when the built-in agent lands.`
    : null;

// ── 3. reported, never silently tolerated ──────────────────────────────────────────────
if (problems.length > 0) {
  console.error("\nEnvoyCoder cannot run: dependencies it does not vendor are missing.\n");
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error(
    "These are prerequisites, not accidents: EnvoyCoder deliberately does not copy the mesh layer\n" +
      "or the harness into itself (see docs/envoymesh-integration.md).\n",
  );
  process.exit(1);
}

const meshCount = declaredMeshDeps().size;
console.log(
  `mesh dependencies OK (${meshCount} @envoymesh package(s) resolvable from ${meshSibling}; built)`,
);
if (harnessWarning) console.log(`note: ${harnessWarning}`);
