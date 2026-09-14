/**
 * The localization contract, pinned.
 *
 * Five things this guards:
 *
 *   1. **A key that exists in English must not be invented in a translation.** A catalogue with a key
 *      English does not have is dead weight at best and a typo'd key at worst — the one case where a user
 *      would see `sidebar.empty.title` written out.
 *   2. **No language is allowed to fall back to English for a key we ship.** The recorded debt is
 *      **zero** for all six: the window is only "unified" if a German user's window *and* a German
 *      user's refusals are both German, and a missing key is exactly the second half failing.
 *   3. **A `{placeholder}` survives translation.** A dropped `{count}` renders a sentence with a hole
 *      in it, and an invented `{name}` renders the braces literally — both are visible to a user and
 *      invisible to a type checker.
 *   4. **English still says what the app already said.** The catalogue is the source of truth for
 *      wording now, so the strings the rest of the app grew up with — `statusLabel` in
 *      `@envoycoder/task-model` — must read the same, word for word: this was a language pass, not a
 *      rewrite.
 *   5. **Daemon prose reaches a German user in German**, and an unknown key falls back to the English
 *      sentence rather than to the key.
 *   6. **A language says how much of it has been read.** "179/179" is a count, and a complete machine
 *      translation renders exactly like a reviewed one — so the review state is recorded in
 *      `locales.ts`, a `reviewed` claim needs a name attached, and the strings a user acts on (the
 *      approval prompts and the refusals) are checked to exist in every language. See
 *      `docs/localization.md`.
 */

import { describe, expect, it } from "vitest";

import { CODER_LANGUAGES } from "@envoycoder/protocol";
import { statusLabel } from "@envoycoder/task-model";

import { CATALOGUES } from "../src/i18n/catalogues.js";
import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_PREFERENCES,
  SOURCE_LOCALE,
  TRANSLATION_REVIEW,
  isLocale,
  resolveLocale,
  unreviewedLocales,
} from "../src/i18n/locales.js";
import { en, type MessageKey } from "../src/i18n/messages/en.js";
import { localize, localNotice, noticeOf, statusKey } from "../src/i18n/notice.js";
import { createTranslator } from "../src/i18n/translate.js";

const ENGLISH_KEYS = Object.keys(en) as MessageKey[];

/**
 * The recorded translation debt, per language — the same mechanism EnvoyMesh's `i18n-gap-audit` uses.
 *
 * **Zero, and it may not go up.** If a change adds English copy without a translation, this is where
 * that decision has to be made deliberately: add the translation, or raise the number and say why a
 * window is allowed to speak two languages.
 */
const RECORDED_GAP: Record<string, number> = {
  zh: 0,
  de: 0,
  fr: 0,
  it: 0,
  ja: 0,
  ko: 0,
};

describe("the languages we ship", () => {
  it("are the family's seven, not a list of our own", () => {
    // EnvoyMesh's Social UI and EnvoyGo ship exactly these; a product that offered a different list would
    // give a German user one language on the phone and another on the desktop.
    expect([...LOCALES]).toEqual(["en", "zh", "de", "fr", "it", "ja", "ko"]);
    expect(SOURCE_LOCALE).toBe("en");
  });

  it("are the languages the protocol will store, in the same order", () => {
    // The preference is a *setting*: it is validated against `CODER_LANGUAGES` at the wire, so a
    // picker offering a language the schema does not know would let a user choose a value the daemon
    // refuses to save. `LOCALE_PREFERENCES` aliases that tuple; `LOCALES` is it minus `system`.
    expect([...LOCALE_PREFERENCES]).toEqual([...CODER_LANGUAGES]);
    expect(LOCALE_PREFERENCES.filter((preference) => preference !== "system")).toEqual([...LOCALES]);
    for (const locale of LOCALES) expect(LOCALE_LABELS[locale], locale).toBeTruthy();
  });

  it("are labelled in their own language, because 'German' is no help to a German user", () => {
    expect(LOCALE_LABELS.de).toBe("Deutsch");
    expect(LOCALE_LABELS.ja).toBe("日本語");
    expect(LOCALE_LABELS.ko).toBe("한국어");
  });

  it("resolves `system` from what the platform reports, matching on the primary subtag", () => {
    expect(resolveLocale("system", ["de-AT", "en"])).toBe("de");
    expect(resolveLocale("system", ["zh-TW"])).toBe("zh");
    expect(resolveLocale("system", ["nl", "pt-BR"])).toBe("en"); // nothing we ship → English
    expect(resolveLocale("ja", ["de"])).toBe("ja"); // an explicit choice wins over the system
    expect(isLocale("ko")).toBe(true);
    expect(isLocale("nl")).toBe(false);
  });
});

describe("the catalogues", () => {
  it("have no key English does not have", () => {
    for (const locale of LOCALES) {
      if (locale === SOURCE_LOCALE) continue;
      for (const key of Object.keys(CATALOGUES[locale])) {
        expect(ENGLISH_KEYS, `${locale} defines "${key}" which English does not`).toContain(key);
      }
    }
  });

  it("stay within the recorded translation debt — which is zero", () => {
    for (const locale of LOCALES) {
      if (locale === SOURCE_LOCALE) continue;
      const translator = createTranslator(locale, CATALOGUES[locale]);
      expect(
        translator.missing,
        `${locale}: ${translator.missing} untranslated (recorded ${RECORDED_GAP[locale]}). ` +
          "Translating lowers this number and the expectation; new English copy raises it.",
      ).toBeLessThanOrEqual(RECORDED_GAP[locale] ?? 0);
    }
  });

  it("keep every placeholder the English key declares", () => {
    const placeholders = (template: string): string[] =>
      [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();

    for (const locale of LOCALES) {
      if (locale === SOURCE_LOCALE) continue;
      const catalogue: Partial<Record<MessageKey, string>> = CATALOGUES[locale];
      for (const key of ENGLISH_KEYS) {
        const translated = catalogue[key];
        if (translated === undefined) continue; // the debt test above is where that is counted
        expect(placeholders(translated), `${locale}.${key} placeholders`).toEqual(
          placeholders(en[key]),
        );
      }
    }
  });

  it("fall back to English rather than showing a key to a user", () => {
    // The one failure nobody forgives is a raw key on screen; English to a German user is merely
    // incomplete. Every shipped language is complete, so the fallback is asserted where it can still
    // happen: a language that has not translated a key (new copy, before its translation lands).
    const german = createTranslator("de", {});
    expect(german.t("sidebar.footer.settings")).toBe("Settings");
    expect(german.t("sidebar.footer.settings")).not.toContain("sidebar.");
    // The same rule for text that came from the daemon: no key, so the sentence is what a user reads.
    expect(localize(german.t, { message: "/gone is not a directory." })).toBe(
      "/gone is not a directory.",
    );
  });

  it("interpolates the values a key declares, and leaves unknown placeholders alone", () => {
    const t = createTranslator("en").t;
    expect(t("sidebar.attention.many", { count: 3 })).toBe("3 tasks need you");
    expect(t("sidebar.footer.host", { host: "This machine" })).toBe("Host: This machine");
    // A missing value must not become "undefined" on screen.
    expect(t("sidebar.attention.many", {})).toContain("{count}");
  });

  it("says in German what it says in English, for the same key", () => {
    // Not a translation review — a *wiring* check. If a catalogue were built from the wrong file, or
    // a key were mapped to the wrong sentence, this is where it shows.
    const german = createTranslator("de", CATALOGUES.de).t;
    expect(german("status.running")).toBe("Läuft");
    expect(german("task.composer.start")).toBe("Starten");
    const refusal = german("error.addProject.notDirectory", { path: "/tmp/gone" });
    expect(refusal).toContain("/tmp/gone");
    expect(refusal).not.toContain("not a directory");
  });
});

describe("the wording the app already had", () => {
  it("is what the catalogue says now, word for word", () => {
    // The status words moved out of `@envoycoder/task-model`'s `statusLabel` into the catalogue so
    // they can be translated. The English must not have moved with them: a user who never opens the
    // language setting is not supposed to see a single character change.
    for (const status of [
      "queued",
      "running",
      "needs-attention",
      "idle",
      "done",
      "failed",
      "cancelled",
    ] as const) {
      expect(en[statusKey(status)], status).toBe(statusLabel(status));
    }
  });

  it("keeps the daemon's English identical to the sentences it sends", () => {
    // The `error.*` entries are the same sentences the daemon puts on the wire. They are duplicated
    // on purpose — neither side can import the other's catalogue — so the pair is pinned here.
    expect(en["error.notConnected"]).toBe("EnvoyCoder is not connected to its daemon yet.");
    expect(en["error.approvalPending"]).toContain("The agent is waiting for an answer");
    expect(en["approval.question.generic"]).toBe("Allow the agent to continue?");
  });
});

describe("daemon prose, as the window reads it", () => {
  it("takes the key out of the wire text and renders it in the user's language", () => {
    // The shape `coderError(code, message, ref)` produces: code, sentence and key in one string,
    // because the family's transport preserves nothing else of a rejected call.
    const wire =
      'envoycoder.path-missing: /tmp/gone is not a directory on this machine. Pick a folder that exists — EnvoyCoder runs agents in it, so the path has to be real. [envoycoder.key] {"key":"error.addProject.notDirectory","values":{"path":"/tmp/gone"}}';
    const notice = noticeOf(wire);
    expect(notice?.message).toBe(
      "/tmp/gone is not a directory on this machine. " +
        "Pick a folder that exists — EnvoyCoder runs agents in it, so the path has to be real.",
    );
    expect(notice?.key).toBe("error.addProject.notDirectory");

    const german = createTranslator("de", CATALOGUES.de).t;
    const rendered = localize(german, notice);
    expect(rendered).toContain("/tmp/gone");
    expect(rendered).toContain("kein Verzeichnis");
    expect(rendered).not.toContain("envoycoder.");
    expect(rendered).not.toContain("[envoycoder.key]");
  });

  it("falls back to the English sentence for a key this build does not have", () => {
    // A daemon one version ahead, or a key renamed in a release. The user reads English — never
    // `error.brand.new.key`.
    const wire =
      'envoycoder.harness-failed: Something brand new went wrong. [envoycoder.key] {"key":"error.brand.new.key"}';
    const notice = noticeOf(wire);
    expect(notice?.key).toBeUndefined();
    const german = createTranslator("de", CATALOGUES.de).t;
    expect(localize(german, notice)).toBe("Something brand new went wrong.");
  });

  it("carries a notice this app authored through the same lookup", () => {
    const german = createTranslator("de", CATALOGUES.de).t;
    expect(localize(german, localNotice("palette.addProject.noFolder"))).toBe(
      "Es wurde kein Ordner gewählt, also wurde nichts hinzugefügt.",
    );
  });
});

describe("how much of a translation has been read", () => {
  it("records a state for every language, in the repo, rather than in a commit message", () => {
    for (const locale of LOCALES) {
      const review = TRANSLATION_REVIEW[locale];
      expect(review, `${locale} has no recorded review state`).toBeDefined();
      expect(review.note.length, `${locale}'s note says nothing`).toBeGreaterThan(20);
    }
  });

  it("calls English the source, because a catalogue measured against itself is never behind", () => {
    expect(TRANSLATION_REVIEW[SOURCE_LOCALE].status).toBe("source");
    expect(unreviewedLocales()).not.toContain(SOURCE_LOCALE);
  });

  it("refuses a sign-off with no name on it", () => {
    // A language flips to `reviewed` when a person reads it. Without the name, "reviewed" is
    // indistinguishable from "I ran the translation pass again", which is the claim we must not make.
    for (const locale of LOCALES) {
      const review = TRANSLATION_REVIEW[locale];
      if (review.status !== "reviewed") continue;
      expect(review.reviewer?.trim(), `${locale} claims a review with nobody named`).toBeTruthy();
    }
  });

  it("has, in every language, the approval and refusal strings a user acts on", () => {
    // Complete catalogues are enforced above, so this looks redundant — it is not. These are the two
    // families where a fallback to English is not cosmetic: the buttons that decide whether an agent
    // runs a command, and the sentences a user reads when something went wrong.
    const risky = ENGLISH_KEYS.filter(
      (key) => key.startsWith("task.approval") || key.startsWith("error."),
    );
    expect(risky.length, "no approval or error keys found — has the naming changed?").toBeGreaterThan(5);
    for (const locale of LOCALES) {
      if (locale === SOURCE_LOCALE) continue;
      const catalogue: Partial<Record<MessageKey, string>> = CATALOGUES[locale];
      for (const key of risky) {
        expect(catalogue[key], `${locale} is missing ${key}`).toBeTruthy();
      }
    }
  });
});
