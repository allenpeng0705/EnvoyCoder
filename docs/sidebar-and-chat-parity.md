# Sidebar and chat area: parity with Paseo

What a user sees on the left and in the middle, feature by feature. Paseo's side is read from v0.8.0 with
citations; ours is what the code does today (`apps/desktop/src/components/`). The point of the file is
that "same features" becomes a checklist with file names, not an impression.

Design rule from the user, restated because it governs everything here: **we take Paseo's design, not its
code.** Their components are React Native; ours are React DOM. Values live in
[`design-tokens.md`](design-tokens.md), interaction decisions in
[`paseo-design-decisions.md`](paseo-design-decisions.md).

## 1. Left sidebar

### 1.1 Paseo's structure, top to bottom

| Position | Element | Label | Icon | Action |
|---|---|---|---|---|
| 1 | Chrome row | — | — | titlebar drag region, height 36 |
| 2 | **Nav rows** | `New workspace` · `History` · `Search` · `Schedules` | `Plus` · `History` · `Search` · `CalendarClock` | new-workspace route · sessions route · **opens the command centre** · schedules route |
| 3 | Workspace list | section header `Workspaces` + a display-preferences gear | — | the tree/list, grouped by project, status or label |
| 4 | Callout slot | — | — | an inline notice (e.g. a first-run hint) |
| 5 | **Footer** | `Add project` (flex-1, minHeight 32) + a row of 28×28 icon buttons + a **host picker** | `Plus` etc. | add project · hosts · help & support · settings · switch host |

Footer menu contents, in Paseo's own words (`i18n/resources/en.ts:1124-1138`): `Add project`,
`New workspace`, `Hosts`, `Settings`, `Close sidebar`, `Help and support` → `Help`, `Run diagnostics`,
`Keyboard shortcuts`, `Report an issue`, `Discord`, `Create GitHub issue`, `What's new`.

Nav row order and visibility are **user-editable and persisted** (`sidebar-nav/model.ts:7-10,92-95`), and
the two that have shortcuts show them as badges: `New workspace` (`mod+N`), `Search` (`mod+K`).

### 1.2 Status grouping — the user-visible vocabulary

When the list is grouped by status, these are the exact group labels and the dot each carries
(`hooks/sidebar-status-view-model.ts:8-14`, `components/sidebar/sidebar-status-list.tsx:477-490`):

| Group | Dot band | Meaning |
|---|---|---|
| `Needs input` | warning | an approval is waiting |
| `Failed` | danger | the turn errored |
| `Ready to review` | success | finished, waiting for a human |
| `Working` | running (blue) | actively producing |
| `Done` | border (muted) | finished and seen |

Note for us: those five strings are **hardcoded English and missing from Paseo's own i18n catalog**, so
they do not translate there. We keep the wording and keep it translatable.

### 1.3 Display preferences (the gear in the section header)

Grouping → `Project` / `Status` / `Labels`; Title → `Title` / `Branch name`; Show → `Branch`, `Project`,
`Host`, `Pull request`, `Checks`, `Services`, `Labels`, `Diff stats`, `Last activity`; Checks →
`Icon and text` / `Icon only` / `Hidden`; plus a host filter and a project filter. Defaults matter:
`branch` and `project` meta items are **off** by default, `host` is on.

### 1.4 What we have today

`apps/desktop/src/components/CoderSidebar.tsx` renders: a search box (`placeholder="Search tasks, repos,
paths"`), the project → task tree with per-project agent badges, and a footer containing a single
`Settings` button and a `Local` hint. The Command Center is opened from a button that *displays* `⌘K`
but has no key listener behind it.

### 1.5 Work items

| # | Item | File | Needs |
|---|---|---|---|
| S1 | Nav rows (`New workspace`, `History`, `Search`, `Schedules`) with real shortcuts | `CoderSidebar.tsx` + a new `sidebar-nav` model | a key handler (none exists anywhere in `apps/desktop/src`) |
| S2 | **History** view: runs across tasks, date-sectioned, searchable | new component + a `coder.listRuns` query | the store already keeps runs and transcripts; needs a query and a route/view |
| S3 | **Schedules**: paseo schedules recurring agent runs | new — *not designed yet* | a decision: do we want unattended scheduled runs at all? (it interacts with approvals) |
| S4 | Footer: `Add project`, `Hosts`, `Help and support`, `Settings`, host picker | `CoderSidebar.tsx` | `Hosts` needs the mesh/node list (we have `coder.meshStatus`, no host list) |
| S5 | Display preferences (grouping, title source, meta toggles) | sidebar + `task-model` | our `groupByProject`/`filterRows` exist; grouping by **status** and **label** do not |
| S6 | Status-group labels with the two-band dots | sidebar | token bands are in `design-tokens.css`; the rollup exists (`attentionSummary`, `countStatuses`) |
| S7 | A `?` help sheet driven by the binding table | new | needs the shortcut registry from S1 |

## 2. Chat area

### 2.1 What Paseo's agent pane has

| Area | Features (verified) |
|---|---|
| **Composer** | auto-growing textarea (min 46px desktop, max `max(160, 50vh)`); agent + model pills; `Thinking` control that only appears when the model offers more than one option; mode picker; **`Queue` vs `Steer` vs `Interrupt`** with the forced-interrupt exception while an approval is pending; attachments (add/paste/upload/drag-drop, 50 MB cap, 48×48 pills); voice + dictation (dictation appends to the end of the draft, verbatim transcripts only); `/exit` and `/clear` as the only client-side slash commands; context-window **ring** beside the pills; a send button whose label follows the behaviour (`Interrupt` → `Queue message` → `Send and steer`) |
| **Transcript** | streaming text; tool calls grouped with a **sentence summary** ("edited 3 files, ran 4 commands, and searched 2 times"), expandable to `Input`/`Output`/`Error`; a **task list** panel (`{{completed}}/{{total}} tasks`); plan cards; compaction notices; copy/fork actions per message and per turn |
| **Approvals** | an **inline card in the timeline**, not a modal: title `Plan` for plan requests else `title ?? name ?? "Permission Required"`, the question line `How would you like to proceed?`, then `Deny` / `Accept` (or `Implement` for a plan); deny is the literal `"Denied by user"` with no reason input |
| **State display** | the 6px status dot + rotating running ring on the row/tab; `Starting / Idle / Running / Error / Closed` as text in the agent list; `Reconnecting` as a toast, not a bar |
| **Layout** | content measure 820px; timeline spacing computed by a function (user→user 4px, assistant→tool 16px, same-block 12px) rather than per-component margins |

### 2.2 What we have today

`apps/desktop/src/components/TaskPane.tsx`: a textarea, a `Queue`/`Steer` `<select>`, and a Send
button; the transcript renders text, tool calls (consecutive ones grouped), `run.diff` (emitted from
write/edit paths), approvals and usage as rows.
Approvals are answered inline already (`TaskPane` renders the options), which is the one place we are
already at parity. `SettingsPane.tsx` holds app settings; a project defaults UI does not exist.

### 2.3 Work items, by leverage

| # | Item | Why here | Needs |
|---|---|---|---|
| C1 | **Agent + model pills** on the composer and the run row | "which model wrote this?" is the question a control plane exists to answer | `coder.listHarnesses` exists; a per-run model field is in the protocol; no picker component yet |
| C2 | **Tool-call grouping + sentence summary** | shipped: consecutive tools collapse; write paths emit `run.diff` | done (`state/transcript.ts`, `daemon/runs.ts`) |
| C3 | **Task list** (the agent's todos) | the single most useful "is it on track?" signal | a `run.todos` event kind (not in `RUN_EVENT_KINDS` today) + a panel |
| C4 | **Context meter as a ring** | `run.usage` already carries `used`/`size`; we render one text line | a component; tokens exist |
| C5 | **Send-button label + the forced-interrupt exception** | small, and it is the difference between a message that lands and one that strands behind an approval | `state/` + `TaskPane.tsx`; the exception is already documented in `paseo-design-decisions.md` |
| C6 | **`/exit` and `/clear`** | two commands, both real | composer parsing + an `archiveTask` call we already have |
| C7 | **Copy / fork per message** | cheap, and used constantly | transcript row actions; `coder.startRun` already accepts a prompt |
| C8 | Attachments (paste/drag) | needed for "look at this screenshot" | protocol: a message field for attachments; paseo caps at 50 MB |
| C9 | Voice / dictation | last, and only once a harness can escalate to voice | a speech service in the daemon |

## 3. What this needs from the protocol, in order

Three items above are blocked on wire fields, not on UI work:

1. **`run.todos`** — without it, C3 cannot exist. It is one more member of `RUN_EVENT_KINDS`.
2. **A per-run attachment list** — C8 needs a field on the send path.
3. **`run.diff` emission** — shipped: write/edit tools that name a path become one `run.diff`
   before `run.ended`; the file-count sentence in C2 is no longer empty. A full diff viewer is still
   owed (`paseo-feature-parity` #9).

## 4. Honest note on who implements this

Every file in the work-item tables — `CoderSidebar.tsx`, `TaskPane.tsx`, `CommandCenter.tsx`,
`CoderApp.tsx` — is currently being edited by a second writer in this tree. This document is written so
either of us can take a row without re-deriving the design; the rows are sized to be independent, and S1
(the shortcut layer) plus S2 (the History view) are the two that unblock the most.
