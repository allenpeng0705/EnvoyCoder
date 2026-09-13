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

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const meshSibling = path.resolve(root, "..", "EnvoyMesh");
const harnessSibling = path.resolve(root, "..", "envoy-harness");

/**
 * Which EnvoyMesh this checkout is linked against — asked because the answer changes what a green
 * run means.
 *
 * The `file:` dependencies are **symlinks** (npm links a directory, it does not copy it), so the
 * sibling is live: pulling EnvoyMesh changes this repo's dependency *without touching this repo*.
 * That is the arrangement we want while co-developing, and it is why CI logs the commit it tested
 * against rather than leaving "it passed" unattributed.
 */
function meshSiblingState() {
  const git = (...args) =>
    execFileSync("git", ["-C", meshSibling, ...args], { encoding: "utf8" }).trim();
  try {
    return {
      commit: git("rev-parse", "--short", "HEAD"),
      subject: git("log", "-1", "--pretty=%s"),
      dirty: git("status", "--porcelain", "--", "packages").length > 0,
    };
  } catch {
    return null;
  }
}

/**
 * Which linked projects are genuinely out of date — asked of TypeScript itself, not inferred.
 *
 * ## Why this replaced an mtime comparison
 *
 * The first version of this check compared `src/`'s newest mtime against the built entry's, and it was
 * **wrong in the direction that matters**: `tsc -b` is *incremental*, so it does not rewrite an output
 * whose project is already current. A `git pull` (or a `touch`) moves the sources' mtimes, the next
 * build correctly does nothing, and the warning then hangs around forever — unfixable by following its
 * own advice. A gate you cannot satisfy by obeying it is worse than no gate: it trains people to ignore
 * the output.
 *
 * `tsc -b --dry` answers the real question in 0.3 s and distinguishes three states, which a timestamp
 * cannot (verified against TS 6.0.3):
 *
 *   Project '…' is up to date                                              → current
 *   A non-dry build would update timestamps for output of project '…'      → content is current; only
 *                                                                           mtimes moved. NOT stale
 *   A non-dry build would build project '…'                                → genuinely stale: we would
 *                                                                           be running an older build
 *
 * Returns the stale projects' paths, or null when the question cannot be asked (no `tsc` to run).
 */
function staleProjects(projects) {
  if (projects.length === 0) return null;
  try {
    const output = execFileSync("npx", ["tsc", "-b", ...projects, "--dry"], {
      cwd: meshSibling,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"], // npm's own config warnings are not our business
      // `npx` is a shell shim on Windows; the paths handed to it are relative, so no quoting games.
      shell: process.platform === "win32",
    });
    const stale = new Set();
    for (const line of output.split("\n")) {
      const wouldBuild = /A non-dry build would build project '(.+?)'/.exec(line);
      if (wouldBuild) stale.add(path.resolve(wouldBuild[1]));
    }
    return [...stale];
  } catch {
    return null;
  }
}

/**
 * Where a package's runtime entry actually lives, read from its own manifest.
 */
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
/** The linked packages we found, kept for the one build-state question asked after the loop. */
const packages = [];

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
      continue;
    }
    // **The trap this catches.** `node_modules/@envoymesh/*` are symlinks into the sibling, so a
    // `git pull` there changes what this repo resolves *immediately* — while the code we actually
    // import is their **built** `dist/`, which changes only when they rebuild. Between those two
    // moments this repo runs yesterday's compiled family code against today's sources, and every
    // gate here stays green because nothing is missing. It is the same shape as the incident the
    // family guide records (§7.2): sources moved, build did not, and the suite never noticed.
    //
    // Asked once, after the loop, via `staleProjects()`: one `tsc -b --dry` covers all eight projects
    // and gives TypeScript's own verdict rather than ours.
    packages.push({ name, packageDir });
  }
}

// ── 1b. is their build current? (one question, asked once) ─────────────────────────────
const stale = staleProjects(packages.map((entry) => `packages/${entry.name.replace("@envoymesh/", "")}`));

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

/** Which of the three acceptable locations the harness was found in — reported, so "which copy?" has an answer. */
const harnessWhere = existsSync(harnessLinked)
  ? "linked in node_modules"
  : existsSync(harnessLocal)
    ? `our own clone at ${path.relative(root, harnessLocal)}`
    : existsSync(harnessSibling)
      ? `a sibling checkout at ${harnessSibling}`
      : null;

/**
 * The harness's commit, when it is a checkout we can ask.
 *
 * Same reason as the sibling's commit above: all ten of its packages are version `0.0.0`, so a
 * version number identifies nothing — the commit is the only answer to "which harness is this?".
 * `docs/upgrading.md` §3.3 turns this into a pin once something declares the dependency.
 */
function gitState(dir) {
  try {
    return {
      commit: execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
      subject: execFileSync("git", ["-C", dir, "log", "-1", "--pretty=%s"], { encoding: "utf8" }).trim(),
      dirty: execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
    };
  } catch {
    return null;
  }
}

const harnessDir = existsSync(harnessLinked) || existsSync(harnessLocal) ? null : harnessSibling;
const harnessState = harnessDir ? gitState(harnessDir) : null;

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

const sibling = meshSiblingState();
const meshCount = declaredMeshDeps().size;
console.log(
  `mesh dependencies OK (${meshCount} @envoymesh package(s) from ${meshSibling} — ` +
    `symlinked, so the sibling is live at ${sibling ? sibling.commit : "an unknown commit"}` +
    `${sibling?.dirty ? " with uncommitted changes in packages/" : ""}; built)`,
);
if (sibling) console.log(`  linked against: ${sibling.commit} "${sibling.subject}"`);

// A warning, not a failure — a stale build breaks nothing loudly, which is the whole problem — but it
// is TypeScript's own verdict, so it clears the moment the sibling is actually rebuilt.
if (stale && stale.length > 0) {
  console.log(
    `\nwarning: ${stale.length} linked package(s) are out of date in the sibling, so this repo is\n` +
      "  running the *previous* compiled family code. Nothing is missing — which is why no other gate\n" +
      "  would tell you. Rebuild the sibling before trusting a green run:\n",
  );
  for (const project of stale) {
    // Matched by the project's folder name rather than by full path: TypeScript reports *resolved*
    // paths, which differ from ours when the checkout sits behind a symlink (macOS `/tmp`, a linked
    // workspace) — and a warning that cannot name the package is not worth printing.
    const segment = path.basename(path.dirname(project));
    const name = packages.find((entry) => entry.name === `@envoymesh/${segment}`)?.name ?? segment;
    console.log(`    ${name}  (packages/${segment})`);
  }
  console.log(
    `\n    fix: (cd ${meshSibling} && npx tsc -b ${packages
      .map((entry) => `packages/${entry.name.replace("@envoymesh/", "")}`)
      .join(" ")})\n` +
      "    (docs/upgrading.md §2 — or run `npm run upgrade:mesh` to do the whole upgrade)\n",
  );
}
if (harnessWarning) console.log(`note: ${harnessWarning}`);
if (harnessWhere) {
  console.log(
    `harness: found in ${harnessWhere}` +
      (harnessRequired
        ? " (required by a manifest)."
        : " — nothing declares it yet (roadmap item: the built-in agent), and it is never taken\n" +
          "  through EnvoyMesh's link (design D4)."),
  );
  if (harnessState) {
    console.log(
      `  at ${harnessState.commit} "${harnessState.subject}"${harnessState.dirty ? " (with uncommitted changes)" : ""}`,
    );
  }
}
