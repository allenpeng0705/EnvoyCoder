/**
 * Strip Team-job keys from base locale catalogues (they live in teams.<locale>.ts).
 * Keeps `...teams` spread.
 *
 *   node scripts/strip-team-dupes.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const messages = join(root, "apps/desktop/src/i18n/messages");
const en = JSON.parse(readFileSync(join(root, "scripts/team-i18n/en.json"), "utf8"));
const teamKeys = new Set(Object.keys(en));

const LOCALES = ["zh", "de", "fr", "it", "ja", "ko"];

for (const locale of LOCALES) {
  const file = join(messages, `${locale}.ts`);
  let text = readFileSync(file, "utf8");
  let removed = 0;
  for (const key of teamKeys) {
    // Match a catalogue entry: "key": "value",  (value may span with \n escapes only — our files are single-line)
    // Also handle multi-line values that continue until the next unescaped closing quote + comma
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `\\n  "${escaped}": (?:(?:"(?:\\\\.|[^"\\\\])*")|(?:\\n    "[^"]*")+)\\s*,?`,
      "g",
    );
    const next = text.replace(re, () => {
      removed += 1;
      return "";
    });
    if (next !== text) text = next;
  }
  // Clean double blank lines
  text = text.replace(/\n{3,}/g, "\n\n");
  if (!text.includes("...teams")) {
    throw new Error(`${locale}: lost ...teams spread`);
  }
  writeFileSync(file, text);
  console.log(`${locale}: removed ${removed} duplicate keys`);
}
