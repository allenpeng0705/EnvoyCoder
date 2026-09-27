/**
 * Apply scripts/team-i18n/<locale>.json → teams.<locale>.ts and wire into catalogues.
 *
 *   node scripts/apply-team-i18n.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "scripts/team-i18n");
const messages = join(root, "apps/desktop/src/i18n/messages");

const LOCALES = ["zh", "de", "fr", "it", "ja", "ko"];

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function writeFragment(locale, map) {
  const keys = Object.keys(map);
  const body = keys.map((k) => `  "${k}": "${esc(map[k])}",`).join("\n");
  const contents = `/**
 * Team / Job UI sentences for ${locale} (M5).
 *
 * Spread into the base catalogue so Team job keys stay complete. English in
 * en.ts remains the source of truth for keys and wording.
 *
 * Machine translation — unreviewed; see docs/localization.md.
 */

export const teams = {
${body}
} as const;
`;
  writeFileSync(join(messages, `teams.${locale}.ts`), contents);
  console.log(`wrote teams.${locale}.ts (${keys.length} keys)`);
}

function wireLocale(locale) {
  const file = join(messages, `${locale}.ts`);
  let text = readFileSync(file, "utf8");
  const importLine = `import { teams } from "./teams.${locale}.js";\n`;
  if (!text.includes(`./teams.${locale}.js`)) {
    if (/import \{ service \} from "\.\/service\.[^"]+\.js";\n/.test(text)) {
      text = text.replace(
        /(import \{ service \} from "\.\/service\.[^"]+\.js";\n)/,
        `$1${importLine}`,
      );
    } else if (/import \{ git \} from "\.\/git\.[^"]+\.js";\n/.test(text)) {
      text = text.replace(
        /(import \{ git \} from "\.\/git\.[^"]+\.js";\n)/,
        `$1${importLine}`,
      );
    } else {
      text = importLine + text;
    }
  }
  if (!text.includes("...teams")) {
    text = text.replace(/\n\};\s*$/, `\n\n  ...teams,\n};\n`);
  }
  writeFileSync(file, text);
  console.log(`wired ${locale}.ts`);
}

const en = JSON.parse(readFileSync(join(src, "en.json"), "utf8"));
const enKeys = new Set(Object.keys(en));

for (const locale of LOCALES) {
  const map = JSON.parse(readFileSync(join(src, `${locale}.json`), "utf8"));
  const keys = Object.keys(map);
  if (keys.length !== enKeys.size) {
    throw new Error(`${locale}: expected ${enKeys.size} keys, got ${keys.length}`);
  }
  for (const k of enKeys) {
    if (!(k in map)) throw new Error(`${locale}: missing ${k}`);
  }
  // Placeholder parity
  for (const k of enKeys) {
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    if (ph(en[k]) !== ph(map[k])) {
      throw new Error(`${locale}.${k}: placeholders ${ph(map[k])} != ${ph(en[k])}`);
    }
  }
  writeFragment(locale, map);
  wireLocale(locale);
}

console.log("done");
