/**
 * The translator, as React sees it.
 *
 * ## Why a provider and not an imported singleton
 *
 * A module-level `t()` would work until the moment there are two of anything: a component test that
 * wants German, a second window on a different language, a preview pane rendering another locale.
 * It would also make the *language change* invisible to React — the setting lives in the store, the
 * store re-renders its consumers, and a singleton read at call time would re-render correctly by
 * accident while a memoised child would not. A context value makes the language part of what a
 * component renders *from*, which is what it is.
 *
 * ## What happens with no provider
 *
 * `useT()` outside a provider answers from the **source catalogue** (English) rather than throwing.
 * That is deliberate and it is the same rule the translator itself follows: English to a user is
 * incomplete, a raw key or a crash is wrong. It is also what lets a component be rendered on its
 * own — which is how most of this app's component tests work — without every one of them having to
 * wrap the component in a provider to assert a button label.
 */

import type { JSX, ReactNode } from "react";

import { createContext, useContext, useEffect, useMemo } from "react";

import { CATALOGUES } from "./catalogues.js";
import { SOURCE_LOCALE, resolveLocale, type Locale, type LocalePreference } from "./locales.js";
import { createTranslator, type Translator } from "./translate.js";

export interface I18nValue {
  /** The language actually in use — `system` already resolved. */
  locale: Locale;
  /** What the user chose, `system` included. */
  preference: LocalePreference;
  /** The translator for `locale`. Stable across renders unless the language changes. */
  t: Translator["t"];
}

/**
 * The fallback: the source catalogue, in the source language.
 *
 * `preference: "system"` is the honest value here — nothing has resolved anything yet.
 */
const SOURCE_ONLY: I18nValue = {
  locale: SOURCE_LOCALE,
  preference: "system",
  t: createTranslator(SOURCE_LOCALE).t,
};

const I18nContext = createContext<I18nValue>(SOURCE_ONLY);

/** What the platform reports, as the list `resolveLocale` wants. Never throws in a non-browser. */
function platformLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  const languages = navigator.languages;
  if (Array.isArray(languages) && languages.length > 0) return languages;
  return navigator.language ? [navigator.language] : [];
}

export interface I18nProviderProps {
  /** The user's setting. `system` follows the platform. */
  preference: LocalePreference;
  /** Overridden by tests; defaults to what the browser or webview reports. */
  reported?: readonly string[];
  children: ReactNode;
}

export function I18nProvider(props: I18nProviderProps): JSX.Element {
  const { preference, reported } = props;
  const value = useMemo<I18nValue>(() => {
    const locale = resolveLocale(preference, reported ?? platformLanguages());
    return { locale, preference, t: createTranslator(locale, CATALOGUES[locale]).t };
  }, [preference, reported]);

  // The document says which language it is in. Not decoration: a webview uses it for the platform's
  // own text (the folder chooser's buttons, spell check, font fallback for CJK), and a screen reader
  // switches voice on it — so a German window that declares `lang="en"` reads German prose aloud in
  // an English voice.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = value.locale;
  }, [value.locale]);

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

/** The whole value: the resolved locale, the preference, and `t`. */
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

/**
 * `t()` — the only thing most components need.
 *
 * Bound to the context value, so a component re-renders with its language when the setting changes
 * and never has to know which one it got.
 */
export function useT(): Translator["t"] {
  return useContext(I18nContext).t;
}
