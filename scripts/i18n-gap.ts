/**
 * How far each language is from English on both surfaces, and who has read it — printed, so both are
 * visible.
 *
 * `npm run i18n:gap` (needs `tsx`). The gates that *fail* on drift are `apps/desktop/test/i18n.test.ts`
 * for the window and `apps/mobile/test/arb_parity_test.dart` for the phone; this is the report a
 * translator reads.
 *
 * ## Two surfaces, one key each, and why the numbers differ
 *
 * The window's English catalogue and the phone's are separate documents with separate key sets (637
 * and 297 at the time of writing), because the two surfaces do not have the same controls: the phone
 * has no settings rail, no explorer and no per-task agent chip. They are measured against their own
 * English and reported side by side rather than summed, because a total would be a number no file
 * contains and no translator can act on.
 *
 * ## Who has read it is a fact about a *language*, not about a file
 *
 * `TRANSLATION_REVIEW` in `apps/desktop/src/i18n/locales.ts` is the one record: "nobody has read the
 * Chinese catalogue" is a statement about Chinese, and a reader going through the phone's Chinese would
 * settle it for both catalogues at once. So the phone's section prints the same record instead of
 * inventing a second one that could disagree — and says where it lives, so a reviewer knows where to
 * write their name.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOGUES } from "../apps/desktop/src/i18n/catalogues.js";
import {
  LOCALES,
  LOCALE_LABELS,
  SOURCE_LOCALE,
  TRANSLATION_REVIEW,
} from "../apps/desktop/src/i18n/locales.js";
import { en } from "../apps/desktop/src/i18n/messages/en.js";
import { createTranslator } from "../apps/desktop/src/i18n/translate.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileL10nDir = path.join(root, "apps", "mobile", "lib", "l10n");

/** The keys of one ARB: everything that is a message, not a `@key` description. */
function arbKeys(locale: string): string[] {
  const file = path.join(mobileL10nDir, `app_${locale}.arb`);
  const document = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return Object.keys(document).filter((key) => !key.startsWith("@"));
}

/** A language's row: a bar, `done/total`, and the word for how much is left. */
function row(label: string, done: number, total: number, status: string): string {
  const bar = "█".repeat(Math.round((done / total) * 20)).padEnd(20, "·");
  const progress = done === total ? "complete" : `(${total - done} to translate)`;
  return (
    `  ${label.padEnd(9)} ${bar} ${done}/${total}` +
    `${total - done ? `  ${progress}` : "  complete"}\n` +
    `  ${"".padEnd(9)} ${"".padEnd(20)} ${status}`
  );
}

/** The one review record, rendered the same way for both surfaces. */
function reviewStatus(locale: (typeof LOCALES)[number]): string {
  const review = TRANSLATION_REVIEW[locale];
  return review.status === "reviewed"
    ? `read by ${review.reviewer}`
    : review.status === "machine"
      ? "machine translation — nobody has read it yet"
      : review.status;
}

const desktopTotal = Object.keys(en).length;
console.log(`\n${LOCALE_LABELS[SOURCE_LOCALE]} is the source: ${desktopTotal} keys\n`);
console.log("The window — apps/desktop/src/i18n/messages/\n");

for (const locale of LOCALES) {
  if (locale === SOURCE_LOCALE) continue;
  const { missing } = createTranslator(locale, CATALOGUES[locale]);
  console.log(row(LOCALE_LABELS[locale], desktopTotal - missing, desktopTotal, reviewStatus(locale)));
}

// The phone's own English, so "complete" means complete against the file a phone actually reads.
const mobileSource = arbKeys("en");
console.log(`\nThe phone — apps/mobile/lib/l10n/app_*.arb, against its own ${mobileSource.length} keys\n`);

for (const locale of LOCALES) {
  if (locale === SOURCE_LOCALE) continue;
  const present = new Set(arbKeys(locale));
  const missing = mobileSource.filter((key) => !present.has(key));
  console.log(
    row(LOCALE_LABELS[locale], mobileSource.length - missing.length, mobileSource.length, reviewStatus(locale)),
  );
}

const unreviewed = LOCALES.filter(
  (locale) => TRANSLATION_REVIEW[locale].status === "machine",
).map((locale) => LOCALE_LABELS[locale]);
if (unreviewed.length > 0) {
  console.log(
    `\n${unreviewed.length} language(s) complete but unreviewed: ${unreviewed.join(", ")}.` +
      `\nA reader going through one surface settles the language for both.` +
      `\nRead the approval prompts (task.approval.*) and the refusals (error.*) first — those are the` +
      `\nstrings a user acts on. Then record who read it in TRANSLATION_REVIEW (apps/desktop/src/i18n/locales.ts).`,
  );
}
console.log("");
