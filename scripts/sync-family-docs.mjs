/**
 * Copy the family documents that govern this product into `docs/family/`.
 *
 * Run it when EnvoyMesh's documents change, or to repair a copy that was edited in place. It
 * overwrites the copies wholesale — that is the point: a copy is never edited, only refreshed.
 *
 * Usage:
 *   node scripts/sync-family-docs.mjs            # refresh every copy from the sibling checkout
 *   node scripts/sync-family-docs.mjs --dry-run  # say what would change, write nothing
 *
 * It reads from `../EnvoyMesh`, refuses to invent a source, and records the commit the content came
 * from — including a note when that repo has uncommitted changes, so a copy made from a working tree
 * says so instead of implying a commit it never came from.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import {
  FAMILY_DOCS,
  buildHeader,
  familyDocsDir,
  hashBody,
  meshSibling,
  readCopy,
  readSource,
  sourceRelPath,
} from "./lib/family-docs.mjs";

const dryRun = process.argv.includes("--dry-run");

/** The commit the content came from, plus whether that working tree was clean. */
function sourceCommit(fileName) {
  const git = (...args) => execFileSync("git", ["-C", meshSibling, ...args], { encoding: "utf8" }).trim();
  try {
    const commit = git("rev-parse", "--short", "HEAD");
    // A copy whose content does not match the commit named in its header is worse than no header: it
    // would claim provenance the file cannot have. Say so plainly instead.
    const dirty = git("status", "--porcelain", "--", path.join("docs", fileName)).length > 0;
    return { commit, dirty };
  } catch {
    return { commit: "unknown", dirty: false };
  }
}

mkdirSync(familyDocsDir, { recursive: true });

const copiedOn = new Date().toISOString().slice(0, 10);
const lines = [];

for (const doc of FAMILY_DOCS) {
  const source = readSource(doc);
  if (source === null) {
    console.error(
      `\nCannot copy ${doc.name}: its source is not readable.\n` +
        `    expected at: ${path.join(meshSibling, "docs", doc.name)}\n` +
        `    fix:         clone EnvoyMesh to ${meshSibling} (see docs/envoymesh-integration.md)\n`,
    );
    process.exit(1);
  }

  const bodyHash = hashBody(source);
  const { commit, dirty } = sourceCommit(doc.name);
  const text = `${buildHeader({ doc, sourceCommit: commit, sourceDirty: dirty, bodyHash, copiedOn })}\n\n${source}`;

  const before = readCopy(doc);
  const unchanged = before.text !== null && before.text.replace(/\r\n/g, "\n") === text;
  if (!dryRun) writeFileSync(before.file, text, "utf8");

  lines.push(
    `${unchanged ? "unchanged" : before.text === null ? "added    " : "updated  "}  ` +
      `docs/family/${doc.name}  ←  ${sourceRelPath(doc)} @ ${commit}${dirty ? " (dirty)" : ""}` +
      `  body ${bodyHash.slice(0, 12)}`,
  );
}

console.log(`\nfamily documents ${dryRun ? "that would be refreshed" : "refreshed"} (${FAMILY_DOCS.length}):\n`);
for (const line of lines) console.log(`  ${line}`);
console.log(
  "\nThe source is authoritative: if EnvoyCoder needs a different wording, the change belongs in\n" +
    "EnvoyMesh and comes back here as a refresh (family guide §7.4).\n",
);
