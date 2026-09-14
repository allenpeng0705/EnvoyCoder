# The UI: shell, rail, and the rules behind them

**Code:** `apps/desktop/src` · **Model:** `packages/task-model` ·
**Take from Paseo:** the shell · **Take from EnvoyMesh:** the project tree

---

## 1. The one structural decision

**A project is a place; a task is a unit of work in that place.** Two levels, never three.

Paseo's sidebar groups its **workspaces** by project as a *heading* — their word for the unit of work, and the reason ours must not be called the same thing: it reads like a level *above* a project, and it is not. EnvoyMesh's Coding tab, which this
follows on the owner's instruction, makes the project a *row*: collapsible, configurable, and
carrying the agent its children inherit. The difference is not cosmetic:

* the project header answers **"is this repo busy?"** — status counts and the default agent, without
  scrolling its tasks;
* **"+ New"** lives on the repo, so starting work there is one click rather than a global button plus
  a picker;
* **project settings** are reachable from the project, which is where the defaults belong.

Grouping is by **path**, not by directory contents or session id: two tasks can share one `cwd`
(Paseo's own data-model note says so), and grouping by anything unstable makes the tree reshuffle
while it is being read. `projectIdFor(hostId, path)` is derived, not allocated, so two clients — a
window and a phone — agree without a handshake.

## 2. Regions

```
┌───────────────────────────────────────────────────────────────────────────┐
│ titlebar   ▤   EnvoyCoder                        [2 windows]  Command Center│
├───────────────────┬───────────────────────────────────────────────────────┤
│ rail              │ pane                                                  │
│  + Add project    │  title  [status] [agent] [model] [project] [branch]   │
│  search   [Group] │  ─────────────────────────────────────────────────────│
│  ⚠ 2 tasks need   │  transcript                                           │
│    you            │   …                                                   │
│  ▼ envoymesh      │  ┌ approval (inline, never a modal) ──────────────┐   │
│     Envoy Harness │  │ Run the suite and update 3 snapshots?          │   │
│    Tasks +New     │  │                          [Deny] [Allow once]   │   │
│    • task A   ●   │  └────────────────────────────────────────────────┘   │
│    • task B   ●   │  composer: [agent] … [Queue▾] [Send]                  │
│  ▶ payments-api   │                                                       │
│  Settings    Local│                                                       │
├───────────────────┴───────────────────────────────────────────────────────┤
│ ● Mesh connected — 1 machine reachable        Agents run on this machine   │
└───────────────────────────────────────────────────────────────────────────┘
```

**The status line names the mesh.** Paseo's equivalent names the daemon you are talking to; ours has
one more thing worth showing permanently, because it decides whether "run it on the workstation" is
even possible. A user who must open Settings to find out assumes the feature is broken.

## 3. Row anatomy, and the one deliberate choice in it

```
 ●  Wire product attach into the new node service   [Needs your answer]
    Envoy Harness · feat/product-attach · workstation
```

The status is a **dot first, words second**: the dot answers "does this need me?" down a column of
rows, and the chip spells it out for the row you have stopped on. Words on every row make the column
unreadable exactly when it matters most — ten agents running.

Status → colour is fixed and semantic: blue working, amber needs you, red stopped with an error,
green finished, grey queued/idle. A colour that means two things means nothing.

## 4. Status buckets

| Bucket | Meaning | Rail wording |
|---|---|---|
| `queued` | accepted, not started | Waiting to start |
| `running` | working now | Working |
| `needs-attention` | **waiting on a human** | Needs your answer |
| `idle` | alive, nothing to do | Idle |
| `done` / `failed` / `cancelled` | ended | Finished · Stopped with an error · Stopped |

`needs-attention` is deliberately **not** part of `running`. An agent blocked on approval is not
making progress, and folding it into "working" is how a control plane makes users wait on it. The
count is computed by **one** function (`attentionSummary`), because three surfaces showing three
numbers teaches users to trust none. Today exactly one surface renders it — the rail header. The title
bar and the phone badge are still to come (the shell shows a window/connection chip instead), so this
paragraph describes the intent, not the build.

## 5. The composer

Three controls, all of which exist because their absence causes a specific confusion:

* **Queue vs Steer.** Sending while an agent works either waits for the turn or joins it. One control
  that silently chooses is how people conclude the agent ignored their message.
* **Agent and model pills** on the row and in the toolbar, so "which model wrote this?" never needs
  an archaeology session.
* **Attach** — not built yet. The composer today is a textarea, a Queue/Steer select and Send; the
  files a run touched will list in the transcript when the diff surface lands (`run.diff` is declared
  and rendered but never emitted).

## 6. Approvals, inline

A permission request renders **in the transcript, next to the tool call that raised it** — not as a
modal. A modal blocks the window and hides the context needed to decide. Wording follows the family's
rule: headline in the user's language, detail second, developer fields last and small — "3 files
under `__snapshots__` will change" is a headline; a tool name is not.

## 7. Design laws

Inherited from Paseo's design doc because they hold up under load:

1. **Hierarchy by weight and colour, not size.** Sizes are fixed; scaling type per row makes a long
   list look like a ransom note.
2. **One accent.** Exactly one primary action per view (Send, Continue, Allow once).
3. **Destructive is a colour that appears only inside a confirmation.** Never on a row.
4. **Sentence case, no trailing periods on labels.**
5. **Compact-first list+detail** is the canonical shape; inventing a third shape is a design decision,
   not a PR.
6. **Empty states teach.** "No projects yet — add a directory you work in" beats a blank panel.

## 8. What the window implements

`CoderApp` (shell, connection state, empty states), `CoderSidebar` (the project tree, search,
attention count), `RowMenu` (the `…` on a project row and on a task row: its items, its keyboard
contract, and the inline question a destructive item asks), `TaskPane` (header facts, transcript,
inline approval, composer with Queue/Steer), `CommandCenter` (typed `action`/`choice`
contributions, arguments collected in the same box), `SettingsPane` (app-wide defaults, per-agent
capability honesty, and the three levels of its own navigation: this machine's settings, the projects
page, and one project's defaults), `MeshStatusBar` (mesh
state in end-user words), and the store behind them:

```
daemon ──ws──▶ CoderConnection ──▶ CoderStore ──useSyncExternalStore──▶ components
                (transport)         (state + actions)
```

Three decisions in that pipeline are worth stating, because each is a place the naive version is
wrong:

* **The window never dials what it names.** It asks the shell where the daemon is
  (`daemon_endpoint`), and the shell decides. The reference implementation validates a
  renderer-supplied transport path only as a non-empty string and then dials it as a socket
  (`packages/desktop/src/daemon/local-transport.ts:122-128`); §4 of the inheritance doc says why we
  do not.
* **The rail's logic is still not in the components.** Grouping, ordering, counting, filtering and
  the status wording live in `@envoycoder/task-model` — pure and tested — so "why is this row
  above that one?" has exactly one answer regardless of where the rows came from.
* **A window that cannot reach its daemon says so.** "No projects yet" and "I could not ask" are
  different sentences, and showing the first for the second is how a user concludes the app lost
  their work. `EmptyWork` branches on the connection, the load and the project count because those
  are three different situations.

One more, added with the row menus and worth stating because it is a decision rather than a style:

* **A row's actions belong to the row, and a destructive one asks in place.** Removing a task is on
  the task's own row (`RowMenu`), not in the pane header it shared until then: the row is the thing
  that changes, so the row is where the question can show what is being decided — and one action with
  one home is one sentence to keep true. The sentence is `task.remove.*`, unchanged, and the
  destructive colour exists only inside the confirmation (law 3), never on the row and never in the
  menu. `docs/settings-parity.md` §7.3's project scope (built as §8.1 item 2) is reached from the row's
  menu — one item in it — **and** from the projects page, which is the same function behind both (§7.5);
  the scope names the project in its title and carries a back control labelled with the destination it
  returns to (*"Projects"*, not *"All settings"* — the list, which is where it actually lands). The page
  itself is one level down from the app scope, opened by a single row whose second band is how many
  projects there are, so the list grows with the projects and the app scope does not.

The transcript is real as of M2, and its **folding rules are not in the component**:

```
run events ──▶ buildTranscript()  ──▶ rows ──▶ TaskPane
                (state/transcript.ts, pure and tested)
```

Four rules live there, each of which renders visibly wrong when it breaks: chunks join by `messageId`;
a tool call is one row built from two events keyed by the agent's `callId`; an approval is rendered
where the agent paused and is *updated in place* when answered; and a missing `seq` is **reported**,
because a transcript that silently skips a frame is how a user reads a decision they never saw.

What is still placeholder: the diff panel. `run.diff` renders as a one-line summary (`"3 files
changed."`) with no way to open the files — that is the next slice, and the reason `run.tool` keeps
its `input` and `output` rather than only a rendered string.
