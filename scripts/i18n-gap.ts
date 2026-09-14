/**
 * How far each language is from English, and who has read it — printed, so both are visible.
 *
 * `npm run i18n:gap` (needs `tsx`). The gate that *fails* on growth is `apps/desktop/test/i18n.test.ts`;
 * this is the report a translator reads.
 *
 * Two columns, because they answer different questions and only one of them is a number. "179/179" says
 * a language is complete; it says nothing about whether a native speaker has read it, and a complete
 * machine translation looks identical to a reviewed one on screen. `TRANSLATION_REVIEW` in `locales.ts`
 * records the second answer, and this prints it so it cannot be forgotten between releases.
 */

import { CATALOGUES } from "../apps/desktop/src/i18n/catalogues.js";
import {
  LOCALES,
  LOCALE_LABELS,
  SOURCE_LOCALE,
  TRANSLATION_REVIEW,
} from "../apps/desktop/src/i18n/locales.js";
import { en } from "../apps/desktop/src/i18n/messages/en.js";
import { createTranslator } from "../apps/desktop/src/i18n/translate.js";

const total = Object.keys(en).length;
console.log(`\n${LOCALE_LABELS[SOURCE_LOCALE]} is the source: ${total} keys\n`);

for (const locale of LOCALES) {
  if (locale === SOURCE_LOCALE) continue;
  const { missing } = createTranslator(locale, CATALOGUES[locale]);
  const done = total - missing;
  const bar = "█".repeat(Math.round((done / total) * 20)).padEnd(20, "·");
  const review = TRANSLATION_REVIEW[locale];
  const status =
    review.status === "reviewed"
      ? `read by ${review.reviewer}`
      : review.status === "machine"
        ? "machine translation — nobody has read it yet"
        : review.status;
  console.log(
    `  ${LOCALE_LABELS[locale].padEnd(9)} ${bar} ${done}/${total}` +
      `${missing ? `  (${missing} to translate)` : "  complete"}\n` +
      `  ${"".padEnd(9)} ${"".padEnd(20)} ${status}`,
  );
}

const unreviewed = LOCALES.filter(
  (locale) => TRANSLATION_REVIEW[locale].status === "machine",
).map((locale) => LOCALE_LABELS[locale]);
if (unreviewed.length > 0) {
  console.log(
    `\n${unreviewed.length} language(s) complete but unreviewed: ${unreviewed.join(", ")}.` +
      `\nRead the approval prompts (task.approval.*) and the refusals (error.*) first — those are the` +
      `\nstrings a user acts on. Then record who read it in TRANSLATION_REVIEW (apps/desktop/src/i18n/locales.ts).`,
  );
}
console.log("");

