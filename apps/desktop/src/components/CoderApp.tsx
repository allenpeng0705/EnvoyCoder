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
import { taskTitleFromPrompt } from "@envoycoder/task-model";

import { useT } from "../i18n/context.js";
import { localNotice, localize, localizeText, type Notice } from "../i18n/notice.js";
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

/**
 * Where "New task" should land, given what there is to choose from.
 *
 * One project means there is no choice to make, so the palette opens on that project's command and the
 * user's first keystroke is the task's title — the whole point of starting the workflow directly. With
 * several, the chooser *is* the list: the palette is restricted to the new-task rows, which are titled
 * "New task in {project}", so picking a project is one click and then the same single field. Zero
 * projects is not a task flow at all: it sends the user to registering one, which is the only useful
 * next step.
 */
function newTaskIntent(projects: readonly Project[]): { commandId?: string; idPrefix?: string } {
  if (projects.length === 0) return { commandId: "project.add" };
  if (projects.length === 1) return { commandId: `task.new.${projects[0]!.id}` };
  return { idPrefix: "task.new." };
}

export function CoderApp(props: CoderAppProps): JSX.Element {
  // (the new-task flow is defined inside the component so it can drive the selection)
  const t = useT();
  const { state } = props;
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /**
   * What the palette was opened *for*, if anything.
   *
   * Every task affordance in this window used to open the same thing: the catalogue of every command,
   * which then had to be searched for the one the button already named. The user's words for it were
   * *"the new task or add task still open the dialog including all the things"* — and they are right:
   * "New task" is a workflow, not a choice between workflows. So a button opens the palette **on its own
   * command**, and only ⌘K opens the catalogue.
   */
  const [paletteIntent, setPaletteIntent] = useState<
    { commandId?: string; idPrefix?: string } | undefined
  >(undefined);

  /** Open the palette on a workflow. `undefined` intent is the catalogue (⌘K). */
  const openPalette = (intent?: { commandId?: string; idPrefix?: string }): void => {
    setPaletteIntent(intent);
    setPaletteOpen(true);
  };

  /**
   * Start a task: create it, open it, and let the chat be the form.
   *
   * Paseo's "New workspace" is the model, and the user asked for it in as many words: *"new workspace is
   * to start a new chat session and it gave the chatting UI directly"*. So "+ New" does not ask for a
   * title first — it registers the task, selects it, and puts the cursor in the composer. Sending the
   * first message starts the run **and names the task** from that message (`taskTitleFromPrompt`),
   * which is how a workspace gets its name in Paseo too.
   *
   * A title passed in still starts the run immediately, because the palette's rows and the smoke test
   * both take that path — the difference is only whether the user typed the prompt before the task
   * existed or after.
   */
  const startNewTask = async (projectId: string, title = ""): Promise<void> => {
    setNotice(undefined);
    // **The empty chat is a draft, and a draft is reused.** Paseo's helper is called `ensureWorkspace`
    // for the same reason: pressing "+ New" twice because the first press looked like nothing happened
    // should not leave two unnamed rows behind. Only an unnamed task with nothing running counts — a task
    // that has been talked to is work, and the next press is asking for more work.
    if (title === "") {
      const draft = state.tasks.find(
        (task) => task.projectId === projectId && task.title === "" && task.runId === undefined,
      );
      if (draft) {
        setActiveId(draft.id);
        return;
      }
    }
    const created = await props.actions.createTask({ projectId, title });
    if (!created.ok) {
      setNotice(created);
      return;
    }
    // Selected first: the rail shows the new row and the pane shows its chat, in one paint. A task
    // created but not opened would look like the button had done nothing.
    setActiveId(created.task.id);
    if (title === "") return;
    const started = await props.actions.startRun(created.task.id, title);
    if (!started.ok) setNotice(started);
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * Which settings the pane is showing: this machine's, or one project's.
   *
   * The project row's menu item says "Project settings" (`sidebar.project.settings`) and carries the
   * project through, so the pane renders that project's defaults (`docs/settings-parity.md` §7.3, §8.1).
   * The item used to *be* the whole button, labelled *"Project settings for {project}"*, and it opened
   * the **app** pane with the project discarded — a control that does something other than what it says,
   * which is the same defect as a setting that does nothing.
   *
   * **An id, not the project object, and that is not a detail.** The first version stored the object it
   * was handed at click time — a snapshot — while the pane's rows read their current value from it and
   * write the values it does not touch back alongside the one it does. Since a project's defaults
   * **replace** rather than merge (`store.ts:293-308`), a snapshot meant the second edit in a session
   * wrote the first one away: change the model, then the agent, and the model is gone. Resolving the id
   * against `state.projects` on every render is what makes the second edit carry the first;
   * `test/settings-scope.test.tsx` fails on the snapshot.
   *
   * A project that disappears while the pane is open — removed in another window — falls back to the
   * app scope. That is the honest answer: the pane is titled "Settings", the rows are this machine's,
   * and nothing claims to be editing a project that no longer exists. Removing one *here* is the same
   * case reached deliberately, and `removeProjectRow` clears the id so the fallback does not have to
   * wait for the refetch the daemon's change event triggers.
   */
  const [settingsProjectId, setSettingsProjectId] = useState<string | undefined>(undefined);
  const settingsProject = useMemo(
    () =>
      settingsProjectId === undefined
        ? undefined
        : props.state.projects.find((project) => project.id === settingsProjectId),
    [settingsProjectId, props.state.projects],
  );
  const openAppSettings = (): void => {
    setSettingsProjectId(undefined);
    setSettingsOpen(true);
  };
  /**
   * The one way into a project's settings, whoever asks.
   *
   * Two callers pass the project through: the rail's project `…` menu (*"Project settings"*) and the
   * Projects section inside the app-scope pane, whose rows are that project's own scope. One function
   * rather than two is the whole reason the two routes can be described as one model — a project's
   * scope reached one way cannot behave differently from the same scope reached the other.
   */
  const openProjectSettings = (project: Project): void => {
    setSettingsProjectId(project.id);
    setSettingsOpen(true);
  };
  const [railOpen, setRailOpen] = useState(true);
  /**
   * The strip's own notice, **as a notice rather than a string**.
   *
   * A refusal from the daemon arrives as an English sentence plus the catalogue key for it, and the
   * decision about which one to show is made here, at render time — so the strip is re-rendered in
   * German the moment the language setting changes, even for a refusal that arrived before it did.
   * A string translated once at arrival could not do that.
   */
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  /**
   * Take one project off the rail — the row menu's Remove, after its own inline confirmation.
   *
   * The daemon does the honest half of this: `coder.removeProject` drops the project row and **archives
   * that project's tasks**, so they leave the rail without a folder, a file or a transcript on disk being
   * touched. What the window has to add is the consequence the daemon cannot see — *which pane is open*.
   *
   * The id is cleared, and that is not belt-and-braces: `settingsProject` resolves the id against the
   * live list on every render, so the pane falls back to the app scope either way, but clearing it here
   * means the fallback happens in the same paint as the removal rather than after the refetch the
   * daemon's `coder:state-changed` event triggers. A pane that spent a frame titled "Project settings for
   * api" for a project that no longer exists is the exact thing requirement 5 of the removal work asks
   * not to render.
   *
   * The open task needs nothing: `active` is derived from `state.tasks`, and the removal archives every
   * task of this project, so the pane empties itself the moment the list arrives.
   */
  const removeProjectRow = async (projectId: string): Promise<void> => {
    const removed = await props.actions.removeProject(projectId);
    if (!removed.ok) {
      setNotice(removed);
      return;
    }
    setSettingsProjectId((current) => (current === projectId ? undefined : current));
  };

  /** Take one task off the rail — the row menu's Remove, after its own inline confirmation. */
  const removeTaskRow = async (taskId: string): Promise<void> => {
    // The daemon archives rather than deletes (`coder.archiveTask`), which is why the menu item says
    // "Remove" and the question says the folder and its files are not touched.
    const removed = await props.actions.archiveTask(taskId, true);
    if (!removed.ok) {
      setNotice(removed);
      return;
    }
    if (activeId === taskId) setActiveId(undefined);
  };

  /** Rename a task from its own row. The refusal is shown, on the same rule as every other action. */
  const renameTaskRow = async (taskId: string, title: string): Promise<void> => {
    const renamed = await props.actions.updateTask({ id: taskId, title });
    if (!renamed.ok) setNotice(renamed);
  };

  /**
   * Why the rail would be empty for a reason other than "there is nothing in it".
   *
   * The rail can only draw what the store holds, and the store holds an empty list for two very
   * different reasons: nobody has registered a project yet, or the window never managed to read them.
   * This is what tells the difference, in the user's own language, and it is why the rail no longer
   * says "No projects yet" to a user whose project is on disk — the failure that made "adding a
   * project did nothing" look true when the daemon had already stored it.
   *
   * Both failure shapes are covered, because the window has both: a call that came back refused (the
   * store keeps the last one), and a connection that never opened (the reason lives on the chip).
   * While the window is merely still connecting, this stays undefined — a rail that shouts on the
   * first paint before the first answer arrives would be a new lie, not a fix.
   */
  const railUnavailable = useMemo(() => {
    if (state.loaded) return undefined;
    const refusal = localize(t, state.error);
    if (refusal !== undefined) return refusal;
    if (state.connection.state === "disconnected") {
      return localizeText(t, state.connection.reason) ?? t("sidebar.empty.cannotLoadBody");
    }
    return undefined;
  }, [state.loaded, state.error, state.connection, t]);

  // **The keyboard, which did not exist.** `⌘K` was printed on a button with nothing behind it, so the
  // palette — and "Add project…" inside it — could not be reached by keyboard at all. This mounts the
  // registry from `input/shortcuts.ts` and binds it to the shell's own state.
  useShortcuts({
    // ⌘K and ⌘P stay the catalogue: that is what a command palette is for, and a user who presses it is
    // asking "what can this app do?" rather than "start a task".
    "commandCenter.open": () => openPalette(),
    "search.find": () => openPalette(),
    // ⌘N asks for one thing, so it starts that workflow: the task's project is chosen by picking a row
    // (or skipped entirely when there is only one project to choose from).
    "newTask": () => {
      // With one project there is nothing to ask: create the task and open its chat. With several, the
      // chooser *is* the list (see `newTaskIntent`).
      const intent = newTaskIntent(state.projects);
      if (intent.commandId?.startsWith("task.new.")) {
        void startNewTask(intent.commandId.slice("task.new.".length));
        return;
      }
      openPalette(intent);
    },
    "settings.open": openAppSettings,
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
        t,
        projects: state.projects,
        // **`defaultProjectPath`'s read site.** The setting is the folder "Add project…" starts from,
        // and this is what makes that true: the row seeds its text stage with it, so the field a user
        // meets is already filled in with the place they nominated. Without this line the key was
        // stored, validated and advertised on the wire while being read by nothing at all
        // (`docs/settings-parity.md` §7.1), and `test/settings-coverage.test.ts` is the gate that keeps
        // a field from losing its reader again.
        ...(state.settings.defaultProjectPath !== undefined
          ? { defaultProjectPath: state.settings.defaultProjectPath }
          : {}),
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
            setNotice(localNotice("palette.addProject.noFolder"));
            return;
          }
          const result = await props.actions.addProject(path);
          setNotice(result.ok ? undefined : result);
        },
        onNewTask: async (projectId, title) => {
          if (!title) return;
          // The title *is* the first prompt: a task with a name and no work is a row that does
          // nothing, and asking for both is the friction that makes a control plane tedious.
          const created = await props.actions.createTask({ projectId, title });
          if (!created.ok) {
            setNotice(created);
            return;
          }
          setActiveId(created.task.id);
          const started = await props.actions.startRun(created.task.id, title);
          if (!started.ok) setNotice(started);
        },
        onOpenSettings: openAppSettings,
        onPairPhone: () => setNotice(localNotice("palette.pairPhone.notYet")),
        onToggleRail: () => setRailOpen((open) => !open),
        onRevealTask: (taskId) => setActiveId(taskId),
      }),
    [state.projects, state.tasks, state.settings.defaultProjectPath, props.actions, t],
  );

  return (
    <div className={`shell${railOpen ? "" : " shell--rail-hidden"}`}>
      <header className="titlebar">
        <button
          type="button"
          className="button button--ghost button--icon"
          aria-label={railOpen ? t("app.rail.hide") : t("app.rail.show")}
          onClick={() => setRailOpen((open) => !open)}
          title={t("app.rail.toggle")}
        >
          ▤
        </button>
        <span className="titlebar__title">{t("app.name")}</span>
        <span className="titlebar__spacer" />
        <ConnectionChip state={state} />
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setPaletteOpen(true)}
          title={t("palette.title")}
        >
          {t("palette.title")}
        </button>
      </header>

      {notice || state.error ? (
        <div className="banner" role="status">
          {/* The daemon's refusal, rendered through its key: German for a German user, and the
              English sentence it sent whenever this build has no translation for that key. */}
          <span>{localize(t, notice ?? state.error)}</span>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => {
              setNotice(undefined);
              props.actions.clearError();
            }}
          >
            {t("notice.dismiss")}
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
              // "+ New" on a project header names the project, so there is nothing left to ask: the task
              // is created and opened, and the composer is the form.
              void startNewTask(projectId);
            }}
            onAddProject={() => openPalette({ commandId: "project.add" })}
            onOpenProjectSettings={openProjectSettings}
            onRemoveProject={(projectId) => void removeProjectRow(projectId)}
            onRenameTask={(taskId, title) => void renameTaskRow(taskId, title)}
            onRemoveTask={(taskId) => void removeTaskRow(taskId)}
            onOpenCommandCenter={() => openPalette()}
            onOpenSettings={openAppSettings}
            unavailable={railUnavailable}
            tasksUnknown={!state.tasksKnown}
          />
        ) : null}

        <main className="work">
          {settingsOpen ? (
            <SettingsPane
              state={state}
              // The project scope when the pane was opened from a project row, and the app scope
              // otherwise. `settingsProject` is what the `⋯` button carries through, and what makes the
              // button's accessible name true.
              {...(settingsProject !== undefined ? { project: settingsProject } : {})}
              onClose={() => setSettingsOpen(false)}
              onUpdate={(patch) => void props.actions.updateSettings(patch)}
              // The pane's own navigation, and it is these two functions or none: the same
              // `openProjectSettings` the rail's project menu calls (so the two routes into a project
              // cannot come to mean different things) and the same `openAppSettings` ⌘, and the footer's
              // Settings button call (so the scope's back control lands exactly where they do).
              onOpenProjectSettings={openProjectSettings}
              onOpenAppSettings={openAppSettings}
              // A project's defaults, written whole because they replace: see `coderStore.updateProject`.
              // The refusal goes to the strip rather than vanishing — a project whose defaults could not
              // be saved must not keep showing the value the user picked.
              onUpdateProject={(defaults) => {
                if (!settingsProject) return;
                void props.actions.updateProject({ id: settingsProject.id, defaults }).then((result) => {
                  if (!result.ok) setNotice(result);
                });
              }}
            />
          ) : active ? (
            <TaskPane
              task={active}
              project={projectFor(state.projects, active)}
              events={active.runId ? (state.runs[active.runId]?.events ?? []) : []}
              runLive={active.runId ? state.runs[active.runId]?.run.endedAt === undefined : false}
              harnesses={state.harnesses}
              onStart={async (prompt, agentModeId, model, thinkingLevel) => {
                const result = await props.actions.startRun(active.id, prompt, {
                  ...(agentModeId !== undefined ? { agentModeId } : {}),
                  ...(model !== undefined ? { model } : {}),
                  ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
                });
                if (!result.ok) {
                  setNotice(result);
                  return;
                }
                // The first message names the task, when it has no name yet. Done after the run starts,
                // so a refusal to rename can never take the prompt down with it — the agent is already
                // working, and a title is a label.
                if (active.title === "") {
                  const named = taskTitleFromPrompt(prompt);
                  if (named !== "") await props.actions.updateTask({ id: active.id, title: named });
                }
              }}
              // The mode is saved on the task, not merely sent with the next run: it is part of what
              // this task *is*, and a choice that vanished with the window would make the picker
              // decorative. The run reads the task's copy, so the two can never disagree.
              onChangeMode={async (agentModeId) => {
                const result = await props.actions.updateTask({ id: active.id, agentModeId });
                if (!result.ok) setNotice(result);
              }}
              // The model is saved on the task for the same reason the mode is: it is part of what this
              // task *is*, and a run started after a restart must use the same model without the window
              // having to repeat it. `""` travels as-is — it is the control's "the agent's own default",
              // and the daemon is what decides to drop the stored model rather than store an empty one.
              onChangeModel={async (model) => {
                const result = await props.actions.updateTask({ id: active.id, model });
                if (!result.ok) setNotice(result);
              }}
              // And the thinking level, on exactly the model's terms: stored on the task because it is
              // part of what this task *is*, with `""` travelling as the request to clear it. The
              // daemon is what turns that into "drop the key" rather than a level called nothing.
              onChangeThinking={async (thinkingLevel) => {
                const result = await props.actions.updateTask({ id: active.id, thinkingLevel });
                if (!result.ok) setNotice(result);
              }}
              // A refusal here is worth showing: "that is not a folder on this machine" is the one
              // thing the user has to fix before the next run can start.
              onChangeFolder={async (path) => {
                const result = await props.actions.updateTask({ id: active.id, cwd: path });
                if (!result.ok) setNotice(result);
              }}
              onSend={async (text, mode) => {
                if (!active.runId) return;
                const result = await props.actions.sendToRun(active.runId, text, mode);
                if (!result.ok) setNotice(result);
              }}
              onCancel={async () => {
                if (!active.runId) return;
                const result = await props.actions.cancelRun(active.runId);
                if (!result.ok) setNotice(result);
              }}
              onAnswer={async (requestId, optionId) => {
                if (!active.runId) return;
                const result = await props.actions.answerApproval(active.runId, requestId, optionId);
                if (!result.ok) setNotice(result);
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
        onClose={() => {
          setPaletteOpen(false);
          // The intent is spent on open, so it is cleared with the palette: reopening it later must not
          // silently drop the user back into a workflow they have already moved on from.
          setPaletteIntent(undefined);
        }}
        contributions={contributions}
        initialCommandId={paletteIntent?.commandId}
        initialIdPrefix={paletteIntent?.idPrefix}
      />
    </div>
  );
}

/** The connection, said the way a user needs it rather than the way the socket reports it. */
function ConnectionChip(props: { state: CoderState }): JSX.Element | null {
  const t = useT();
  const { connection } = props.state;
  if (connection.state === "connected") {
    const windows = props.state.hello?.windowCount ?? 1;
    return windows > 1 ? (
      <span className="chip chip--quiet" title={t("app.windows.title")}>
        {t("app.windows.count", { count: windows })}
      </span>
    ) : null;
  }
  const label =
    connection.state === "connecting"
      ? t("connection.starting")
      : connection.state === "disconnected"
        ? t("connection.unreachable")
        : t("connection.none");
  return (
    <span
      className="chip chip--warn"
      title={connection.state === "disconnected" ? localizeText(t, connection.reason) : ""}
    >
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
  const t = useT();
  if (props.connection !== "connected" && props.connection !== "connecting") {
    return (
      <div className="work__empty">
        <h2>{t("work.offline.title")}</h2>
        <p>{t("work.offline.body")}</p>
      </div>
    );
  }
  if (!props.loaded) {
    return (
      <div className="work__empty">
        <h2>{t("work.loading")}</h2>
      </div>
    );
  }
  return (
    <div className="work__empty">
      <h2>{props.hasProjects ? t("work.noTask.title") : t("work.noProjects.title")}</h2>
      <p>{props.hasProjects ? t("work.noTask.body") : t("work.noProjects.body")}</p>
      <button type="button" className="button button--primary" onClick={props.onStart}>
        {props.hasProjects ? t("work.noTask.action") : t("work.noProjects.action")}
      </button>
    </div>
  );
}

function projectFor(projects: readonly Project[], task: Task): Project | undefined {
  return projects.find((project) => project.id === task.projectId);
}
