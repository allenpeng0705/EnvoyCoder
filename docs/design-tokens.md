# Design tokens, and where they come from

EnvoyCoder **looks like Paseo** — the same surfaces, the same green, the same two-band status system,
the same scales and the same words for the same things. It does not *use* Paseo.

That distinction is worth writing down, because the two halves have different rules:

| | Paseo | EnvoyCoder |
|---|---|---|
| Desktop UI | React Native + `react-native-web` (Expo Router), styled with `react-native-unistyles` | React DOM + Vite inside a **Tauri** shell, plain CSS |
| Mobile UI | the same Expo codebase | **Flutter**, its own codebase |
| Styling source of truth | one 863-line `packages/app/src/styles/theme.ts` read by `StyleSheet.create((theme) => …)` | `apps/desktop/src/design/tokens.css` (CSS custom properties) + `apps/mobile/lib/theme/tokens.dart` (Dart) |

Behaviour — interaction logic, and the seven places we deliberately differ — is in
[`paseo-design-decisions.md`](paseo-design-decisions.md).

**No Paseo code is copied.** Their component layer cannot be reused — it is React Native primitives and a
runtime theme engine that do not exist in a DOM app — and it does not need to be: the transferable part is
the *design*, and a design compiles down to a token set. Paseo is Apache-2.0 (`LICENSE`,
"Copyright (c) 2025-present Mohamed Boudra"), and the values below are recorded with the line they came
from so the provenance is checkable rather than remembered.

## The values

Read from Paseo v0.8.0. Light and dark are both shipped; **dark is our default**, and it is Paseo's
default variant ("paseo") rather than their zinc/midnight/claude/ghostty/pureBlack set.

### Surfaces

| Token | Light | Dark (default) | Used for |
|---|---|---|---|
| `--surface-0` | `#ffffff` | `#181b1a` | the page |
| `--surface-1` | `#fafafa` | `#1e2120` | cards, raised rows |
| `--surface-2` | `#f4f4f5` | `#272a29` | inputs, code, chips, the **selected tab** |
| `--surface-3` | `#e4e4e7` | `#434645` | secondary buttons, badges, the selected sidebar row |
| `--surface-4` | `#d4d4d8` | `#595b5b` | the strongest neutral |
| `--surface-sidebar` | `#f4f4f5` | `#141716` | the rail — darker than the page in dark mode, so it reads as its own plane |

### Text, borders, brand

| Token | Light | Dark |
|---|---|---|
| `--foreground` | `#1a1a1e` | `#fafafa` |
| `--foreground-muted` | `#71717a` | `#a1a5a4` |
| `--foreground-extra-muted` | `#6b6b73` | `#909593` |
| `--border` | `#e4e4e7` | `#252b2a` |
| `--border-accent` | `#ececf1` | `#2f3534` |
| `--accent` | `#20744a` | `#20744a` |
| `--accent-bright` | `#239956` | `#7ccba0` |
| `--destructive` | `#b04138` | `#c64f43` |
**The faintest foreground was below the floor in both themes, and it is the pair that moved.** Measured on the
surfaces it is actually drawn on: `#a1a1aa` is 2.33:1 on `--surface-2` and 2.56:1 on white (light), and `#717574`
is 3.10:1 on `--surface-2` and 3.48:1 on `--surface-1` (dark) — against the 4.5:1 this family holds small text to.
The values above are the measured replacements (4.81 / 5.06 light, 4.76 / 5.34 dark), chosen to keep the three-band
hierarchy the sheet is built on: `--foreground` > `--foreground-muted` (5.82–6.97) > `--foreground-extra-muted`.
Found by the whole-window contrast scan rather than by eye — `scripts/measure-settings.mjs --section work --seed`.


**The accent is a green, not a blue.** It is identical in both schemes — the one colour a user learns to
recognise — and it is the same green as Paseo's hardcoded focus ring (`index.html:73-82`).

### Status: two bands, on purpose

| Band | Light | Dark | Where it belongs |
|---|---|---|---|
| `--status-success` / `--status-danger` / `--status-warning` / `--status-merged` | `#3e704a` / `#9d433b` / `#7b5d39` / `#7347af` | `#6cb17b` / `#d8847b` / `#c09664` / `#a890d5` | icons, badges, diff stats, usage bars |
| `--status-dot-*` | `#299f51` / `#f12e2f` / `#b37824` / running `#268ae0` | `#35c264` / `#f7796d` / `#db932e` / running `#5caaf6` | the 6px sidebar dots and the running ring |

A dot has no label next to it, so it is allowed to be louder. Mixing the bands — a status colour on a dot,
or a dot colour on an icon beside text — is what this split prevents.

### Scales

* **Spacing** `0, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96`: a 2/4 rhythm to 16, then jumps. There is no 5, 7
  or 14, and a new value should not be invented for one screen.
* **Radius** `2, 4, 6, 8, 12, 16, full`.
* **Font size** `code 12, sm 12, base 14, content 15, lg 16, xl 18, 2xl 20, 3xl 22, 4xl 26`. Chat text and
  rendered markdown use **content** (15), not base.
* **Control heights** `tight 28, compact 32, field 44`, plus `header 26`. Every control derives from these
  three numbers rather than declaring its own padding.
* **Content measure** `820px` — chat, composer and forms all stop there.
* **Motion** `80, 100, 140, 150, 180, 200, 220 ms`, and `prefers-reduced-motion` is honoured globally.

## Rules we adopted, and the two Paseo bugs we did not

Adopting a design means adopting its coherence, not its accidents:

1. **One focus ring.** Paseo ships two that disagree: a hardcoded `outline: 2px solid #20744a;
   outline-offset: 2px` in `public/index.html`, and a themed ring (`accent`, width 2, offset 1) in
   `components/ui/control-geometry.ts:207-216`. Ours is one: `--focus-ring-*`, on `:focus-visible` only.
2. **One error red.** Their form fields use `palette.red[300]` (`form-field.tsx:240`) while settings rows
   use `statusDanger` (`styles/settings.ts:60`) — two reds for one meaning. Ours is `--status-danger`.
3. **Selection is a background tint, not an indicator.** Paseo's tab strip has no underline or pill; the
   active tab is `surface-2` plus a `foreground` label. Copying that is what keeps a strip of ten tabs
   from looking busy.
4. **The rail is its own plane.** `--surface-sidebar` is darker than the page in dark mode and lighter in
   light mode; that asymmetry is deliberate, and a "fix" that makes it symmetric breaks the tree's
   legibility.
5. **Primitives we build, not borrow.** Paseo has no `Card`, `IconButton` or `Text` component: the card
   style is spread across 31 consumer files and the icon-button chrome across 13 adapter sites. We ship
   real `<Card>`, `<IconButton>`, `<Text>`, `<Avatar>` and `<ListRow>` components over these tokens.

### Recorded but not shipped

Paseo's other five dark variants, for when we add a theme picker — `surface-0` / `accent` per variant:
`zinc` `#18181b` / `#e4e4e7` (its accent is near-white, so its `accent-foreground` inverts to `#18181b`),
`midnight` `#161820` / `#3b6fcf`, `claude` `#1f1f1e` / `#d97757`, `ghostty` `#282c34` / `#89b4fa`,
`pureBlack` `#000000` / `#20744a`. Their swatches are `#ffffff`, `#2D8B62`, `#808080`, `#4A6BA8`,
`#D97757`, `#8caaee`, `#000000`.

Also not shipped: Paseo's user-adjustable font ramp (`uiBaseFontSize` 14 desktop / 15 native,
`contentFontSize` 15/16, `codeFontSize` 12, each clamped, with the scale rebuilt as
`round(FONT_SIZE[tier] × uiBase / FONT_SIZE.base)` while `content` and `code` stay absolute). If we want
adjustable type size, that is the mechanism to copy — the derivation, not the numbers.

## Using them

**Desktop** — the sheet is imported before the app stylesheet in `apps/desktop/src/main.tsx`, so every
component can read a variable:

```css
.pane { background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius-lg); }
```

Set the scheme with `<html data-theme="dark">`; with no attribute it follows the OS. Dark is the product
default.

**Mobile** — `apps/mobile/lib/theme/tokens.dart` is the twin: `CoderColors.light` / `CoderColors.dark`,
`CoderSpace`, `CoderRadius`, and `CoderTheme(colors).toThemeData()` for Material. `CoderTheme.of(context)`
picks the band for the current brightness.

The two files hold the same values and **nothing generates one from the other** — a generator would be
more machinery than the values are worth. Instead each side pins the facts that matter:
`apps/desktop/src/design/tokens.css` is asserted through the app's own rendering, and
`apps/mobile/test/design_tokens_test.dart` asserts the accent, the two status bands, and that the dark
rail is darker than the dark page. Change a value in one file and the other should be changed in the same
commit; if it is not, the token doc above is what a reviewer checks against.
