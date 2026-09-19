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

import { useEffect, useMemo, useState } from "react";

import { useShortcuts, type ShortcutActions } from "../input/useShortcuts.js";
import { wiredBindings } from "../input/shortcuts.js";
import type { Project, Task } from "@envoydev/protocol";
import { taskTitleFromPrompt } from "@envoydev/task-model";

import { startWindowDrag } from "../client/window-drag.js";
import { hasShellPicker, pickFolder } from "../client/folder-picker.js";
import {
  canOpenProjectInNewWindow,
  openProjectInNewWindow,
  takePendingProject,
} from "../client/new-window.js";
import { useT } from "../i18n/context.js";
import {
  asFailure,
  localNotice,
  localize,
  localizeText,
  type Notice,
  type WriteFailure,
} from "../i18n/notice.js";
import { CoderSidebar } from "./CoderSidebar.js";
import { CommandCenter, buildCommandContributions } from "./CommandCenter.js";
import { PanelRightIcon } from "./icons.js";
import { TaskPane } from "./TaskPane.js";
import { MeshStatusBar } from "./MeshStatusBar.js";
import { SettingsPane } from "./SettingsPane.js";
import { useSettingsLayout } from "./SettingsNav.js";
import { mintPairingCode, type PairPhoneOutcome } from "./settings/PairPhone.js";
import type { CoderState } from "../state/coderStore.js";
// The logo, bundled by Vite: one import, and the built app carries the file with it (the Tauri build copies the
// frontend `dist` into the bundle, so an image the window shows has to come through the bundler, not from a path
// on disk).
import logo from "../../assets/logo-128.png";
import type { CoderStore } from "../state/coderStore.js";
import {
  PROJECTS_SCOPE,
  appScope,
  entryScope,
  projectScope,
  scopeProjectId,
  type SettingsScope,
} from "../state/settings-scope.js";

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
   * Project this window was opened to work in ("Open in new window" / pending from the shell).
   * Consumed once on mount; drives rail collapse + selecting a recent task in that project.
   */
  const [focusProjectId, setFocusProjectId] = useState<string | undefined>(undefined);
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
    | {
        commandId?: string;
        idPrefix?: string;
        status?: Notice;
        seedValue?: string;
      }
    | undefined
  >(undefined);

  /** Open the palette on a workflow. `undefined` intent is the catalogue (⌘K). */
  const openPalette = (
    intent?: {
      commandId?: string;
      idPrefix?: string;
      status?: Notice;
      seedValue?: string;
    },
  ): void => {
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
  const startNewTask = async (projectId: string, title = ""): Promise<WriteFailure> => {
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
        return undefined;
      }
    }
    const created = await props.actions.createTask({ projectId, title });
    if (!created.ok) return created;
    // Selected first: the rail shows the new row and the pane shows its chat, in one paint. A task
    // created but not opened would look like the button had done nothing.
    setActiveId(created.task.id);
    if (title === "") return undefined;
    const started = await props.actions.startRun(created.task.id, title);
    return started.ok ? undefined : started;
  };

  /**
   * Register a project, then open an empty draft in it — the same landing as "+ New".
   *
   * Re-adding a folder that is already on the rail is still success (the daemon says so), but it must
   * not spawn another draft every time: only a path that was not listed yet gets the automatic task.
   */
  const addProjectAndOpenDraft = async (path: string): Promise<WriteFailure> => {
    const knownIds = new Set(state.projects.map((project) => project.id));
    const result = await props.actions.addProject(path);
    if (!result.ok) return result;
    if (!knownIds.has(result.project.id)) {
      return startNewTask(result.project.id);
    }
    return undefined;
  };

  /**
   * **+ Add project on the rail** — pick a folder and register it, without opening the Command Center.
   *
   * The old path opened the palette on `project.add`, which then opened the folder chooser on top of it.
   * After *Choose*, the dialog closed onto that palette — exactly the "jumped to the command center"
   * report. The rail already named the action; the chooser is enough. The palette row stays for ⌘K
   * and for windows with no shell picker (browser), where typing a path is the only option.
   *
   * A refusal still has to be *read*. Opening an empty `project.add` and discarding the `WriteFailure`
   * was the Bugbot finding: the typed-path palette path keeps the sentence in its status line, and the
   * rail must do the same — seed the path, show the refusal, skip a second picker. A draft that fails
   * after a successful add lands under the new project row (`toRail`), because that row is already on
   * screen.
   */
  const addProjectFromRail = (): void => {
    if (!hasShellPicker()) {
      openPalette({ commandId: "project.add" });
      return;
    }
    void (async () => {
      const picked = await pickFolder(t("palette.addProject.pickPrompt"));
      if (picked.kind === "cancelled") return;
      if (picked.kind === "unavailable") {
        // No chooser after all — fall through to the palette's typed path, which explains why.
        openPalette({ commandId: "project.add" });
        return;
      }
      const knownIds = new Set(state.projects.map((project) => project.id));
      const added = await props.actions.addProject(picked.path);
      if (!added.ok) {
        openPalette({
          commandId: "project.add",
          status: added,
          seedValue: picked.path,
        });
        return;
      }
      if (!knownIds.has(added.project.id)) {
        toRail(added.project.id, await startNewTask(added.project.id));
      }
    })();
  };
  /**
   * Which settings the pane is showing — and whether it is showing at all.
   *
   * **One value, not a boolean beside a payload.** `undefined` is "the pane is closed"; anything else is
   * a scope of the pane's own navigation (`settings-scope.ts`): the list of sections, one section, the
   * list of projects, or one project's defaults. A `settingsOpen: boolean` beside a
   * `settingsProjectId?: string` could say "open, and also on no particular project and not on the list
   * either" — states the code would have to keep agreeing about, and the *third* scope's arrival is what
   * made that unaffordable. The fourth (a section) and the root (the list of sections) were added without
   * touching any of the three that already existed, which is the property the union was chosen for.
   *
   * Where the pane opens depends on the window, not on history: `entryScope(layout)` — a wide window
   * opens on the first section, because the bar listing the others is already beside it, and a narrow one
   * opens on the list of sections, because the bar has no room to be a column there. That is a fact about
   * the window rather than "where the user came from", which is the state `settings-scope.ts` refuses.
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
   * A project that disappears while its settings are open falls back to **the projects page** — the level
   * its own back control returns to, and the one place that lists the thing that vanished. `resolveScope`
   * is that rule and `settings-scope.ts`'s module doc is the argument for it; the pane applies it on every
   * render, so this shell does not have to catch the case at all. Removing one *here* is the same case
   * reached deliberately, and `removeProjectRow` moves the scope down a level itself so the fallback does
   * not have to wait for the refetch the daemon's change event triggers.
   */
  /**
   * How much room this window has — **one `matchMedia` query, read once, handed to both readers.**
   *
   * Two things need it and they must not disagree: where *opening* settings lands (`entryScope`: a wide
   * window has the bar already, so it opens on the first section; a narrow one opens on the list of
   * sections, which is the page the bar would otherwise be), and whether the pane renders the bar at all.
   * The pane is told rather than sniffing, so a second query cannot exist — and a test can render the
   * narrow layout without a browser.
   */
  const layout = useSettingsLayout();
  const [settingsScope, setSettingsScope] = useState<SettingsScope | undefined>(undefined);
  /**
   * **The code minted for the current Pairing visit**, on its way to *Settings → Mobile Pairing*.
   *
   * Held here rather than inside the page because the press happens here: the rail QR, the palette
   * row, and the settings-bar item are this shell's navigation, and the page may not be mounted yet.
   * Cleared when leaving Pairing so a code the user has moved past cannot come back — a pairing URI
   * is a secret with an expiry, not a value to rediscover.
   */
  const [mintedPairing, setMintedPairing] = useState<PairPhoneOutcome | undefined>(undefined);
  /**
   * Every way the pane's scope changes. Opening **Mobile Pairing** also mints here — in the click
   * handler, not in a mount effect — so `<StrictMode>` cannot create two paired-device records, and
   * the code appears as soon as the page opens without a second "Show pairing code" press.
   */
  const goToSettings = (scope: SettingsScope | undefined): void => {
    setSettingsScope(scope);
    if (scope?.kind === "app" && scope.section === "pairing") {
      void mintPairingCode(props.actions).then(setMintedPairing);
      return;
    }
    setMintedPairing(undefined);
  };
  const openAppSettings = (): void => goToSettings(entryScope(layout));
  const closeSettings = (): void => goToSettings(undefined);
  /**
   * **The palette's *Pair a phone* row and the rail's QR** — same destination as the settings-bar item.
   *
   * One function so the three ways in cannot mint by three routes. Navigation mints; the page only
   * renders the answer (`PairingSection` + `mintedPairing`).
   */
  const openPairing = (): void => {
    goToSettings(appScope("pairing"));
  };
  /**
   * The one way into a project's settings, whoever asks.
   *
   * Two callers pass the project through: the rail's project `…` menu (*"Project settings"*) and a row of
   * the pane's own projects page. One function rather than two is the whole reason the two routes can be
   * described as one model — a project's scope reached one way cannot behave differently from the same
   * scope reached the other.
   */
  const openProjectSettings = (project: Project): void => {
    setSettingsScope(projectScope(project.id));
  };

  /** Pull the landing project once, when this window was opened via "Open in new window". */
  useEffect(() => {
    let cancelled = false;
    void takePendingProject().then((projectId) => {
      if (!cancelled && projectId) setFocusProjectId(projectId);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Once the daemon's project list includes the landing project, select its most recently updated
   * task so the work area is not blank — and only if the user has not already picked a task.
   */
  useEffect(() => {
    if (!focusProjectId || activeId !== undefined) return;
    if (!state.projects.some((project) => project.id === focusProjectId)) return;
    const newest = [...state.tasks]
      .filter((task) => task.projectId === focusProjectId && !task.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (newest) setActiveId(newest.id);
  }, [focusProjectId, state.projects, state.tasks, activeId]);

  /** The explorer sits on the right of the open task. The control itself is in the title bar. */
  const [explorerOpen, setExplorerOpen] = useState(false);
  /**
   * **The two failures this shell routes, because it is what holds the press.**
   *
   * Every other surface owns its own sink: a settings row renders the answer its `write` was handed, the
   * catalogue's rows and the fix blocks have theirs, and the palette keeps itself open. These two do not
   * because the press and the display are in different components — a row in the rail is drawn by
   * `CoderSidebar` while the callback lives here, and the composer's write callbacks live here while the line
   * under the composer is drawn by `TaskPane`.
   *
   * The rail's is keyed by row id, so a removal that failed says so under the row it was asked for. The
   * pane's is keyed by task id: a failure about one task must not follow the user into another task's chat,
   * which is exactly what a single un-keyed slot would do.
   */
  const [railFailure, setRailFailure] = useState<{ rowId: string; notice: Notice } | undefined>(undefined);
  const [paneFailure, setPaneFailure] = useState<{ taskId: string; notice: Notice } | undefined>(undefined);
  /** Route a press's answer to the rail row (or the pane) that asked for it. */
  const toRail = (rowId: string, failure: WriteFailure): WriteFailure => {
    setRailFailure(failure ? { rowId, notice: failure } : undefined);
    return failure;
  };
  const toPane = (taskId: string, failure: WriteFailure): WriteFailure => {
    setPaneFailure(failure ? { taskId, notice: failure } : undefined);
    return failure;
  };

  /**
   * Open this project in another window — the project's `…` menu, desktop shell only.
   *
   * Same shape as Paseo's kebab item: the shell creates the window and records the project id;
   * the new window pulls it on mount. Failures land under the project row (toRail), not in a toast.
   */
  const openProjectWindow = (project: Project): void => {
    void openProjectInNewWindow(project.id).then((result) => {
      if (result.ok) return;
      toRail(project.id, localNotice("sidebar.project.menu.openNewWindowFailed"));
    });
  };
  /**
   * Take one project off the rail — the row menu's Remove, after its own inline confirmation.
   *
   * The daemon does the honest half of this: `coder.removeProject` drops the project row and **archives
   * that project's tasks**, so they leave the rail without a folder, a file or a transcript on disk being
   * touched. What the window has to add is the consequence the daemon cannot see — *which pane is open*.
   *
   * The id is moved down a level, and that is not belt-and-braces: the pane resolves the scope against
   * the live list on every render, so it would land on the projects page either way, but doing it here
   * means the fallback happens in the same paint as the removal rather than after the refetch the
   * daemon's `coder:state-changed` event triggers. A pane that spent a frame titled "Project settings for
   * api" for a project that no longer exists is the exact thing requirement 5 of the removal work asks
   * not to render.
   *
   * The open task needs nothing: `active` is derived from `state.tasks`, and the removal archives every
   * task of this project, so the pane empties itself the moment the list arrives.
   */
  const removeProjectRow = async (projectId: string): Promise<WriteFailure> => {
    const removed = await props.actions.removeProject(projectId);
    if (!removed.ok) return removed;
    setSettingsScope((current) =>
      current?.kind === "project" && current.id === projectId ? PROJECTS_SCOPE : current,
    );
    return undefined;
  };

  /** Take one task off the rail — the row menu's Remove, after its own inline confirmation. */
  const removeTaskRow = async (taskId: string): Promise<WriteFailure> => {
    // The daemon archives rather than deletes (`coder.archiveTask`), which is why the menu item says
    // "Remove" and the question says the folder and its files are not touched.
    const removed = await props.actions.archiveTask(taskId, true);
    if (!removed.ok) return removed;
    if (activeId === taskId) setActiveId(undefined);
    return undefined;
  };

  /** Rename a task from its own row. The refusal is shown, on the same rule as every other action. */
  const renameTaskRow = async (taskId: string, title: string): Promise<WriteFailure> => {
    const renamed = await props.actions.updateTask({ id: taskId, title });
    return renamed.ok ? undefined : renamed;
  };

  /**
   * Why the list of projects is empty for a reason other than "there is nothing in it".
   *
   * The rail can only draw what the store holds, and the store holds an empty list for two very
   * different reasons: nobody has registered a project yet, or the window never managed to read them.
   * This is what tells the difference, in the user's own language, and it is why the rail no longer
   * says "No projects yet" to a user whose project is on disk — the failure that made "adding a
   * project did nothing" look true when the daemon had already stored it.
   *
   * **Two readers, one answer.** The rail renders it as its empty state, and the settings pane renders
   * it twice: as the second band of level 1's *Projects* row and as the failure message on level 2. A
   * count is a claim about the list, and "No projects" over a list nobody could read is the same lie
   * the rail was fixed for — which is the reason this value is computed once here and handed to both
   * surfaces rather than derived again inside the pane.
   *
   * Both failure shapes are covered, because the window has both: a call that came back refused (the
   * store keeps the last one), and a connection that never opened (the reason lives on the chip).
   * While the window is merely still connecting, this stays undefined — a rail that shouts on the
   * first paint before the first answer arrives would be a new lie, not a fix.
   */
  const projectsUnavailable = useMemo(() => {
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
  //
  // It is a named value rather than an inline argument because the settings pane renders the *same*
  // object: `wiredBindings` below is the table filtered by the actions here, which is what makes the
  // Shortcuts section a report of what the window listens for instead of a list of what the table
  // declares — three of the seven bindings have no action in this build, and a page that printed their
  // combos would be advertising keys that do nothing.
  const shortcutActions: ShortcutActions = {
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
  };
  useShortcuts(shortcutActions);
  // Cheap (eight comparisons) and derived, so no `useMemo`: memoising it would add a dependency array
  // that has to be kept in step with the object above for no measurable gain.
  const wiredShortcuts = wiredBindings(shortcutActions);

  // The active task follows the data rather than being remembered across a reconnect: an id from a
  // previous daemon is a row that is no longer there, and rendering a pane for it would show a task
  // the user cannot act on.
  const active: Task | undefined = useMemo(
    () => state.tasks.find((task) => task.id === activeId),
    [state.tasks, activeId],
  );

  /**
   * **The run this task holds, and whether the window actually knows it is going.**
   *
   * Three states, not two, and the missing one produced the owner's report:
   *
   * > *"why I sent message, but got 'That run has already finished, so there is nothing to send to it. Start a new
   * > task instead.'"*
   *
   * `runLive` used to be `state.runs[runId]?.run.endedAt === undefined`, which is **true when the record is
   * absent** — because `undefined === undefined`. So a task whose `runId` came from a daemon that has since
   * restarted (a record nobody ever fetched) read as *running*: the composer queued the message behind it, the
   * daemon answered "that run has already finished", and the message was cleared on the way out. Our ignorance
   * was rendered as a claim about the machine — the one thing this product's rules forbid.
   *
   * So "live" requires the record: an unknown run is not running, the composer offers to start one, and the effect
   * below asks the daemon about it in the same breath.
   */
  const activeRun = active?.runId === undefined ? undefined : state.runs[active.runId];
  const runLive = activeRun !== undefined && activeRun.run.endedAt === undefined;

  /**
   * **Ask about the run the pane is showing**, once, whenever it is not one we have.
   *
   * A task started by another window, or before this one connected, arrives with a `runId` and no transcript —
   * and the pane has to render something true for it. `openRun` fetches the daemon's own record and events (and,
   * for a run the daemon no longer has, records it as ended without raising the bar).
   */
  useEffect(() => {
    if (active?.runId === undefined || state.runs[active.runId] !== undefined) return;
    void props.actions.openRun(active.runId);
  }, [active?.runId, state.runs, props.actions]);

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
          // **A success says nothing.** The banner used to announce "Added EnvoyDev." across the top of
          // the window, which told the user what they had just watched themselves do and made the strip
          // a thing to dismiss rather than a thing to read. The project appearing in the rail *is* the
          // confirmation. Only a refusal speaks — and it speaks **in the palette**, which stays open with the
          // field still holding what was typed, so a bad path can be corrected and pressed again.
          //
          // An empty path never reaches the daemon: it is the palette's own question, and this is its answer.
          // A newly registered project also opens an empty draft (same landing as "+ New").
          if (!path) return localNotice("palette.addProject.noFolder");
          return addProjectAndOpenDraft(path);
        },
        onNewTask: async (projectId, title) => {
          if (!title) return undefined;
          // The title *is* the first prompt: a task with a name and no work is a row that does
          // nothing, and asking for both is the friction that makes a control plane tedious.
          const created = await props.actions.createTask({ projectId, title });
          if (!created.ok) return created;
          setActiveId(created.task.id);
          const started = await props.actions.startRun(created.task.id, title);
          return started.ok ? undefined : started;
        },
        onOpenSettings: openAppSettings,
        onPairPhone: openPairing,
        onRevealTask: (taskId) => setActiveId(taskId),
      }),
    [state.projects, state.tasks, state.settings.defaultProjectPath, props.actions, t],
  );

  return (
    <div className="shell">
      {/* **Tauri drags a window by an attribute, not by CSS.** `-webkit-app-region: drag` is the Electron
          mechanism and Tauri ignores it, which is why this bar could not move the window at all — and why
          the same rule swallowed clicks on the controls inside it. The attribute applies to the element it
          is set on, so the buttons in this row stay clickable. */}
      <header
        className="titlebar"
        data-tauri-drag-region
        /* Tauri's attribute only fires when the *pressed element* carries it, and this bar is covered by
           its children — so the drag is asked for explicitly. A press on a control returns false and the
           control behaves normally. */
        onMouseDown={(event) => startWindowDrag(event)}
      >
        {/* The product mark stays here. Hiding the project list used to live beside it, and that
            took the list — and the button that brought it back — off the window. The list stays. */}
        {/* **The app's own mark, from the asset the product ships** (`apps/desktop/assets/logo.png`, rendered at
            18px from a 128px copy so a window does not decode a megabyte for a favicon-sized slot). It is
            decorative — `alt=""` — because the name is right beside it and a screen reader that read both would
            say the product twice. */}
        <img className="titlebar__logo" src={logo} alt="" width={18} height={18} data-tauri-drag-region />
        <span className="titlebar__title" data-tauri-drag-region>{t("app.name")}</span>
        <span className="titlebar__spacer" data-tauri-drag-region />
        <button
          type="button"
          className="button button--ghost button--icon has-hint"
          aria-label={t("explorer.toggle")}
          data-hint={t("explorer.toggle")}
          aria-pressed={explorerOpen}
          onClick={() => setExplorerOpen((open) => !open)}
        >
          <PanelRightIcon />
        </button>
        <ConnectionChip state={state} />
        {/* Pair, Settings and Command Center live on the rail's top row (`CoderSidebar`), beside
            "+ Add project" — not duplicated here. The palette still opens via ⌘K on that row. */}
      </header>

      {state.error ? (
        // **What the window could not do, and only that.** A read that failed, a daemon this build cannot talk
        // to. A press that was refused is answered where it was made — the row, the composer, the palette —
        // because a sentence about one control, shown in a bar above every surface, names nothing, moves the
        // window, and has to be dismissed before the user can get on with what they were doing.
        <div className="banner" role="status">
          {/* The daemon's sentence, rendered through its key: German for a German user, and the English
              sentence it sent whenever this build has no translation for that key. */}
          <span>{localize(t, state.error)}</span>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => props.actions.clearError()}
          >
            {t("notice.dismiss")}
          </button>
        </div>
      ) : null}

      <div className="shell__body">
        <CoderSidebar
            projects={state.projects}
            tasks={state.tasks}
            activeTaskId={activeId}
            onSelect={setActiveId}
            onNewTask={(projectId) => {
              // "+ New" on a project header names the project, so there is nothing left to ask: the task
              // is created and opened, and the composer is the form. A refusal answers under that project's
              // own row — including the one the ⌘N shortcut produces, which has no row of its own to speak in.
              void startNewTask(projectId).then((failure) => toRail(projectId, failure));
            }}
            onAddProject={addProjectFromRail}
            onOpenProjectSettings={openProjectSettings}
            onChangeProjectAgent={async (project, defaults) => {
              const result = await props.actions.updateProject({ id: project.id, defaults });
              if (!result.ok) return result;
              return { ok: true as const };
            }}
            harnesses={state.harnesses}
            appHarness={state.settings.defaults.harness ?? "envoy-harness"}
            onOpenProjectInNewWindow={canOpenProjectInNewWindow() ? openProjectWindow : undefined}
            onRemoveProject={(projectId) => void removeProjectRow(projectId).then((f) => toRail(projectId, f))}
            focusProjectId={focusProjectId}
            onRenameTask={(taskId, title) => void renameTaskRow(taskId, title).then((f) => toRail(taskId, f))}
            onRemoveTask={(taskId) => void removeTaskRow(taskId).then((f) => toRail(taskId, f))}
            failure={railFailure}
            onOpenCommandCenter={() => openPalette()}
            onOpenSettings={openAppSettings}
            onShowPairing={openPairing}
            unavailable={projectsUnavailable}
            tasksUnknown={!state.tasksKnown}
          />

        <main className="work">
          {settingsScope !== undefined ? (
            <SettingsPane
              state={state}
              // Which scope the pane is on: the list of sections, one section, the projects page, or one
              // project's. The pane resolves it against the live project list itself, so a project that
              // has gone cannot leave it rendering rows that write to something that is not there.
              scope={settingsScope}
              // The window's shape, resolved once above: it decides whether the bar is rendered beside
              // the content or the list of sections *is* the content.
              layout={layout}
              // The keys the shell has actually mounted, not the table: see `shortcutActions` above.
              shortcuts={wiredShortcuts}
              // The same value the rail renders as "could not read your projects" — see its own doc
              // above. The pane needs it for the same reason: a count band that reads "No projects" over
              // a list nobody could read is the failure this shell already fixed once.
              projectsUnavailable={projectsUnavailable}
              // The pane's own navigation, and it is this one function or none: a row — a bar item, a
              // section row, a project row — names the scope a press goes to (`scopeForSection`,
              // `projectScope(id)`, `SECTIONS_SCOPE`) and the shell stores it. One callback rather than
              // four is what makes "each back control returns to its own level" a property of the data
              // instead of four handlers that have to agree.
              onNavigate={goToSettings}
              onClose={closeSettings}
              // The pairing code the palette minted before this pane opened, when there is one — see
              // `openPairing` and `PairingSection`. Data, so absent is the ordinary visit.
              {...(mintedPairing !== undefined ? { mintedPairing } : {})}
              // The agents page's own five calls, handed over as the store itself: `CoderStore` satisfies
              // `AgentActions` structurally, so there is no adapter to drift from the methods it names.
              agents={props.actions}
              // **The answer, not a `void`.** A settings write that was refused is rendered by the row it was
              // pressed in (`SettingRow`'s `write`); the window's own strip is for what the *window* could not
              // do, so nothing here raises it globally.
              onUpdate={(patch) => props.actions.updateSettings(patch).then(asFailure)}
              // A project's defaults, written whole because they replace: see `coderStore.updateProject`.
              // The refusal goes to the strip rather than vanishing — a project whose defaults could not
              // be saved must not keep showing the value the user picked.
              onUpdateProject={(defaults) => {
                // The id the scope *resolves* to, not the one it holds: a scope naming a project that has
                // since gone writes to nothing, and a write to a removed project would fail for a control
                // the user never pressed.
                const projectId = scopeProjectId(settingsScope, state.projects);
                if (projectId === undefined) return Promise.resolve(undefined);
                return props.actions.updateProject({ id: projectId, defaults }).then(asFailure);
              }}
            />
          ) : active ? (
            <TaskPane
              task={active}
              project={projectFor(state.projects, active)}
              events={active.runId ? (state.runs[active.runId]?.events ?? []) : []}
              runLive={runLive}
              harnesses={state.harnesses}
              appHarness={state.settings.defaults.harness ?? "envoy-harness"}
              onChangeProjectAgent={async (defaults) => {
                const project = projectFor(state.projects, active);
                if (project === undefined) {
                  return { ok: false as const, message: "No project for this task." };
                }
                const result = await props.actions.updateProject({ id: project.id, defaults });
                if (!result.ok) return result;
                return { ok: true as const };
              }}
              // **The window's half of the build-skew rule.** The probe is a method this build added, so a
              // window attached to an older daemon (the shell attaches to whichever build owns the port)
              // asks `coder.hello` first — and offers no button at all when the answer is no, rather than
              // one whose press comes back "Method not found". The global version-skew notice already tells
              // the user which build is behind and what to do about it.
              // Read from the state the store already publishes rather than through a new store method:
              // `hello` **is** the daemon's own method catalogue, and a second accessor for one boolean
              // would be a second thing for every test double of the store to implement.
              probeSupported={
                state.hello?.methods.includes("coder.probeSessionOptions") === true
              }
              explorerOpen={explorerOpen}
              onListDirectory={(path) => props.actions.listDirectory(path)}
              onListChanges={(path) => props.actions.listWorktreeChanges(path)}
              onReadFile={(path) => props.actions.readFile(path)}
              onReadDiff={(directory, path, from) => props.actions.readWorktreeDiff(directory, path, from)}
              onCreateEntry={(directory, name, kind) => props.actions.createEntry(directory, name, kind)}
              onProbeAgent={(harness, options) =>
                props.actions.probeSessionOptions(harness, options)
              }
              notice={active && paneFailure?.taskId === active.id ? localize(t, paneFailure.notice) : undefined}
              onNewTask={() => {
                void startNewTask(active.projectId).then((failure) => toRail(active.projectId, failure));
              }}
              onStart={async (prompt, agentModeId, model, thinkingLevel, images) => {
                const result = await props.actions.startRun(active.id, prompt, {
                  ...(agentModeId !== undefined ? { agentModeId } : {}),
                  ...(model !== undefined ? { model } : {}),
                  ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
                  ...(images !== undefined && images.length > 0 ? { images } : {}),
                });
                if (!result.ok) {
                  // **The answer, back to the composer**, which keeps the prompt in the field rather than
                  // clearing it into a refusal the user has not read yet.
                  toPane(active.id, result);
                  return result;
                }
                // The first message names the task, when it has no name yet. Done after the run starts,
                // so a refusal to rename can never take the prompt down with it — the agent is already
                // working, and a title is a label.
                if (active.title === "") {
                  const named = taskTitleFromPrompt(prompt);
                  if (named !== "") await props.actions.updateTask({ id: active.id, title: named });
                }
                return undefined;
              }}
              // The mode is saved on the task, not merely sent with the next run: it is part of what
              // this task *is*, and a choice that vanished with the window would make the picker
              // decorative. The run reads the task's copy, so the two can never disagree.
              onChangeMode={async (agentModeId) => {
                toPane(active.id, asFailure(await props.actions.updateTask({ id: active.id, agentModeId })));
              }}
              // The model is saved on the task for the same reason the mode is: it is part of what this
              // task *is*, and a run started after a restart must use the same model without the window
              // having to repeat it. `""` travels as-is — it is the control's "the agent's own default",
              // and the daemon is what decides to drop the stored model rather than store an empty one.
              onChangeModel={async (model) => {
                toPane(active.id, asFailure(await props.actions.updateTask({ id: active.id, model })));
              }}
              // And the thinking level, on exactly the model's terms: stored on the task because it is
              // part of what this task *is*, with `""` travelling as the request to clear it. The
              // daemon is what turns that into "drop the key" rather than a level called nothing.
              onChangeThinking={async (thinkingLevel) => {
                toPane(active.id, asFailure(await props.actions.updateTask({ id: active.id, thinkingLevel })));
              }}
              onToggleFeature={async (id, value) => {
                toPane(
                  active.id,
                  asFailure(
                    await props.actions.updateTask(
                      id === "fast_mode" ? { id: active.id, fastMode: value } : { id: active.id, planMode: value },
                    ),
                  ),
                );
              }}
              // A refusal here is worth showing: "that is not a folder on this machine" is the one
              // thing the user has to fix before the next run can start.
              onChangeFolder={async (path) => {
                toPane(active.id, asFailure(await props.actions.updateTask({ id: active.id, cwd: path })));
              }}
              onSend={async (text, mode, images) => {
                if (!active.runId) return undefined;
                const failure = asFailure(await props.actions.sendToRun(active.runId, text, mode, images));
                return toPane(active.id, failure);
              }}
              onCancel={async () => {
                if (!active.runId) return;
                toPane(active.id, asFailure(await props.actions.cancelRun(active.runId)));
              }}
              onAnswer={async (requestId, optionId) => {
                if (!active.runId) return;
                toPane(active.id, asFailure(await props.actions.answerApproval(active.runId, requestId, optionId)));
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
        initialStatus={paletteIntent?.status}
        initialSeedValue={paletteIntent?.seedValue}
      />
    </div>
  );
}

/** The connection, said the way a user needs it rather than the way the socket reports it. */
function ConnectionChip(props: { state: CoderState }): JSX.Element | null {
  const t = useT();
  const { connection } = props.state;
  if (connection.state === "connected") {
    /**
     * **Nothing, and a badge used to stand here.**
     *
     * It read `hello.windowCount` and said "2 windows" — which is where the owner's question came from, and the
     * answer had two halves. The number was *wrong*: the window opened two sockets because `start()`'s guard did
     * not survive its own `await`, so the daemon counted two connections from one window (`coder-store.test.ts`,
     * "one window, one socket"). And even when right, the number is a **snapshot from connect time** — it never
     * updates when a second window opens, or when one closes — so a badge in the title bar could contradict the
     * truth and never correct itself. The same count is on *Settings → This machine*, where a user goes to ask
     * "what am I attached to?" and where the row now says which moment it was read.
     *
     * A live badge would need the daemon to emit a change when its connection count moves and the window to
     * re-read `hello`; that is real work for a number with nothing to act on, so it was removed rather than
     * half-fixed.
     */
    return null;
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
