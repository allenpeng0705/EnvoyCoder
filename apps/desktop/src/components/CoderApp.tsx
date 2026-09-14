/**
 * The window shell: rail on the left, work on the right, status at the foot.
 *
 * The regions are Paseo's, because they are the ones users already know: a collapsible left rail,
 * a tab strip across the work area, panes inside it, and a status line. Two things are
 * deliberately *not* Paseo's:
 *
 *   * the **rail is the project tree** (see `CoderSidebar`), not a flat task list;
 *   * the **status line names the mesh**, because this product's distinguishing feature is that
 *     your other machines are part of it. A Paseo-like shell has nothing to put there; we do, and
 *     "am I attached to the mesh, and as whom" is a question a distributed control plane should
 *     answer without opening settings.
 *
 * ## What this component knows about the daemon
 *
 * Only that there is a connection with a state, which it renders. It does not call the daemon
 * itself and it does not fall back to fixtures: a window that cannot reach its daemon says so, and
 * says *what* it could not do. "No projects yet" shown for "I could not ask" is how a user concludes
 * the app lost their work — and it is the failure a scaffold that renders from a fixture array
 * cannot even represent.
 */

import type { JSX } from "react";

import { useMemo, useState } from "react";

import { useShortcuts } from "../input/useShortcuts.js";
import type { Project, Task } from "@envoycoder/protocol";
import { CoderSidebar } from "./CoderSidebar.js";
import { CommandCenter, buildCommandContributions } from "./CommandCenter.js";
import { TaskPane } from "./TaskPane.js";
import { MeshStatusBar } from "./MeshStatusBar.js";
import { SettingsPane } from "./SettingsPane.js";
import type { CoderState } from "../state/coderStore.js";
import type { CoderStore } from "../state/coderStore.js";

export interface CoderAppProps {
  state: CoderState;
  actions: CoderStore;
}

export function CoderApp(props: CoderAppProps): JSX.Element {
  const { state } = props;
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  // **The keyboard, which did not exist.** `⌘K` was printed on a button with nothing behind it, so the
  // palette — and "Add project…" inside it — could not be reached by keyboard at all. This mounts the
  // registry from `input/shortcuts.ts` and binds it to the shell's own state.
  useShortcuts({
    "commandCenter.open": () => setPaletteOpen(true),
    "search.find": () => setPaletteOpen(true),
    "newTask": () => setPaletteOpen(true),
    "settings.open": () => setSettingsOpen(true),
    "sidebar.toggle": () => setRailOpen((open) => !open),
  });

  // The active task follows the data rather than being remembered across a reconnect: an id from a
  // previous daemon is a row that is no longer there, and rendering a pane for it would show a task
  // the user cannot act on.
  const active: Task | undefined = useMemo(
    () => state.tasks.find((task) => task.id === activeId),
    [state.tasks, activeId],
  );

  const contributions = useMemo(
    () =>
      buildCommandContributions({
        projects: state.projects,
        tasks: state.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          projectId: task.projectId,
        })),
        onAddProject: async (path) => {
          // **A success says nothing.** The banner used to announce "Added EnvoyCoder." across the top of
          // the window, which told the user what they had just watched themselves do and made the strip
          // a thing to dismiss rather than a thing to read. The project appearing in the rail *is* the
          // confirmation. Only a refusal speaks — and then with the daemon's own words.
          if (!path) {
            setNotice("No folder was chosen, so nothing was added.");
            return;
          }
          const result = await props.actions.addProject(path);
          setNotice(result.ok ? undefined : result.message);
        },
        onNewTask: async (projectId, title) => {
          if (!title) return;
          // The title *is* the first prompt: a task with a name and no work is a row that does
          // nothing, and asking for both is the friction that makes a control plane tedious.
          const created = await props.actions.createTask({ projectId, title });
          if (!created.ok) {
            setNotice(created.message);
            return;
          }
          setActiveId(created.task.id);
          const started = await props.actions.startRun(created.task.id, title);
          if (!started.ok) setNotice(started.message);
        },
        onOpenSettings: () => setSettingsOpen(true),
        onPairPhone: () =>
          setNotice(
            "Pairing a phone arrives with the mobile milestone: the daemon has no session store yet, so it refuses remote clients on purpose.",
          ),
        onToggleRail: () => setRailOpen((open) => !open),
        onRevealTask: (taskId) => setActiveId(taskId),
      }),
    [state.projects, state.tasks, props.actions],
  );

  return (
    <div className={`shell${railOpen ? "" : " shell--rail-hidden"}`}>
      <header className="titlebar">
        <button
          type="button"
          className="button button--ghost button--icon"
          aria-label={railOpen ? "Hide projects" : "Show projects"}
          onClick={() => setRailOpen((open) => !open)}
          title="Toggle the project rail"
        >
          ▤
        </button>
        <span className="titlebar__title">EnvoyCoder</span>
        <span className="titlebar__spacer" />
        <ConnectionChip state={state} />
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setPaletteOpen(true)}
          title="Command Center"
        >
          Command Center
        </button>
      </header>

      {notice || state.error ? (
        <div className="banner" role="status">
          <span>{notice ?? state.error}</span>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => {
              setNotice(undefined);
              props.actions.clearError();
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="shell__body">
        {railOpen ? (
          <CoderSidebar
            projects={state.projects}
            tasks={state.tasks}
            activeTaskId={activeId}
            onSelect={setActiveId}
            onNewTask={(projectId) => {
              const project = state.projects.find((candidate) => candidate.id === projectId);
              // Opening the palette is the visible response; a sentence explaining it is noise.
              if (project) setNotice(undefined);
              setPaletteOpen(true);
            }}
            onAddProject={() => setPaletteOpen(true)}
            onOpenProjectSettings={() => setSettingsOpen(true)}
            onOpenCommandCenter={() => setPaletteOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : null}

        <main className="work">
          {settingsOpen ? (
            <SettingsPane
              state={state}
              onClose={() => setSettingsOpen(false)}
              onUpdate={(patch) => void props.actions.updateSettings(patch)}
            />
          ) : active ? (
            <TaskPane
              task={active}
              project={projectFor(state.projects, active)}
              events={active.runId ? (state.runs[active.runId]?.events ?? []) : []}
              runLive={active.runId ? state.runs[active.runId]?.run.endedAt === undefined : false}
              onStart={async (prompt) => {
                const result = await props.actions.startRun(active.id, prompt);
                if (!result.ok) setNotice(result.message);
              }}
              onSend={async (text, mode) => {
                if (!active.runId) return;
                const result = await props.actions.sendToRun(active.runId, text, mode);
                if (!result.ok) setNotice(result.message);
              }}
              onCancel={async () => {
                if (!active.runId) return;
                const result = await props.actions.cancelRun(active.runId);
                if (!result.ok) setNotice(result.message);
              }}
              onAnswer={async (requestId, optionId) => {
                if (!active.runId) return;
                const result = await props.actions.answerApproval(active.runId, requestId, optionId);
                if (!result.ok) setNotice(result.message);
              }}
            />
          ) : (
            <EmptyWork
              hasProjects={state.projects.length > 0}
              loaded={state.loaded}
              connection={state.connection.state}
              onStart={() => setPaletteOpen(true)}
            />
          )}
        </main>
      </div>

      <MeshStatusBar mesh={state.mesh} />

      <CommandCenter
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        contributions={contributions}
      />
    </div>
  );
}

/** The connection, said the way a user needs it rather than the way the socket reports it. */
function ConnectionChip(props: { state: CoderState }): JSX.Element | null {
  const { connection } = props.state;
  if (connection.state === "connected") {
    const windows = props.state.hello?.windowCount ?? 1;
    return windows > 1 ? (
      <span className="chip chip--quiet" title="This daemon serves every EnvoyCoder window">
        {windows} windows
      </span>
    ) : null;
  }
  const label =
    connection.state === "connecting"
      ? "Starting…"
      : connection.state === "disconnected"
        ? "Daemon unreachable"
        : "Not connected";
  return (
    <span className="chip chip--warn" title={connection.state === "disconnected" ? connection.reason : ""}>
      {label}
    </span>
  );
}

/**
 * The work area with nothing in it — and the three different reasons why.
 *
 * A single "no tasks" message would be wrong twice out of three times: before the first load there
 * is nothing to say yet, and while disconnected there is nothing the user *can* do from here. Each
 * of those gets the sentence that tells them what to do next.
 */
function EmptyWork(props: {
  hasProjects: boolean;
  loaded: boolean;
  connection: string;
  onStart: () => void;
}): JSX.Element {
  if (props.connection !== "connected" && props.connection !== "connecting") {
    return (
      <div className="work__empty">
        <h2>EnvoyCoder cannot reach its daemon</h2>
        <p>
          The daemon is the process that runs your tasks, and it is not answering. It starts with the
          app, so this usually fixes itself in a moment.
        </p>
      </div>
    );
  }
  if (!props.loaded) {
    return (
      <div className="work__empty">
        <h2>Loading your projects…</h2>
      </div>
    );
  }
  return (
    <div className="work__empty">
      <h2>{props.hasProjects ? "No task open" : "No projects yet"}</h2>
      <p>
        {props.hasProjects
          ? "Pick a task on the left, or start one in a project. Agents run on this machine and, when the mesh is attached, on your other machines too."
          : "Add a directory you work in, and EnvoyCoder can run agents there."}
      </p>
      <button type="button" className="button button--primary" onClick={props.onStart}>
        {props.hasProjects ? "Start a task" : "Add a project"}
      </button>
    </div>
  );
}

function projectFor(projects: readonly Project[], task: Task): Project | undefined {
  return projects.find((project) => project.id === task.projectId);
}
