/**
 * The phone's catalogues must be accounted for: every key is either the window's sentence or its own.
 *
 * `npm run l10n:check`, and part of `npm run gates`. `apps/mobile/test/arb_parity_test.dart` proves the
 * seven ARB files agree with each other; this proves the **provenance records** agree with them, which
 * is a claim nothing else reads and which had already drifted when it was first audited: six entries
 * named keys the refinement had deleted, thirteen live keys appeared in no list at all, and five
 * mappings called themselves "reused verbatim" while carrying a sentence reworded for a phone.
 *
 * ## The four files, and what each one promises
 *
 * | File | Promise |
 * |---|---|
 * | `desktop-reuse.json` | the ARB value is **character-identical** to that key's value in the window |
 * | `desktop-adapted.json` | the sentence came from there and was reworded for a phone — values differ |
 * | `mobile-only-keys.json`, `-2.json` | no counterpart in the window; translated fresh |
 *
 * Two mobile-only files rather than one because they are two translation batches; the split carries no
 * meaning and the check treats them as one set. **Exactly one** file must claim each key: a key in both
 * a reuse map and a mobile-only list is a record that cannot be read, and the reason this is a gate and
 * not a paragraph is that the next person to add a key should find out here rather than in a review.
 *
 * ## Why the window's catalogue is imported rather than parsed
 *
 * `apps/desktop/src/i18n/messages/en.ts` is a module, and the claim is about its *values* — so the check
 * runs under `tsx` and imports it, the same way `i18n-gap.ts` does. A regex over the source would go
 * quietly wrong the first time a value contains an escaped quote, and a check that can be wrong is
 * worse than no check when its whole job is to be trusted.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { en } from "../apps/desktop/src/i18n/messages/en.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const l10nDir = path.join(root, "apps", "mobile", "lib", "l10n");
const toolDir = path.join(root, "apps", "mobile", "tool");

const failures: string[] = [];

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** The message keys of an ARB: everything that is not a `@key` description or `@@locale`. */
function arbKeys(locale: string): string[] {
  const document = readJson<Record<string, unknown>>(path.join(l10nDir, `app_${locale}.arb`));
  return Object.keys(document).filter((key) => !key.startsWith("@"));
}

const mobile = readJson<Record<string, string>>(path.join(l10nDir, "app_en.arb"));
const keys = arbKeys("en");
const reused = readJson<Record<string, string>>(path.join(toolDir, "desktop-reuse.json"));
const adapted = readJson<Record<string, string>>(path.join(toolDir, "desktop-adapted.json"));
const mobileOnly = [
  ...readJson<string[]>(path.join(toolDir, "mobile-only-keys.json")),
  ...readJson<string[]>(path.join(toolDir, "mobile-only-keys-2.json")),
];
const desktop = en as Record<string, string>;

// ── R1: every key is claimed exactly once ────────────────────────────────────────────────────
const claimed = new Map<string, string>();
const claim = (key: string, file: string): void => {
  const previous = claimed.get(key);
  if (previous !== undefined) {
    failures.push(`R1 ${key} is in both ${previous} and ${file} — one key, one provenance.`);
    return;
  }
  claimed.set(key, file);
};
for (const key of Object.keys(reused)) claim(key, "desktop-reuse.json");
for (const key of Object.keys(adapted)) claim(key, "desktop-adapted.json");
for (const key of mobileOnly) claim(key, "a mobile-only list");

// ── R2: nothing is claimed that the ARB does not have ────────────────────────────────────────
for (const [key, file] of claimed) {
  if (!(key in mobile)) {
    failures.push(
      `R2 ${file} lists ${key}, which no ARB has. A record of a deleted key is how the file stops\n` +
        `    being read: remove it, or add the key back to apps/mobile/lib/l10n/app_*.arb.`,
    );
  }
}

// ── R3: nothing the ARB has is unaccounted for ───────────────────────────────────────────────
const unclaimed = keys.filter((key) => !claimed.has(key));
if (unclaimed.length > 0) {
  failures.push(
    `R3 ${unclaimed.length} key(s) appear in no provenance file: ${unclaimed.join(", ")}.\n` +
      `    Map each to its window key in desktop-reuse.json (verbatim) or desktop-adapted.json\n` +
      `    (reworded), or list it in a mobile-only file.`,
  );
}

// ── R4/R5: the window keys exist, and "reused" really is verbatim ─────────────────────────────
for (const [file, map] of [
  ["desktop-reuse.json", reused],
  ["desktop-adapted.json", adapted],
] as const) {
  for (const [key, windowKey] of Object.entries(map)) {
    if (desktop[windowKey] === undefined) {
      failures.push(`R4 ${file}: ${key} points at "${windowKey}", which the window's en catalogue has not.`);
    }
  }
}
for (const [key, windowKey] of Object.entries(reused)) {
  const window = desktop[windowKey];
  if (window === undefined || !(key in mobile)) continue; // R2/R4 already said so
  if (mobile[key] !== window) {
    failures.push(
      `R5 ${key} is listed as reused verbatim, and is not:\n` +
        `    phone:  ${JSON.stringify(mobile[key])}\n` +
        `    window: ${JSON.stringify(window)}   (${windowKey})\n` +
        `    If the phone's wording is deliberate, move it to desktop-adapted.json.`,
    );
  }
}

if (failures.length > 0) {
  console.error("\nThe phone's translation provenance does not add up:\n");
  for (const failure of failures) console.error(`  ${failure}\n`);
  process.exit(1);
}

console.log(
  `l10n provenance OK — ${keys.length} key(s): ${Object.keys(reused).length} reused verbatim from the ` +
    `window, ${Object.keys(adapted).length} reworded for the phone, ${mobileOnly.length} the phone's own.`,
);
