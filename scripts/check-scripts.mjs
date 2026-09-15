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
import { readdirSync, readFileSync, statSync } from "node:fs";
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
    continue;
  }
  // Parsing is not enough for the page scripts: see `strayBacktick`.
  const problems = strayBacktick(readFileSync(file, "utf8"));
  if (problems.length > 0) {
    failures.push({ file: path.relative(root, file), output: problems.join("\n") });
  }
}

/**
 * **A page script may not contain a stray backtick, and this is the rule that catches it.**
 *
 * `evaluate(\`…\`)` passes a *template literal*, and a backtick inside the script — in a comment, usually, as
 * `` `<select>` `` — ends the template early. What follows is then ordinary script text, and whether that parses is
 * luck: the failure appears at *runtime*, as a `ReferenceError` from a name the page never had, when the tool is
 * next run. This happened three times in one afternoon (`audit-ui.mjs` was shipped in that state).
 *
 * The check is the shape of the call: after the first closing backtick that follows `evaluate(`, the next
 * non-space character has to be `)`. A template that ended early leaves something else there — the remains of the
 * page script — which is exactly what is reported.
 */
function strayBacktick(text) {
  const problems = [];
  // Only the calls whose argument *is* a template: `evaluate(JSON.stringify(...))` is not one of these.
  const opener = /evaluate\(\s*`/g;
  let match;
  while ((match = opener.exec(text)) !== null) {
    const start = match.index + match[0].length;
    // **The first *unescaped* backtick.** `\`` inside the page script is an escape sequence and does not end the
    // template (three of these files legitimately write one), so a plain `indexOf` reports them as failures —
    // which is how this rule first announced three tools that are all perfectly fine.
    let end = start;
    while (end < text.length) {
      if (text[end] === "\\") {
        end += 2;
        continue;
      }
      if (text[end] === "`") break;
      end += 1;
    }
    if (end >= text.length) {
      problems.push("evaluate( template is never closed");
      break;
    }
    const after = text.slice(end + 1).match(/\S/);
    // `)` or `,` — a trailing comma or a second argument are both ordinary calls.
    if (after?.[0] !== ")" && after?.[0] !== ",") {
      const line = text.slice(0, start).split("\n").length;
      problems.push(
        `the template opened near line ${String(line)} ends at line ${String(
          text.slice(0, end).split("\n").length,
        )} and the next character is ${JSON.stringify(after?.[0] ?? "")} rather than ")" — a stray backtick inside the page script`,
      );
    }
    opener.lastIndex = end + 1;
  }
  return problems;
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
