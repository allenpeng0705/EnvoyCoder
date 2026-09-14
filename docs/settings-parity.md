# Settings parity — Paseo's settings surface, setting by setting

**Source studied:** `../paseo`, `packages/app` + `packages/server` + `packages/protocol`, at
`d1b705a0c` (v0.8.0) · **Scope:** every setting Paseo's settings *surface* has — the two sidebar
tiers, the pages they route to, and the daemon keys those pages write. **Position of this document:**
we reimplement ideas and UX; we do not copy code (`envoycoder-paseo-inheritance.md` §1).

This is an **inventory and a verdict**, not an implementation plan with dates. Its job is to answer,
for every entry, "can EnvoyCoder honour this, and if not, why not" — because the failure this document
exists to prevent is the one we already shipped: a settings pane with five controls, of which
**two do nothing and three more settings have no control at all** (§7.1), beside a Paseo section list
of twenty-one.

**That defect is fixed, and this document is the record of what it was and what replaced it.** Slice 1
(§8.1) has been built, so §7.1's rows carry their **current** verdicts rather than the ones they had when
this inventory was taken, and §7.2 records what the two dead switches do now. Where a §4–§6 verdict was
about *Paseo's* setting rather than ours, nothing changed — those are still decisions about rows we have
not built.

The companion gate is `scripts/check-settings-parity.mjs` (`npm run settings:check`). It reads Paseo's
source, extracts the sections it registers and the settings they read and write, and fails when one of
them has no verdict here. What it can and cannot see is §10, and it is worth reading before trusting a
green run.

**The `file:line` citations are the snapshot taken when each entry was written, and they are re-derived
rather than trusted.** Code moves for reasons that have nothing to do with settings: the row-menu work
(§8.1 item 2's control became a menu — `components/RowMenu.tsx`) moved lines in `CoderApp.tsx`,
`CoderSidebar.tsx` and `TaskPane.tsx`; the three-level navigation of §7.5 moved every citation into
`SettingsPane.tsx` (so `:382-478` is now `:497-598`, and the rows listed in §7.1 all sit 50–70 lines
further down) **and split the pane's frame out into `components/SettingsShell.tsx`**, which is where the
header, the back control, the daemon chips and the notes now live; and earlier slices moved others. A
citation that no longer lands on the call it names is stale, not evidence against the entry; read the
line around it.

---

## 1. How to read a verdict

Every entry gets exactly one of four verdicts. The vocabulary is closed on purpose: a fifth word would
be a place to hide.

| Verdict | What it claims | What it obliges |
|---|---|---|
| **honour-able now** | The daemon (or the shell) already has the behaviour. A schema field, a persisted default, an effect at the read site and a control are all that is missing | Build it as one slice — schema + store + effect + UI + 7 languages + test |
| **honour-able with work** | The behaviour does not exist yet, and the work is named: which subsystem, which protocol field, which effect — and whether it needs a change **upstream** (family guide §7.4: a contract change goes into EnvoyMesh/`envoy-harness` first, never into a fork) | Do the upstream change first, or the slice is unbuildable |
| **not applicable** | The setting genuinely has no meaning here, and the reason is a fact about this product: `webOnly`/`desktopOnly`, or a subsystem we do not have (terminals, plugins, browser tools, usage/quota, metadata generation, device pairing, git) | Nothing to build. The reason is what a future reader needs — omit it and someone will "finish the parity work" by adding the control |
| **must be disabled-with-reason** | We could render it and could not honour it. Showing it live would be a lie; hiding it would let a user conclude the feature is missing rather than not-yet | Render it **disabled**, with the reason in the user's language. This is the project's absolute rule: **never ship a setting that does nothing** (`paseo-feature-parity.md` §"The one class of exception") |

A **section** verdict answers a narrower question — *should this section exist in our settings pane?* —
and the per-setting verdicts below it are what decides each row. A section can be `not applicable`
while one of its rows is `honour-able with work`; where that happens the row says so and this document
does not hide it behind the section verdict.

## 2. The counts, so they can be checked

Measured, not estimated. The two registries are the arrays in
`paseo/packages/app/src/screens/settings-screen.tsx:152-183` (`SIDEBAR_SECTION_ITEMS`, 10 entries) and
`:191-203` (`HOST_SECTION_ITEMS`, 11 entries); the per-section numbers come from reading every settings
component, not from counting controls — an action button is not a setting and is counted separately.

| Scope | Sections | Persisted settings |
|---|---|---|
| **App** (per user, per client) | 10 | **32** — plus **43** keyboard-shortcut overrides |
| **Host** (per machine, daemon-side) | 11 | **38** — of which 2 (`manageBuiltInDaemon`, `keepRunningAfterQuit`) are desktop-shell settings Paseo renders inside the host page rather than daemon values |
| **Total, distinct** | **21** | **111** |

The arithmetic, so a reader can disagree with a specific number rather than the total: 32 app + 43
shortcut overrides + 38 host − 2 counted in both places = 111.

Per section, in Paseo's own order:

| Section | Settings | Where they live |
|---|---|---|
| `general` | 4 | client `AsyncStorage` (`@paseo:app-settings`) |
| `appearance` | 12 | client `AsyncStorage` |
| `layout` | 6 | client `AsyncStorage` |
| `editor` | 1 | client `AsyncStorage` |
| `shortcuts` | 43 | client `AsyncStorage` (`@paseo:keyboard-shortcut-overrides`) |
| `integrations` | **0** | — |
| `notifications` | 1 | Electron `desktop-settings.json` |
| `permissions` | **0** | — |
| `diagnostics` | 1 | client `AsyncStorage` |
| `about` | 1 | Electron `desktop-settings.json` |
| *(no section)* sidebar display preferences | 4 | client `AsyncStorage`, edited from a sidebar popover |
| *(no section)* desktop daemon lifecycle | 2 | Electron `desktop-settings.json`, edited inside the `host` page |
| `host` | 5 | 2 Electron + 3 client (`@paseo:daemon-registry`) |
| `projects` | **0** | — |
| `connections` | **0** | — |
| `pair-device` | 1 | daemon `~/.paseo/config.json` |
| `agents` | 14 | daemon `~/.paseo/config.json` (+ per-plugin skill dirs on disk) |
| `metadata` | 2 | daemon `~/.paseo/config.json` |
| `workspaces` | 1 | daemon `~/.paseo/config.json` |
| `providers` | 5 | daemon `~/.paseo/config.json` |
| `usage` | **0** | — |
| `terminals` | 5 | daemon `~/.paseo/config.json` (read client-side only — §5.10) |
| `plugins` | 5 | daemon `~/.paseo/config.json` + `<paseoHome>/plugin-settings/…` |

**Five of the twenty-one sections carry no user-settable value at all** — `integrations`,
`permissions`, `projects`, `connections`, `usage` are navigation, actions and read-only status. That is
worth knowing before treating "twenty-one sections" as a backlog: **sixteen** sections are settings,
and of those, the ones we can act on are far fewer. §8 orders them.

### 2.1 Section verdicts, in one place

The question each of these answers is narrow: **should this section exist in our settings pane?** The
per-setting verdicts in §4 and §5 are what decide the rows. Where a section is `not applicable` and
one of its rows is not, the row says so and this table does not hide it.

| Paseo section | Verdict | Why, in one line |
|---|---|---|
| `general` | **honour-able with work** | two rows are ours (one already built, one needs wiring), two are N/A — but the honest page is a merged *General* group, not this one (§4.1) |
| `appearance` | **honour-able with work** | the largest honest win: theme, two text sizes and reasoning expansion are takeable; the code rows ship disabled until there is a code surface (§4.2) |
| `layout` | **not applicable** | every row answers "where should this open in a multi-pane workspace" and we have one pane (§4.3) |
| `editor` | **not applicable** | its only setting configures an editor we do not ship (§4.4) |
| `shortcuts` | **honour-able with work** | the layer exists and is mounted with 8 bindings; overrides, a grown table and conflict reporting are the work (§4.5) |
| `integrations` | **not applicable** | it installs a CLI we do not ship, from a shell we do not use, by rewriting the user's shell rc (§4.6) |
| `notifications` | **not applicable** | no OS notification path, no tray, nothing to silence (§4.7) |
| `permissions` | **not applicable** | we use no microphone and request no OS permission (§4.8) |
| `diagnostics` | **not applicable** | its one setting is a native-only terminal renderer; the two useful things are actions, and our equivalents already ship in the pane header and notes (§4.9) |
| `about` | **honour-able with work** | the channel is N/A (no updater) but the version-mismatch row is a real control-plane need and nearly free (§4.10) |
| `host` | **not applicable** | three of its five rows are per-host identity a one-daemon install cannot use; the useful two are shell lifecycle and belong in our own General group (§5.1) |
| `projects` | **honour-able with work** | the resolver already exists (`resolveTaskDefaults`); the screen does not, and slice 1 fixes the button that pretends to open it (§5.2) |
| `connections` | **not applicable** | there is no connection list — one loopback daemon, and the remote path is deliberately refused until a session store exists (§5.3) |
| `pair-device` | **honour-able with work** | the pairing contract is written and cited; the session store it needs is roadmap M1 (§5.4) |
| `agents` | **not applicable** | four of five rows are subsystems we do not have; the fifth (agent profiles) is recorded as honour-able with work and belongs in its own group (§5.5) |
| `metadata` | **not applicable** | both rows choose which model writes text we never generate (§5.6) |
| `workspaces` | **must be disabled-with-reason** | the row is meaningful and we cannot honour it — show it disabled, in the user's language, shipped with the git slice rather than before it (§5.7) |
| `providers` | **not applicable** | Paseo's page is credential and adapter management; our agents are ACP programs in a static catalogue with no accounts (§5.8) |
| `usage` | **not applicable** | no quota fetcher and no per-provider account; `run.usage` is a per-run figure, not a subscription (§5.9) |
| `terminals` | **not applicable** | no terminal subsystem, and Paseo's own daemon never reads the profiles it stores (§5.10) |
| `plugins` | **not applicable** | no plugin runtime and no extension points — and Paseo's own are explicitly unsandboxed (§5.11) |

---

## 3. The section registry, and one correction to the brief

The eleven host ids are registered in `settings-screen.tsx:191-203` and dispatched by a
`switch (view.section)` at `:205-233` — there is **no `default` arm**, so `HostSettingsPage` is simply
the `case "host"` arm and an unknown slug renders nothing. The slugs themselves are a union in
`packages/app/src/utils/host-routes.ts:511-525`, with legacy aliases `orchestration → agents` and
`daemon → host` at `:527-530`. Two of the host pages are not in `host-page.tsx` at all:
`projects` renders `screens/projects-screen.tsx:24-84` and `metadata` renders
`screens/settings/metadata-generation-page.tsx:19-164`.

**Correction to the brief:** `paseo/packages/app/src/hooks/use-settings.ts` does not exist — it is a
directory module, `hooks/use-settings/` (`index.ts` 263 lines, `storage.ts` 566, `keys.ts`,
`migrations.ts`). The type that matters is `AppSettings` in `storage.ts:67-95`. Everything else in the
brief checks out.

Three write paths, and knowing which one a setting uses decides whether EnvoyCoder can honour it:

| Path | Written by | Lands in |
|---|---|---|
| **Client** | `useAppSettings().updateSettings` / `useSettings().updateSettings` — `hooks/use-settings/index.ts:185-211` | `AsyncStorage` key `@paseo:app-settings` (`storage.ts:551-565`) |
| **Desktop shell** | `useDesktopSettings().updateSettings` — `desktop/settings/desktop-settings.ts:131-140` | Electron IPC `patch_desktop_settings` → `desktop-settings.json` in `userData` |
| **Daemon** | `useDaemonConfig(serverId).patchConfig` — `hooks/use-daemon-config.ts:35-45` | RPC `set_daemon_config_request` → `DaemonConfigStore.patch` (`server/daemon-config-store.ts:349-352`) → `<paseoHome>/config.json` (`server/persisted-config.ts:346`,`:561`) |

**The daemon path is the one that matters for parity.** All thirty-eight host settings except the
client-only host appearance trio (`host` section: name, colour, badge — `@paseo:daemon-registry`,
`runtime/host-runtime.ts:1314`) go through `config.json`, and every one of them is read back by the
daemon at a named site or — for exactly one of them, `terminalProfiles` — not at all. §5 says which.

Sections §4 and §5 are the two tiers. Read §4 first if you want the cheap wins: app-scope settings
need no daemon read site, no protocol change and no upstream conversation.

---

## 4. App-scope settings

Edited from a settings page, persisted per client, and — this is the part that decides our verdicts —
**the daemon is not involved at all**. All four of the sections below write through
`useAppSettings`/`useSettings` → `AsyncStorage` (`hooks/use-settings/index.ts:185-211`,
`storage.ts:551-565`), and `grep -rn "app-settings\|keyboard-shortcut" packages/server/src` returns
nothing. Where a verdict says "the behaviour exists", it means it exists in *our shell* — no protocol
change, no daemon read site, which is what makes these the cheapest honest wins we have.

### 4.1 `general`

`GeneralSection` — `screens/settings-screen.tsx:357-514`, rendered at `:1524-1537`.

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Default send** (`sendBehavior`) | `settings-screen.tsx:410-435` (dropdown: interrupt / steer / queue) · `settings.general.defaultSend.label` "Default send" (`i18n/resources/en.ts:2119`) | `"steer"` (`storage.ts:126`) | what the composer does with a follow-up while a turn is running: `composer/index.tsx:1458` maps the setting to steer-or-interrupt, and `composer/input/state.ts:12` forces interrupt when a permission prompt is pending | **the behaviour is already written and tested, with the default hardcoded.** `SendBehaviour` is a four-value union (`apps/desktop/src/composer/controls.ts:158`), `resolveSendBehaviour(state, preferred)` takes the preference as its second argument (`:539-548`), approval-pending already forces `interrupt` (`:545-546`) — and the only caller in the app never passes `preferred` (`TaskPane.tsx:134`), so it always gets the literal `"steer"` (`controls.ts:679`). The per-pane Queue/Steer select is local state defaulted to `"queue"` (`TaskPane.tsx:98`,`:368-385`) | **honour-able now** — one field on `CoderSettings`, one row in `SettingsPane`, and `TaskPane` passing the setting as `preferred` and using it as its initial `mode`. One widening is needed: `preferred` accepts only `"queue" \| "steer"` today (`controls.ts:542`), so Paseo's third value `interrupt` needs the union widened — in our own file, not upstream |
| **Language** (`language`) | `settings-screen.tsx:436-461` (dropdown) · `settings.general.language.label` "Language" (`en.ts:2160`) | `"system"` (`storage.ts:125`) | the i18n runtime: `settings.language` → `resolveSupportedLocale` → `changeLanguage` (`i18n/provider.tsx:23-27`) — every `t()` string in the app | **already built and honest.** `CoderSettings.language` (`packages/protocol/src/domain.ts:745`, schema `:773`), persisted (`store.ts:469-479`), validated against a closed list at the wire (`:722`), read at `main.tsx:33`, rendered by `SettingsPane.tsx:80-104`; seven locales (`i18n/locales.ts:24`) and 30 `settings.*` keys of 230 | **honour-able now** — it is done. Two caveats recorded rather than fixed: the daemon stores it and the **phone does not read it** (§7.4), and Paseo offers **ten** languages where we offer the family's seven (`storage.ts:199`: `system, ar, en, es, fr, ja, ko, pt-BR, ru, zh-CN`) — deliberately different, and `docs/localization.md` says why |
| **Service URLs** (`serviceUrlBehavior`) | `settings-screen.tsx:462-489` (dropdown: ask / in-app / external; desktop-only) · `settings.general.serviceUrls.label` "Service URLs" (`en.ts:2133`) | `"ask"` (`storage.ts:127`) | decides whether a URL the daemon reports is opened in the app or by the OS browser (`utils/open-service-url.ts:29-50`) | we open no URLs from daemon output and have no in-app browser | **not applicable** — there is no service URL to open; our links are shell `open` calls to documentation |
| **Terminal scrollback** (`terminalScrollbackLines`) | `settings-screen.tsx:490-510` (digits-only text input) · `settings.general.terminalScrollback.label` (`en.ts:2142`) | `10000`, clamped 0…1 000 000 (`storage.ts:45-47`) | the xterm buffer: `components/terminal-pane.tsx:1035` | no terminal | **not applicable** |

**Section verdict: `honour-able with work`.** Two of its four rows are ours to take — `language`
already exists, `sendBehavior` needs wiring to machinery that is already written and tested — and two
are N/A. "With work" rather than "now" because the honest version of this page is not Paseo's: we
would ship a *General* group holding `language`, `sendBehavior`, the default agent (Paseo keeps that
under `agents`; we already keep it in `defaults.harness`) and the two shell-lifecycle rows from §5.1.
That is a different page carrying Paseo's rows, which is the shape we want.

### 4.2 `appearance`

`AppearanceSection` — `screens/settings/appearance/appearance-section.tsx` (844 lines): `theme` group
(`:672`) → detail level (`:683`) → `<SidebarNavSection/>` (`:701`) → fonts (`:702`) → syntax (`:755`)
with a live preview (`:759-761`). Two rows are hidden on native (`:517`, `:693-698`).

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Theme** (`theme`) | `appearance-section.tsx:183-224` (dropdown with swatch) · `settings.appearance.theme.title` "Theme" | `"auto"` (`storage.ts:44`,`:123`) | `applyTheme` (`appearance/provider.tsx:25-43`) → `UnistylesRuntime.setTheme`/`setAdaptiveThemes` for all registered themes → every `StyleSheet.create((theme) => …)` consumer repaints | `apps/desktop/src/design/tokens.css` already ships both variants — light in `:root`, `:root[data-theme="dark"]` at `:117`, and a `prefers-color-scheme` fallback at `:155-156` — but **no TypeScript writes `data-theme` anywhere**: the theme is whatever the OS says, with no setting and no control | **honour-able with work** — add a three-value `theme` to `CoderSettings`, a row in the pane, and one effect setting `document.documentElement.dataset.theme`. Small, but not a one-liner: the effect site does not exist yet. Paseo's ten-variant engine is a separate decision we are not taking: `design-tokens.md` records dark as our default and Paseo's own "paseo" variant |
| **Plugin theme** (`pluginThemeId`) | `appearance-section.tsx:215-222` (one dynamic item per contributed theme) | `null` (`storage.ts:124`) | which plugin-contributed theme `theme:"plugin"` selects (`appearance/provider.tsx:26-31`,`:48-51`) | no plugin themes | **not applicable** |
| **Always expand reasoning** (`autoExpandReasoning`) | `appearance-section.tsx:237-242`, rendered `:685-688` · **uses a `settings.general.*` key** (`en.ts:2146`) | `false` (`storage.ts:141`) | transcript: `agent-stream/view.tsx:352` read → `:759` `defaultExpanded` on the thought slot | **both halves already exist.** `run.thought` is a run event (`packages/protocol/src/domain.ts:400`) and the transcript folds it into a `thought` entry rendered as a collapsed `<details>` (`apps/desktop/src/state/transcript.ts:39`,`:150-158`; `TaskPane.tsx:450-460`). There is no preference, so the summary is always collapsed | **honour-able now** — one boolean, one row, and passing it into the thought row's `defaultExpanded`. No protocol change: the event is already on the wire |
| **Tool call display** (`toolCallDetailLevel`) | `appearance-section.tsx:307-327` (dropdown: overview / detailed) · again a `settings.general.*` key (`en.ts:2151`) | `"detailed"` (`storage.ts:142`) | `agent-stream/view.tsx:353` → `:542-548` `projectToolCallDetailLevel({level})` | `run.tool` is a run event (`domain.ts:401`) and the transcript already renders one row per tool call with its status (`transcript.ts:41`,`:163-190`; `TaskPane.tsx:462-470`). What is missing is the *level*: no projection layer chooses how much of a call to show | **honour-able with work** — events and rows exist; the work is a `detailLevel` parameter plus the overview projection over a call's input and output (`TaskPane.tsx:556` renders "a few readable lines" unconditionally today). Moderate: a real projection, not a pass-through |
| **Chat outline** (`chatOutlineEnabled`) | `appearance-section.tsx:254-259`, rendered `:693-698` (hidden on native) | `true` (`storage.ts:143`) | `agent-stream/view.tsx:354` → `:634` `useChatOutline({enabled})` | no outline component | **not applicable** — worth noting it is `desktopOnly` in practice: a native client never sees the row |
| **Sidebar nav** (`sidebarNavItems`) | `sidebar-nav-section.tsx:142-146`: per item a **switch** (`:126-131`) and **move up/down buttons** (`:108-125`) · `settings.appearance.sidebar.title` "Sidebar" | `[]` = default order, all visible (`storage.ts:86-87`,`:140`) | `sidebar-nav/use-sidebar-nav-items.ts:22` → `components/sidebar/sidebar-nav-rows.tsx:41-42` renders the sidebar's top group | our rail's nav is fixed: `CoderSidebar.tsx` renders a search button, the project list and a footer. No nav group to reorder, no per-item visibility | **not applicable** |
| **Interface font** (`uiFontFamily`) | `appearance-section.tsx:705-715` (commit-on-blur text input) | `""` = platform stack (`storage.ts:130`) | `apply.ts:63`,`:104` — patches `theme.fontFamily.ui` for every theme and (on web) sets a CSS variable | the stack is a literal in `design/tokens.css` | **honour-able with work** — one string setting, sanitised the way Paseo sanitises it (no `;{}<>`, ≤200 chars, control chars rejected — `storage.ts:476-494`, because the value lands in a CSS declaration) and applied by setting one custom property. Real work: the sanitiser, a daemon-side validation, 7 language strings |
| **Interface size** (`uiBaseFontSize`) | `appearance-section.tsx:717-725` | `14` web / `15` native; clamp 10–21 (`storage.ts:48-54`) | `apply.ts:77-81` rebuilds the whole `sm…4xl` ramp by scaling `FONT_SIZE` | `design/tokens.css` defines the scale as literals | **honour-able with work** — a clamped number, and the scale becomes `calc()` over one root variable. The highest-value font row for a laptop-versus-monitor user |
| **Content size** (`contentFontSize`) | `appearance-section.tsx:726-733` | `15` web / `16` native; clamp 10–21 (`storage.ts:55-61`) | `apply.ts:46` sets `theme.fontSize.content` **absolutely** (not scaled) — the transcript's text size | the transcript's size is a token, not a setting | **honour-able with work** — one clamped number, one variable. This is the font row a user actually reaches for |
| **Code font** (`monoFontFamily`) | `appearance-section.tsx:734-744` | `""` = platform mono stack (`storage.ts:131`) | patched for every theme (`apply.ts:64`); read directly by the terminal (`terminal-pane.tsx:219-221`), the diff panel (`panels/diff-panel.tsx:39`,`:41`) and the diff documents | we have no code surface — no editor, no diff — so nothing would change when the user changes it | **must be disabled-with-reason** — show it in the font group, disabled, saying in the user's language that it applies to code views EnvoyCoder does not have yet, and enable it with the diff/explorer slice. Live today it would be a setting that changes nothing, which is the defect this document exists to prevent |
| **Code size** (`codeFontSize`) | `appearance-section.tsx:745-752` | `12`; clamp 9–22 (`storage.ts:62-64`) | `apply.ts:47`,`:65`,`:82` — also derives diff line-height as `round(size × 1.5)` | as above | **must be disabled-with-reason** — same reason, same slice as Code font |
| **Highlight theme** (`syntaxTheme`) | `appearance-section.tsx:467-503` | `"one"` (`storage.ts:135`); 8 options from `packages/highlight/src/themes.ts:36-45`, with **raw English labels, not i18n** | `apply.ts:89`,`:97` `resolveSyntaxColors(syntaxTheme, colorScheme)` patches `theme.colors.syntax` for light and dark | nothing in this repo highlights code | **must be disabled-with-reason** — and note that Paseo's option labels are published theme names (GitHub, Dracula, Nord…), so unlike almost all copy they must **not** be translated when we do enable it |

**Section verdict: `honour-able with work`.** The largest honest win in the document: five rows we can
take (theme, reasoning expansion, tool-call level, interface size, content size), two that must ship
disabled (the code rows), and four rows that are N/A. "With work" rather than "now" because three of
the five need a real projection or scaling layer. **Order matters, and it is §8.2**: theme first,
because a light-mode user is currently stuck with whatever their OS says.

### 4.3 `layout`

`LayoutSection` — `screens/settings/layout/layout-section.tsx` (90 lines), `desktopOnly`
(`settings-screen.tsx:155-160`, content gate `:1498`). It is the **only** renderer of these settings:
grep `settings.layout.` across `packages/app/src` outside i18n returns hits only in that file, and
`LayoutSection` is referenced only from `settings-screen.tsx:54`,`:1498`.

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Open location** (`openInSidePane` — the group) | `layout-section.tsx:71-88`; the five rows below are its fields · `settings.layout.openInSidePane.title` "Open location" | all five fields `false` (`storage.ts:109-115`) | the record itself is not read: each row's field is read at the open site, and the five booleans collapse to one `"side" \| "main"` per source (`layout-section.tsx:65` writes `true` for side, `false` for main) | no panes (§4.3, below) | **not applicable** — a record whose members are the actual settings; the gate names it because it is a field on `AppSettings`, and a reader is owed the statement that the group itself carries no behaviour |
| **Selecting a file in Explorer** (`openInSidePane.explorerFiles`) | `layout-section.tsx:73-80` · `settings.layout.openInSidePane.sources.explorerFiles.label` | `false` (`storage.ts:110`) | `workspace-tabs/open-beside.ts:91` picks `"side"` or `"main"` for every implicit open | no panes, no explorer, no tabs — our shell is a rail plus one pane (`docs/envoycoder-ui.md` §2) | **not applicable** |
| **Opening a diff** (`openInSidePane.diffs`) | `layout-section.tsx:73-80` | `false` (`storage.ts:111`) | `open-supporting-view.ts:43-44`; `open-beside.ts:91` | no diff surface | **not applicable** |
| **Opening a file from an agent chat** (`openInSidePane.chatFiles`) | `layout-section.tsx:73-80` | `false` (`storage.ts:112`) | `open-beside.ts:91`; callers `agent-panel.tsx:1629` | no file pane | **not applicable** |
| **Opening a file from Changes** (`openInSidePane.diffFiles`) | `layout-section.tsx:73-80` | `false` (`storage.ts:113`) | `open-beside.ts:91`; caller `agent-tracks.tsx:111` | no Changes panel | **not applicable** |
| **Opening a subagent** (`openInSidePane.subagents`) | `layout-section.tsx:73-80` | `false` (`storage.ts:114`) | `open-beside.ts:91`; callers `agent-tracks.tsx:77`,`:94` | no subagent track (`docs/paseo-feature-parity.md` #20) | **not applicable** |
| **Opening a pull request from Changes** (`pullRequestOpenLocation`) | `layout-section.tsx:81-86` — a **three**-option select (main / side / explorer) | `"explorer"` (`storage.ts:146`) | `screens/workspace/workspace-screen.tsx:1850` read → `:3023` `openWorkspacePullRequest({destination})`; also `git/diff-pane.tsx:1614` | no git, no pull-request surface | **not applicable** |

**Section verdict: `not applicable`.** Every row answers "where should this open in a multi-pane
workspace", and the answer presupposes panes we do not have. Two details from the source are worth
keeping: the five boolean rows **lose the `explorer` destination** the pull-request row has (only
`pullRequests` is rendered with `allowExplorer`, `:33-40`,`:84`) — an asymmetry rather than a design;
and the `*.description` strings exist in `en.ts:1972-1993` but are **never rendered**, because the row
shows only its label (`layout-section.tsx:47`). Dead copy does not matter by itself; it matters here
because it is exactly what makes a surface look bigger and more finished than it is.

### 4.4 `editor`

`EditorSection` — `screens/settings/editor-section.tsx`, `webOnly` (`settings-screen.tsx:161`, gate
`:1541`). One setting, and it is the whole section:

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Vim keybindings** (`vimKeybindings`) | `editor-section.tsx:24-29` (switch) · `settings.editor.vimKeybindings` "Vim keybindings" | `false` (`storage.ts:144`) | `file-pane/pane.tsx:491` seeds the editor's mode (`"NORMAL"` or `null`) and `:611` passes `vimEnabled` to the file editor view | no file editor at all | **not applicable** |

**Section verdict: `not applicable`.** A section whose only setting configures an editor we do not
ship. When a file pane lands (`docs/paseo-feature-parity.md` #12) this is one row inside it, not a
settings section.

### 4.5 `shortcuts`

`KeyboardShortcutsSection` — `screens/settings/keyboard-shortcuts-section.tsx` (556 lines),
`desktopOnly` (`settings-screen.tsx:162`, gate `:1543`). On native the section body is a read-only
notice (`:429-437`). **The largest single section in the product**: 43 remappable rows, one per binding
that carries a `help` block and passes the platform predicate (`keyboard-shortcuts.ts:1666-1723`),
drawn from 76 declared bindings.

| item | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **43 binding rows** (one override each) | `keyboard-shortcuts-section.tsx:455-487` — per row an actions dropdown (Bind/Rebind, Clear, Reset to default) then an inline capture row; labels `settings.shortcuts.help.*` | the shipped default combo per binding, declared beside it in `keyboard-shortcuts.ts` | an override is resolved by action → `routeKeyboardShortcut` (`route-shortcut.ts:174-222`) → the action id the shell implements; consumed at `hooks/use-keyboard-shortcuts.ts:66`,`:230`,`:261` and by every badge via `hooks/use-shortcut-keys.ts:15` | **the layer exists and is mounted; overrides do not.** `apps/desktop/src/input/shortcuts.ts` declares `SHELL_BINDINGS` (`:222-231`, **8** bindings), `createShortcutRegistry` resolves a keystroke to a binding (`:178-220`) with focus scopes and IME guarding, `useShortcuts` mounts it once (`useShortcuts.ts:40-73`) and `CoderApp.tsx:166-192` binds six of the eight to real actions. `SHELL_BINDINGS` is a `const` and nothing reads an override map | **honour-able with work** — the missing work is a persisted `Record<bindingId, combo \| null>` plus an "effective bindings" builder, exactly as Paseo does it (`buildEffectiveBindings`, `keyboard-shortcuts.ts:1212-1238`). Two things make it *work* rather than *now*: our table must first grow to cover the actions the UI actually has — a help sheet listing 8 of ~20 user-visible actions is worse than none — and our own decision that conflicts are **reported, not silently resolved** (`input/shortcuts.ts:19-24`, `findConflicts` `:141`) needs a place to report them |
| **Reset all** | `keyboard-shortcuts-section.tsx:439-443`, rendered only when overrides exist · `settings.shortcuts.actions.resetAll` (`en.ts:2304`) | — (action) | clears the whole override map (`shortcut-override-store.ts:86-96`) | — | **honour-able with work** — same slice; per-binding reset without reset-all is a support burden |

**What is honest in Paseo's version, and what is not.** Every row that renders is remappable: rendering
and remapping use the *same* platform predicate (`keyboard-shortcuts.ts:1366-1373`, used by both
`:1666-1723` and `:1526-1540`), so there is no rendered-but-unbindable row and no override that
half-applies. Two bindings are deliberately **fixed and unlisted** — no `help` block, therefore never
rendered and never overridable: `Ctrl+\`` for `sidebar.toggle.right` (`:948-952`) and `Enter` for
dictation-confirm (`:1152-1157`). So rebinding "Toggle Explorer sidebar" changes `Cmd/Ctrl+E` only,
and `Ctrl+\`` still fires. That is a real trap and it is not disclosed on screen. Three more drifts we
should not copy: **11 pane rows are mac-only** and are simply absent on Windows and Linux
(`when:{mac:true}`, `:718-837`) — the same mac-first defect our `input/shortcuts.ts:12-24` already
documents and rejects; one row's label is untranslated (`pin-workspace` has no
`SHORTCUT_HELP_LABEL_KEYS` entry, `:206-250`, so it falls back to raw English "Pin chat"); and four
help keys exist with no binding at all (`switchProject`, `newWorktree`, `sendMessage`, `queueMessage`).

**Section verdict: `honour-able with work`.** High value — a keyboard-first user is a coding-agent
user — and the machinery is half-built. It is **last** in §8's order (§8.5), behind the small
settings, because a shortcut editor over eight bindings is a demo rather than a feature, and the
table has to grow before the editor is worth having.

### 4.6 `integrations`

`IntegrationsSection` — `packages/app/src/desktop/components/integrations-section.tsx`, `desktopOnly`
(`settings-screen.tsx:163-168`, gate `:1542`). **Zero persisted settings.** It self-hides unless the
desktop daemon is in use (`:19`,`:50`), and contains exactly one action — **Install** the Paseo CLI
(`:72-76`) — one docs link (`:34-49`, `https://paseo.sh/docs/cli`, `:14`) and a read-only "Installed"
status (`:66-70`).

**What it integrates with, verified:** *only the Paseo CLI.* Not MCP — `mcp.enabled` /
`mcp.injectIntoAgents` are daemon settings rendered in the host `agents` page (§5.5). Not editors —
that is the `webOnly` `editor` section (§4.4). Not git — `git.maxProcessesPerSecond` and
`git.maxProcessConcurrency` are daemon config keys with **no settings UI at all** (grep for both under
`packages/app/src` returns zero hits; §6). The install machinery lives in the **Electron main
process**, not the daemon: `packages/desktop/src/integrations/cli-install/install.ts:21-66` symlinks a
bundled shim into `~/.local/bin` (or writes a `.cmd` trampoline on Windows, `:35-52`) and then edits
the user's shell rc (`ensurePathInShellRc()`, `:60`). The installed CLI is a *client* of the daemon;
the install action never touches it.

**Section verdict: `not applicable`.** The action installs a CLI we do not ship, from a shell we do
not use (Tauri, not Electron), by rewriting the user's shell rc files. There is no row here we could
honour and no row worth disabling.

### 4.7 `notifications`

`DesktopNotificationsSection` — `packages/app/src/desktop/components/desktop-notifications-section.tsx`,
`desktopOnly` (`settings-screen.tsx:169-174`, gate `:1544`).

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Play sound** (`notifications.playSound`) | `:100-109` (switch, `testID="desktop-notifications-play-sound-switch"`) · `settings.notifications.playSound` "Play sound" (`en.ts:2006`) | `true` (renderer mirror `desktop/settings/desktop-settings.ts:34`; authoritative default in `packages/desktop/src/settings/desktop-settings.ts:35`) | Electron: `silent: !settings.notifications.playSound` on the `paseo:notification:send` handler (`packages/desktop/src/features/notifications.ts:104`). It toggles the OS notification's **silent** flag — the app plays no audio file itself | `grep -rn "notification" apps/desktop/src apps/desktop/src-tauri/src` finds only the ACP `session/cancel` *protocol notification* and the store's own event fan-out — **no OS notification path, no Tauri notification plugin, no tray** | **not applicable** — there is no notification to silence. `docs/paseo-feature-parity.md` #13 puts notifications in Tier 2, and the honest prerequisite is an attention event, not a settings row |

The section also contains three **actions** — Request permission (`:91-97`), Send test (`:120-129`),
Refresh (`:58-72`) — and a read-only permission pill (`desktop-permission-row.tsx:55-59`). One
observation worth carrying forward if we ever build notifications: on Electron Paseo's permission row
is effectively hard-wired to "Granted", because `desktop-permissions.ts:137-150` reports
`Notification.isSupported()` (always true on macOS) rather than the OS authorization state — so the
row and the test button's disabled gate can both read "fine" while the OS is refusing. We would want
the real state, which means not copying this row's implementation.

**Section verdict: `not applicable`.** No notification subsystem, therefore nothing to configure. If
one lands, it arrives with its own settings and Section 4.7's row is then a `honour-able now`.

### 4.8 `permissions`

`DesktopPermissionsSection` — `packages/app/src/desktop/components/desktop-permissions-section.tsx`,
`desktopOnly` (`settings-screen.tsx:175-180`, gate `:1545`). **Zero persisted settings.** The section
guards on `isDesktopApp` (`:65-67`) and renders exactly **one row: Microphone**
(`settings.permissions.microphone`, `en.ts:2379`), plus a Refresh action (`:40-54`).

**What it does, verified:** the permission is genuinely **OS-level**, but read through Chromium Web
APIs rather than Electron — `navigator.permissions.query({name:"microphone"})` at
`desktop-permissions.ts:182`, and the request is `navigator.mediaDevices.getUserMedia({audio:true})`
at `:285` followed by stopping every track (`:286-291`). There is **no** `systemPreferences` /
`askForMediaAccess` / `getMediaAccessStatus` anywhere in that repo (zero hits): the macOS TCC prompt is
triggered implicitly by Chromium. And **nothing in the app consults this permission before capturing** —
the only consumer of the snapshot is the row itself; the real capture sites call `getUserMedia`
directly (`voice/audio-engine.web.ts:305`, `hooks/use-audio-recorder.web.ts:195`,
`hooks/use-dictation-audio-source.web.ts:270`) and simply fail when it is refused.

**Section verdict: `not applicable`.** We have no microphone use and request no OS permissions; the
shell's own `capabilities` file is the right (and only) place for that when it arrives. Recording the
read-side finding anyway, because it is a design lesson: **a permission surface that only displays
state, with no gate at the use site, tells the user their consent mattered when it did not.** Our
equivalent — the refusal that must be shown in the user's language — is a gate, not a row.

### 4.9 `diagnostics`

`DiagnosticsSection` — `screens/settings-screen.tsx:525-591`.

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Use legacy terminal renderer** (`useLegacyTerminalRenderer`) | `:542-559` (switch, `isNative`-only per `:541`) · `settings.diagnostics.legacyTerminalRenderer.label` (`en.ts:2179`) | `false` (`storage.ts:129`) | picks the renderer implementation for the terminal: `terminal/native-renderer/terminal-renderer-capability.ts:3-11` → `components/terminal-emulator.native.tsx:29-42` chooses `WebViewTerminalEmulator` or `NativeGridTerminalEmulator` | no terminal at all, and the row is native-only besides | **not applicable** |

The section's other two controls are **one-shot actions**, not settings: **Run app diagnostic**
(`:561-569`) opens the diagnostic overlay (`diagnostics/store.ts:11` → `app-diagnostic-host.tsx:7-8`),
and **Play test** (`:570-587`) decodes a bundled PCM tone and plays it through the voice audio engine
(`:1303-1330`). Nothing else is exposed — no log export, no daemon reset.

**Section verdict: `not applicable`** as a *settings* section. But the two actions have real
analogues that already ship in our pane: the daemon version chip and `stateDir` chip
(`SettingsPane.tsx:50-63`), and the daemon's own quarantined-file notes rendered as sentences
(`SettingsPane.tsx:212-223`). Our diagnostics story is "the daemon says what it could not read", which
is strictly better than a settings page holding one switch. No row to add.

### 4.10 `about`

`AboutSection` — `screens/settings-screen.tsx:599-622`, with `WhatsNewRow` (`:624-649`),
`ConnectedHostsSection` (`:657-677`) and `DesktopAppUpdateRow` (`:747-876`).

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Release channel** (`releaseChannel`) | `:828-841` (segmented: Stable / Beta) · `settings.about.releaseChannel.label` "Release channel" (`en.ts:2213`) | `"stable"` (renderer mirror `desktop/settings/desktop-settings.ts:32`) | **purely client-side**: `autoUpdater.allowPrerelease = releaseChannel === "beta"` and `autoUpdater.channel = beta ? "beta" : "latest"` (`packages/desktop/src/features/auto-updater.ts:153-154`), plus staged-rollout admission at `app-update-rollout.ts:25`. Zero reads in `packages/server/src`, `packages/protocol/src` or `packages/client/src` | there is **no updater of any kind**: no update check, no download, no installer handoff, nothing in the Tauri shell that could host one | **not applicable** — a channel selects a release feed, and we have no feed. If we ever ship an About page this becomes the canonical **must be disabled-with-reason** row: it is exactly the control a user would press and be misled by |

**Actions** in this section (not settings): Check for updates (`:856-863`, plus an automatic silent
check on focus at `:761-769`), Install update (`:864-871`), a **What's new** row (`:629-634` →
`changelog/open-changelog.ts:4-6`), and three community links (`components/community-links.tsx:13-25`).
**Read-only display** rows: the app version (`:605-611`, from `resolveAppVersion()`), the per-host
daemon version with a mismatch hint (`HostVersionRow` `:679-731`), and the update status text
(`:844-853`).

**Section verdict: `honour-able with work`.** Not for the channel, but because two of its display rows
are genuinely useful to us and one is nearly free: our `hello.version` and `hello.stateDir` already
arrive at connect (`SettingsPane.tsx:50-63`) and the window already knows its own version — Paseo's
**version-mismatch hint** (`settings.about.versionDiffers`, `:701-702`,`:724-726`) is the honest
addition a control plane wants when a daemon and a window update on different days. "With work"
because it needs a version string on our own `hello` if it is not already there, and a decision about
where the page lives.

### 4.11 App settings with no settings-screen section

Four of the twenty-six app settings are **not edited from any of the ten sections**: they live in the
sidebar's own display-preferences popover (`components/sidebar/display-preferences/model.ts:65-75`).
They are real settings, they persist in the same `@paseo:app-settings` blob, and the gate finds them
in `AppSettings` — which is exactly why the doc must account for them.

| setting | control · label | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Workspace title source** (`workspaceTitleSource`) | `display-preferences/model.ts:65-75` · sidebar popover (`settings.sidebarDisplay.*`) | `"title"` (`storage.ts:136`) | each sidebar row shows the workspace title or its branch name | our rows show the task title, with the project as a header and the branch as a chip (`TaskPane.tsx:232-234`) — no per-row source choice | **honour-able with work** — a genuinely simple per-row display preference and the only row in this group we can honour; needs one field, one row, and the row's renderer honouring it |
| **Row trailing** (`sidebarWorkspaceTrailing`) | `display-preferences/model.ts:66`,`:99-102` | `"diff"` (`storage.ts:137`) | what sits at the right edge of a row: a diff count, a timestamp, or nothing | our rows carry a status dot and a needs-attention marker, not a trailing metric; there is no diff count to show and no timestamp on the row | **not applicable** — "diff" has no source here and adding a timestamp to make the enum non-empty would be building the control rather than the feature |
| **Row items** (`sidebarRowItems` and its six nested keys `sidebarRowItems.branch`, `sidebarRowItems.project`, `sidebarRowItems.host`, `sidebarRowItems.changeRequest`, `sidebarRowItems.services`, `sidebarRowItems.labels`) | `display-preferences/model.ts:67`,`:83-86`; keys from `SIDEBAR_ROW_ITEMS` (`components/sidebar/display-preferences/row-items.ts:14-21`) | `{branch:false, project:false, host:true, changeRequest:true, services:true, labels:true}` (`row-items.ts:29-36`) | six independent "may this fact appear on a row" flags, merged over the defaults on read (`storage.ts:294-299`) | **our row is not Paseo's row.** Theirs is a workspace row inside a project heading; ours is a *project* row with task rows beneath it (`docs/envoycoder-ui.md` §1), so `project` and `host` have no place to appear and `changeRequest`, `services` and `labels` have no data source | **not applicable** — all six, for the same structural reason. This is the clearest case in the document where copying the control would be copying a shape we deliberately do not have |
| **Checks display** (`sidebarChecksDisplay`) | `display-preferences/model.ts:68`,`:91`; `iconAndText` / `icon` / `none` (`checks-display.ts:15-17`) | `"iconAndText"` (`checks-display.ts:17`) | three-state display mode for CI check status on a row — its own setting rather than a row item, because it has three answers rather than two | no CI/checks data | **not applicable** |

**Group verdict: `not applicable`, with one exception** (`workspaceTitleSource`, `honour-able with
work`). The lesson this group carries is the one §9 exists to state: **the gate found these because
they are fields on a schema, not because a settings page renders them.** A coverage rule built only on
"what the settings screens touch" would have missed them entirely, and they are precisely the kind of
setting that gets half-implemented.

## 5. Host-scope settings

The daemon's mutable settings are one Zod object, `MutableDaemonConfigSchema`
(`paseo/packages/protocol/src/messages.ts:218-256`), with a narrower patch schema beside it
(`:258-277`). Nineteen fields, plus `removeProviders` which exists only in the patch schema. Eleven of
the nineteen surface in a settings page; the other eight are config-file/environment only and are §6.

### 5.1 `host` — Overview

`HostSettingsPage` — `screens/settings/host-page.tsx:351-384`.

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **host name** | `host-appearance-section.tsx:291-301` (button → rename modal, `:49`) · `settings.host.appearance.name.label` "Name" (`i18n/resources/en.ts:2393`) | seeded from the daemon hostname (`runtime/host-runtime.ts:1866-1870`); display fallback `label.trim() \|\| serverId` (`hosts/appearance.ts:86`) | rendered as the host title (`host-page.tsx:369`) and the sidebar badge label (`hosts/host-badge.tsx:48,57`) | no host registry: one loopback daemon, `hello.stateDir`/`hello.version` chips only (`SettingsPane.tsx:50-63`) | **not applicable** — a rename needs a list of hosts to distinguish between; there is one |
| **host colour** | `host-appearance-section.tsx:123-151` · `settings.host.appearance.color.label` "Color" (`en.ts:2396`) | `"none"` (`hosts/appearance.ts:28-30`); 11 options | `selectHostBadges` (`hosts/appearance.ts:87`) → badge glyph and label colour (`host-badge.tsx:53,56,67`) | no `data-theme`/per-host colour state anywhere in TS; the shell is one host | **not applicable** |
| **sidebar badge** | `host-appearance-section.tsx:154-193` · `settings.host.appearance.badge.label` "Sidebar badge" (`en.ts:2413`) | stored `null`; resolved `hidden` for local, `name` for remote (`hosts/appearance.ts:37-49`) | shown in the sidebar badge row (`host-badge.tsx:55`) | no badge subsystem | **not applicable** |
| **Daemon lifecycle, as the storage names it** (`daemon`, `daemon.manageBuiltInDaemon`, `daemon.keepRunningAfterQuit`) | the two rows below; the `daemon` object is the group `packages/app/src/desktop/settings/desktop-settings.ts:17-20` declares | `daemon.manageBuiltInDaemon` `true`, `daemon.keepRunningAfterQuit` `false` (`:38-39`) | the group itself does nothing — the two members do, and the *renderer* mirrors both from the desktop shell (`loadSettingsFromStorage`, `hooks/use-settings/storage.ts:409-419`) | as the two rows below | **not applicable** for the bare `daemon` group (a wrapper, not a setting); the two members are **honour-able now**, below |
| **Manage built-in daemon** (`daemon.manageBuiltInDaemon`) | `desktop-updates-section.tsx:259-264` · `desktop.daemon.management.title` "Manage built-in daemon" (`en.ts:1316`) | `true` (`desktop/settings/desktop-settings.ts:38`) | desktop shell: `assertBuiltInDaemonManagementEnabled` (`packages/desktop/src/daemon/daemon-manager.ts:267-269`) gates every daemon start/stop | **the behaviour exists**: the Tauri shell starts the daemon and knows whether it *started* or *attached* (`apps/desktop/src-tauri/src/main.rs:3-27`, `:154`) — but there is no stored preference and no control | **honour-able now** — the shell already distinguishes started-from-attached; it needs a persisted field, a writer in `main.rs`, and one row |
| **Keep daemon running after quit** (`daemon.keepRunningAfterQuit`) | `desktop-updates-section.tsx:271-276` · `desktop.daemon.keepRunning.title` "Keep daemon running after quit" (`en.ts:1329`) | `false` (`desktop/settings/desktop-settings.ts:39`) | shell: on quit, keep it (`packages/desktop/src/daemon/quit-lifecycle.ts:56`) | same shell, same absence of a field | **honour-able now** — a boolean in the shell's own settings file plus the quit path already in `main.rs` |

**Two spellings of one setting, which is worth recording.** Paseo's source names the daemon
lifecycle pair twice — nested on `DesktopSettings` and flattened onto the combined `Settings` object
(`hooks/use-settings/storage.ts:117-120`, composed at `index.ts:221-226`). Reading either one alone
finds half the surface, which is why the extractor reads all three declarations and why the gate's
failure message names the declaration an item came from. Both spellings get a verdict:

| spelling | declared | verdict |
|---|---|---|
| `daemon.manageBuiltInDaemon` / `manageBuiltInDaemon` | nested `desktop/settings/desktop-settings.ts:17-20`; flat `storage.ts:118` | **honour-able now** — the shell already knows whether it started the daemon or attached to one, so the field and the control are the whole work |
| `daemon.keepRunningAfterQuit` / `keepRunningAfterQuit` | nested `desktop/settings/desktop-settings.ts:20`; flat read in the renderer mirror `desktop-updates-section.tsx:37` | **honour-able now** — a boolean in the shell's own settings file and one branch on its quit path |

**Section verdict: `not applicable`.** Three of its five rows are per-host identity, which a
one-daemon install cannot use; the useful two are shell lifecycle and belong in our Settings pane's
own "This machine" group, not in a copied Overview page. Three of Paseo's own host-page rows are
**actions** (`RestartDaemonCard` `host-page.tsx:558-665`, `UpdateDaemonCard` `:673-857`,
`RemoveHostSection` `:1125-1305`) — a settings section that is 60% buttons is a shape worth not copying.

### 5.2 `projects`

`ProjectsScreen` — `screens/projects-screen.tsx:24-84`. **Zero settings.** The screen is a card of
project rows whose only effect is navigation — `openProjectSettings(host.serverId, host.projectId)`
(`:115`) → the separate route `screens/project-settings-screen.tsx` (1273 lines), which persists
through the daemon RPC `writeProjectConfig({config, expectedRevision})` (`:503` →
`server/session.ts:2728-2729`).

**Not inventoried row by row here, and that is a stated limit:** `project-settings-screen.tsx` is
reached from the projects row, not from `HOST_SECTION_ITEMS`, so the gate cannot enumerate it (§9).
It is the per-repo config surface — commands, metadata prompts, worktree rules — and it deserves its
own pass before we build our per-project defaults screen.

**Section verdict: `honour-able with work`.** This is our own `docs/paseo-feature-parity.md` #17, and
the model already exists: `resolveTaskDefaults` (`packages/task-model/src/index.ts:88-105`) already
resolves explicit → project → app → fallback, and `store.ts:330-332` already feeds it app defaults.
What is missing is the screen. **The bug this area had is fixed, and it is worth remembering what it
was:** the sidebar rendered a project row button labelled *"Project settings for {project}"* whose
handler is `onOpenProjectSettings={() => setSettingsOpen(true)}` — it opened **app** settings and
discarded the project argument, the same defect class as a setting that does nothing. §8.1 item 2 is
the fix, and the control is a row menu now (`components/RowMenu.tsx`): its trigger is named *"Actions
for {project}"*, and *"Project settings"* is an item inside it that carries the project through.

**And this is the section Paseo keeps its projects list in, so it is where ours went.** The app scope
now carries a **Projects** section: one row per registered project, the label over the path in the same
two bands every setting row uses, and pressing a row opens *that* project's settings in the same pane
(`SettingsPane.tsx:359-377`; the row shape is `SettingNavRow`, `SettingsRows.tsx:112-136`). A project's
scope carries a back control that names its destination — *"All settings"* — instead of leaving Close as
the only way out (`SettingsPane.tsx:559-563`, rendered `SettingsShell.tsx:50-60`). §7.5 is the whole
model, stated once.
The list itself is now level 2 (`SettingsPane.tsx:444-493`), with the app scope keeping one row
(`:359-377`).
The section is **navigation only**: a project's own rows stay in the project scope, because a control
that edits a project under the heading *Settings* is a control labelled with a scope it does not have.

What remains of Paseo's `projects` section is what §9's fourth blind spot names: their separate
`project-settings-screen.tsx` (1273 lines) — per-repo commands, metadata prompts, worktree rules — of
which our project scope implements the three `Project.defaults` fields and nothing yet.

### 5.3 `connections`

`HostConnectionsPage` → `ConnectionsSection` — `host-page.tsx:237-250`, `:386-492`. **Zero settings.**
The card maps `host.connections` into rows whose only control is a destructive **Remove**
(`:546-553`), removing the host from `@paseo:daemon-registry` (`runtime/host-runtime.ts:1933-1960`).

**Section verdict: `not applicable`.** There is no connection list: one loopback daemon, and the
remote path is deliberately refused until a session store exists —
`coderSessionIdentity` resolves no session and the transport fails closed
(`packages/host-bridge/src/index.ts:574-598`), and `docs/envoycoder-paseo-inheritance.md` §4.1 records
why our pairing model is authority-free rather than Paseo's bearer link.

### 5.4 `pair-device`

`HostPairDevicePage` — `host-page.tsx:252-265`, page body `desktop/components/pair-device-section.tsx`.

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Enable relay** | `pair-device-section.tsx:209-217` · `pairing.device.enableRelay` "Enable relay" (`en.ts:1735`) | enabled `true` (`server/bootstrap.ts:531`; store `daemon-config-store.ts:337`) | daemon: `onFieldChange("relay.enabled")` starts/stops the outbound relay transport (`bootstrap.ts:1740` → `server/relay-runtime.ts:50-63`) | we have **no relay to enable** — the mesh is the transport (`docs/paseo-feature-parity.md` #26) | **not applicable** — EnvoyCoder's remote path is the mesh node it attaches to, not a relay the daemon dials; there is no relay process to switch on |

**Section verdict: `honour-able with work`.** Not for `relay`, but because the section's *reason to
exist* — "let my phone reach this machine, and let me revoke that" — is real and unimplemented. The
contract is already written and cited: `checkPairingCode` (`host-bridge/src/index.ts:514-556`) reads a
family pairing code and refuses another product's in the family's shared sentence, and
`coder.pairDevice` is **deliberately absent from the dispatcher catalogue** because minting a
credential is the node's act, not a product's (`host-bridge/src/index.ts:606-612`). What is missing is
the session store the daemon's own comment names as roadmap M1 in the same block.

### 5.5 `agents`

`HostAgentsPage` — `host-page.tsx:267-293`: three cards plus two sub-sections; if the host is not
connected it renders one sentence (`:285-287`).

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Enable Paseo tools** (`mcp.injectIntoAgents`) | `host-page.tsx:888-892` · `settings.host.orchestration.enableTools.title` "Enable Paseo tools" (`en.ts:2494`) | UI reads `!== false` (`:889`) → **on**; the daemon's config layer resolves `?? false` (`server/config.ts:531`) — the two disagree, recorded here rather than resolved | daemon injects its MCP tool server into every agent session (`bootstrap.ts:1604-1618`, `onFieldChange` `:1614`) | no MCP injection at all: our agents are ACP programs launched through `packages/agent-catalog`, and the ext-agent contract has no MCP server to hand them | **not applicable** — the setting exists to inject a tool catalog we do not have |
| **Browser tools** (`browserTools.enabled`) | `browser-tools-card.tsx:60-66` · **hardcoded English**, no i18n key (`browser-tools-config.ts:3-5`) | `false` (`protocol/src/messages.ts:186`, `:244`) | daemon registers 22 `browser_*` agent tools (`server/agent/tools/paseo-tools.ts:1208-1215` ← `browser-tools/policy.ts:10-19`); off means the agent has no browser tools | no browser subsystem, no Electron `<webview>` host, no automation broker | **not applicable** — and it is worth noting Paseo's own copy here is untranslated, which is a defect we would not copy |
| **System prompt** (`appendSystemPrompt`) | `host-page.tsx:1028-1087` (modal text area) · `settings.host.orchestration.systemPrompt.title` "System prompt" (`en.ts:2499`) | `""` (`messages.ts:249`) | daemon appends it to every session's system prompt (`bootstrap.ts:1619-1621` → `agent-manager.ts:5092-5105`; consumed by each provider, e.g. `providers/claude/agent.ts:3232`) | `grep systemPrompt` over `packages/` and `apps/desktop/src` → **zero hits**: our daemon never composes a system prompt; the harness owns it | **honour-able with work** — and the work is **upstream**. A session system prompt is a term in the harness session contract, which lives in `@envoymesh/envoy-harness` (a peer checkout, family guide §7.5). Adding a daemon-supplied preamble needs the field on that contract first (§7.4), then `CoderSettings.appendSystemPrompt`, then the effect in `runs.ts` where the session config is built |
| **Orchestration skills** — `skills.selection` (`{mode:"all"}` vs a chosen list) | `agent-skills/index.tsx:148-155` → `selection-sheet.tsx:166-172` (switch) + `:185-194` (checkbox rows) · `settings.host.skills.*` "Orchestration skills" (`en.ts:2446`) | `{ mode: "all" }` (`server/orchestration-skills/internal/selection-store.ts:18`) | daemon computes the desired set and **creates, replaces and deletes skill directories** under `~/.agents`, `~/.claude`, `~/.codex` (`orchestration-skills/internal/operations.ts:71-80`, `controller.ts:79-107`) | no skills subsystem and no `.agents`/`.claude`/`.codex` skill dirs; our agents get capabilities from the ACP catalogue | **not applicable** — a setting that deletes files in the user's home for a skill format we do not ship |
| **Agent profiles** — 9 fields: name, icon, colour, provider, model, mode, thinking, features, notes | `agent-profiles/settings/agent_profile-edit-modal.tsx:229-396` (per-field lines below) · `settings.host.agentProfiles.sectionTitle` "Agent profiles" (`en.ts:2541`) | whole list `undefined` → `[]` (`messages.ts:251`); per-field defaults in the "what it does" cell | one `AgentProfileSchema` (`messages.ts:164-182`) = a named launch bundle. Read twice: **client** applies it to the composer or a live agent (`agent-profiles/internal/use-agent-profile-picker.ts:131-155`) · **daemon** exposes it to orchestrating agents via the `list_profiles` MCP tool (`agent/tools/paseo-tools.ts:2932-2954`) | no profile concept. Our composer already carries agent/model/thinking per task (`TaskPane.tsx:134`, `packages/agent-catalog/src/session-options.ts`) but nothing is a saved, named bundle | **honour-able with work** — the *storable* half is straightforward (one protocol type, one settings array, one list editor) and the picker half builds on `resolveTaskDefaults`; the `notes`→`list_profiles` half is **not applicable** until an MCP tool surface exists |

Field-level detail for the profile modal, because "nine fields" is the kind of claim that hides work:

| field | control, `file:line` | default | read by |
|---|---|---|---|
| name | text input, `agent-profile-edit-modal.tsx:245-255` | required, `""` | client picker label; daemon `list_profiles` |
| icon | icon-grid popover, `:229-238` → `agent-profile-appearance-field.tsx:55-93` | unset → default glyph (`internal/profile-appearance.ts:56-67`) | client only |
| colour | swatch grid, `agent-profile-appearance-field.tsx:95-133` | `"none"` (`internal/profile-appearance.ts:69-71`) | client only |
| provider | select, `:260-275` | required (`messages.ts:172`) | client picker filter (`use-agent-profile-picker.ts:84`); daemon tool |
| model | select, `:278-292` | optional (`messages.ts:173`) | same |
| mode | select, `:296-310` | optional (`messages.ts:174`) | same |
| thinking | select, `:314-328` | optional (`messages.ts:175`) | same |
| features | switch or select per feature, `:331-348`, `:403-491` | `{}` (`internal/materialize-profile.ts:28`) | same |
| notes | text area, `:356-367` | optional (`messages.ts:178`) | daemon `list_profiles` only — **the one field a human writes for a machine to read** |

**Section verdict: `not applicable`.** Four of its five rows are subsystem we do not have; the fifth
(agent profiles) is a real gap, is recorded above as `honour-able with work`, and belongs in our
Settings pane as its own group rather than inside a copied "Agents" page whose other three cards we
would have to render disabled.

### 5.6 `metadata`

`MetadataGenerationPage` — `screens/settings/metadata-generation-page.tsx:19-164`.

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Model selection** (`metadataGeneration.providers` mode) | `:129-135` (segmented: Automatic / Manual) · `settings.metadataGeneration.selection` "Model selection" (`en.ts:2095`) | derived, not stored: `configuredProvider ? "preferred" : "automatic"` (`:29`) | Automatic persists `providers: []`; Manual persists **nothing on its own** (`:66` — the write happens only when a model is picked) | no generated text of any kind: our tasks, branches and commits are named by the user or the harness | **not applicable** |
| **Model** (`metadataGeneration.providers[0]`) | `:137-160` (combobox) · `settings.metadataGeneration.model` "Model" (`en.ts:2100`) | `null` (`:28`) | daemon inserts the configured provider ahead of its built-ins (`server/agent/structured-generation-providers.ts:46`,`:244-252`) for **workspace titles and branch names** (`workspace-auto-name.ts:183-194`), **commit messages** and **PR drafts** (`session/checkout/git-metadata-generator.ts:116-167`) | no git subsystem, no generated titles | **not applicable** |

**Section verdict: `not applicable`.** Both settings choose *which model writes text we never
generate*. A useful detail for anyone who later builds generated titles: the page's own comment
structure shows "Manual" persisting nothing, so a naive copy would ship a control that half-works —
exactly the defect this document exists to catch.

### 5.7 `workspaces`

`HostWorkspacesPage` — `host-page.tsx:295-317`.

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Archive merged PR workspaces** (`autoArchiveAfterMerge`) | `host-page.tsx:926-931` · **hardcoded English**: "Archive merged PR workspaces" (`:921`) | `false` (`messages.ts:247`) | daemon: unless exactly `true`, the merge subscription bails and clears its open-PR latch, so a merged PR never auto-archives (`server/auto-archive-on-merge/index.ts:39`) | `task.worktree` exists on the wire (`protocol/src/domain.ts:247`, `rpc.ts:364`) and `TaskPane.tsx:232-234` renders a branch chip — but there is **no git service**, so nothing detects a merge | **honour-able with work** — the setting is one boolean and the effect is a daemon-side subscription; both are downstream of a git service we do not have (`docs/paseo-feature-parity.md` #8/#9). Until then it has nothing to switch |

**Section verdict: `must be disabled-with-reason`.** This is the case the vocabulary exists for: the
row is meaningful to a user, we cannot honour it, and the honest move is to show it once — disabled,
saying in the user's language that auto-archiving needs git support that is not built yet — rather
than to leave a user wondering whether it is broken. But it needs the git subsystem to be worth a row
at all, so **ship the disabled row with the git slice, not before it.**

### 5.8 `providers`

`HostProvidersPage` → `ProvidersSection` — `host-page.tsx:319-331`, `screens/settings/providers-section.tsx:326-474`.

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Enable {provider}** (`providers[id].enabled`) | `providers-section.tsx:248-253`, per provider · `settings.providers.enableProvider` "Enable {{name}}" (`en.ts:2651`) | `true` (`:444`; daemon `server/agent/provider-registry.ts:737`) | daemon: only enabled providers get a client; disabled ⇒ `unavailable`, `listModels` throws "Provider X is disabled" (`provider-registry.ts:375-377`,`:752-754`,`:836-837`) | our equivalent is the ACP catalogue: the pickers filter on `knownMissing()` (`composer/agent-for.ts`, used by `SettingsPane.tsx:40` and the project defaults) and list every catalogue entry except one established to be absent | **not applicable as a *setting*** — availability in EnvoyCoder is a fact we detect (`HarnessSummary.availability.state`, five states: §7.9), not a switch the user throws. Making it a switch would let a user hide a working agent for no reason |
| **Add provider** (`providers[id]` from the ACP catalogue) | `provider-catalog-list.tsx:108-118` · `providerCatalog.actions.add` "Add" (`en.ts:1587`) | — (action) | persists `{providers:{[id]:{extends:"acp",label,description,command,env,params}}}` (`hooks/use-acp-provider-catalog.ts:11-26`) so a third-party ACP CLI becomes runnable | **the plumbing landed; the picker has not.** `AgentProviderConfig` (§7.10) is a provider's shape — id, label, command, args, the **names** of the environment variables it needs, and the dialect it speaks — and `coder.listProviders` / `coder.addProvider` / `coder.removeProvider` store them in `<state>/EnvoyCoder/providers.json` (quarantined rather than emptied when unreadable, replaced rather than merged per id, `providers` broadcast so a second window refetches). Every listed provider is **probed** by the same prober that answers for the nine shipped agents and launched through the same `launchForHarness` body, so its row carries one of the same five `availability` states. What is still absent is the surface: no control adds one, and the 38-entry catalogue is still unreachable from the window | **honour-able with work** — and the work is now one surface rather than a protocol change: a list editor and the catalogue rows, both reading methods that exist. The **security decision** is recorded rather than deferred — `env` is a list of names, so a credential cannot be expressed in the schema, written to disk or logged (§7.10) |
| **Remove provider** (`removeProviders`) | `providers-section.tsx:155-164` (menu + confirm) · `settings.providers.actions.remove` (`en.ts:2658`) | — (action) | daemon strips the entry, its overrides **and** its `metadataGeneration.providers` entries (`daemon-config-store.ts:101-159`) | `coder.removeProvider` forgets one provider and nothing else — it refuses with `envoycoder.provider-missing` when there is nothing under that id, rather than confirming a removal that did not happen. Nothing refers to a provider today, so unlike `coder.removeProject` there are no rows to archive: a task names a `HarnessId` | **honour-able with work** — wire done and tested over a real socket; the menu item waits for the picker above |
| **Add custom model** (`providers[id].additionalModels`) | `provider-diagnostic-sheet.tsx:199-234` (modal form) · `settings.providers.models.addCustomTitle` "Add custom model" (`en.ts:2678`) | `[]` (`provider-registry.ts:735`) | merged on top of discovered models (`provider-registry.ts:383-396`,`:651`): the picker gains ids without replacing the catalogue | our catalogue ships a fixed `models` list per agent (`packages/agent-catalog/src/models.ts`) with no user additions. **Half of this row landed since it was written, and not as a settings control:** the agent is now *asked* what it offers and the answer is recorded, so `deepseek-harness`'s live catalog reaches the picker without a hand-typed id (§7.7). What is still absent is the user's own additions — ids that are not in the agent's catalog at all | **honour-able with work** — needs a per-agent model list on the settings object plus the composer reading it. Small, but it is a **protocol** addition (a `models` array on the agent's stored defaults), so it shares the Add-provider slice's schema change |
| **Remove model** | `provider-diagnostic-sheet.tsx:114-118` · `settings.providers.models.removeModel` "Remove {{id}}" (`en.ts:2684`) | — (action) | rewrites `additionalModels` without the id (`:651-667`) | absent with the row above | **honour-able with work** — same slice |

**Section verdict: `not applicable`.** Paseo's `providers` page is a *credential and adapter*
management surface — a provider there is an agent-runtime adapter plus the environment it is spawned
with, and Paseo stores its API keys in plaintext `env` in `config.json` (§9). EnvoyCoder has no such
accounts: our agents are ACP programs in a static catalogue and the model credentials belong to the
agent CLI the user installed. The two honour-able rows above are *not* that page — they are
"user-defined agents", and they belong in our Settings pane as a catalogue-management group.

### 5.9 `usage`

`HostUsagePage` → `ProviderUsageSettingsSection` — `host-page.tsx:333-349`,
`provider-usage/settings-section.tsx:13-47`. **Zero settings.** The title is hardcoded English
(`provider-usage/copy.ts:7`, whose own header says the strings are not yet in i18n); the only control
is a **Refresh** button (`settings-section.tsx:22-36`) that re-fetches `client.listProviderUsage()`.

**Section verdict: `not applicable`.** We have no quota fetcher and no per-provider account. Note
that `run.usage` **is** already a run event in our protocol (`protocol/src/domain.ts:408`,`:521`) —
that is the per-run context figure the composer shows, which is a different thing from a subscription
quota, and `docs/paseo-feature-parity.md` #21 places quotas beside the context ring rather than in a
settings page.

### 5.10 `terminals`

`HostTerminalsPage` — `host-page.tsx:1655-1670`. Section header is **hardcoded English**
("Terminal agents", `:1664`).

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Enable terminal agent hooks** (`enableTerminalAgentHooks`) | `host-page.tsx:966-971` · **hardcoded English**: "Enable terminal agent hooks" (`:960`) | `false` (`messages.ts:248`) | daemon installs/uninstalls marker-matched hooks **in the user's real agent CLI config files** at boot and on change (`terminal/agent-hooks/terminal-agent-hook-setting.ts:26-31`) | no terminal subsystem; `packages/platform/src/index.ts:64`,`:80` carries a pty *capability* concept but no daemon terminal exists | **not applicable** — the setting edits files in `~/.claude`-style configs for a terminal integration we do not have |
| **Terminal profile — name, command, arguments, order** (5 controls) | `terminal-profile-edit-modal.tsx:143-207`; reorder `host-page.tsx:1386-1403` · `settings.host.terminalProfiles.*` (`en.ts:2518-2538`) | `DEFAULT_TERMINAL_PROFILES` = claude, codex, opencode, pi (`protocol/src/terminal-profiles.ts:19-30`) | **the daemon never reads it.** Read client-side only — the launcher menu and the argv sent to `create_terminal_request` (`new-workspace-screen.tsx:1664`, `workspace-header-menu.tsx:230`, `workspace-tabs/launcher/index.tsx:227` → `terminal-profiles.ts:101-106`); the daemon spawns whatever argv it is handed (`terminal/terminal.ts:941-957`) | no terminals (`docs/paseo-feature-parity.md` #11) | **not applicable** |

**Section verdict: `not applicable`.** Worth recording for later, because it is the inverse of our own
problem: `terminalProfiles` is a value the daemon **persists and never reads**, and
`terminalProfiles[].icon` is **read at runtime but written by no control**. Both are the same lie in
different directions, and both are examples of what §7.2 says we must not become.

### 5.11 `plugins`

`HostPluginsPage` — `screens/settings/plugins-page.tsx:191-464`.

| setting | render · label · control | default | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|---|
| **Enable plugins** (`pluginsEnabled`) | `plugins-page.tsx:405-410` · `settings.plugins.globalTitle` "Enable plugins" (`en.ts:2040`) | `false` (`messages.ts:253`; `server/config.ts:618`) | daemon: nothing starts when false; flipping it live starts/stops every configured plugin (`server/plugins/index.ts:135-145`,`:374-391`) | no plugin runtime, no plugin SDK, no extension points | **not applicable** |
| **Install directory** + **installation ID** | `plugins-page.tsx:414-443` · `settings.plugins.install` "Install directory" (`en.ts:2047`) | transient `""` each; a plugin is a **directory with a `paseo-plugin.json` manifest** (`server/plugins/manifest.ts:7-17`, `.strict()`, entry files fixed by convention at `plugins/runtime.ts:31-32`) | daemon writes a `plugins.<id>` config entry and loads the plugin's client/server bundles | nothing to install: our agents are ACP programs, our UI has no extension surface | **not applicable** |
| **Enable / Disable {plugin}** | `plugins-page.tsx:104-106` · `settings.plugins.actions.enable` (`en.ts:2062`) | per-plugin `enabled` defaults **on** (`server/plugins/index.ts:153`) | daemon starts/stops that plugin subprocess (`plugins/index.ts:137-141`) | — | **not applicable** |
| **Remove {plugin}** | `plugins-page.tsx:107-111` · `settings.plugins.actions.remove` (`en.ts:2066`) | — (action) | deletes the config entry **and** the per-plugin settings directory (`plugins/index.ts:341-359`) | — | **not applicable** |
| **Per-plugin settings documents** | contributed screens, `plugins-page.tsx:114` → `plugins/settings/index.tsx:60-125` | each plugin declares its own schema and defaults | per-plugin **and per-settings-id** documents at `<paseoHome>/plugin-settings/<pluginId>/<settingsId>.json`, revision-checked (`plugins/settings/index.ts:8`,`:96-131`) | — | **not applicable** |

**Section verdict: `not applicable`.** We have no plugin subsystem, and `docs/paseo-feature-parity.md`
#19 already states the position we would take if we ever grew one: Paseo's plugins are explicitly
**unsandboxed** — the page says so itself (`settings.plugins.trustedDescription`, `en.ts:2037-2039`) —
and we would state our own sandbox position before copying the extension points.

---

## 6. Daemon config keys with no settings-screen control

`MutableDaemonConfigSchema` has nineteen fields; the settings surface renders eleven. **Four** of the
setting-less eight still reach a user indirectly and are listed here for completeness; the rest are
file/CLI/environment configuration and are **not settings** in Paseo's own product — no page renders
them, so there is no control to copy and no user expectation to meet. The gate enforces every one of
them anyway, because the rule it implements is "the doc accounts for what Paseo's source declares",
and a doc that quietly skipped eight declared fields would be a doc nobody could check.

| key | read site | what it does | EnvoyCoder today | verdict |
|---|---|---|---|---|
| `mcp` (and `mcp.injectIntoAgents`) | `server/bootstrap.ts:1604-1618` | whether the daemon's MCP tool server is injected into agent sessions | no MCP surface (§5.5) | **not applicable** |
| `relay` | `server/bootstrap.ts:1740` → `server/relay-runtime.ts:50-63` | starts/stops the outbound relay transport | the mesh is the transport (§5.4) | **not applicable** |
| `browserTools` | `browser-tools/policy.ts:10-19` → `agent/tools/paseo-tools.ts:1208` | registers the 22 `browser_*` agent tools | no browser subsystem (§5.5) | **not applicable** |
| `providers` | `daemon-config-store.ts:282-309`, `provider-registry.ts:618,735,737,792,848` | per-provider enablement, custom models, tool policy and spawn environment | no provider accounts (§5.8) | **not applicable** |
| `removeProviders` (patch schema only) | `daemon-config-store.ts:101-159` | strips a provider and everything referring to it | as above | **not applicable** |
| `metadataGeneration` | `server/agent/structured-generation-providers.ts:46`,`:244-252` | which model writes generated titles, branch names, commits and PR drafts | no generated text (§5.6) | **not applicable** |
| `autoArchiveAfterMerge` | `server/auto-archive-on-merge/index.ts:39` | archive a workspace when its PR merges | no git service (§5.7) | **not applicable** |
| `enableTerminalAgentHooks` | `terminal/agent-hooks/terminal-agent-hook-setting.ts:26-31` | installs hooks into the user's real agent CLI config files | no terminal subsystem (§5.10) | **not applicable** |
| `appendSystemPrompt` | `bootstrap.ts:1619-1621` → `agent-manager.ts:5092-5105` | a daemon-wide preamble appended to every agent's system prompt | **no system-prompt composition exists** (`grep systemPrompt` over `packages/` and `apps/desktop/src` → zero hits) | **honour-able with work**, and the work is **upstream**: a session system prompt is a term in the harness contract, which lives in `@envoymesh/envoy-harness` — a peer checkout (family guide §7.5). The field goes onto that contract first (§7.4), then into `CoderSettings`, then into the session build in `runs.ts` |
| `terminalProfiles` | **no daemon read site.** Written by the daemon (`persisted-config.ts:267`) and read only by the client app (`terminal-profiles.ts:309-316`) | the argv a terminal tab is launched with | no terminals | **not applicable** |
| `agentProfiles` | `agent/tools/paseo-tools.ts:2948` (`list_profiles`); client `agent-profiles/internal/use-agent-profile-picker.ts:131-155` | named launch bundles, applyable to the composer or a live agent | no profile concept; the composer already carries agent/model/thinking per task (`TaskPane.tsx:134`) | **honour-able with work** — §5.5 has the split: the storable half is ours to take, the `list_profiles` half waits for an MCP surface |
| `skills` | `orchestration-skills/internal/selection-store.ts:42`,`:50`; effect `operations.ts:71-80` | chooses which skill directories are created **and deleted** on the host | no skills subsystem | **not applicable** |
| `pluginsEnabled`, `plugins` | `server/plugins/index.ts:135-145`,`:137-141`,`:341-359` | start/stop/install local plugin directories | no plugin runtime, no extension points | **not applicable** |
| `cors` (`cors.allowedOrigins`) | `websocket-server.ts:796`,`:850` | origins allowed to open the daemon's WebSocket | no browser-to-daemon origin | **not applicable** |
| `git` (`git.maxProcessesPerSecond`, `git.maxProcessConcurrency`) | `server/config.ts` merge; enforced in Paseo's own git service | throttle for the daemon's git process spawns | no git service (`docs/paseo-feature-parity.md` #8/#9) | **not applicable** |
| `app` (`app.baseUrl`) | `server/config.ts:242` | the base URL the daemon publishes for its own web UI | we serve no web UI from the daemon | **not applicable** |
| `hostnames` | `server/hostnames.ts:53-54` | which `Host` headers the daemon's HTTP surface accepts: `true` = any, `[]`/absent = localhost and IPs | our daemon is loopback-only and reached over the family's attach transport (`packages/host-bridge`), not by a browser | **not applicable** |
| `trustedProxies` | `server/config.ts:452`,`:541`; `server/service-proxy.ts:309` | which upstream proxies the daemon believes about client identity | nothing proxies us; the local scope key is granted only to loopback (`host-bridge/src/index.ts:582-590`) | **not applicable** |
| `catalogRefreshTimeoutMs` | `bootstrap.ts:910` (`onFieldChange`) → `config.ts:641` | how long a provider-catalogue refresh may take before it is abandoned | no provider catalogue to refresh | **not applicable** |

**The honest summary of this section:** every key here is `not applicable` except
`appendSystemPrompt` (upstream work) and `agentProfiles` (our work, split). Two of them —
`terminalProfiles` and `agentProfiles` — are also the document's best examples of Paseo's own
settings debt, and §9 says why that matters to us.

---

## 7. EnvoyCoder today, exactly

This is the half of the inventory that is about **us**. The owner's instruction was to be exact about
which settings are merely stored and never used, "because that is the same lie in a different
direction", so the two tables below are separated on that basis: what is honest, and what is not.

### 7.1 `CoderSettings`, and what reads each field

The type is `packages/protocol/src/domain.ts:733-769`; defaults `:771-776`; schema `:806-819`; the
patch shape `updateSettings` accepts — where `""` means **clear it** — `:789-796`. It is persisted by the
daemon as one JSON document beside projects and tasks (`apps/desktop/src/daemon/store.ts:560-567` read,
through `withoutRetiredSettingsKeys` first (`domain.ts:832-840`); `:493-506` update; path from
`coderPaths` in `packages/host-bridge/src/index.ts:105`,`:144`), reaches the window through
`coder.getSettings` (`daemon/service.ts:463-466`) and is written back through `coder.updateSettings`
(`:468-489`, wire schema `packages/protocol/src/rpc.ts:1323-1345`), and is rendered by
`apps/desktop/src/components/SettingsPane.tsx`.

**`read by` is the column that decides the verdict, and it is deliberately not the pane.** A row in the
pane is a control; what makes a setting honest is a *workflow* that consumes the value. The two
exclusions are mechanical rather than a matter of taste — the pane that renders a field and the module
that declares it — and `apps/desktop/test/settings-coverage.test.ts` is the gate that holds every row
below to them.

| field | declared | default | rendered | **read by** | honest? |
|---|---|---|---|---|---|
| `language?: CoderLanguage` | `domain.ts:768` | `"system"` (`:775`; list `:722`) | `SettingsPane.tsx:226-250` | `main.tsx:33` — `I18nProvider preference={state.settings.language ?? "system"}`, which re-renders every `t()` in the window | **yes** |
| `defaults: TaskDefaults` → `harness?` | `domain.ts:743` (`:185-191`) | `"envoy-harness"` (`:772`) | `SettingsPane.tsx:280-305` (app) and `:538-569` (project) | `store.ts:342` → `resolveTaskDefaults` (`packages/task-model/src/index.ts:88-105`): explicit → project → **app default** → fallback (`:98`) | **yes** |
| `defaults.model?` | `domain.ts:188` | — | `SettingsPane.tsx:311-320` (app) and `:571-580` (project), through the composer's own `ModelChoice` | `task-model/src/index.ts:101` reads it; the controls write it | **yes** — slice 1 closed the gap the old verdict named: the resolver honoured it and now something can set it |
| `defaults.extraArgs?` | `domain.ts:190` | — | `SettingsPane.tsx:324-335` (app) and `:582-593` (project) | `task-model/src/index.ts:103` reads it; the controls write it | **yes** — as above |
| `keepTranscripts: boolean` | `domain.ts:759` | `true` (`:774`) | `SettingsPane.tsx:346-357` | `runs.ts:797` — `appendTranscript` returns early when false, so the JSONL record is deliberately not kept | **yes** |
| `requireApprovalForDestructive: boolean` | `domain.ts:757` | `true` (`:773`) | `SettingsPane.tsx:339-344`, a **disabled-with-reason** row for an agent that cannot be told (`ApprovalRow`, `:680-713`) | `runs.ts:298-301` reads it per run and `resolveApprovalPolicy` (`run-options.ts:231-237`) maps it onto the agent's own session policy: `true` → `session/set_policy {autoRun: "always-confirm"}`, `false` → `{autoRun: "off"}`. `runs.test.ts` proves both positions reach the agent over a real pipe, and that nothing is sent to an agent whose catalogue entry says it cannot be told | **yes** — in the direction the row's wording promises. The row's note says which agent it reaches; "ask before **anything** destructive" is the strict value, and §7.2 says why `safe-only` is deliberately not used for it |
| `defaultProjectPath?: string` | `domain.ts:741` | — | `SettingsPane.tsx:257-276` | `CoderApp.tsx:224-226` hands it to `buildCommandContributions`, whose `project.add` row seeds its text stage with it (`CommandCenter.tsx:425-435`, entered through `stageInto` `:146-155`). `palette-flow.test.tsx` asserts the seeded field and the empty field | **yes** — it is the folder "Add project…" starts from, which is what its row says |
| ~~`allowRemoteRuns: boolean`~~ | **removed** — was `domain.ts:734` | — | **removed** — was `SettingsPane.tsx:147-158` | — | **gone, not disabled.** Its effect could not exist: there is no remote-run path, and `coder.offerRemoteRun` was a spec with no handler and no caller. A disabled row would have promised a feature on this pane's terms rather than the mesh's; §7.2 records what a returning version needs first. `coder.offerRemoteRun` came out of the catalogue with it (`protocol/src/rpc.ts`), and `RETIRED_SETTINGS_KEYS` (`domain.ts:832`) strips the old key so an upgrading user's settings file is not quarantined over a value nothing read |

**All eight entries are honest now, and the verdicts are not "the pane has a row for it".** Every one of
the seven remaining fields has a reader outside `SettingsPane.tsx` — that exclusion is the whole point of
the column, and `settings-coverage.test.ts` enforces it — and the eighth was **deleted** rather than
disabled. The app scope shows **seven** rows where it showed five (the language, the folder "Add
project…" starts in, the default agent, the default model, the extra arguments, and the two switches),
and the pane the project's `⋯` button opens holds that project's own three. The two read-only groups
below them — the agents found on this machine, and the daemon's notes about what it could not read — are
unchanged, deliberately.

### 7.2 What the two dead switches do now, stated precisely

Both looked like safety controls, which is what made them the worst possible ones to fake. This section
keeps the finding and records the outcome, because the finding is the reason each row has its present
shape — and because a future reader who sees only the fixed version would not know which designs were
already tried here and rejected.

* **`requireApprovalForDestructive`** promised "ask before running anything a harness marks
  destructive". The approval machinery **exists and is unconditional**: every ACP
  `session/request_permission` becomes a `run.approval-requested` event (`runs.ts:626-664`, mapped
  from the protocol in the header table at `:24`), `answerApproval` settles it (`:739-748`), the RPC
  handler is served (`service.ts:385-404`), the event kinds are on the wire
  (`protocol/src/domain.ts:405-406`,`:511-518`) and the transcript renders the prompt
  (`TaskPane.tsx:508-553`). Nothing consulted the setting in `HEAD` before slice 1 — verified by
  `git show HEAD:apps/desktop/src/daemon/runs.ts`, which contains the `keepTranscripts` read at `:763`
  and no reference to this field at all. So the user's choices were: leave it on and get
  approvals they cannot turn off, or turn it off and get **exactly the same approvals** — having been
  told they turned safety off.
  **Now:** read at `runs.ts:298-301` and delivered as the agent's own session policy
  (`session/set_policy { autoRun }`), `true` → `always-confirm`, `false` → `off`. The one honest limit
  is stated on the row rather than hidden: `session/set_policy` is a method `envoy-harness` documents and
  `deepseek-harness` does not, so for an agent that cannot be told the switch is **disabled with the
  reason naming that agent** (`capabilities.approvalPolicy` on the wire,
  `packages/agent-catalog/src/index.ts:186-210`), and no call is sent — `runs.ts:298-301` resolves to
  `undefined` and the run proceeds under the agent's own policy.
  `safe-only` — the third value the peer accepts — is deliberately **not** the mapping for `true`: it
  auto-allows every tool in `AUTO_RUN_SAFE_TOOLS`, which includes the whole `git` tool regardless of
  arguments, so a commit or a push would run without asking. That contradicts the sentence on the row.
  **Checked against the built peer, not only against its source.** Driving
  `../envoy-harness/packages/envoy-harness/dist/cli/acp-stdio.js` directly over stdio, on one session:

  | call | answer |
  |---|---|
  | `session/get_policy`, fresh | `{sandbox:"workspace-write", approval:"on-request"}` — **no `autoRun`** |
  | `session/set_policy {autoRun:"always-confirm"}` | accepted; `get_policy` then reports `autoRun:"always-confirm"` |
  | `session/set_policy {autoRun:"off"}` | accepted; `get_policy` then reports `autoRun:"off"` |
  | `session/set_policy {autoRun:"safe-only"}` | accepted |
  | `session/set_policy {autoRun:"sometimes"}` | `-32602 preset, sandbox, approval, or autoRun required` |
  | `session/set_policy {sandbox:"read-only"}` | accepted, and `autoRun` left exactly as it was |

  So the three values are the peer's whole vocabulary, an unset posture is genuinely unset rather than
  "the default one", and a policy sent *without* `sandbox` does not move the sandbox — which is the
  boundary that lets this daemon send `autoRun` alone. The result envelope carries an extra
  `{result: …}` nesting compared with `session/set_mode`; we ignore the payload either way and
  `apps/desktop/test/fixtures/fake-acp-agent.mjs` copies the envelope rather than tidying it. That
  inconsistency is the peer's and is a candidate for an upstream report (family guide §7.4).
* **`allowRemoteRuns`** promised "share this machine's agents with your other machines", default
  **off and fail-closed**. Nothing read it, and there was no remote path for it to gate. The disabled
  default was genuinely fail-closed — inert, not unsafe — but the *label* implied a boundary that is
  not implemented anywhere.
  **Now: removed, control and field together**, and this is the one place this document's original
  recommendation ("render it **disabled with the reason**") was revised rather than followed. Two
  reasons, and the second is the decisive one:

  1. **A disabled row is a promise.** It says "this exists and we cannot honour it yet", which points a
     user at the settings pane for a feature whose prerequisites are a peer directory
     (`coder.listPeers` returns a hardcoded empty list, `service.ts:454-461`), a session store that makes
     a remote path reachable at all, and a broker decision (`docs/envoycoder-design.md` §7) — none of
     which are settings work.
  2. **Its RPC partner had already gone.** `coder.offerRemoteRun` was a method in the catalogue with no
     handler and no caller: a spec promising a client that a run could be handed to another machine,
     which nothing served. It came out of `RPC_METHODS` and `RPC_SPECS` in the same slice. A settings
     row for a feature whose own protocol entry is a promise nothing implements is the defect twice.

  **What would bring it back**, in the order the work actually goes: the peer directory, then the
  session store that makes a remote run reachable, then the broker decision — and then the method, its
  params and the row are written together, against a handler. `RETIRED_SETTINGS_KEYS` (`domain.ts:832`)
  is what lets an upgrading user's settings file keep its language, its default agent and its nominated
  folder while the dead key is dropped.

  **Left open, and named here rather than left to be rediscovered: the same key on the *wire*.** The
  strip protects a settings *file* written by an older build of this product. It does not protect a
  window talking to a daemon from an older build — and `coder.getSettings`'s result is
  `z.object({settings: CoderSettingsSchema}).strict()`, so that daemon's answer is refused. Verified:
  parsing the previous build's answer (`…, allowRemoteRuns: false, …`) against
  `RPC_SPECS["coder.getSettings"].result` fails with
  `settings: Unrecognized key(s) in object: 'allowRemoteRuns'`. The failure is loud rather than silent —
  `loadSettings` reports it and the pane shows a refusal instead of a half-filled document — and the
  window and daemon normally ship in one bundle, which is why this slice left it alone. It is still an
  asymmetry worth a decision: either `withoutRetiredSettingsKeys` is applied to that result schema too
  (one function, both directions), or the docs say out loud that a window one build ahead of its daemon
  cannot read settings. **Not decided here, because wire compatibility is not a settings row.**
  **One later change is on the safe side of it, and it is recorded here so the distinction is not
  blurred:** the pre-flight probe (§7.7) added a *method* (`coder.probeSessionOptions`) and no field to
  any existing result, so no answer an older daemon gives changes shape. A window talking to that daemon
  asks `coder.hello` first, sees the method is not in `methods`, and offers no probe button at all —
  which is the mechanism `missingMethods` already provides. The asymmetry above is about a *stricter
  schema refusing a document*, and adding a method does not create one.

**What this document recommends, and it is slice 1 in §8 (§8.1):** make all four honest before
adding a single Paseo row. Either wire a setting to a real effect or render it disabled with the
reason in the user's language; `defaults.model`/`defaults.extraArgs` either get a control or come out
of the type, because a field the resolver reads and no UI writes is a capability users will keep
filing as "the picker is missing".

**Outcome, so the four are accounted for:** two were wired (`requireApprovalForDestructive` onto the
agent's own `session/set_policy`, `defaultProjectPath` onto the palette's `project.add` row), two got
the controls they were missing (`defaults.model`, `defaults.extraArgs`, at both the app and the project
scope), and one was **deleted** (`allowRemoteRuns`, with `coder.offerRemoteRun`). The gate §8.1 asks for
is `apps/desktop/test/settings-coverage.test.ts`.

### 7.3 What the window shows, and three further findings

As written, `SettingsPane.tsx` rendered five controls and two read-only groups: the language select
(`:80-104`), the default-agent select (`:106-132`, populated from `state.harnesses` filtered by
`knownMissing()` — the one state a picker may drop, §7.9), the three switches (`:134-171`), an **Agents**
list with an availability chip *per state* plus the install commands that state implies (`:173-210`), and
the daemon's quarantined-file **notes**
(`:212-223`, rendered through their key when the daemon sent one). Three findings from reading it
against the rest of the app, each with its present state:

1. **There is no section structure.** Paseo's sidebar has twenty-one sections; ours is one scrolling
   column of a `<div className="settings">`. That is fine for six rows and will not survive the first
   slice in §8.1, which takes it to eleven.
   **Then:** four headings — *General*, *New tasks start with*, *Safety* and *Projects* — plus the two
   read-only groups below them, unchanged: four headings over one column, which is what the first slice
   could afford.
   **Now: a bar, and eight sections that are places rather than headings.** The owner asked for the
   reference product's settings left bar; the answer is that bar with **our** contents. The sections are
   `general`, `tasks`, `safety`, `agents`, `projects`, `shortcuts`, `machine` and `about` — held as data in
   `apps/desktop/src/state/settings-sections.ts`, rendered by `components/SettingsNav.tsx`, and each one
   required to name the source that backs it. §7.6 is the section-by-section account, including the
   reference-product sections that are **absent** and why. This is still not Paseo's sidebar and must not
   become it: it lists eight sections, every one of which has something to read or change, where Paseo's
   lists twenty-one of which five carry no user-settable value at all (§2). *Projects* is the one section
   that is not a page of settings: it is the list of registered projects, and its bar item's second band
   is the count.
2. **"Project settings" opens app settings.** `CoderSidebar.tsx` rendered a per-project `⋯` button
   whose accessible name was *"Project settings for {project}"* (`sidebar.project.settings.aria`,
   interpolated with the project label) and whose handler was
   `onOpenProjectSettings={() => setSettingsOpen(true)}` (`CoderApp.tsx:294`) — the project argument
   dropped on the floor. This is the §7.2 defect class in the UI layer: a control labelled with a
   scope it does not have. (That key is gone: the control is a row menu now, so its trigger is named
   *"Actions for {project}"* and *"Project settings"* is the item inside it —
   `components/RowMenu.tsx`, `CoderSidebar.tsx`.)
   **Now:** the action carries the project through (`openProjectSettings`, `CoderApp.tsx:175-177`) and
   the pane renders that project's defaults (`SettingsPane.tsx:497-598`), which is the third scope
   §7.4 said had no screen. `coder.updateProject` gained the defaults patch it needed for it
   (`packages/protocol/src/rpc.ts:1093-1107`, `store.ts:293-308`). The shell holds the project's **id**
   and resolves it against `state.projects` on every render, rather than keeping the object it was
   handed — `CoderApp.tsx:134-177` says why that is load-bearing, and `test/settings-scope.test.tsx`
   fails on a snapshot: because a project's defaults *replace*, a snapshot meant the second edit in a
   session wrote the first one away.
   **And since then, the other half of the same defect:** the scope was reachable *only* from the rail,
   and leaving it was possible only by closing the pane — a scope you can enter once and cannot leave.
   The app scope then grew a Projects section listing every project; **that list is now a level of its
   own**, reached from one row, because a list that grows with the number of projects does not belong
   inside a page of settings. Three levels in one pane, each with a back control that names its
   destination. §7.5 is that model, in one place.
3. **The daemon's notes are the best thing in the pane, and they are not a setting.** The quarantined
   file list (`store.ts:249-251`, rendered `SettingsPane.tsx:562-575`) is what a settings page should do
   with a problem: say what happened, in the user's language, at the bottom, and do not offer a switch
   that pretends to fix it. Unchanged by slice 1, deliberately.

### 7.4 Two claims in this repo that the source does not support

Recorded because both are in shipped comments and would be repeated by the next person who reads them.

* **"It follows you to the phone."** `SettingsPane.tsx:73-79` and `docs/localization.md` say the
  language lives on the daemon so a second window *and the phone* see it. The daemon does store it and
  serves it (`service.ts:463-466`) — but **the phone does not read it**: `apps/mobile` is six Dart
  files (host list, pairing service, host client, theme tokens, main) with **no settings screen, no
  i18n, and no `coder.getSettings` call** (grep for `getSettings`, `locale`, `i18n`, `language` under
  `apps/mobile/lib` → zero hits). The claim is a statement about the design that is true and a
  statement about the product that is not, and the two are in the same paragraph.
* **The owner's premise, checked:** `docs/envoycoder-paseo-inheritance.md:55` records Paseo's settings
  as "two scopes" and our own as three. True, and at the time of writing the third scope (per project)
  had **no screen either** — the same gap as Paseo's `projects` section, and the same live bug as
  §7.3.2. Slice 1 gave it one: the sidebar's per-project `⋯` button now opens the project's own defaults
  in the same pane (`SettingsPane.tsx:497-598`), written through `coder.updateProject`, and level 1's
  *Projects* row opens the list, whose rows open the same project scope with a back control that returns
  (§7.5).

### 7.5 The settings navigation model — four scopes, one pane, one bar, and two back controls that differ

Paseo's app settings hold a **`projects`** section whose rows are the way into each project's own
settings (`screens/projects-screen.tsx:115` → the separate `project-settings-screen.tsx`). We build the
same model rather than a second one, and this is it in one place.

**The list became its own level, and the reason is arithmetic.** With three projects a list at the end of
the app scope fits; with thirty it is thirty rows of other people's folders between *Keep transcripts*
and the agent list, and the settings a user came for are somewhere above them. So the block that used to
be inline is now a page reached from a single row, which is also the shape Paseo's settings actually
have (a section is a page with a back affordance, not a block of rows on the page you were reading).
Three levels, one pane:

| scope | title | reached from | back control |
|---|---|---|---|
| 0 — the list of sections | *Settings* | the footer's Settings button, or `⌘,` — **on a narrow window** (`entryScope("narrow")`) | none: it is the root |
| 1 — one section, e.g. *New tasks* | that section's own name | a bar item, or a row of scope 0 | *← All settings* (`settings.back`), scope 0 |
| 2 — the projects page | *Projects* | the **Projects** item in the bar | *← All settings* (`settings.back`), scope 0 |
| 3 — one project's settings | *Project settings for api* | a row of scope 2, or the rail's project `…` menu | *← Projects*, scope 2 |

**The bar is this model, not a second one beside it.** A section **is** a scope: pressing an item calls
the same `onNavigate(scope)` every other row in this pane calls, and the marked item is *derived* from the
scope (`scopeSection`, `settings-scope.ts`) rather than kept as an `activeSection` beside it — one value
behind both the mark and the page, so the two cannot disagree. There is no callback per destination and no
route: `scopeForSection` is the inverse of `scopeSection`, and the pair is what makes the bar and the pages
one navigation rather than two that agree by convention.

**Where opening lands depends on the window, not on history.** `entryScope(layout)` gives scope 1 on a
wide window (the bar is already beside the content, so a page of links to it would be a page of links to
the thing next to it) and scope 0 on a narrow one. That is a fact about the window rather than about where
the user came from, which is the state this section refuses a few paragraphs below.

**The bar is the index, so the index is never rendered twice.** `showsBar` (in `SettingsPane.tsx`) is one
rule: the bar is beside every page that is **not** the list of sections. On scope 0 the list *is* the page
— the same registry, one row per section, each opening a page whose back control returns here — and a
column holding the same eight rows beside it would be a duplicate rather than a layout. The same rule
decides where a section's own sentence is printed: it is the bar item's second band when there is a bar,
and the page's first line when there is not, and the measurement below confirms it appears **once** either
way.

**The breakpoint is measured, not chosen: 1100px.** `npm run ui:audit` probes this surface now
(`--click Settings`, `--size WxH`, plus a `settings` block that focuses a bar item and reads the painted
ring), and the widest settings row — the language row, whose height is its *sentence* wrapping into more
lines beside a control that keeps its width — measured: **71px at 1440, 88 at 1280 and 1200, 105 at 1140
and 1100, 123 at 1090 and 1060, 140 at 1024, 192 at 960**. The crossing between a three-line sentence and
four lines or more sits at 1100, so `WIDE_LAYOUT_QUERY` is `(min-width: 1100px)` and the code carries the
same table. Below it the bar is not squeezed: the sections become the page, and measured there every row
is **54px** at the full width of the pane. At 1440 with the rail at its default 300px the bar is 216px and
the body 924px; at 1100 it is 216px and 584px; at 1090 there is no bar and the body is 790px. No
horizontal overflow at any width measured (0px at 900, 1000, 1090, 1100, 1200 and 1440).

**And the measurement earned its keep three times.** The first run reported the settings pane absent at
every width: `--click "Settings"` searched `textContent` only, and the rail's footer button carries an icon
glyph and an `aria-label`, so the click found nothing. The second run attached to a **stale Chrome** from an
earlier session and reported a different application's window (forty projects, none of them ours); both
tools now match the debug target by **URL** and take a `--port`, and `--click` matches the words a user
reads *or* the name a screen reader reads. The third: the click heuristic walked `button, li, …` in
document order, so it hit the `li` wrapper before the button inside it and clicked nothing — three
screenshots came out **byte-identical**, which is what pointed at it. A picture that cannot differ is the
cheapest failing check available, and it is the one that caught this.

**The contrast of the bar's second band was fixed because it was measured.** On the current item's fill
(`--bg-active`, the rail's own selected token) the caption in `--text-muted` reads **3.83:1** at 12px —
under the 4.5:1 small text needs, and the same 3.83 the chip rule in `styles.css` already records, because
it is the same tone on the same fill. So the current item's caption reads `--text` (**9.14:1** measured),
which is the rule this repo already applies to its chips: the background carries the selection and the
small text stays readable. The idle item's label and caption both measure **6.52:1** on `--bg-raised`. The
focus ring was measured too, on a focused item: `2px solid rgb(32, 116, 74)` — the sheet's
`--focus-ring-color` — with the offset inverted to `-2px` so a full-width item's ring cannot be clipped by
the column.

**The keyboard was measured the same way**, with Chrome dispatching real key events at the running window
(not synthetic ones from a script): Tab from the pane's back control reaches *Close*, then the bar's
current item — `BUTTON[General] .settings-nav__item tabindex=0` — then the section page's first control,
which is **one tab stop for eight items**; ArrowDown on that item moves focus to `BUTTON[New tasks]` while
the page stays on *General*; and Enter on it renders *New tasks*. That last step is the one jsdom cannot
do — it does not synthesise the click a real Enter produces — which is why `test/settings-nav.test.tsx`
asserts the element **is a button** (native activation) and separately that pressing it navigates.

**The scope is data, not a prop plus a flag.** `apps/desktop/src/state/settings-scope.ts` owns it:
`{ kind: "app" } | { kind: "projects" } | { kind: "project", id }` (`:60-77`), with `APP_SCOPE` and
`PROJECTS_SCOPE` as shared constants. `CoderApp` holds **one** value of it — `SettingsScope | undefined`,
where `undefined` is "the pane is closed" (`CoderApp.tsx:164`) — so "which level" and "is it open" are
one piece of data. The previous shape was a `project?: Project` prop whose *absence* meant the app scope:
a boolean with a payload welded to it, in which the third level was **not expressible** (a caller that
wanted the projects page would have rendered the app scope instead), and in which the payload was a
snapshot of a project whose `defaults` **replace** rather than merge. The pane takes the scope plus
**one** callback, `onNavigate` (`SettingsPane.tsx:176-195`), rather than a callback per destination: a row
says *where* it goes, as a value, and the shell stores it.

**The live resolution survived the restructure, and it is still the load-bearing part.** The scope holds
an **id**; `scopeProject` (`settings-scope.ts:108-114`) resolves it against `state.projects` on every
render, which is why a second edit carries the first (`test/settings-scope.test.tsx:274`, verified
against a deliberate "resolve it once and hold it" mutation). `scopeProjectId` (`:99-106`) is what a write
is addressed to, so a write can never be aimed at a project that is not there.

**Two back controls, and they must not say the same thing.** Level 3's returns to the *list*, so it says
**"Projects"** — and its label is not a new string: it is the level-2 page's **own title**
(`settings.projects.title`), the same rule the project rows follow for their accessible names, one place
with one name (`SettingsPane.tsx:530-532`). Level 2's returns to this machine's settings, so it says
**"All settings"** — the existing `settings.back` pair, which is where it always pointed
(`SettingsPane.tsx:456-460`). A single control labelled "All settings" that landed on the list would be a
lie of exactly the kind §7.2 removed. `settings.back.title` lost its stale tail ("and the list of
projects") in all seven catalogues for the same reason: level 1 does not hold that list any more.

**When the project you are looking at disappears, the pane lands on the projects page.**
`resolveScope` (`settings-scope.ts:86-89`) is the whole rule, and it is the sentence a user already knows:
*when the thing you are looking at disappears, the pane does what the back control would have done.* It is
applied on **every render**, so both cases are covered — removed in another window, or removed from its own
`…` menu while its settings are open (`CoderApp.tsx:206-216` moves the scope down a level itself, so the
fallback happens in the same paint as the removal rather than after the daemon's refetch). The rejected
alternative was the app scope, and the reason is *not* symmetry: the app scope **loses the user's place**
— it skips a level and leaves them reading this machine's defaults with no list in front of them to pick
the project they meant, while the projects page is the level that lists the thing that vanished. Falling
back uniformly rather than by remembering the entry route is deliberate for the same reason the two routes
into level 3 are one function: an answer that depends on where the user came from is a second piece of
state, and a second piece of state is a second thing that can disagree with the screen.
`test/settings-scope.test.tsx:302` and `:344` assert it both ways, and `:637` asserts it without a pane in
the way.

**The count band tells the truth about a list nobody could read.** A count is a claim about the list, and
`state.projects` is an empty array for two different reasons — nobody has added a project, or this window
never managed to read them. So the band is four strings rather than one
interpolated `{count} projects`: *"40 projects"*, *"1 project"*, *"No projects"*, and *"Could not be
read"* when the shell's own `projectsUnavailable` says why the list is empty (`CoderApp.tsx:255-263`, the
value the rail already renders as *"Could not read your projects"*). Level 2 says the same thing in the
rail's own words — `sidebar.empty.cannotLoadTitle`/`cannotLoadBody` plus the reason — instead of teaching
what a project is, because *"No projects yet. A project is a folder…"* answers "why is this empty?" and the
honest answer is "it is not empty, it is unknown". This was found by rendering it, not by reasoning: a
window with the daemon stopped said **"No projects"** in the pane while the rail beside it said **"Could not
read your projects"** — one list described two ways in one window. `test/settings-scope.test.tsx` now pins
the fixed pair, including that the sentence appears *twice* (once per surface) because one value has two
readers.

**With many projects: the body scrolls and the header stays put, and nothing is windowed.** Level 2 is a
plain list of `<li>`s in the pane's own scrolling body (`.settings`, `overflow-y: auto`, inside
`.pane { grid-template-rows: auto 1fr auto }`), so the back control and the pane title stay on screen while
the list moves under them. No virtual list, no paging, no search — this pane has never needed any, and a
list of a few hundred folders is where a filter would go, not a windowing library. The **testable** half of
that is asserted (`test/settings-scope.test.tsx:470`: forty projects, forty rows in the DOM, each with its
own path); the scrolling half is **measured in a real window** rather than asserted, because jsdom has no
layout to measure. Measured 2026-09-14 with Chrome over CDP at 1440×900, forty projects: the body's
`scrollHeight` 4560 vs its `clientHeight` 812 (it scrolls), the header's `top` 0 before and after scrolling
the body to 3000 (it does not move), and no horizontal overflow at any of the three levels.

**Why `onNavigate` is a required prop, not an optional one.** A caller that renders the Projects row
without a destination is a control that presses into nothing, which is this pane's founding defect
(`docs/paseo-feature-parity.md` §"The one class of exception"). Required makes it unrepresentable: the type
checker is the guard, and `settings-language.test.tsx`'s standalone render had to be given a scope and a
navigation callback when its type changed — which is how the requirement announced itself in this
restructure.

**Where the code lives, and why it is five files.** `components/SettingsPane.tsx` is the scopes (the
`switch` on the scope, the section switch below it, and the shell wiring), `components/SettingsNav.tsx` is
the bar and the same registry as a page, `components/SettingsShell.tsx` is the frame every page renders
through (title, back control, the bar's column, the daemon chips, the scrolling body, the notes),
`components/SettingsRows.tsx` is the row shapes they are built from, and `components/settings/` holds the
eight section pages plus the two rows with a decision in them. Each split happened at this repo's own rule
(*"past ~800 lines, split it"*, `AGENTS.md`) as the pane grew a level, then a level and a bar: a frame
passed identically by every page is a component, and eight pages in one file is a file nobody reads.

**What this is not.** No breadcrumb chain and no routes: one pane, one bar, one row down and one back
control up at each step. The bar is real now, and it is **not** Paseo's sidebar — eight sections against
twenty-one, every one of them filled, with the sections we do not have recorded as absent rather than
rendered empty (§7.6). "No settings sidebar of our own" was the position while this pane was six rows and
four headings; the position changed when the sections did, and this paragraph is the record of it.

### 7.6 The bar's sections, and the reference product's sections that are not there

The owner's brief lists eleven sections from the reference product's settings and asks for "the left bar
for setting". This is that bar with **our** contents: eight sections, every one of which has something to
read or change, held as data in `apps/desktop/src/state/settings-sections.ts` and rendered by
`components/SettingsNav.tsx`. The registry is the bar's own list — there is no second list of items in the
JSX — and `test/settings-nav.test.tsx` compares the rendered names with the registry's keys.

| section | what is in it | where it is read or enforced |
|---|---|---|
| **General** | Language; the folder *Add project* starts in | `main.tsx:33` (the root provider re-renders every `t()`); the palette's `project.add` row seeds its text stage with `state.settings.defaultProjectPath` (`CoderApp.tsx`), `test/palette-flow.test.tsx` |
| **New tasks** | The default agent, the default model, the agent's extra argv | `resolveTaskDefaults` (`packages/task-model/src/index.ts`) — explicit → project → app → fallback; `test/settings-store.test.ts` asserts an app default reaching a created task |
| **Safety** | *Ask before anything destructive*; *Keep transcripts after a task ends* | the value goes to the agent as its own session policy (`session/set_policy { autoRun }`, mapped by `run-options.ts`), four cases in `test/runs.test.ts`; `appendTranscript` returns early when transcripts are off |
| **Agents** | Every agent the machine can run: availability, its capability warnings, and the tier, modes, models and thinking levels **it published about itself** | read straight from `HarnessSummary` — the daemon's own answer. Read-only on purpose: availability here is a fact we detect, not a switch a user throws (§5.8). The *composer* can now also **ask** an agent for that list before it has ever run (§7.7); this page stays a report, and the ask lives where the choice is made |
| **Projects** | The list of registered projects, one row each, opening that project's own defaults | `coder.listProjects`; the rows open scope 3, whose three controls write through `coder.updateProject` (whose defaults **replace**, hence the live-id rule of §7.5) |
| **Keyboard shortcuts** | The keys this window is **listening for**, from the same table the key handler reads | `wiredBindings(actions)` — the table filtered by the actions the shell mounted, so `⌘⇧N`, `⇧?` and `Escape` are absent because nothing is mounted for them. A page that listed the table would advertise keys that do nothing, which is the same lie as a setting that does nothing |
| **This machine** | The daemon's build, state folder, home folder, start time, and how many windows are attached | `coder.hello`'s own answer, all of it (`packages/protocol/src/rpc.ts:1040-1066`); the notes stay in the frame, below every page |
| **About** | This window's build against the daemon's, and what a mismatch means | `apps/desktop/package.json` inlined by `vite.config.ts` into `src/app-version.ts`, against `hello.version` |

**Where a section is absent, it is absent, and this is why.** The audit already holds the verdict for every
one of these; the point of the table is that *not building a page* was a decision with a reason rather than
an omission. Nothing below is rendered disabled either — the argument is under the table.

| reference-product section | verdict (this document) | in our bar | why |
|---|---|---|---|
| `host` — Overview | **not applicable** (§5.1) | no | three of its five rows are per-host identity a one-daemon install cannot use. What is usable is reported by **This machine**; the two shell-lifecycle rows (manage/kill the built-in daemon) are **honour-able now** and need a field in the Rust shell, not a bar item |
| `projects` | **honour-able with work** (§5.2) | **yes** | the section carries no user-settable value in Paseo either: it is navigation into a per-project screen. Ours is the list plus scope 3 |
| `connections` | **not applicable** (§5.3) | no | there is no connection list: one loopback daemon, and the remote path fails closed until a session store exists |
| `pair-device` | **honour-able with work** (§5.4) | no | the pairing contract is written, but `coder.pairDevice` is deliberately absent from the dispatcher catalogue — minting a credential is the node's act — and the session store it needs is roadmap M1. A disabled row here would be §7.2's lesson twice: a row and a method that must be written together, against a handler |
| `agents` | **not applicable** (§5.5) | **yes, with different contents** | four of its five rows are subsystems we do not have. Our **Agents** section is a *report* of what each agent published (tier, availability, declared modes/models/thinking, capability warnings), not Paseo's page; the row we can honour — saved agent profiles — is §8.4's work |
| `providers` | **not applicable** (§5.8) | no | Paseo's page is credential and adapter management, and it stores API keys in plaintext `env` in `config.json` (§9). **The audit says in as many words that we should not copy it.** Our equivalent facts live in **Agents** (what is installed) and **New tasks** (which model a task starts on) |
| `terminals` | **not applicable** (§5.10) | no | no terminal subsystem — and Paseo's own daemon never reads the terminal profiles it persists, which is the inverse of a defect we have |
| `plugins` | **not applicable** (§5.11) | no | no plugin runtime and no extension points, and Paseo's own are explicitly unsandboxed |
| `permissions` | **not applicable** (§4.8) | no | that section is OS permissions — microphone, screen recording — and we request none. **Our Safety section is not this one**: it is what an *agent* may do without asking, which the audit records as honour-able now and which is built |
| `integrations` | **not applicable** (§4.6) | no | it installs a CLI we do not ship, from a shell we do not use, by rewriting the user's shell rc |
| `notifications` | **not applicable** (§4.7) | no | no OS notification path and no tray, so there is nothing to silence |
| `appearance` | **honour-able with work** (§4.2) | no | the largest honest win, and slice 2 (§8.2) — but nothing of it is built, so there is no page to link to. **Measured, and it is worth recording for whoever builds it:** setting `data-theme="light"` on the running window does *not* give a light window — `styles.css`'s own palette (`--bg-raised`, `--text`, …) has no light block, so the pane title measured rgb(250,250,250) on rgb(250,250,250), a contrast of **1.0**. The theme control needs a light palette in `styles.css` as well as the token sheet's, which is more than "one dropdown" |
| `shortcuts` | **honour-able with work** (§4.5) | **yes, read-only** | overrides, a grown table and conflict reporting are slice 5 (§8.5) and are not built. What *is* built is the registry and the mounted handler, so the section lists the keys the window listens for and says in as many words that a key not on the list does nothing in this build. No control on that page writes anything, and none says it does |
| `about` | **honour-able with work** (§4.10) | **yes** | the audit called the version-mismatch row "a real control-plane need and nearly free". It was, with one correction: the **window's** half is not free. The renderer is a bundle served from disk with no process to read its own `package.json`, so the number is a build-time constant (`vite.config.ts` → `src/app-version.ts`), and when nothing inlined one the page says so rather than comparing a guess. The channel row (auto-update) is still N/A — there is no updater |
| `layout`, `editor`, `diagnostics`, `metadata`, `usage` | **not applicable** (§4.3, §4.4, §4.9, §5.6, §5.9) | no | multi-pane workspace placement, an editor we do not ship, a native-only terminal renderer (its two useful things are actions, and our equivalents are the pane's own chips and notes), which model writes text we never generate, and a quota fetcher for accounts we do not have |
| `workspaces` — archive merged PRs | **must be disabled-with-reason** (§5.7) | no | the one section this document says should be *shown disabled*, and it also says when: **with the git slice, not before it.** There is no git service, so the row has nothing to switch; shipping it now would be a promise on a page with nothing else on it. When the git slice lands, the row and its reason ship together |

**Why absence rather than a disabled row, in one place.** The vocabulary in §1 exists for the case where
the row is meaningful and we cannot honour it *yet* — "Ask before anything destructive" is exactly that
today, and it renders disabled with the agent named. What the eleven named sections above have in common is
different: each needs a **subsystem** that does not exist (a terminal, a plugin runtime, an OS notification
path, an account system, a git service, a session store). A disabled control there would be a promise
attached to work that is not settings work, which §7.2 already argued and this restructure followed.

**What that leaves as future bar items, named so they are not rediscovered:** user-defined agents (§5.8's
two honour-able rows, §8.4), a system prompt (§5.5 `appendSystemPrompt`, upstream first), saved agent
profiles (§5.5), and `autoArchiveAfterMerge` the day the git service exists (§5.7). Each is a section that
would be added to the registry above with its own contents and its own citations — which is the shape this
document is asking the next person to follow rather than invent.

**Driving the window found a crash, and the crash was evidence.** The daemon already running on this
machine while this section was written is a build behind: its `HarnessSummary` carries `modes` and **no
`models` and no `thinking`** — verified by asking it (`coder.listHarnesses`, read-only) and comparing with
a daemon built from the current source, which sends both. The window accepts that answer, the new Agents
page read `harness.models.options` and threw, React unmounted the pane — there is no error boundary above
the shell here — and the user got an empty window. That is §7.2's wire asymmetry as a **live** state rather
than a hypothesis, and it is why the page now answers an older daemon with one sentence in the user's
language ("the daemon did not send what {agent} publishes about itself … restart EnvoyCoder so both come
from one build") instead of taking the application down. The regression test asserts the window is still a
window on that answer, and it fails with the same `TypeError` when the guard is removed — which is how it
was checked, since no jsdom fixture had produced that shape until this was seen in a browser.

**The gate that keeps the bar honest** is `apps/desktop/test/settings-nav.test.tsx`, and it asks three
questions rather than one: **does every section name a source that still contains what it claims** (every
citation re-read against the file, with the negative case proved on a fabricated registry: no content, a
missing file, and a moved line each fail), **does every section render a row** (each of the eight is
rendered alone and refused if its body holds no control, list item or definition row), and **is the bar the
registry** (the rendered names, in order, equal the registry's title keys). The mutations that fail it are
listed in the file's own header and were each run: a section with nothing in it, a section whose page
renders `<></>`, a hardcoded ninth item, an item that navigates nowhere, a mark taken from a local
selection, a bar rendered at 900px, and the whole shortcut table listed instead of the mounted bindings.

### 7.7 The pre-flight probe: asking an agent what it offers, before it has ever run

**The defect, stated as the owner stated it.** Two of the composer's three pills behaved differently per
agent, and the user could not tell why. `envoy-harness` publishes nothing over ACP: its models come from
`DEFAULT_PROVIDER_MODELS` in its own source and it takes them as `--provider`/`--model` argv
(`packages/agent-catalog/src/models.ts:222-234`). `deepseek-harness` **does** publish — `provider/model`
pairs with names and descriptions, plus a `reasoning_effort` level — but only inside a session's
`session/new` response. So the same three controls were populated for one agent and hand-typed for the
other, and the only honest thing the window could say about the second was "type `provider/model` from
memory" (`task.composer.model.freeText`) or "there is nothing to choose from until it has run once"
(`task.composer.thinking.notSeen`). Both sentences were true; neither was a feature.

**What this slice added.** A probe: start the agent the way a run does — the same launch resolution,
`initialize` → `session/new {cwd, mcpServers: []}` → read `configOptions` → close — and write the answer
through the **same store path a run writes** (`CoderStore.recordSessionOptions`, `session-options.json`).
The window needed no new rendering path at all: `coder.listHarnesses` reads the record it always read, so
the pickers fill from the same `AgentModels`/`AgentThinking` the pills were already built on.

**Three outcomes, never two.** `PROBE_OUTCOMES` (`packages/protocol/src/rpc.ts`) is the type, and the third
member is the whole point — rendering a failure as "publishes none" is the claim this product keeps
refusing, because it is a statement about somebody else's product made from evidence we do not have:

| outcome | what happened | recorded? | what the window draws |
|---|---|---|---|
| `listed` | the session published options | **yes** — normalized by `observeSessionOptions`, the same function a run goes through | nothing extra: the pills fill, and their "observed at {time}" note gains this session's timestamp |
| `none` | the session opened and published nothing | **yes**, as an observation with `options: []` — "we asked and it offered nothing" is a fact about the agent, and it is what a run records for `envoy-harness` too | `task.composer.probe.none`, the daemon's own keyed sentence |
| `unreachable` | missing binary, not drivable, refused to start, never answered, budget exhausted | **no, never** | `task.composer.probe.failed`, the daemon's keyed sentence naming the reason |

**The wire: one new method and no new fields.** `coder.probeSessionOptions { harness, force? }` →
`{ harness, outcome, detail }`, with `outcome` **required** rather than optional so "absent" can never be
read as one of the three answers — the same discipline `AgentModels.kind` and `AgentThinking.kind` already
follow. `HarnessSummary` is unchanged: nothing needed to be added to it, because "a probe is in flight" is
a fact the *window* owns (it made the call), and the answer reaches it through the store's existing
`coder:state-changed { kind: "harnesses" }` event. An older daemon simply does not have the method, and the
window checks `coder.hello`'s `methods` before offering the button — see §7.2, where this is recorded as
*not* widening the open result-schema asymmetry.

**Cost, bounded in four ways, because a probe is a process spawn.**

| bound | how | why that |
|---|---|---|
| trigger | the composer asks **once per agent**, when a control that needs the list is on screen (`TaskPane`) | never at daemon boot, never on a timer, never as a side effect of `coder.listHarnesses` — a list call that silently spawned agents would make rendering a sidebar start every installed one. The alternative (a button the user has to find) fails the product's own rule: it makes the user responsible for our ignorance, and it leaves the "a probe is running" state unreachable |
| cache | in memory, per agent, with `at` and the agent's build fingerprint | a second window, a phone or a re-render gets the answer we already have instead of a new process. In memory on purpose: the durable record is the store's, and a daemon restart is a legitimate moment to ask again |
| staleness | `PROBE_STALE_MS` = **10 minutes**, and a changed build re-probes regardless | a list changes when the *build* changes (caught by the fingerprint, not by the clock) or when the user's credentials change (rare, and *Ask again* forces with `force: true`). A **failure is never cached**, so the next ask is the retry |
| timeout | `PROBE_HANDSHAKE_MS` = 20s per handshake request, `PROBE_TIMEOUT_MS` = 30s for the whole probe | the inner budget is the one that fails with a readable sentence; the outer one makes "a probe answers within 30 seconds" a property of the module rather than a hope about two timeouts composing |

Two more, worth stating because they are what a user would notice: probes of one agent are **serialised**
(a second ask joins the first's answer rather than starting a second process — two racing probes would write
two observations and the loser could be the older one), and the session is opened in the daemon's own
scratch directory (`<stateDir>/agent-probe/<agent>`), **not in the user's project**: a probe is not the
user's work, and an agent that indexed, or ran `git` in, a tree nobody asked it to touch would be a
side effect of a *settings* control. If an agent's option list ever becomes a function of the working
directory, that choice is the line to revisit, and it is recorded where it is made.

**"Same features" where an agent genuinely cannot do it.** The surface is the same and the reason differs,
naming the agent — that is the rule, and the probe does not change it. `envoy-harness` gets **no** probe
button, because there is nothing to learn: its model list is published in its own source and it has no
thought-level surface at all. No probe is offered either when the agent cannot be run — any of `not-installed`,
`needs-bridge`, `unsupported` or `unknown` (§7.9), because the gate is `ready` and not "not obviously
missing" — or when the daemon is an older build. In all cases the control is not hidden behind a dead
button: the pills keep their own sentences for our ignorance and the agent's lack, in the user's language.

**Five sentences, and where they live** (`apps/desktop/src/i18n/messages/en.ts`, all seven languages in
step — `npm run i18n:gap` reports 341/341 for six of them):

| key | authored by | shown |
|---|---|---|
| `task.composer.probe.ask` / `.askAgain` | the window | the button, whose label says whether this is the first ask or another one |
| `task.composer.probe.asking` | the window | while the probe runs: it names the agent **and says what the ask costs** — an agent process, started, asked and closed — because a control that spent the user's machine quietly would be the lie this row exists to avoid |
| `task.composer.probe.none` | the **daemon** (`keyed()`) | the agent answered and published nothing |
| `task.composer.probe.failed` | the **daemon** (`keyed()`) | we could not ask, with the reason (the agent's or the OS's own words) interpolated as `{reason}` |

The `listed` sentence is deliberately **not** keyed and not drawn: the store's record is what the user
sees, and a catalogue key whose sentence no window draws is a key nothing keeps honest.

**The gate is four test files, and each one's negative case was run.** `apps/desktop/test/session-probe.test.ts`
(the decision, with a port object and a real store: outcomes, recording and non-recording, cache, staleness,
build fingerprint, `force`, in-flight join, timeout, single teardown); `apps/desktop/test/daemon-rpc.test.ts`
(the three outcomes over a real socket with real child processes, plus the `harnesses` change event and the
file on disk); `apps/desktop/test/acp-transport.test.ts` (the **real** `dsh` publishing and the **real**
built-in harness publishing nothing); `apps/desktop/test/composer-controls.test.ts` +
`apps/desktop/test/task-pane.test.tsx` (the four window states, pure and rendered). Twenty-five mutations
were applied and each turned its named test red — the table is in the slice's report, and the two that
matter most are the two this file's own history predicts: deleting the store write, and recording a failure
as an empty observation.

**Two bugs this slice found in passing, and fixed** — both in `AcpClient`'s teardown, which a probe
exercises in exactly the shape that finds them:

* **`exit` is not the only way a process ends.** "The process is gone" resolved on `exit` alone, and Node
  does **not** emit `exit` when the spawn itself failed (it emits `error` and then `close`). `stop()` ends
  in `await this.exited`, so a bad binary hung the client and every caller awaiting it — the probe hit it on
  its first run, waiting the full 30-second budget to report a missing binary. The promise now resolves on
  either event, and `apps/desktop/test/acp-transport.test.ts` asserts the bound (`< 15s`; it hangs when the
  `close` handler is removed).
* **The `ERR_STREAM_WRITE_AFTER_END` this repo has been seeing intermittently.** `stop()` was `async`, so
  *two* callers arriving together — a run's own `finally` and `RunManager.stopAll` during shutdown — each
  got their own promise, each passed the `stopped` check, and the second one sent `session/close` down a
  stdin the first had already ended. It is now memoised into one teardown, and the test asserts the
  mechanism directly (`client.stop()` twice in the same turn returns the *same* promise), which fails when
  the method goes back to being `async`.

### 7.8 Which agents run, and what each claim was verified against

The agent list is a settings-adjacent surface rather than a settings row (it is the `providers` section's
subject, §5.8, and it decides which of the composer's three pills are enabled), but "which agents can a
user actually pick and run" belongs in the record of what this product does today. It used to be **two**,
and the picker offered seven others as recipes nobody had run.

**Five run today, and each one was driven against its real binary rather than read out of a manifest.**
(The *row* a user reads is a separate question from this table and is answered by §7.9: two of these five
are driven through an npm bridge that the agent's own CLI does not include, so "installed" needs two
sentences rather than one.)
The three that joined were already *listed* — what changed is that their commands were replaced with ones
that were measured to answer `initialize`, open a session and publish options, and that the catalogue now
records exactly what was seen. The provenance lives on each entry's `evidence`; the commands and their
sources:

| agent | command | where it came from | verified |
|---|---|---|---|
| `envoy-harness` | `envoy-harness run --acp`, or the peer checkout's `dist/cli/acp-stdio.js` | the peer's own CLI (`../envoy-harness/packages/envoy-harness/src/cli/argv-help.ts:45`) | handshake, session, a **completed turn** (`stopReason: "end_turn"`), published nothing |
| `deepseek-harness` | `dsh --profile acp` | the peer's own README's profile list | handshake, session, model list and `reasoning_effort` published |
| `claudecode` | `claude-agent-acp` (npm: `@agentclientprotocol/claude-agent-acp`) | Claude Code itself has no ACP mode — `claude --help` on 2.1.159 lists no `acp`, and `claude -p … --output-format stream-json` never answers an ACP `initialize` | handshake, session, `mode`/`model`/`effort` published, a **completed turn**, `modeId` accepted |
| `codex` | `codex-acp` (npm: `@agentclientprotocol/codex-acp`) | Codex's own servers are `app-server` and `mcp-server`, neither ACP; `codex acp` exits immediately | handshake, session, `mode`/`collaboration_mode`/`model` published, `modeId` and a model change accepted. **A turn did not complete on the machine this was written on** — the bridge's own stderr shows `chatgpt.com` refusing the connection |
| `cursor` | `cursor-agent acp` | the Cursor CLI's own `acp` subcommand | handshake, session, `mode`/`model` published, `modeId` accepted, and `authenticate {methodId: "cursor_login"}` required on a fresh install |

**Four are listed with a reason, and that is the honest outcome**: `copilot`, `opencode`, `pi` and `omp`
have no ACP surface we could find, so `isDrivableByAcpAdapter()` refuses them by name and the window shows
the existing capability warning. They are not hidden — a row is information — and none of them claims to
be supported.

**Two protocol facts this slice had to write down per agent, because guessing either one lies:**

* **`session/set_mode` reads two different field names.** `envoy-harness` reads `{mode}`; every agent
  reached over a bridge or a vendor subcommand reads the specification's `{modeId}`. The built-in harness
  **silently ignores an unknown `modeId`** and answers `{mode: <unchanged>}` — a success — so a client that
  "tried one and fell back on a refusal" would report a mode it never applied. Every entry that claims a
  settable mode therefore declares the field (`AgentLaunch.modeParam`), and `AcpClient.setMode` refuses to
  send one that was never recorded.
* **One agent needs `authenticate` before it will open a session.** `cursor-agent acp` answers
  `session/new` with `-32000 Authentication required … methodId 'cursor_login'` on a fresh install, and the
  requirement is **stateful** — after the step has run once it opens sessions without it (measured both
  ways; the entry's `evidence` records the difference). The method is declared in the catalogue and sent
  idempotently, because choosing one is not something the client may do on the user's behalf: the other
  ACP agents offer `type: "env_var"` methods that fail when a variable is unset and a browser-login method
  a user did not ask for.

**The gates, and which half of each claim they hold.** `packages/agent-catalog/test/drivable.test.ts`
pins the split (five drivable, four not, every mode-claiming entry declaring its field, exactly one entry
needing `authMethodId`); `apps/desktop/test/acp-agent-support.test.ts` drives the real binaries through
`launchForHarness` — the same function a run uses — and **skips loudly, naming the install command**, when
one is absent, with the scripted-agent half of the same file proving the two declared steps on every
machine; `agent-catalog.test.ts` and `models.test.ts` pin the argv, the model encodings and the sources.

**What is *not* claimed, deliberately:** `capabilities.approvals` was left `false` for all three new
agents. The old entries had inherited `true` from flags belonging to a command this build never ran, and a
live turn through the Claude bridge in its own asking mode ran a shell tool call without raising
`session/request_permission` — so the one thing the flag asserts was not observed. Thinking levels for the
three were **read but not wired** (the bridge's `effort` option, Codex's `reasoning_effort`, and Cursor's
reasoning-in-the-model-id); the pill stays disabled with our reason rather than sending a level whose
effect nobody measured.

### 7.9 Which part is missing: availability as five states, and the `PATH` they are found on

The Agents row and the composer chip used to answer one question with one boolean — `HarnessSummary.available`
was `boolean | "unknown"` — and the user report that ended that was three words long:

> *"I have installed codex and claudecode, deepseek-harness, why all of them shown 'Not Installed'."*

They were right, and there were three independent causes, all of which produced the same wrong word.

**1. An agent is a binary *plus the adapter we drive it through*, and only one of them was recorded.** Claude
Code and Codex have no ACP mode (§7.8's table is the evidence: `claude -p …` and `codex exec --json` never
answer `initialize`), so their entries name the **bridges** — `@agentclientprotocol/claude-agent-acp` and
`@agentclientprotocol/codex-acp`. Both had been verified from throwaway `/tmp` prefixes and never installed
globally, and the user was never told to install them. So the probe asked about a program that was not there,
found it absent, and reported the **agent** missing — while `claude` 2.1.159 sat in `~/.local/bin` and `codex`
in `~/.npm-global/bin`. The catalogue now records both halves (`AgentLaunch.agentBinaries` is the agent's own
CLI, `install.bridge` is the adapter's command), and the probe asks in the order of specificity: the program we
drive first, then — only if it is absent and the entry declares a bridge — the agent's own program.

**2. A GUI-launched daemon's `PATH` is not the user's, and nothing repaired it.** Measured on the machine this
was written on: `launchctl getenv PATH` prints **nothing**, and Finder-launched processes carry no `PATH` in
their environment at all. `spawn_daemon` in `apps/desktop/src-tauri/src/main.rs` passes only
`ENVOYCODER_DAEMON_PORT`, so what the daemon inherits depends entirely on where the app was launched from — and
the same daemon started from a terminal (the `npm run tauri:dev` development arrangement) answered *differently*
from the same daemon started from Finder. `packages/platform/src/path-discovery.ts` now resolves the list and
**both probing and spawning use it** (`launchForHarness` reads it once and puts it in the child's environment,
because a bridge that probed as present and then cannot find the CLI it wraps is worse than one reported
missing). The order is documented there; the short version:

| # | source | why it is in this position |
|---|---|---|
| 1 | `$SHELL -ilc 'printf …"%s" "$PATH"'`, `LOGIN_SHELL_TIMEOUT_MS` = **2500 ms** | the only source that includes what the user's rc files add, which is what "installed" means to them |
| 2 | the daemon's own `PATH` | honest by definition, kept even when (1) answered, because a profile that *replaces* `PATH` would otherwise make the daemon forget where it was launched from |
| 3 | `wellKnownBinDirs()`: `~/.local/bin`, `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.cargo/bin`, `~/.bun/bin`, each only if it exists | what rescues a GUI launch, where there is no terminal to ask. Nothing on Windows: the registry `PATH` reaches a GUI process there, so there is nothing to repair |

Bounded in three ways rather than one. The timeout kills a shell that hangs; `LOGIN_SHELL_MAX_OUTPUT` (64 KiB)
drops one that floods; and the output is read **by marker** rather than by "the last line", which is not
theoretical — this machine's `/bin/zsh -ilc 'printf %s "$PATH"'` prints **`Restored session: Mon Sep 14
23:42:52 CST 2026` on stdout before the `PATH`**. A value that is not a plausible `PATH` is refused rather than
believed, because believing one would silently make every agent look uninstalled. **The daemon never waits for
any of it**: `currentSearchPath()` is synchronous and answers from what has already landed, `primeSearchPath()`
runs at boot off the critical path, and when the login shell's answer arrives the daemon broadcasts the same
`harnesses` state change a recorded session uses — so a window that painted a row a moment earlier refetches
instead of showing an answer we have already replaced.

**3. The window had one word for every false.** `SectionsFacts.tsx` mapped `available === false` to a danger
chip reading "Not installed", so a missing *bridge* and an invisible *binary* read identically. There are now
five states, each naming what is absent, and the schema refuses an availability that contradicts itself:

| state | the word | what it asserts | what the row offers |
|---|---|---|---|
| `ready` | "Ready" | the program we drive resolved and this build speaks its protocol | nothing to install |
| `unsupported` | "Cannot be driven yet" | the program is there; no adapter exists for the protocol it speaks (`transport: "cli"`) | nothing — the gap is ours, so offering an install command would be a lie about the user's machine |
| `needs-bridge` | "Needs its adapter" | **the agent's own CLI resolved and the adapter did not** — the reported bug, named | the adapter's `npm install -g …`, from the entry |
| `not-installed` | "Not installed" | neither resolved, over a search that ran | the agent's install command **then** the adapter's, in order |
| `unknown` | "Not checked" | we could not run the search (`SearchPath.searchable` is false) | **no install command**, and the row must never read as "not installed" |

Three further decisions worth recording, because each could have gone the other way:

* **`unknown` is not "not installed", and that is the state's whole reason to exist.** A daemon that could not
  assemble a search list — no `PATH`, no shell answer, no well-known directory — has established nothing, and
  the schema *forbids* a `fix` on that state so the window cannot offer an install command for something nobody
  saw missing. A login shell that **times out** is deliberately *not* this case: the fallbacks still ran, so a
  search happened and its negative result is real.
* **A hit inside another tool's cache counts as installed, marked as provisional.** `dsh` resolves here at
  `~/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh` — a path created for somebody else's `npx` invocation,
  with a random hash in it, removed by `npm cache clean`. It is a real program and this repository drives it for
  real (`acp-transport.test.ts`), so "not installed" would be false; but reporting it unqualified would hide why
  it can vanish. It is `ready` with `provisional: "npx"`, one warn chip, and the entry's install hint still
  points at a real installation (`npm install -g @deepseek-ai/dsh`). A toolchain manager's directory
  (`~/.volta`, `~/.asdf`) is deliberately not in that list: those are installations the user chose.
* **A picker drops only `not-installed`.** `knownMissing()` is the translated rule for
  `harness.available !== false`; the other four states stay in the list, because hiding an agent a user has
  configured — one whose adapter is missing, or one nobody has checked — is a worse failure than offering one
  the row then explains.

**The wire, and the compatibility consequence.** `HarnessSummary.availability` is **required**, and
`HarnessAvailabilitySchema`'s `superRefine` rejects the five ways it can disagree with itself: `binary` present
⟺ the state says we found the program we drive; `agentBinary` only with `needs-bridge`; `provisional` only with
`ready`; `fix` present ⟺ there is something to install, and **non-empty**; and no `fix` on a state that asserts
nothing is missing. `installHint` is **deleted** — with two install steps it could only name one of them, and the
commands now travel inside the state that implies them. `coder.probeHarness`'s result widened from
`available: z.boolean()` (which could not express `unknown` at all) to the same `availability`, so the singular
probe and the list cannot answer differently.

An **older daemon** sends `available` and `installHint` and no `availability`, and this schema is `.strict()`, so
its answer no longer validates. Nothing in the running product validates a result on the client — the schemas are
the declared contract and the tests' instrument — so the window does not break, and `availabilityOf()`
(`apps/desktop/src/composer/agent-for.ts`) reads the legacy field itself. The mapping is the interesting half: a
legacy `true` is `ready` (the same claim, and the change does not make it false retroactively) and a legacy
`"unknown"` is `unknown`, but a legacy **`false` becomes `unknown`, never `not-installed`** — that daemon only
ever asked whether *the program it drives* was on *its* search path, which for a bridged agent is the adapter, so
its `false` is exactly the wrong word this change removes. Carrying no `fix`, it cannot be read as advice
either; the row adds one sentence naming the daemon as a build behind and restarting EnvoyCoder as the fix.

**A refusal has a state too, and it needed a third code.** The settings row is not the only place a state
becomes a sentence: pressing Send on an agent that cannot run gets a *translated* refusal, keyed, and the key is
what a German user reads. Two of the states map onto codes that already existed — `needs-bridge` is
`harness-missing` (something must be installed, and the sentence names both steps) and `unsupported` is
`harness-unsupported` (nothing to install; the gap is ours). But `unknown` could not borrow either: the existing
`harness-missing` sentence is *"X is not installed on this machine. Install it, then start the task again."*, and
that is precisely the claim the state exists to forbid. So `ENVOYCODER_ERRORS.harnessUnknown` and
`error.harnessUnknown` are new — "EnvoyCoder could not check whether X is installed, so it did not start the
task. Restart EnvoyCoder and try again." — and `launchForHarness` decides drivability **before** installation,
because "install it" is wrong advice for an agent we have no adapter for whether or not it is present. That
ordering is not stylistic: widening the state to include `unsupported` would otherwise have moved every
installed-but-undrivable agent into the "missing" branch, telling a user with Copilot installed that it is not
installed. It was caught by writing the test, and it is now pinned by one.

**The gates, and what each one is for.** `apps/desktop/test/launch-search-path.test.ts` also pins the three
codes apart (`coderErrorCode`/`coderErrorRef`, the half a translated window reads rather than the English
prose). `packages/platform/test/path-discovery.test.ts` (18 tests: the marker
against real rc-file noise, a **real** `sleep 30` shell against a 400 ms deadline, garbage with and without the
marker, the output bound, the source order, `searchable: false`, `~/` expansion, cache isolation, and one leg
against this machine's real login shell that prints why it did not run when there is none);
`apps/desktop/test/launch-search-path.test.ts` (4 tests: the probe resolves from a given list **and a real child
process sees that same list**, and neither is satisfied by the ambient environment);
`packages/agent-catalog/test/agent-catalog.test.ts` (the four states, `needs-bridge` never reading as "not
installed", the search order, and the npx-cache marker);
`packages/protocol/test/rpc.test.ts` (the five agreement rules, each violated deliberately);
`apps/desktop/test/availability-compat.test.ts` (every legacy answer, including the one that must not become
"not installed"); `apps/desktop/test/settings-nav.test.tsx` (the five words **as rendered**, associated with the
right rows); `apps/desktop/test/composer-controls.test.ts` and `apps/desktop/test/daemon-rpc.test.ts` (the four
non-ready states gate the probe, a real daemon's every summary parses under the contract, and the boot-time
`harnesses` broadcast). `scripts/smoke.ts`'s catalogue step now prints the state rather than a tick, so the first
thing a bug report reads is which part is missing.

---

---

### 7.10 The agents a user declares: the provider contract, and why it cannot hold a secret

Paseo's `providers` page (§5.8) stores a credential per provider as plaintext `env` in `config.json`.
This repo declined to copy that, and the refusal shaped the schema rather than the other way round: a
user-defined agent here names the environment variables it needs and never their values.

**The shape.** `AgentProviderConfig` (`packages/protocol/src/domain.ts`) is the whole contract:

```ts
{ id, label, command, args, env: readonly string[], transport: "acp" | "cli", authMethodId?, modeParam? }
```

`env` is `readonly string[]` — a list of **names**, each checked against
`PROVIDER_ENV_NAME_PATTERN` (`[A-Za-z_][A-Za-z0-9_]*`). That is the security decision, and it is the
type rather than a rule written beside it: a `Record<string, string>` of values would have a field for
`sk-live-…`, and this has none, so no caller, no control and no future migration can write one to
disk. A test asserts the artifact rather than the intent — a recognisable value is put in the daemon's
environment, a provider is stored naming it, and `providers.json` is then read as bytes and checked
not to contain it (`apps/desktop/test/providers.test.ts`, `daemon-rpc.test.ts`).

**Where a value goes.** Nowhere but the child. At spawn each named variable is copied from the
daemon's **own** environment and merged over the `PATH` the probe searched, and a name that is unset
(including set-to-empty, since `FOO=` exports nothing) is a **refusal**, in the user's language, naming
the provider and the variables — never a silently skipped variable, which would start an agent that
cannot authenticate and let it fail with its own sentence. The same fact travels to the window *before*
a run: `AgentProviderSummary.env` is `{ name, set }[]`, so the row can say which variable is missing
while nothing on the wire or in a log is a value.

**The dialect is reused, not reinvented.** `transport`, `authMethodId` and `modeParam` are the same
three facts `AgentLaunch` records for the nine catalogue entries, and `providerLaunch()` maps a
provider onto that type rather than giving it a private launch vocabulary. That is what lets a provider
travel the *same* paths as a shipped agent:

* **one prober** — `probeRecipe` in `packages/agent-catalog/src/probe.ts`, over a *recipe*. Before this
  slice the prober was a function of a `HarnessId`; a provider is not one, and a second prober beside
  the first is how the two would come to disagree about the same machine. `probeHarness` and
  `probeProvider` are two thin wrappers over that one body;
* **one launch body** — `resolveLaunch` in `apps/desktop/src/daemon/launch.ts`, with
  `launchForHarness` and `launchForProvider` differing only in the two callbacks they hand it, so the
  `PATH`, the refusals and the dialect fields cannot drift;
* **one availability projection** — `harnessAvailability`, whose parameter is now `ProbeFinding`
  rather than `HarnessProbe` for exactly this reason.

A provider is **probed, never believed**: a row the user typed is a recipe, and whether its program is
on this machine is measured. A program that is present and declared `"cli"` is `unsupported`, a program
that is absent is `not-installed` with a fix — and for a program we have never heard of, that fix is
the user's own command line, because nobody can author an install step for somebody else's tool
(`probe.ts`'s `notInstalledFix` records the choice; the schema requires *some* fix of a state that
asserts an absence).

**What a provider deliberately does not have.** No `capabilities`, `modes`, `models` or `thinking`:
we have never opened a session with this program, so every one of those would be the user's guess
handed back as our fact. The composer's pickers stay off for one, with the reason on screen, until a
session exists to ask. There is also no model support: a provider's model is whatever the user put in
`args`.

**What is left.** The picker: a control that adds one, a row per provider, and the 38 catalogue entries
(`packages/agent-catalog/src/acp-catalog.ts`) as things a user can pick. The RPCs, the storage, the
probe and the launch path are all in place and tested.

## 8. The slice plan

Ordered, and ordered by *cheapness times usefulness* rather than by Paseo's section order. Each slice
is one coherent commit: schema + store + effect + UI + 7 languages + tests, and each one says what it
buys a user. Slices 1–3 need **no upstream change and no new protocol field beyond our own
`CoderSettings`**; slice 4 is the first that touches a contract and must go upstream first
(family guide §7.4).

### 8.1 Slice 1 — Make the settings we already show honest

**Status: built.** What follows is the plan as it was written, with each bullet's outcome attached.
The outcomes are the honest part: one of them is not what the plan said, and says why.

**Buys the user:** a Settings pane where every control does what it says. At the time, two of five did
not, and three more fields were read by the app with no control writing them.

* `requireApprovalForDestructive`: either implement the gate (skip the prompt when false — the
  approval path is `runs.ts:626-664` and the daemon already knows the option list) or render it
  **disabled** with the reason. The decision is worth making explicitly: a control-plane user's
  approval setting is a *policy* setting, and the honest version is "approvals always happen because
  the agent asks, not because we ask it to".
  **Outcome — a third option, and neither of the two the plan named.** The setting is delivered as the
  agent's **own session policy**: `session/set_policy { autoRun }`, resolved per run by
  `resolveApprovalPolicy` (`run-options.ts:231-237`), `true` → `always-confirm`, `false` → `off`. That
  is strictly better than both branches above — the gate is real, and the *agent* does the asking, which
  is what this product's approval model already required. It is not fully "implemented", which is why
  the row carries a second sentence: `envoy-harness` documents the method and `deepseek-harness` does
  not, so for the latter the switch is **disabled with the reason naming the agent**
  (`capabilities.approvalPolicy`, `rpc.ts:967-975`). See §7.2.
* `allowRemoteRuns`: render **disabled with the reason** (§7.2) until there is a remote path.
  **Outcome — deleted instead, control and field together.** This is the plan revised rather than
  followed, and §7.2 gives the reasoning: a disabled row promises a feature whose prerequisites are not
  settings work, and `coder.offerRemoteRun` — the method that would have served it — was itself a spec
  with no handler, so it went too. `RETIRED_SETTINGS_KEYS` keeps an upgrading user from losing the rest
  of their settings file to the removed key.
* `defaultProjectPath`: give it the control it deserves (it is the folder a new task starts in, and
  the folder picker already exists in `apps/desktop/src/client/folder-picker.ts`), or delete it from
  the type and the RPC params.
  **Outcome — the first option, precisely as the plan was not quite right about it.** The folder is the
  one **"Add project…" starts in**, not "the folder a new task starts in": a task's folder comes from
  its project (`project.path`), and a default path has no business overriding that. So the control is a
  path field with the existing picker beside it, and the *reader* is the palette's `project.add` row,
  which seeds its text stage with it (`CommandCenter.tsx:425-435`). Two assertions in
  `palette-flow.test.tsx` cover both states.
* `defaults.model` / `defaults.extraArgs`: give them controls beside the default agent, or remove them
  from `TaskDefaults`. The composer already carries a per-task model (`TaskPane.tsx:102-104`), so the row
  exists — only the app-level default is missing.
  **Outcome — controls, at both scopes.** The app scope gets a model row and an extra-args row beside
  the default agent (`SettingsPane.tsx:311-335`) and so does the project scope (`:571-593`), sharing
  `ModelChoice` with the composer so the three model controls cannot come to mean three things. The
  `""`-clears-it sentinel exists because a JSON patch cannot carry an absent key; the store drops it
  (`store.ts:498-502`, `:732-739`).
* Fix the project `⋯` button (`CoderApp.tsx:294`) so it either opens a project scope or stops
  claiming to.
  **Outcome — it opens a project scope** (`openProjectSettings`, `CoderApp.tsx:175-177`, rendered
  `SettingsPane.tsx:497-598`). That is §7.4's third scope, and it needed a write path the daemon did not
  have: `coder.updateProject`'s defaults patch (`rpc.ts:1093-1107`, `store.ts:293-308`), where the
  defaults **replace** rather than merge, unlike the app's.
* Add the **section structure** the pane needs before it grows: one heading per group. Not a copied
  sidebar — one column, headings, in the order the slices below give.
  **Outcome — three headings, and then a bar.** The headings were *General*, *New tasks start with*,
  *Safety*, plus the two read-only groups. The owner has since asked for the reference product's settings
  left bar, and the answer is that bar with our contents: the headings became **eight sections** with
  their own pages, the bar lists the registry, and on a narrow window the registry is the page. §7.6 is
  the section-by-section account and the list of sections we deliberately do not have. The rule this
  bullet was written to protect is unchanged and now has a gate: a section cannot be added to the bar
  without naming the source that backs it, and `test/settings-nav.test.tsx` fails a section with nothing
  behind it.

**Gate:** a test that asserts every field of `CoderSettings` is either read at a named site or absent
from the schema. Written as a test rather than a grep so that adding a field without a reader fails
CI, which is the only way this class of defect stays fixed.

**Built as:** `apps/desktop/test/settings-coverage.test.ts`. It enumerates the fields from
`CoderSettingsSchema` (the stored shape, not the interface — a field on the interface that is not
storable is a field nobody can hold), requires a `{ file, needle }` read site for each, refuses a site
**inside the pane that renders it or the module that declares it** — the two files
`defaultProjectPath` was found in while it was dead, so a guard that counted them would have passed on
the defect it was written for — and checks the retired-key list has not crept back into the schema. It
was verified to fail: adding a `proofOnlyDeadField` to the schema and the interface turns the first
case red with `- "proofOnlyDeadField"` and `+ (nothing)` in the difference; pointing a field's site at
`SettingsPane.tsx` turns the third red with *"is where the field is rendered or declared, not where it
is read"*. Adding a field, the coverage test and the field's own behavioural test is now the cost of a
settings change, which is the point.

**And the behavioural half, because a read site is a citation rather than a proof.** The guard says
*where* each value is read; these say it arrives:
`apps/desktop/test/settings-store.test.ts` (the `""`-clears-it sentinel, merge-versus-replace, the
retired-key read, and the app defaults reaching a created task),
`apps/desktop/test/settings-scope.test.tsx` (the project scope's rows, that a write carries the values it
is not changing, and the three-level navigation of §7.5: the app scope counts the projects and opens the
page; the page renders what it was given, each row with *its own* path, and all of them with no cap and no
windowing; a row opens *that* project's scope by id; **each back control returns to its own level** and
says so, the two labels differing because the two destinations differ; the rail's menu and the page open
the same scope; an empty list teaches instead of rendering an empty box; and a project that goes away
falls back to the page. Every one of those was negative-tested — eighteen mutations, each verified to fail
the test it is aimed at with no other file left changed (§7.5)),
`apps/desktop/test/palette-flow.test.tsx` (the seeded "Add project" field),
and four cases in `apps/desktop/test/runs.test.ts` (the approvals policy reaching the agent, both
positions, not sent to an agent that cannot be told, and a loud failure when the peer refuses anyway).

**Also in this slice, and not in the plan above:** `HarnessSummary.capabilities.approvalPolicy` (a
fourth delivery flag beside `agentMode`/`model`/`thinking`, `packages/agent-catalog/src/index.ts:186-210`)
and `RETIRED_SETTINGS_KEYS`/`withoutRetiredSettingsKeys` (`domain.ts:832-840`). Neither is a setting a
user sees; both are what make the two rows above honest rather than approximately honest.

### 8.2 Slice 2 — `Appearance`: theme, and the two text sizes

**Buys the user:** light mode, and text they can read.

* `theme: "light" | "dark" | "system"` (default `"system"`), written to
  `document.documentElement.dataset.theme`; `design/tokens.css:117`,`:155-156` already has both
  variants and the media-query fallback.
* `uiBaseFontSize` and `contentFontSize`: two clamped numbers, applied as root custom properties over
  the existing scale.
* One **Appearance** heading in the pane holding all three.
* `autoExpandReasoning` goes in the same slice — one boolean, `run.thought` is already on the wire,
  and the transcript row already exists (`transcript.ts:39`,`:150-158`).

**Gate:** a `vitest` case per setting asserting the effect (the `data-theme` attribute; the computed
root variable), plus i18n key-parity for the seven catalogues.

### 8.3 Slice 3 — `General`: send behaviour and the default agent

**Buys the user:** the agent's follow-up behaviour is theirs to choose, once, instead of per pane.

* `sendBehavior: "queue" | "steer" | "interrupt"` (default `"steer"`, matching Paseo — our own
  default today is the literal `"steer"` at `controls.ts:679`, so the default does not change).
* Widen `resolveSendBehaviour`'s `preferred` (`controls.ts:542`), pass `settings.defaults.sendBehavior`
  from `TaskPane.tsx:134`, and use it as the pane's initial `mode` (`TaskPane.tsx:98`).
* Move the default-agent select into the same **General** group so the pane stops having a control with
  no heading.
* `toolCallDetailLevel` is deliberately **not** in this slice: it needs a projection over tool
  input/output (`TaskPane.tsx:556`), which is slice 5's work, and shipping the switch before the
  projection is the defect this plan exists to avoid.

**Gate:** the existing `composer-controls.test.ts` extended for the `preferred` widening, plus a case
asserting `TaskPane`'s initial mode comes from settings.

### 8.4 Slice 4 — User-defined agents, and the system prompt

**Buys the user:** an agent we do not ship, and a house instruction every agent follows.

This is `docs/paseo-feature-parity.md` #5 plus §5.5's `appendSystemPrompt`, and it is one slice
because both need the same thing first — **a contract change**:

1. **Upstream, first.** `appendSystemPrompt` needs a session system prompt in the harness contract
   (`@envoymesh/envoy-harness`, a peer checkout). Per family guide §7.4 the symbol moves into the
   shared contract and is re-exported; the family's own checklist applies
   (`classify-modules` → `check-module-boundary` → `generate-core-surface` → `tsc -b` → `vitest`).
   A fork-local field here would be exactly the mistake the guide names.
2. **Then, in this repo:** `CoderSettings.appendSystemPrompt`, a **General** row, and the effect in
   `runs.ts` where the session is opened.
3. **Then the agents half — landed, except the UI.** An open provider id, a provider config file and
   `coder.listProviders` / `coder.addProvider` / `coder.removeProvider` all exist (§7.10), with the
   probe and the launch path shared with the nine shipped agents. What is left of this step is the
   picker itself, plus `defaults.models` for the custom-model rows. The schema addition was ours —
   `@envoycoder/protocol` is this repo's package — so `check-wiring` followed rather than an upstream
   round trip.

**Gate:** the upstream contract test the family requires, plus a daemon test that a configured agent
appears in `coder.listHarnesses` and a task can be started on it.

### 8.5 Slice 5 — Keyboard shortcuts, honestly

**Buys the user:** their own bindings, and a help sheet that lists what the app can actually do.

* Grow `SHELL_BINDINGS` (`input/shortcuts.ts:222-231`) to cover the actions the UI really has — the
  palette, the project and task actions, the run controls, the approval answers.
* A persisted `Record<bindingId, combo | null>` on `CoderSettings`, an effective-bindings builder, and
  a recorder panel.
* **Report conflicts**, per our own decision (`input/shortcuts.ts:19-24`) — a small visible list, not a
  silent first-wins, which is the Paseo defect §4.5 documents.
* Ship **both** platform spellings for every binding: `Mod+K` means what the platform says, and the
  11 mac-only pane rows are not copied.

**Gate:** tests that no two effective bindings in one scope share a combo, that an override survives a
reload, and that clearing an override returns the shipped default.

### 8.6 Deliberately not sliced, and why

`projects` (per-project defaults, §5.2) belongs in its own slice **after** slice 1, because the model
already exists (`resolveTaskDefaults`) and the risk is the screen, not the logic — and slice 1 fixes
the button that currently pretends to open it. `appearance`'s code-font and syntax rows ship **with**
the diff/explorer slice, as disabled rows before it and live rows with it. Everything in §6 and the
`not applicable` rows in §4/§5 does not get a slice: they get this document, so that the next person
to read "Paseo has more settings than us" can see, per row, that most of the difference is a subsystem
we do not have rather than a switch we forgot.

---

## 9. Looks simple, is not

The owner asked for these specifically. Each one is a setting whose label suggests a boolean and whose
effect depends on real machinery — the rows that turn "add a switch" into a week.

1. **`sendBehavior` (Default send).** Looks like a dropdown over an enum. It is a three-way decision
   about *concurrent turns*: `resolveSendBehaviour` (`controls.ts:539-548`) forces `interrupt` when an
   approval is pending — *before* consulting the preference — because queueing a message behind a
   prompt that is itself parked strands it. So the user's choice is a *preference with an override*,
   the composer's four-value union is a different set from the setting's three values
   (`controls.ts:158` vs `storage.ts:30`), and the per-pane control is a third thing again. A naive
   implementation ships a switch that appears to work and is silently overridden whenever the agent
   asks a question.
2. **`theme`.** Looks like a string. It is a repaint of every component, because our styling is CSS
   custom properties on `:root` and our only mechanism today is a media query
   (`design/tokens.css:155-156`). There is also a **stored preference versus an OS preference**
   interaction: `system` must keep following the OS *after* the user has chosen it once, which means
   the media-query fallback cannot simply be deleted.
3. **`uiBaseFontSize`.** Looks like a number. Paseo's version rebuilds the entire type ramp —
   `apply.ts:77-81` recomputes `sm…4xl` by scaling `FONT_SIZE` — *and* sets `theme.fontSize.content`
   absolutely rather than scaled (`:46`), so the two size settings are deliberately not the same
   operation. Copy the control without the scale and you get one text size that changes and a UI that
   does not.
4. **`appendSystemPrompt`.** Looks like a text box. It is a term in the harness session contract, and
   the contract lives in another repository (family guide §7.5). It is also *creation-only* in Paseo's
   model — the profile schema's own comment (`messages.ts:155-163`) refuses to put a system prompt in
   a profile precisely because `AgentSessionConfig.systemPrompt` applies when a session starts and
   silently does nothing when applied to a running one. A daemon-wide prompt therefore needs a
   decision about running sessions, not just a field.
5. **`agentProfiles`.** Looks like a CRUD list. It is read in two places with different meanings: the
   **client** applies it to the composer or a live agent
   (`use-agent-profile-picker.ts:131-155`), and the **daemon** hands it to orchestrating agents as the
   `list_profiles` MCP tool (`paseo-tools.ts:2932-2954`), where the `notes` field is prose *for a model
   to read*. Nine fields, and the semantics of one of them is "text an agent will use to decide".
6. **`toolCallDetailLevel`.** Looks like a dropdown. It requires a projection: today
   `TaskPane.tsx:556` renders "a few readable lines" of a call's input and output unconditionally, and
   `overview` means deciding what a summary of an arbitrary tool call is. Paseo's own implementation is
   a `projectToolCallDetailLevel` pass (`agent-stream/view.ts:542-548`) over a normalised tool-call
   union — a data model we have not built.
7. **Keyboard overrides.** Looks like a map of strings. It is a *matching* problem: scopes (a global
   binding must not fire while someone is typing), platform axes (`Mod` is not `Cmd`), IME composition
   (a composing keystroke owns every key — Paseo learned this, `overlay-root.ts:165-166`), conflict
   reporting, and a help sheet that renders the *effective* binding rather than the declared one. Our
   `input/shortcuts.ts` already has scopes and IME handling and says why; the override store is the
   small part.
8. **`metadataGeneration`.** Looks like a model picker. It is a *fallback chain*: the daemon inserts
   the configured provider ahead of a hardcoded list of four models
   (`structured-generation-providers.ts:24-30`), falls back to the focused agent's own selection
   (`:75-134`), retries twice, and throws a typed `StructuredAgentFallbackError` when everything
   fails — and it feeds generated **titles, branch names, commit messages and PR drafts**, so getting
   it wrong is visible in the user's git history. It is also where the page's "Manual" mode silently
   persists nothing until a model is picked
   (`metadata-generation-page.tsx:66`): a control that half-works, in the source we are reading.
9. **`manageBuiltInDaemon`.** Looks like a boolean. It is a process lifecycle: who spawned the daemon,
   who may kill it, and what happens to a second window that attached to a daemon it did not start.
   Paseo needs `assertBuiltInDaemonManagementEnabled` (`daemon-manager.ts:267-269`) plus a rollback
   path when removal fails (`host-page.tsx:1165`,`:1180`). Our shell already computes
   attached-versus-started (`main.rs:154`) — that distinction is the whole feature, and it is why §5.1
   calls the row `honour-able now` rather than trivial.
10. **`enableTerminalAgentHooks`.** Looks like a switch. Turning it **off** must *uninstall* hooks it
    previously wrote into the user's real agent configuration files
    (`terminal-agent-hook-setting.ts:26-31`), which means a switch whose off-state edits the user's
    home directory. Anything that writes outside our own state directory needs a removal path designed
    at the same time as the write, and the honest version of that row is not a switch but a
    "what we changed and how to undo it" list — which is why §4.9's note about our daemon's
    quarantined-file notes is a compliment and not a digression.

---

## 10. What this check cannot see

`scripts/check-settings-parity.mjs` (`npm run settings:check`) reads Paseo's source and fails when a
registered section or a discovered setting has no verdict line here. It **prints what it measured and
where it is blind**, because a check whose limits are unstated invites people to read green as
complete. Its three blind spots, and two of this document's own:

**The gate's blind spots** (also printed by the script on every run):

1. **A computed key is invisible.** The "keys read or written from the settings surface" extractor
   reads `updateSettings({ … })`, `patchConfig({ … })` and `settings.x` / `config.x` literally, at the
   literal's own depth, and understands both `{ key: value }` and shorthand `{ key }`. A patch built by
   a helper names no key it can read, and there are exactly **two** such call sites in the current
   tree: `patchConfig(createBrowserToolsPatch(next))` (`browser-tools-card.tsx:22`) and
   `patchConfig(buildAcpProviderConfigPatch(entry))` (`providers-section.tsx:402`). Both are named by
   `file:line` in every run's output along with the count — 37 call sites read, 2 unreadable — so the
   list is short enough to actually read, which is the only reason it is printed at all.
2. **Declared shape is not effect.** The app- and daemon-scope lists come from `AppSettings` /
   `Settings` / `DesktopSettings` / `MutableDaemonConfigSchema`, so the coverage set is a **superset**
   of what a user can click: a field declared and never rendered is in the set on purpose (§4.11 is
   four of them). That is the deliberate direction — it forces "stored and never shown" to be
   documented — but it means "in the doc" does not imply "in a UI".
3. **A verdict is proven present, never proven true — and the phrase only has to appear on the line.**
   The check proves that a line naming the setting also carries one of the four phrases. It cannot see
   *how* the phrase is used: a row that denies it in prose — "this is not `honour-able now` because the
   effect site does not exist" — satisfies the check exactly as well as one that gives it. That is a
   deliberate trade, not an oversight: a stricter matcher (verdict must be the cell's only content,
   must not be negated, must be the last cell) makes the check harder to clear honestly than to game,
   and the brief's rule is that a check which cannot be cleared by following its advice is broken. The
   discipline it asks for instead is **write the verdict as the bare phrase in its own cell**, and the
   consequence is that §7.1's table — the four dishonest fields — is the part a reviewer should
   re-derive by hand, because no grep can find that.

**This document's own limits**, stated so nobody has to discover them:

4. **One page is not inventoried row by row: `screens/project-settings-screen.tsx` (1273 lines).** It is
   reached from the *projects row*, not from `HOST_SECTION_ITEMS` (`settings-screen.tsx:191-203`), so
   the gate cannot enumerate it and §5.2 records that as a limit rather than pretending otherwise. It
   is the per-repo config surface — commands, metadata prompts, worktree rules — and it needs its own
   pass before we build the per-project screen.
5. **The gate itself is not typechecked, and neither is any other gate in this repo.**
   `tsconfig.unchecked.json` exists to cover "the code `tsc -b` otherwise never sees", and it
   `include`s `scripts/**/*.ts` with no `allowJs` — so `scripts/check-settings-parity.mjs` is **not** in
   its program. Measured, not assumed: `npx tsc -p tsconfig.unchecked.json --listFiles --noEmit` lists
   `scripts/smoke.ts` and `scripts/i18n-gap.ts` and does not list this file. The four pre-existing
   gates are `.mjs` too, so this is consistent with them rather than a new gap — but the brief for this
   round expected the script to be typechecked there, and it is not, so it is recorded here instead of
   claimed in a commit message. What stands in for a typecheck is that §"the gate can fail" below is a
   run the reader can repeat.
6. **The 43 individual shortcut rows are counted as a group, not enumerated.** Paseo's bindings are a
   `const` array in `keyboard-shortcuts.ts`, not fields of a settings schema, so the gate cannot see
   them and neither does its coverage set. They were enumerated for §4.5 by reading
   `keyboard-shortcuts.ts:1666-1723` and the binding table, including the 76-binding total, the 11
   mac-only rows, the 2 unremappable bindings and the 4 orphan help keys — but if Paseo adds a
   forty-fourth binding, **nothing here will tell us.** That is the one place where this document can
   rot silently, and it is stated rather than hidden.

**One long-run risk worth naming:** the gate's coverage set grows when Paseo's schemas grow, and that
is by design — but it also means the *first* run after a Paseo upgrade will list a batch of new
settings, and the temptation will be to satisfy it with a verdict line rather than a verdict. The
vocabulary in §1 is closed for exactly that reason, and the honest response to "new setting, no
subsystem" is `not applicable` **with the reason**, never a bare row.

### 10.1 The gate can fail — the run, so it can be repeated

A check nobody has seen fail is a check nobody should trust. This is the exact command and output from
breaking this document on purpose (a registered section id renamed, and one setting's row deleted
outright), then restoring it:

```console
$ python3 - <<'PY'                       # editor script: rename `editor`, delete the `pluginThemeId` row
$ node scripts/check-settings-parity.mjs
docs/settings-parity.md is out of date with Paseo's settings surface:

  1 Paseo setting(s) have no line in docs/settings-parity.md:
      `pluginThemeId`
        from: app setting in `AppSettings` — packages/app/src/hooks/use-settings/storage.ts
        fix:  add a row for `pluginThemeId` — what it comes from, what it does, and one
              of: honour-able now / honour-able with work / not applicable / must be disabled-with-reason

  1 Paseo setting(s) are named in docs/settings-parity.md without a verdict:
      `editor`
        from: section (`app`-scope) — packages/app/src/screens/settings-screen.tsx
        fix:  the line naming it must also carry one of: honour-able now / honour-able with work /
              not applicable / must be disabled-with-reason. A name in a list is not a decision about
              whether we can honour it.
[exit 1]
$ git checkout docs/settings-parity.md && node scripts/check-settings-parity.mjs
settings parity OK — 81 item(s) accounted for in docs/settings-parity.md: 21 section(s) (app + host),
42 app setting(s), 20 daemon setting(s), 34 key(s) touched by the settings surface; each named with a
verdict
[exit 0]
```

Two failure modes in one run, each naming the item and where it came from — which is the point: the
message says *what* is missing and *which Paseo file declared it*, so the fix is a read, not a guess.
A third mode (a whole section's page disappearing from `settings-screen.tsx`) fails the F1 extractor
instead, with "could not find the `HOST_SECTION_ITEMS` array" — a Paseo refactor that moves the
registry is reported as the check being unable to see, not as coverage being complete.
