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
  "sidebar.project.settings.aria": "Project settings for {project}",
  "sidebar.project.newTask": "+ New",
  "sidebar.project.newTask.title": "Start a task in {project}",
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

  /* ── settings ── */
  "settings.title": "Settings",
  "settings.close": "Close",
  "settings.stateDir": "State in {path}",
  "settings.noDaemon": "No daemon",
  "settings.daemon": "Daemon {version}",
  "settings.daemon.title": "The daemon this window is attached to",
  "settings.language.title": "Language",
  "settings.language.detail":
    "The language of this window — every label, notice and error, including the ones the daemon sends back. Saved with your settings on this machine, so it follows you to your other windows and to the phone.",
  "settings.language.aria": "Language",
  "settings.language.system": "Same as this computer",
  "settings.defaultHarness.title": "The agent new tasks start with",
  "settings.defaultHarness.detail": "A project can override this; this is the answer when it does not.",
  "settings.needsInstalling": "(needs installing)",
  "settings.approvals.title": "Ask before anything destructive",
  "settings.approvals.detail":
    "Agents stop and wait for you instead of overwriting files. Turning this off means a task can change your working tree without asking.",
  "settings.remoteRuns.title": "Share this machine's agents with your other machines",
  "settings.remoteRuns.detail":
    "Off by default. When it is on, a task from another of your machines can run here, in a directory of yours.",
  "settings.transcripts.title": "Keep transcripts after a task ends",
  "settings.transcripts.detail":
    "The record of what an agent did, kept on this machine. Turning it off saves space and makes 'what did it change?' unanswerable later.",
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
