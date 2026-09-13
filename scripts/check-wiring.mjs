/**
 * Wiring: every local package must be declared everywhere it is used (guide §4.1).
 *
 * ## Why this gate exists here, and which rules apply
 *
 * The guide lists **seven** places a new package must be declared, and warns that missing one
 * produces a *misleading* failure — `TS6059` on unrelated files, a package that resolves only
 * because npm hoists, source resolution that silently falls back to built output, or a package one
 * manager cannot see. EnvoyCoder is a separate repo with its own layout, so two of the seven do not
 * apply, and the rest are checked here rather than in EnvoyMesh's tree:
 *
 * | Guide | Applies here? | How |
 * |---|---|---|
 * | 1. root `workspaces` | yes | R1 |
 * | 2. the package's own manifest | yes | R2 |
 * | 3. **each consumer's** `dependencies` | yes | R3 |
 * | 4. **each consumer's** `tsconfig` `references` | yes | R4 |
 * | 5. root `tsconfig` `references` | yes | R7 |
 * | 5b. `tsconfig.base.json` `paths` | **no, deliberately** | see below |
 * | 6. `vitest.config.ts` alias | yes | R6 |
 * | 7. `pnpm-workspace.yaml` | **not used** | reported, not skipped silently |
 *
 * **Why `paths` is absent.** Mapping `@envoycoder/*` to another package's *source* cannot be
 * combined with `composite`/`rootDir` — TypeScript rejects it with `TS6059`/`TS6307` ("not under
 * rootDir"), which is exactly the confusing failure the guide describes. EnvoyCoder instead lets
 * npm workspace links resolve the package names, with project references doing the ordering, and
 * keeps source resolution where it belongs: the vitest aliases (R6), which are checked.
 *
 * Usage: `node scripts/check-wiring.mjs`
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const failures = [];
const notes = [];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function exists(file) {
  return existsSync(file);
}

/** Every workspace package: `<dir>/package.json` with a name. */
function workspacePackages() {
  const found = new Map();
  for (const top of ["packages", "apps"]) {
    const dir = path.join(root, top);
    if (!exists(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(dir, entry.name, "package.json");
      if (!exists(manifestPath)) continue;
      const manifest = readJson(manifestPath);
      if (!manifest.name) continue;
      found.set(manifest.name, { name: manifest.name, dir: path.join(dir, entry.name), manifest });
    }
  }
  return found;
}

const packages = workspacePackages();
const localNames = [...packages.keys()];

/** Apps are terminals, not libraries: nothing imports them, so library rules do not apply. */
function isApp(dir) {
  return path.relative(root, dir).startsWith(`apps${path.sep}`);
}

// ── R1: the root manifest lists every workspace ───────────────────────────────────────────────
const rootManifest = readJson(path.join(root, "package.json"));
const workspaces = new Set(rootManifest.workspaces ?? []);
for (const { name, dir } of packages.values()) {
  const relative = path.relative(root, dir).split(path.sep).join("/");
  const covered = [...workspaces].some((pattern) => {
    if (pattern === relative) return true;
    if (pattern.endsWith("/*")) return relative.startsWith(`${pattern.slice(0, -1)}`);
    return false;
  });
  if (!covered) {
    failures.push(
      `R1 ${name}: ${relative} is a package but no root \`workspaces\` pattern covers it — ` +
        "npm would not install it, and imports of it would fail only for people who never ran a build.",
    );
  }
}

// ── R2: each package declares what consumers need ─────────────────────────────────────────────
for (const { name, manifest, dir } of packages.values()) {
  if (isApp(dir)) continue;
  if (!manifest.main && !manifest.exports) {
    failures.push(`R2 ${name}: no \`main\` and no \`exports\` — consumers resolve nothing.`);
  }
  if (!exists(path.join(dir, "tsconfig.json"))) {
    failures.push(`R2 ${name}: no tsconfig.json — it cannot be referenced as a project.`);
  }
}

/** Import specifiers a package's sources actually use. */
function importedPackages(dir) {
  const imports = new Set();
  const specifier = /(?:from|import)\s+["']([^"']+)["']/g;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (["node_modules", "dist", "dist-types", "target"].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = readFileSync(full, "utf8");
      let match;
      while ((match = specifier.exec(source))) {
        const spec = match[1];
        if (!spec.startsWith("@envoycoder/") && !spec.startsWith("@envoymesh/")) continue;
        const name = spec.startsWith("@envoymesh/")
          ? spec.split("/").slice(0, 2).join("/")
          : spec;
        // The raw specifier travels with it: whether it was `@envoymesh/api` or
        // `@envoymesh/api/core` is the difference rule 4.2 is about.
        imports.add(`${name}\u0000${spec}\u0000${path.relative(root, full)}`);
      }
    }
  };
  if (exists(path.join(dir, "src"))) walk(path.join(dir, "src"));
  return [...imports].map((entry) => {
    const [name, spec, file] = entry.split("\u0000");
    return { name, spec, file };
  });
}

// ── R3 + R4: consumers declare and reference what they import ─────────────────────────────────
for (const { name, manifest, dir } of packages.values()) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  const tsconfigPath = path.join(dir, "tsconfig.json");
  const references = exists(tsconfigPath)
    ? (readJson(tsconfigPath).references ?? []).map((ref) => path.resolve(dir, ref.path))
    : [];

  // One message per (package, file) pair, not per import site.
  const seen = new Set();
  for (const { name: imported, spec, file } of importedPackages(dir)) {
    // Mesh packages are `file:` links to the sibling checkout; they are not project references.
    const isLocal = localNames.includes(imported);
    const key = imported;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!declared.has(imported)) {
      failures.push(
        `R3 ${name}: ${file} imports ${imported}, but ${path.relative(root, path.join(dir, "package.json"))} ` +
          "does not declare it. It would resolve only by hoisting, or fail on a clean install.",
      );
    }
    if (isLocal && !references.includes(packages.get(imported).dir)) {
      failures.push(
        `R4 ${name}: imports ${imported} but its tsconfig.json has no \`references\` entry for it — ` +
          "the TS6307/TS6059 class the guide warns about.",
      );
    }
    // §4.2: the bare api barrel reaches product-bound modules.
    // §4.2, decided on the raw specifier: `/core` is the point, the bare barrel is the mistake.
    if (imported === "@envoymesh/api" && spec === "@envoymesh/api") {
      failures.push(
        `R3 ${name}: ${file} imports "@envoymesh/api" — import "@envoymesh/api/core" instead ` +
          "(guide §4.2: the root barrel reaches product-bound modules).",
      );
    }
  }
}

// ── R6: vitest resolves local packages to source ──────────────────────────────────────────────
const vitestPath = path.join(root, "vitest.config.ts");
if (!exists(vitestPath)) {
  failures.push("R6: no vitest.config.ts.");
} else {
  const vitest = readFileSync(vitestPath, "utf8");
  for (const name of localNames) {
    const dir = packages.get(name).dir;
    if (isApp(dir)) continue;
    if (!vitest.includes(`"${name}"`)) {
      failures.push(
        `R6 vitest.config.ts: no alias for ${name} — tests would resolve built output while the ` +
          "run path resolves source, which is how a suite stays green while the app cannot start.",
      );
    }
  }
}

// ── R7: the root project references every local package ───────────────────────────────────────
const rootTsconfig = readJson(path.join(root, "tsconfig.json"));
const rootRefs = (rootTsconfig.references ?? []).map((ref) => path.resolve(root, ref.path));
for (const { name, dir } of packages.values()) {
  // The desktop app is built by its own tsconfig and Vite; it is not part of the composite graph.
  if (isApp(dir)) continue;
  if (!rootRefs.includes(dir)) {
    failures.push(`R7 root tsconfig.json: no reference to ${name} — \`tsc -b\` would not build it.`);
  }
}

// ── rule 7, reported rather than silently skipped ─────────────────────────────────────────────
if (!exists(path.join(root, "pnpm-workspace.yaml"))) {
  notes.push(
    "pnpm workspace: not used in this repo (no pnpm consumers), so guide rule 7 does not apply — " +
      "npm workspaces are the single source of truth here.",
  );
}

for (const note of notes) console.log(`note: ${note}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`[fail] ${failure}`);
  console.error(
    `\n${failures.length} wiring problem(s). A package must be declared in every place that ` +
      "resolves it; see docs/envoymesh-integration.md §6.",
  );
  process.exit(1);
}
console.log(
  `wiring OK — ${packages.size} workspace package(s): R1 workspaces, R2 manifests, R3 dependencies, ` +
    "R4 project references, R6 vitest aliases, R7 root references all clean",
);
