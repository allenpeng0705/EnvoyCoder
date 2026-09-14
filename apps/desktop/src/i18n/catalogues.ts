/**
 * Every language's catalogue, in one lookup.
 *
 * Kept separate from `locales.ts` so the locale list (which the settings UI and the resolver use) does not
 * pull six catalogues into the bundle of a window that only needs one. The app imports this at the point it
 * builds its translator; nothing else should.
 */

import type { Locale } from "./locales.js";
import type { Catalogue } from "./translate.js";

import { de } from "./messages/de.js";
import { en } from "./messages/en.js";
import { fr } from "./messages/fr.js";
import { it } from "./messages/it.js";
import { ja } from "./messages/ja.js";
import { ko } from "./messages/ko.js";
import { zh } from "./messages/zh.js";

export const CATALOGUES: Record<Locale, Catalogue> = {
  en,
  zh,
  de,
  fr,
  it,
  ja,
  ko,
};
