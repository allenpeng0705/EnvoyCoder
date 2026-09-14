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
 *     in every language. `@envoycoder/task-model`'s `statusLabel` stays the English source and a
 *     test asserts the two agree word for word.
 *   * **`error.*`, `note.*`, `approval.*`** — sentences the **daemon** sends. Each is repeated here
 *     verbatim so that a German user reads German: the daemon sends the key with its English
 *     sentence (`messageKey`/`messageValues` in `@envoycoder/protocol`), and the window renders the
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

export const en = {
  /* ── the product, and the machine it is on ── */
  "app.name": "EnvoyCoder",
  "app.thisMachine": "This machine",
  "app.rail.show": "Show projects",
  "app.rail.hide": "Hide projects",
  "app.rail.toggle": "Toggle the project rail",
  "app.windows.count": "{count} windows",
  "app.windows.title": "This daemon serves every EnvoyCoder window",

  /* ── the connection, said the way a user needs it ── */
  "connection.starting": "Starting…",
  "connection.unreachable": "Daemon unreachable",
  "connection.none": "Not connected",

  /* ── the notice strip: only refusals speak ── */
  "notice.dismiss": "Dismiss",

  /* ── the rail ── */
  "sidebar.aria": "Projects and tasks",
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
    "Add a directory you work in. Tasks you start in it appear here, and the project remembers which agent they should use.",
  "sidebar.empty.noMatch": "Nothing matches “{query}”.",
  "sidebar.empty.cannotLoadTitle": "Could not read your projects",
  "sidebar.empty.cannotLoadBody": "This list is unknown, not empty — EnvoyCoder could not ask its daemon for it.",
  "sidebar.section.tasks": "Tasks",
  "sidebar.project.attention": "Tasks waiting on you",
  "sidebar.project.agent": "The agent new tasks in this project start with",
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
  "sidebar.project.remove": "Remove project",
  "sidebar.project.remove.aria": "Remove this project",
  "sidebar.project.remove.confirm":
    "Remove “{project}” from EnvoyCoder? Its tasks leave the rail and are archived — nothing on disk is deleted.",
  "sidebar.project.remove.cta": "Remove project",
  "sidebar.task.menu.aria": "Actions for {task}",
  "sidebar.task.menu.title": "Task actions",
  "sidebar.task.rename": "Rename",
  "sidebar.task.rename.aria": "New name for this task",
  "sidebar.tasks.empty": "No tasks here yet.",
  "sidebar.footer.add": "Add project",
  "sidebar.footer.host": "Host: {host}",
  "sidebar.footer.import": "Import a session (not built yet)",
  "sidebar.footer.import.title":
    "Importing a session from another agent's history is not built yet — it needs a reader per agent.",
  "sidebar.footer.help": "Help and support (not built yet)",
  "sidebar.footer.help.title": "No help surface yet: the shortcut registry exists, the help sheet does not.",
  "sidebar.footer.settings": "Settings",

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
  "palette.pairPhone.notYet":
    "Pairing a phone arrives with the mobile milestone: the daemon has no session store yet, so it refuses remote clients on purpose.",
  "palette.toggleRail.title": "Toggle the project rail",
  "palette.settings.title": "Open settings",
  "palette.settings.subtitle": "Defaults for new tasks, and what needs approval",
  "palette.noPicker": "This window has no shell to ask, so paste the folder path instead.",
  "palette.pickerFailed": "The folder picker could not open: {detail}",

  /* ── the work area with nothing in it, and the three reasons why ── */
  "work.offline.title": "EnvoyCoder cannot reach its daemon",
  "work.offline.body":
    "The daemon is the process that runs your tasks, and it is not answering. It starts with the app, so this usually fixes itself in a moment.",
  "work.loading": "Loading your projects…",
  "work.noTask.title": "No task open",
  "work.noTask.body":
    "Pick a task on the left, or start one in a project. Agents run on this machine and, when the mesh is attached, on your other machines too.",
  "work.noProjects.title": "No projects yet",
  "work.noProjects.body": "Add a directory you work in, and EnvoyCoder can run agents there.",
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
  "task.approval.aria": "The agent needs your answer",
  "task.approval.answered": "Answered",
  "task.approval.answeredWith": "Answered: {option}",

  /* ── the composer ── */
  "task.composer.aria": "Message the agent",
  "task.remove": "Remove task",
  "task.remove.aria": "Remove this task",
  "task.remove.confirm": "Remove “{title}” from EnvoyCoder? It leaves the rail and is archived — the folder and its files are not touched.",
  "task.remove.cta": "Remove",
  "action.cancel": "Cancel",
  "task.composer.placeholder.approval": "Answer the request above before sending anything",
  "task.composer.placeholder.running": "Add a follow-up — Queue waits for this turn, Steer joins it",
  "task.composer.placeholder.idle": "Describe the task",
  "task.composer.queue": "Queue",
  "task.composer.steer": "Steer",
  "task.composer.mode.aria": "How to deliver the message",
  "task.composer.hint": "Enter to send · Shift+Enter for a new line",
  "task.empty.suggestion.one": "Explain what this project does",
  "task.empty.suggestion.two": "Find and fix the failing test",
  "task.empty.suggestion.three": "Add tests for the last change",
  "task.composer.mode.title": "Queue waits for the current turn; Steer joins it",
  "task.composer.send": "Send",
  "task.composer.start": "Start",
  "task.composer.submit.blocked": "Answer the request above first",

  /* ── the two controls above the field: the folder, and the agent's own mode ──
     Both are about *this task*, both applied to the **next run**, and that shared property is why
     each carries its own "next run" sentence instead of one shared note: a user who changed only the
     folder should not be told about a mode they did not touch. */
  "task.composer.folder.label": "Folder",
  "task.composer.folder.aria": "Change this task's folder",
  "task.composer.folder.noPicker":
    "This window has no folder chooser, so this task's folder cannot be changed here.",
  "task.composer.folder.nextRun":
    "The agent is still working in {path}. A new folder applies to the next run.",
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
    "EnvoyCoder has not been told which modes {agent} offers yet, so the picker is off for now.",
  "task.composer.agentMode.nextRun":
    "The agent keeps the mode it started with. Your choice applies to the next run.",

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
  // Why the control is off. Three facts, three sentences — folding them together is how a user
  // concludes an agent has no models when it has some we cannot reach.
  "task.composer.model.none": "{agent} does not take a model.",
  "task.composer.model.notWired":
    "Choosing a model for {agent} is not wired up yet, so the control is off rather than silently ignored.",
  "task.composer.model.unknown":
    "EnvoyCoder has not been told which models {agent} offers yet, so the control is off for now.",
  // The free-text case: the agent accepts a model and publishes no list we can read before a run
  // exists. The field is *usable* — this note says what shape the value has to be, and why.
  "task.composer.model.freeText":
    // Deliberately **no worked example containing a provider name.** The value has to use the provider
    // name the agent itself uses, and that is the agent's own catalog id — verified against the real
    // binary, where it is `deepseek-official` and not `deepseek`. An example would teach the wrong name
    // and every copy of it would go stale with somebody else's catalog.
    "{agent} publishes its models only inside a running session, so there is no list to choose from here. Type one as provider/model, using the provider name {agent} itself uses — and if it does not have that model the run stops with the agent's own words, rather than quietly using another one.",
  "task.composer.model.nextRun":
    "The agent keeps the model it started on. Your choice applies to the next run.",
  // …and the one note that is not a refusal *or* an instruction: the list on screen came from a real
  // session, at a real time, and is therefore a record rather than a promise. Printed instead of a
  // "where the list came from" line, because the answer to that question is what changes the user's
  // expectations — a model list is per machine, per credential and per agent build.
  "task.composer.model.observed":
    "These are the models {agent} listed when EnvoyCoder last opened a session with it, on {at}. It may publish different ones next time.",

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
    "EnvoyCoder has not opened a session with {agent} yet, and {agent} only lists its thinking levels inside a session — so there is nothing to choose from until it has run once.",
  "task.composer.thinking.notWired":
    "Choosing how much {agent} thinks is not wired up yet, so the control is off rather than silently ignored.",
  "task.composer.thinking.unknown":
    "EnvoyCoder has not been told what {agent} offers yet, so the control is off for now.",
  // The observation, said out loud — and it carries more weight here than for the model, because a
  // thought level is derived from the model the session resolved: the list describes the model that
  // agent last ran on, so a user who changed the model may see a level the agent no longer accepts.
  // When it refuses one, the run stops with the agent's own sentence rather than continuing quietly.
  "task.composer.thinking.observed":
    "These are the thinking levels {agent} offered when EnvoyCoder last opened a session with it, on {at}. They were listed for the model it was running then, so they can change.",
  "task.composer.thinking.nextRun":
    "The agent keeps the thinking level it started with. Your choice applies to the next run.",

  /* ── the modes an agent can be put into, in our words rather than the agent's ──
     `AgentMode.labelKey`/`descriptionKey` point here for every mode **we** named; a mode a
     third-party agent named itself carries no key and is shown as the agent wrote it. */
  "task.agentMode.default.label": "Default",
  "task.agentMode.default.description": "Do the work, asking before anything destructive.",
  "task.agentMode.plan.label": "Plan",
  "task.agentMode.plan.description": "Investigate and propose a plan. Change nothing yet.",
  "task.agentMode.review.label": "Review",
  "task.agentMode.review.description": "Check and report. Change nothing.",

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
  "run.context": "Context {percent}% full.",

  /* ── the status line, and the one place the mesh is always visible ── */
  "mesh.attached.peers": "Mesh connected — {count} machines reachable",
  "mesh.attached.none": "Mesh connected — no other machines reachable yet",
  "mesh.noNode": "EnvoyMesh is not running — tasks stay on this machine",
  "mesh.refused": "EnvoyMesh refused EnvoyCoder a session — tasks stay on this machine",
  "mesh.peers": "{count} peers",
  "mesh.scope.title": "Session scope {scope}",
  "mesh.agentsHere": "Agents run on this machine",

  /* ── settings ──
     Grouped, and grouped by the question a user is asking rather than by the storage that answers it:
     "what does this app do by default", "what does a new task start with", "what may an agent do
     without me". The headings are sentence case and are not labels — nothing on this pane needs one. */
  "settings.title": "Settings",
  "settings.close": "Close",
  // The way out of the **projects page** (level 2), back to the settings for this machine (level 1). It
  // names where it goes rather than saying "Back", because a control labelled after the direction you
  // are moving is a control a user has to press to find out what it does. The level *below* has a back
  // control of its own and it says something different — `settings.project.back.title` — because it
  // lands somewhere else, on this page's title.
  "settings.back": "All settings",
  "settings.back.title": "Back to this machine's settings",
  "settings.stateDir": "State in {path}",
  "settings.noDaemon": "No daemon",
  "settings.daemon": "Daemon {version}",
  "settings.daemon.title": "The daemon this window is attached to",
  "settings.group.general": "General",
  "settings.group.newTasks": "New tasks start with",
  "settings.group.safety": "Safety",
  "settings.language.title": "Language",
  "settings.language.detail":
    "The language of this window — every label, notice and error, including the ones the daemon sends back. Saved with your settings on this machine, so it follows you to your other windows and to the phone.",
  "settings.language.aria": "Language",
  "settings.language.system": "Same as this computer",
  "settings.folder.choose": "Choose…",
  "settings.defaultPath.title": "The folder Add project starts in",
  "settings.defaultPath.detail":
    "Adding a project asks for a folder. Naming it here means the field is already filled in with the place you keep your work, and you can still type another one.",
  "settings.defaultPath.placeholder": "/Users/you/work",
  "settings.defaultHarness.title": "The agent new tasks start with",
  "settings.defaultHarness.detail": "A project can override this; this is the answer when it does not.",
  "settings.needsInstalling": "(needs installing)",
  "settings.defaultModel.title": "The model new tasks start on",
  "settings.defaultModel.detail":
    "Left empty, each new task runs on whatever the agent picks for itself. A project can override this too.",
  "settings.extraArgs.title": "Extra arguments for the agent",
  "settings.extraArgs.detail":
    "Passed to the agent's command line exactly as you type them, after the ones EnvoyCoder builds itself. Leave it empty unless the agent's own documentation names a flag you want on every task.",
  "settings.extraArgs.placeholder": "--verbose",
  "settings.approvals.title": "Ask before anything destructive",
  "settings.approvals.detail":
    "Agents stop and wait for you before every step they take, instead of overwriting files on their own. Turning this off means a task can change your working tree without asking.",
  "settings.approvals.reaches":
    "Handed to {agent} as its own policy for every run, so the asking happens where the work does.",
  "settings.approvals.unsupported":
    "EnvoyCoder cannot change this for {agent}: it has no way to be told, and asks on its own terms. Pick an agent EnvoyCoder can hand a policy to, or answer {agent}'s own prompts.",
  "settings.approvals.unknown":
    "EnvoyCoder has not been told what {agent} accepts yet, so this stays off rather than storing a choice nothing reads.",
  "settings.transcripts.title": "Keep transcripts after a task ends",
  "settings.transcripts.detail":
    "The record of what an agent did, kept on this machine. Turning it off saves space and makes 'what did it change?' unanswerable later.",
  "settings.project.title": "Project settings for {project}",
  "settings.project.detail":
    "These apply to new tasks in this project and override the settings for this machine. A task you set up yourself still wins.",
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
  "settings.project.extraArgs.detail":
    "Passed to the agent's command line for every task in this project, after the ones EnvoyCoder builds itself.",
  /* ── the projects page (level 2), and the row at level 1 that opens it ──
     Three levels, one pane: this machine's settings (level 1) carries one row whose second band is how
     many projects are registered, that row opens the list (level 2), and a row of the list opens that
     project's own defaults (level 3). The list is navigation, not settings: it shows what is registered
     and opens the scope that owns the per-project rows.
     `settings.projects.title` is deliberately one string used three times — the level-1 row's label, the
     level-2 page title, and level 3's back label — because all three name the same place, and a name
     that is stored once cannot drift between them.
     `{add}` is the rail's own Add-project label (`sidebar.footer.add`) rather than the word "Add"
     repeated here, so the sentence keeps naming the control it means when the control is renamed or
     translated. */
  "settings.group.projects": "Projects",
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
    "No projects yet. A project is a folder on this machine that agents work in — add one with {add} at the bottom of the rail, or from the Command Center.",
  "settings.agents.heading": "Agents on this machine",
  "settings.agents.note":
    "What each agent can actually do decides what EnvoyCoder offers. An agent that cannot be asked for permission is not given an approval dialog it would ignore.",
  "settings.agents.empty": "The agent list has not arrived yet.",
  "settings.agent.notInstalled": "Not installed",
  "settings.agent.unknown": "Unknown",
  "settings.agent.ready": "Ready",
  "settings.agent.noApprovals": "No approvals",
  "settings.agent.noApprovals.title": "This agent never asks before acting",
  "settings.agent.noCancel": "Cannot be cancelled",
  "settings.agent.noCancel.title": "The only way to stop this agent is to end its process",
  "settings.notes.heading": "Things worth knowing",

  /* ── what the daemon says when it refuses ── */
  "error.addProject.notDirectory":
    "{path} is not a directory on this machine. Pick a folder that exists — EnvoyCoder runs agents in it, so the path has to be real.",
  "error.createTask.notDirectory":
    "{path} is not a directory on this machine, so there is nowhere to run the agent. It was the working directory for \"{title}\".",
  "error.updateTask.notDirectory":
    "{path} is not a directory on this machine, so the agent would have nowhere to run. The task's folder is unchanged.",
  // The mode is the agent's, and the two refusals below keep the two causes apart: the harness has no
  // way to be given one, or the id is not one it declares. Both refuse the *run* rather than starting
  // an agent in a posture the user did not ask for — an agent that edits files when the user chose
  // "plan" has been misdescribed, not merely inconvenienced.
  "error.agentModeUnsupported":
    "{harness} cannot be put into a mode over the protocol EnvoyCoder speaks to it, so the run was not started. Leave the mode unset to run {harness} in its own default.",
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
    "{harness} does not publish a model called \"{model}\", so EnvoyCoder cannot tell which provider it belongs to and the run was not started. Pick one of the models {harness} publishes.",
  // No worked example here, deliberately: the provider name is the agent's own catalog id — verified
  // against the real binary, where it is `deepseek-official` and not `deepseek` — so any concrete pair
  // would teach a name that is wrong for the agent reading this sentence.
  "error.modelNotProviderQualified":
    "{harness} needs a model written as provider/model — the provider name, a slash, then the model — and \"{model}\" does not name both, so the run was not started.",
  // The thinking level's one refusal, and note what it is *not*: a level the agent does not publish is
  // never refused here. The list a user picks from came from an earlier session and describes the model
  // that session resolved, so the agent is the authority on what it accepts — and it refuses with its
  // own sentence, which the run surfaces. This refusal is about the agent having no such method at all.
  "error.thinkingUnsupported":
    "{harness} cannot be given a thinking level over the protocol EnvoyCoder speaks to it, so the run was not started. Leave the thinking level unset to run {harness} the way it decides for itself.",
  // The straight quotes are the daemon's own (`service.ts`, `runs.ts` write `${id}` inside `"…"`),
  // and they are kept here deliberately: this entry *is* the sentence an English user already reads,
  // and an equality test in `daemon-errors-i18n.test.ts` fails if the two ever drift.
  "error.projectNotFound":
    "There is no project called \"{id}\" on this machine. It may have been removed from another window.",
  "error.taskNotFound":
    "There is no task called \"{id}\" on this machine. It may have been removed from another window.",
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
  "error.harnessUnsupported":
    "{harness} speaks a protocol EnvoyCoder cannot drive yet (this adapter drives ACP agents only). Envoy Harness and DeepSeek Harness work today; {harness} needs its own adapter.",
  "error.notConnected": "EnvoyCoder is not connected to its daemon yet.",
  "error.notConnectedChange": "EnvoyCoder is not connected to its daemon, so that change was not saved.",
  "error.connectionClosed": "The connection was closed.",
  "error.daemonClosedConnection": "The daemon closed the connection.",
  "error.daemonTooOld":
    "The daemon this window is talking to is an older build: it does not know {method}. Restart EnvoyCoder so the window and its daemon are the same build, then try again.",
  "error.notOurDaemon.product":
    "Something is answering on the daemon's port, but it says it is “{product}”. EnvoyCoder did not connect to it.",
  "error.notOurDaemon.instance":
    "The daemon on port {port} is not the one this window was started for. Another EnvoyCoder daemon may have replaced it — reopen the window.",
  "error.shellEndpointFailed":
    "EnvoyCoder's window could not ask the shell where the daemon is. Rebuild the desktop app (the shell permission list is out of date).",
  "error.shellEndpointMissing":
    "The EnvoyCoder shell did not say where its daemon is. This window cannot connect without it.",

  /* ── what the daemon wanted the user to know at startup ── */
  "note.quarantined.moved":
    "EnvoyCoder could not read {name}, so it moved it aside to {movedTo} and started that list empty. ({reason})",
  "note.quarantined.left":
    "EnvoyCoder could not read {name} and could not move it aside, so it left it untouched and started that list empty. ({reason})",
  "note.skipped": "{file}: {reason}",

  /* ── an approval, in the daemon's own words ── */
  "approval.question.tool": "Allow the agent to run “{tool}”?",
  "approval.question.generic": "Allow the agent to continue?",
  "approval.detail":
    "It has stopped before this step and will not continue until you answer. Answering this one request does not allow anything else.",
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
