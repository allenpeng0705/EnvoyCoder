/**
 * The family's module-size rule, applied to **this** repository.
 *
 * ## Why this is a thin adapter and not a copy of the checker
 *
 * The rule lives once, in `../EnvoyMesh/scripts/check-module-size.mjs` (the family's script, next to
 * the allowlist it was written for). EnvoyDev must not fork it: two scanners drift, and EnvoyMesh's
 * history shows what that costs — a whole class of bugs in this family came from "the second copy
 * answered the question differently". So this file **delegates**: it hands the family checker our
 * source dirs and an EnvoyDev-owned allowlist, and forwards its output and exit code unchanged.
 * None of the rule (walk, line count, target/hard comparison) is re-implemented here.
 *
 * ## Why the delegation needs an adapter at all
 *
 * Two facts about the family checker force one, and the task was explicit that they must be
 * respected rather than worked around:
 *
 * 1. Its `root` is `path.resolve(<script dir>, "..")` — **EnvoyMesh's** root, not ours. It resolves
 *    `path.resolve(root, dir)`, so absolute dirs are fine, but allowlist keys come out as
 *    `path.relative(EnvoyMeshRoot, file)` — i.e. `../EnvoyCoder/apps/...` for our files. A key
 *    hard-coded that way breaks the moment the two checkouts stop being siblings, so this script
 *    computes it with `path.relative` at run time instead of writing it down.
 * 2. Its allowlist format is a bare JSON **array of strings**, which cannot record *why* each file
 *    is exempt. Our allowlist is `{ entries: [{ path, lines, reason }] }`; this script validates
 *    that every entry carries a non-empty `reason` (an undocumented exception is not an exception,
 *    it is a silenced gate) and emits the string array the checker reads.
 *
 * The checker's integrity properties survive delegation because **it** still performs them: a dead
 * entry (a path that no longer exists) is an error, and an entry whose file is back under the hard
 * cap is a warning. That is deliberate — a path-keyed exception goes silently void after a rename,
 * so it must fail loudly, and this adapter must not be the thing that papers over it.
 *
 * ## What is scanned
 *
 * Every TypeScript source tree EnvoyDev owns. `apps/mobile` is Dart and `apps/desktop/src-tauri` is
 * Rust, so both are out of scope for a `.ts` scanner; tests are out of scope by the family rule
 * (pass the `src` dirs, not `test`). This list is the whole product surface: a new module anywhere
 * in it that crosses the hard cap fails the gate.
 *
 * Usage: `node scripts/check-module-size.mjs` (also `npm run module-size:check`)
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// The rule's home. Resolved as a sibling because that is how the family checks these repos out
// (EnvoyDev's CI clones EnvoyMesh to `../EnvoyMesh`); a missing checker is a hard error below, never
// a silent pass.
const meshRoot = path.resolve(root, "..", "EnvoyMesh");
const checker = path.join(meshRoot, "scripts", "check-module-size.mjs");
const allowlistPath = path.join(here, "module-size-allowlist.json");

// The rule's numbers, from AGENTS.md ("under ~500; past ~800, split it"). Passed explicitly so the
// values this repo gates on are visible here rather than inherited by accident.
const TARGET = 500;
const HARD = 800;

const SOURCE_DIRS = [
  "apps/desktop/src",
  "packages/agent-catalog/src",
  "packages/host-bridge/src",
  "packages/platform/src",
  "packages/protocol/src",
  "packages/task-model/src",
];

if (!existsSync(checker)) {
  console.error(
    `module-size: the family checker is missing at ${checker}.\n` +
      "             EnvoyDev does not vendor it (docs/envoymesh-integration.md) — clone the sibling:\n" +
      "             git clone https://github.com/allenpeng0705/EnvoyMesh.git ../EnvoyMesh",
  );
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(readFileSync(allowlistPath, "utf8"));
} catch (error) {
  console.error(`module-size: cannot read scripts/module-size-allowlist.json — ${error.message}`);
  process.exit(2);
}
if (!Array.isArray(doc?.entries)) {
  console.error('module-size: the allowlist must be `{ "entries": [ ... ] }`.');
  process.exit(2);
}
for (const entry of doc.entries) {
  // Enforced here, not left to review: an entry without a reason is a gate turned off by omission.
  if (typeof entry?.path !== "string" || typeof entry?.reason !== "string" || entry.reason.trim() === "") {
    console.error(
      `module-size: allowlist entry ${JSON.stringify(entry?.path ?? entry)} has no "reason". ` +
        "Record why the file is exempt and that splitting it is outstanding, or drop the entry.",
    );
    process.exit(2);
  }
}

/**
 * **The recorded `lines` is a baseline, and it is compared here.**
 *
 * The family checker takes only the paths (its format is a bare string array), so an exempt file could grow
 * without limit while the number beside its entry — the number a reader trusts as "how big this debt is" —
 * stayed at whatever it was when the gate landed. Growth is a warning rather than a failure because it can be
 * legitimate; what must not happen silently is the record going stale. Update the entry, or split the file.
 */
const grown = [];
for (const entry of doc.entries) {
  if (typeof entry.lines !== "number") continue;
  const absolute = path.resolve(root, entry.path);
  // A dead entry is already an ERROR in the family checker; a missing file here is not a second report.
  if (!existsSync(absolute)) continue;
  const lines = (readFileSync(absolute, "utf8").match(/\n/g) ?? []).length;
  if (lines > entry.lines) {
    grown.push(
      `${entry.path}: recorded ${entry.lines} lines, now ${lines} — update ` +
        "scripts/module-size-allowlist.json (or split it); the exemption is not a licence to grow",
    );
  }
}

// The family checker keys its allowlist by path relative to *its* root. Derive that here so the
// allowlist can stay EnvoyDev-relative and layout-independent.
const meshRelative = (envoyDevRelative) =>
  path.relative(meshRoot, path.resolve(root, envoyDevRelative));

// A temp file, because the checker only reads its allowlist from disk; removed below.
const temp = mkdtempSync(path.join(tmpdir(), "envoydev-module-size-"));
const generated = path.join(temp, "allowlist.json");

// **No `process.exit()` inside the `try`.** `process.exit` tears the process down without unwinding
// the stack, so a `finally { rmSync(...) }` would be skipped and every run — pass or fail — would
// leave a temp directory behind. (First version did exactly that: 10 leaked `envoydev-module-size-*`
// dirs.) The status is recorded and applied after cleanup instead.
let status = 2;
try {
  writeFileSync(generated, JSON.stringify(doc.entries.map((entry) => meshRelative(entry.path))));
  const result = spawnSync(
    process.execPath,
    [
      checker,
      "--target",
      String(TARGET),
      "--hard",
      String(HARD),
      "--allowlist",
      generated,
      ...SOURCE_DIRS.map((dir) => path.resolve(root, dir)),
    ],
    { encoding: "utf8" },
  );

  // The checker's own `[fail]` message tells the reader where to add an exception — and with a
  // generated allowlist that would be a temp path that no longer exists when they read it. Point
  // that one sentence back at the file a human actually edits; everything else is forwarded
  // verbatim, including the `[warn]` lines and the OK summary.
  const tempKey = path.relative(meshRoot, generated);
  const renameHint = (text) =>
    (text ?? "").split(tempKey).join("scripts/module-size-allowlist.json");

  if (result.error) {
    process.stderr.write(`module-size: could not run the family checker — ${result.error.message}\n`);
  } else {
    process.stdout.write(renameHint(result.stdout));
    process.stderr.write(renameHint(result.stderr));
    status = result.status ?? 2;
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
// Printed after the family checker's own lines so the two kinds of warning read as a list, and after cleanup
// so `process.exitCode` below is still the only exit path.
for (const line of grown) process.stderr.write(`[warn] ${line}\n`);
process.exitCode = status;
