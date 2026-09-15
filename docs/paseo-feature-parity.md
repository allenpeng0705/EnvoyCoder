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
* the four agents with no ACP surface are listed but refuse to launch by name (`harnessUnsupported`)
  instead of hanging on a handshake their program cannot answer;
* `resume` was accepted by the daemon and the window and rejected by the wire — now fixed.

Everything else is copy-first. Where we already know a Paseo detail is a defect rather than a design
choice (two focus rings that disagree, two reds for one error meaning, status labels that do not
translate, mac-only pane shortcuts), we take the *design* and not the defect — and those are listed at the
bottom of `paseo-design-decisions.md` as refinements, not as divergences.

## Tier 1 — parity that also fixes something broken

| # | Feature | Paseo | Ours | Work |
|---|---|---|---|---|
| 1 | **Every listed agent actually runs** | 5 transports (SDK, app-server, ACP, HTTP, JSONL-RPC) | ACP only, but **five entries now actually run over it**: the two first-party harnesses plus Claude Code, Codex and Cursor — whose recipes were replaced with commands driven against the real binaries (`docs/settings-parity.md` §7.8). The other four are refused by name ✅ | smaller than it looked: Codex's and Cursor's dialects turned out to be ACP after all (an npm bridge and a vendor `acp` subcommand), so what remains is Copilot, OpenCode, Pi and OMP — and Pi/OMP share one JSONL-RPC transport |
| 2 | **Resume a run** | resume from the UI, per agent | wire now accepts it ✅; needs the picker + a test at the RPC layer | done on the wire; UI affordance left |
| 3 | **The phone pairs and connects** | QR scan → host list → run list → answer approvals | hello shape fixed ✅; nothing persists; no session store | pairing persistence, token store, run list, approval answering (M4) |
| 4 | **Modes per agent** | `plan`/`acceptEdits`/`bypassPermissions`… chosen per run | modes on the wire ✅ and the picker renders, enabled per agent on `capabilities.agentMode`; since §7.8 it is enabled for **four** of them — Envoy Harness, Claude Code, Codex and Cursor — and disabled with a reason naming the agent for the rest (`composer/controls.ts:592-594`) | the entries whose mode lists came from Paseo were replaced with the ids the live agents publish, and the field name their `session/set_mode` reads is now a catalogue fact (§7.8) |
| 5 | **User-defined ACP providers** | `extends:"acp"` + `command`/`env`/`params` in config — with the credential as a plaintext `env` **value** | the plumbing landed ✅: `AgentProviderConfig` in `@envoycoder/protocol`, `coder.listProviders`/`addProvider`/`removeProvider` over `<state>/providers.json`, every provider **probed** by the same prober as the nine shipped agents (same five `availability` states) and launched through the same `launchForHarness` body — see `docs/settings-parity.md` §7.10. We **do not** copy Paseo's `env` values: the config stores variable **names**, the value is read from the daemon's environment at spawn, and an unset name is refused in the user's language rather than skipped. **The picker landed** (`docs/settings-parity.md` §7.12): Settings → **Agents** lists all 38 catalogue entries, searchable, each with its command, version, install link and a state that is measured on request — `coder.listCatalog` serves the entries with **nothing** measured about them and `coder.probeCatalogAgent` measures **one row, when the user asks**, because 14 of the 38 are `npx` recipes and a screen that checked them all while opening would spend the machine on rows nobody looked at. Adding a row sends the entry's own command, argv, environment names and declared dialect, so no client invents a `modeParam` (no entry states one) — and a form declares a program nobody catalogued. **The one cost that row used to state is now paid off**: four recipes set six constants between them, and treating those as if they were credentials left the user to export a value we had written ourselves. What crosses now is a **reference** — `catalogEntryId`, the entry's own id — and the daemon resolves the recipe's constants from the catalogue it ships, so `providers.json` still holds no value at all (`docs/settings-parity.md` §7.10). The reference is *verified* against the recipe the request describes, and a credential-looking name may not carry a recipe value at all | ✅ done — and the store is stronger than it was: no value of ours and no value of a user's can reach the file |
| 5b | **"In my agents" vs hidden, and signing an agent in** | `providers[id].enabled` per provider (a disabled provider is reported `unavailable` and its `listModels` throws); authentication is each provider's own login | **the first half was built as a list filter, and then deleted — the second half landed ✅.** We shipped `coder.setAgentHidden` + `CoderSettings.hiddenAgents` + a `hidden` flag on every row, and the reasoning was that Paseo's switch falsifies a *state* while ours only filtered a *list*. That was a misreading of the source: their switch decides whether **their daemon instantiates a provider at all**, which is wiring, not a preference over a list — and a list filter is the one control that can make an agent **we ship** disappear from our own lists, which is the failure this product's owner named. All of it is gone, and what a picker offers is **derived** from probed facts (`composer/agent-for.ts`'s `offeredAgents`), so no stored value can shorten a list; `docs/settings-parity.md` §5.8 carries the two wrong rulings and the correction, and the curation Paseo's row is really about is answered **additively** (add the agents you use to a short list, never subtract from the whole one). Authentication is unchanged and is a fact we can see rather than a credential we hold: the probe records `HarnessSummary.auth` (`ready | needs-signin | unknown`, `unknown` until something looks), and `coder.signInAgent` triggers the agent's **own** `authenticate` step — reporting five outcomes of which only "a session opened" is success (§7.11) | ✅ **The sign-in half** landed with #5's surface (`docs/settings-parity.md` §7.12): a row whose agent reports `needs-signin` carries the sign-in button, which renders the daemon's own sentence for whichever of the five outcomes came back, and there is **no** hide/show control or *Hidden* chip beside it — the page lists every agent we ship, every provider declared and all 38 catalogue rows, and no control shortens that list. **The button is measured in a real window rather than reasoned about**: `npm run signin:window` boots a real daemon whose search path holds the scripted agent, drives the real UI in headless Chrome, presses the rendered button and reads the sentence back — *"Claude Code accepted the sign-in and opened a session."* (`docs/settings-parity.md` §7.13.1), and `npm run ui:audit` re-measures the page itself (§7.13) |
| 6 | **One composer that adapts to the agent** | agent/model pills, thinking, mode, features, context ring | decision layer written ✅ (`composer/controls.ts`); the pills render, and since the pre-flight probe the **agent is asked what it offers before its first run** ✅ (`docs/settings-parity.md` §7.7 — `deepseek-harness`'s published list replaces the hand-typed one; `envoy-harness` has nothing to ask, and says so) | features + context ring |

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
