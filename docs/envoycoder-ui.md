# The UI: shell, rail, and the rules behind them

**Code:** `apps/desktop/src` · **Model:** `packages/workspace-model` ·
**Take from Paseo:** the shell · **Take from EnvoyMesh:** the project tree

---

## 1. The one structural decision

**A project is a place; a workspace is a task in that place.** Two levels, never three.

Paseo's sidebar groups workspaces by project as a *heading*. EnvoyMesh's Coding tab, which this
follows on the owner's instruction, makes the project a *row*: collapsible, configurable, and
carrying the agent its children inherit. The difference is not cosmetic:

* the project header answers **"is this repo busy?"** — status counts and the default agent, without
  scrolling its tasks;
* **"+ New"** lives on the repo, so starting work there is one click rather than a global button plus
  a picker;
* **project settings** are reachable from the project, which is where the defaults belong.

Grouping is by **path**, not by directory contents or session id: two workspaces can share one `cwd`
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
│    Workspaces +New│  │                          [Deny] [Allow once]   │   │
│    • task A   ●   │  └────────────────────────────────────────────────┘   │
│    • task B   ●   │  composer: [Attach] [agent] … [Queue▾] [Send]         │
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
count appears in the rail header, the title bar and the phone badge from **one** function
(`attentionSummary`), because three surfaces showing three numbers teaches users to trust none.

## 5. The composer

Three controls, all of which exist because their absence causes a specific confusion:

* **Queue vs Steer.** Sending while an agent works either waits for the turn or joins it. One control
  that silently chooses is how people conclude the agent ignored their message.
* **Agent and model pills** on the row and in the toolbar, so "which model wrote this?" never needs
  an archaeology session.
* **Attach**, with the files a run touched listed in the transcript rather than hidden in a log.

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

## 8. What the scaffold implements

`CoderApp` (shell, Command Center stub), `CoderSidebar` (the project tree, search, attention count),
`WorkspacePane` (header facts, transcript, inline approval, composer with Queue/Steer),
`MeshStatusBar` (mesh state in end-user words), and `state/useCoderState.ts` — the single seam the
daemon will replace. The rail's logic is not in the components: grouping, ordering, counting,
filtering and the status wording all live in `@envoycoder/workspace-model`, which is pure and tested,
so "why is this row above that one?" has exactly one answer.
