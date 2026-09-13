/**
 * The family documents copied into `docs/family/`, and the header that keeps a copy honest.
 *
 * ## Why copies exist at all
 *
 * EnvoyCoder is built to a standard that lives in **another repository** (`EnvoyMesh/docs/`). A
 * developer working here should not have to keep a second checkout open to read the rules they are
 * being held to, so the three documents that govern this product are copied in.
 *
 * ## What that costs, and how it is paid
 *
 * A copy is a snapshot, and a snapshot is a lie the moment its source moves. So every copy carries a
 * header naming its source, the commit it came from and the hash of the body as copied — which makes
 * two different failures distinguishable, and *only one of them a build failure*:
 *
 *   - **Edited in place.** The copy no longer matches the hash recorded in its own header. This is
 *     always wrong: somebody is editing a mirror, and their change will be destroyed by the next
 *     sync. `check-family-docs.mjs` fails.
 *   - **The source moved.** The body still matches what was copied, but EnvoyMesh's file has changed
 *     since. That is normal life in a two-repo family, and it must **not** red-line this repo's CI —
 *     a doc edit in EnvoyMesh is not a reason EnvoyCoder's build stops. The check reports it and
 *     exits 0; `--strict` (meant for a release, not for a PR) turns it into a failure.
 *
 * The authority rule is the one from the family guide (§7.4): **the source wins, and a fix belongs
 * upstream.** Nothing in this repo is allowed to depend on a copy's wording, and nothing here may be
 * "fixed" by editing a copy.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** This repo's root (`scripts/lib/` → up two). */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The sibling checkout the family's packages and documents are linked and copied from. */
export const meshSibling = path.resolve(repoRoot, "..", "EnvoyMesh");

/** Where the copies live. A subfolder, so a copy is never mistaken for a document of our own. */
export const familyDocsDir = path.join(repoRoot, "docs", "family");

/**
 * The copies, in the order a reader should meet them.
 *
 * `why` is not decoration: it is the answer to "why is this file here" that a copy's reader needs,
 * and it is written into the copy's own header so it travels with the file.
 */
export const FAMILY_DOCS = [
  {
    name: "envoymesh-new-app-guide.md",
    title: "Adding an app to the family",
    why:
      "The standard this repo is built to, and the checklist its CI implements (§4.1 wiring, §4.4 the " +
      "shared home, §4.5 attach, §4.6 the dispatcher, §8 definition of done). Read this first: it is " +
      "the only document here that is about *how to build EnvoyCoder*.",
  },
  {
    name: "envoymesh-multi-product-design.md",
    title: "What happens when two products share one machine",
    why:
      "The rules EnvoyCoder must not break: one node owner at a time and everyone else attaches (D2), " +
      "share the local engine and never the cloud (D3), and the harness is a peer each product " +
      "clones rather than something EnvoyMesh distributes (D4). Its measurements (a node costs " +
      "~650 MB) are also the reason this product runs its own host rather than borrowing the social one.",
  },
  {
    name: "envoymesh-refactoring-plan.md",
    title: "EnvoyMesh's own refactor, and the part of it this product consumes",
    why:
      "Background, not product design: EnvoyMesh's plan for splitting its modules into reusable and " +
      "product-bound halves. It is here because the split *is* the interface EnvoyCoder consumes — " +
      "which packages are safe to link, and why `@envoymesh/api/core` exists. EnvoyCoder appears in it " +
      "only as motivation (§1, §11), never as a plan.",
  },
];

/**
 * A hash of the body with line endings normalised.
 *
 * Line endings are normalised **on purpose**: this repo is checked out and tested on Windows, and a
 * `core.autocrlf` setting that rewrites `\n` to `\r\n` on checkout would otherwise make every copy
 * look edited while its content is untouched. Normalising here keeps the check about content, which
 * is the only thing that matters for a document, and it is symmetric: the source is hashed the same
 * way at sync time and at check time.
 */
export function hashBody(text) {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

/** Where a copy's source lives, for the header and for the messages. */
export function sourceRelPath(doc) {
  return `../EnvoyMesh/docs/${doc.name}`;
}

/** The provenance header every copy starts with. Parseable, and rendered as nothing by Markdown. */
export function buildHeader({ doc, sourceCommit, sourceDirty, bodyHash, copiedOn }) {
  return [
    "<!--",
    "  A COPY — kept here so this repo can be read on its own, and NOT the authority.",
    "",
    `  source:      ${sourceRelPath(doc)}`,
    "  source-repo: EnvoyMesh (github.com/allenpeng0705/EnvoyMesh)",
    `  source-head: ${sourceCommit}${sourceDirty ? " + uncommitted changes in that repo" : ""}`,
    `  copied:      ${copiedOn}`,
    `  body-sha256: ${bodyHash}`,
    "",
    `  Why it is here: ${doc.why}`,
    "",
    "  If this copy and its source disagree, the source wins — and the fix belongs in EnvoyMesh, not",
    "  here (family guide §7.4). Editing this file changes nothing except this file: the next",
    "  `npm run docs:sync` overwrites it.",
    "",
    "  Refresh: node scripts/sync-family-docs.mjs",
    "  Verify:  node scripts/check-family-docs.mjs   (add --strict before a release)",
    "-->",
  ].join("\n");
}

/** Split a copied file into its header fields and its body. Returns null when there is no header. */
export function parseCopy(text) {
  const normalised = text.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("<!--")) return null;
  const end = normalised.indexOf("-->");
  if (end < 0) return null;

  const fields = new Map();
  for (const line of normalised.slice(0, end).split("\n")) {
    // Digits are allowed in a key because `body-sha256` has them — the first version of this pattern
    // did not, so every field silently failed to parse and each copy reported as "edited in place".
    const match = /^\s{2}([a-z][a-z0-9-]*):\s*(.*)$/.exec(line);
    if (match) fields.set(match[1], match[2].trim());
  }

  const rest = normalised.slice(end + 3);
  return { fields, body: rest.startsWith("\n\n") ? rest.slice(2) : rest.replace(/^\n/, "") };
}

/** Read a copied file from disk, or null when it is not there. */
export function readCopy(doc) {
  const file = path.join(familyDocsDir, doc.name);
  try {
    return { file, text: readFileSync(file, "utf8") };
  } catch {
    return { file, text: null };
  }
}

/** Read a copy's source from the sibling checkout, or null when that checkout is not available. */
export function readSource(doc) {
  try {
    return readFileSync(path.join(meshSibling, "docs", doc.name), "utf8");
  } catch {
    return null;
  }
}

/**
 * The sibling's current commit, or null when it is not a checkout we can ask.
 *
 * The check uses this to tell two situations apart that look identical in a hash: **a new commit
 * upstream** (something landed; sync when convenient) and **uncommitted edits** (somebody is working in
 * that repo right now; syncing would copy a half-written document into this one). The first is a
 * maintenance note, the second is a reason to wait — and the difference is worth one `git` call.
 */
export function meshHead() {
  try {
    return execFileSync("git", ["-C", meshSibling, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}
