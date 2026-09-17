# Localization

The window, the daemon's refusals and the agent's status lines all speak the user's language. This is
how that works, what is machine-written, and what still needs a person.

- **Languages:** the family's seven — English, Chinese, German, French, Italian, Japanese, Korean.
- **Status:** all six non-English catalogues are **complete and unreviewed**. That is a caveat on a
  release, not a bug in the code: see [Review status](#review-status).

```bash
npm run i18n:gap          # completeness + who has read each language
npm run verify:language    # renders a real refusal, end to end, in German
npx vitest run apps/desktop/test/i18n.test.ts
```

## The languages are the family's, not ours

`CODER_LANGUAGES` in `packages/protocol/src/domain.ts` holds the list, and `LOCALES` in
`apps/desktop/src/i18n/locales.ts` is an alias for it rather than a second copy — the preference is
stored daemon-side and validated at the wire against that tuple, so a picker offering a language the
daemon refuses to save would be a lie. `i18n.test.ts` asserts the two agree.

These seven are what EnvoyMesh already ships: its Social UI carries them, and its EnvoyGo phone app
carries them as `apps/envoygo/lib/l10n/app_*.arb`. A product in this group that invented a *different*
list would give a German user one language on the phone and another on the desktop. `system` is a
preference, not an eighth language: it resolves to one of the seven from what the platform reports,
matching on the primary subtag so `de-AT` and `zh-CN` land correctly.

## Why there is no i18n library

EnvoyMesh does not use one either, and the reasons transfer:

- **A key that does not exist is a compile error.** `MessageKey` is derived from the English catalogue,
  so `t("sidebar.titel")` fails `tsc` instead of rendering `sidebar.titel` in front of a user.
- **No runtime table to load**, which matters in a webview that starts with a blank window.

What we borrow is the approach, not the files: EnvoyMesh's catalogue is namespaced by feature and
merged across three products; ours is one catalogue per language, because our UI is one app.

    apps/desktop/src/i18n/
      locales.ts       the seven, their endonyms, resolveLocale, and the review state
      messages/en.ts   the source: every key is written here first (179 keys)
      messages/<l>.ts  one catalogue per language
      catalogues.ts    locale → catalogue, for the translator and the tests
      translate.ts     createTranslator: lookup, {} interpolation, English fallback
      context.tsx      I18nProvider / useT for the components
      notice.ts        the wire marker, and localize() for daemon prose
      status.ts        task status → key

## The daemon speaks one language; the window speaks seven

The hard part is not the labels — it is the sentences the *daemon* writes. A daemon error crossing the
wire is English text with a code in front of it, and the naive fix (have the daemon return keys) makes
the window the only thing that can read its own log line, and gives the terminal user `error.foo`.

So the daemon's message carries both. The line below is real output from `npm run verify:language`,
wrapped to fit — the code, the English sentence and the marker, in the order they travel:

    envoydev.path-missing: /tmp/envoydev-this-folder-does-not-exist is not a directory on this
    machine. Pick a folder that exists — EnvoyDev runs agents in it, so the path has to be real.
    [envoydev.key] {"key":"error.addProject.notDirectory","values":{"path":"/tmp/…"}}

- the **English sentence** is what the log, the CLI and `npm run smoke` show — legible with no
  translation available;
- the **`[envoydev.key]` marker** is what the window renders in the user's language.

`noticeOf()` splits the marker off, `localize()` looks the key up, and an unknown key (a daemon one
version ahead) falls back to the English sentence — never to `error.brand.new.key`. That is the property
the whole design is for: **a German window never shows an English error and never shows a key.**
`npm run verify:language` proves it against a real daemon rather than a fixture: it makes the daemon
refuse `coder.addProject` with a path that does not exist, reads the wire text, and checks that the
German rendering contains no marker and no code.

`i18n.test.ts` pins the daemon's English byte-for-byte against the catalogue for the same keys, so the
fallback sentence and the translated one cannot drift into saying different things.

## Review status

**Every non-English catalogue is a machine translation that no native speaker has read.** They are
complete — **every key, in all seven locales**, printed by `npm run i18n:gap` rather than quoted here, because
a number written into prose is a number that rots (this line said 179, and then 423, long after each had stopped
being true) and `i18n.test.ts` is what actually fails when one language falls behind. That completeness is
exactly the state that hides the problem: a complete machine translation renders as a fluent window, so nothing
on screen distinguishes it from a reviewed one.

The state lives in `TRANSLATION_REVIEW` in `apps/desktop/src/i18n/locales.ts`, `npm run i18n:gap` prints
it, and `i18n.test.ts` enforces two rules: **a language may only claim `reviewed` with a name attached**
(an anonymous sign-off is not a sign-off), and the strings a user *acts on* must exist in every language.

Before a release that claims localized support, a speaker of each language reads, in this order:

1. **The approval prompts** (`task.approval.*`) — these are the buttons that decide whether an agent
   runs a command. A mistranslation here is a user approving what they meant to refuse. Read them
   *in context*: an approval is only meaningful against the command above it.
2. **The refusals** (`error.*`) — what the user reads when something went wrong, and what they act on.
   `npm run verify:language` is the fastest way to see them as a user does.
3. **The rest of the catalogue** for tone and consistency: `Aufgabe` for task, `Projekt` for project,
   `Agent` for agent, `Einstellungen` for settings — the vocabulary EnvoyMesh's German already uses, so
   the two products do not describe the same thing with different words.

Then record it:

```ts
de: { status: "reviewed", reviewer: "<name>", note: "Read 2026-09-20; approval wording corrected." },
```

## Adding a key or a language

**A key:** add it to `messages/en.ts` first — that is what `MessageKey` is derived from — then to the
six catalogues. If a catalogue is missed, `i18n.test.ts` fails with the count and the key, because the
recorded debt is **zero**: a window is only "unified" if the labels *and* the refusals are in the same
language. A `{placeholder}` in the English string must appear in every translation; a dropped `{count}`
renders a hole and an invented `{name}` renders the braces, and neither is visible to a type checker.

**A language:** add it to `CODER_LANGUAGES` in the protocol (an upstream contract change first, per the
family guide), then `LOCALES` and `LOCALE_LABELS` pick it up — with the endonym, since "German" is no
help to a German user — then add the catalogue and its `TRANSLATION_REVIEW` entry. Flutter has a second
step: `apps/desktop`'s Flutter counterpart generates its own Dart bindings from ARB files
(`flutter gen-l10n`), the way EnvoyGo does.

## What is not done yet

- **The review above has not happened.** Six languages ship complete and unchecked; the caveat is
  recorded here and in `TRANSLATION_REVIEW` rather than in a commit message, so it survives the next
  session.
- **The Flutter mobile app has no i18n yet.** The desktop Settings pane offers a language row; the
  mobile app is English-only until its ARB set lands with the same seven locales.
- **EnvoyMesh's own backlog is separate and larger:** EnvoyGo is missing 30 keys per language for the
  Coding tab and Pi panel (150 strings) and Social carries 5 German strings past its recorded backlog.
  Those are EnvoyMesh's to fix; the shared vocabulary above is the part that must not diverge.
