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
| **Enable {provider}** (`providers[id].enabled`) | `providers-section.tsx:248-253`, per provider · `settings.providers.enableProvider` "Enable {{name}}" (`en.ts:2651`) | `true` (`:444`; daemon `server/agent/provider-registry.ts:737`) | daemon: only enabled providers get a client; disabled ⇒ `unavailable`, `listModels` throws "Provider X is disabled" (`provider-registry.ts:375-377`,`:752-754`,`:836-837`) | **we tried this once, as a list filter, and deleted it — the old ruling was right.** `coder.setAgentHidden` stored `CoderSettings.hiddenAgents` (a list of agent ids), every row of `coder.listHarnesses` / `coder.listProviders` carried a `hidden` flag beside its `availability`, and `pickable` filtered the two agent pickers on it. It is gone: the field, the method, the flag on both summary types, the filter, the switch, the chip, the copy and the tests. The reason is the owner's own brief — *"the control plane of coding agents"*, whose stated failure was that they **could not see** the agents we support — and a list filter is the one control that can make an agent *we ship* disappear from our own lists. It was also a misreading of the source: Paseo's switch decides whether *its* daemon instantiates a provider at all, which is a fact about a daemon's wiring, not a preference over a list. What a picker offers is now **derived** from probed facts (`composer/agent-for.ts`'s `offeredAgents`: only a state that asserts absence drops a row, and the rest are ordered by how usable the measurement says they are), and the key is in `RETIRED_SETTINGS_KEYS` so an upgrading settings file still parses | **`not applicable`** — and this time the verdict holds, because the *substance* of the row is honoured somewhere else. Being able to say which agents you use is a real need, and the answer is **additive** rather than subtractive: `coder.listCatalog` + `coder.addProvider` let a user put the agents they use at hand, the catalogue is one list every client can read, and a curation on top of that must be a favourite that *adds to* a short list — never a filter that can remove an agent from one. Recorded rather than built: nothing offers favourites today, and the reason to build one later is that a short list is a convenience, while a hidden agent is a lie |
| **Add provider** (`providers[id]` from the ACP catalogue) | `provider-catalog-list.tsx:108-118` · `providerCatalog.actions.add` "Add" (`en.ts:1587`) | — (action) | persists `{providers:{[id]:{extends:"acp",label,description,command,env,params}}}` (`hooks/use-acp-provider-catalog.ts:11-26`) so a third-party ACP CLI becomes runnable | **the plumbing landed; the picker has not.** `AgentProviderConfig` (§7.10) is a provider's shape — id, label, command, args, the **names** of the environment variables it needs, and the dialect it speaks — and `coder.listProviders` / `coder.addProvider` / `coder.removeProvider` store them in `<state>/EnvoyCoder/providers.json` (quarantined rather than emptied when unreadable, replaced rather than merged per id, `providers` broadcast so a second window refetches). Every listed provider is **probed** by the same prober that answers for the nine shipped agents and launched through the same `launchForHarness` body, so its row carries one of the same five `availability` states. What is still absent is the surface: no control adds one, and the 38-entry catalogue is still unreachable from the window | **shipped** — with a divergence that is the whole point. Paseo's Add writes the entry's `env` **values** into `config.json`; ours cannot, because `AgentProviderConfig.env` is a list of variable **names** and the value is read from the daemon's own environment at spawn (§7.10). So the catalogue serves its rows over the wire (`coder.listCatalog`, which measures nothing) and a client adds one by handing back what the entry states: its command, its argv, the names of the variables it needs, and the dialect it declares — `modeParam` and `authMethodId` are *absent* rather than defaulted, because no entry has evidence for either and a guessed `modeParam` is ignored by the peer while the run reports success. The cost that *was* stated on the row is now paid off, and paying it changed the shape: the four entries whose recipe sets a constant used to carry only the **name** across, so the variable was the user's to export even though we had written its value ourselves. `coder.addProvider` now takes `catalogEntryId` — the entry's own id, a **reference** and not a value — and the daemon resolves the recipe's constants from the catalogue it ships, so `providers.json` still holds no value at all, ours or a user's (§7.10). The row says which variables the recipe supplies and that exporting one is how a user overrides it. `coder.probeCatalogAgent` measures one row at a time, on the user's press, because 14 of the 38 are `npx` recipes and a screen that checked them all while opening would spend the machine on rows nobody looked at |
| **Remove provider** (`removeProviders`) | `providers-section.tsx:155-164` (menu + confirm) · `settings.providers.actions.remove` (`en.ts:2658`) | — (action) | daemon strips the entry, its overrides **and** its `metadataGeneration.providers` entries (`daemon-config-store.ts:101-159`) | `coder.removeProvider` forgets one provider and nothing else — it refuses with `envoycoder.provider-missing` when there is nothing under that id, rather than confirming a removal that did not happen. Nothing refers to a provider today, so unlike `coder.removeProject` there are no rows to archive: a task names a `HarnessId` | **shipped** — every row on the Agents page (a user's provider, and a catalogue entry they already added) carries Remove, and it is the same `coder.removeProvider`: nothing is uninstalled, and nothing a row reports changes except its disappearance from the list. Paseo's version strips the entry, its overrides and its `metadataGeneration.providers` entries, which is what a config-with-overrides shape requires; ours is a flat list of recipes, so there is nothing else to strip |
| **Add custom model** (`providers[id].additionalModels`) | `provider-diagnostic-sheet.tsx:199-234` (modal form) · `settings.providers.models.addCustomTitle` "Add custom model" (`en.ts:2678`) | `[]` (`provider-registry.ts:735`) | merged on top of discovered models (`provider-registry.ts:383-396`,`:651`): the picker gains ids without replacing the catalogue | our catalogue ships a fixed `models` list per agent (`packages/agent-catalog/src/models.ts`) with no user additions. **Half of this row landed since it was written, and not as a settings control:** the agent is now *asked* what it offers and the answer is recorded, so `deepseek-harness`'s live catalog reaches the picker without a hand-typed id (§7.7). What is still absent is the user's own additions — ids that are not in the agent's catalog at all | **honour-able with work** — needs a per-agent model list on the settings object plus the composer reading it. Small, but it is a **protocol** addition (a `models` array on the agent's stored defaults), so it shares the Add-provider slice's schema change |
| **Remove model** | `provider-diagnostic-sheet.tsx:114-118` · `settings.providers.models.removeModel` "Remove {{id}}" (`en.ts:2684`) | — (action) | rewrites `additionalModels` without the id (`:651-667`) | absent with the row above | **honour-able with work** — same slice |

**Section verdict: `not applicable` — with one row that is now honoured, and one correction to record.**

Paseo's `providers` page is a *credential and adapter* management surface — a provider there is an
agent-runtime adapter plus the environment it is spawned with, and Paseo stores its API keys in plaintext
`env` in `config.json` (§9). EnvoyCoder has no such accounts: our agents are ACP programs in a static
catalogue and the model credentials belong to the agent CLI the user installed. The honour-able rows above
are *not* that page — they are "user-defined agents", and they belong in our Settings pane as a
catalogue-management group.

**The correction, and then the correction of the correction — because this row has now been wrong in
both directions, and the second mistake is the more interesting one.**

**First reading (right).** *"Not applicable as a setting — availability in EnvoyCoder is a fact we detect,
not a switch the user throws. Making it a switch would let a user hide a working agent for no reason."*

**Second reading (wrong, and shipped).** The audit decided the first reading had conflated one fact where
there are two — availability is ours to detect, preference is theirs to set — and built the preference:
`CoderSettings.hiddenAgents`, `coder.setAgentHidden`, a `hidden` flag on both summary types *beside*
`availability` rather than instead of it, and `pickable` in the pickers. The guard against the first
reading's worry was stated as **"a switch that cannot reach the state"**, and by that narrow test it passed:
an installed, hidden agent still reported `ready` with its `fix` intact, and
`test/agent-preference.test.ts` asserted it.

**Third reading (this one).** The narrow test was the wrong test. *"It cannot falsify a measurement"* is not
the property that matters; **"it can make an agent we ship invisible"** is, and a list filter is exactly
that. The owner's brief for this product is *"we need user to see them and can enable and use them. That's
the target of our control plane"*, and their complaint that started this arc was that they could not see the
agents we support. A preference that subtracts from the product's own lists is the same failure with a
settings row in front of it, and the *prose* of the second reading — "they are describing their machine the
way they work on it" — is true of a machine's agent list in general and false of this product's one
authoritative list of what it can drive. The row's real content is not Paseo's either: their switch decides
whether *their daemon instantiates a provider*, which is wiring, and we turned a wiring decision into a
presentation filter.

**What replaced it is a derived rule, and that is the whole difference.** `offeredAgents`
(`apps/desktop/src/composer/agent-for.ts`) is a pure function of `availability`: it drops a row only when a
probe established the program is **absent**, orders the rest by how usable the measurement says they are,
and cannot be reached by anything a user stored, because there is nothing in it to read. A derived rule can
be wrong about a fact and be corrected by the next probe — our ignorance has a way out. A stored filter is
wrong by design and stays wrong: no probe, no upgrade and no run changes it, and nothing in the product
measures it, so nothing can notice. `test/agent-offer.test.ts` asserts the property directly, and in the
direction that can fail: a row that *claims* the deleted preference is offered anyway.

**And nothing was lost that a user needs.** *"Which agents do I actually use"* is a real need, and the answer
this product gives is **additive**: a short list is built by adding agents to it — `coder.listCatalog` +
`coder.addProvider`, and, if a curation is ever wanted, a favourite that adds to a pinned group. A
subtractive control is what is refused, permanently and by rule, because an agent that exists in the
catalogue but cannot be seen is indistinguishable from one the product does not support.

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
through `readCoderSettingsDocument` (`domain.ts`, §7.14 — unknown keys are dropped and **noted**, and every
known one is kept); `:493-506` update; path from
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
| ~~`allowRemoteRuns: boolean`~~ | **removed** — was `domain.ts:734` | — | **removed** — was `SettingsPane.tsx:147-158` | — | **gone, not disabled.** Its effect could not exist: there is no remote-run path, and `coder.offerRemoteRun` was a spec with no handler and no caller. A disabled row would have promised a feature on this pane's terms rather than the mesh's; §7.2 records what a returning version needs first. `coder.offerRemoteRun` came out of the catalogue with it (`protocol/src/rpc.ts`), and the read drops the old key and notes it (the constant names it, `readCoderSettingsDocument` is what acts) so an upgrading user's settings file keeps everything else — §7.14 |
| ~~`hiddenAgents: readonly string[]`~~ | **removed** — was on `CoderSettings` and in `CoderSettingsSchema` | — | **removed** — was `SectionsAgents.tsx` (a *Hide from my lists* switch on every row of all three lists, plus a *Hidden* chip) | — | **gone, and refused rather than deferred.** It was stored, served as a `hidden` flag on `HarnessSummary` and `AgentProviderSummary` beside `availability`, and read by one filter over the two agent pickers — so this column's own question ("does a workflow consume it?") answered *yes*, and the field was still wrong. A preference that can shorten the product's own list of agents is the one control that can make an agent we ship invisible, which is the failure this product's owner named; §5.8 carries the two wrong rulings and the correction. the read drops the key and notes it (§7.14), and what a picker offers is now derived from probed facts (`composer/agent-for.ts`) rather than stored |

**All nine entries are honest now, and the verdicts are not "the pane has a row for it".** Every one of
the seven remaining fields has a reader outside `SettingsPane.tsx` — that exclusion is the whole point of
the column, and `settings-coverage.test.ts` enforces it — and the two struck-through entries were
**deleted** rather than disabled. `hiddenAgents` is the second of those and the only one removed on
principle rather than for having no effect: it *did* have an effect, and the effect was the problem (§5.8). The app scope shows **seven** rows where it showed five (the language, the folder "Add
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
  params and the row are written together, against a handler. The tolerant settings read (§7.14) is what
  lets an upgrading user's settings file keep its language, its default agent and its nominated folder
  while the dead key is dropped — and it does so for **any** key this build does not have, which is the
  property the constant that used to do this job could not have.

  **The same key on the *wire* was left open here, and §7.14 closes it — with a correction to what this
  paragraph used to claim.** It said a window one build ahead of its daemon "cannot read settings",
  because `coder.getSettings`'s result is `z.object({settings: CoderSettingsSchema}).strict()` and the
  older daemon's answer carries `allowRemoteRuns`. The *schema* does refuse that answer; **nothing refuses
  it in practice.** `RPC_SPECS[…].result` is a specification asserted in `packages/protocol/test/`, not a
  runtime gate — `CoderStore.loadSettings` reads its answer with
  `connection.callTyped<{ settings: CoderSettings }>`, an unchecked cast, so an extra field on a result is
  simply never read and that direction of skew is harmless by construction. The risk that is real runs the
  other way: an older daemon **omitting** a field a newer window's types call required, which is why
  `DeclaredFacts` has its `models`/`thinking` guard. The full table, with the argument for choosing
  guards over parsing results on the client, is on `RpcMethodSpec` in `packages/protocol/src/rpc.ts`.
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
`knownMissing()` — the one state a picker may drop, §7.9; today the rule is
`offeredAgents()` in `composer/agent-for.ts`, which is that predicate plus an order), the three switches
(`:134-171`), an **Agents**
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
| **Agents** | **Three groups, and the product's core screen** (§7.12): the agents this machine has (availability, capability warnings, the tier/modes/models/thinking each **published about itself**), the agents *you* declared, and the **38-entry catalogue** — searchable, each row with its command, version, install link and a state that is measured on request rather than implied. On each row: a sign-in for an agent that wants one, and **Remove** for the ones you declared — no preference switch, because a list filter is refused outright (§5.8) | the shipped nine and your own agents are read straight from `HarnessSummary` / `AgentProviderSummary` — the daemon's own probe — and the catalogue from `coder.listCatalog`, which measures nothing. **Every row here is a measurement**: nothing on this page is read from the settings document, and nothing on it can shorten the list. What the two agent pickers offer is derived from the same measurements (`composer/agent-for.ts`), so an agent dropped from a picker is still on this page with the command that fixes it — and the picker says so in as many words. The *composer* can still **ask** an agent what it offers before it has ever run (§7.7); the ask lives where the choice is made |
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
| `agents` | **not applicable** (§5.5) | **yes, with different contents** | four of its five rows are subsystems we do not have. Our **Agents** section began as a *report* of what each agent published, and it is now also where an agent is added, measured, signed in and removed again (§7.12) — the catalogue Paseo splits into a separate `providers` page lives here rather than beside it, because a user asking "what can this machine run" wants one list rather than two. The row we still cannot honour is saved agent profiles, which is §8.4's remaining half |
| `providers` | **not applicable** (§5.8) | **yes, merged into Agents** | Paseo's page is credential and adapter management, and it stores API keys in plaintext `env` in `config.json` (§9). **The audit says in as many words that we should not copy it, and we did not**: the catalogue's rows carry the *names* of the variables a recipe sets and never a value, and there is no field to hold one (§7.10). What we took is the information architecture — a row per agent with a state chip and a switch, and the catalogue as rows a user can add from — and it is the third group of **Agents** rather than a section of its own |
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

**What that leaves as future bar items, named so they are not rediscovered:** a system prompt (§5.5
`appendSystemPrompt`, upstream first), saved agent profiles (§5.5), and `autoArchiveAfterMerge` the day
the git service exists (§5.7). **User-defined agents and the sign-in button are off this list as of
§7.12** — both are on the Agents page now, which is what the previous revision of this paragraph was
waiting for. **The third item that paragraph used to name, a *visibility switch*, is off the list for a
different reason: it is not deferred, it is refused.** It was built and then deleted (§5.8), because the
one thing it could do that the other two cannot is make an agent we ship disappear from our own lists. Each is a section that
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
  a user did not ask for. **Since §7.11 this is also a state a user can see and a step they can trigger**:
  the probe records whether the agent opens a session (writing nothing that changes it), `HarnessSummary.auth`
  carries `ready | needs-signin | unknown`, and `coder.signInAgent` sends the agent's own method and reports
  five outcomes of which only one means success.

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
| 0 | **the programs the login shell names, one `command -v` at a time** (`shell-binaries.ts`, same 2500 ms bound) — each answer's directory joins the list **first**, and only while the file is really there | a `$PATH` answer is a *variable* and a `command -v` answer is a *lookup*, and they are not the same list. Measured on this machine: the login shell asked for `$PATH` from a clean environment prints 26 directories with **no `_npx` in any of them**, while `command -v dsh` in the owner's own shell resolves `/Users/…/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh`. It is also the only source that can describe a shim a toolchain manager computes per invocation. Names that are not plain command names (`[A-Za-z0-9][A-Za-z0-9._+-]*`) are skipped rather than quoted: a provider's command is user-controlled data |
| 1 | `$SHELL -ilc 'printf …"%s" "$PATH"'`, `LOGIN_SHELL_TIMEOUT_MS` = **2500 ms** | the only *list* source that includes what the user's rc files add, which is what "installed" means to them |
| 2 | the daemon's own `PATH` | honest by definition, kept even when (1) answered, because a profile that *replaces* `PATH` would otherwise make the daemon forget where it was launched from |
| 3 | `wellKnownBinDirs()`: `~/.local/bin`, `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.cargo/bin`, `~/.bun/bin`, each only if it exists | what rescues a GUI launch, where there is no terminal to ask. Nothing on Windows: the registry `PATH` reaches a GUI process there, so there is nothing to repair |
| 4 | **npm's `npx` cache** — the `node_modules/.bin` of every tree under `~/.npm/_npx/`, sorted, `cacheBinDirs()` | searched **last**, because a cache is the least like an installation, and present at all because without it `dsh` reads as *not installed* while its owner runs it (§7.16). `~/.bun/install/cache` and pnpm's `dlx` store are deliberately **not** enumerated: their layouts have not been read on a machine that has them, and a glob written from memory is how a search list acquires a directory that never exists. `provisionalCacheOf` still recognises both, so a hit that arrives through a `PATH` is still reported as provisional |

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
| `needs-bridge` | "Needs its adapter" | **the agent's own CLI resolved and the adapter did not** — the reported bug, named | the adapter's `npm install -g …`, from the entry, and the line leads with what is present: *`Installed — npm install -g …`* (§7.16) |
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
  **Provenance is decided by the path, never by how it was found** — a `dsh` the login shell names *and* that
  lives in an `npx` cache is still `provisional`, because what the warning is about is that the directory has a
  hash in it and `npm cache clean` removes it. Making it depend on the asking shell would make one product
  answer differently depending on who launched it, which is the class of bug the resolver exists to remove.
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
{ id, label, command, args, env: readonly string[], transport: "acp" | "cli",
  catalogEntryId?, authMethodId?, modeParam? }
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
a run: `AgentProviderSummary.env` is `{ name, set, from? }[]`, so the row can say which variable is
missing while nothing on the wire or in a log is a value.

**`catalogEntryId`: the one reviewed constant a launch may supply, and why it is a reference.** Four of
the 38 catalogued recipes set six environment variables between them (`AUGMENT_DISABLE_AUTO_UPDATE`,
`DROID_DISABLE_AUTO_UPDATE`, `FACTORY_DROID_AUTO_UPDATE_ENABLED`, `GJC_ACP_PERMISSION_MODE`,
`VT_ACP_ENABLED`, `VT_ACP_ZED_ENABLED`), and every one is a constant of a command line *we* publish —
`1`, `true`, `prompt`. Treating those as if they were credentials made four recipes unusable for no
safety gain: adding one produced a provider that named a variable nothing would ever set, so the launch
refused by name about a value we had written ourselves. The honest distinction is **whose data it is**,
and it cuts in two places:

* **A catalogue entry is our own reviewed, git-tracked data**, so it may declare a non-secret default —
  its `env` is already `Record<string, string>`, and the row now carries name and value together
  (`CatalogEnvConstantSchema`) so the screen can say which variables the recipe supplies and which are
  the user's to set.
* **A provider config still has no field for a value.** What it may carry is `catalogEntryId`: the
  *name* of the entry it was added from. The daemon reads the entry's constants out of the catalogue —
  code we ship, not a file a user writes — at launch and at summary time. So `providers.json` holds no
  value at all, which is **strictly stronger** than "a user may not write one", and the property this
  section has claimed from the start survives intact.

Three rules keep the reference from becoming a door, and each is enforced where it can actually fail:

1. **The wire has no field for a value.** `coder.addProvider`'s parameters are `.strict()`, and the only
   thing about a recipe they accept is `catalogEntryId`. A client that invents `envDefaults` is refused
   at parse — asserted with a real-looking key, three spellings of it, and `await`ed, because a
   synchronous `toThrow` on an async handler asserts nothing.
2. **The reference is *verified*, not trusted.** `agreesWithEntry` (one implementation, two callers)
   requires the provider's `command`, `args` and `transport` to be the entry's own and its `env` to
   **include** every name the entry declares. `coder.addProvider` refuses a mismatch by name
   (`error.providerCatalogMismatch`); `providerCatalogueEnv` returns nothing for one, which puts the
   provider back in the ordinary names-only case. A hand-edited file therefore cannot claim a recipe it
   is not, and an id the catalogue no longer has resolves to nothing rather than to invented constants.
   *A superset rather than an equality* on `env` is deliberate: a user who adds a variable of their own
   to a catalogued agent must not silently lose the recipe's constants.
3. **A credential-looking name may not carry a recipe value, loudly.** `CREDENTIAL_ENV_NAME_PATTERN` is
   segment-anchored (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `AUTH`, …), so
   `ANTHROPIC_API_KEY` and `AWS_SECRET_ACCESS_KEY` are refused while `AUGMENT_DISABLE_AUTO_UPDATE`,
   `VT_ACP_ENABLED` and `MONKEY` are not. `CatalogEnvConstantSchema` refuses one **when the row is
   built** and `AgentProviderEnvStateSchema` refuses a wire claim that a recipe supplied one — a refusal
   and not a silent drop, because an entry quietly losing a variable would be a row lying about its own
   recipe. A *user's* own `env` is untouched: naming a credential there is what the names-only rule is
   for.

**The launch says where each value came from.** `resolveProviderEnv` is the one body the summary and the
spawn both read: the user's own export wins over the recipe's constant, the recipe supplies only names
the provider declares, and a name neither source can supply is still refused by name. The wire carries
the answer as `from: "catalogue"` on a variable the recipe supplies and *nothing* on an ordinary one, so
the row reads "supplied by this recipe" instead of telling a user to export something we already
provide.

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

**What a provider deliberately does not have.** No `capabilities`, `modes`, `models`, `thinking` or
`auth`: we have never opened a session with this program, so every one of those would be the user's guess
handed back as our fact — and for `auth` specifically, no task can run on a provider yet, so there is no
session probe to produce a state and the field would read `unknown` forever, which is a statement about us
dressed as one about the program (§7.11). The composer's pickers stay off for one, with the reason on
screen, until a session exists to ask. There is also no model support: a provider's model is whatever the
user put in `args`.

**One field a provider used to carry, added with the preference and now deleted with it.** Every row of
`coder.listProviders` carried a `hidden` flag beside its `availability` (and so did every shipped agent),
written by `coder.setAgentHidden` and read by the pickers' filter. It is gone from both summary types, and
the reason it is worth a paragraph here is that it was argued for *with this section's own principle*: "a
preference about an agent is not a different kind of thing when the user typed the agent's command line
themselves". That is true, and it is the wrong question — see §5.8 for why a list filter is refused
outright rather than merely kept out of `availability`. What a provider row carries today is what a probe
measured and nothing else.

**What was left — the picker — is §7.12.** A control that adds one, a row per provider, and the 38 catalogue
entries (`packages/agent-catalog/src/acp-catalog.ts`) as things a user can pick: all three are on the Agents
page now, and the fourth item this paragraph used to list (the switch that hides either kind of agent) was
built and then deleted (§5.8). The RPCs, the storage, the probe, the launch path and the
preference were the substrate, and the two things that slice added are the two the *surface* needed —
`coder.listCatalog` (the entries, with nothing measured about them) and `coder.probeCatalogAgent` (one row's
state, on request) — because the catalogue had to reach the window through the daemon rather than as a second
copy of itself in the app bundle.

### 7.11 Authentication as a state we can see, and a sign-in we can trigger

`cursor-agent acp` answers `session/new` with `-32000 Authentication required … call authenticate() with
methodId 'cursor_login'` on a fresh installation, and opens a session once that step has been sent. That is a
fact about a real agent, and §7.8 recorded it per entry as a *launch* detail. This is the slice that turns it
into something a user can see and act on — and the interesting part is what it refuses to do.

**The fact, and the three answers.** `HarnessSummary.auth` is required, and it is one of:

| state | what it means | how it is established |
|---|---|---|
| `ready` | the agent opened a session here; nothing is needed from the user | a session opened |
| `needs-signin` | it will not open one **and advertises a sign-in method of its own** (with `methodId` when exactly one candidate is unambiguous) | a session was refused *and* `initialize` advertised `authMethods` |
| `unknown` | nothing has established anything: no probe has run, or the last one could not get an answer | the default, and the honest replacement for a stale state |

Three design decisions are worth stating in as many words, because each of them is a way of *not* lying:

* **`needs-signin` is decided by evidence rather than by prose.** An agent that advertises auth methods and
  will not open a session is telling us, in its own protocol's vocabulary, that it wants one. We do not scan
  a refusal for the word "authentication": that would work for exactly the agents whose wording we happened
  to read, and break silently on the next release. An agent that advertises nothing and fails is `unknown`,
  because nothing in that exchange says a login would help.
* **`methodId` is optional.** When several methods are advertised and the catalogue declares none of them —
  `@agentclientprotocol/codex-acp` offers two `env_var` methods and a browser login — choosing one is us
  picking a sign-in flow on the user's behalf, and the browser one would open a window they never asked for.
  A row that says "this agent wants a sign-in and EnvoyCoder cannot tell you which" is honest and actionable;
  a row that quietly sent the wrong method is neither.
* **The schema refuses the two contradictions** the shape would otherwise allow (`HarnessAuthSchema`):
  a `methodId` beside `ready` claims a step that will never happen, and beside `unknown` it asserts a
  requirement nobody established. `observedAt` travels with the state, so a screen can say *when* rather than
  presenting an observation as current — the rule `AgentModels.observedAt` already follows.

**It is never asserted without a probe, and a probe never signs anything in.** The pre-flight probe
(`SessionProbe`) now does what a run does up to the session and then stops: `initialize` (read `authMethods`)
→ `session/new` (open it, or be refused) → close. It is started with `AcpClientOptions.initializeOnly`, so
the `authMethodId` the catalogue declares is **not** sent on its behalf — a probe that authenticated would be
measuring its own side effect, and for a browser-login method it would put a window on the user's desktop
nobody asked for. The result is written where `coder.listHarnesses` can read it: `AgentAuthObservation` in
`<state>/EnvoyCoder/agent-auth.json`, keyed per agent, newest wins, quarantined rather than emptied when
unreadable, and broadcast under the store's `harnesses` change kind.

**Why a second file, when the session-options record already exists.** Because the two disagree about what a
failure means, and that is a fact about their *subjects* rather than about storage. "What does this agent
offer" has no answer when we could not ask, so the session-options record deliberately writes nothing then.
"Can it open a session here" *does* have an answer — *we could not tell* — and a record that kept a previous
`needs-signin` in front of a user whose agent has since been uninstalled would be a stale fact presented as a
current one. Folding them into one file would force one of those two behaviours on both.

**The trigger: `coder.signInAgent { harness, methodId? }`.** It starts the agent the same way a probe does
(one injection point, one launch resolver), then sends `authenticate` with a method taken from the agent's own
advertised list, then **opens a session to see whether it worked**. Five outcomes, and only one of them is
success:

* `signed-in` — a session opened afterwards, either because the step made it possible or because it already
  was (the sentence says which). **Not** "the step returned": a browser-login method answers `{}` immediately.
* `refused` — the agent answered the step with an error; its own sentence travels as a value, because an
  `env_var` method says which variable is unset better than we can.
* `not-completed` — the step was accepted, or never answered, and no session opened. The browser case and the
  wedged case together, and deliberately one state: in both, **nothing was signed in**, and "not yet — finish
  it there and ask again" is the honest thing to say.
* `no-method` — there is no step we may send (nothing advertised, or the caller named one the agent does not
  offer). Nothing is sent and nothing is stored from the caller's string.
* `unavailable` — we never got as far as an answer: the program is missing, this build cannot drive it, there
  was no search path, or the handshake died. The *launch's* own keyed refusal is embedded as the value, so the
  outer sentence is the only string a translator writes.

The attempt is bounded (`SIGN_IN_TIMEOUT_MS`, an outer ceiling over `AcpClient`'s own per-request budgets) and
the agent it started is stopped in a `finally` — through the same once-only teardown the probe uses
(`agent-processes.ts`), because two concurrent teardowns of one process is the `ERR_STREAM_WRITE_AFTER_END`
§7.8 already records.

**And still no credential anywhere.** The sign-in is the *agent's* flow: its session state lives where the
agent puts it (`cursor-agent` writes `~/.cursor/acp-config.json`, which this product neither reads nor
writes), and what this daemon owns is the attempt and the report. The rule that makes that more than a
promise is **the only place a method id can come from is what the agent advertised**: a `methodId` a caller
passes is honoured *only if the agent offered it*, so a value pasted into that field never reaches the agent,
never reaches `agent-auth.json`, and is not echoed into the sentence a user reads — for the same reason
`coder.addProvider` never echoes a refused `env` entry. `test/sign-in.test.ts` asserts the negative on bytes.

**The button landed in §7.12, and the five outcomes are why it needed a surface rather than a toggle.** The
row that renders *Needs a sign-in* carries a *Sign in* control beside it, on the agents the daemon says want
one — and the answer a user gets back is the daemon's keyed sentence for whichever of the five things
happened, of which only "a session opened" is success. A control that reported success on four of five
answers is the defect this whole taxonomy exists to prevent; the page renders the outcome verbatim rather
than summarising it into a tick.

**And the button is no longer covered by a DOM test alone.** §7.13.1 measures it in a real window against a
real daemon whose search path holds an agent that really refuses a session: one *Sign in* control renders on
a row that reads *Needs a sign-in*, the press is the window's own click, the sentence the window renders
back is *"Claude Code accepted the sign-in and opened a session."*, and the daemon's record moves to `ready`
— which is what makes "the press did the work" a fact rather than an inference from the button
disappearing.

### 7.12 The catalogue on screen: the 38 recipes, and the four decisions that keep it honest

The owner's brief: *"We should do the same thing with paseo, we need user to see them and can enable and use
them. That's the target of our control plane. If they are not installed, we can guide them to install."* This
is that screen. It is the last of the four the same request produced (§7.9 availability, §7.10 the provider
contract, §7.11 sign-in), and it is the one where the product's thesis is either true or not: **EnvoyCoder is
the control plane for coding agents**, and a control plane that cannot show you the agents is a product with
a catalogue nobody can read.

**What it is.** Settings → **Agents** (`components/settings/SectionsAgents.tsx`, `CatalogRows.tsx`, with the
decisions in `agent-catalog.ts`), three groups:

| group | rows from | state from |
|---|---|---|
| **On this machine** | `coder.listHarnesses` — the nine we ship | the daemon's probe, plus each agent's own declared modes/models/thinking and its capability warnings |
| **Your agents** | `coder.listProviders` — the ones a user declared | the same prober, plus each named variable with `set: true/false` |
| **Add an agent** | `coder.listCatalog` — the 38 recipes | **nothing, until the user asks about a row** |

and one form at the bottom for a program nobody catalogued, which is what `coder.addProvider` was written for.

**1. The catalogue is served, not copied.** `@envoycoder/agent-catalog` is where the *launch* reads an
entry's command and argv, and its entry point reaches `@envoycoder/platform`, which imports `node:fs` — so
the window cannot import it at all. That is not an obstacle to route around: it is the constraint that makes
"do not put catalogue knowledge in desktop-only code" a fact about the architecture. `coder.listCatalog`
serves the rows, and the phone reads the same method and gets the same entries and the same dialect facts. It
is also why `cataloguedProviderInput` (the entry → `coder.addProvider` parameters conversion) lives in the
package rather than in the screen that first needed it.

**2. `coder.listCatalog` measures nothing; `coder.probeCatalogAgent` measures one row.** The split is the
whole cost story. A list call that probed while it built its rows would walk the search path 38 times
whenever a window opened, invisibly on a developer's machine and wastefully on a user's. And the deeper
reason: 14 of the entries are `npx -y …` recipes, so a screen that *ran* them to find out would download
fourteen npm packages because somebody clicked Settings. The probe here does not run the program, open a
session or fetch anything — it looks for the entry's program on the daemon's resolved search path, through
the same prober the nine shipped agents go through. An `npx` recipe is therefore measured by whether `npx`
is present, and the download is stated on the row as what happens on the **first run**, once, which is a cost
the user chose.

**And that is all a green row may claim there — which it did not, until this slice.** The daemon's `ready`
for an `npx -y <pkg> …` recipe is a fact about **`npx`**, not about the agent: nothing has been downloaded,
no package resolved, no session opened. Fourteen rows reading "Ready" claimed a verification nobody
performed, and the sentence beside them ("Nothing to install: … is fetched from npm the first time it runs")
did not retract it. So the word a user reads is derived from **two** facts — the measurement *and* how the
program is obtained — and an `npx` row whose probe found `npx` reads **"Not downloaded yet"**
(`AgentRowState`'s `ready-npx`, `rowStateOf(entry, probe)`), with the sentence naming what was and was not
checked. `rowStateOf` takes the entry rather than the probe alone for exactly this reason: a caller that
forgot it would get the over-claiming word back, silently, so the omission is a compile error instead.

**3. The cache is not for everything.** `coder.probeCatalogAgent` remembers `ready`, `needs-bridge` and
`unsupported` for ten minutes (`CATALOG_PROBE_STALE_MS`, the same window `session-probe.ts` uses) and
**never** remembers `not-installed` or `unknown`. A negative answer is the one a user is about to change: a
user who installs Goose, comes back and presses *Check again* would otherwise be shown the answer we took
before they acted, on the row they just acted on. `unknown` is excluded for the plainer reason that nothing
was measured. A press after the first answer sends `force: true`, which is the window's half of the same rule.

**4. No entry states a dialect we do not write down, and none may be defaulted.** `AcpAgentEntry.transport`
is a **required** field on all 38 — required so that entry 39 cannot be added without deciding, and stated
rather than inferred because a command line says how to *start* a program and nothing about how to *talk* to
it. Its citation is the reference product's `acp-provider-catalog.ts`, where every entry declares
`extends: "acp"`; `sigit` (`command: ["sigit"]`) is the case that proves an inference would have been
invention. `modeParam` and `authMethodId` are **absent from every entry**, so nothing built from one may
write either: guessing them fails in the direction that cannot be detected, because a peer ignores a field
name it does not recognise and reports success. `coder.addProvider`'s `transport` is required for the same
reason, and the manual form has no default on its radio pair — an enabled *Add* with no dialect chosen is the
guess moved from the schema into the UI, where nobody can see it.

**5. `needs-bridge` was unreachable for a catalogued row, and now one entry reaches it.** The five-state
vocabulary has had `needs-bridge` since §7.9 — *the agent is here and the adapter over it is not* — and the
nine shipped agents reach it through `AgentLaunch.agentBinaries` (`claudecode` → `claude`, `codex` →
`codex`). The **catalogue had nowhere to say it**, so no catalogued row could: a machine with a wrapper's
vendor program installed and its adapter missing was told the *agent* was not installed. `AcpAgentEntry.wrappedAgent`
is that field, `cataloguedRecipe` wires it into `agentBinaries` and `install.bridge`, and exactly **one** of
the 38 entries declares it — with a citation, and the field's own doc says why an assumption would be worse
than an omission: a wrong `agentBinaries` turns "the program is missing" into "your agent is installed and
something else is wrong", which is a less actionable sentence and is unfalsifiable from the row. The
reference product offers no template for this, and that is checked rather than assumed: its
`AcpProviderCatalogEntry` has `command`, `env` and `params` and nothing about a second binary, and its
generic ACP provider resolves exactly one (`defaultBinary: this.command[0]`).

**6. Four recipes set six environment variables between them, and what crosses is a reference.** See §7.10
for the rule; the part that is this screen's is the row. The four entries' constants travel in
`CatalogEntry.env` as **name and value** (they are ours, published in a git-tracked file, and a constant of a
command line anybody can read is not a secret), the row says the recipe supplies them rather than telling a
user to export them, and `addInputFor` drops the values on the way to `coder.addProvider` — sending the
entry's `id` as `catalogEntryId` instead. A test asserts the negative by looking for the `1` in the
parameters, and `CatalogEnvConstantSchema` refuses a credential-looking name **when the row is built**, so
`ANTHROPIC_API_KEY: "sk-live-…"` can never appear in a recipe.

**What was copied from the reference product, and what was not.** Copied: the information architecture (a row
per agent with a state chip and a switch; the catalogue as rows a user adds from; a search box over it), and
the interaction of adding an entry by pressing one button. **Not copied:** its credential handling — the
entry's `env` *values* go into its `config.json`, and here only the **names** cross (§7.10), which is why the
four entries whose recipe sets a constant carry a name and a sentence telling the user to set it. **Not
copied, deliberately:** its per-entry icon set, its "disabled ⇒ `unavailable` and `listModels` throws"
effect (§5.8's correction), and its diagnostic sheet, which dumps a raw log — we render the state, the one
sentence the daemon wrote, and the fix, all of which a user can act on.

**The one real cost of adding a catalogue entry, and that it is now paid off.** This paragraph used to say
the cost was unavoidable: four recipes set **six** variables for the agent
(`AUGMENT_DISABLE_AUTO_UPDATE`, `DROID_DISABLE_AUTO_UPDATE`, `FACTORY_DROID_AUTO_UPDATE_ENABLED`,
`GJC_ACP_PERMISSION_MODE`, `VT_ACP_ENABLED`, `VT_ACP_ZED_ENABLED`), a provider config stores variable
**names** and reads the value from the daemon's own environment, and so what crossed was the name — leaving
the user to export a constant we had written ourselves, or read a refusal naming it. What the paragraph got
right was the fix's *shape*: **a field carrying a reference to the catalogue entry rather than a value, made
against a launch that reads it.** That is `catalogEntryId`, and the launch reads it through
`resolveProviderEnv` (§7.10). A var the entry does not declare is still the user's, and it still refuses by
name when the daemon's environment lacks it.

**Twelve mutations, named with the test that catches each.** Every `it` in
`apps/desktop/test/settings-agents-catalog.test.tsx` and `apps/desktop/test/catalog-rpc.test.ts` was checked
against a deliberate break, applied with the anchor asserted **before** the write and the file restored
byte-exact afterwards; each run was a **whole file**, never a filtered one, because a mangled `-t` filter
once made nine mutations read green while vitest exited 0. The table:

| mutation | the test that went red |
|---|---|
| render only the shipped agents, not the catalogue | *lists the agents this machine has and the whole catalogue, in one place* |
| an unmeasured row defaults to `ready` | *claims nothing at all until somebody measures it* |
| the add path drops the entry's argv | *sends the command, the arguments and the environment names the entry describes* |
| the add path defaults the dialect to `"acp"` | *carries the dialect the row states, and never invents one* |
| the fix a missing program carries is not rendered | *shows the install link and the exact command when the program is missing* |
| one install sentence for both shapes (npx and binary) | *says plainly that an npx recipe needs no install…* |
| a preference the user stored decides what a picker offers | *offers a row that carries a stored preference anyway — the preference has no reader here* |
| an older daemon's missing method is not checked first | *says so when an older daemon has no catalogue, instead of throwing the pane away* |
| `coder.listCatalog` walks the search path while it builds rows | *serves every entry, and measures none of them* |
| every answer is cached, absences included | *never serves an absence from cache — that is the answer a user is about to change* |
| one probe sweeps the whole catalogue | *measures the entry it was asked about, and only that one* |
| the recipe's environment **values** cross into the provider config | *carries the command, the args and the environment names, and nothing else* |

**Eight more, for the four limits this slice closed** — same discipline: each applied with the anchor
asserted *before* the write, each run as a **whole file** (never a filtered `-t`, which once made nine
mutations read green while vitest exited 0), and each file restored byte-exact afterwards (checked by
`shasum`, not by eye):

| mutation | the test that went red |
|---|---|
| the catalogue reference is trusted instead of verified (`providerCatalogueEnv` drops `agreesWithEntry`) | *ignores a reference whose recipe is not the provider's — the file cannot claim a recipe it is not* and *supplies a recipe value only for a name the provider declares* |
| the credential-name pattern never fires | *refuses a recipe constant under a credential-looking name, loudly* (`ANTHROPIC_API_KEY must look like a credential: expected false to be true`) |
| a catalogue entry stops recording its vendor binary | *reports `needs-bridge` for an entry that declares the vendor binary its adapter drives* (`expected 'not-installed' to be 'needs-bridge'`) and *declares a wrapped agent exactly once, and never by assumption* |
| an `npx` row claims `ready` again (`rowStateOf` drops the narrowing) | *does not let an npx row read as verified, because only `npx` was measured* |
| the row sends the recipe's **value** where a name belongs | *sends the command, the arguments and the environment names the entry describes* and *produces the parameters `coder.addProvider` takes, from the entry and nothing else* |
| `coder.addProvider`'s parameters grow an `envDefaults` field | *cannot carry a value even through the wire a client would send* (`promise resolved … instead of rejecting`) |
| `coder.addProvider` stops checking the reference against the recipe | *cannot carry a value even through the wire a client would send* (`promise resolved … instead of rejecting`) |
| the multi-window wait loses its kind predicate (the race's own fix) | *does not mistake the boot search-path broadcast for the change the test made* (`expected 'harnesses' to be 'projects'`) |

**And the window itself was driven, not described.** `scripts/audit-ui.mjs` was pointed at the real window
— a daemon on an isolated home, Vite, headless Chrome over CDP, the target matched **by URL** — and the
numbers below are measured there rather than asserted here: see §7.13.


### 7.13 The agents page, measured in a real window rather than described

Driven, not asserted: a daemon on an **isolated home** (`ENVOYMESH_HOME=/tmp/envoycoder-catalog-home`,
port 4792), `vite` on 6181 with `VITE_ENVOYCODER_DAEMON_PORT=4792`, headless Chrome over CDP with the
target matched **by URL** (`scripts/audit-ui.mjs`, which now takes `--clicks "Settings|Agents"` and probes
the catalogue; `scripts/preview-ui.mjs` for the pictures). The isolated home matters: the machine this was
measured on has nine agents probed and four of them missing, which is what makes the five-state column a
test of the vocabulary rather than of a fixture.

**The list, on open.**

| measurement | value |
|---|---|
| catalogue rows rendered | **38** |
| distinct state chips among them | **1** — "Not checked yet" |
| rows saying "Nothing to install" (the `npx` recipes) | **14** |
| rows saying the binary sentence | **24** |
| Add buttons in the list | **36** (= 38 − `cursor`, which is a shipped agent, − the one entry added during the walk) |
| shipped agents listed | **9** — 3 Ready, 2 "Needs its adapter", 4 "Not installed", with their real install commands (`npm install -g @agentclientprotocol/claude-agent-acp`, `…codex-acp`, `npm install -g @github/copilot`) |
| sign-in buttons | **0** *on that machine* — and that was the honest answer rather than a gap: no agent there reports `needs-signin`, and the control is rendered for that state alone rather than present-but-dead. **Superseded by §7.13.1**, where the state is produced on purpose and the number is 1 |

**After one press of *Check this machine* on the first row:** the chips become `["Ready", "Not checked
yet" × 37]`. One row measured, thirty-seven untouched — the per-row cost policy, as a number rather than a
promise. The row's buttons become *Check again* and *Remove*; the other 37 keep *Check this machine*.

**Adding one.** Pressing *Add* on a catalogue row moved it into "Your agents" as a provider with its own
state chip, and a **separate browser session** — a second client — saw the same row in `coder.listProviders`.
That is the phone's half of this slice demonstrated rather than argued: the catalogue is served
(`coder.listCatalog`), the added provider travels the wire every client already reads, and no client needs
a copy of `@envoycoder/agent-catalog`.

**Hiding one — and this measurement is now a record of a feature that no longer exists.** A second walk
pressed *Hide from my lists* on a shipped agent: the preference was written, and in the next window the row
carried the **Hidden** chip *beside* a state chip that still read **Ready**, with 8 *Hide* buttons and 1
*Show* — which at the time was read as confirmation of §5.8's correction. It confirmed the wrong property:
the switch could not falsify a measurement, and it *could* take an agent we ship out of the lists this
product offers, which the walk did not ask about because it was not looking for it. The switch, the chip and
the preference are deleted (§5.8), and the number a walk should now report is **0** — no control on the page
mentions hiding, and the shipped-agent count is unchanged at **9**. The re-measurement is below.

**Layout and contrast**, at three window sizes. All numbers are computed the way WCAG computes them.

| | 1440×900 | 1280×800 | 1000×800 |
|---|---|---|---|
| `.settings-layout` columns | `216px 924px` | `216px 764px` | `700px` (no bar: the sections list is the page) |
| body width | 924 | 764 | 700 |
| catalogue row height (median / max) | 127 / 183 | 127 / 220 | 127 / 220 |
| rows per viewport | 6 | 5 | 4 |
| rows overflowing their column | 0 | 0 | 0 |
| horizontal page overflow | 0 | 0 | 0 |

Contrast, composited over the pane the text actually sits on: `.settings__hint` and
`.settings__catalog-version` **8.43:1** (11px), `.settings__agent-command` **8.43:1** (12px, mono),
`.settings__link` **10.91:1**, the "Not checked yet" chip **20.12:1**, the "Ready" chip **8.54:1**. All
above the 4.5:1 floor for small text, and all measured rather than eyeballed.

**Two compactions the first measurement forced, because "it fits" is not a measurement.** The first run of
this audit reported a **220px** row and 3 rows per viewport: 38 entries were **eleven and a half thousand
pixels** of scrolling, eighteen screens, for a list whose own documentation says it is read by searching.
The breakdown said where the height was, and it was not where it looked: the head band — chip, name and
version — was **58px of the 165px row**, because the shipped agents' head is a column (name above a
sentence about the agent) and a catalogue row had inherited it. Made a row, with a one-line description
clamped under it, the row is **127px**, and **six rows are visible where three were**. The whole page — nine
shipped agents, the catalogue's 38 rows and the manual form — is a 8090px scroll in a 647px viewport, which
is a page a user searches rather than reads. Nothing was hidden to get there: the description's whole
sentence is in its `title` and still in the document, so a screen reader reads all of it.

**The measurer was wrong before the page was.** The first run also reported the **"Ready" chip at
1.03:1** — a failure, on a chip that has been in this product since the first slice. It was the tool:
`bgOf` took the first ancestor whose background was not fully transparent, which for an `rgba()` chip is the
chip *itself*, so it compared the chip's blue text against its own blue channels read as opaque. Compositing
the ancestor chain (which is what a reader sees) gives **8.54:1**. The fix is in `audit-ui.mjs`, and it is
recorded here because a measurer that reports a false alarm is worse than one that reports nothing: the next
person either "fixes" a contrast that was fine or learns to ignore the column.

**What was measured, and what is still reasoned about.** The sign-in control was the entry on this list, and
it is off it: §7.13.1 produces the `needs-signin` state on purpose — a real daemon with a scripted agent on
its search path — and measures the button, the press and the sentence in a real window. What remains
reasoned about rather than measured on this page: the **`npx`** claim. Fourteen rows read "Not downloaded
yet" and no run has yet watched a first run actually fetch a package, so the sentence says what the probe
measured (`npx` resolves) and that nothing has been downloaded, and nothing more. Screenshots for a reader
who can see pixels: `/tmp/envoycoder-agents-*.png` (`-top`, `-checked`, `-search-cline`, `-added`,
`-manual`, `-1000`) from the run above, and `<tmp>/envoycoder-signin-window/{before,after}-press.png` from
§7.13.1 — the run above is what a text model can check.

#### 7.13.1 The Sign-in button, measured in a window instead of reasoned about

§7.13's table used to end with the honest **0**: *"no agent on this machine reports `needs-signin`, and the
control is rendered for that state alone rather than present-but-dead"*. That was a true statement about a
machine and not a measurement of the feature, and the jsdom test was the only evidence for the control. The
condition is producible on purpose, so the number is now `1` — measured, in a real window, against a real
daemon, with an agent that really refuses a session:

```
npm run signin:window            # 9 checks; screenshots under <tmp>/envoycoder-signin-window
npm run signin:window -- --audit  # …and ui:audit's numbers for the same page
```

`scripts/sign-in-window.mjs` boots `apps/desktop/src/daemon/main.ts` as a child on an isolated
`ENVOYMESH_HOME` and a distinct port, with a directory holding an executable named `claude-agent-acp`
**prepended to `PATH`** — a four-line shell wrapper that runs
`apps/desktop/test/fixtures/fake-acp-agent.mjs` with `FAKE_ACP_REQUIRE_AUTH=fake_login` exported. That is the
whole mechanism and it bends nothing: the daemon finds the program the way it finds any program, the probe
starts it the way it starts any agent, and the fixture advertises one `authMethods` entry and refuses
`session/new` with `-32000 Authentication required … methodId 'fake_login'` until it is given one — the
measured behaviour of `cursor-agent acp`, on demand. `claude-agent-acp` is the name chosen because no real
install occupies it, unlike `cursor-agent`, which this machine has and which a login-shell search path would
resolve first. Vite then serves the real UI at `VITE_ENVOYCODER_DAEMON_PORT=<that daemon>`, and headless
Chrome is driven over CDP with the target matched **by URL**.

| measurement | value |
|---|---|
| `coder.probeSessionOptions { harness: "claudecode" }` | reached the fixture; the refusal came back in the agent's own words (`… methodId 'fake_login'`) |
| `coder.listHarnesses` → `claudecode.auth` | `{ state: "needs-signin", methodId: "fake_login" }` |
| …and `claudecode.availability` | `ready` at the wrapper's absolute path — the two facts separate, not one |
| **Sign-in buttons the window drew** | **1** — label `Sign in`, title *"Run Claude Code's own sign-in flow, and say truthfully what happened"*, enabled |
| the row it sits in | reads `Needs a sign-in`, beside `Ready` |
| the rendered sentence after the press | **"Claude Code accepted the sign-in and opened a session."** |
| the button afterwards | **0** — it is gone, because the agent now opens sessions |
| the daemon's record afterwards | `{ state: "ready" }` — `coder.signInAgent` wrote it, so the click did the work |
| `ui:audit` on the same page (pre-press) | 38 rows, distinct states `["Not checked yet"]`, `needsSignin: 1`, `signInButtons: 1`, `needsNoInstall: 14`, `installSteps: 24`, `addButtons: 37`, horizontal overflow `0`, 5 rows per viewport |

The press is the **window's** — a real `click()` on the rendered button — and the sentence is read out of the
`role="status"` element the component renders it in. The daemon is then asked what it recorded, which is what
makes "the click did the work" a fact rather than an inference from the button's disappearance. Two PNGs are
left in `<tmp>/envoycoder-signin-window`: `before-press.png` (the button, on a row that says *Needs a
sign-in*) and `after-press.png` (the outcome sentence). The pictures are for a human — this model cannot read
them, which is the whole reason they exist.

**What remains unproven, named rather than implied.** The agent is a *scripted* one: the refusal, the
advertised method and the authentication are the fixture's, driven through the production spawn and handshake
paths but not by a vendor's binary. `cursor-agent acp`'s own refusal is recorded from a real run in §7.8 and
`test/sign-in.test.ts` covers the five outcomes against a scripted `ProbedAgent`; what this measurement adds
is that the **state reaches a rendered window and the press reaches the daemon**, which was the missing link.
The browser step (`not-completed`) is still not produced by any window run.

#### 7.13.2 The same page, re-measured after the preference was deleted

The walk above pressed *Hide from my lists* and recorded it as a confirmation of §5.8. It was a
confirmation of the wrong property — the switch could not falsify a *measurement*, and it could take an
agent we ship out of the lists this product offers — so the preference is gone and the page was measured
again, the same way and on the same terms: an isolated home (`ENVOYMESH_HOME=/tmp/envoycoder-hide-home`),
a real daemon on port 4794, Vite on 6184 serving the real UI with `VITE_ENVOYCODER_DAEMON_PORT=4794`, and
`scripts/audit-ui.mjs` driving headless Chrome over CDP with the target matched **by URL**:

```
npm run ui:audit -- http://127.0.0.1:6184/ --clicks "Settings|Agents"
```

| measurement | before (§7.13) | after | |
|---|---|---|---|
| catalogue rows rendered | 38 | **38** | unchanged |
| shipped agents listed | 9 | **9** | unchanged — including the 4 the probe reported `not-installed` |
| rows saying "Nothing to install" (the `npx` recipes) | 14 | **14** | unchanged |
| rows naming a binary install | 24 | **24** | unchanged |
| Add buttons in the list | 36 (after one add during the walk) | **37** (= 38 − `cursor`, built-in, no add made) | consistent |
| catalogue row height (min / median / max) | 127 / 127 / 220 | **127 / 127 / 240** | same median; the max follows the longest description on a wider window |
| rows per viewport | 6 | **5** | a 1440×813 viewport here vs 1440×900 there — the number is `floor(innerHeight / mean row height)`, not a regression |
| rows overflowing their column | 0 | **0** | |
| horizontal page overflow | 0 | **0** | |
| the "Not checked yet" chip | 20.12:1 | **20.12:1** | the only chip on an unmeasured catalogue |
| small print (`.settings__hint`, `.settings__catalog-version`, `.settings__agent-command`) | 8.43:1 | **8.43:1** | above the 4.5:1 floor |
| `.settings__link` | 10.91:1 | **10.91:1** | |

**And the four numbers the deletion is actually about**, read off the same rendered page by the same
target-by-URL rule (a throwaway CDP probe, since `audit-ui.mjs` measures layout rather than vocabulary):

| measurement | value |
|---|---|
| buttons on the page whose text matches *Hide* or *Show* | **0** |
| buttons or chips anywhere on the page mentioning *Hidden* | **0** |
| the page's own text containing "Hide from my lists" / "Show in my lists" | **false** / **false** |
| shipped-agent rows carrying a Remove control | **0** — Remove exists only on a row the *user* declared |
| sign-in buttons | **0** — and that is the honest answer on this machine rather than a gap (see §7.13.1, where the state is produced on purpose and the number is 1) |

**The picker, measured in the same window rather than argued about from the rule.** Pressing *Settings* →
*New tasks* on the same build renders a select labelled *The agent new tasks start with* with **five
options of the nine we ship** — Envoy Harness, DeepSeek Harness, Cursor Agent, Claude Code, Codex — because
four of the nine (`copilot`, `opencode`, `pi`, `omp`) are `not-installed` on this machine and `offeredAgents`
drops exactly that state. `ready` comes first, which is why Envoy Harness leads and why the catalogue's own
order is preserved under it. And the row carries the sentence the deletion made necessary: *"Every agent
EnvoyCoder supports is on the Agents page — including the ones that are not installed here, each with the
command that fixes it."* — so the four absent ones are named, explained and installable one press away
rather than silently missing. The page itself measures `rowsWrapped: 0`, `horizontalOverflow: 0`, and three
rows in a 647px viewport, i.e. the sentence did not push anything out of its column.

**What was measured, and what is still reasoned about.** Measured: the row count, the states, the chips,
the contrast, the row heights, the absence of every hide-shaped control, the picker's contents and order,
and the new sentence's presence. Reasoned about rather than measured: that the four dropped picker entries
are the right four (the probe's own answer is the evidence, and the mapping from state to offer is a unit
test rather than a window measurement), and the *Add* / *Remove* path on a declared provider, which is
covered by `settings-agents-catalog.test.tsx`'s DOM cases and by `daemon-rpc.test.ts` over a real socket
rather than by this walk — the walk's isolated home has no provider in it.



### 7.14 A settings file is the user's data: the read is tolerant by construction

**The failure this replaces, in the words of the report that found it.** *"`hiddenAgents` had to go into
`RETIRED_SETTINGS_KEYS`, or the strict schema would have quarantined an upgrading user's entire settings
file (language, folder, default agent) over a list nothing reads."* Both halves of that sentence are
defects. The first is what happened: one unknown key cost the user four known ones. The second is what
would have happened next time — a maintainer who deletes a field without remembering a list takes
somebody's settings with it, and nothing in the build says so.

**What the read does now** (`readCoderSettingsDocument`, `packages/protocol/src/domain.ts`). Four
outcomes, and the line between them is the whole design:

| what is on disk | what happens | why |
|---|---|---|
| a document with a key this build does not have — retired **or** never shipped by us | the key is **dropped and noted**; every other setting is kept | we understand the document perfectly apart from a field nothing here reads. Losing a language, a folder and a default agent to it is not caution, it is destruction |
| bytes that are not JSON, or JSON that is not one object | **quarantined** — moved aside, not overwritten | there is no document here to keep anything *from*. A different event from the row above, and it keeps its old treatment |
| a document whose *values* we refuse (the right key, the wrong type) | **quarantined** | `keepTranscripts: "yes"` has no reading we could honestly pick, and guessing at a control plane's own configuration is worse than the defaults plus a sentence |
| a document missing a key the schema requires | **quarantined** | the same: this is not a settings document |

So the rule is one line: **prune keys, refuse values.** A key we do not have is not an unreadable file.

**`RETIRED_SETTINGS_KEYS` is no longer load-bearing, and its doc says so.** It survives as a
*vocabulary*: membership turns "this build does not recognise `hiddenAgents`" into "this build used to
have it and does not any more", which is a different sentence for a user because it names a deletion. The
honest test of "not load-bearing" is that deleting the constant would break no behaviour — only the
wording of two notes — and `test/settings-store.test.ts` asserts exactly that, with the retired-key case
and the never-heard-of-it case producing the **same kept settings** and different sentences.

**The file is deliberately not rewritten when a key is dropped.** The collection reader rewrites a list
after skipping a bad row so the warning appears once; that is not copied here. An unknown *settings* key
is far more often a key from a **newer** build — the user ran a newer EnvoyCoder, then an older one — and
rewriting the file would delete that setting permanently, from a version that does read it. The note
repeats until the user's next settings write, and nothing is destroyed behind their back.

**The same question one layer out, answered rather than left implied.** `RpcMethodSpec`
(`packages/protocol/src/rpc.ts`) carries the table: an extra field from a newer daemon is **harmless by
construction** because no client parses a result (this document's own claim in §7.2 that `loadSettings`
would refuse one was wrong — it casts); a window calling a method an older daemon lacks is handled at
connect time by `missingMethods` and per-call by `-32601`; and an older daemon **omitting** a required
field is handled by a guard at the reader. Nothing was changed on the wire, and that is a decision rather
than an omission: parsing results on the client would convert "one row degrades to a sentence" into "the
whole call fails", and would make *adding* a result field a breaking change for old windows — the exact
opposite of the property that makes the first row true today.

**The tests, and what each one fails on** (`apps/desktop/test/settings-store.test.ts`,
`apps/desktop/test/settings-notes.test.ts`):

| case | the mutation it goes red on |
|---|---|
| an unknown key keeps every known field and is noted | putting `.strict()` back in the read path without the prune |
| a retired key does the same, and is noted as a *deletion* | collapsing the two note sentences into one |
| a key unknown **inside** `defaults` is dropped too | pruning only the top level — the obvious wrong implementation, which moves the catastrophe one object deeper |
| the dropped key is still on disk afterwards | copying `readCollection`'s rewrite-after-skip |
| bytes that are not JSON are still quarantined | making the tolerant read swallow a parse failure |
| JSON that is not one object is still quarantined | treating tolerance as "try harder to find settings in anything" |
| a known key with the wrong type is still refused | making the prune drop *invalid* keys as well as unknown ones |
| the list is not consulted to decide whether to keep the rest | any `if (!RETIRED.has(key)) refuse()` guard |

Each was run against its mutation, with the file restored byte-exact after: **8 mutations, 8 named tests
red, 0 stayed green.** The commands and the raw output are in the slice report.

### 7.15 The Agents page, re-measured: 15,139 characters to 926

**The brief.** *"Each page has too many texts and the section is not so clear, feel crowded and don't want
to read so many texts."* A judgement like that is easy to agree with and impossible to keep, so it was
turned into five numbers and a script — `scripts/measure-settings.mjs`, which boots a daemon on an
isolated home, Vite against it, and headless Chrome over CDP with the target matched **by URL**.

**Where the text was.** The page total was **15,139 characters over 8,391px (12.97 screens)**, and the
per-group split says where it came from — which is not where a reader would guess:

| group | characters | rows | height |
|---|---|---|---|
| *On this machine* | 3,115 | 9 | 1,509px |
| *Your agents* | 124 | 1 | 17px |
| **the catalogue** | **10,817** | **38** | **5,835px** |

Seventy-one per cent of the page was the catalogue — thirty-eight recipes rendered expanded inside a page
that also has to hold the nine agents we ship. A user who opened *Settings* to change their language
scrolled past all of them to find out they were on the wrong page.

**The four rules, and what each one changed.**

1. **A row is a name, a state, and at most one short line.** The line is the *actionable* fact — the
   command to run, or the short phrase naming what to do. Everything else moved: the agent's own summary
   to the name's `title`; its published modes, models and thinking levels, its recipe's command line, its
   install link, its last-checked time and any fix sentence to a `Details` disclosure; the page's teaching
   paragraphs to those `title`s and to this document. The budgets are `AGENT_ROW_LINE_BUDGET` (80),
   `AGENT_ROW_BUDGET` (140) and `SETTING_DETAIL_BUDGET` (80) in
   `apps/desktop/src/components/settings/density.ts`, and `apps/desktop/test/settings-density.test.tsx`
   renders every settings page and fails when one is exceeded.
   **The one branch worth naming:** `AvailabilityFix.command` is shown verbatim *when it is a command* —
   and it is not always one. Two of the catalogue's own hints are 127 and 136 characters of English prose
   in a field named `command`. The row branches on length: a command is printed copyable, a sentence is
   replaced by a three-word phrase with the whole of it in the `title` **and** the disclosure. A clamp
   would have enforced the budget by construction and made it unfalsifiable, which is why it is a branch
   and why both sides are asserted.
2. **Group headers carry counts.** `On this machine · 9`, `Your agents · 0`, `Catalogue · 38`. The
   separator is text in the markup rather than a `::before` — a generated `content` is not part of an
   element's `textContent`, so a pseudo-element had the heading reading as "Catalogue38" to anything that
   walks the DOM.
3. **The catalogue opens on demand, and nothing becomes invisible.** The count is in the heading and both
   entry points (*Browse the catalogue*, *Add a program of my own*) are on screen, always. This repository
   deleted a *hide* feature (§5.8) and the distinction is kept straight: a **filter** moves an agent out of
   a list the user is looking at and can do it to one we ship; a **disclosure** collapses a group, states
   its size, and unfolds on one press. `settings-density.test.tsx` asserts both halves — zero rows on
   open, count and entry point present — because either half alone is a defect.
4. **No teaching paragraph inside a row.** `settings.agents.note` (157 characters), `…add.note` (341) and
   `…manual.note` (196) are deleted as page furniture; their substance is in the three `title`s and in this
   document. A fourth budget, `SETTING_NOTE_BUDGET` (180), catches the shape a paragraph takes when it
   moves into a row — it is set above the approval row's *reason* (169 characters with a real agent name in
   it, which the pane's oldest law requires) and below the 140-character teaching note that was deleted
   from *New tasks*.

**Before and after, measured the same way in the same window.** `--open "Browse the catalogue"` measures
the page with the group unfolded, because a single number would have to pick one and would then be quoted
as if it were the other:

| measurement | before | after, as it opens | after, catalogue open |
|---|---|---|---|
| **total visible characters** | 15,139 | **926** (−94%) | 3,927 (−74%) |
| **page height** | 8,391px | **908px** | 3,303px |
| screens (body height ÷ viewport) | 12.97 | **1.40** | 5.11 |
| **rows above the fold** | 4 | **8** of 10 | **8** of 48 |
| **longest row** | **575** characters | 124 | 124 |
| catalogue row height | 127 / 127 / **240** (min/median/max) | — | **60 / 60 / 60** |
| widest row | 892px | 892px | 892px |
| rows overflowing their column | 0 | 0 | 0 |
| horizontal page overflow | false | false | false |
| **lowest contrast** on the page | 4.93:1 (`chip--warn`) | **4.93:1**, 0 below 4.5 | 4.93:1, 0 below 4.5 |
| elements with a background gradient | 0 | 0 | 0 |

Contrast is computed the way WCAG computes it, **compositing the ancestor chain** rather than taking the
first non-transparent background — the rule `scripts/audit-ui.mjs` already recorded after a chip at 16%
alpha reported 1.03:1 against its own text. No chip or piece of small print changed colour in this slice,
and the number is reported because "we changed some chips" is the kind of claim that ought to come with
one.

**The other pages, and how their numbers were obtained — which is not the same way.** The four numbers
above are *rendered*, before and after, in a real window. For the other sections the "before" is the
**source** length of the strings that were trimmed (exact, read from the catalogue) and the "after" is
rendered, because reverting the tree to measure seven more pages would have cost more than it bought:

| page | longest `.setting__detail` before | after | longest `.setting__note` after | rendered characters after |
|---|---|---|---|---|
| General | 202 | **54** | — | 222 |
| New tasks | 190 | **49** | 30 (was 140) | 511 |
| Safety | 175 | **41** | 94 (the approval reason, uncapped by design) | 247 |
| Projects | 123 | 39 | — | — |
| This machine | 114 | 49 | — | — |

Twelve `.setting__detail` strings were over the budget and all twelve are now under it; the longest left in
the window is **74** (`settings.machine.version.detail`, *"The version of the program that stores your
settings and runs your agents."*), measured on the rendered page. `settings-density.test.tsx` asserts the
budget on every section, so the number is a gate rather than a sample. The pages were already one screen
each, so their *height* did not change — what changed is that a reader meets a short sentence instead of a
paragraph, which is the whole of the brief.

**What was measured, and what is still reasoned about.** Measured: every number in the two tables above,
taken from the rendered DOM in a real window; the three budgets, enforced by a test that fails on content;
the counts, the collapsed catalogue and the disclosed facts, asserted in `settings-density.test.tsx`.
Reasoned about rather than measured: that a 60px catalogue row is *readable* — the measurement says it is
short and uniform, and whether it is pleasant is the owner's eyes on the PNGs `scripts/measure-settings.mjs`
leaves in its output directory, which is exactly why it leaves them. Also reasoned about: that the
character count is a good proxy for "crowded". It is a proxy, and it is the one that can be checked; a page
can be short and still badly arranged, and no script here would notice.


### 7.16 The row the owner could not read, and the agent it said was missing

Two reports, verbatim:

> *"Some agents I have installed, but still show need to install or need adapter. Eg, codex, claudecode,
> deepseek-harness. actually I am using deepseek-harness."*
>
> *"The UI for agents are worse than before, can we give more space to each agent and emphasize the Agent name,
> the status or actions are just properties, Align the texts."*

They are two independent defects, and the second is the price of §7.15: that round cut the page by 94% of its
characters and made it *worse to read*, because **a character count is a proxy for "crowded", and the round
optimised the proxy**. Rows dropped to 60px, the state chip came *before* the name, and the name was set at
13px/500 — the same size and weight as every other label on the page. This section is what replaced it.

#### 7.16.1 The three agents, measured rather than assumed

Everything below is a command that was run on this machine on 2026-09-15, with its output. `$SHELL` is
`/bin/zsh`.

| question | answer |
|---|---|
| `$SHELL -ilc 'command -v dsh'` | `/Users/shileipeng/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh` |
| `$SHELL -ilc 'command -v codex'` | `/Users/shileipeng/.npm-global/bin/codex` |
| `$SHELL -ilc 'command -v claude'` | `/Users/shileipeng/.local/bin/claude` |
| **the same login shell asked for `$PATH`, from a clean environment** (`env -i HOME=… SHELL=/bin/zsh /bin/zsh -ilc 'printf %s "$PATH"'`) | **26 directories, and none of them contains `_npx`.** `for d in ${(s.:.)PATH}; do [ -x "$d/dsh" ] && echo FOUND; done` prints nothing |
| the running daemon's own inherited `PATH` (`ps eww -p <daemon pid>`) | **48 entries, no `_npx` in any of them** |
| the daemon's log at boot (`~/.envoymesh/EnvoyCoder/logs/daemon.log`) | `[envoycoder] agent search path from login-shell: 33 directories` |
| the live daemon's answer (`coder.listHarnesses` on `ws://127.0.0.1:4770/ws`) | `deepseek-harness` → **`not-installed`**, fix `npm install -g @deepseek-ai/dsh (developer preview: expect breaking changes)`; `claudecode` → `needs-bridge`, `agentBinary: /Users/shileipeng/.local/bin/claude`; `codex` → `needs-bridge`, `agentBinary: /Users/shileipeng/.npm-global/bin/codex` |

**Three different causes, and only one of them was a wording problem.**

* **`deepseek-harness` was genuinely misreported, and the `_npx` clue in §7.9's provisional rule was the
  reason nobody noticed.** The program lives in npm's per-invocation cache, which is on **no `PATH` this
  process can reconstruct**: not the login shell's (26 entries), not the daemon's (48), not the well-known
  list. So the probe searched, found nothing, and said `not-installed` — and the row's line was the entry's own
  76-character install command, which fits `AGENT_ROW_LINE_BUDGET`, so the row read as *"Not installed —
  `npm install -g @deepseek-ai/dsh`"*. The previous round had written the `provisional: "npx"` rule *for this
  path* and could never reach it: a rule whose input cannot occur is not a fix. **The answer was wrong, and it
  was wrong about a program that runs** — `acp-transport.test.ts` drives the same binary in this suite.
* **`codex` and `claudecode` were measured correctly and read wrongly.** `codex-acp` and `claude-agent-acp` are
  really not installed (`findBinary` → `null` for both), so `needs-bridge` is the true state: the agent the user
  installed is *there*, and the one missing piece is an adapter package they have never heard of. The row said
  "Needs its adapter" above a bare `npm install -g @agentclientprotocol/codex-acp`, which is a sentence whose
  only content is an install command. A reader concludes "not installed" — and is half wrong. **This is a view
  defect, and it is fixed in the view.**
* **A stale daemon, a cached absence and an unreachable catalogue entry were all checked and are all absent.**
  The daemon's log shows it *did* take the login shell's answer (33 directories, source `login-shell`), the
  probe caches nothing (`probe.ts` says so and the row re-measures), and all three agents are in
  `coder.listHarnesses`.

**What changed, and why each change is the honest one.**

1. **`shell-binaries.ts` asks the login shell about the names, one `command -v` at a time.** This is a
   *different question* from "what is your `$PATH`": a shell asked for a variable reports a list, and a shell
   asked for a name performs the lookup it would perform for the user — a hash entry, a directory an `npx`/
   `bunx` child inherited, a shim a toolchain manager computes. It is bounded the same way the `PATH` read is
   (one invocation for every name, a 2500 ms deadline, a 64 KiB output cap, read **by marker**, cached per
   name for the life of the process, never on the daemon's critical path) and it is **not** a second answer:
   each answer's directory joins the same list the probe searches and the spawn hands to the child, so the two
   cannot disagree. Names are validated against a closed character set rather than quoted, because a provider's
   command is user-controlled data.
2. **`cacheBinDirs()` searches npm's `npx` cache, last.** This is what actually fixes the reported row: the
   program is there, this finds it, and `provisionalCacheOf` still marks it — so the row reads **Ready** with
   the *Temporary copy* warning the previous round wrote for exactly this case. Bun's and pnpm's caches are
   deliberately **not** enumerated (no measured layout), which is stated rather than papered over.
3. **The row leads with what is present.** `installedLine` composes `Installed — ` + the command for
   `needs-bridge`, so the two rows the owner quoted read *"Codex / Installed — `npm install -g
   @agentclientprotocol/codex-acp` / [Needs its adapter]"*. Nothing is softened: the chip still names the one
   missing piece, `not-installed` still says *Not installed* with the agent's own install step first, and the
   branch that moves the command to the `title` when the two will not share a line is asserted from both sides.
4. **`launchForProvider` now spawns the path the probe resolved**, which is what the catalogue tier already
   did. Not a bug anybody had hit (the child's `PATH` was right), but *"the probe verified this file"* and
   *"something on that list probably answers to this name"* are different claims, and a test now asserts the
   invariant for both tiers.

#### 7.16.2 The layout, measured in a real window

The same instrument as §7.15 (`scripts/measure-settings.mjs`, extended with an `anatomy` block): an isolated
home, a real daemon, Vite against it, headless Chrome over CDP with the target matched **by URL**, at
1440×813, with `--open "Browse the catalogue"` so the measurement is of 48 rows and not 10.

| measurement | before | after |
|---|---|---|
| **name font size / weight** | 13px / **500** | **15px / 600** (`--font-size-content` / `--font-weight-semibold`) |
| the row's secondary line | 12px, `--text-muted` | unchanged — the *layout* changed, not how much is written |
| **row height, shipped agents** | 70px | **80px** |
| **row height, catalogue** | 60px | **80px** |
| row heights: min / max / spread / sd | 17 / 70 / 53 / 7.3 | 17 / 80 / 63 / 9 (the 17px row is the *empty state*, which is not a row) |
| **name left edge — spread across 47 rows** | **65.1px** (587 → 652.2) | **0px** (532) |
| line left edge — spread | 0px (532) | 0px (532) |
| **worst gap between a name's left edge and its own line's** | **120.2px** | **0px** |
| **state chip right edge — spread** | **372.6px** (579 → 951.7) | **0px** (1152) |
| controls right edge — spread | 0px (1424) | 0px (1424) |
| the controls column | sized by each row's own content | **fixed track, 256px** — the measured widest natural width (`Check this machine` + `Add`) |
| rows whose buttons wrapped / were squeezed | — | **0 / 0** |
| **visible characters on the page** | 3,927 | **3,951** (+24: `Installed — ` on two rows) |
| page height / screens | 3,303px / 5.11 | **4,161px / 6.43** |
| **rows above the fold** | 8 of 48 | **7 of 48** |
| longest row (characters) | 124 | 124 |
| rows overflowing / horizontal overflow | 0 / false | 0 / false |
| contrast below 4.5:1 | 0 (worst 4.93, `chip--warn`) | 0 (worst 4.93) |

**The four decisions behind those numbers, and the reason for each.**

* **80px per row.** The two text bands measure 19.5px (name at 15px/1.3) + 2px + 17.4px (line at 12px/1.45)
  ≈ 39px, so the row carries ~20px of air above and below — against ~9px for a 60px catalogue row. It is also
  on the 2/4 spacing rhythm the rest of the sheet uses, so an 80px row does not break the page's vertical
  rhythm. **This is the number that costs the page a screen and a half of scrolling, and it is the number the
  owner asked for**: *"give more space to each agent"*.
* **15px/600 for the name.** The body text is 13px, the secondary line 12px, the group headings 13px caps, and
  ordinary UI labels (nav items, buttons) use `--font-weight-medium`. `--font-size-content` is one full step
  above all of them and `--font-weight-semibold` is one weight step above the labels, so the name is the only
  15px/600 text inside a row. §7 of `docs/envoycoder-ui.md` says hierarchy should be by weight and colour
  rather than size, lest a list look like a ransom note — the law is about *per-row* scaling, and a row title
  set from the sheet's own content token, identically on every row, is not that; the doc now says so.
* **Three columns, and the controls column is a fixed track.** A chip that is right-aligned *inside its own
  row* does not line up down a page: its right edge is `row right − controls − gap`, so the controls have to be
  the same width on every row. `--settings-agent-actions` is 256px because that is the measured widest pair
  (`Check this machine` + `Add`); the first attempt used 176px, which stacked the two buttons on all 38
  catalogue rows, and the second 192px, which did the same — both are visible in the run's own
  `rowsWithWrappedButtons` and `squeezedButtons` counts, which is why the tool reports them.
* **The state chip is the last chip in its column.** Verdict chips (`No approvals`, `Temporary copy`) hang
  inward from it, so the *state* column owns one constant right edge and the eye can run down one word per row.

**What stayed off the row.** Nothing new went on it: the summaries, the published modes/models/thinking, the
recipe command lines, the versions, the install links and the last-checked time are all still behind `Details`,
the groups still carry their counts, and the catalogue still opens on demand. `AGENT_ROW_LINE_BUDGET` (80),
`AGENT_ROW_BUDGET` (140), `SETTING_DETAIL_BUDGET` (80) and `SETTING_NOTE_BUDGET` (180) are **unchanged**: the
layout bought the space, and the +24 characters on the whole page are the two `Installed — ` leads. The four
budgets are still enforced by `settings-density.test.tsx`, and the rendered page is now also checked against
`AGENT_ROW_BUDGET` from the browser (below).

#### 7.16.3 The mutations each new assertion fails on

Twelve mutations, applied one at a time to the real source, each run against **whole test files** (never a
`-t` filter), with the file restored byte-exact afterwards and the restore verified by comparison:

| # | mutation | test that goes red |
|---|---|---|
| M1 | `launchForProvider` spawns the name the user typed again, not `probe.binaryPath` | `launch-search-path.test.ts` → *reads as installed, not missing — and the launch runs exactly what the probe found* |
| M2 | `composeSearchPath` stops contributing the directory a shell answer named | `shell-binaries.test.ts` → *puts the answered program's directory first* |
| M3 | npm's `npx` cache is not searched at all | `shell-binaries.test.ts` → *is the difference between `dsh` reading as installed and reading as missing* |
| M4 | a hit in `~/.npm/_npx/` is no longer recognised as provisional | `shell-binaries.test.ts` → the same test (its `provisionalCacheOf` assertion) |
| M5 | the per-name answer is read as the last line rather than by marker | `shell-binaries.test.ts` → *reads the answers by marker…* |
| M6 | any string may be asked of the shell (the closed character set removed) | `shell-binaries.test.ts` → *refuses a name that is not a plain command name…* |
| M7 | a `needs-bridge` row shows the command alone, with no statement of what is present | `settings-agent-row.test.tsx` → *leads with what is present…* |
| M8 | every fix line leads with `Installed`, including a real absence | `settings-agent-row.test.tsx` → *never says `Installed` about an agent that is absent* |
| M9 | the row's name goes back to `--font-size-sm` / `--font-weight-medium` | `settings-agent-row.test.tsx` → *is set one full step larger…* |
| M10 | the controls column is sized by content (`max-content`) instead of the fixed track | `settings-row-anatomy.e2e.test.ts` → *lines up every column…* (measured spread ≠ 0) |
| M11 | the state chip is rendered first in its column instead of last | `settings-agent-row.test.tsx` → *gives every row of every list the same three columns…* |
| M12 | the row goes back to `--settings-agent-row: 60px` | `settings-row-anatomy.e2e.test.ts` → *gives every row the same height…* |

**The pixel assertions live in an E2E-gated file, and that is stated rather than hidden.**
`apps/desktop/test/settings-row-anatomy.e2e.test.ts` drives `scripts/measure-settings.mjs` as a child process
(one measurement implementation, not two that can disagree) and asserts the spreads, the rendered font size and
weight, the row height, the wrap/squeeze counts and the contrast on the real page. jsdom has no layout engine —
`getBoundingClientRect()` there is all zeros — so a DOM test claiming these numbers would be a green light for
something nobody looked at. The file is therefore **skipped** in the ordinary suite and prints why; M10 and M12
were run with `RUN_E2E=1`.

**What was measured, and what is still reasoned about.** Measured: every number in the two tables, taken from
the rendered DOM of a real window; the twelve mutations and the test each one reddens; the three agents'
resolution by four different mechanisms (the owner's shell, a clean-environment login shell, the daemon's own
environment, and the live daemon over its socket). Reasoned about rather than measured: that an 80px row with a
15px name *reads* better — the numbers say it is uniform, aligned and larger, and whether it is pleasant is the
owner's eyes on the PNGs, which is why `scripts/measure-settings.mjs` leaves them in its output directory. Also
reasoned about: that 256px is the right width for the controls track rather than a compromise with the name's
604px — the measurement pins what *fits*, and nothing here pins what looks balanced.


### 7.17 Not ready, and the way out: one verdict per row, and nothing to press

The owner's brief for this slice, verbatim: *"I don't want user to guess, to check if we can do that. And If the
agent cannot be used - 'Not Ready', we should clearly know what the problem is and guide user to resolve it if
he want to use this coding agent. That's the target."* Plus the vocabulary from the two messages before it: one
verdict per row — **Ready / Not ready** — caveats as *properties* rather than chips, and **"Not checked" must
essentially disappear**.

#### 7.17.1 What the page did, and why it was a chore

The Agents page opened with the nine agents we ship carrying one of five measured states, and the 38 catalogue
recipes carrying **no state at all**: `settings.agent.unchecked`, rendered *"Not checked yet"*, with a *Check
this machine* button on every row calling `coder.probeCatalogAgent` one entry at a time. So a user who wanted to
know whether the CLI they already had would work here had to press a button and read a chip, thirty-eight times,
and the page's opening state was thirty-eight admissions that it did not know.

The design behind that had one good reason and one mistake in front of it. The good reason: **starting** 14 of
those recipes would download 14 npm packages because somebody opened Settings, so nothing on that page may start
anything. The mistake: an *availability* answer does not need to start anything, and the two were not separated.
They are separated now.

#### 7.17.2 Every row resolves itself, and the resolution starts nothing

`coder.listCatalog` now serves each entry **with `CatalogEntry.availability`** — the same five states, from the
same `harnessAvailability` projection the nine shipped agents go through — resolved when the list is served. The
four questions it answers are all filesystem and environment reads: does the program resolve (on the search
path, in a tool cache, or as the user's own login shell resolves it — §7.16), does the **agent's own** program
resolve when the recipe is a bridge over one, is the recipe an `npx`/`uvx` shape (nothing to install at all),
and does the daemon have the variables the launch needs. No process, no package, no network, and **no cache**:
the rows are recomputed per read, which is what makes "I installed it while the window was open" true the next
time the list is read rather than ten minutes later.

`coder.probeCatalogAgent` is **deleted** — method, params, `CatalogProbeSchema`, the window's per-row probe
state, `rowStateOf`, `checkForces`, the `unchecked`/`checking`/`refused` states, the *Check* buttons and the six
message keys they used. Its measurement was exactly what the list now carries, so keeping it would have been two
answers to one question.

What that leaves on a row is **one chip, and it is one of exactly two verdicts**:

| the daemon measured | the row reads | the row's line | the disclosure leads with |
|---|---|---|---|
| `ready` | Ready | the tier, or *Installed — add it to use it* | (nothing to resolve) |
| `ready` and an `npx` recipe | **Ready** | *Nothing to install* | *Obtained: fetched from npm on the first run (pkg)* |
| `needs-bridge` | Not ready | *Installed — needs its connector* + the command | *"**Codex is installed.** EnvoyCoder needs its connector to drive it:"* then the exact command |
| `not-installed` | Not ready | the entry's first install step, verbatim | the steps **in the order to run them**, then the entry's link |
| `ready` + an unset variable the launch names | Not ready | *"NAME is not set"* | the name(s), and that the value can only come from the user |
| `unsupported` | Not ready | *EnvoyCoder cannot drive this agent yet* | **that this is our gap and there is nothing to install** |
| `unknown` | Not ready | *EnvoyCoder could not check this machine* | the same, plus the one action that re-measures |
| *(field absent — older daemon)* | Not ready | *EnvoyCoder is a build behind* | the same, in the words of a build skew |

Two of those rows are worth their own note.

**The `needs-bridge` line is the reported bug, fixed in the words rather than in the measurement.** The owner
wrote *"Some agents I have installed, but still show need to install or need adapter. Eg, codex, claudecode,
deepseek-harness."* For Codex and Claude Code the measurement was **right** — `codex-acp` and
`claude-agent-acp` really are not installed — and the *row* misled: a warn chip saying *Needs its adapter* above
a bare `npm install -g @agentclientprotocol/codex-acp`, so the only sentence on the row was an install command
for a package the user had never heard of, while the CLI they use every day sat present and unnamed. So the line
now leads with what is present. **And the fallback keeps that half**: when the command will not share the
80-character line (the `claude-agent-acp` command is 51 characters against a 31-character lead, so 83), the
command moves to the `title` and the disclosure and the phrase stays. The first draft had a shorter fallback —
*"Needs its connector"* — and it was the same defect wearing the other hat, because the half a user needs first
is *Installed*.

**`npx` is not a problem, and the row says so instead of warning about it.** The deleted `ready-npx` state
(`settings.agents.row.readyNpx`, *"Not downloaded yet"*) existed because `ready` for an `npx -y …` recipe is a
fact about `npx` rather than about the agent, and 14 rows reading *Ready* would claim a verification nobody
performed. That instinct was right and the remedy was wrong: it made a working row look broken, on fourteen
rows, for something that happens by itself on the first run. The honesty moved to the **property** —
`Obtained: fetched from npm on the first run (pkg)` — where it is a fact about how the program arrives rather
than a warning about something having gone wrong.

**`our-gap` and `nothing-you-can-do` are different kinds, in the layout and not only in the words.** The
mandate asks for that distinction explicitly, and it is `guide.kind`: `steps` and `environment` are things to
do, `app` is a restart, and `nothing` renders **no list, no command and no link at all**. An `unsupported`
catalogue entry carries an `installLink` (the vendor's page, which is true and useful for *reading*), and
rendering it under *"we cannot drive this yet"* is the failure the distinction exists to prevent:
`settings-agents-catalog.test.tsx` asserts the panel has no `<a>` and no `npm install` in that case.

#### 7.17.3 The deep facts: properties with a time, never a state to press for

Three facts about an agent cannot be known without **starting** it — whether it speaks ACP, what it publishes
(models, modes, thinking levels) and whether it wants a sign-in — so none of them is a verdict. They are
properties in the disclosure, and the property that makes them honest is **`Verified`**: a relative time in the
user's own language from `Intl.RelativeTimeFormat` (*4 minutes ago*, pluralised and localised in all seven)
followed by the absolute timestamp. When nothing has been observed the value says **why** — *"Not yet —
EnvoyCoder starts an agent to learn this, so it arrives when a task runs rather than when this page opens"* —
rather than leaving a blank that invites a hunt for a button.

They arrive three ways. Two already existed: `coder.probeSessionOptions` (the composer's *Ask again*) and a run,
which records what the session published. The third is this slice's addition and the one that removes the last
press: **`deep-warm.ts`**, a background pass at daemon boot that asks each agent that is `ready` what it
publishes. Its bounds are the design, and three of them are prohibitions:

* **one at a time**, in sequence, with a 3-second gap (`WARM_GAP_MS`) — two agents starting together is two
  processes and two handshakes' worth of CPU on a machine somebody is working on;
* **only `ready` rows** — nothing else has a program this build can start;
* **never a program that would be fetched first** — an `npx -y <pkg> …` recipe is *downloaded* on the first
  run, so a background pass over one of those is a pass that spends a user's network and disk because they
  opened an app. The flag is derived from the catalogue (`cataloguedInstall(entry).kind === "npx"`), not
  asserted, so an entry that changes shape is covered without anybody remembering;
* **not at all if the store already holds a recent observation** (`WARM_STALE_MS`, six hours) — the store
  survives a restart and `SessionProbe`'s in-memory cache does not, so this is what makes a second launch of the
  app start nothing;
* **off unless asked for**: `startCoderDaemon` defaults `warm` to false, `daemon/main.ts` passes `true`, and
  every test and `scripts/smoke.ts` leaves it out. `scripts/measure-settings.mjs` passes
  `ENVOYCODER_WARM_AGENTS=0`, because a *measurement* must not start the owner's own coding agents.

**The honest note about that pass, recorded here rather than discovered later.** It starts the user's installed
agents — that is what it is for, and it is bounded and cached rather than unbounded, but it is a real side
effect of launching the app and an owner may reasonably decide the trade is not worth it. The switch to turn it
off entirely is the `warmAgents()` call in `apps/desktop/src/daemon/main.ts`, and the facts it gathers are also
gathered by the two presses that existed before it, so switching it off degrades the page to *"Verified: not yet
— this arrives when a task runs"* rather than to a wrong answer. **It was not exercised against this machine's
real agents**: starting somebody's Codex and Claude Code sessions is not a thing a review should do, so every
assertion about it is against a recording fake (`deep-warm.test.ts`) and the production default is stated here
instead.

#### 7.17.4 Measured in a real window

`scripts/measure-settings.mjs` grew a **verdict census** (`verdicts`) and a **child-process count**
(`daemonChildren`) for exactly this slice. The census is taken from the rendered DOM of the real page in headless
Chrome over CDP, target matched by URL, against a daemon on an isolated home:

| | page as it opens | with the catalogue open |
|---|---|---|
| agent rows | 9 | **47** (9 shipped + 38 recipes) |
| rows carrying a verdict | **9** | **47** |
| rows with **no** chip | **0** | **0** |
| Ready / Not ready | 3 / 6 | 22 / 25 |
| any **third** word on a row | **none** | **none** |
| rows with more than one chip | **0** | **0** |
| buttons asking the user to find out a state | **none** | **none** |
| daemon child processes, before → after the page | **0 → 0** | **0 → 0** |
| visible characters / screens | 771 / 1.58 | 3,265 / 6.43 |
| row height | 80px (empty state 17px) | 80px |
| name / line font size and weight | 15px/600, 12px | 15px/600, 12px |
| name-left spread · name-vs-line gap | 0 · 0 | 0 · 0 |
| chip-right spread · controls-right spread | 0 · 0 | 0 · 0 |
| rows wrapping their controls | 0 | 0 |
| contrast below 4.5:1 | 0 | 0 |

**"Loading the page spawns no process" is measured, not asserted-by-intention.** `daemonChildren` counts
`pgrep -P <daemon pid>` **before the page makes its first request and again after it has settled**, so the
number is a difference rather than a snapshot: a daemon that had already started something would show it in
*both*, and a page that started something would show it in the second. Both are zero. The second instrument is
`catalog-rpc.test.ts`, which patches the **builtin `node:child_process` module object** — the one place an ESM
import and a CJS `require` meet — and requires zero calls across a full read of all 38 rows.

**The controls track was re-sized, and the old justification had outlived its control.** `--settings-agent-actions`
was 256px, "the measured widest pair the page renders — *Check this machine* + *Add*". This slice deleted the
*Check* button, so the track was holding 119px for nothing on all 47 rows, in the column the name needs most.
144px is bracketed rather than rounded: at **110px** 37 rows wrap their controls and at **60px** 38 do; at 144px
**none** does (`rowsWithWrappedButtons`), and the widest controls pair the page renders measures **115px**
(`actionsNaturalWidth`).

**Finding that number was itself a defect, and the E2E test found it rather than a reader.**
`actionsNaturalWidth` is "the sum of the buttons in the row's head", and this slice turned the **Not-ready chip
into a `<button>`** — which lives in the head. So the metric silently began counting the verdict chip as one of
the row's *controls*: it reported 191px against a 144px track, `settings-row-anatomy.e2e.test.ts` failed on
`natural ≤ track`, and the first reading of that failure is "the track is too narrow". It was not. The selector
is now `.settings__agent-actions button` and the number is 115. A metric that quietly starts measuring a
different column is worse than no metric, and the reason it was caught is that the assertion existed before the
change did.

`squeezedButtons` is still reported as **unproven**: forcing the track to 60px makes the wrapping detector fire
(38 rows) and leaves the squeeze detector at 0, so its zero is evidence about nothing. The bracket above is what
justifies the number.

#### 7.17.5 The mutations each new assertion fails on

Eight mutations, applied one at a time to the real source, each run against **whole test files** (never a
`-t` filter), with the file restored byte-exact afterwards and the restore verified by SHA-256:

| # | mutation | test that goes red |
|---|---|---|
| M1 | the catalogue stops resolving its rows (`availability: undefined`) | `settings-agents-catalog.test.tsx` → *gives every row one of the two verdicts, resolved before anything was pressed* |
| M2 | the prober shells out once per row | `catalog-rpc.test.ts` → *spawns no process to resolve all 38 rows* |
| M3 | the disclosure renders the facts **before** the guide | `settings-agent-verdict.test.tsx` → *leads a connector-missing row with what IS installed, before the command* |
| M4 | the `our-gap` guide offers the vendor's install link | `settings-agents-catalog.test.tsx` → *offers no install step for the entry whose gap is ours* |
| M5 | the `needs-bridge` line becomes the command alone | `settings-agent-row.test.tsx` → *leads with what is present, names the one missing piece, and still shows the command* |
| M6 | a caveat chip is rendered beside the verdict | `settings-agent-verdict.test.tsx` → *renders at most one chip per row, and it is one of the two verdicts* |
| M7 | the deleted `ready-npx` state comes back for `npx` recipes | `settings-agent-verdict.test.tsx` → *treats an npx recipe as Ready, and says it is fetched on the first run* |
| M8 | the deep facts lose the time they were observed | `settings-agent-verdict.test.tsx` → *carries the deep facts as properties with the time they were observed* |

**Two of those eight were found by the mutation run rather than by review, and both were faults in the tests.**

* **M2 passed on the first run.** The spawn counter was a `vi.mock("node:child_process", …)`, which replaces the
  *import* of the module and does not intercept a `require` — so a prober that shelled out via `require` walked
  past an assertion that reported a comfortable zero. The instrument now patches the properties of the builtin
  module object, where an ESM import and a `require` meet, and its liveness test goes through `require`
  deliberately: **an instrument that reports zero for every question asked of it is worse than no instrument**,
  and the only defence is a negative test of the instrument itself.
* **M3 passed on the first run.** The assertion meant to prove "the disclosure leads with the fix" checked that
  the lead paragraph sits before the command list — which is the guide's *internal* order and stays true when the
  whole guide is moved below the facts. It now asserts the panel's **first element child** is the guide, which is
  the property the mandate actually asks for and the one the mutation moves.

**What was measured, and what was reasoned about.** Measured: every number in §7.17.4, taken from the rendered
DOM of a real window and from the daemon's own child list; the eight mutations and the named test each one
reddens; the track bracket at 60/110/144px. Reasoned about rather than measured: that *"Installed — needs its
connector"* is the clearest available phrasing (the budget and the branch are measured; the wording is a
judgement); that six hours is the right bound for a stored observation (what it bounds — an agent's published
models and its sign-in state — is a fact that changes on an upgrade or an expiry, and nothing here measures how
often either happens on the owner's machine); and that the background pass is worth its side effect, which is
**the one thing in this slice an owner might reasonably reverse**, with the call site named above. Not verified
at all: any of it against a real agent's ACP surface — starting the owner's own sessions is not a review's to
do, so `acp-agent-support.test.ts` and the smoke gate remain the only evidence about real agents, and they are
unchanged by this slice.

**Pixels are the owner's to judge, and this slice's screenshots are in `/tmp`.** The model that wrote this could
not read the PNGs (`/tmp/envoycoder-agents/agents-0*.png`, `/tmp/envoycoder-catalog/agents-0*.png`): the geometry
above is numeric and therefore stronger than an eyeball for alignment, and *nothing* here claims to know whether
the page reads well, whether 144px looks balanced, or whether the two verdicts are the right words to put in
front of a person. Those are the owner's, and the pictures are there for them.

### 7.18 The fix, set apart: a block a reader lands on, and a Copy control

The owner's third report on this page, verbatim: *"On the Agents page, can we highlight the info on each agent like
"Claude Code is installed. EnvoyCoder needs its connector to drive it, and that is the one piece that is missing:
npm install -g @agentclientprotocol/claude-agent-acp". we want to highlight it and let user know how to resolve
it."*

The words were already right — §7.16 and §7.17 were about the wording, and the quoted sentence is the one those
slices wrote. What the owner is describing is what that sentence **looked like**: a lead paragraph in the same
`--text-dim` as the metadata, and the command in a `<code>` set to `--text-muted`, in a disclosure whose only
structure was a default-styled `<ol>`. The half a user *acts* on was dressed as the half they only read.

#### 7.18.1 What changed, and the two things that deliberately did not

| element | before | after |
|---|---|---|
| the way out (disclosure) | lead paragraph, then a bare `<ol>` | a `.settings__agent-fix` block: 1px frame, `--radius-lg` and a 3px `--status-warning` rule — the shape `.approval` already uses for *something needs doing* — on `--surface-1` |
| the command | `--text-muted`, no background | `--foreground` on the block, and on a row's line a tinted pill (`--surface-2`, `--radius-sm`) |
| the control | none | **Copy** per command, with a two-second *Copied*, a `role="status"` line for screen readers, and a `Copy failed` state that is never a tick |
| the steps | an unstyled `<ol>` | numbered by a CSS counter, because the lead reads *run these in the order they are listed* |

Two rules hold the change in place, and both are asserted:

* **The block is drawn exactly when there is something for the user to run** (`steps` and `environment` guides —
  installs and unset variables). `nothing` and `app` keep the plain shape, so the layout continues to carry §7.17's
  distinction between *there is a fix* and *there is nothing you can do*; a callout around our own gap would teach
  a user that our missing adapter is a job for them.
* **The tint costs no height.** It is an inline box with `padding: 0 <horizontal>`, and the reason is the previous
  report: vertical padding would grow exactly the rows that carry a command and leave the rest, which is the ragged
  list *"Align the texts"* was about. `settings-row-anatomy.e2e.test.ts` asserts one height for every row, so this
  is a rule a browser enforces rather than a comment.

Colour, for the record: amber and **not** the accent (the accent is this app's one action colour, and a callout
wearing it would compete with the Run button on the same screen) and **not** `--destructive` (destructive is a
colour that only appears inside a confirmation). The new rules use `--foreground`/`--foreground-muted` rather than
the neighbouring `--text`/`--text-dim`, because those two are defined once, dark, in `styles.css`'s own `:root` —
the light-palette gap `docs/envoycoder-ui.md` records — while the `--foreground` family is themed. They are the same
values in dark mode, so nothing moved there and the block is legible in light mode.

#### 7.18.2 What cannot be assumed, and is therefore asked

`navigator.clipboard` needs a **secure context**, and this app is loaded from three different ones (Vite's loopback
in development, Tauri's protocol in the bundle, WebKitGTK's on Linux). So `canCopyText()` is asked **before the
control is rendered**: a machine with neither the modern API nor `execCommand` gets the command and no button —
degraded and honest, rather than a control that cannot work. The write itself tries the modern API and falls back to
`execCommand("copy")` inside the click (a clipboard write after an `await` loses the gesture WebKit requires), and
returns a boolean: a caller that ignored it would render *Copied* over a command that is not on the clipboard, which
is the one outcome worth writing code to avoid.

**The escape hatch, named rather than discovered later:** if a future webview refuses both paths, the answer is
Tauri's `clipboard-manager` plugin — a Rust dependency plus a capability permission (`clipboard-manager:allow-write-text`),
the class of change this product has already paid for once (the missing `core:window:allow-start-dragging`).

#### 7.18.3 Measured in a real window

Taken by `scripts/measure-settings.mjs`, extended for this slice with `--open-aria "<prefix>"` (press every control
whose accessible name starts with the prefix) and a `fix` section in its report. The numbers below are from the
machine that has the owner's own states — Claude Code and Codex `needs-bridge`, six Not-ready rows carrying a fix,
measured on the real page in headless Chrome with all six disclosures open:

| measurement | value |
|---|---|
| fix blocks / commands / Copy controls | 6 / 6 / 6 — one per Not-ready row with a fix |
| Copy control height | **24px** (the design's control height, and `copySqueezed: 0`) |
| commands overflowing their block | **0** |
| worst contrast **inside** the block | **6.52:1** (the Copy label on the block's surface), floor 4.5:1 |
| page contrast below 4.5:1, panels open | **0** |
| name 15px/600, chip-right spread, actions-right spread | unchanged: **0px** spread, one height for all 48 rows |

The e2e leg that spends these numbers is honest about its own emptiness: on a machine with no Not-ready row carrying
a fix, there is nothing to measure, and it says so out loud instead of passing quietly.

**What was measured, and what was reasoned about.** Measured: every number in §7.18.3; the five mutations below, each
one reddening the named test. Reasoned about rather than measured: that *Copy* is a better label here than a
clipboard icon (the row is being read, not recognised); that one control per command is the right count for a
two-step fix; and that a `Copy failed` label is preferable to a silent no-op. **Not verified at all:** the clipboard
path inside the shipped WKWebView and WebView2 — the harness drives Chrome, `execCommand` is the documented path in
both shipping engines, and the fallback is exactly what a browser without the modern API takes. That is the one claim
in this slice a packaged build should confirm on each OS at M6.

#### 7.18.4 The mutations

| mutation | the test that reddens |
|---|---|
| the fix block is never drawn | 7 legs, including *draws the block exactly when there is something to do* and the two §7.17 guide legs |
| the row-face command loses its tint | *tints the command on a row whose fix is a command, and leaves a Ready row alone* |
| the copy label always claims success | *says the copy failed rather than showing a tick over a command that is not on the clipboard* |
| Copy is offered where it cannot work | *offers no Copy where copying cannot work, and still shows the command* |
| the tint adds vertical padding | *gives the tint no vertical padding, so every row keeps the height the page measured* |


### 7.19 Looking again, and finding out without a restart

The owner's question, verbatim: *"After I run `npm install -g @agentclientprotocol/codex-acp`, how we let
EnvoyCode know that without restarting or can we support run the commands in EnvoyCoder?"*

It is two questions, and the first one's answer was already half-built. Measured on the machine it was asked
about, with the bridges the owner had installed **minutes earlier** and a daemon that had been running since
before that install:

```console
$ node -e '…coder.listHarnesses over the socket…'
claudecode   ready  binary=/Users/shileipeng/.npm-global/bin/claude-agent-acp
codex        ready  binary=/Users/shileipeng/.npm-global/bin/codex-acp
```

So the daemon already knew: `coder.listHarnesses` resolves each row's state from filesystem and environment
reads **on the read**, with no cache in the path (§7.17.2) — a program that lands in a directory the daemon
already searches is real the next time anything asks. What was missing was *the asking*, and it was missing in
three places:

| the gap | why it existed | what closed it |
|---|---|---|
| nothing tells an open window that the machine is different | the daemon emits `harnesses` when *it* learns something; a user's terminal is not the daemon | `coder.recheckAgents` re-asks, then emits the same `harnesses` change the boot primes emit, so every window re-reads through its ordinary path |
| the login shell's `PATH` is asked once per process | one shell per daemon is the point — a `nvm` rc file is expensive | `refreshSearchPath()` on demand |
| the shell's `command -v` answer per name is asked **once, ever** | a name is remembered as asked; one resolving name is enough for the invocation to count as answered, so a miss stays a miss | `reaskShellBinaries()` — the same question, asked again |

The third row is the one that matters most, and it is the old `dsh` bug in a new place: a bridge that installs
somewhere only the user's own shell can resolve would read "not installed" for the rest of the daemon's life.
`packages/platform/test/shell-binaries.test.ts` drives it from both sides — the ordinary second ask returns the
cached miss, the re-ask finds the program — and the re-ask leg fails if `reaskShellBinaries` forgets nothing,
which was checked by reverting the deletion.

**A press, not a timer.** A periodic re-check spawns a login shell on a schedule nobody asked for; one on
window focus does it every time the user alt-tabs. Neither is the product answering a question that was asked.
A press is a question, and only the user knows that something changed outside the app — so the control sits
beside the count it invalidates, on the *On this machine* group, and it is gated on the daemon actually
serving the method (the build-skew rule the whole pane follows).

**The answer carries no list.** `coder.recheckAgents` returns `{ ok: true }` and the windows re-read through
`coder.listHarnesses` — the one projection. A list on this answer would be a second source of truth for the
same rows, free to disagree with the one the store already applies, and the *other* windows would still need
the event. So the method does exactly two things: re-ask, and emit.

#### 7.19.1 What the measurement says, and one instrument that had to be fixed first

`scripts/measure-settings.mjs`'s verdict census counted *any* button whose label matches `/check/i` as a
"button that asks the user to find out a state" — the field that exists to keep §7.17's defect (38 per-row
*Check* buttons, each leaving its row unknowing until pressed) from coming back. The new control matched it, and
the census is right that the words are the same and wrong about the class: a page-level *Check again* changes
no row from known to unknown. Reporting it as the defect metric would have been a false alarm; excluding label
matches wholesale would have let a real per-row regression hide behind the exception. So the census splits:
**`checkControls` counts matches inside a row** (must be zero, and is), and **`pageControls` names the ones
outside one** — currently `["Check again"]`, printed rather than silent.

Measured on the real page in headless Chrome, after pressing it:

| measurement | value |
|---|---|
| `checkControls` / `pageControls` | **0** / `["Check again"]` |
| rows with a verdict, of rows | **9 / 9** — unchanged by the new control |
| third verdict word, rows with >1 chip | `[]` / **0** |
| the press, over the live socket | `coder.recheckAgents` → `{ "ok": true }` in **235 ms**, **1** `harnesses` broadcast |
| the fix blocks, disclosures open | **4** blocks / 4 commands / 4 Copy at 24px, worst contrast 6.52:1 |
| row anatomy | unchanged: 0px chip-right spread, 0px actions-right spread, one height for all 48 rows |

The fix-block count fell from six to four between §7.18 and now, which is not a regression and is worth
recording: **Codex and Claude Code became Ready** because their bridges are installed, so two rows stopped
carrying an install to do. The page measuring that by itself is the property this whole slice is about.

**What was measured, and what was reasoned about.** Measured: every number above; the four mutations below, each
reddening the named leg. Reasoned about rather than measured: that a page-level gesture is the right shape
(rather than a per-row one, which is the chore §7.17 removed), and that the control belongs beside the count
rather than in a toolbar. **Not done at all:** running the fix command from the app — see §7.19.2.

#### 7.19.2 Running the commands in EnvoyCoder: the design, and why it is not in this slice

The owner's second question — *"can we support run the commands in EnvoyCoder?"* — has an answer that is
buildable and a shape that has to be right, and the difference is a new privilege for the daemon. Two designs
are honest, and they are not equivalent:

1. **Run the catalogue's own command.** The window would send an **id** (a harness id, a catalogue entry id, a
   provider id) and never a command line: the daemon looks the fix up in *our* catalogue and runs exactly what
   the row showed. That is the property the whole design rests on — a window cannot ask this product to run
   arbitrary shell, and the command the user read is the command that runs. It needs: the spawn (through the
   login shell, in the user's home, with a timeout and its process group killed on expiry — `spawnTreeOptions`
   and `buildKillPlan` already exist for this), bounded output capture, an outcome the row can render
   (`succeeded` / `failed` / `refused`, with the output tail), and a re-check afterwards so the row flips by
   itself. The cost is the privilege: this daemon would, for the first time, execute a package installation on
   the user's machine on a press.
2. **Prefer an `npx` delivery, so there is nothing to install.** Fourteen of the catalogue's recipes already
   work this way (`install.kind: "npx"`, §7.12), and both bridges in question are published on npm:
   `npx -y @agentclientprotocol/codex-acp` is a program the daemon can start with the argv path it *already*
   uses for every agent, so the whole feature needs **no new privilege at all** — no shell, no installer, no
   output to capture. The costs are honest and different: a first run downloads a package, and the version is
   whatever npm resolves unless the recipe pins one.

**What happened next.** The owner said *"follow your suggestions and make the UX better"*, so design **1** is
built (§7.20) and design **2** is now the only one left — and it has not become smaller by waiting. It is a
delivery-model change rather than a button: the catalogue would need to say that a bridge may be *fetched* rather
than installed, `launchForHarness` would need a per-agent delivery override, and the row would need to say which
of the two it is using. The decision that has to come first is the one this product has already faced twice in
this document: **does it switch silently, or does the user choose?** A silent switch downloads a package on the
first run of an agent whose program the user believed they had installed; a stored choice is a setting with a
schema, a prune rule and seven languages. That is a slice, not a paragraph, and it is the honest next one.

### 7.20 Running the fix: the row resolves, in the block that shows the command

The owner's second question — *"can we support run the commands in EnvoyCoder?"* — built as §7.19.2's design **1**,
which is the general half: it resolves **every** Not-ready row that carries a command, npm-published or not.

#### 7.20.1 The property, because everything else follows from it

**The window sends an id. It cannot send a command.** `coder.runFix` takes
`{ target: { kind: "harness" | "catalog" | "provider", id } }`, resolves that target through the *same probes that
drew the row* — `probe`, `probeProvider`, `probeCatalogEntry`, the three functions `coder.listHarnesses`,
`coder.listProviders` and `coder.listCatalog` answer with — and runs the commands out of that projection's
`availability.fix`. Two consequences, and they are the whole design:

* the command a user read is the command that runs, with no second derivation to drift;
* there is no field in the request that could carry a command line, so a window — or anything pretending to be
  one — cannot ask this daemon to execute arbitrary shell. The `fixes.test.ts` leg that fails when the window
  sends a command instead of a target is the assertion for that sentence.

Resolution happens **at the moment of the press**, not when the row was drawn. That is what makes the fourth
outcome possible: a user who installs the program in their own terminal and then presses the button gets
`nothing-to-do`, which is the honest answer, rather than an install run a second time.

#### 7.20.2 The four outcomes, and the three bounds

| outcome | when | what the block says |
|---|---|---|
| `succeeded` | every command exited 0 | *Done — this list updates by itself.* (the daemon re-checks, so the row flips) |
| `failed` | a command exited non-zero, or the deadline was reached | the exit code, then **the command's own output** |
| `nothing-to-do` | the projection carries no fix any more | *Nothing to install: this agent is ready now.* |
| `refused` | the id is in no list | *That agent is no longer in this list.* |

`reason` travels as a **key** (`timeout` | `unknown-target`), never as an English sentence: the daemon writes
English and this window may be in Japanese, which is the rule the error catalogue already follows one layer up.
`timeout` is deliberately not folded into `failed` — *"it was stopped"* and *"it failed"* are different things to
be told while waiting, and the window has a different sentence for each.

The bounds are the ones every part of this product has: a **five-minute deadline** for the whole sequence, the
process **group** killed on expiry (`spawnTreeOptions` + `processGroupTarget` — `npm install` spawns children, and
a leader-only kill would leave the work running), and a **64 KiB tail** of output, because a package manager's
transcript is the one thing here that can be genuinely enormous and the part a user needs is the end. `stdin` is
`/dev/null`, so a prompt cannot hold a window open: EOF is an answer.

#### 7.20.3 The UX, which is what the owner asked for

Every piece of it is inside the fix block §7.18 built, because that is where the command is:

* the press is a **button under the commands it will run**, labelled *Install*, with a `title` that says what it
  does *and what it does not do* — a login shell, the user's home folder, nothing else on the machine changed;
* **a failure lands under the command that produced it**, not in a notice strip at the top of the pane. The output
  is rendered in a bounded, scrollable `<pre>` — the only useful explanation of a package manager's failure is the
  package manager's own words, and hiding them behind "something went wrong" would send the user to a terminal to
  reproduce what the press just did;
* the outcome is a `role="status"` line, so it is announced and not merely drawn;
* **the press is drawn only where it can work**: not for a daemon that does not serve `coder.runFix` (the
  build-skew rule), and **not for an `environment` guide** — variables to set in the shell that started the daemon
  are not something a command can do, so that kind keeps the block and gets no button.

#### 7.20.4 What was measured, and the mutations

| measurement | value |
|---|---|
| the runner, end to end, on harmless commands | order preserved; a non-zero exit stops the sequence (**the next command does not run**); a 69 KiB transcript keeps its end and says it dropped the start; a hanging command is killed **with its group** (the child's delayed write never happens) |
| the resolver | the command the row carried is the command the shell is handed, verbatim, through `/bin/sh -lc`; `nothing-to-do` and `refused` **spawn nothing** |
| the window | the press sends `{ target: { kind: "harness", id: "codex" } }`; each of the four outcomes gets its sentence; the failure shows `npm ERR! …` |
| gates | 872 passed / 7 skipped, 12 Rust tests |

| mutation | the test that reddens |
|---|---|
| the window sends a command instead of a target | *sends this row's own target…* (and the store leg that asserts the params) |
| the press is drawn without the build-skew gate | *is not offered where the daemon is a build behind…* |
| the kill signals the leader only | *kills the whole group when a command hangs…* |
| a failure does not stop the sequence | *stops at the first failure…* |

**Two legs in this slice passed for the wrong reason before they were fixed, and both are worth recording.** The
build-skew leg searched a *closed* row's DOM for a button that only exists in an open disclosure — so it passed
whatever the code did, and the fix was to open the panel and assert the absence where the control would be. And one
assertion read `toContain(en[someKey] ?? "")`, which passes for a key that does not exist; it now asserts the
variable's name. A green test that looked at nothing is the failure mode this document keeps paying for.

**What was measured, and what was reasoned about.** Measured: everything in the table above, plus the live socket
(`coder.runFix` on a ready agent answers `nothing-to-do` and starts nothing). Reasoned about rather than measured:
that a five-minute deadline is right for a package install, and that a button labelled *Install* with the command
directly above it is enough consent — there is no modal, because the thing being consented to is on screen and a
dialog would hide it. **Not verified at all:** a real installation on a real machine. Every leg drives `/bin/sh`
scripts, and the one press that would run `npm install -g` on the owner's machine is the owner's to make —
which is the point of the control existing.

### 7.21 Fetched or installed: the user chooses, and the row says which

The last piece of *"resolve it without leaving the app"*, and the one §7.19.2 left open. The decision it needed
was **silent switch or stored choice**, and it is the stored choice — for the reason this product has refused every
other silent change to a user's machine: a silent `npx` fallback would **download a package** on the first run of an
agent whose program the user believed they had installed, and the row would go on saying what it said before.

#### 7.21.1 The shape

| piece | what it is |
|---|---|
| `AgentDelivery` | `{ kind: "installed" }` or `{ kind: "npx", package }` — a discriminated union, so a route with no package (a route nothing can take) is unrepresentable |
| `install.bridge.package` | the npm package, **structured**, beside the English hint that already named it: the launch argv comes from the catalogue, so a catalogue rename is not a migration of every user's stored choice |
| `agent-delivery.json` | the choice per agent, its own file, read through the same collection helper as the providers — one bad row costs that row, and an unreadable file is quarantined rather than emptied. `installed` is stored as *absence*, so the file cannot grow a line per agent a user ever considered |
| `fetchedBridgeRecipe` | the fetched route expressed as **a different program to start** (`binaries: ["npx"]`) rather than a branch inside the launch — so the probe, the two availability refusals, the `PATH` handed to the child and the argv all come from the machinery this repository already trusts. The agent's own binary stays on it, because the bridge drives it: an absent `codex` is still reported as an absent agent rather than as a package to download |
| `coder.setAgentDelivery` | the choice, with a refusal that is a **product rule** rather than a validation: an agent whose connector is not on npm cannot be fetched, and storing that would leave a row saying `Runs through npx` about a run that would fail |

The launch reads the choice at the one place a run is created (`runs.ts`, plus the probe and the sign-in flows),
through `deliveryOf` — injected, because `launchForHarness` is a pure function of its input by design.

#### 7.21.2 The command text stays, with the button beside it

The owner's requirement, once they saw the first cut: *"we should keep the command text, but also provide the exec
button. Not to remove the text. The user can install it by himself."*

They were right, and the failure was a consequence of the design rather than an oversight in it: a fetched delivery
makes the row **`Ready`**, so `availability.fix` is empty — *because there is nothing to fix* — and the block that
carries the install command is drawn only for a row that has one. Choosing the fetched route therefore **removed the
instructions for installing it**, which is exactly the user the feature was meant to serve.

So the *other* route's commands travel as their own field, `installFix`, present **exactly** when the delivery in
force is `npx` — a rule `HarnessSummarySchema` now enforces with a `superRefine`, on the same discipline as
`HarnessAvailabilitySchema`'s five: a claim that contradicts another claim is worse than a missing one, and an
`installFix` on an installed row would invite a user to reinstall a program the row just said was working. The
window renders it through the same `GuideBlock` as any other fix — the sentence, the command, **Copy**, and the
press — so the text and the button are one answer rather than two.

| who asserts what | where |
|---|---|
| the daemon computes and sends it (`needs-bridge` + `npx` → the catalogue's command; either state + `installed` → nothing) | `agent-delivery.test.ts`, with an **injected probe** so the state is arranged rather than hoped for — on this machine the bridges *are* installed, so a socket leg here would have been a test of the developer's machine |
| the rule cannot be contradicted | `packages/protocol/test/rpc.test.ts`, three parses: fetched-with-command ✅, fetched-without ❌, installed-with-command ❌ |
| the row shows the text, the Copy control and the Install press | `settings-agent-verdict.test.tsx` (*keeps the install command on a fetched row…*) |
| dropping it again fails a test | a mutation on the daemon line (`const installFix = undefined`) reddens *keeps the command, so a user can install it themselves* |

**Not demonstrated live**, and it is worth saying why: on this machine both bridges are installed, so the installed
route has nothing to install and `installFix` is legitimately absent — the live check in §7.21.3 below shows the
field's *absence* for the right reason rather than its presence. The rendering is asserted in jsdom, the projection
by the table test, and a machine missing its bridge is where a user meets it.

#### 7.21.3 The offer is made only where it can be kept

The owner's next report, and it was the pane's own law being broken rather than a matter of taste: *"For the 'Ready'
status agent, why they still have 'Run it through npx'?"*

The control was drawn for **every** row the daemon could write, because the only thing it checked was whether the
method existed. So it appeared — and could only fail — in two different ways at once:

* on a **Ready** row, where the installed route is working and there is no problem to route around;
* on **Envoy Harness**, **DeepSeek Harness** and **Cursor Agent**, whose adapters are in this repository — there is
  no package to fetch, and the press could only come back `connector-not-fetchable`, a refusal a user can do nothing
  with.

Two fixes, and the first is the kind that has to be a *fact on the wire* rather than a rule in the window: the
window cannot invent a package name, so `HarnessSummary.fetchable` now carries the one the catalogue knows
(present for the two bridges, absent for the seven built-ins), and `HarnessSummarySchema` refuses a fetched delivery
that does not name it. The second is the rule itself — the offer is made in exactly one case:

| the row | the control |
|---|---|
| delivery is `npx` | *Use the installed copy* — always valid: it forgets the choice |
| `needs-bridge` (the agent is here, the piece that drives it is not) **and** the connector is on npm | *Run it through npx* — the route that resolves this row without installing anything |
| Ready, `installed` | **nothing** — there is nothing to route around |
| `not-installed` (the agent itself is missing too) | **nothing** — fetching only the connector leaves the row exactly as unusable, and an offer that does not resolve the row is not an offer |
| no npm connector, or a daemon without the method | **nothing** |

Three legs in `settings-agent-verdict.test.tsx` (*is not drawn on a Ready row, or on one whose connector is not on
npm*; *… on a row that is missing the agent itself*; and the existing cannot-work leg), one in
`agent-delivery.test.ts` for the fact travelling, and one parse in `packages/protocol/test/rpc.test.ts` for the
fetched-delivery-without-a-package refusal. Gates: **885 passed / 7 skipped**, 12 Rust tests.

#### 7.21.4 Measured, live, on this machine

```console
$ …coder.hello            → advertises coder.setAgentDelivery, 32 methods
$ …coder.listHarnesses    → codex: ready binary=/Users/shileipeng/.npm-global/bin/codex-acp  delivery={"kind":"installed"}
$ setAgentDelivery(envoy-harness, npx) → refused: envoycoder.connector-not-fetchable
$ setAgentDelivery(codex, npx)         → {"harness":"codex","delivery":{"kind":"npx","package":"@agentclientprotocol/codex-acp"}}
$ …coder.listHarnesses    → codex: ready binary=/usr/local/bin/npx                          delivery={"kind":"npx",…}
$ setAgentDelivery(codex, installed)   → back to …/.npm-global/bin/codex-acp
```

The middle pair is the whole slice: **the binary the row reports moves from the installed bridge to `npx`**, which
is the daemon's own answer rather than a claim about it — the probe followed the delivery, and a machine with no npm
reports the route as missing rather than offering a download nothing can perform. The choice was set back to
`installed` before this was written, because a review does not leave preferences behind on the owner's machine.

| what the window does | the assertion |
|---|---|
| the row says *Runs through npx* and the fact says `Delivered by: npm, fetched on the first run` | *says which route is in force, on the line and as a property* |
| the press stores the choice in the direction the label promises | *offers the fetched route… and stores the choice* (asserts the args `["codex","npx"]`) |
| not drawn at all when the daemon does not serve the method | *is not drawn when the daemon does not serve the method* |
| the refusal is shown where the press was, in the user's language | the daemon sends `error.connectorNotFetchable` as a **key**; the leg reads it off the wire |

Mutations, each reddening the named leg: **the delivery ignored by the launch** (*launches `npx -y <package>`,
resolved through the search path*), and — from §7.20 — the target and the build-skew gate. Gates: **879 passed /
7 skipped**, 12 Rust tests.

**What was measured, and what was reasoned about.** Measured: every line of the console block above, taken from the
running daemon; the argv and the probe target in `launch-search-path.test.ts`; the refusal and the round trip in
`daemon-rpc.test.ts`; the row's three behaviours in jsdom. Reasoned about rather than measured: that `npx -y` is the
right form (a prompt inside a spawned ACP server is a process that never answers `initialize`, so the `-y` is not a
convenience); and that the choice belongs in the row's disclosure rather than in its action column, where it would
compete with Run. **Not verified:** a real fetched run — `npx -y @agentclientprotocol/codex-acp` downloading and
opening a session. That is one press on the owner's machine and one download, and it is theirs to make.

### 7.22 GitHub Copilot: "we cannot drive this" was our entry being stale, not the agent

The owner's question, looking at the row: *"How paseo support it?"* The row said *EnvoyCoder cannot drive this agent
yet*, and the honest answer turned out to be that Paseo drives it exactly the way we drive the two bridges.

#### 7.22.1 What the reference product does, and what our binary says

```ts
// ../paseo/packages/server/src/server/agent/providers/copilot-acp-agent.ts:87
defaultCommand: ["copilot", "--acp"]
```

Paseo has a first-class `CopilotACPAgentClient` (registered as the `copilot` provider) extending its shared
`ACPAgentClient` — the same base its Cursor and Trae clients use. It declares the three modes our entry already
listed (the URL-shaped ids are real: Copilot names its modes that way), plus two config options we do not (`allow_all`,
`agent`).

And the binary on this machine agrees, measured on 2026-09-15:

```console
$ copilot --version   → 1.0.83
$ copilot --help      → --acp   Start as Agent Client Protocol server
$ initialize {protocolVersion: 1} →
  { protocolVersion: 1, agentInfo: {name: "Copilot", version: "1.0.83"},
    agentCapabilities: {loadSession: true, sessionCapabilities: {close, list},
                        mcpCapabilities: {http, sse},
                        promptCapabilities: {image: true, embeddedContext: true}},
    authMethods: [{id: "copilot-login", name: "Log in with Copilot CLI"}] }
$ session/new         → -32000 "Authentication required"
```

So our entry was wrong in one field — `transport: "cli"` — and everything the owner saw followed from it: the
`unsupported` state, the sentence *"installing it again would change nothing"*, no install command, no press. The
entry's own `evidence` had already flagged it as *"unverified, and the least certain entry in the catalogue"*, which
is what made the fix a measurement rather than a guess.

#### 7.22.2 What changed, and what deliberately did not

| field | before | after |
|---|---|---|
| `transport` | `"cli"` | `"acp"` |
| argv | `["-p", prompt]` | `["--acp"]` — the prompt travels over the protocol, as it does for the bridges |
| `stream` | `"text"` | `"jsonl"` |
| `authMethodId` | — | `"copilot-login"`, from `initialize` |
| capabilities | mostly `false` | `resume`, `structuredTools`, `streaming`, `images` true; `approvals`, `agentMode`, `approvalPolicy` **false** |
| `modes` | three ids (Paseo's) | unchanged — now corroborated |
| `evidence` | "unverified" | the measurement above, with the refusal in it |

**`agentMode` stays `false`, and that is the interesting one.** The flag means *we can set a mode*, and
`drivable.test.ts` demands that a `true` here name the field the agent reads (`mode` or `modeId`) — which cannot be
defaulted, because one of the two contracts ignores a wrong field and answers success. Nobody has read that field on
this server: `session/new` refuses until the user signs in, so there has been no session to ask. The modes still
travel as facts; the picker stays off with a reason until somebody can read a session. `model` and `thinking` are
false for the same reason, and the entry says so rather than implying the server lacks them.

#### 7.22.3 The six tests that had to change, and why that is not weakening them

Every one of them used `copilot` as *the* example of an installed-but-undrivable agent, which is exactly the claim
that stopped being true:

* *drives the five …* → **six**, with `copilot` in the list;
* *keeps the four agents with no ACP surface …* → **three** (`opencode`, `pi`, `omp`);
* *makes every agent that claims a settable mode say which field carries it* → unchanged, and it is what forced
  `agentMode: false` above;
* *names the one agent that cannot open a session without authenticating* → **two** (`copilot`, `cursor`);
* *marks text-only agents as unstructured* → the sample loses `copilot` (it is a JSONL ACP server now) and keeps
  `opencode`/`pi`;
* *reports `unsupported` for an installed agent whose protocol this build cannot speak*, plus the three
  `opencode` refusals in `launch-search-path`, `providers` and `sign-in` → the subject moves to `opencode`.

Each keeps its assertion and changes its example, which is the only honest way to update a test whose subject
changed: the alternative — deleting the leg, or loosening it to `toContain` — would have hidden the next agent in the
same position.

#### 7.22.4 What the row says now, measured live

```console
copilot row:
  state       ready  /Users/shileipeng/.npm-global/bin/copilot
  modes       Agent, Plan, Allow all
  auth        {"state":"needs-signin","methodId":"copilot-login","observedAt":"2026-09-15T12:45:01Z"}
  capabilities {"resume":true,"cancel":true,"approvals":false,"structuredTools":true,
                "streaming":true,"images":true,"agentMode":false,"model":false,
                "thinking":false,"approvalPolicy":false}
```

**`ready` and `needs-signin` at once, and both are true**: the program is installed and speaks ACP, and it will not
open a session until the user has run `copilot login` — which the daemon discovered by trying, in the background
warm pass, and recorded with the method id it was told. That is the row a user should see: drivable, one step away,
and the step named.

**Not verified, and the entry says so:** a real session, a turn, a mode change, `session/cancel`, and the approval
posture. All of them need `copilot login` first, which is the owner's to do — and after it, the same measurement can
be finished in one pass and the entry's `agentMode`, `model` and `thinking` upgraded from what the session actually
says.

#### 7.22.5 The Sign in button cannot work for this agent, and that is measured

Copilot advertises one auth method, `copilot-login`, whose own `_meta` says what it wants:

```json
{ "id": "copilot-login", "name": "Log in with Copilot CLI",
  "description": "Run `copilot login` in the terminal",
  "_meta": { "terminal-auth": { "command": "…/copilot", "args": ["login"], "label": "Copilot Login" } } }
```

Driven over stdio, the method our `coder.signInAgent` sends answers:

```console
authenticate {methodId: "copilot-login"} → { code: -32000, message: "Authentication required" }
session/new                              → { code: -32000, message: "Authentication required" }
```

So **the press changes nothing** — the login happens in a terminal, out of band, and the agent says so once and then
says it again. That is the case this pane's oldest law names: a control that cannot be honoured is not drawn, and the
reason is on screen. The row therefore needs the *instruction* rather than the button:

1. the observation path (`auth-observation.ts`, which already reads the method list) records the terminal command the
   agent advertises — `_meta["terminal-auth"]` — so the fact travels with the auth state;
2. the row renders **`Run copilot login in your terminal`** instead of **Sign in** when that fact is present, in the
   user's language, with the command verbatim (a command is never translated);
3. `coder.signInAgent` keeps working for every agent that *does* answer `authenticate` (Cursor, the two bridges) —
   this is a third outcome, not a replacement.

**Built, and verified live.** The client picks the command out of `initialize`'s `_meta["terminal-auth"]`
(`AcpClient.authTerminalCommand`), the discovery travels on `ProbedAgent` so both flows that record an auth
observation carry it, `AgentAuthObservation.terminal` stores it and `HarnessAuth.terminal` serves it, and the row
renders the instruction **instead of** the button — the command verbatim, because a translated command is a command
that does not run. A sign-in that fails against such an agent records the command too, so the next window says what to
do rather than offering the press that just failed.

Measured on the running daemon, after forcing the probe the app's own *Ask again* performs:

```console
copilot auth: { "state": "needs-signin", "methodId": "copilot-login",
                "terminal": "…/copilot-darwin-arm64/copilot login" }
```

Two legs in `settings-agent-verdict.test.tsx` pin both directions — *shows the command instead of the button* and
*keeps the button for an agent whose sign-in really is a protocol step* (Cursor) — and the row rule was mutation-checked
(drawing the button anyway reddens the first). Gates before commit: 888 passed / 7 skipped, 12 Rust tests.

**One thing the live run caught that the tests had not:** `AgentAuthObservationSchema` was still strict about the new
field, so the first observation carrying it failed to parse and the row fell back to `unknown`. The unit legs were green
throughout, because nothing in them stored an observation through the schema — the daemon did, and the error appeared as
`unrecognized_keys: ["terminal"]` on the probe's own answer. It is fixed and the schema rule is the same one
`HarnessAuthSchema` carries: `terminal` belongs to `needs-signin` alone.


#### 7.22.6 The four facts that are still unmeasured, and exactly what unblocks them

The Copilot entry is honest about what nobody has seen, and this is the state it is in: **`agentMode`, `model`,
`thinking`, `approvals` and `approvalPolicy` are all `false`**, because all five are facts about a *session* and no
session has opened on this machine — `session/new` answers `Authentication required` until `copilot login` has run.
`drivable.test.ts` enforces the consequence: a `true` for `agentMode` must name the field the agent reads (`mode` or
`modeId`), and that cannot be defaulted, because guessing wrong is a silent no-op for one of the two contracts. So the
pickers are **off with a reason** rather than offering a model that never reaches the agent.

Measured live, today, on the running daemon:

```console
copilot: availability ready (…/bin/copilot) · auth needs-signin (copilot-login)
         terminal "…/@github/copilot-darwin-arm64/copilot login"
         capabilities resume ✓ cancel ✓ structuredTools ✓ streaming ✓ images ✓
                      approvals ✗ agentMode ✗ model ✗ thinking ✗ approvalPolicy ✗
         delivery installed · fetchable @github/copilot (covers the agent)
```

That is the whole of what can be said without a login, and the row says exactly it: **installed and drivable**, needs
its own sign-in, and — because its sign-in is a terminal command rather than a protocol step — the command itself
instead of a button that could not work (§7.22.5).

**What unblocks the rest**, in one command on this machine, and it is the owner's to run because it is a GitHub account
and not ours:

```console
copilot login
```

After that, forcing the app's own *Ask again* (`coder.probeSessionOptions`) fills in the five flags from the session the
agent then opens, and the entry's `evidence` gains the transcript. Until then the entry must not claim them, and does
not.


### 7.23 Fetching is not only for bridges

The owner's follow-up question, from the other end of §7.22: *"But if user didn't install copilot, what will happen?"*

The honest answer had a wrinkle in it. Without Copilot installed the row is `not-installed` and carries the install
command — so the text, the Copy control and the **Install** press are all there, and pressing it ends at
`copilot login` one step later. What was *missing* was the second route the two bridges have: **fetch instead of
install** was keyed on `install.bridge.package`, and Copilot has no bridge, because its own CLI *is* the ACP server.

So the fetch route was generalised — and measured first, because the claim is the measurement:

```console
$ npx -y @github/copilot --acp        # first run downloads the package into npm's cache
initialize → { protocolVersion: 1, agentInfo: {name: "Copilot", version: "1.0.83"},
               authMethods: [{id: "copilot-login", …}] }      ← answered in 1s
```

| piece | before | after |
|---|---|---|
| the package | `bridgePackage` (a bridge over somebody else's CLI) | `fetchablePackage` — the bridge, **or the agent's own npm package** (`install.package`, a new structured field) |
| what it resolves | always a connector | `fetchableCovers`: `connector` (the agent is here, the adapter is not) or `agent` (the program itself is what is missing) |
| the recipe | `fetchedBridgeRecipe` — always kept `agentBinaries` | `fetchedRecipe` — keeps the agent requirement **only** when fetching a bridge; an agent that is its own server is the thing being fetched, so requiring it as an `agentBinary` would report the route unusable in the one case it exists for |
| the argv | `["-y", bridgePackage]` | `["-y", package, ...theProgramsOwnArguments]` — `-y @github/copilot --acp`, and `-y @agentclientprotocol/codex-acp` for a bridge |
| the wire | `fetchable: {package}` | `fetchable: {package, covers}` — the window cannot tell which state the offer is valid in without it |

And the window's rule follows the same distinction, which is the part that keeps the press honest: a **connector**
offer is drawn on a `needs-bridge` row, an **agent** offer on an `absent` row, and neither in the other's state — a
press that downloads something and leaves the row exactly as it was is not an offer.

Measured live on this machine, which has Copilot installed (so the offer is correctly *not* shown — the row is Ready):

```console
copilot   ready  fetchable: @github/copilot (covers agent)
codex     ready  fetchable: @agentclientprotocol/codex-acp (covers connector)
opencode  not-installed  —            # not on npm under a name we know: install only
```

Four new legs: the catalogue's two shapes (`fetchableCovers` and `fetchedRecipe`'s dropped `agentBinaries`), the
window's *offers the route on an agent that is its own ACP server and is not installed*, and the protocol's
`covers` field — plus the updated expectations in the delivery table. Gates: **886 passed / 7 skipped**, 12 Rust
tests.

#### 7.23.1 The cold path, measured three times because the first two were not cold

The claim that matters to the owner's question is not "npx starts the server" but "npx starts it on a machine with
**nothing installed**", and the first two attempts did not establish it. Recorded because the mistake is exactly the
kind this document exists to catch:

| attempt | what it actually did | result |
|---|---|---|
| `npx -y @github/copilot --acp` | resolved the **global** install — a 1s answer, and no copy in npm's cache afterwards | the argv and the spec are right; **nothing** about a cold machine |
| `npx --ignore-existing -y …` | this npm **removed** that flag (`npx: the --ignore-existing argument has been removed`) — so the same global install answered again, in 1s | still not cold |
| empty `npm_config_prefix` **and** empty `npm_config_cache`, `~/.npm-global/bin` off `PATH` | npx had to fetch the package from the registry | **`initialize` answers in 14s**: `protocolVersion 1`, `agentInfo {Copilot 1.0.83}`, `authMethods [copilot-login]` |

So the offer is honest: a user with no Copilot gets a working ACP server from the fetch route, at the cost of that
first download. What "nothing installed" means here is precise — the package goes into npm's cache and runs from
there (the same place `dsh` was found in §7.16): nothing on `PATH`, nothing global — which is exactly the trade the
delivery control describes.

**What the three attempts also show is how easy this claim is to make wrongly.** A 1-second answer is evidence that
*something* answered, and this machine had `copilot` installed the whole time; the measurement only became about the
owner's question when the package could not be resolved locally. A leg that cannot fail — here, a cold read that was
not cold — is the failure mode §7.20.4 and §7.21.2 already record twice.

### 7.24 The light palette, which had never been measured

The bug had been recorded in prose for a while: `data-theme="light"` renders text at about **1.0:1**. The reason is
the shape of the two stylesheets — `design/tokens.css` switches its own families (`--surface-*`, `--foreground-*`,
`--border*`, `--status-*`) on `data-theme`, while `styles.css` defines a **second set of names** (`--bg`, `--bg-raised`,
`--text`, `--text-muted`, `--text-dim`, `--text-faint`, `--ok/--warn/--danger/--live`) **once, dark**. So the light
theme was half-applied from the day it was written: surfaces turned white, the text over them kept dark-mode greys, and
everything drawn with `--foreground` on a `--bg` background landed near 1:1.

#### 7.24.1 Instrument first, because the tool could not see it

`scripts/measure-settings.mjs` had a `contrast` list — chips, hints, commands, details, notes — and that list reported
**zero** failures in the light palette while the page had unreadable text in it. The elements with the worst contrast
are exactly the ones a dark-only token sheet takes out: titles, headings, names. So the tool gained two things:

* **`--theme light`** — sets `document.documentElement.dataset.theme` before the walk, which is the same line
  `main.tsx` sets at boot, and **asserts the page reports the palette back** rather than trusting the flag (a flag
  that silently did nothing would produce a dark measurement labelled light);
* **`contrastAll`** — every element on the page that draws text, worst-first, so a heading at 1.0:1 cannot hide
  behind a selector list.

The report now carries `theme` as well, because a measurement that does not say which palette it describes is one
that gets quoted as the other.

#### 7.24.2 The fix, and the values were computed rather than chosen

The light block in `styles.css` maps those aliases to the token sheet's light values — a second palette that disagrees
about what "muted" means is two palettes, and the token sheet is where the family's palette is derived from Paseo.

**One family is deliberately not verbatim.** The four status colours are *also chip text*: `.chip--live` and
`.chip--danger` draw `color: var(--live|--danger)` on a **16% tint of the same colour**, and the token sheet's light
`--live` (`#268ae0`) measures **3.04:1** on that tint. The measured values used instead:

| pair | ratio |
|---|---|
| pane title, light (`--foreground` on `--bg`) | **17.35:1** (was ~1.0 before the aliases were themed) |
| `--text-dim` on the page | 7.73:1 |
| `--text-faint` on the raised surface | 4.63:1 |
| `--live: #17527f` on its 16% tint | **6.91:1** (the token value: 3.04:1) |
| `--danger: #9d433b` on its 16% tint | 5.05:1 |

#### 7.24.3 What is asserted now

`settings-row-anatomy.e2e.test.ts` measures the page **twice**, and the second measurement is the light palette:

```console
· anatomy measured:  name 15px/600, chip right spread 0px, actions right spread 0px, 3229 visible chars, 7 rows above the fold of 48
· light palette measured: 41 text elements, worst 5.24:1, 735 visible chars
```

Its legs: `contrastAll.below45 === 0` and `contrast.below45 === 0` in **light**, plus the same column invariants dark
mode has (chip-right and action-right spread ≤ 1px, name ≥ 15px) — because a palette is not a cascade accident, and
"light works" has to mean the page still lines up. Dark is unchanged: same worst pair (5.11:1), same 735 visible
characters in both palettes, so the fix moved colour and nothing else.

**Not covered by this measurement, and named rather than implied:** the tool walks the **Settings** pages. The task
pane's own title — where the 1.0:1 report came from — is app chrome outside that walk, and the alias mapping is what
fixes it (the same `--text`/`--bg` pair, computed above at 17.35:1 rather than measured in the pane). Extending the
walk to the pane is a small piece of tooling, not a redesign, and it is the honest way to close that last sentence.

### 7.25 Every Add in the catalogue was refused — a button wired but never pressed

The owner pressed **Add** on the catalogue and the pane showed:

> *coder.addProvider was given a provider this build cannot store: a provider cannot be the catalogue entry it says
> it came from — the reference would resolve to the provider itself*

That is the store's own rule (`AgentProviderConfigSchema`, rule 4) — and the window's `addInputFor(entry)` sent
`id: entry.id` **and** `catalogEntryId: entry.id`, so the rule refused **every one of the 38 rows**, always.

#### 7.25.1 Why nothing caught it

* `catalog-rpc.test.ts` built the same input — through `cataloguedProviderInput(entry)`, which has the same
  self-reference — and then only **inspected its fields** (`expect(add.catalogEntryId).toBe("vtcode")`). A builder
  whose output is never *stored* is a builder nobody has run.
* The UI legs use fixtures, where the provider id and the reference are whatever the fixture says.
* So the button was green in tests and dead in the product, on all 38 rows, from the day the list was drawn.

#### 7.25.2 The fix, and the half it exposed

`addInputFor` now mints an id of its own — `${entry.id}-${entry.transport}` (`goose-acp`, `cline-npx`), readable and
distinct from the catalogue namespace in one step — while `catalogEntryId` keeps naming the recipe, which is what the
handler verifies against the entry's own `command`, `args`, `transport` and environment **names**.

That exposed the second half immediately: `addedProviderIds` returned `provider.id`, and the catalogue row's blocker
compares against **catalogue** ids. With a provider id of its own, the row would have kept offering *Add* for a
recipe already in the user's list — and let it be added again and again. So `AgentProviderSummary.catalogEntryId`
now travels (the reference the provider was stored with) and `addedProviderIds` keys on
`catalogEntryId ?? id` — the reference when there is one, the id for a program a user declared themselves.

#### 7.25.3 The leg that would have caught it, and the live press

`catalog-add.test.ts` stores **every** row in the catalogue, through `coder.addProvider` — the same handler a press
reaches — and asserts no refusals (listing any that occurred, with the row's id), then that every added provider is
seen as already-added by the catalogue's own blocker. It takes its rows from `coder.listCatalog` with an injected
probe, so it is testing the rows a user looks at rather than a second description of the catalogue.

Live on the running daemon, and removed again afterwards:

```console
add goose → {"id":"goose-acp","label":"goose","command":"goose","args":["acp"],"env":[],"transport":"acp","catalogEntryId":"goose"}
  accepted: {"id":"goose-acp","catalogEntryId":"goose"}
  providers now: goose-acp(goose)
  removed again: 0 provider(s) left
```

A mutation puts the old `id: entry.id` back and reddens **both** legs — the storage loop and the id-distinctness one.
Gates: **890 passed / 8 skipped**, 12 Rust tests.

**What this does not change:** the failure was rendered in the pane's notice strip, at the top, which the owner also
called ugly. That strip is where every `mutate` failure lands, and the reason it looked useless here is that the
failure should never have happened — the row's own inline notice (`setNotice` in `CatalogRows.tsx`) is where an Add
that genuinely cannot be stored will say so, and it is a separate question whether the app-wide strip should keep
carrying action failures at all.

### 7.26 The agent pickers said "(needs installing)" about agents that are ready

The owner, on *Settings → New tasks → "The agent new tasks start with"*:

> *why the All settings - New tasks - The agent new tasks start with, the dropdown has some agents, but the status is
> wrong. we should make this the same with Agents. Maybe put the ready status agent? How do you think?*

Both pickers appended *"(needs installing)"* to an option whenever `harness.tier === "catalogued"` — a fact about
**where the recipe came from** rendered as a fact about **the user's machine**. The two are unrelated: a catalogued
agent is one whose program the user installs from its vendor, which is exactly the case in which the program is
usually *already* there. On this machine, five of the six offered rows read *"(needs installing)"* while the Agents
page called every one of them **Ready**.

**The real window, after the fix** — `scripts/measure-settings.mjs --select` (a flag added for this report: an
option's text is the one thing on this page that no pixel number and no verdict census can see):

```console
$ node scripts/measure-settings.mjs --section tasks --select "The agent new tasks start with"
walk: Settings → tasks
  Settings: ok
  New tasks: ok
select "The agent new tasks start with": value="envoy-harness" selectedIndex=0
  → "Envoy Harness"  (value "envoy-harness")
    "DeepSeek Harness"  (value "deepseek-harness")
    "Claude Code"  (value "claudecode")
    "Codex"  (value "codex")
    "GitHub Copilot"  (value "copilot")
    "Cursor Agent"  (value "cursor")
```

Every catalogued agent that is ready reads bare — `(needs installing)` is gone from all five — and the option the
row *selects* is a name, with `selectedIndex=0` matching `value="envoy-harness"` rather than the blank control
§7.26.3 is about. The same six rows, from the daemon's own measurements through the real rule — a **one-off**
script over a real socket (`coder.listHarnesses` against the running daemon), importing `offeredAgents` and
`verdictSuffix` from source rather than restating them; it is not kept, because the permanent instruments are
`--select` above and the mutations below:

```console
$ node … # `coder.listHarnesses` from the running daemon, through the real `offeredAgents` / `verdictSuffix`
  envoy-harness     built-in    ready          Envoy Harness
  deepseek-harness  catalogued  ready          DeepSeek Harness
  claudecode        catalogued  ready          Claude Code
  codex             catalogued  ready          Codex
  copilot           catalogued  ready          GitHub Copilot
  cursor            catalogued  ready          Cursor Agent
  opencode          catalogued  not-installed  OpenCode
  pi                catalogued  not-installed  Pi
  omp               catalogued  not-installed  OMP (Oh My Pi)

the New-tasks picker offers 6 of them, and renders:
  "Envoy Harness"
  "DeepSeek Harness"
  "Claude Code"
  "Codex"
  "GitHub Copilot"
  "Cursor Agent"

dropped (established absent, so the list is not a promise): opencode, pi, omp

catalogued agents that are ready and now read bare (the reported bug): deepseek-harness, claudecode, codex, copilot, cursor
  any of them carrying "Not ready"? false
```

Two screens of one product contradicting each other about one agent is worse than either being silent: a user who
reads *"(needs installing)"* next to Codex, and *Ready* for the same Codex one page away, has learned not to
believe this product's words about their own machine.

#### 7.26.1 The fix: the suffix is the verdict, and its words come from one table

`verdictSuffix(availability, t)` (`agent-verdict.ts`) runs the **same** `rowVerdict` the Agents page's rows run and
takes its words from the same `VERDICT_CHIP` table, so the two surfaces cannot drift — there is one table of two
words. A ready agent gets **no suffix at all**: a picker that labels every row is a picker whose labels stop being
read, and *"Ready"* beside six options is noise a user learns to skip. Every other state gets ` — Not ready`, which
is the honest answer in a picker even for `unknown`: *"we have not looked"* is not a reason to promise a run.

#### 7.26.2 The owner's suggestion, considered and declined: the list is labelled, not shortened

The owner asked *"Maybe put the ready status agent?"* — offer only the Ready ones. That is the one thing this
picker may not do, and the reason is already written down in `offeredAgents` (§5.8, §7.9): the picker drops exactly
the state that asserts a program is **absent**, and an unexplained short list is how a user concludes this product
does not support their agent. `opencode`, `pi` and `omp` are dropped here because a probe established they are not
on this machine — that is a measurement, and it can change on the next scan. `copilot` and `cursor` stay, ready or
not, because hiding an agent a user installed is the failure the *Agents* page exists to answer, and the note under
the select points at it. So the list keeps its rows and each row now says what it is.

#### 7.26.3 The third defect this exposed: a stored value with no option is a blank control

The New-tasks picker rendered its fallback option only when the offered list was **entirely** empty. Its value is
`settings.defaults.harness`, which `offeredAgents` drops when that agent is `not-installed` — and a `<select>`
whose `value` matches no `<option>` is not "empty", it is **blank**: the browser clears the selection, so the row
that is supposed to say which agent a new task starts on says nothing, while the daemon still holds the value. The
condition is now `offeredAgents`-shaped in both pickers (`available.some(…id === stored) ? null : <option …>`), and
that option carries the agent's **label** rather than the raw id (`claudecode`) it used to print, plus the same
measured suffix — the reason it is missing from the list is a fact a user needs, not a detail.

#### 7.26.4 What is asserted, and the mutations

`settings-agent-picker.test.tsx` renders both pages and reads the option text a user reads, with the two words
taken from the catalogue rather than spelled in the file:

1. a ready **catalogued** agent reads bare — the reported bug, mutated back to the tier-derived suffix it fails on;
2. `needs-bridge` and `unknown` read `— Not ready` **and are still offered** — deleting the suffix reddens both,
   and so does filtering the picker down to Ready agents (the owner's suggestion, as a mutation);
3. an agent established absent is still dropped — unchanged, asserted beside it so the two rules cannot be
   confused later;
4. the stored agent the measurement dropped stays on screen **with `select.value` equal to the stored id** —
   restoring the old fallback condition, or removing the suffix from that option, reddens it;
5. the project picker says the same thing about the same measurements, which is what fails if either picker grows
   a suffix of its own.

Mutation-tested the whole way, one leg at a time: the tier-derived suffix (3 legs red), no suffix at all (2), no
verdict in the project picker (1), Ready-only filtering (3), the old fallback condition (1), a bare fallback
option (2), a fixed word instead of the catalogue's (5), and `unknown` rendered as ready (1). The
`settings.needsInstalling` key is **deleted** from all seven catalogues (`i18n:gap` 458/458) — the retired key is
how the old defect would come back. Gates: **897 passed / 8 skipped**, 12 Rust tests.

### 7.27 A failure is read where the press was

The owner, after pressing **Add** in the catalogue:

> *"After clicking 'Add', it will show the top bar which is ugly and usless, show like 'coder.addProvider was given
> a provider this build cannot store: …'"*

The sentence was right and the place was wrong, and there were **two** places. `CoderStore.mutate` stored every
write's refusal in `state.error` — which the shell renders in a bar above every surface — *and* returned it to the
caller, so a press that already answered on its own row answered twice. The copy nobody could use was the one in
the bar: it names no control, it moves the window, and it has to be dismissed before the user can get on with what
they were doing.

#### 7.27.1 Three sinks existed and two were never wired

Reading the components for this fix turned up the reason the strip had become the default. `TaskPane` had a
`notice` prop documented as *"Shown under the composer when a send was refused"* and **nothing in the source passed
it** (`notice={` appeared nowhere). `CommandCenter` had a `status` prop documented as *"Shown at the foot while an
action is in flight, and on failure"* — also never passed. Both were drawn, styled, and dead, so every failure they
were meant to carry fell through to the bar.

#### 7.27.2 The rule, and the two halves of it

* **A write raises nothing.** `mutate` returns the refusal and the caller renders it where the press was. Four
  surfaces, four sinks: a **settings row** renders the answer its own `write` was handed (the child of `SettingRow`
  is a function of the row's `write`, so a control that writes *cannot* be rendered without a sink); the **rail**
  renders it under the row it came from (`failure={{ rowId, notice }}`); the **composer** keeps it under itself,
  keyed by the task so one task's failure cannot follow the user into another's chat; the **palette** keeps itself
  open with the sentence in its own status line — a command whose `run` answers with a refusal leaves the field
  holding what was typed, so a mistyped path can be corrected and pressed again.
* **A read still does.** `state.error` keeps what the *window* could not do: a list it could not read, a daemon
  this build cannot talk to, the build-skew advice. Those are not about a control and have no row to live in.

Nothing may go silent because of this, which is why the store's write methods return `T | Refusal`, why
`asFailure` is the single place the discriminator is spent, and why `failure-placement.test.tsx` walks each surface
and asserts **both** halves at once: the daemon's sentence is on screen exactly **once** (`timesOnScreen()`), and
the window's bar is absent for it.

#### 7.27.3 What each surface got, and the two the shell still routes

The shell holds two of them, because it is what owns the press while another component draws the result: a rail
row's callback lives in `CoderApp` while the row is drawn by `CoderSidebar`, and the composer's write callbacks
live there while the line under the composer is `TaskPane`'s. Both are keyed — by row id and by task id — and both
have their own test: a removal that failed says so under the row it was asked for, and a send that failed does not
appear in a chat the user has since opened.

Two new styles, both the refusal's own: `.setting__failure` (a left rule under the control, so it reads as
attached to the control rather than as another sentence about the setting) and `.sidebar__failure`. Neither uses
the destructive colour — nothing is being destroyed, a change simply did not land, and `--danger` stays where
design law 3 puts it (inside a confirmation).

#### 7.27.4 Measured in a real window, before and after

`scripts/measure-settings.mjs` grew two things for this: `--open` may now be **repeated** (a control that lives
inside something else needs two presses: the titlebar's *Command Center*, then a row inside it), and when the
palette is left open the tool prints **its status line**. *Pair a phone* is the handy command for this — it is a
press the product refuses on purpose (*"arrives with the mobile milestone"*), so it needs no fault injected:

```console
$ node scripts/measure-settings.mjs --section general --open "Command Center" --open "Pair a phone"
  Command Center: ok
  Pair a phone: ok
  palette: still open; status "Pairing a phone arrives with the mobile milestone: the daemon has no session store yet, so it refuses remote clients on purpose."
```

The same run against the **old** behaviour — `mutate` raising the refusal and the palette closing on it — prints no
`palette:` line at all: the dialog was gone and the sentence had gone up to the bar, which is exactly what the
owner described.

#### 7.27.5 The mutations

Seven, one per leg, each reddening the leg it belongs to and no other: the store raising the refusal app-wide
again (2 store legs), the rail rendering no row failure, the composer's line never passed, the palette closing on
a refusal, the settings row rendering no failure, the pane's failure not keyed by task, and the banner no longer
rendering a read failure.

Two existing store legs had encoded the old rule — `expect(s.getSnapshot().error).toBeTruthy()` after a refused
write — and were changed rather than deleted: the assertion is now `toBeUndefined()`, with the reason written where
the old one stood. Gates: **903 passed / 8 skipped**, 12 Rust tests.

### 7.28 The window outside Settings had never been measured

The light palette was added in §7.24 and judged by a scan that took `.settings` as its root: `contrastAll` walked
`document.querySelector(".settings")`, and the walk itself always pressed *Settings* and then a section. So the
rail, the title bar, the status bar, the palette and the composer had **never been measured in either palette** —
the newest thing in the stylesheet was signed off on one screen out of five.

Two changes made the rest measurable:

* **`--section work`** — do not walk into Settings at all. The measure root falls back to the work surface, and
  `--seed` writes a project and a task into the *isolated* home before the daemon starts (the same two files the
  daemon's own store keeps), so the rail has a row and `--open "<task title>"` can open it and put the composer on
  screen. Nothing about the app is stubbed: the daemon reads that home exactly as it reads a real one.
* **`contrastAll` now walks `document.body`**, and every entry carries the surface it was found in
  (`palette`/`titlebar`/`rail`/`statusbar`/`composer`/`settings`/`other`), the two colours, and a `surfaces` list
  of what was on screen. A zero has to be read for what it covers, and the e2e leg asserts the surfaces rather than
  trusting the number.

#### 7.28.1 The three defects it found, all of them outside Settings

| where | measured | why nobody saw it |
|---|---|---|
| the status bar's detail line, dark | **3.48:1** | the scan was rooted at the settings pane; the rail's own badge and the "TASKS" caption were the same colour and the same 3.48 |
| the composer's folder pill, light | **2.33:1** | the composer only exists with a task open, which the walk could not reach |
| every palette row, light | **1.04:1** | white on near-white — and it needed the palette *open* during the scan |

The first two are one token: `--text-faint` (the sheet's own) and `--foreground-extra-muted` (the token sheet's)
were `#717574` in dark and `#a1a1aa` in light, which are below the family's 4.5:1 floor on **every** fill they are
drawn on (dark: 3.72 on `--bg`, 3.48 on `--bg-raised`, 3.10 on `--bg-hover`; light: 2.56 on white, 2.33 on
`--surface-2`). They are now `#909593` and `#6b6b73`, measured (4.76–5.71 and 4.81–5.28), and still a step below
the muted foreground so the three-band hierarchy survived. The selected row's subtitle takes `--text` on
`--bg-active`, the same rule the pane's current nav item already recorded — on a mid-grey fill even `--text-muted`
reads 3.83:1.

The third is a different mechanism, and it is the interesting one: **form controls do not inherit `color`**. The
platform gives them its own (`buttontext`, `fieldtext`), chosen from the *user agent's* colour scheme rather than
from this sheet — and `:root { color-scheme: light dark }` means "pick by the desktop's preference" while this
app's palette comes from `data-theme`. The palette's rows are `<button class="palette__item">` and set no `color`
at all, so on this machine (a dark desktop) they drew white text — correct in the dark palette, and 1.04:1 in the
light one. Fixed twice over, and each fix alone clears the measurement: `button, input, select, textarea { color:
inherit }` makes those controls obey the sheet, and `:root[data-theme="…"] { color-scheme: … }` makes the
platform's own widgets — scrollbars, `<select>` popups, carets — follow the app's palette too.

#### 7.28.2 A fourth defect, in the instrument itself

`npm run ui:audit` **could not start**. `scripts/audit-ui.mjs` had two backticks in a comment inside an
`evaluate(\`…\`)` template, which terminates the template, so the file failed to parse before its first
measurement — committed, and unnoticed because nothing in this repository parses `scripts/*.mjs`: they are outside
every `tsconfig`, no test imports them, and the failure looks like "that tool is unreliable" rather than "that tool
cannot run". The same mistake was made twice more in `measure-settings.mjs` during this slice.

So there is a gate now: **`scripts/check-scripts.mjs`** runs `node --check` on every `.mjs` under `scripts/` and
fails the build listing the file and the parse error. It is the cheapest gate here and it guards the instruments
every other claim in this document rests on. `audit-ui.mjs` is repaired, and it also carried the third instance of
the click-the-container trap (`--click "<task title>"` clicked the `.task-row` wrapper, which selects nothing) —
the same trap that made this slice's first work-surface walk measure the empty pane and report a cheerful zero.

**What the repaired tool still has not measured.** `audit-ui.mjs` is the instrument for `docs/design-tokens.md`'s
claims about the *chat* surface — the 820px content measure, its centring, the content type size and leading, the
composer card's radius — and repairing it does not verify them: the walk needs a window with a task open, and it
runs against a *given* URL rather than booting its own daemon and Vite the way `measure-settings.mjs` does. Pointed
at the running window it walks the chrome correctly (`--clicks "Settings|Agents"` lands on the Agents page) and
reports `missing` for every chat element, because the pane on screen is the empty state. Recorded as a limit rather
than implied by the tool existing again; the contrast half of the chat surface *is* covered, by the work-surface
scan above.

#### 7.28.3 The mutations

Three, each reddening the leg it belongs to: `--text-faint` back to `#717574` (8 elements at 3.48:1 in the dark
run), `--foreground-extra-muted` back to `#a1a1aa` (the composer's pill at 2.33:1 in the light run), and both
form-control fixes removed (6 palette rows at 1.04:1). The e2e leg names the surfaces it looked at, so a walk that
failed to open the task — a real failure mode, and the first thing this leg did — cannot pass by measuring an empty
pane. Gates: **903 passed / 10 skipped**, 12 Rust tests, and the new `scripts:check` (the two extra skips are this
leg, which needs `RUN_E2E=1` and a browser like every other pixel measurement here).

### 7.29 Copying a command: the webview's gesture rules, and the one path that has none

`Copy` beside an install command is a small control with three ways to work and four ways to lie about it, so the
research is written down rather than remembered.

| path | what it needs | where it fails |
|---|---|---|
| `navigator.clipboard.writeText` | a **live user gesture** | WebKit rejects with `NotAllowedError` if anything was awaited first; WebKitGTK additionally needs clipboard access enabled in the webview, which this shell does not do |
| the shell's `copy_text` (`invoke` → the platform's own tool) | nothing | an older shell without the command, or a capability that does not grant it |
| `document.execCommand("copy")` | a live gesture | deprecated, and **off by default under WebKitGTK** |

The secure-context hypothesis this started from was **wrong**, and that matters because it would have been the
expensive fix: the packaged origins are all secure (`tauri://localhost` on macOS and Linux, `http://tauri.localhost`
on Windows — Tauri's custom protocol exists *to* provide a secure context), so `navigator.clipboard` is defined even
in the bundle. What differs is *when* the write happens relative to the gesture, and what each platform's clipboard
policy allows — and on a WebKitGTK window whose webview has clipboard access off, **no webview path works at all**,
which is the case this fixes.

#### 7.29.1 The order, and why it is that order

1. **The webview's API first, synchronously** — the fast path, and only reliable before anything is awaited, so it
   cannot be a fallback.
2. **The shell second** — `copy_text` is an `invoke`, which is *not* gated on transient activation, so it catches
   exactly what the first path drops: a refused permission, and every WebKitGTK build where `navigator.clipboard` is
   missing (before 2.40) or its `javascriptCanAccessClipboard` is off.
3. **`execCommand` last** — deprecated, may be disabled, attempted rather than trusted. Its answer is the function's.

Each attempt is a real promise and the first that lands wins, so a machine with two working paths makes one write.
The control reads the boolean honestly: `false` renders *Could not copy*, and `canCopyText()` is asked **before** the
button is drawn — which is why the shell being able to write also means the button *exists* on a Linux window whose
webview cannot.

#### 7.29.2 Why a command rather than `tauri-plugin-clipboard-manager`

The plugin is the supported route, and it was written first — registered, permission named
(`clipboard-manager:allow-write-text`), the lot. **It could not be built on the machine this was developed on:**
`cargo` cannot reach the registry through this environment's network. The fetch sits at *Updating crates.io index*
indefinitely (measured: two established sockets to the CDN, no bytes written to the cache in fifteen minutes, while
`curl` fetches the same index file and the same `.crate` in seconds), and the consequence was worse than a slow
build: the owner's own `tauri dev` re-ran its build on the edited `Cargo.toml`, blocked on the package cache lock my
fetch was holding, and the app window went away while both waited.

A dependency that cannot be fetched is worse than the tool already in the box, so the clipboard goes through the
platform's own binary — which is what `pick_folder` has always done for its dialogs, and what `Cargo.toml` explains
for its refusals. `copy_text`:

* **macOS** — `pbcopy`, which ships with the system;
* **Windows** — `Set-Clipboard` through PowerShell, **reading stdin** so no text ever reaches a command line (a
  command with `'`, `"` and `&` in it, quoted into a shell, is how a copy becomes an injection), with `clip.exe` as
  the fallback for a machine without PowerShell — second because it writes in the OEM code page;
* **Linux** — `wl-copy`, then `xclip -selection clipboard`, then `xsel --clipboard --input`, each named in the error
  when none is installed, exactly as `pick_folder` names zenity and kdialog.

Going back to the plugin later is a `Cargo.toml` line, a capability entry and one constant in `clipboard.ts`; that is
recorded here so the next reader does not have to rediscover why the Rust side shells out for a clipboard.

#### 7.29.3 The three files that have to agree, because the failure is silent

A Tauri v2 command is not callable until a capability grants it — `invoke_handler!` alone leaves the window's promise
rejected — so the command in `main.rs` (defined **and** registered), `permissions/copy-text.toml` (which names it)
and `capabilities/default.json` (which grants that permission) all have to be there. If one is missing, the build
succeeds, the app starts, and the write rejects at runtime with a message the Copy control renders as *Could not
copy*, which is indistinguishable from a machine with no clipboard.

`apps/desktop/test/clipboard-paths.test.ts` pins all three, anchored to the start of a line rather than by
substring. **Reading is not offered at all**: the only clipboard command is the writer, and `copy_text` never looks at
what is already on the clipboard.

#### 7.29.4 What is verified, and what is not

**A real round trip, on this machine.** `a_hostile_command_lands_on_the_clipboard_verbatim` calls the command with a
string containing quotes, `&&`, `$HOME`, a semicolon and a newline, reads it back with `pbpaste`, and asserts byte
equality — then puts the developer's own clipboard back. That is the instrument that can tell "the Copy control
works" from "the promise resolved": the gesture rule this exists for is a runtime behaviour no type can express. A
second Rust test asserts a missing tool is reported *by name*. **14 Rust tests**, up from 12.

**Six jsdom legs**, each mutation-checked: the shell tried first (the fast path loses the gesture), the shell path
removed, `canCopyText` ignoring the shell, the legacy path dropped, the permission naming a command that does not
exist, the capability not granting it, and the command defined under a name other than the one registered.

**Not verified by me: a press in a packaged WKWebView.** There is no CDP channel into a Tauri window, so the
instrument for *that* is the owner's own click on a Copy control in the shipped window. Recorded as a limit rather
than implied by a passing suite.

### 7.30 The composer said the same thing four times, above the field

The owner, with a turn running:

> *"There are too many texts like 'The agent is still working in /Users/…/EnvoyMesh. A new folder applies to the next
> run.' / 'The agent keeps the mode it started with. Your choice applies to the next run.' / 'The agent keeps the
> model it started on. Your choice applies to the next run.' / 'Envoy Harness does not offer a thinking level.' These
> texts are usless, but make the chats inputting messy."*

Four paragraphs, and three of them were **one fact told once per control** — that a choice made while a turn is
running applies to the *next* run. The reasoning that produced them is in `en.ts`'s own comment (*"a user who changed
only the folder should not be told about a mode they did not touch"*), but the sentences were never shown on
interaction: they appeared whenever a turn was **running**, so all three arrived at once, directly above the field
the user was typing into. The fourth was a reason for a control the user had not reached for.

Measured before and after, in a real window, with a counter added to `measure-settings.mjs` for exactly this question
(`composer.notes` — a character count for the whole pane cannot see paragraphs appearing above the field):

```console
before: composer notes 2 | chars 126
   - This window has no folder chooser, so this task's folder cannot be changed here.
   - Envoy Harness does not offer a thinking level.
after:  composer notes 0 | chars 0
```

(Two rather than the owner's four, because the seeded page has no live run; the mechanism is the same, and the
composer legs cover the running case.)

#### 7.30.1 The rule, which is about **where** a fact belongs

* **A control that cannot be used carries its reason on itself** — its `title` for a pointer, and a
  `visually-hidden` paragraph named by `aria-describedby` for a screen reader. The control is still drawn and still
  disabled: nothing is hidden, the explanation simply arrives at the control instead of sitting permanently above the
  field. This is a change to a documented law (*"a control we cannot honour is disabled, with the reason on screen"*),
  and the half that matters is kept: the reason is still reachable, and still says which of the three different
  refusals it is.
* **A fact all the controls share is said once**, and only while it is true — one line, `Applies to the next run.`,
  while a turn is running.
* **A failure the user just caused, or an action they may need, takes the line instead**: a folder chooser that would
  not open (§7.27's rule — a refusal is read where the press was), and the probe that is the only way to learn what
  an agent offers.

The settings pane keeps its own on-screen notes, and that is not an inconsistency: a settings page is *read*, and the
composer is *used*. The test for "is this note earning its space" is whether the user is looking at the surface to
find something out or to type into it.

#### 7.30.2 What was retired

Four keys per locale — `task.composer.{folder,agentMode,model,thinking}.nextRun` — replaced by one,
`task.composer.appliesNextRun`, in all seven catalogues (`i18n:gap` 455/455 complete). Every other sentence stays:
it is now the control's description rather than a paragraph, so nothing was deleted from the product's vocabulary.

#### 7.30.3 What is asserted, and the mutations

`composer-notes.test.tsx` renders the control row itself and counts `.composer__control-note`: **at most one, in
every state** — asserted as a property over seven states rather than one at a time, so a fifth branch added later
has to keep it. Six mutations, one per leg: a per-control sentence put back (3 legs red), a disabled control losing
its `title`, losing its description paragraph, the folder pill losing its reason, the shared line drawn when nothing
is running (3 legs), and the probe line dropped.

Five legs in `task-pane.test.tsx` had encoded the old sentences, and were rewritten rather than deleted — each now
asserts the *new* behaviour for that control (one line, the reason on the control, the description reachable). The
real-window leg asserts the count on a page the tool boots itself, so "no prose above the field" is measured and not
just unit-tested.

While doing this, the `Report` interface in that e2e file turned out to have a **duplicated block** — `theme` and
`contrastAll` were declared twice, the second copy nested inside `fix`. It type-checked (the extra members were
legal) and meant `fix` claimed two fields it does not have. Removed.

### 7.31 "2 windows" for one window — a socket counted as a window

The owner, looking at the title bar:

> *"why the top bar show '2 windows'?"*

Two answers, and both were defects.

#### 7.31.1 The number was wrong: one window had opened two sockets

`CoderStore.start()` was documented "Idempotent" and its guard was `if (this.connection) return` — checked
*before* `await resolveEndpoint()`. Two calls arriving inside that window both get past it and both open a
connection; the second is stored in `this.connection` and the **first is never disposed**, so its socket stays
connected for the life of the window. The daemon counts connections (`serve.ts`: `onConnectionChange`), so it
counted two, and the chip said two windows.

Measured on the running app before the fix — one client process, two sockets:

```console
$ lsof -nP -iTCP:4770 | grep ESTABLISHED
com.apple 59308 … TCP 127.0.0.1:54555->127.0.0.1:4770 (ESTABLISHED)
com.apple 59308 … TCP 127.0.0.1:54556->127.0.0.1:4770 (ESTABLISHED)
$ …coder.hello → windowCount = 3                    # the two above, plus the probe asking
after, one restart:
$ lsof -nP -iTCP:4770 | grep ESTABLISHED | wc -l
1
```

The trigger is ordinary rather than exotic: `main.tsx` renders inside `<StrictMode>`, React invokes the window's
effect twice in development, and `useCoderState`'s effect is what calls `store.start()`. One call site, one
double-invocation, two sockets.

**The guard is now the promise** (`this.starting ??= this.connectOnce()`), which survives its own `await`, and a
*failed* start clears it so the endpoint resolution stays retryable — nothing else calls `start()` again, so a
cached failure would have left the window permanently disconnected. `coder-store.test.ts` grew a "one window, one
socket" describe: overlapping starts open exactly one connection (a gate on the resolver puts the test in the race
window), a later start opens nothing, a disposed store opens a fresh one, and a failed start is retryable. A
defensive "close whatever was there first" inside `open()` was written and then **removed**: with the guard in
place nothing can reach it, and a branch no leg can redden is the shape this repository keeps refusing.

#### 7.31.2 And the badge should not have been there at all

The chip read `hello.windowCount`, which is a **snapshot taken when this window connected**. It never updates: a
second window opening later leaves the first one showing 1, and closing it leaves whichever window saw 2 showing
2 forever. A claim in the chrome that cannot correct itself is worse than a missing one, and the noun was wrong
too — a paired phone is a connection, not a window.

So the chip is gone, and the fact stays where a user goes to ask "what am I attached to": *Settings → This
machine*, whose row said *"How many windows are talking to this daemon **right now**"* about a number read at
connect. That sentence now says which moment it was read. `failure-placement.test.tsx` holds the removal — a
title bar with a daemon reporting four windows says nothing about windows — and a mutation that puts the badge
back reddens it.

A **live** badge is the alternative and was declined rather than half-done: it needs the daemon to emit a change
when its connection count moves and the window to re-read `hello` (a new event kind plus a refetch), which is real
work for a number with nothing to act on. Recorded here so the next reader knows it was a decision.

### 7.32 The composer's row was a form; Paseo's is a toolbar, and the folder belongs in the header

The owner, looking at the row above the message box:

> *"we needn't to show the folder path on the inputting field, and can the others fields use the same style with
> paseo. The current style on the top of inputting field are too ugly and nosing."*

Two changes, and the second is the larger one.

#### 7.32.1 The folder left the composer

The row carried a pill reading `Folder  packages/api` — the task's path, truncated, in the one place a path is least
worth reading: it competes with the message being typed, and it was the longest thing on the row. The location
already has a home: the pane's **header**, where it was a passive chip showing the project's name with the path in
its title. That chip is now **the control** — a folder glyph and the project's name, the whole path in the tooltip,
and a press opens the chooser — so the place and the way to change it are one thing, and the composer talks about
the agent and nothing else.

Two details came with the move, both from rules this document already holds. The header chip names a task running
in a *sub*folder as `payments-api/packages/api` rather than `packages/api` (`taskLocationLabel`): the header is the
only place naming the project, so a bare relative path would leave a reader unable to tell where they are. And a
chooser that *fails* says so on a line under the chip — §7.27's rule, that a refusal is read where the press was —
rather than as a paragraph above the field.

#### 7.32.2 The row is a toolbar now: glyph, value, no label, no box

The three remaining controls were labelled form controls — `Mode [select]`, `Model [select]`, `Thinking [select]`,
each with a border and a fill, each with its name to the left. That is a settings form sitting on top of a message
box. The reference product's composer row is a **toolbar** (`composer/agent-controls/control.tsx`: 28px chips, a
muted glyph, the value beside it, a caret only where the control opens something, a faint fill on hover and nothing
at rest) — and the labels a form would put beside each control live on the controls instead, as their accessible
names and tooltips.

Three marks were added (`icons.tsx`), and the row moved **under the field**, which is where Paseo keeps it: its
`buttonRow` holds the attach button and the agent's controls at the left and the action at the right
(`composer/input/input.tsx`). Ours now reads: field, then one row — chips on the left, the queue/steer picker, the
keyboard hint and Send on the right.

Measured in a real window, in both palettes, by an instrument extended for the question ("it looks like the
reference product" is a claim about boxes):

```console
$ node scripts/measure-settings.mjs --section work --seed --open "the task the tool measures"
composer: field 802 / card 820        # the field owns the row
          chips: 3 × height 28, border 0px
          actionsSameRowAsChips: true
          notes: 0                    # §7.30's line, which is the only prose left
contrastAll.below45: 0 in dark and in light
```

#### 7.32.3 What the tests hold

`task-pane.test.tsx` walks the moved control (the header chip is the button, the chip names the sub-folder, the
project's own name where the task runs in it, the reason attached when the window has no chooser, and the failure
line under the header); `composer-notes.test.tsx` asserts the composer **no longer renders the folder at all** —
not the path, not its failures — and that a disabled control's reason is still on the control;
`composer-controls.test.ts` unit-tests `taskLocationLabel`'s three cases. The real-window leg asserts the geometry
above, and three mutations — chips at 34px, a border put back, the actions stacked under the chips — each redden it.

The unset value reads **`Default`** on the chip rather than "The agent's own default", with the sentence as the
option's tooltip: a chip has one line, and the sentence that explains whose default it is belongs where a user is
reading a list. Three chips can therefore read `Default` at once on a brand-new task, which the distinct glyphs,
the tooltips and the accessible names carry.

#### 7.32.4 And the instrument had the same bug for the third time

The measurement had to be extended to name what a chip *shows* (a `<select>`'s text content is every option
concatenated — "Default Plan Review" for a mode picker), and writing that comment put an unescaped backtick inside
a page script for the **third** time in this session. `scripts/check-scripts.mjs` now catches that class: it scans
every `evaluate(\`…\`)` call and requires the template to close where the call ends, allowing an escaped
`` \` `` (three files legitimately contain one) and a trailing comma. Verified both ways — clean on the tree, and
red when the mistake is put back.

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
  with no handler, so it went too. The tolerant settings read (§7.14) keeps an upgrading user's other
  settings
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
and `RETIRED_SETTINGS_KEYS` / `readCoderSettingsDocument` (`domain.ts`, §7.14). Neither is a setting a
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
3. **Then the agents half — done (§7.12).** An open provider id, a provider config file and
   `coder.listProviders` / `coder.addProvider` / `coder.removeProvider` all exist (§7.10), with the
   probe and the launch path shared with the nine shipped agents, and the picker is now the third group
   of the **Agents** page: the catalogue served over the wire (`coder.listCatalog`, which measures
   nothing), one row's state on request (`coder.probeCatalogAgent`, which costs one search of the search
   path), and an editor for a program nobody catalogued. What is still absent is `defaults.models` for
   the custom-model rows — a provider's model is whatever the user put in its `args`, because we have no
   evidence about its flags. The schema addition was ours — `@envoycoder/protocol` is this repo's
   package — so `check-wiring` followed rather than an upstream round trip.

**Gate:** the upstream contract test the family requires, plus a daemon test that a configured agent
appears in `coder.listHarnesses` and a task can be started on it. **Met, for the step that exists:**
`test/catalog-rpc.test.ts` drives the two catalogue methods, `test/settings-agents-catalog.test.tsx`
drives the screen, and §7.12 records the twelve mutations each named test was checked against.

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
