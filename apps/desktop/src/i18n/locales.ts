/**
 * The languages EnvoyCoder speaks — **the family's set, not a new one**.
 *
 * These seven are what EnvoyMesh's Social UI and its EnvoyGo phone app already ship (`apps/envoygo/lib/l10n/app_*.arb`):
 * English, Chinese, German, French, Italian, Japanese, Korean. A product in this group that offered a
 * *different* list would give a German user one language on the phone and another on the desktop.
 *
 * ## Why there is no i18n library
 *
 * EnvoyMesh does not use one either — its Social UI is a hand-rolled typed messages module
 * (`apps/social/src/i18n/{messages,merge-messages,translate,types}.ts`). Two reasons that is the right
 * shape here as well:
 *
 *   * **A key that does not exist is a compile error**, not a string that renders as `sidebar.title` in
 *     front of a user. `MessageKey` is derived from the English catalogue, so a typo fails `tsc`.
 *   * **No runtime lookup table to load**, which matters in a webview that starts with a blank window.
 *
 * What we borrow from EnvoyMesh is the *approach*, not its files: their catalogue is namespaced by
 * feature and merged; ours is one catalogue per language because our UI is one app, not three products.
 */

import { CODER_LANGUAGES, type CoderLanguage } from "@envoycoder/protocol";

export const LOCALES = ["en", "zh", "de", "fr", "it", "ja", "ko"] as const;

export type Locale = (typeof LOCALES)[number];

/** English is the source of truth: every key is written here first, and `MessageKey` comes from it. */
export const SOURCE_LOCALE: Locale = "en";

/**
 * `system` follows the operating system, which is what most users want and is EnvoyMesh's default too.
 * It is a setting, not a locale: it resolves to one of `LOCALES` at render time.
 *
 * **The list lives in `@envoycoder/protocol`** (`CODER_LANGUAGES`) and this is an alias for it, not a
 * second copy: the preference is stored daemon-side and validated at the wire against that tuple, so
 * a picker offering a language the protocol does not know would let a user choose something the
 * daemon refuses to save. `i18n.test.ts` asserts the two agree, and that `LOCALES` is exactly it
 * minus `system`.
 */
export const LOCALE_PREFERENCES: readonly CoderLanguage[] = CODER_LANGUAGES;

export type LocalePreference = CoderLanguage;

/** Endonyms: a language is listed in its own language, because "German" is no help to a German user. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
  ja: "日本語",
  ko: "한국어",
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Which language to use, given the preference and what the browser or webview reports.
 *
 * Matches on the primary subtag, so `de-AT`, `de-CH` and `de` all land on German, and `zh-CN`/`zh-TW`
 * both land on Chinese (we ship one Chinese, as EnvoyMesh does — pretending otherwise would be a promise
 * we cannot keep without a translator).
 */
export function resolveLocale(
  preference: LocalePreference,
  reported: readonly string[] = [],
): Locale {
  if (preference !== "system") return preference;
  for (const tag of reported) {
    const primary = tag.toLowerCase().split("-")[0] ?? "";
    if (isLocale(primary)) return primary;
  }
  return SOURCE_LOCALE;
}

/**
 * Who has read each translation — because "complete" and "correct" are different claims.
 *
 * Every catalogue here is **complete** (`i18n.test.ts` fails if one falls behind English), and that is
 * exactly the state that hides a problem: a complete catalogue of machine translations renders a
 * fluent-looking window, so nothing downstream can tell it apart from a reviewed one. Some of our
 * strings are not decorative — the approval prompts (`task.approval.*`) are what a user clicks to let
 * an agent run a command, and a mistranslated button there is a user approving what they meant to
 * refuse — and the refusal sentences (`error.*`) are what they act on when something has gone wrong.
 *
 * So the state is recorded here rather than in a commit message, `npm run i18n:gap` prints it, and a
 * language may only claim `reviewed` with a name attached: an anonymous sign-off is not a sign-off.
 * Flipping one is a statement about who checked it, so it takes a person, not another translation pass.
 *
 * What a reviewer reads first: the high-risk strings as a user meets them — `npm run verify:language`
 * renders the daemon refusals end to end — then the catalogue for tone. `docs/localization.md` has the
 * checklist, and the test below refuses a `reviewed` language with no reviewer.
 */
export type TranslationStatus = "source" | "machine" | "reviewed";

export interface TranslationReview {
  status: TranslationStatus;
  /** Required when `status` is `reviewed`. */
  reviewer?: string;
  note: string;
}

const MACHINE_NOTE =
  "Complete, and not yet read by a native speaker. Review the approval and refusal wording first.";

export const TRANSLATION_REVIEW: Record<Locale, TranslationReview> = {
  en: {
    status: "source",
    note: "Written here first; every other catalogue is measured against it, so it cannot be behind.",
  },
  zh: { status: "machine", note: MACHINE_NOTE },
  de: { status: "machine", note: MACHINE_NOTE },
  fr: { status: "machine", note: MACHINE_NOTE },
  it: { status: "machine", note: MACHINE_NOTE },
  ja: { status: "machine", note: MACHINE_NOTE },
  ko: { status: "machine", note: MACHINE_NOTE },
};

/** The languages a user would read as their own, and that no native speaker has checked yet. */
export function unreviewedLocales(): Locale[] {
  return LOCALES.filter((locale) => TRANSLATION_REVIEW[locale].status === "machine");
}
