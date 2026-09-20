# Localization — how the phone speaks seven languages

The app speaks the same seven languages as the desktop: **en, de, fr, it, ja, ko, zh**. A phone set
to anything else — Spanish, say — gets **English**, never an empty screen and never a raw ARB key.

## The files

| File | What it is |
|---|---|
| `app_en.arb` | The English source of truth, and the only file with `@key` descriptions and placeholders. Written first; every other file is measured against it. |
| `app_{de,fr,it,ja,ko,zh}.arb` | The six translations, same key set. |
| `generated/` | `gen-l10n` output: `AppLocalizations` and one class per language. **Committed** (see below). Never hand-edit. |
| `l10n.dart` | `context.l10n`, the English fallback, and `resolveAppLocale` — the unsupported-locale rule. |
| `locale_controller.dart` | The phone's stored language preference (`system` or a code). |

`l10n.yaml` points `gen-l10n` at the ARBs and `pubspec.yaml` sets `flutter: generate: true`, so
`flutter pub get` regenerates `generated/` from the ARBs.

## Why `generated/` is committed

`flutter analyze` does **not** run `gen-l10n`. Verified on Flutter 3.47.2 by deleting the generated
directory and the build state:

* `flutter test` runs an implicit `flutter pub get` and regenerates the files;
* `flutter analyze` creates `.dart_tool/` and then fails with
  `Undefined name 'AppLocalizations'`.

So a checkout that gitignores the output cannot be analysed with the raw command — a failure the
task that added this layer called out by name. Committing the generated files makes `flutter analyze`
and `flutter test` work with no prerequisite step beyond package resolution, and they are refreshed
by every `flutter pub get`.

**After editing an ARB, run `flutter pub get` (or `flutter gen-l10n`) and commit the regenerated
diff.** `test/arb_parity_test.dart` fails if a catalogue is missing a key, drops a placeholder or
loses a plural form; it cannot see a stale generated file, so the regeneration is part of the same
commit by convention.

## Which strings belong here

* **User-facing text goes in the ARB.** That includes `Text`, dialog titles and messages, buttons,
  empty states, snackbars, field labels/hints/helpers — and equally **tooltips and `Semantics`
  labels**: a screen reader announcing an English control on a German phone is the same defect as
  untranslated text.
* **Developer text stays English.** Log lines, `StateError`/`ArgumentError` messages, RPC method
  names, storage keys and the copyable network diagnostics report are addressed to an engineer, not
  a user (`AGENTS.md` #5).
* `test/no_hardcoded_strings_test.dart` is the gate: a user-facing literal that is not read through
  `context.l10n` fails the suite. It scans UI positions only, so the developer text above is not a
  false positive.

## Reusing the desktop's wording

`tool/desktop-reuse.json` maps a mobile ARB key to the desktop message key it was taken from
(`apps/desktop/src/i18n/messages/*.ts`). Those values are copied verbatim in every locale, so one
concept has one sentence in both apps. `tool/mobile-only-keys.json` lists the keys with no desktop
counterpart — the ones that had to be translated fresh.

## The system language and the fallback

`Settings → Language` offers `System` plus the seven endonyms. `System` means "follow the phone", so
`LocaleController.locale` is `null` and `MaterialApp.localeResolutionCallback` runs
`resolveAppLocale`: a supported language matches on its language code (`de_AT` → `de`), and anything
else resolves to English. Picking a concrete language both changes the phone immediately and is
written to the daemon (best effort) so the desktop follows; if the daemon write fails the phone keeps
the language the user chose and says which half did not save.
