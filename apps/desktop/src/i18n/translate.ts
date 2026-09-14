/**
 * `t()` — and what it does when a language is incomplete.
 *
 * Two rules, both learned from EnvoyMesh's own translation layer:
 *
 *   1. **A missing translation falls back to English, and says so in development.** Shipping a raw key
 *      (`sidebar.empty.title`) to a user is the one failure nobody forgives; showing English to a German
 *      user is merely incomplete, and `npm run i18n:gap` is where that gets counted.
 *   2. **Interpolation is deliberate and tiny** — `{count}`, `{project}`, `{host}`, `{query}` — because a
 *      template language with formatting rules is a second thing to translate wrongly.
 */

import { SOURCE_LOCALE, type Locale } from "./locales.js";
import { en, type MessageKey } from "./messages/en.js";

/** Every language's catalogue has the same shape as English, with any subset of the keys filled in. */
export type Catalogue = Partial<Record<MessageKey, string>>;

export interface Translator {
  locale: Locale;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  /** How many keys this language is missing — the number the gap report prints. */
  missing: number;
}

function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

export function createTranslator(locale: Locale, catalogue: Catalogue = {}): Translator {
  const isSource = locale === SOURCE_LOCALE;
  const missing = isSource
    ? 0
    : (Object.keys(en) as MessageKey[]).filter((key) => catalogue[key] === undefined).length;

  return {
    locale,
    missing,
    t: (key, values) => {
      const source = en[key];
      const translated = isSource ? source : (catalogue[key] ?? source);
      return interpolate(translated, values);
    },
  };
}
