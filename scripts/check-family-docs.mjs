/**
 * Verify the copies in `docs/family/` against what they claim to be.
 *
 * Two questions, deliberately with different answers (the reasoning is in `lib/family-docs.mjs`):
 *
 *   1. **Is each copy the file it says it is?** — its body must hash to the `body-sha256` in its own
 *      header. A mismatch means somebody edited a mirror, and that always fails.
 *   2. **Has the source moved since?** — when the sibling checkout is available, EnvoyMesh's file is
 *      hashed the same way. Drift is reported as a note and exits 0, because another repo's document
 *      being edited is not a reason for this repo's build to stop. `--strict` makes it a failure, for
 *      the moment a release is cut.
 *
 * Usage:
 *   node scripts/check-family-docs.mjs
 *   node scripts/check-family-docs.mjs --strict   # drift is a failure (pre-release)
 */

import { readdirSync } from "node:fs";

import {
  FAMILY_DOCS,
  familyDocsDir,
  hashBody,
  meshSibling,
  parseCopy,
  readCopy,
  readSource,
} from "./lib/family-docs.mjs";

const strict = process.argv.includes("--strict");
const problems = [];
const notes = [];
let verified = 0;
let moved = 0;

for (const doc of FAMILY_DOCS) {
  const { file, text } = readCopy(doc);

  if (text === null) {
    problems.push(
      `${doc.name} is not in docs/family/.\n` +
        `    fix: node scripts/sync-family-docs.mjs`,
    );
    continue;
  }

  const parsed = parseCopy(text);
  if (!parsed) {
    problems.push(
      `docs/family/${doc.name} has no provenance header, so nothing about it can be checked.\n` +
        `    fix: node scripts/sync-family-docs.mjs   (a copy is generated, never hand-written)`,
    );
    continue;
  }

  const recorded = parsed.fields.get("body-sha256");
  const actual = hashBody(parsed.body);
  if (recorded !== actual) {
    problems.push(
      `docs/family/${doc.name} was edited in place — it no longer matches the content it was copied\n` +
        `    from.\n` +
        `    recorded: ${recorded ?? "(missing)"}\n` +
        `    actual:   ${actual}\n` +
        `    what to do: if the wording is wrong, fix it in EnvoyMesh and run\n` +
        `                node scripts/sync-family-docs.mjs (family guide §7.4). Editing the copy\n` +
        `                here changes this file and nothing else.`,
    );
    continue;
  }

  verified += 1;

  const source = readSource(doc);
  if (source === null) {
    notes.push(
      `could not compare docs/family/${doc.name} with its source: EnvoyMesh is not checked out at\n` +
        `    ${meshSibling}. The copy itself is intact (its body matches its header).`,
    );
    continue;
  }

  if (hashBody(source) !== recorded) {
    moved += 1;
    const message =
      `the source of docs/family/${doc.name} has moved — EnvoyMesh's copy is newer than the copy\n` +
      `    here (copied from ${parsed.fields.get("source-head") ?? "unknown"}, on ` +
      `${parsed.fields.get("copied") ?? "an unrecorded date"}).\n` +
      `    refresh: node scripts/sync-family-docs.mjs`;
    if (strict) problems.push(message);
    else notes.push(message);
  }
}

// A file in the folder that no rule knows about is either a copy somebody added by hand — which will
// never be refreshed and never checked — or one that should have been declared in FAMILY_DOCS.
const known = new Set([...FAMILY_DOCS.map((doc) => doc.name), "README.md"]);
const stray = readdirSync(familyDocsDir).filter((name) => name.endsWith(".md") && !known.has(name));
for (const name of stray) {
  problems.push(
    `docs/family/${name} is not in the list in scripts/lib/family-docs.mjs, so no one refreshes or\n` +
      `    checks it. Either declare it there, or keep it in docs/ if it is a document of ours.`,
  );
}

if (problems.length > 0) {
  console.error("\nThe copies in docs/family/ are not trustworthy:\n");
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}

const where = FAMILY_DOCS.length === verified ? `${verified}` : `${verified}/${FAMILY_DOCS.length}`;
console.log(
  `family docs OK (${where} cop${verified === 1 ? "y" : "ies"} match their recorded content; ` +
    `${moved} source(s) moved${strict ? " — strict, so that fails" : ""})`,
);
for (const note of notes) console.log(`note: ${note}`);
