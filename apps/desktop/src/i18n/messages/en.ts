/**
 * The English catalogue — the source of truth every other language is measured against.
 *
 * ## How the keys are organised
 *
 * Dotted, and grouped by the surface that shows them, because that is how they are found again:
 * `sidebar.*`, `palette.*`, `task.*`, `settings.*`, `run.*`, `error.*`. A key the UI no longer uses
 * is deleted here rather than left to rot, and `i18n.test.ts` fails if a language defines a key this
 * file does not have.
 *
 * Two groups are not surfaces but *kinds of text*:
 *
 *   * **`status.*`** — one key per `TaskStatus`, so the rail and the pane word a status identically
 *     in every language. `@envoydev/task-model`'s `statusLabel` stays the English source and a
 *     test asserts the two agree word for word.
 *   * **`error.*`, `note.*`, `approval.*`** — sentences the **daemon** sends. Each is repeated here
 *     verbatim so that a German user reads German: the daemon sends the key with its English
 *     sentence (`messageKey`/`messageValues` in `@envoydev/protocol`), and the window renders the
 *     key in the language the user chose. The English here and the English on the wire are the same
 *     sentence on purpose — an English user must see no change at all, and a translator has one
 *     string to translate rather than two.
 *
 * ## The rule for a value
 *
 * `{placeholder}` values are interpolated verbatim and never reformatted, so a key that names a path
 * or a count must place it where the language wants it. Nothing here is pluralised by a library: a
 * language that needs two forms gets two keys (`sidebar.attention.one` / `.many`), because a plural
 * rule implemented in six places is six chances to be wrong.
 */

import { git } from "./git.en.js";

export const en = {
  /* ── the product, and the machine it is on ── */
  "app.name": "EnvoyDev",
  "app.thisMachine": "This machine",

  /* ── the connection, said the way a user needs it ── */
  "connection.starting": "Starting…",
  "connection.unreachable": "Daemon unreachable",
  "connection.none": "Not connected",

  /* ── the notice strip: only refusals speak ── */
  "notice.dismiss": "Dismiss",

  /* ── the rail ── */
  "sidebar.aria": "Projects and tasks",
  "layout.resize.rail": "Resize the project list",
  "layout.resize.settingsNav": "Resize the settings sections list",
  "layout.resize.explorer": "Resize the file explorer",
  "sidebar.add": "+ Add project",
  "sidebar.add.title": "Register a directory as a project",
  "sidebar.command.title": "Open the Command Center",
  "sidebar.search.placeholder": "Search tasks, repos, paths",
  "sidebar.search.aria": "Search tasks, repositories and paths",
  "sidebar.view.groupBy": "Group by project",
  "sidebar.view.flat": "One flat list, newest first",
  "sidebar.view.group": "Group",
  "sidebar.view.list": "List",
  "sidebar.attention.one": "1 task needs you",
  "sidebar.attention.many": "{count} tasks need you",
  "sidebar.empty.title": "No projects yet",
  "sidebar.empty.body":
    "Add a directory you work in. Tasks you start in it appear here, and the project remembers the default agent new tasks start with.",
  "sidebar.empty.noMatch": "Nothing matches “{query}”.",
  "sidebar.empty.cannotLoadTitle": "Could not read your projects",
  "sidebar.empty.cannotLoadBody": "This list is unknown, not empty — EnvoyDev could not ask its daemon for it.",
  "sidebar.section.tasks": "Tasks",
  "sidebar.project.attention": "Tasks waiting on you",
  "sidebar.project.agent": "The agent new tasks in this project start with",
  "project.agent.picker.aria": "Coding agent for this project: {agent}. Change",
  "project.agent.picker.title": "Change the coding agent for this project",
  "project.agent.picker.menu": "Coding agents for this project",
  "task.agent.picker.aria": "Coding agent for this task: {agent}. Change",
  "task.agent.picker.title": "Change the coding agent for this task",
  "task.agent.picker.menu": "Coding agents for this task",
  "sidebar.project.settings": "Project settings",
  "sidebar.project.newTask": "+ New",
  "sidebar.project.newTask.title": "Start a task in {project}",
  /* ── the row menus ──
     One trigger per row, and its accessible name **names the row it acts on**. "Actions" alone is a
     button a screen reader announces once per task with no way to tell which task it belongs to —
     which is the one thing a menu on a row must not be. The items themselves reuse the labels the rest
     of the app already uses for the same actions (`sidebar.project.settings`, `task.remove`, and the
     `task.remove.*` confirmation), so one action is worded once. */
  "sidebar.project.menu.aria": "Actions for {project}",
  "sidebar.project.menu.title": "Project actions",
  "sidebar.project.menu.newTask": "New task",
  "sidebar.project.menu.openNewWindow": "Open in new window",
  "sidebar.project.menu.openNewWindowFailed": "Couldn't open a new window",
  "sidebar.project.remove": "Remove project",
  "sidebar.project.remove.aria": "Remove this project",
  "sidebar.project.remove.confirm":
    "Remove “{project}” from EnvoyDev? Its tasks leave the rail and are archived — nothing on disk is deleted.",
  "sidebar.project.remove.cta": "Remove project",
  "sidebar.task.menu.aria": "Actions for {task}",
  "sidebar.task.menu.title": "Task actions",
  "sidebar.task.rename": "Rename",
  "sidebar.task.rename.aria": "New name for this task",
  "sidebar.task.changeAgent": "Change agent",
  "sidebar.tasks.empty": "No tasks here yet.",
  // Pair + Settings sit on the rail's top row beside ⌘K (not in the title bar or a footer).
  "sidebar.pair": "Pair a phone",
  "sidebar.settings": "Settings",

  /* ── the command palette ── */
  "palette.title": "Command Center",
  "palette.placeholder": "Type a command",
  "palette.search.aria": "Search commands",
  "palette.value": "Value",
  "palette.selected": "Selected",
  "palette.empty": "Nothing matches that.",
  "palette.group.projects": "Projects",
  "palette.group.tasks": "Tasks",
  "palette.group.machine": "This machine",
  "palette.addProject.title": "Add project…",
  "palette.addProject.subtitle": "Register a directory you work in",
  "palette.addProject.pickPrompt": "Choose a project folder",
  "palette.addProject.noFolder": "No folder was chosen, so nothing was added.",
  "palette.addProject.needs": "Which folder? Paste its full path.",
  "palette.addProject.needsPlaceholder": "/Users/you/work/repo",
  "palette.newTask.title": "New task in {project}",
  "palette.openTask.subtitle": "Open this task",
  "palette.pairPhone.title": "Pair a phone",
  "palette.pairPhone.subtitle": "Show a code the mobile app can scan",
  "palette.settings.title": "Open settings",
  "palette.settings.subtitle": "Defaults for new tasks, and what needs approval",
  "palette.noPicker": "This window has no shell to ask, so paste the folder path instead.",
  "palette.pickerFailed": "The folder picker could not open: {detail}",

  /* ── the work area with nothing in it, and the three reasons why ── */
  "work.offline.title": "EnvoyDev cannot reach its daemon",
  "work.offline.body":
    "The daemon is the process that runs your tasks, and it is not answering. It starts with the app, so this usually fixes itself in a moment.",
  "work.loading": "Loading your projects…",
  "work.noTask.title": "No task open",
  "work.noTask.body":
    "Pick a task on the left, or start one in a project. Agents run on this machine and, when the mesh is attached, on your other machines too.",
  "work.noProjects.title": "No projects yet",
  "work.noProjects.body": "Add a directory you work in, and EnvoyDev can run agents there.",
  "work.noTask.action": "Start a task",
  "work.noProjects.action": "Add a project",

  /* ── the task pane ── */
  "task.aria": "Task {title}",
  "task.untitled": "Untitled",
  "task.meta.agent": "The agent running this task",
  "task.meta.cwd": "Working directory: {path}",
  "task.meta.host": "Machine running this task",
  "task.cancel": "Stop",
  "task.cancel.title": "Ask the agent to stop",
  "task.transcript.gap":
    "Some of this task’s history did not arrive. What is here is in order; reload to ask again.",
  "task.transcript.empty.title": "Nothing yet",
  "task.transcript.empty.body":
    "Ask for something and the agent works in {cwd}. Tool calls, approvals and diffs appear here as they happen.",
  "task.you": "You",
  "task.delivered.steered": "joined the turn",
  "task.delivered.queued": "waited for the turn",
  "task.thought.summary": "How it thought about this",
  "task.code.copy": "Copy",
  "task.code.copied": "Copied",
  "task.code.plain": "text",
  "task.diagram.aria": "Diagram",
  "task.diagram.source": "Source",
  "task.diagram.view": "View diagram",
  "task.diagram.streaming": "Diagram appears when the agent finishes this block.",
  "task.diagram.blocked": "This diagram was not rendered — its source looked unsafe.",
  "task.diagram.failed": "Could not draw this diagram. The source is shown instead.",
  "task.approval.aria": "The agent needs your answer",
  "task.approval.answered": "Answered",
  "task.approval.answeredWith": "Answered: {option}",
  "task.approval.confirm": "Confirm",

  /* ── the composer ── */
  "task.composer.aria": "Message the agent",
  "task.composer.commands": "Commands",
  "task.remove": "Remove task",
  "task.remove.aria": "Remove this task",
  "task.remove.confirm": "Remove “{title}” from EnvoyDev? It leaves the rail and is archived — the folder and its files are not touched.",
  "task.remove.cta": "Remove",
  "action.cancel": "Cancel",
  "explorer.toggle": "Toggle Explorer sidebar",
  "explorer.aria": "Explorer",
  "explorer.tab.files": "Files",
  "explorer.tab.changes": "Changes",
  "explorer.files.empty": "This folder is empty.",
  "explorer.files.failed": "Could not list this folder.",
  "explorer.changes.empty": "No changes in this folder.",
  "explorer.commit.message": "Commit message",
  "explorer.commit.cta": "Commit",
  "explorer.commit.stageAll": "Stage all",
  "explorer.commit.done": "Committed {sha}.",
  "explorer.stage": "Stage {path}",
  "explorer.unstage": "Unstage {path}",
  "explorer.changes.notRepo": "This folder is not a git repository.",
  "explorer.changes.failed": "Could not read the changes.",
  "explorer.loading": "Loading…",
  "explorer.kind.added": "Added",
  "explorer.kind.modified": "Modified",
  "explorer.kind.deleted": "Deleted",
  "explorer.kind.renamed": "Renamed",
  "explorer.kind.untracked": "New",
  "explorer.kind.conflict": "Conflict",
  "explorer.sort.name": "Name",
  "explorer.sort.modified": "Modified",
  "explorer.sort.size": "Size",
  "explorer.newFile": "New file",
  "explorer.newFolder": "New folder",
  "explorer.hideHidden": "Hide hidden files",
  "explorer.showHidden": "Show hidden files",
  "explorer.refresh": "Refresh files",
  "explorer.draft.file": "File name",
  "explorer.draft.folder": "Folder name",
  "explorer.tab.chat": "Chat",
  "work.newTab": "New tab",
  "work.new.task": "Task",
  "work.new.terminal": "Terminal",
  "work.new.browser": "Browser",
  "work.browser.address": "Web address",
  "work.browser.open": "Open",
  "work.browser.placeholder": "https://",
  "work.browser.badAddress": "That is not a web address.",
  "work.tool.needsApp": "Open EnvoyDev to use this.",
  "work.tool.failed": "Could not open it. {detail}",
  "explorer.file.close": "Close",
  "explorer.file.loading": "Loading…",
  "explorer.file.failed": "Could not open this file.",
  "explorer.file.binary": "This file can't be shown as text.",
  "explorer.file.tooLarge": "This file is too large to open here ({size}).",
  "explorer.diff.binary": "This change is in a binary file.",
  "explorer.diff.empty": "This file has no changes to show.",
  "explorer.diff.failed": "Could not open this change.",
  "explorer.diff.tooLarge": "This change is too large to open here ({size}).",
  "task.composer.placeholder.approval": "Answer the request above before sending anything",
  "task.composer.placeholder.running": "Add a follow-up — Queue waits for this turn, Steer joins it",
  "task.composer.placeholder.idle": "Describe the task",
  "task.composer.hint": "Enter to send · Shift+Enter for a new line",
  "task.composer.attach": "Attach",
  "task.composer.attach.image": "Add image",
  "task.composer.attach.paste": "Paste image",
  "task.composer.attach.file": "Add file",
  "task.composer.attach.remove": "Remove {name}",
  "task.composer.attach.tooBig": "That file is too large to attach.",
  "task.composer.attach.binary": "Only images and text files can be attached.",
  "task.composer.attach.unreadable": "That file could not be read.",
  "task.composer.attach.empty": "That file is empty.",
  "task.composer.attach.limit": "You can attach up to {count} files.",
  "task.composer.attach.pasteFailed": "Could not read an image from the clipboard. Paste it into the message field instead.",
  "task.composer.attach.imagesOnly": "Look at the attached image.",
  "task.composer.attach.imagesOnlyMany": "Look at the attached images.",
  "task.composer.attach.named": "Attached: {names}",
  "task.empty.suggestion.one": "Explain what this project does",
  "task.empty.suggestion.two": "Find and fix the failing test",
  "task.empty.suggestion.three": "Add tests for the last change",
  "task.composer.send.queued": "The agent finishes the turn it is on, then reads this.",
  "task.composer.send": "Send",
  "task.composer.start": "Start",
  "task.composer.resume": "Resume — continue the previous session",
  "task.composer.submit.blocked": "Answer the request above first",

  /* ── the four controls above the field: the folder, the agent's mode, its model, how it thinks ──
     All four share one property: a choice made while a turn is running applies to the **next** run. That
     is said **once**, under the row, and only while a turn is running. It used to be a sentence per
     control — four near-identical paragraphs above the field the user was typing into — and the owner's
     report was exact: *"These texts are useless, but make the chats inputting messy."* A control that
     cannot be used still says why: **on itself**, as its tooltip and its `aria-describedby`, rather than
     as a paragraph about it (`docs/settings-parity.md` §7.30). */
  "task.composer.value.default": "Default",
  "task.composer.appliesNextRun": "Applies to the next run.",
  "task.composer.hint.mode": "How much this agent may do without asking",
  "task.composer.hint.model": "Change model",
  "task.composer.hint.thinking": "Thinking mode",
  "task.composer.hint.fast": "Toggle fast mode",
  "task.composer.hint.plan": "Toggle plan mode",
  "task.composer.work.label": "Work",
  "task.composer.hint.work": "Agent does the work. Plan only looks and proposes.",
  "task.composer.work.agent": "Agent",
  "task.composer.work.plan": "Plan",
  "task.composer.folder.aria": "Change this task's folder",
  "task.composer.folder.noPicker":
    "This window has no folder chooser, so this task's folder cannot be changed here.",
  "task.composer.agentMode.label": "Mode",
  "task.composer.agentMode.title": "What the agent is allowed to do in this task",
  // What the picker shows in place of a mode, in the two states where there is none to show. The
  // sentence under it is always the specific reason; this is only the control's own value.
  "task.composer.agentMode.unset": "Not set",
  // The two reasons a picker can be off, and they are different facts: the first is about the agent,
  // the second about our adapter. Both are catalogue strings because both are read by a user.
  "task.composer.agentMode.none": "{agent} does not offer selectable modes.",
  "task.composer.agentMode.notWired":
    "Choosing a mode for {agent} is not wired up yet, so the picker is off rather than silently ignored.",
  // A third, and the one that is easiest to mistake for the first: nothing has told us yet.
  "task.composer.agentMode.unknown":
    "EnvoyDev has not been told which modes {agent} offers yet, so the picker is off for now.",

  /* ── the model the task runs on ──
     The third control, and the one with the most ways to be wrong, so its states are spelled out.
     The list, when there is one, comes from the agent itself (`HarnessSummary.models`); the two
     sentences below it exist because "we have no list" has two entirely different causes — the agent
     publishes none but takes one, or we have not been told yet — and only one of them means the user
     cannot choose. */
  "task.composer.model.label": "Model",
  "task.composer.model.title": "Which model the agent uses for this task",
  // The picker's own "no model chosen" value, and free text's placeholder. Both say *whose* default
  // applies, because "default" alone leaves the user guessing whose.
  "task.composer.model.agentDefault": "The agent's own default",
  "task.composer.model.placeholder": "provider/model",
  "task.composer.model.placeholderBare": "model id",
  // Why the control is off. Three facts, three sentences — folding them together is how a user
  // concludes an agent has no models when it has some we cannot reach.
  "task.composer.model.none": "{agent} does not take a model.",
  "task.composer.model.configure": "Set a model in Settings. Envoy Harness does not include one.",
  "task.composer.model.notWired":
    "Choosing a model for {agent} is not wired up yet, so the control is off rather than silently ignored.",
  "task.composer.model.unknown":
    "EnvoyDev has not been told which models {agent} offers yet, so the control is off for now.",
  // The free-text case: the agent accepts a model and publishes no list we can read before a run
  // exists. The field is *usable* — this note says what shape the value has to be, and why.
  "task.composer.model.freeText":
    // Deliberately **no worked example containing a provider name.** The value has to use the provider
    // name the agent itself uses, and that is the agent's own catalog id — verified against the real
    // binary, where it is `deepseek-official` and not `deepseek`. An example would teach the wrong name
    // and every copy of it would go stale with somebody else's catalog.
    "{agent} publishes its models only inside a running session, so there is no list to choose from here. Type one as provider/model, using the provider name {agent} itself uses — and if it does not have that model the run stops with the agent's own words, rather than quietly using another one.",
  // Claude / Codex / Cursor: the select value is a bare model id. Optional until a session lists them;
  // leaving the field empty uses the agent's own default (credentials stay in that CLI).
  "task.composer.model.freeTextBare":
    "{agent} publishes its models only inside a running session. Leave this empty to use {agent}'s own default, or type a model id it accepts — custom providers are configured in that agent's own settings, not here.",
  // …and the one note that is not a refusal *or* an instruction: the list on screen came from a real
  // session, at a real time, and is therefore a record rather than a promise. Printed instead of a
  // "where the list came from" line, because the answer to that question is what changes the user's
  // expectations — a model list is per machine, per credential and per agent build.
  "task.composer.model.observed":
    "These are the models {agent} listed when EnvoyDev last opened a session with it, on {at}. It may publish different ones next time.",

  /* ── the thinking level ──
     The fourth control, and the first one whose options exist **nowhere but in a session**: an agent
     publishes its thought levels in the `session/new` response, so before a run there is nothing to
     read — not in a catalogue and not in a fixture. Hence a state the earlier controls do not have:
     "we have not seen a session yet", which is our ignorance and must never be rendered as "this agent
     has none". `deepseek-harness`'s own name for the option is `reasoning_effort`; a user reads
     "thinking", which is the word Paseo's control row uses. */
  "task.composer.thinking.label": "Thinking",
  "task.composer.thinking.title": "How much the agent thinks before it answers",
  // The control's own "no level chosen" value. The agent's words for this state are its own — and for
  // an agent that publishes a value for it (`"Provider default"`) that value maps here, because the two
  // are one state: nothing is sent, and the agent decides.
  "task.composer.thinking.agentDefault": "The agent's own default",
  // Why the control is off. Three facts, as with the model: the agent offers none, it offers levels we
  // have not seen yet, or this build cannot deliver one. Only the first is about the agent.
  "task.composer.thinking.none": "{agent} does not offer a thinking level.",
  "task.composer.thinking.notSeen":
    "EnvoyDev has not opened a session with {agent} yet, and {agent} only lists its thinking levels inside a session — so there is nothing to choose from until it has run once.",
  "task.composer.thinking.notWired":
    "Choosing how much {agent} thinks is not wired up yet, so the control is off rather than silently ignored.",
  "task.composer.thinking.unknown":
    "EnvoyDev has not been told what {agent} offers yet, so the control is off for now.",
  // The observation, said out loud — and it carries more weight here than for the model, because a
  // thought level is derived from the model the session resolved: the list describes the model that
  // agent last ran on, so a user who changed the model may see a level the agent no longer accepts.
  // When it refuses one, the run stops with the agent's own sentence rather than continuing quietly.
  "task.composer.thinking.observed":
    "These are the thinking levels {agent} offered when EnvoyDev last opened a session with it, on {at}. They were listed for the model it was running then, so they can change.",

  /* ── asking the agent what it offers, before the first run ──
     The model list and the thinking levels of both native harnesses exist only *inside a session*, so
     before a first run there was nothing to render and the user typed `provider/model` from memory.
     These five sentences are the whole surface of the pre-flight probe: what the control says while a
     probe runs, the button that starts one, and the two outcomes that are not a list.

     Two of them (`probe.none`, `probe.failed`) are authored by the **daemon** — its answer carries the
     key and the window renders it, the same arrangement the approval prompts and the refusals use. The
     daemon names the agent through `{agent}`, and `probe.failed` interpolates `{reason}`, which is the
     agent's or the operating system's own words and stays in whatever language it was produced. */
  "task.composer.probe.ask": "Ask {agent} what it offers",
  "task.composer.probe.askAgain": "Ask {agent} again",
  // While it runs, the control says so *and* says what it costs — an agent process, briefly. A control
  // that showed an empty picker instead would be the lie this whole row exists to prevent.
  "task.composer.probe.asking":
    "Asking {agent} what it offers. EnvoyDev starts it, asks, and closes it again — nothing is sent to it.",
  // The agent answered and had nothing to publish: a fact about the agent, not about our ignorance.
  "task.composer.probe.none":
    "{agent} answered and published nothing to choose from, so there is still no list here — type a value it documents, or pick one after the first run.",
  // We never got to ask. Named separately from "it published nothing" on purpose: reporting our failure
  // as a fact about the agent is the defect this distinction exists to prevent.
  "task.composer.probe.failed":
    "EnvoyDev could not ask {agent} what it offers: {reason} Nothing you see has changed.",

  /* ── the modes an agent can be put into, in our words rather than the agent's ──
     `AgentMode.labelKey`/`descriptionKey` point here for every mode **we** named; a mode a
     third-party agent named itself carries no key and is shown as the agent wrote it. */
  "task.agentMode.default.label": "Default",
  "task.agentMode.default.description": "Do the work. Ask before a command or a change, not before each read.",
  "task.agentMode.plan.label": "Plan",
  "task.agentMode.plan.description": "Investigate and propose a plan. Change nothing yet.",
  "task.agentMode.review.label": "Review",
  "task.agentMode.review.description": "Check and report. Change nothing.",
  "task.agentMode.readOnly.label": "Read only",
  "task.agentMode.readOnly.description": "Read files. Do not change them, and do not ask before each read.",
  "task.agentMode.workspace.label": "Project change",
  "task.agentMode.workspace.description": "Change files in this project. Ask only before a command or a change outside it.",
  "task.agentMode.fullAccess.label": "Full access",
  "task.agentMode.fullAccess.description": "The whole computer, without asking.",

  /* ── a status, in the words a user reads ── */
  "status.queued": "Waiting to start",
  "status.running": "Working",
  "status.needsAttention": "Needs your answer",
  "status.idle": "Idle",
  "status.done": "Finished",
  "status.failed": "Stopped with an error",
  "status.cancelled": "Stopped",

  /* ── lines the transcript folds out of run events ── */
  "run.end.done": "Finished.",
  "run.end.cancelled": "Stopped.",
  "run.end.failed": "Stopped before it finished.",
  "run.end.other": "Ended.",
  "run.diff.one": "1 file changed.",
  "run.diff.many": "{count} files changed.",
  "run.tools.edited.one": "edited 1 file",
  "run.tools.edited.many": "edited {count} files",
  "run.tools.ran.one": "ran 1 command",
  "run.tools.ran.many": "ran {count} commands",
  "run.tools.searched.one": "searched once",
  "run.tools.searched.many": "searched {count} times",
  "run.tools.other.one": "used 1 tool",
  "run.tools.other.many": "used {count} tools",
  "run.tools.summary.empty": "Tools",
  "run.tools.summary.two": "{a} and {b}",
  "run.tools.summary.many": "{head}, and {last}",
  "run.tools.summary.comma": ", ",
  "run.context": "Context {percent}% full.",

  /* ── the status line, and the one place the mesh is always visible ──
     `mesh.hosting` is deliberately **count-free**, and this is a correctness rule rather than a style
     choice. `peerCount` is every libp2p connection the daemon's own peer holds — today that is almost
     always the two community relays (`coderMeshOptions` keeps DHT / mDNS / AutoNAT / bootstrapPeers
     off so the phone-facing host does not join the public swarm). It is never "phones paired to this
     user". A headline that once read "30 machines connected" on a machine that had paired nothing
     asserted a capability the protocol never granted. So the sentence states the one fact that is
     always true — this machine hosts the mesh — and the peer total, which is real, is labelled for
     what it is (`mesh.peers`) in the tooltip beside the peer id. */
  "mesh.attached.peers": "Mesh connected — {count} machines reachable",
  "mesh.attached.none": "Mesh connected — no other machines reachable yet",
  "mesh.noNode": "Standalone — tasks stay on this machine",
  "mesh.refused": "Could not start this machine's mesh peer — tasks stay local. Pairing still works by address.",
  "mesh.hosting": "Hosting this mesh",
  "mesh.hosting.title": "Mesh peer {peerId}",
  "mesh.peers": "{count} peers on the shared mesh",
  "mesh.scope.title": "Session scope {scope}",
  "mesh.agentsHere": "Agents run on this machine",

  /* ── settings ──
     Grouped, and grouped by the question a user is asking rather than by the storage that answers it:
     "what does this app do by default", "what does a new task start with", "what may an agent do
     without me". The headings are sentence case and are not labels — nothing on this pane needs one. */
  "settings.title": "Settings",
  "settings.close": "Close",
  // Narrow windows: leave a section for the list of every section (the only index that shape has).
  "settings.back": "All settings",
  "settings.back.title": "Back to this machine's settings",
  // Wide windows: leave settings for the project rail. The section bar already lists every section, so
  // "All settings" would reopen the same index beside itself.
  "settings.exit": "Back to work",
  "settings.exit.title": "Leave settings and return to your projects",
  "settings.stateDir": "State in {path}",
  "settings.noDaemon": "No daemon",
  "settings.daemon": "Daemon {version}",
  "settings.daemon.title": "The daemon this window is attached to",
  /* ── the sections, and the bar that lists them ──
     One key per section, and it is the name of **one place**: the bar item's label, the page's own
     title, the row on the list of sections, and the label of the back control on any page below it. The
     registry that holds them is `apps/desktop/src/state/settings-sections.ts`; `settings.section.*` is
     therefore a list of places rather than a list of headings on one page, which is what the four
     `settings.group.*` keys this replaced used to be.
     `settings.projects.title` names the Projects section too, and is deliberately not duplicated here:
     it was already one string used three times, and a second key for the same place is a second thing to
     keep translated and true. */
  "settings.nav.aria": "Settings sections",
  "settings.sections.note": "This window's settings, section by section.",
  "settings.section.general.title": "General",
  "settings.section.general.detail":
    "The language this window speaks, and the folder a new project starts from.",
  "settings.section.appearance.title": "Appearance",
  "settings.section.appearance.detail": "Light, dark, or the same as this computer.",
  "settings.section.tasks.title": "New tasks",
  "settings.section.tasks.detail":
    "The agent, the model and the arguments every new task starts with.",
  "settings.section.safety.title": "Safety",
  "settings.section.safety.detail":
    "What an agent may do without asking you, and what is kept afterwards.",
  "settings.section.agents.title": "Agents",
  "settings.section.agents.detail":
    "Every agent this machine can run, and what each one says it can do.",
  "settings.section.llm.title": "LLM",
  "settings.section.llm.detail": "Base URL, model and API key for Envoy Harness.",
  "settings.section.shortcuts.title": "Keyboard shortcuts",
  "settings.section.shortcuts.detail":
    "Every key this window is listening for, read from the table the keyboard layer reads.",
  "settings.section.machine.title": "This machine",
  "settings.section.machine.detail":
    "The daemon this window is attached to, and what it was started with.",
  "settings.section.pairing.title": "Mobile Pairing",
  "settings.section.pairing.detail":
    "Let a phone reach this machine: scan a code, type its address, or go through SSH.",
  "settings.section.service.title": "Background service",
  "settings.section.service.detail":
    "Keep the daemon running under this system's service manager, so a paired phone can reach it while the window is closed.",
  "settings.section.about.title": "About",
  "settings.section.about.detail":
    "Which build this window is, and which build the daemon is.",
  "settings.language.title": "Language",
  "settings.language.detail": "Every label, notice and error, including the daemon's.",
  "settings.language.aria": "Language",
  "settings.language.system": "Same as this computer",
  "settings.theme.title": "Theme",
  "settings.theme.detail": "Light, dark, or follow this computer.",
  "settings.theme.aria": "Theme",
  "settings.theme.dark": "Dark",
  "settings.theme.light": "Light",
  "settings.theme.system": "Same as this computer",
  "settings.folder.choose": "Choose…",
  "settings.defaultPath.title": "The folder Add project starts in",
  "settings.defaultPath.detail": "Pre-filled when you add a project.",
  "settings.defaultPath.placeholder": "/Users/you/work",
  "settings.defaultHarness.title": "The agent new tasks start with",
  "settings.defaultHarness.detail": "A project can override this; this is the answer when it does not.",
  "settings.defaultHarness.catalog": "Not installed here? See {section}.",
  "settings.defaultModel.title": "The model new tasks start on",
  "settings.defaultModel.detail": "Empty means the agent chooses.",
  "settings.extraArgs.title": "Extra arguments for the agent",
  "settings.extraArgs.detail": "Added to the agent's command line for every task.",
  "settings.extraArgs.placeholder": "--verbose",
  "settings.approvals.title": "Ask before anything destructive",
  "settings.approvals.detail": "Ask before commands and changes, not reads. A task's mode can allow more.",
  "settings.approvals.reaches":
    "Handed to {agent} as its own policy for every run, so the asking happens where the work does.",
  "settings.approvals.unsupported":
    "EnvoyDev cannot change this for {agent}: it has no way to be told, and asks on its own terms. Pick an agent EnvoyDev can hand a policy to, or answer {agent}'s own prompts.",
  "settings.approvals.unknown":
    "EnvoyDev has not been told what {agent} accepts yet, so this stays off rather than storing a choice nothing reads.",
  "settings.transcripts.title": "Keep transcripts after a task ends",
  "settings.transcripts.detail": "Keep the record of what the agent did.",
  "settings.project.title": "Project settings for {project}",
  "settings.project.detail": "These override this machine's settings.",
  // Level 3's back control, which lands on the projects page and therefore must not say "All settings":
  // a control that names the root while returning to a list is a lie. Its visible label is that page's
  // own title (`settings.projects.title`) rather than a key of its own — one place, one name — so all
  // this key has to carry is the sentence a hover shows.
  "settings.project.back.title": "Back to the list of projects",
  "settings.project.folder.title": "Folder",
  "settings.project.folder.detail": "Where agents run for tasks in this project.",
  "settings.project.harness.title": "The agent new tasks here start with",
  "settings.project.harness.detail": "Overrides the agent chosen for this machine.",
  "settings.project.model.title": "The model new tasks here start on",
  "settings.project.model.detail": "Overrides this machine's model. Empty means the agent decides.",
  "settings.project.extraArgs.detail": "Added to the agent's command line for this project.",
  /* ── the projects page (level 2), and the row at level 1 that opens it ──
     Three levels, one pane: this machine's settings (level 1) carries one row whose second band is how
     many projects are registered, that row opens the list (level 2), and a row of the list opens that
     project's own defaults (level 3). The list is navigation, not settings: it shows what is registered
     and opens the scope that owns the per-project rows.
     `settings.projects.title` is deliberately one string used three times — the level-1 row's label, the
     level-2 page title, and level 3's back label — because all three name the same place, and a name
     that is stored once cannot drift between them.
     `{add}` is the rail's own Add-project label (`sidebar.add`) rather than the word "Add"
     repeated here, so the sentence keeps naming the control it means when the control is renamed or
     translated. */
  "settings.projects.title": "Projects",
  "settings.projects.count": "{count} projects",
  "settings.projects.count.one": "1 project",
  "settings.projects.count.none": "No projects",
  // The third form, and it is not a count at all: the window could not read the list, so it has no number
  // to give. "No projects" here would be the rail's own historical defect — telling a user their work is
  // gone when the truth is that nobody asked successfully.
  "settings.projects.count.unknown": "Could not be read",
  "settings.projects.note":
    "Each project can override this machine's settings. Selecting one opens its own.",
  "settings.projects.empty":
    "No projects yet. A project is a folder on this machine that agents work in — add one with {add} at the top of the rail, or from the Command Center.",
  "settings.agents.empty": "The agent list has not arrived yet.",

  /* ── the catalogue: the 38 recipes, the two extra ways to get an agent, and the words that keep the
     screen from claiming more than it measured ──

     This is the product's core screen — *the control plane for coding agents* — and three of the strings
     below exist only to stop it lying:

       * `settings.agent.unchecked` is the state a catalogue row starts in. It is **not** the daemon's
         `unknown`: that one means "we tried to look and had nothing to search", and this one means nobody
         has looked yet. A row that rendered either of them as `ready` would be claiming a measurement
         nobody took, and a row that rendered them as "not installed" would be claiming the opposite. */
  "settings.agents.shipped.heading": "Agents",
  "settings.agents.mine.heading": "Your agents",
  "settings.agents.mine.empty":
    "Nothing added from the catalogue yet. Browse below to put an agent on this list, or declare a program that is not catalogued.",
  "settings.agents.mine.command": "Runs as: {command}",
  "settings.agents.mine.remove": "Remove",
  "settings.agents.mine.remove.title": "Forget {agent}. Nothing is uninstalled, and nothing else is touched.",
  "settings.agents.signIn": "Sign in",
  "settings.agents.signIn.working": "Signing in…",
  "settings.agents.signIn.title": "Run {agent}'s own sign-in flow, and say truthfully what happened",
  /**
   * **The agent that signs in through a terminal.**
   *
   * Copilot advertises `copilot-login` with ACP's `_meta["terminal-auth"]` and answers `authenticate` with
   * `-32000 Authentication required` (measured), so a **Sign in** button for it would be a press that changes
   * nothing. The row shows the instruction and the command instead — the command verbatim, because a translated
   * command is a command that does not run.
   */
  "settings.agents.signIn.terminal": "To sign in, run this in your terminal:",
  /**
   * Envoy Harness LLM panel — built-in agent only. The API key stays under secretsDir on this machine.
   */
  "settings.agents.envoyLlm.configure": "Configure LLM",
  "settings.agents.envoyLlm.hide": "Hide LLM settings",
  "settings.agents.envoyLlm.open": "LLM settings",
  "settings.agents.envoyLlm.open.title": "Base URL, model and API key for Envoy Harness.",
  "settings.agents.envoyLlm.configure.title":
    "Provider, model, optional base URL, and API key for Envoy Harness on this machine.",
  "settings.agents.envoyLlm.heading": "Envoy Harness LLM",
  "settings.agents.envoyLlm.note":
    "Envoy Harness uses this. Other agents keep their own sign-in. The key stays on this computer.",
  "settings.agents.envoyLlm.provider": "Provider",
  "settings.agents.envoyLlm.model": "Model",
  "settings.agents.envoyLlm.model.placeholder": "MiniMax-M3",
  "settings.agents.envoyLlm.model.detail": "The model id from your provider, for example MiniMax-M3.",
  "settings.agents.envoyLlm.baseUrl": "Base URL",
  "settings.agents.envoyLlm.baseUrl.placeholder": "Optional — LiteLLM or a proxy",
  "settings.agents.envoyLlm.baseUrl.detail":
    "Leave empty to use the provider's own address; one address is not both formats.",
  "settings.agents.envoyLlm.apiKey": "API key",
  "settings.agents.envoyLlm.apiKey.placeholder": "Paste a new key to replace the saved one",
  "settings.agents.envoyLlm.apiKey.detail": "Write-only: EnvoyDev never shows a saved key again.",
  "settings.agents.envoyLlm.apiKey.saved": "API key saved on this machine.",
  "settings.agents.envoyLlm.apiKey.clear": "Clear",
  "settings.agents.envoyLlm.save": "Save",
  "settings.agents.envoyLlm.saving": "Saving…",
  "settings.agents.envoyLlm.saved": "Saved.",
  "settings.agents.envoyLlm.loading": "Loading LLM settings…",
  "settings.agents.olderDaemon":
    "The daemon this window is talking to is an older build and does not have this part of the agent list, so it cannot be shown here. Restart EnvoyDev so the window and its daemon are the same build.",
  /**
   * **The catalogue is a group with a count and two ways in, not thirty-eight expanded rows.**
   *
   * Measured before this slice: the group held **10,817 visible characters and 38 rows** — 71% of the Agents
   * page and 5,835px of its 8,391 (`docs/settings-parity.md` §7.14). A user who opened *Settings* to change
   * their language scrolled past every recipe in the catalogue to find out they were on the wrong page.
   *
   * The long sentence that used to sit above the list is now the browse button's `title`. It is a real
   * explanation — why nothing is checked until you ask, and why checking is one row at a time — and it belongs
   * where a user who wonders finds it rather than in the path of a user who does not.
   */
  "settings.agents.catalog.heading": "Catalogue",
  "settings.agents.catalog.browse": "Browse the catalogue",
  "settings.agents.catalog.hide": "Hide the catalogue",
  "settings.agents.catalog.browse.title":
    "Recipes EnvoyDev knows how to drive. Whether this machine can run one is a fact somebody has to measure, so nothing is checked until you ask — one row at a time, because checking walks this machine's program folders.",
  "settings.agents.search.label": "Search the catalogue",
  "settings.agents.search.placeholder": "Name, id or description",
  "settings.agents.add.noMatches": "No catalogued agent matches “{query}”.",
  "settings.agents.row.version": "Version {version}",
  /**
   * **The row's own disclosure**, and the label a screen reader gets for it.
   *
   * Eight buttons called *Details* is a list a screen-reader user cannot navigate, so the accessible name
   * carries the agent's name and the visible label does not (the name is already on the row, three words to
   * the left).
   */
  "settings.agents.row.details": "Details",
  "settings.agents.row.details.aria": "Details for {agent}",
  "settings.agents.row.nothingToInstall": "Nothing to install",
  /** The row's line when the daemon is a build behind: the action, in four words, not the essay. */
  "settings.agents.row.restart": "Restart EnvoyDev",
  "settings.agents.row.add": "Add",
  "settings.agents.row.adding": "Adding…",
  "settings.agents.row.add.title":
    "Add {agent} to your agents. Its command line and its environment come from this entry exactly as they are written above — the recipe's own constants travel with it, and any variable the recipe does not set stays yours to set.",
  "settings.agents.row.pick.short": "Pick for a task",
  "settings.agents.row.pick.title":
    "Choose {agent} from a task, project, or New tasks default. EnvoyDev adds the recipe automatically when you pick it.",
  "settings.agents.row.builtIn.short": "Built in",
  "settings.agents.row.builtIn":
    "EnvoyDev already ships this agent, so it is on the Agents list above rather than added a second time.",
  "settings.agents.row.installLink": "Where to get it",
  "settings.agents.row.installLink.title": "{agent}'s own page",
  /**
   * **Looking at this machine again**, and the two things the control says.
   *
   * The owner's question, verbatim: *"After I run
   * `npm install -g @agentclientprotocol/codex-acp`, how do we let EnvoyDev know that without
   * restarting?"* The answer is a press rather than a restart: `coder.recheckAgents` re-asks the login shell
   * where the user's programs are and re-reads every row. `title` says what the press does **and what it does
   * not do** — nothing is started — because that is the question a careful user asks before pressing a button
   * on a page about their machine.
   */
  "settings.agents.recheck": "Check again",
  "settings.agents.recheck.busy": "Checking…",
  "settings.agents.recheck.title":
    "Ask your login shell where your programs are, and re-read every agent's state. Nothing is started and nothing is installed.",
  /**
   * **The delivery choice, and what it says on the row.**
   *
   * The one control in this product that changes *what runs*: `npx` fetches the connector from npm on its first
   * run instead of using one installed on the machine. Both labels say what they do; the `title`s say the part a
   * user cannot see — that fetching downloads a package the first time, and that switching back stops it.
   */
  "settings.agents.delivery.npx": "Run it through npx",
  "settings.agents.delivery.npx.title":
    "Fetches the connector from npm the first time it runs, and starts it from npm's cache afterwards. Nothing is installed on this machine.",
  "settings.agents.delivery.installed": "Use the installed copy",
  "settings.agents.delivery.installed.title":
    "Stops fetching: the launch goes back to the connector installed on this machine.",
  /**
   * **The other route, still written down.**
   *
   * The owner's requirement: *"we should keep the command text, but also provide the exec button. Not to remove
   * the text. The user can install it by himself."* A fetched delivery makes the row Ready, and `Ready` plus an
   * empty fix list quietly removed the install command from the screen — so this is the sentence that leads the
   * block that keeps it, with the Copy control and the press beside it.
   */
  "settings.agent.installRoute.lead": "To install it on this machine instead — for example to stop fetching it — run this:",
  "settings.agent.fact.delivery": "Delivered by",
  "settings.agent.fact.delivery.npx": "npm, fetched on the first run",
  "settings.agent.fact.delivery.installed": "Installed on this machine",
  /* The row's own line for an agent whose connector is fetched — `Ready`, and how. */
  "settings.agent.verdict.fetch.line": "Runs through npx",
  /* The refusal when a connector is not on npm at all: no route to fetch, so nothing is stored. */
  "error.connectorNotFetchable":
    "{harness} has no connector published on npm, so EnvoyDev cannot fetch it. Install it instead.",
  /**
   * **The press that runs the fix.** The owner's second question, in the words a user sees: *"can we support run
   * the commands in EnvoyDev?"*
   *
   * `run` is the button, `busy` is what it says while the shell is working, and `title` says what the press does
   * **and what it does not do** — it runs the command above, in a login shell, in the user's home folder, and
   * changes nothing else. The four outcomes are the daemon's four (`coder.runFix`), each as a sentence: done,
   * failed with the exit code, nothing to do because the world moved, or refused. `timedOut` is separate from
   * `failed` because "it was stopped" and "it failed" are different things to be told while waiting.
   */
  "settings.agents.fix.run": "Install",
  "settings.agents.fix.run.busy": "Installing…",
  "settings.agents.fix.run.title":
    "Runs the command above in a login shell, in your home folder. Nothing else on this machine is changed.",
  "settings.agents.fix.run.done": "Done — this list updates by itself.",
  "settings.agents.fix.run.nothing": "Nothing to install: this agent is ready now.",
  "settings.agents.fix.run.refused": "That agent is no longer in this list.",
  "settings.agents.fix.run.timedOut": "It took too long and was stopped. The output below is where it got to.",
  "settings.agents.fix.run.failed": "The command exited with {code}. Its output:",
  /**
   * **The fix block's one control.** Copy, and the two things that can happen when it is pressed.
   *
   * The command is never translated — a translated `npm install -g …` is a command that does not run — so
   * these four strings are all the copy control ever says. `copy.aria` names exactly what will be copied,
   * because a list of eight buttons called *Copy* is a list a voice-control user cannot navigate; and it
   * begins with the printed word, which is what WCAG 2.5.3 asks of a label that repeats down a list.
   */
  "settings.agents.fix.copy": "Copy",
  "settings.agents.fix.copied": "Copied",
  "settings.agents.fix.failed": "Copy failed",
  "settings.agents.fix.copy.aria": "Copy {command}",
  "settings.agents.manual.open": "Add a program of my own",
  "settings.agents.manual.open.title":
    "If you already have a coding agent that speaks the Agent Client Protocol and it is not in the catalogue, declare it here. EnvoyDev will start it and probe it exactly as it does the others.",
  "settings.agents.manual.heading": "Programs you declare",
  "settings.agents.manual.label": "What to call it",
  "settings.agents.manual.command": "Program",
  "settings.agents.manual.args": "Arguments",
  "settings.agents.manual.env": "Environment variable names",
  "settings.agents.manual.env.detail": "Names only, never values.",
  "settings.agents.manual.transport": "How EnvoyDev must speak to it",
  "settings.agents.manual.transport.detail": "No default: a wrong guess fails silently.",
  "settings.agents.manual.transport.acp": "Agent Client Protocol (can be run and driven)",
  "settings.agents.manual.transport.cli": "A plain command line (startable, not yet drivable)",
  "settings.agents.manual.submit": "Add this agent",
  /**
   * **The verdict: two words, and the five ways a row can be Not ready.**
   *
   * The mandate, verbatim: *"I don't want user to guess, to check if we can do that. And If the agent cannot be
   * used - 'Not Ready', we should clearly know what the problem is and guide user to resolve it if he want to
   * use this coding agent."* Plus the vocabulary from the two messages before it: one verdict per row —
   * **Ready / Not ready** — with caveats as properties rather than chips, and "Not checked" gone entirely.
   *
   * So the row's chip is one of these two and nothing else, and everything below is either the **line** that
   * names the specific problem or the **guide** the disclosure leads with. Each guide's `why` is written to be
   * read *first*, before the facts, which is why they are sentences about this row rather than headings: the
   * user has already decided to look, and what they need is the sentence that tells them what to do.
   *
   * The distinction the whole block turns on is that `gap.why` and `unlooked.why` describe **our** shortfall
   * and offer nothing to install, while `connector.why`, `absent.why` and `env.why` describe something the
   * user can do. An install command under a sentence about our missing adapter is the exact failure the
   * mandate names.
   */
  "settings.agent.verdict.ready": "Ready",
  "settings.agent.verdict.notReady": "Not ready",
  "settings.agent.verdict.notReady.aria": "Not ready — see how to resolve this for {agent}",
  // A daemon from an older build cannot answer the question at all, which is a fact about the app's two
  // halves rather than about the machine. The line names it; the guide names the action, which is not an
  // install — nothing is missing from the user's machine and telling them to install something would be the
  // lie this whole slice exists to avoid.
  "settings.agent.verdict.legacy.line": "EnvoyDev is a build behind",
  "settings.agent.verdict.legacy.why":
    "This window is talking to an older EnvoyDev daemon, so it cannot say what this machine can do with {agent}. Nothing is missing from your machine — the app's own two halves are different builds.",
  "settings.agent.verdict.unlooked.line": "EnvoyDev could not check this machine",
  "settings.agent.verdict.unlooked.why":
    "This is our gap and not a verdict about {agent}: EnvoyDev could not read this machine's program folders, so it knows nothing about whether the agent is installed. There is nothing for you to install on the strength of this row.",
  "settings.agent.verdict.app.restart": "Restart EnvoyDev",
  // **The reported bug, fixed in the words.** The owner wrote *"Some agents I have installed, but still show
  // need to install or need adapter. Eg, codex, claudecode, deepseek-harness."* For Codex and Claude Code the
  // measurement was right and the row misled: the state is "the agent's own CLI resolved and our adapter did
  // not", and the old row's only sentence was the adapter's install command. So this leads with **what is
  // present** — the thing the user is looking at and believes the app has not noticed — and the command
  // follows on the same line, in its own face, verbatim.
  "settings.agent.verdict.connector.lead": "Installed — needs its connector",
  "settings.agent.verdict.connector.why":
    "{agent} is installed. EnvoyDev needs its connector to drive it, and that is the one piece that is missing:",
  // Nothing resolved over a search that actually ran. The only Not-ready case allowed to lead with an install
  // command, and the only one whose sentence asserts an absence.
  "settings.agent.verdict.absent.short": "Not installed",
  "settings.agent.verdict.absent.why": "{agent} is not installed on this machine. Run these in the order they are listed:",
  // **Our gap, said as ours.** A catalogue entry tagged `transport: "cli"` or a provider a user declared as a
  // plain command line resolves and runs — and this build has no adapter for the way it speaks. There is
  // nothing to install, no page to read, and the value of saying so plainly is that a user stops hunting.
  "settings.agent.verdict.gap.line": "EnvoyDev cannot drive this agent yet",
  "settings.agent.verdict.gap.why":
    "This is EnvoyDev's gap, not a missing program: {agent} is reached over a kind of interface this build has no adapter for, and installing it again would change nothing. Nothing is wrong with your machine.",
  // The program is present and the daemon cannot start it, because a variable the launch needs is not set. The
  // variable is **named on the row** — the mandate's instruction — and the second half of this sentence says
  // where a value can come from, which is the question naming it raises.
  "settings.agent.verdict.env.line": "{name} is not set",
  "settings.agent.verdict.env.line.more": "{name} is not set, and {count} more",
  "settings.agent.verdict.env.why":
    "{agent} is installed. Set {names} in the environment EnvoyDev's daemon was started in — a value can only come from you, because EnvoyDev never writes a credential down.",
  /**
   * **The properties: what used to be chips.**
   *
   * The owner's vocabulary is that caveats (`no approvals`, `cannot be cancelled`, `temporary copy`) are
   * properties rather than chips, and the shape they asked for is a plain sentence —
   * `Asks before acting: no · Can be stopped: no · Temporary copy (npm cache)`. These are its labels and
   * values: a definition list, so a screen reader reads "Asks before acting, no" and a sighted user reads a
   * label and a value.
   *
   * `verified` is the deep facts' **time**, and it is the answer to the mandate's third rule — that whether an
   * agent speaks ACP, what it publishes and whether it wants a sign-in are learned by starting it, so they
   * must never be a state a user has to press something to learn. The value is a relative time from
   * `formatAgo` (`4 minutes ago`, in all seven languages, from the platform's own formatter) followed by the
   * absolute timestamp. `verified.never` says **why** it is not there rather than leaving a blank, because a
   * blank invites exactly the hunt this design removes.
   */
  "settings.agent.fact.provenance": "Provenance",
  "settings.agent.fact.obtained": "Obtained",
  "settings.agent.fact.obtained.npx": "Fetched from npm on the first run ({package})",
  "settings.agent.fact.obtained.path": "Installed at {path}",
  "settings.agent.fact.runs": "Runs as",
  "settings.agent.fact.asksBefore": "Asks before acting",
  "settings.agent.fact.canBeStopped": "Can be stopped",
  "settings.agent.fact.yes": "Yes",
  "settings.agent.fact.no": "No",
  "settings.agent.fact.signIn": "Will talk to us",
  "settings.agent.fact.signIn.needed": "Not yet — it needs a sign-in first",
  "settings.agent.fact.signIn.done": "Yes",
  "settings.agent.fact.signIn.unknown": "Not established yet",
  "settings.agent.fact.verified": "Verified",
  "settings.agent.fact.verified.never":
    "Not yet — EnvoyDev starts an agent to learn this, so it arrives when a task runs rather than when this page opens",
  "settings.agent.fact.publishes": "What it publishes",
  "settings.agent.fact.env.recipe": "Supplied by this recipe",
  "settings.agent.fact.env.set": "Set in EnvoyDev's environment",
  "settings.agent.fact.env.unset": "Not set",
  /** The row's line for a catalogued program that is here and ready, where the next step is the Add button. */
  "settings.agents.row.readyCatalogued": "Installed — add it to use it",

  /* ── the five measured states, and where their words went ──
     A user with Claude Code, Codex and DeepSeek Harness all installed read **"Not installed"** for every one
     of them, because the chip had two words for five situations: an agent is not a binary, it is a binary
     *plus the adapter we drive it through*, and the adapter is a package the user was never told to install.
     Those five states are still what the daemon measures, and the words that name them are still needed —
     they are now the **guides** in `settings.agent.verdict.*` above rather than five chips, because the owner's
     instruction was that a row carries one verdict and that a row which is not ready says what to do about
     it. `settings.agent.provisional.*` survives as a **property** value: provenance is a caveat rather than a
     verdict, and the property says what removes the copy. */
  "settings.agent.provisional.npx":
    "Found in npm's npx cache, which `npm cache clean` removes. It works, but install the agent properly to keep it.",
  "settings.agent.provisional.bun-cache":
    "Found in Bun's package cache, which can be cleared at any time. It works, but install the agent properly to keep it.",
  "settings.agent.provisional.pnpm-dlx":
    "Found in pnpm dlx's throwaway store. It works, but install the agent properly to keep it.",
  /* ── what an agent says about itself, on the Agents page ──
     Read from `HarnessSummary`: the daemon's own answer, not our opinion. Two rules decide the wording.
     A value **we** wrote carries a catalogue key and is translated (`modeLabel`); a value the **agent**
     wrote is shown as the agent wrote it — a model label has no key in the protocol at all — which is the
     same rule the approval prompt's option labels follow. And the three states of `AgentThinking` are
     kept apart: `session` is not `none`, and telling a user their agent offers no thinking levels when
     the truth is that nobody has opened a session with it is the sentence the protocol forbids. */
  "settings.agent.tier.title": "Where it comes from",
  "settings.agent.tier.builtIn": "Ships with EnvoyDev",
  "settings.agent.tier.catalogued": "A tool from EnvoyDev's catalogue",
  "settings.agent.modes.title": "Modes it offers",
  "settings.agent.models.title": "Models it publishes",
  "settings.agent.modelsFreeText": "Any model you type for it",
  "settings.agent.thinking.title": "Thinking levels",
  "settings.agent.thinkingSession": "It lists these only inside a session, and none has run yet",
  "settings.agent.noneDeclared": "None declared",
  // A daemon one build behind does not send what an agent publishes about itself, and the window accepts
  // its answer rather than refusing the whole list. This is the sentence that says so — see
  // `DeclaredFacts` in `components/settings/SectionsFacts.tsx` for the crash it replaced.
  "settings.agent.notDeclared":
    "The daemon this window is talking to did not send what {agent} publishes about itself, so there is nothing to show here. That happens when the two are different builds; restart EnvoyDev so both come from one build.",

  /* ── the keyboard, listed from the table the key handler reads ──
     `settings.shortcuts.binding.*` are labels for ids in `input/shortcuts.ts`, which used to carry
     English sentences nothing rendered. The pane renders them now, which is why they are keys.
     `settings.shortcuts.note` says the one thing a reader has to know: a key that is not on this page
     does nothing in this build — three of the seven declared bindings have no action mounted, and a page
     that listed them would be advertising keys that do nothing. */
  "settings.shortcuts.note": "Keys this window listens for. One not listed here does nothing.",
  "settings.shortcuts.empty": "This build listens for no keyboard shortcuts.",
  "settings.shortcuts.group.general": "General",
  "settings.shortcuts.group.projects": "Projects and tasks",
  "settings.shortcuts.group.layout": "Layout",
  "settings.shortcuts.group.agentInput": "Agent input",
  "settings.shortcuts.binding.commandCenter": "Open the command center",
  "settings.shortcuts.binding.newTask": "New task",
  "settings.shortcuts.binding.search": "Search files and tasks",
  "settings.shortcuts.binding.windowNew": "New window",
  "settings.shortcuts.binding.settings": "Settings",
  "settings.shortcuts.binding.help": "Keyboard shortcuts",
  "settings.shortcuts.binding.interrupt": "Stop the agent",

  /* ── the daemon this window is attached to ──
     All of it is `coder.hello`'s own answer. The build and the state folder are also chips in the pane's
     header on every page — deliberately: a chip answers "which daemon am I talking to" while a user is
     reading something else, and this page is where the facts that do not fit in a chip live. */
  "settings.machine.note": "All of this is the daemon's own answer.",
  "settings.machine.noDaemon":
    "No daemon has answered this window yet, so there is nothing to report about one.",
  "settings.machine.version.title": "The daemon's build",
  "settings.machine.version.detail":
    "The version of the program that stores your settings and runs your agents.",
  "settings.machine.stateDir.title": "Settings and transcripts live in",
  "settings.machine.stateDir.detail": "Settings, projects and transcripts, in one folder.",
  "settings.machine.home.title": "The folder it treats as home",
  "settings.machine.home.detail": "Where ~ points for the agent's own commands.",
  "settings.machine.started.title": "Started at",
  "settings.machine.started.detail": "When this daemon process started.",
  "settings.machine.windows.title": "Windows attached",
  "settings.machine.windows.detail": "How many windows were attached when this window connected, including this one.",
  "settings.machine.windows.one": "1 window",
  "settings.machine.windows.many": "{count} windows",
  /* ── Pairing: three routes to this machine, each said on its own ──
     Its own section rather than a row on *This machine*, because *This machine* reports what the daemon
     said and pairing **acts**: it mints a bearer secret. The three blocks are three mechanisms — a scanned
     code, the same values typed, and an SSH hop that the code does not carry — so each gets its own
     heading instead of sharing one paragraph. */
  "settings.pairing.note":
    "Pairing lets a phone reach this machine. The code carries the address and a token, so keep it on screen only while the phone is scanning.",
  "settings.pairing.manage": "Codes you have issued are listed under This machine, where you can revoke one.",
  "settings.pairing.qr.title": "Scan a QR code",
  // The primary route, marked rather than merely listed first: a user reading the three headings has to be
  // told which one the product recommends.
  "settings.pairing.qr.primary": "Recommended",
  "settings.pairing.qr.detail":
    "Open EnvoyDev on the phone, choose Scan QR, and point the camera at this code.",
  "settings.pairing.qr.meshHosting":
    "This code includes a direct mesh route when the phone can reach this machine over the network.",
  "settings.pairing.qr.meshUnavailable":
    "The mesh peer is not hosting — this code still works over the network address and SSH.",
  "settings.pairing.qr.busy": "Preparing pairing code…",
  "settings.pairing.qr.action": "Show a new code",
  "settings.pairing.qr.alt": "Pairing code",
  "settings.pairing.uriLabel": "Pairing link",
  "settings.pairing.copy": "Copy pairing link",
  "settings.pairing.field.copy": "Copy",
  "settings.pairing.copied": "Copied",
  "settings.pairing.copyFailed": "Not copied",
  "settings.pairing.copy.aria": "Copy {field}",
  "settings.pairing.close": "Done",
  // 64 characters, and the sentence a user cannot infer: the code is a bearer secret. "until you revoke it"
  // was the part that pushed an earlier draft to 128, and the revocation control makes that promise better.
  "settings.pairing.secret": "The code is a secret — anyone who has it can reach this machine.",
  "settings.pairing.manual.title": "Type the address by hand",
  "settings.pairing.manual.detail":
    "For a phone that cannot scan: enter the address the phone should dial and a short token you choose. The phone's Add host form asks for the same two values.",
  "settings.pairing.manual.address": "Address",
  "settings.pairing.manual.address.detail":
    "Usually your public IP or domain, then the daemon port — written as host:port. On the same Wi-Fi as this machine, a private LAN address is fine.",
  "settings.pairing.manual.address.placeholder": "example.com:4770",
  "settings.pairing.manual.lanHint": "On this Wi-Fi you can also use {address}.",
  "settings.pairing.manual.token": "Token",
  "settings.pairing.manual.token.detail":
    "8–10 letters or digits you choose. Anyone who has it can reach this machine until you revoke the code.",
  "settings.pairing.manual.token.placeholder": "8–10 characters",
  "settings.pairing.manual.token.length": "Use 8–10 letters or digits.",
  "settings.pairing.manual.token.charset": "Letters and digits only.",
  "settings.pairing.manual.address.missing": "Enter the address as host:port.",
  "settings.pairing.manual.action": "Create pairing values",
  "settings.pairing.manual.busy": "Creating…",
  "settings.pairing.ssh.title": "Reach it through an SSH hop",
  "settings.pairing.ssh.detail":
    "For a machine the phone cannot reach directly: the phone tunnels over SSH, and this daemon sees the connection arrive on its own loopback.",
  "settings.pairing.ssh.host": "SSH host",
  "settings.pairing.ssh.host.detail":
    "Usually the public IP or domain of this machine, as the phone reaches it. A LAN name only works when the phone is on the same network.",
  "settings.pairing.ssh.port": "SSH port",
  "settings.pairing.ssh.port.detail": "22, unless your SSH server listens somewhere else.",
  "settings.pairing.ssh.user": "SSH user",
  "settings.pairing.ssh.user.detail": "Optional — the phone assumes root when this is left blank.",
  "settings.pairing.ssh.daemon": "Daemon address",
  "settings.pairing.ssh.daemon.detail":
    "As seen from that machine — {address} on almost every machine.",
  "settings.pairing.ssh.daemon.unknown":
    "As seen from that machine — its host and the port this daemon listens on.",
  // The honest half, and the reason this block is a list and not a form: SSH is not in the pairing payload.
  "settings.pairing.ssh.token": "Token",
  "settings.pairing.ssh.token.detail":
    "Optional here: the tunnel arrives on this machine's own loopback, which the daemon trusts without one. If you want a credential anyway, use the short token from Type the address by hand — not the long secret inside a QR code.",
  "settings.pairing.ssh.notInCode":
    "This route is set up by hand in the phone's Add host → SSH form. The pairing code above carries no SSH hop, so there is nothing here to scan.",
  // The list is the daemon's **issued** records, not the devices that successfully paired: a row exists
  // from the moment a code is minted, and it survives revocation as the evidence that the token was
  // withdrawn. So the heading says what the rows are ("Pairing codes"), each row says which state it is
  // in, and the chip counts only records that are both valid and used. "Paired devices" claimed a
  // pairing for every minted code, including codes nobody ever scanned — a true list under a false label.
  "settings.machine.paired.title": "Pairing codes",
  "settings.machine.paired.detail": "Codes this machine has issued. Each is active, unused, or revoked.",
  "settings.machine.paired.empty": "No pairing codes issued yet.",
  // The chip's unit is spelled out: a bare number under this heading once read as "devices with access"
  // while counting revoked rows, so the count now names exactly what it counts — devices that are still
  // valid *and* have been used. Revoked and never-scanned records cannot inflate it.
  "settings.machine.paired.active.one": "1 active device",
  "settings.machine.paired.active.many": "{count} active devices",
  // One key per state, because the difference is the fix: an issued code nobody scanned, a withdrawn
  // token, an expired one, and a device that really reached this machine must not share words.
  "settings.machine.paired.state.active": "Active · last used {when}",
  "settings.machine.paired.state.unused": "Not used yet · expires {when}",
  "settings.machine.paired.state.revoked": "Revoked · {when}",
  "settings.machine.paired.state.expired": "Expired · {when}",
  "settings.machine.paired.revoke": "Revoke",
  // "Forget" rather than "Delete": the device is unaffected (it is already revoked), and only this
  // record — the evidence that its token was withdrawn — leaves. The title says so, because the record
  // is the security property the store deliberately keeps.
  "settings.machine.paired.forget": "Forget",
  "settings.machine.paired.forget.title":
    "Remove this revoked record from the list. The device stays revoked.",

  /* ── the daemon service, which belongs to the operating system and not to a settings file ──
     The value this row reports lives in launchd / a systemd user unit / a Task Scheduler job, so the row says
     what that supervisor answered rather than what a user chose. Two rules the words below keep, and
     `test/service-state.test.ts` holds them: the service starts **at login** (never "at boot", which is a
     different and unsupported arrangement), and the sentence promising it is only used when the supervisor
     said `enabled: true` — a machine with `enabled: false` will not bring it back. The supervisor's own
     `detail` is not in the catalogue at all: it is raw output, shown verbatim and last. */
  "settings.service.title": "Background service",
  "settings.service.detail":
    "Run the daemon as a service so a phone can reach this machine while closed.",
  "settings.service.state.notInstalled.title": "Off",
  "settings.service.state.notInstalled.detail":
    "Your phone can only reach this machine while the EnvoyDev window is open.",
  "settings.service.state.running.title": "On, running",
  "settings.service.state.running.atLogin":
    "The service is running now, and it starts again when you log in.",
  "settings.service.state.running.notAtLogin":
    "The service is running now, but it is not set to start when you log in.",
  "settings.service.state.running.plain": "The service is running now.",
  "settings.service.state.installedStopped.title": "On, not running",
  "settings.service.state.installedStopped.atLogin":
    "It is installed and starts when you log in.",
  "settings.service.state.installedStopped.notAtLogin":
    "It is installed, but it is not set to start when you log in.",
  "settings.service.state.installedStopped.plain": "It is installed but not running right now.",
  "settings.service.state.failed.title": "Something went wrong",
  "settings.service.state.failed.detail":
    "The service could not be started. What your system's service manager said is below.",
  "settings.service.state.unsupported.title": "Not available here",
  "settings.service.state.unsupported.detail":
    "EnvoyDev found no service manager it can use on this system. The app still works while the window is open.",
  "settings.service.state.unknown.title": "Could not tell",
  "settings.service.state.unknown.detail":
    "EnvoyDev could not read the service's state from the system's service manager.",
  "settings.service.pid": "Process {pid}.",
  "settings.service.checking": "Checking with your system's service manager…",
  /* The daemon's own history — the half of the answer the supervisor cannot give. `restarts` is shown only
     above zero, so there is no key for "0 restarts": a zero is not evidence of anything. `lastStop` is shown
     only when it explains something, and `crash` is the sentence for the case where it explains the most —
     a restart with no stop record behind it at all, which a deliberate stop always leaves. */
  "settings.service.restarts.one": "Restarted once in the last hour",
  "settings.service.restarts.many": "Restarted {count} times in the last hour",
  "settings.service.lastStop.requested": "Last stop: you asked for it over the connection, at {when}",
  "settings.service.lastStop.refused": "Last stop: it refused to serve and exited, at {when}",
  "settings.service.lastStop.failed": "Last stop: it failed to serve and exited, at {when}",
  "settings.service.lastStop.signal": "Last stop: {signal}, at {when}",
  "settings.service.lastStop.signalExit": "Last stop: {signal} (exit code {code}), at {when}",
  "settings.service.lastStop.crash":
    "No stop request preceded this start — the previous daemon was killed or crashed",
  "settings.service.action.turnOn": "Turn on",
  "settings.service.action.restart": "Restart",
  /* **Stop and Turn off both end the daemon, and only one of them ends the service.** The labels cannot carry
     that difference alone, so the row says it in a sentence and each button repeats the half that belongs to
     it in its tooltip. */
  "settings.service.action.stop": "Stop",
  "settings.service.action.stop.title":
    "Stop the daemon now. Because the service is installed, it starts again at your next login.",
  /* Stop's tooltip carries the same login promise the state sentence does, so it is gated on `enabled` the
     same way: the flattering version in front of a machine that will stay stopped is the lie this gate exists
     for. */
  "settings.service.action.stop.title.notAtLogin":
    "Stop the daemon now. The service is installed, but it is not set to start when you log in.",
  "settings.service.action.stop.title.plain":
    "Stop the daemon now. The service stays installed; Turn off removes it.",
  "settings.service.action.turnOff.title": "Remove the service, so the daemon does not start again.",
  "settings.service.stopVsOff": "Stop ends it now; Turn off removes the service so it stays off.",
  "settings.service.action.turnOff": "Turn off",
  "settings.service.action.tryAgain": "Try again",
  "settings.service.action.refresh": "Refresh",
  "settings.service.busy": "Working…",
  /* ── the log tail, behind a disclosure ──
     Fetched when the disclosure opens, not on mount: reading it is a file read on the daemon. `truncated` is the
     one thing the panel owes the reader out loud — the daemon bounds the read by both bytes and lines
     (`daemon/log-tail.ts` owns both numbers) — and a tail that reads like the whole log is a lie somebody
     debugs from. **Neither sentence names a bound**, deliberately: a byte-truncated read can show far fewer
     than the line limit, so a number would be wrong exactly when the note matters most. An empty `lines` is the
     same on the wire whether the file is absent or present-and-empty, so the empty state says the one thing
     true of both. */
  "settings.service.log.show": "Show the log",
  "settings.service.log.hide": "Hide the log",
  "settings.service.log.title": "Daemon log",
  "settings.service.log.reading": "Reading the log…",
  "settings.service.log.refresh": "Refresh",
  "settings.service.log.truncated": "Showing the end of the log — there is more before this.",
  "settings.service.log.empty": "Nothing has been written to the log yet.",

  /* ── the one comparison a control plane needs ──
     Both halves of EnvoyDev are built together, so a difference means one of them is a build behind —
     and a daemon a build behind can refuse settings this window writes, which `docs/settings-parity.md`
     §7.2 records on the wire. The window's own version is a build constant (`app-version.ts`); when
     nothing inlined one, this page says so instead of printing a placeholder that looks like a number. */
  "settings.about.note": "Both halves are built together, so their versions should match.",
  "settings.about.window.title": "This window",
  "settings.about.window.detail": "The build this window's own files came from.",
  "settings.about.daemon.title": "The daemon",
  "settings.about.daemon.detail": "The build of the process this window is talking to.",
  "settings.about.noVersion": "Not known",
  "settings.about.unknown":
    "One of the two builds is not known to this window, so there is nothing to compare.",
  "settings.about.match": "The window and the daemon are the same build.",
  "settings.about.mismatch":
    "This window is {window} and the daemon is {daemon} — different builds. A daemon from another build can refuse settings this window writes, so restart EnvoyDev and let both come from one build.",

  "settings.notes.heading": "Things worth knowing",

  /* ── what the daemon says when it refuses ── */
  "error.ownerWindowOnly":
    "This can only be done at the machine itself. A paired device cannot pair another one — open EnvoyDev on the machine you want to pair with.",
  "error.addProject.notDirectory":
    "{path} is not a directory on this machine. Pick a folder that exists — EnvoyDev runs agents in it, so the path has to be real.",
  "error.createTask.notDirectory":
    "{path} is not a directory on this machine, so there is nowhere to run the agent. It was the working directory for \"{title}\".",
  "error.updateTask.notDirectory":
    "{path} is not a directory on this machine, so the agent would have nowhere to run. The task's folder is unchanged.",
  // The mode is the agent's, and the two refusals below keep the two causes apart: the harness has no
  // way to be given one, or the id is not one it declares. Both refuse the *run* rather than starting
  // an agent in a posture the user did not ask for — an agent that edits files when the user chose
  // "plan" has been misdescribed, not merely inconvenienced.
  "error.agentModeUnsupported":
    "{harness} cannot be put into a mode over the protocol EnvoyDev speaks to it, so the run was not started. Leave the mode unset to run {harness} in its own default.",
  "error.agentModeUnknown":
    "{harness} does not offer a mode called \"{mode}\", so the run was not started. Pick one of its modes and try again.",
  // The model's three refusals, and they are three because the causes are: the agent takes no model at
  // all; it takes one but not this one (so we cannot tell which provider it belongs to); or the value
  // is not in the `provider/model` shape those agents need to build a route. All three refuse the run
  // — `envoy-harness` parses `--model` and then ignores it when no provider is given, which would
  // leave an agent answering on its own default while the transcript named the user's choice.
  "error.modelUnsupported":
    "{harness} does not take a model, so the run was not started. Clear the model and start it again to run {harness} with its own default.",
  "error.modelUnknown":
    "{harness} does not publish a model called \"{model}\", so EnvoyDev cannot tell which provider it belongs to and the run was not started. Pick one of the models {harness} publishes.",
  // No worked example here, deliberately: the provider name is the agent's own catalog id — verified
  // against the real binary, where it is `deepseek-official` and not `deepseek` — so any concrete pair
  // would teach a name that is wrong for the agent reading this sentence.
  "error.modelNotProviderQualified":
    "{harness} needs a model written as provider/model — the provider name, a slash, then the model — and \"{model}\" does not name both, so the run was not started.",
  // Only Envoy Harness (argv delivery) must have a model before a process exists — otherwise it
  // answers on the hermetic demo backend while the window still looks empty. External agents may omit.
  "error.modelRequired":
    "{harness} has no model configured. Choose a model from the list, then try again.",
  "error.envoyLlmUnknownModel":
    "Envoy Harness does not publish {provider}/{model} as a default model, so the LLM settings were not saved.",
  "error.envoyLlmApiKeyRequired":
    "Envoy Harness needs an API key for {provider}. Enter one in LLM settings, then save.",
  // The thinking level's one refusal, and note what it is *not*: a level the agent does not publish is
  // never refused here. The list a user picks from came from an earlier session and describes the model
  // that session resolved, so the agent is the authority on what it accepts — and it refuses with its
  // own sentence, which the run surfaces. This refusal is about the agent having no such method at all.
  "error.thinkingUnsupported":
    "{harness} cannot be given a thinking level over the protocol EnvoyDev speaks to it, so the run was not started. Leave the thinking level unset to run {harness} the way it decides for itself.",
  // The straight quotes are the daemon's own (`service.ts`, `runs.ts` write `${id}` inside `"…"`),
  // and they are kept here deliberately: this entry *is* the sentence an English user already reads,
  // and an equality test in `daemon-errors-i18n.test.ts` fails if the two ever drift.
  ...git,
  "sidebar.project.branch": "Branch: {branch}",
  "error.projectNotFound":
    "There is no project called \"{id}\" on this machine. It may have been removed from another window.",
  "error.taskNotFound":
    "There is no task called \"{id}\" on this machine. It may have been removed from another window.",
  "error.collaboration.empty": "A collaboration needs at least one participant.",
  "error.collaboration.duplicateId":
    "Two participants share the id “{id}”. Each participant needs its own id.",
  "error.collaboration.badRole":
    "“{role}” is not a role this build knows. Use plan, implement, review, or observe.",
  "error.collaboration.agentNeedsHarness":
    "Participant “{id}” is an agent and needs a harness id.",
  "error.collaboration.multiWriter":
    "Two implement roles on the same host would write the same tree. Keep one implementer per host.",
  "error.collaboration.activeMissing":
    "Active participant “{id}” is not in the participant list.",
  "error.collaboration.offerMissing":
    "That offer is gone — it may have expired when the daemon restarted.",
  "error.collaboration.offerSettled": "That offer was already answered.",
  "error.collaboration.peerUnknown":
    "There is no peer called “{id}”. Register it first, or pick a participant on this machine.",
  "error.collaboration.peerUnreachable":
    "Peer “{label}” is not reachable, so this machine will not offer it work.",
  "error.collaboration.notPeer":
    "Participant “{id}” is a local agent. Start a run on this machine instead of offering it remotely.",
  "error.collaboration.handoffWhileRunning":
    "A run is already in progress. Finish or stop it before handing off to another participant.",
  "error.collaboration.participantMissing":
    "There is no participant called “{id}” on this task.",
  "run.handoff": "Handed off to {role}.",
  "run.handoff.brief": "Handed off to {role}: {brief}",
  "error.pairedDeviceMissing":
    "There is no paired device called \"{id}\". It may already have been revoked.",
  // Refused by `coder.forgetPairedDevice` when the record is not revoked. Named for the guard, not for
  // the UI's *active* state: an issued code nobody scanned is refused here too, because it is a working
  // token either way. The sentence here and the daemon's own words are identical on purpose (see this
  // file's header): an English user must see no change between the refusal's raw fallback and the
  // localized lookup of the key.
  "error.pairedDeviceNotRevoked":
    "\"{id}\" has not been revoked. Revoke it first — a record is only forgotten once the token is withdrawn.",
  "error.pairingTokenLength": "The token must be 8–10 characters.",
  "error.pairingTokenCharset": "The token must be letters and digits only (8–10 characters).",
  "error.pairingTokenDuplicate":
    "That token is already in use by another pairing code. Choose a different one.",
  "error.runNotFound":
    "There is no run called \"{runId}\". It may have been started by a daemon that has since restarted.",
  "error.taskForRunMissing": "There is no task called \"{taskId}\", so there is nowhere to run an agent.",
  "error.taskAlreadyRunning":
    "\"{task}\" is already running. Send it a message instead — starting a second agent in one directory is how two of them come to edit the same file.",
  "error.runFinished":
    "That run has already finished, so there is nothing to send to it. Start a new task instead.",
  "error.approvalPending":
    "The agent is waiting for an answer before it can go on. Answer that first — a message sent now would sit behind it.",
  "error.noRunRuntime": "This daemon was started without an agent runtime, so it cannot run tasks.",
  "error.harnessMissing": "{harness} is not installed on this machine. Install it, then start the task again.",
  // The third member of the family, and it exists so this sentence can avoid the other two's claims: nothing
  // here says the agent is absent, because the daemon could not look. It names the one action that helps.
  "error.harnessUnknown":
    "EnvoyDev could not check whether {harness} is installed, so it did not start the task. Restart EnvoyDev and try again.",
  "error.harnessUnsupported":
    "{harness} speaks a protocol EnvoyDev cannot drive yet, so the task was not started. EnvoyDev drives agents over ACP — choose one of those instead.",
  // ── the agents a **user declared** (`AgentProviderConfig`) ──
  // Their own sentences rather than the harness ones, because the thing that is wrong is different in
  // kind: a shipped agent has an adapter we have not written, a provider has a *dialect the user chose*
  // and can change. Advice that cannot be followed ("choose one of those instead") is not advice.
  "error.providerUnsupported":
    "{provider} speaks a protocol EnvoyDev cannot drive yet, so the run was not started. EnvoyDev drives agents over ACP — if this program does speak ACP, declare the provider's dialect as ACP and try again.",
  "error.providerNotFound":
    "There is no agent provider called \"{id}\" here. It may have been removed from another window.",
  "error.providerInUse":
    "\"{id}\" is still used by {where}, so it was not removed. Move those onto another agent first.",
  "error.agentUnknown":
    "\"{id}\" is not an agent EnvoyDev ships or catalogues, so it was not chosen.",
  // No value is echoed, in this sentence or anywhere else: what a user pasted into the name field is
  // very often the credential itself, and a refusal is a string that reaches a log, a transcript and a
  // bug report. So the sentence says *which entry* was wrong, which is what a user needs to fix it.
  "error.providerEnvNotAName":
    "EnvoyDev stores the names of the environment variables an agent needs, never their values, and entry {position} of this provider's environment list is not a variable name. A name is letters, digits and underscores, and does not start with a digit. The provider was not added.",
  "error.providerEnvUnset.one":
    "{provider} needs the environment variable {name} to be set for EnvoyDev's daemon, and it is not set, so the run was not started. EnvoyDev stores the names of the variables an agent needs, never their values — set it where the daemon is started, then restart EnvoyDev.",
  // The two-key plural the catalogue's own rule asks for rather than a plural library: a language whose
  // second form is not "add an s" gets a whole string to write, not a rule to implement six times.
  "error.providerEnvUnset.many":
    "{provider} needs these environment variables to be set for EnvoyDev's daemon, and they are not set: {names}. The run was not started. EnvoyDev stores the names of the variables an agent needs, never their values — set them where the daemon is started, then restart EnvoyDev.",
  "error.providerIdTaken":
    "\"{id}\" is the id of an agent EnvoyDev already ships, so your provider was not added. Give your provider another name.",
  // Reached two ways — an explicit id a client invented, or a name with no letter or digit in it at all
  // — so the sentence states the rule rather than presuming which of the two happened.
  "error.providerIdInvalid":
    "\"{name}\" cannot be an id for a provider. A provider id is lowercase letters, digits and dashes, starting with a letter or a digit.",
  // **The reference and the recipe disagree.** A catalogue entry named by `catalogEntryId` whose command,
  // arguments, dialect or environment names are not the ones the request carried: the two cannot both be
  // true, and the honest outcome is to add nothing and say so. The action is the page, not a field —
  // which is why the sentence names reopening it rather than asking a user to edit anything.
  "error.providerCatalogMismatch":
    "\"{entry}\" is a catalogued agent, and the recipe this request describes is not the one that entry states — so the agent was not added. Reopen the agents page and add the row again.",
  // **The five answers to "sign in to this agent".** The sentence a client renders after the button, and
  // the only one of the five that means it worked is `signIn.signedIn`: the others exist because a step
  // that *returns* is not a step that *worked* — a browser-login method answers immediately and the session
  // still refuses until the human has finished in the browser.
  "signIn.already":
    "{agent} opened a session without needing a sign-in, so there was nothing to do.",
  // The proof, stated as the proof: a session opened afterwards, not "the agent accepted the call".
  "signIn.signedIn": "{agent} accepted the sign-in and opened a session.",
  // The agent's own refusal, quoted as a value: an `env_var` method says which variable is unset, and that
  // is more use to a user than anything we could write.
  "signIn.refused": "{agent} refused the sign-in step: {reason}",
  // Two situations in one sentence on purpose — a browser step nobody has finished, and an agent that never
  // answered. In both, nothing was signed in, and "not yet, try again" is the honest thing to say.
  "signIn.notCompleted":
    "{agent} accepted the sign-in step but no session opened yet, so the sign-in has not finished: {reason} If the agent opened a browser or a terminal, finish there and try again.",
  // `{methods}` is the **agent's own** list of ids, never the caller's string: what a client sent in that
  // field is not echoed back, for the same reason a refused `env` entry is not (it is often the credential).
  "signIn.noMethod":
    "{agent} will not open a session here and did not name a sign-in method EnvoyDev may send. It offers: {methods}. Sign in with the agent's own command, then ask again.",
  "signIn.unavailable":
    "{agent} could not be started, so nothing was signed in: {reason}",
  "error.notConnected": "EnvoyDev is not connected to its daemon yet.",
  "error.notConnectedChange": "EnvoyDev is not connected to its daemon, so that change was not saved.",
  "error.connectionClosed": "The connection was closed.",
  "error.daemonClosedConnection": "The daemon closed the connection.",
  "error.daemonTooOld":
    "The daemon this window is talking to is an older build: it does not know {method}. Restart EnvoyDev so the window and its daemon are the same build, then try again.",
  "error.notOurDaemon.product":
    "Something is answering on the daemon's port, but it says it is “{product}”. EnvoyDev did not connect to it.",
  "error.notOurDaemon.instance":
    "The daemon on port {port} is not the one this window was started for. Another EnvoyDev daemon may have replaced it — reopen the window.",
  "error.shellEndpointFailed":
    "EnvoyDev's window could not ask the shell where the daemon is. Rebuild the desktop app (the shell permission list is out of date).",
  "error.shellEndpointMissing":
    "The EnvoyDev shell did not say where its daemon is. This window cannot connect without it.",

  /* ── what the daemon wanted the user to know at startup ── */
  "note.quarantined.moved":
    "EnvoyDev could not read {name}, so it moved it aside to {movedTo} and started that list empty. ({reason})",
  "note.quarantined.left":
    "EnvoyDev could not read {name} and could not move it aside, so it left it untouched and started that list empty. ({reason})",
  "note.skipped": "{file}: {reason}",
  /* ── a settings key this build does not have, which cost the user **nothing else** ──
     Two keys rather than one because there are two causes, and only one of them is a fact about us. A key
     we used to ship and removed is a deletion the user should hear named; a key no build of ours ever had
     is a typo or somebody else's file, and claiming to have removed it would be a lie.
     Both end by saying the rest was kept, and that half is not decoration: the defect these replaced was a
     settings file quarantined whole over one unknown key, so "everything else is still in force" is the
     sentence the user actually needs. */
  "note.settings.retired":
    "{file} had {key}, which this build no longer has. EnvoyDev dropped it and kept every other setting.",
  "note.settings.unknown":
    "{file} had {key}, which this build does not recognise. EnvoyDev dropped it and kept every other setting.",

  /* ── an approval, in the daemon's own words ── */
  "approval.question.tool": "Allow the agent to run “{tool}”?",
  "approval.question.generic": "Allow the agent to continue?",
  "approval.detail":
    "It has stopped before this step and will not continue until you answer. Allowing it lets this same step run again in this project without asking.",
  "approval.allow": "Allow",
  "approval.deny": "Don't allow",
  "approval.question.ask": "The agent asked a question.",
  "approval.detail.pick": "Pick one. This answer is only for this question.",
  "approval.detail.multiple": "Tick every option that applies, then confirm. This answer is only for this question.",
  "approval.detail.text": "Type your answer. The agent will not continue until you send it.",
} as const;

export type Messages = typeof en;
export type MessageKey = keyof Messages;

/**
 * Is this string one of our keys?
 *
 * The wire carries keys as plain strings (`messageKey`), and a client built against a *different*
 * catalogue will eventually be handed one it does not have — a daemon one version ahead, a key
 * renamed in a release. That must fall back to the English sentence the daemon sent, never to
 * `error.some.typo` rendered at a user, so the check happens once, here, where the catalogue is.
 */
export function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, value);
}
