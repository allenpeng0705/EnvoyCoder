# Paseo feature parity — the backlog, in copy order

**Strategy, stated once so it governs every row here:** we **copy Paseo's UI, UX and style faithfully
first**, and refine afterwards. Parity is the target, not a starting negotiation — a feature that exists in
Paseo should exist here looking and behaving the same way, and only then do we improve it. Our own
additions (the mesh, two first-party harnesses, the project→task rail) sit *on top of* that baseline
rather than replacing parts of it.

Details live in three companions, so this file stays an index and an order:
[`design-tokens.md`](design-tokens.md) (values) · [`sidebar-and-chat-parity.md`](sidebar-and-chat-parity.md)
(sidebar + composer, feature by feature) · [`paseo-design-decisions.md`](paseo-design-decisions.md)
(interaction rules, and the handful of places we differ **on purpose**).

## The one class of exception

Faithful copying has an exception, and it is not a style preference: **we never claim something we cannot
do.** If Paseo's UI offers a control our daemon cannot honour, ours shows it *disabled with a reason*
rather than pretending. Three live examples, all found this week:

* the mode picker is off until `coder.startRun` can accept an agent mode (otherwise it is a silent no-op);
* the six non-ACP agents are listed but refuse to launch by name (`harnessUnsupported`) instead of hanging
  on a handshake their program cannot answer;
* `resume` was accepted by the daemon and the window and rejected by the wire — now fixed.

Everything else is copy-first. Where we already know a Paseo detail is a defect rather than a design
choice (two focus rings that disagree, two reds for one error meaning, status labels that do not
translate, mac-only pane shortcuts), we take the *design* and not the defect — and those are listed at the
bottom of `paseo-design-decisions.md` as refinements, not as divergences.

## Tier 1 — parity that also fixes something broken

| # | Feature | Paseo | Ours | Work |
|---|---|---|---|---|
| 1 | **Every listed agent actually runs** | 5 transports (SDK, app-server, ACP, HTTP, JSONL-RPC) | ACP only; 6 entries refused by name | one adapter per dialect (app-server for Codex, HTTP for OpenCode, JSONL-RPC for Pi/OMP, vendor ACP subcommand for Copilot/Cursor) |
| 2 | **Resume a run** | resume from the UI, per agent | wire now accepts it ✅; needs the picker + a test at the RPC layer | done on the wire; UI affordance left |
| 3 | **The phone pairs and connects** | QR scan → host list → run list → answer approvals | hello shape fixed ✅; nothing persists; no session store | pairing persistence, token store, run list, approval answering (M4) |
| 4 | **Modes per agent** | `plan`/`acceptEdits`/`bypassPermissions`… chosen per run | modes now on the wire ✅; picker disabled pending `agentModeId` | `agentModeId` on `startRun` + pass-through per transport |
| 5 | **User-defined ACP providers** | `extends:"acp"` + `command`/`env`/`params` in config | absent; 38-entry catalogue unreachable | open provider id, provider config file, list/add/remove RPCs |
| 6 | **One composer that adapts to the agent** | agent/model pills, thinking, mode, features, context ring | decision layer written ✅ (`composer/controls.ts`); fixed textarea + Queue/Steer | render the controls; wire the pills |

## Tier 2 — the features a user reaches for next

| # | Feature | Paseo's shape | Work |
|---|---|---|---|
| 7 | **Sidebar nav + footer** | `New workspace · History · Search · Schedules`; footer `Add project`, host picker, `Hosts`, `Help and support`, `Settings` | shortcut layer ✅ done; History model ✅ done; render rows + footer; Schedules needs its own design decision |
| 8 | **Git worktrees** | create/remove with a slug branch, ownership guard, auto-archive on merge | `coder.createTask{worktree}`, a daemon git service, row branch display |
| 9 | **Diff / review surface** | changed files, commits, PR create/merge, forges, inline review | emit `run.diff` (type + row already exist), a diff viewer, git in the daemon |
| 10 | **Multi-window** | `⌘N`, "Open in new window", one daemon many windows | Tauri window label + capability scope + a `new_window` command + the palette entry |
| 11 | **Terminals** | PTY per task, profiles, snapshot/restore, activity | `node-pty` in the daemon, terminal RPC + stream, a pane, real `pty` capability |
| 12 | **File explorer** | list/read/write/watch/upload/download | `coder.listFiles`/`readFile` with path safety, a dock pane |
| 13 | **Notifications, tray, badge** | attention → OS notification + push, click routes | a `coder:attention` event, Tauri notification/tray, the badge `attentionSummary` already computes |
| 14 | **Command palette depth** | three contribution scopes, ranked results, hidden synonyms, `⇧?` help sheet | registry + ranking; the binding table exists ✅ |
| 15 | **Display preferences** | grouping by project/status/label; title source; nine meta toggles | status/label grouping in `task-model`; a preferences panel |
| 16 | **Transcript richness** | tool-call grouping with a sentence summary, task list, compaction notices, copy/fork | grouping pass, `run.todos` event, row actions |
| 17 | **Per-project defaults** | project settings screen | the model exists (`resolveTaskDefaults`); needs the screen |

## Tier 3 — depth, platform, and the long tail

| # | Feature | Note |
|---|---|---|
| 18 | **Run-event durability** | finished runs capped at 50 in memory; read them back from `transcripts/` |
| 19 | **Plugins** | Paseo's are explicitly unsandboxed — copy the extension points, state our own sandbox position |
| 20 | **Subagents** | a child-run track for provider subagents; needs event kinds first |
| 21 | **Quotas / usage** | per-provider fetchers where available; beside the context ring |
| 22 | **Web build the daemon serves** | `build:web` + static serving, so another machine's browser can open it |
| 23 | **CLI as a product** | `ls/run/attach/logs/wait/archive` over the same protocol (promote `scripts/run-once.ts`) |
| 24 | **Voice** | dictation-and-insert first (append, never insert-at-caret); full duplex later |
| 25 | **i18n** | `t()` on the shell's copy, one non-English locale proving the pipeline, key-parity tests |
| 26 | **Remote / hub** | Paseo runs a relay + E2EE + an optional hub; **our equivalent is the mesh** — deliberately different, see below |

## Deliberately different (our own additions, kept on top)

| Difference | Why it stays |
|---|---|
| **The mesh, not a daemon hub** | we attach as a *product* with a scoped, revocable session; no hosted service, no telemetry |
| **Two first-party harnesses** | `envoy-harness` built-in, `deepseek-harness` catalogued — the one thing no other product in the family has |
| **Project → task rail** | clearer than a flat grouped list for many repositories; Paseo's status/label groupings still get copied *into* it |
| **Tauri + Flutter instead of Electron + Expo** | our stacks; the design travels, the code cannot |
| **JSON-RPC instead of `{type:"session"}`** | our protocol is one product's; a shared session envelope would import a foreign state machine |
