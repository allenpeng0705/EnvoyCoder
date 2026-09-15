/**
 * Every script under `scripts/` parses.
 *
 * ## Why this is a gate and not a habit
 *
 * The instruments in this directory are how this product is checked without eyes: `measure-settings.mjs`
 * measures a rendered page in a real browser, `audit-ui.mjs` measures the chat surface, `sign-in-window.mjs`
 * drives a real sign-in. None of them is type-checked — they are `.mjs`, outside every `tsconfig` — and none of
 * them is imported by a test, so **nothing in this repository parses them**. A syntax error in one is discovered
 * only by the person who happens to run it, and the failure looks like "the tool is unreliable" rather than
 * "the tool cannot start".
 *
 * That is not hypothetical. `audit-ui.mjs` was committed **unable to run at all** — a pair of backticks in a
 * comment inside an `evaluate(\`…\`)` template terminated the template, so the file failed to parse before its
 * first measurement — and it stayed that way until the contrast work in §7.28 needed it. The same mistake was
 * made twice more, in `measure-settings.mjs`, in the same afternoon.
 *
 * `node --check` is the whole check: it parses a module without executing it, so an instrument with a bad
 * argument or a missing daemon still passes here (it is meant to be run by a human) while one that **cannot
 * start** fails the gates. This is the cheapest gate in the repository and it guards the instruments every
 * other claim rests on.
 *
 * Usage: `node scripts/check-scripts.mjs`
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** Every `.mjs` under `scripts/`, at any depth, minus the directories that are not ours. */
function scripts(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...scripts(full));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) found.push(full);
  }
  return found;
}

const files = scripts(path.join(root, "scripts")).sort();
const failures = [];

for (const file of files) {
  try {
    // `--check` parses and exits; nothing in the file runs, so no daemon, no port and no browser is needed.
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    failures.push({ file: path.relative(root, file), output });
  }
}

if (failures.length > 0) {
  console.error("These instruments cannot start, so every claim they make is unsupported:\n");
  for (const failure of failures) {
    console.error(`  ${failure.file}`);
    for (const line of failure.output.split("\n").slice(0, 12)) console.error(`    ${line}`);
    console.error("");
  }
  console.error(
    `${failures.length} of ${files.length} script(s) failed to parse. \`node --check <file>\` reproduces it.\n`,
  );
  process.exit(1);
}

console.log(`scripts parse OK — ${files.length} instrument(s) under scripts/, none of them executed`);
