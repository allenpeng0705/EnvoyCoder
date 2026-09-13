/**
 * Upgrade the EnvoyMesh packages EnvoyCoder links.
 *
 * This is the executable form of `docs/upgrading.md` §2 — the procedure is written out there, and this
 * script is what runs it, so nobody has to remember the order. Read that section if a step fails.
 *
 * ## Two guards, and why they are refusals rather than warnings
 *
 * **A dirty sibling is a refusal.** `node_modules/@envoymesh/*` are symlinks (§1 of the integration
 * doc), so this repo runs whatever is in that working tree — including work somebody has not
 * committed. Pulling on top of that either loses their work or merges it into a state neither of you
 * chose. The script names the dirty files and stops; `--allow-dirty` is the explicit way to say "those
 * are mine, I know".
 *
 * **The order matters: pull, then their build, then ours.** We import EnvoyMesh's *built* `dist/`, not
 * its TypeScript. A pull without their rebuild leaves this repo resolving today's sources against
 * yesterday's compiled output — the failure `npm run peers:check` warns about, and the reason a green
 * suite can be lying.
 *
 * ## Usage
 *
 *   node scripts/upgrade-mesh.mjs                 # pull, install both, rebuild theirs, then stop
 *   node scripts/upgrade-mesh.mjs --verify        # …and run `gates` + `smoke` at the end
 *   node scripts/upgrade-mesh.mjs --dry-run       # print the plan, change nothing
 *   node scripts/upgrade-mesh.mjs --commit <sha>  # upgrade to an exact commit instead of the branch
 *   node scripts/upgrade-mesh.mjs --allow-dirty   # proceed with uncommitted work in the sibling
 *   node scripts/upgrade-mesh.mjs --skip-install  # rebuild only (both installs already done)
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const mesh = path.resolve(root, "..", "EnvoyMesh");

/**
 * The packages this repo links, in the order EnvoyMesh's own references need them.
 *
 * Built in one `tsc -b` invocation rather than one per package: project references make `tsc -b`
 * resolve the order itself, and eight separate builds would rebuild shared dependencies eight times.
 */
const PACKAGES = [
  "protocol",
  "identity",
  "vault",
  "api",
  "node-core",
  "harness",
  "host-connect",
  "reuse-host",
];

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const dryRun = has("--dry-run");
const verify = has("--verify");
const allowDirty = has("--allow-dirty");
const skipInstall = has("--skip-install");
const commit = valueOf("--commit");

const failures = [];

function fail(headline, details) {
  failures.push(headline);
  console.error(`\n✗ ${headline}\n`);
  if (details) for (const line of details) console.error(`    ${line}`);
  console.error("");
  process.exit(1);
}

/** Run a command with its output going straight to the terminal, printing it first. */
function run(command, args, cwd) {
  const shown = `${command} ${args.join(" ")}`;
  console.log(`\n$ ${shown}${cwd === root ? "" : `    (in ${cwd})`}`);
  if (dryRun) return true;
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    fail(`\`${shown}\` failed (exit ${result.status}).`, [
      "Nothing further was run: a half-applied upgrade is worse than none.",
      "See docs/upgrading.md §5 for what each failure means.",
    ]);
  }
  return true;
}

/** Read a command's output, for the facts the messages need. */
function capture(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const short = (sha) => (sha ? sha.slice(0, 8) : "unknown");

/* ────────────────────────────── 1. is there a sibling to upgrade? ────────────────────────────── */

if (!existsSync(mesh)) {
  fail("There is no EnvoyMesh checkout to upgrade.", [
    `expected at:  ${mesh}`,
    `fix:          git clone <EnvoyMesh> ${mesh} && (cd ${mesh} && npm install)`,
    "This repo links the family's packages from there and does not vendor them.",
  ]);
}

const before = capture("git", ["rev-parse", "HEAD"], mesh);
const beforeSubject = capture("git", ["log", "-1", "--pretty=%s"], mesh);

console.log(`EnvoyMesh at ${short(before)} "${beforeSubject ?? ""}"`);

/* ────────────────────────────── 2. the dirty-sibling guard ────────────────────────────── */

const dirty = (capture("git", ["status", "--porcelain"], mesh) ?? "")
  .split("\n")
  .filter((line) => line.trim().length > 0);

if (dirty.length > 0 && !allowDirty) {
  fail(
    `The EnvoyMesh working tree has ${dirty.length} uncommitted change(s), so this upgrade stops here.`,
    [
      ...dirty.slice(0, 12).map((line) => line.trim()),
      ...(dirty.length > 12 ? [`… and ${dirty.length - 12} more`] : []),
      "",
      "Because the linked packages are symlinks, this repo is already running that working tree.",
      "Pulling on top of somebody's unfinished work is how it gets lost or half-merged.",
      "",
      "    commit or stash it there, then run this again:",
      `        git -C ${mesh} status`,
      "    or, if those changes are yours and you want to keep working on them:",
      "        node scripts/upgrade-mesh.mjs --allow-dirty",
    ],
  );
}

if (dirty.length > 0) {
  console.log(
    `\nwarning: proceeding with ${dirty.length} uncommitted change(s) in the sibling (--allow-dirty).\n` +
      "  Whatever you upgrade to will sit on top of them, and a failure below may be theirs rather\n" +
      "  than upstream's.",
  );
}

/* ──────────────── 3. is somebody already building it? (the race this refuses to enter) ──────────────── */

const recentlyBuilt = PACKAGES.map((name) => path.join(mesh, "packages", name, "dist", "tsconfig.tsbuildinfo"))
  .filter((file) => {
    try {
      return Date.now() - statSync(file).mtimeMs < 120_000;
    } catch {
      return false;
    }
  })
  .map((file) => path.relative(mesh, file));

if (recentlyBuilt.length > 0) {
  console.log(
    `\nwarning: ${recentlyBuilt.length} package(s) were built in the last two minutes — another window\n` +
      "  may be building this checkout right now. Two `tsc -b` runs writing the same tsbuildinfo can\n" +
      "  leave a build state neither of them would call correct. Continue only if you are sure it is idle.",
  );
}

/* ────────────────────────────── 4. the upgrade itself ────────────────────────────── */

if (commit) {
  // A pinned upgrade: reproduce a specific state rather than following a branch. This is the form the
  // release procedure uses (§4 of the upgrading doc) — an artifact should be built from a named commit.
  run("git", ["fetch", "--all", "--tags"], mesh);
  run("git", ["checkout", commit], mesh);
} else {
  run("git", ["pull", "--ff-only"], mesh);
}

if (!skipInstall) run("npm", ["install"], mesh);
run("npx", ["tsc", "-b", ...PACKAGES.map((name) => `packages/${name}`)], mesh);
if (!skipInstall) run("npm", ["install"], root);

if (verify) {
  run("npm", ["run", "gates"], root);
  run("npm", ["run", "smoke"], root);
}

/* ────────────────────────────── 5. say what happened ────────────────────────────── */

const after = capture("git", ["rev-parse", "HEAD"], mesh);
const afterSubject = capture("git", ["log", "-1", "--pretty=%s"], mesh);

console.log(`\n${dryRun ? "would upgrade" : "upgraded"}: ${short(before)} → ${short(after)}`);
if (after && after !== before) console.log(`  now: ${afterSubject}`);
if (dryRun) console.log("\n(dry run: nothing above was executed)");
else if (!verify) {
  console.log(
    "\nNext, prove it here — the rebuild only makes the linked code current:\n" +
      "    npm run gates     # types, wiring, docs, tests\n" +
      "    npm run smoke     # a real host, a real node attach, a real LAN refusal\n" +
      "or run this script with --verify next time to do all three in one go.",
  );
}
