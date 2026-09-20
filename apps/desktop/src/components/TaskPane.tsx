/**
 * The pane: header, transcript, composer.
 *
 * Four deliberate choices, each inherited from something that works rather than invented here:
 *
 *   1. **The header states where the work is.** Host only appears when the task is not on this
 *      machine — saying "This machine" on every local task is noise. Cwd and branch stay visible.
 *   2. **The composer distinguishes Queue from Steer.** Sending while an agent works either waits for
 *      the turn or joins it; one control that silently picks for the user is how people conclude the
 *      agent ignored their message.
 *   3. **Approvals are a block in the transcript, not a modal.** A modal blocks the window and hides
 *      the context needed to decide; the request belongs inline, where the agent paused.
 *   4. **The transcript is rendered from events, and this component does no folding.** Joining
 *      chunks, pairing a tool call with its result and attaching an approval to its call all happen
 *      in `state/transcript.ts`, which is pure and tested. This file turns rows into elements.
 *
 * ## Where "Remove task" went, and why it is not here any more
 *
 * The header used to carry it, with its own inline confirmation. It now lives on the task's **row in the
 * rail** (`CoderSidebar`'s row menu), and this pane has no removal control at all. The reason is the one
 * the rail's own comment gives: the action changes the *row*, so the row is where the confirmation can
 * show the thing being decided — and one destructive action with one home is one sentence to keep true
 * instead of two that drift. The wording did not move anywhere: the row menu renders the same
 * `task.remove.*` keys this pane used, including the sentence that says the task leaves the rail and is
 * archived and that the folder and its files are not touched. Its two tests moved with it rather than
 * being dropped — "ask before removing, and Cancel removes nothing" is asserted in `sidebar.test.tsx`.
 */

import type { JSX } from "react";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  HarnessId,
  HarnessSummary,
  ProbeOutcome,
  Project,
  PromptImage,
  RunEvent,
  Task,
  TaskDefaults,
} from "@envoydev/protocol";

import { hasShellPicker, pickFolder } from "../client/folder-picker.js";
import { agentFor } from "../composer/agent-for.js";
import {
    canSend,
    composeTurn,
    ingestFiles,
    MAX_ATTACHMENTS,
    pastedImages,
  type ComposerAttachment,
  type IngestNotice,
} from "../composer/attachments.js";
import {
  composerControls,
  modeOffReason,
  modelOffReason,
  taskLocationLabel,
  thinkingOffReason,
} from "../composer/controls.js";
import { harnessBadge, harnessLabel, modelAcceptsBareId } from "../composer/harness-label.js";
import {
  filterSlashCommands,
  latestSlashCommands,
  slashQuery,
} from "../composer/slash-commands.js";
import { probeAsk, publishesOnlyInSession, type ProbeState } from "../composer/probe.js";
import { useT } from "../i18n/context.js";
import {
  localize,
  localizeText,
  noticeOf,
  type Refusal,
  type WriteFailure,
  statusKey,
} from "../i18n/notice.js";
import { buildTranscript, type TranscriptEntry } from "../state/transcript.js";
import { ApprovalChoices } from "./ApprovalChoices.js";
import { ComposerControls } from "./ComposerControls.js";
import { AttachButton, AttachmentTray } from "./ComposerAttach.js";
import {
  ExplorerSidebar,
  type ChangeListing,
  type DirectoryListing,
  type ExplorerChange,
} from "./ExplorerSidebar.js";
import type { OpenedFile } from "./FileView.js";
import { SlashCommandList } from "./SlashCommandList.js";
import { WorkArea, type FileOpenRequest, type OpenedDiff } from "./WorkArea.js";
import { FolderIcon } from "./icons.js";
import { MessageMarkdown } from "./markdown/MessageMarkdown.js";
import { ProjectAgentPicker } from "./ProjectAgentPicker.js";

export interface TaskPaneProps {
  task: Task;
  project: Project | undefined;
  /** The events of the run this pane is showing, oldest first. */
  events: readonly RunEvent[];
  /** The run's own status, which the header shows and the composer branches on. */
  runLive: boolean;
  /**
   * Say something to the running turn.
   *
   * **It answers**, and the answer is what decides whether the field is cleared: `undefined` means it landed, a
   * refusal means the message is still the user's — the words stay in the box, the refusal is rendered under the
   * composer, and the next press can try again (or, when the daemon said the run is finished, start a new one).
   * A composer that cleared the field on the way out lost the message to a refusal nobody had answered yet.
   */
  onSend: (
    text: string,
    mode: "queue" | "steer",
    images?: PromptImage[],
  ) => WriteFailure | Promise<WriteFailure>;
  onCancel: () => void | Promise<void>;
  onAnswer: (requestId: string, choice: string | readonly string[] | { text: string }) => void | Promise<void>;
  /**
   * Start this task's run with the first message.
   *
   * `agentModeId` and `model` arrive **only when there is one to send** — when the agent can be put
   * into a mode or onto a model and one is chosen. The daemon reads the task's stored values when an
   * argument is absent, so the two say the same thing; carrying them here as well is what keeps the
   * control's *displayed* value and the value the run is started with identical even if the
   * `updateTask` that saved the choice is still in flight.
   */
  onStart: (
    prompt: string,
    agentModeId?: string,
    model?: string,
    thinkingLevel?: string,
    images?: PromptImage[],
  ) => WriteFailure | Promise<WriteFailure>;
  /** Remember the agent's mode for this task, so the next run starts the way the user left it. */
  onChangeMode?: (agentModeId: string) => void | Promise<void>;
  /**
   * Remember this task's model. `""` clears it, which is a real choice — the agent's own default —
   * and the only way to undo a model without replacing it with another one.
   */
  onChangeModel?: (model: string) => void | Promise<void>;
  /**
   * Remember this task's thinking level, on exactly the model's terms.
   *
   * A level is the agent's own id, so `""` here also means "the agent's own default": the value is
   * cleared rather than stored, and the next run leaves the choice to the agent.
   */
  onChangeThinking?: (level: string) => void | Promise<void>;
  /** Remember Fast or Plan for this task. The next run applies whichever the agent accepts. */
  onToggleFeature?: (id: "fast_mode" | "plan_mode", value: boolean) => void | Promise<void>;
  /** Move this task to another folder. Applies to the next run — the agent keeps the one it started in. */
  onChangeFolder?: (path: string) => void | Promise<void>;
  /**
   * The agents this daemon offers, from `coder.listHarnesses` — the mode picker's data.
   *
   * Optional because the list arrives asynchronously, and because a pane rendered on its own (a test,
   * a preview) has no daemon to ask. Absent means *unknown*, which the control says out loud rather
   * than rendering as an agent with no modes — two different facts that must not look alike.
   */
  harnesses?: readonly HarnessSummary[];
  /** App-wide default agent — used when the project has not set its own. */
  appHarness?: HarnessId;
  /**
   * Change this project's coding agent (migrates idle tasks on the daemon).
   *
   * Absent when there is no project, or in a pane rendered without a write path.
   */
  onChangeProjectAgent?: (defaults: TaskDefaults) => Promise<{ ok: true } | Refusal>;
  /**
   * Ask this agent what it offers, before any run — the pre-flight probe.
   *
   * A callback rather than a flag, because the *decision* to ask belongs to this pane (it is the one that
   * knows a control is being rendered for an agent whose options exist only inside a session) and the
   * *call* belongs to the store. Absent in a pane rendered without a daemon, which is what a test does —
   * and then no probe is offered at all, rather than a button that goes nowhere.
   */
  onProbeAgent?: (
    harness: HarnessId,
    options: { force: boolean },
  ) => Promise<{ ok: true; outcome: ProbeOutcome; detail: string } | Refusal>;
  /**
   * Does the connected daemon serve `coder.probeSessionOptions`?
   *
   * From `coder.hello`'s own `methods`, so a window attached to an **older daemon** (the shell attaches to
   * whichever build owns the port) shows the unaware state instead of a button that would come back
   * "Method not found". `undefined` is no.
   */
  probeSupported?: boolean;
  /**
   * Whether the title bar's explorer control is on.
   *
   * The button lives in the window chrome, not in this pane: that is the top-right control, and it
   * has to be there even before a daemon has advertised the listing methods. This pane only draws
   * the sidebar.
   */
  explorerOpen?: boolean;
  /** List one folder. A refusal is shown in the sidebar, not the window banner. */
  onListDirectory?: (path: string) => Promise<DirectoryListing>;
  /** Git changes in the task folder. `repo: false` is an answer, not a failure. */
  onListChanges?: (path: string) => Promise<ChangeListing>;
  /**
   * The Changes tab's three git writes, passed straight through.
   *
   * The pane owns the layout, the sidebar owns the list: a copy of these here would be a second place that
   * decides what the tab can do, and the first thing to go stale is always the copy further from the data.
   */
  onStage?: (paths: readonly string[]) => Promise<{ ok: true; changes: readonly ExplorerChange[] } | Refusal>;
  onUnstage?: (paths: readonly string[]) => Promise<{ ok: true; changes: readonly ExplorerChange[] } | Refusal>;
  onCommit?: (message: string) => Promise<{ ok: true; sha: string; changes: readonly ExplorerChange[] } | Refusal>;
  /** Open one file from the explorer into a tab. */
  onReadFile?: (path: string) => Promise<{ ok: true; file: OpenedFile } | Refusal>;
  /** Open one change as a diff tab. `directory` is the task folder. */
  onReadDiff?: (
    directory: string,
    path: string,
    from?: string,
  ) => Promise<{ ok: true; diff: OpenedDiff } | Refusal>;
  /** Create an empty file or a folder in the task's directory. */
  onCreateEntry?: (
    directory: string,
    name: string,
    kind: "file" | "dir",
  ) => Promise<{ ok: true; path: string } | Refusal>;
  /** Shown under the composer when a send was refused, in the daemon's words. */
  notice?: string | undefined;
  /** Start another conversation in this project. The tab row's Task item. */
  onNewTask?: () => void;
}

/**
 * What a brand-new chat offers to start with.
 *
 * Design law 6 is "empty states teach" — this one teaches *and* removes the blank-page problem, which
 * is the other half of "hard to use": an empty composer with no idea what to type. A chip fills the
 * composer and puts the cursor at the end; it deliberately does **not** send, because sending a
 * sentence the user has not read is not help, it is a surprise.
 */
const SUGGESTIONS = [
  "task.empty.suggestion.one",
  "task.empty.suggestion.two",
  "task.empty.suggestion.three",
] as const;

export function TaskPane(props: TaskPaneProps): JSX.Element {
  const t = useT();
  const { task, project, events } = props;
  const running = props.runLive;
  const [viewingFile, setViewingFile] = useState(false);
  const [openRequest, setOpenRequest] = useState<FileOpenRequest | undefined>(undefined);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachNotice, setAttachNotice] = useState<string | undefined>(undefined);
  const [dropping, setDropping] = useState(false);
  /** A mode the user has just chosen, before the task's saved copy comes back. */
  const [pickedMode, setPickedMode] = useState<string | undefined>(undefined);
  /** A model the user has just chosen, for the same reason and with the same lifetime. */
  const [pickedModel, setPickedModel] = useState<string | undefined>(undefined);
  /** A thinking level the user has just chosen, for the same reason again. */
  const [pickedThinking, setPickedThinking] = useState<string | undefined>(undefined);
  /** Why the folder chooser would not open, after a click that tried. */
  const [pickerProblem, setPickerProblem] = useState<string | undefined>(undefined);
  /**
   * What this pane knows about asking each agent what it offers, **keyed by agent**.
   *
   * Keyed by agent rather than by task, and deliberately not cleared when the task changes: the answer is
   * a fact about an agent, so two tasks on `dsh` share it. A version keyed by task would ask again — and so
   * start the agent again — every time the user switched between two tasks that use the same one.
   */
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  /**
   * Follow the newest row until the reader scrolls up.
   *
   * A selected task's history often arrives a moment later (`openRun`). Marking the task "already
   * scrolled" on the empty pane left the real transcript at the top. Sticking until a scroll-up
   * means that late history, and a live reply while the reader is already at the end, still land
   * at the bottom — and reading earlier messages is not yanked.
   */
  const stickToEnd = useRef(true);
  const stickTask = useRef<string | undefined>(undefined);

  const transcript = buildTranscript(events);
  const approvalOpen = transcript.pendingApprovalId !== undefined;
  const commandQuery = slashQuery(text);
  const commandMatches =
    commandQuery === undefined ? [] : filterSlashCommands(latestSlashCommands(events), commandQuery);
  const [commandIndex, setCommandIndex] = useState(0);
  const commandActive =
    commandMatches.length === 0 ? 0 : ((commandIndex % commandMatches.length) + commandMatches.length) % commandMatches.length;

  const pickCommand = (name: string): void => {
    setText(`/${name} `);
    setCommandIndex(0);
    inputRef.current?.focus();
  };

  // A different task in the same pane is a different agent with different modes, so a choice made for
  // the previous one must not appear to be in force here.
  useEffect(() => {
    setPickedMode(undefined);
    setPickedModel(undefined);
    setPickedThinking(undefined);
    setPickerProblem(undefined);
    setAttachments([]);
    setAttachNotice(undefined);
    setDropping(false);
  }, [task.id]);

  /* ── the controls above the field: what they offer is decided in `composer/controls.ts` ── */
  const summary = props.harnesses?.find((harness) => harness.id === task.harness);
  const agent = agentFor(task.harness, summary);

  /**
   * Both controls, in one call: they branch on the same two facts (what the agent publishes, and
   * whether the daemon can deliver it), and computing them separately is how the two ends come to
   * disagree about the agent. The task's own model is passed in so `model.selected` is the value the
   * control would show with nothing clicked.
   */
  const controls = composerControls(agent, { running, approvalPending: approvalOpen }, {
    selectedModelId: task.model,
    // The task's stored level, so the picker opens on what the next run will use. Absent is "the
    // agent's own default", which is a state rather than a missing value — the same rule as the model.
    ...(task.thinkingLevel !== undefined ? { selectedThinkingLevel: task.thinkingLevel } : {}),
  });

  // What each picker shows: the user's just-made choice, else what the task remembers, else the agent's
  // own default. In that order, so a click is never overwritten by a request still in flight.
  const storedMode =
    task.agentModeId !== undefined && controls.mode.options.some((mode) => mode.id === task.agentModeId)
      ? task.agentModeId
      : undefined;
  const selectedModeId = pickedMode ?? storedMode ?? controls.mode.selected ?? undefined;
  const modeEnabled = controls.mode.enabled;
  const modeOff = modeOffReason(controls.mode, { known: summary !== undefined, agent: agent.label });
  // The model's half of the same rule, and it reads the *logic's* answer rather than the task again:
  // `task.model` is handed to `composerControls` above, so "what the control shows" is decided in one
  // place instead of being recomputed here where the two could drift. `undefined` — nothing stored and
  // nothing picked — is the agent's own default, which is a state rather than a missing value.
  const listed = controls.model.options;
  const stored =
    pickedModel ??
    (typeof controls.model.selected === "string" && controls.model.selected !== ""
      ? controls.model.selected
      : undefined);
  const inList = stored !== undefined && listed.some((model) => model.id === stored);
  // Envoy Harness has one saved model. A task that still says "default", or an old catalogue id,
  // shows that model — it is the one the next run will use.
  const selectedModelId =
    task.harness === "envoy-harness" && !inList && listed.length === 1 ? listed[0]?.id : stored;
  const modelOff = modelOffReason(controls.model, {
    known: summary !== undefined,
    agent: agent.label,
  });
  // The thinking level's half, and it is *two* off-states rather than one: "the agent publishes levels
  // we have not seen yet" and "this agent offers none" are different sentences, and `thinkingOffReason`
  // is what keeps the first from being read as the second.
  const selectedThinkingLevel = pickedThinking ?? controls.thinking.selected ?? undefined;
  const thinkingOff = thinkingOffReason(controls.thinking, {
    known: summary !== undefined,
    agent: agent.label,
  });

  /* ── asking the agent what it offers ──
     The three gates and the four states are decided in `composer/probe.ts`, so they are testable without a
     DOM; what is here is only the state machine and the call. */
  const probeState: ProbeState = probes[task.harness] ?? { state: "idle" };
  const probe = probeAsk({
    agent: agent.label,
    // `envoy-harness` publishes its models in its own source and has no thought-level surface, so there is
    // nothing a probe could learn: this is the gate that keeps the built-in harness from being spawned for
    // no reason.
    unlisted: publishesOnlyInSession(agent),
    supported: props.probeSupported === true,
    availability: agent.availability.state,
    state: probeState,
  });

  /**
   * Ask, and keep the answer against **this agent**.
   *
   * The three outcomes arrive as successes (`listed`, `none`, `unreachable`) and a failed *call* arrives as
   * a `Refusal`; both end up in the same place, because to a user they are the same statement — we could not
   * ask, and here is why — and the refusal already carries its own key, so it needs no rewording here.
   */
  const askAgent = async (force: boolean): Promise<void> => {
    const ask = props.onProbeAgent;
    if (!ask) return;
    const harness = task.harness;
    setProbes((previous) => ({ ...previous, [harness]: { state: "asking" } }));
    const answer = await ask(harness, { force });
    setProbes((previous) => ({
      ...previous,
      [harness]: {
        state: "answered",
        outcome: answer.ok ? answer.outcome : "unreachable",
        detail: answer.ok ? (noticeOf(answer.detail) ?? { message: answer.detail }) : answer,
      },
    }));
  };

  /**
   * The first ask: once per agent, when a control that needs the list is on screen.
   *
   * `probe.ask` is true only in the `idle` state of an agent the daemon can be asked about, so this cannot
   * loop — after the state becomes `asking` it is false, and it stays false once an answer arrives. A pane
   * that re-renders (a transcript event, a keystroke) does not ask again.
   */
  useEffect(() => {
    if (!probe.ask) return;
    void askAgent(false);
  }, [probe.ask, task.harness]);

  // `hasShellPicker()` is synchronous on purpose (see `folder-picker.ts`): a control that decides after
  // an `await` looks like a dead click, and a disabled one can say why in the same tick as the render.
  const canChooseFolder = props.onChangeFolder !== undefined && hasShellPicker();
  /** The permanent half of the folder control's off state — attached to the chip, never a paragraph. */
  const folderUnavailable = canChooseFolder ? undefined : t("task.composer.folder.noPicker");

  const chooseFolder = async (): Promise<void> => {
    if (!props.onChangeFolder) return;
    setPickerProblem(undefined);
    const result = await pickFolder(t("task.composer.folder.aria"));
    if (result.kind === "picked") {
      await props.onChangeFolder(result.path);
      return;
    }
    // A closed dialog is not an error and is not reported; a dialog that would not open is.
    if (result.kind === "unavailable") setPickerProblem(result.reason);
  };

  // Follow the newest row when a task is opened, and whenever its history arrives after that.
  // Instant, not the pane's smooth scroll: a smooth jump starts from the previous task's position
  // and finishes on whatever height the transcript had at that moment, which is often empty.
  const onTranscriptScroll = (): void => {
    const node = transcriptRef.current;
    if (!node) return;
    stickToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
  };

  useLayoutEffect(() => {
    if (stickTask.current !== task.id) {
      stickTask.current = task.id;
      stickToEnd.current = true;
    }
    const jump = (): void => {
      const node = transcriptRef.current;
      if (!node || !stickToEnd.current) return;
      const previous = node.style.scrollBehavior;
      node.style.scrollBehavior = "auto";
      node.scrollTop = node.scrollHeight;
      node.style.scrollBehavior = previous;
    };
    jump();
    // Code fences and diagrams change the height after the first layout. One more frame
    // catches that without waiting for another event.
    const frame = requestAnimationFrame(jump);
    return () => cancelAnimationFrame(frame);
  }, [task.id, transcript.entries.length]);

  /**
   * Send, **and keep the words until they land**.
   *
   * The field used to be cleared the moment the call was dispatched, so a refusal — the daemon saying the run is
   * finished, or that an approval is in the way — erased what the user had written and answered with a sentence
   * about a run. The answer decides now: cleared when it lands, kept when it does not, with the refusal rendered
   * under the composer by the shell.
   */
  /** Keep the words unless the send lands — see `submit`, and `settle`'s two shapes. */
  const clearDraft = (): void => {
    setText("");
    setAttachments([]);
    setAttachNotice(undefined);
  };

  const settle = (answer: WriteFailure | Promise<WriteFailure>): void => {
    if (answer !== undefined && typeof (answer as Promise<WriteFailure>).then === "function") {
      void (answer as Promise<WriteFailure>).then((failure) => {
        if (failure === undefined) clearDraft();
      });
      return;
    }
    // A caller that answered **synchronously** has already landed: cleared now, in the same tick as the press.
    if (answer === undefined) clearDraft();
  };

  const noticeFor = (reason: IngestNotice): string =>
    reason === "limit"
      ? t("task.composer.attach.limit", { count: MAX_ATTACHMENTS })
      : reason === "too-big"
        ? t("task.composer.attach.tooBig")
        : reason === "empty"
          ? t("task.composer.attach.empty")
          : reason === "unreadable"
            ? t("task.composer.attach.unreadable")
            : t("task.composer.attach.binary");

  const addFiles = (files: readonly File[]): void => {
    if (approvalOpen || files.length === 0) return;
    void ingestFiles(attachments, files).then((result) => {
      setAttachments(result.attachments);
      setAttachNotice(result.reason === undefined ? undefined : noticeFor(result.reason));
    });
  };

  const submit = (): void => {
    if (!canSend(text, attachments)) return;
    const turn = composeTurn(text, attachments, {
      imageOnly: t("task.composer.attach.imagesOnly"),
      imagesOnly: t("task.composer.attach.imagesOnlyMany"),
      named: t("task.composer.attach.named", {
        names: attachments.map((attachment) => attachment.name).join(", "),
      }),
    });
    if (turn.prompt === "") return;
    const images = turn.images.length > 0 ? turn.images : undefined;
    // **`queue`, always.** A message sent while the agent is working waits for the turn in flight and is
    // delivered as the next prompt — the daemon's own default, and the one behaviour the window has a control
    // for no longer. `steer` remains on the wire (`coder.sendToRun {mode}`) for a client that offers it.
    if (running) {
      settle(images === undefined ? props.onSend(turn.prompt, "queue") : props.onSend(turn.prompt, "queue", images));
      return;
    }
    // The mode travels only when the picker is on and something is chosen. Passing it always would
    // mean inventing an "undefined mode" for the agents that have none, and the daemon already reads
    // the task's stored mode when the argument is absent. The model travels on identical terms, and
    // `""` — the control's "the agent's own default" — is not a model to pass, so it is dropped here
    // and the daemon reads the task, which the `updateTask` that saved the clearing has just emptied.
    else {
      const chosenModel = selectedModelId !== undefined && selectedModelId !== "" ? selectedModelId : undefined;
      // The thinking level travels on identical terms: only when the control works and something is
      // chosen, so an agent with no thought-level method is never handed an "undefined level" it would
      // have to interpret. `""` — the control's "the agent's own default" — is dropped here, and the
      // daemon reads the task, whose stored level the `updateTask` that cleared it has just emptied.
      const chosenThinking =
        thinkingOff === undefined && selectedThinkingLevel !== undefined && selectedThinkingLevel !== ""
          ? selectedThinkingLevel
          : undefined;
      settle(
        images === undefined
          ? props.onStart(turn.prompt, modeEnabled ? selectedModeId : undefined, chosenModel, chosenThinking)
          : props.onStart(turn.prompt, modeEnabled ? selectedModeId : undefined, chosenModel, chosenThinking, images),
      );
    }
  };

  const explorer =
    props.explorerOpen === true &&
    props.onListDirectory !== undefined &&
    props.onListChanges !== undefined;

  return (
    <section
      className={["pane", explorer ? "pane--explorer" : "", viewingFile ? "pane--file" : ""].filter(Boolean).join(" ")}
      aria-label={t("task.aria", { title: task.title || t("task.untitled") })}
    >
      <header className="pane__header">
        <div className="pane__title-group">
          <h1 className="pane__title">{task.title || t("task.untitled")}</h1>
          <div className="pane__meta">
            {/* Status as a colour only — same dots as the rail. Agent and model are link-style text,
                not chips: their lengths change with every task, and pills make a short name and a long
                id look like two different controls. */}
            <span
              className={`dot ${dotClassFor(task.status)}`}
              aria-label={t(statusKey(task.status))}
              title={t(statusKey(task.status))}
            />
            {project !== undefined && props.onChangeProjectAgent !== undefined && props.harnesses !== undefined ? (
              <ProjectAgentPicker
                project={project}
                appHarness={props.appHarness ?? "envoy-harness"}
                harnesses={props.harnesses}
                appearance="meta"
                onChoose={props.onChangeProjectAgent}
              />
            ) : (
              <span className="pane__meta-link" title={harnessLabel(task.harness)}>
                {harnessBadge(task.harness)}
              </span>
            )}
            {task.model ? (
              <>
                <span className="pane__meta-sep" aria-hidden>
                  ·
                </span>
                <span className="pane__meta-link" title={task.model}>
                  {task.model}
                </span>
              </>
            ) : null}
            {/* **Where the task runs, and the control that moves it.**
                Same link style as the facts beside it — a chip here would reintroduce the uneven pills.
                The press still opens the folder chooser; the whole path stays in the title. */}
            <span className="pane__meta-sep" aria-hidden>
              ·
            </span>
            <button
              type="button"
              className="pane__meta-link pane__cwd"
              title={
                folderUnavailable === undefined ? task.cwd : `${task.cwd} — ${folderUnavailable}`
              }
              aria-label={t("task.composer.folder.aria")}
              {...(folderUnavailable !== undefined ? { "aria-describedby": "pane-cwd-reason" } : {})}
              disabled={!canChooseFolder}
              onClick={() => void chooseFolder()}
            >
              <FolderIcon size={12} />
              {taskLocationLabel(task.cwd, project === undefined ? undefined : { label: project.label, path: project.path })}
            </button>
            {folderUnavailable === undefined ? null : (
              <p className="visually-hidden" id="pane-cwd-reason">
                {folderUnavailable}
              </p>
            )}
            {task.worktree ? (
              <>
                <span className="pane__meta-sep" aria-hidden>
                  ·
                </span>
                <span className="pane__meta-link" title={task.worktree.path}>
                  {task.worktree.branch}
                </span>
              </>
            ) : null}
            {task.hostId && task.hostId !== "local" ? (
              <>
                <span className="pane__meta-sep" aria-hidden>
                  ·
                </span>
                <span className="pane__meta-link" title={t("task.meta.host")}>
                  {task.hostId}
                </span>
              </>
            ) : null}
          </div>
          {/* **A press that failed, under the chip that was pressed.** §7.27's rule, and the reason this is
              not silence: the chooser refused, so the header says so where the click was made. */}
          {pickerProblem === undefined ? null : (
            <p className="pane__notice" role="status">
              {t("palette.pickerFailed", { detail: pickerProblem })}
            </p>
          )}
        </div>
        <div className="pane__actions">
          {running ? (
            <button
              type="button"
              className="button button--secondary"
              title={t("task.cancel.title")}
              onClick={() => void props.onCancel()}
            >
              {t("task.cancel")}
            </button>
          ) : null}
        </div>
      </header>

      <WorkArea
        openRequest={openRequest}
        cwd={task.cwd}
        onNewTask={props.onNewTask}
        onReadFile={props.onReadFile}
        onReadDiff={props.onReadDiff ? (path, from) => props.onReadDiff!(task.cwd, path, from) : undefined}
        onViewingFile={setViewingFile}
      >
      <div className="transcript" data-testid="transcript" ref={transcriptRef} onScroll={onTranscriptScroll}>
        {transcript.hasGap ? (
          <p className="transcript__gap" role="status">
            {t("task.transcript.gap")}
          </p>
        ) : null}

        {transcript.entries.length === 0 ? (
          <div className="transcript__empty">
            <p className="transcript__empty-title">{t("task.transcript.empty.title")}</p>
            <p className="transcript__empty-body">
              {t("task.transcript.empty.body", { cwd: task.cwd })}
            </p>
            <ul className="suggestions">
              {SUGGESTIONS.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    className="suggestion"
                    onClick={() => {
                      setText(t(key));
                      inputRef.current?.focus();
                    }}
                  >
                    {t(key)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="transcript__list">
            {transcript.entries.map((entry, index) => {
              const streaming =
                entry.kind === "assistant" &&
                props.runLive &&
                !transcript.entries
                  .slice(index + 1)
                  .some((later) => later.kind === "assistant");
              return (
                <TranscriptRow
                  key={`${entry.kind}-${entry.id}`}
                  entry={entry}
                  streaming={streaming}
                  onAnswer={props.onAnswer}
                />
              );
            })}
          </ol>
        )}
      </div>
      </WorkArea>

      {explorer && props.onListDirectory && props.onListChanges ? (
        <ExplorerSidebar
          {...(props.onStage !== undefined ? { onStage: props.onStage } : {})}
          {...(props.onUnstage !== undefined ? { onUnstage: props.onUnstage } : {})}
          {...(props.onCommit !== undefined ? { onCommit: props.onCommit } : {})}
          cwd={task.cwd}
          onListDirectory={props.onListDirectory}
          onListChanges={props.onListChanges}
          onOpenFile={(entry) => setOpenRequest({ path: entry.path, name: entry.name, nonce: Date.now() })}
          onOpenChange={(change) =>
            setOpenRequest({
              path: change.path,
              name: change.path.split(/[/\\]/).pop() || change.path,
              nonce: Date.now(),
              view: "diff",
              from: change.from,
            })
          }
          onCreateEntry={props.onCreateEntry}
        />
      ) : null}

      {viewingFile ? null : (
      <footer className="composer">
        <div
          className={dropping ? "composer__card composer__card--drop" : "composer__card"}
          onDragOver={(event) => {
            if (approvalOpen || !event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropping(false);
            addFiles([...event.dataTransfer.files]);
          }}
        >
          {commandMatches.length > 0 ? (
            <SlashCommandList
              commands={commandMatches}
              active={commandActive}
              label={t("task.composer.commands")}
              onPick={(command) => pickCommand(command.name)}
            />
          ) : null}
          <AttachmentTray
            attachments={attachments}
            onRemove={(id) => {
              setAttachments((current) => current.filter((attachment) => attachment.id !== id));
              setAttachNotice(undefined);
            }}
          />
          <textarea
            ref={inputRef}
            className="composer__input"
            rows={2}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setCommandIndex(0);
            }}
            onPaste={(event) => {
              const images = pastedImages(event.clipboardData);
              if (images.length === 0) return;
              event.preventDefault();
              addFiles(images);
            }}
            onKeyDown={(event) => {
              if (commandMatches.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCommandIndex((index) => index + 1);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCommandIndex((index) => index - 1);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setText("");
                  return;
                }
                if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                  event.preventDefault();
                  const chosen = commandMatches[commandActive];
                  if (chosen) pickCommand(chosen.name);
                  return;
                }
              }
              // Enter sends, Shift+Enter is a newline. Not Cmd+Enter: a prompt is one thought, and a
              // modifier for "send" is what makes people paste half a message.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              approvalOpen
                ? t("task.composer.placeholder.approval")
                : running
                  ? t("task.composer.placeholder.running")
                  : t("task.composer.placeholder.idle")
            }
            aria-label={t("task.composer.aria")}
            // The keyboard contract, where a user looks for it: on the field they are typing into.
            title={t("task.composer.hint")}
          />
          {attachNotice ? <p className="composer__notice">{attachNotice}</p> : null}
          {props.notice ? <p className="composer__notice">{props.notice}</p> : null}
          {/* **The row under the field: agent settings on the left, the action on the right.**
              Paseo's composer is a field with one button row beneath it — the attach button and the agent's
              controls at the left, send at the right (`composer/input/input.tsx`, the `buttonRow`) — and this is
              that shape now. It used to draw a second row *above* the field holding three labelled form controls,
              which is what the owner read as *"too ugly and nosing"*. */}
          <div className="composer__toolbar">
            <AttachButton
              disabled={approvalOpen}
              onAdd={addFiles}
              onPasteFailed={() => setAttachNotice(t("task.composer.attach.pasteFailed"))}
            />
            {/* **The agent's settings, as a toolbar.** Each applies to the *next run* — the agent is
                launched with `task.cwd` and put into its mode right after `session/new` — so none of them
                pretends to move or re-mode a run that is already going. */}
            <ComposerControls
              modes={controls.mode.options}
              selectedModeId={selectedModeId}
              modeOff={modeOff}
              onChooseMode={(chosen) => {
                setPickedMode(chosen);
                void props.onChangeMode?.(chosen);
              }}
              modelKind={controls.model.kind}
              models={controls.model.options}
              selectedModelId={selectedModelId}
              modelOff={modelOff}
              modelBareId={modelAcceptsBareId(task.harness)}
              agentLabel={agent.label}
              onChooseModel={(chosen) => {
                // `""` is the agent's own default, and it is kept as the empty string here rather than
                // collapsed to `undefined`: the pane must show the click immediately, and `undefined`
                // would fall through to the task's stored model — the very value the user just cleared.
                setPickedModel(chosen);
                void props.onChangeModel?.(chosen);
              }}
              thinkingOptions={controls.thinking.options}
              selectedThinkingLevel={selectedThinkingLevel}
              thinkingOff={thinkingOff}
              modelObservedAt={controls.model.observedAt}
              thinkingObservedAt={controls.thinking.observedAt}
              onChooseThinking={(chosen) => {
                // The model's rule, for the model's reason: `""` means "the agent's own default" and has
                // to be shown at once rather than falling through to the level the user just cleared.
                setPickedThinking(chosen);
                void props.onChangeThinking?.(chosen);
              }}
              taskId={task.id}
              harness={task.harness}
              fastMode={task.fastMode}
              planMode={task.planMode === true || task.agentModeId === "plan"}
              onToggleFeature={(id, value) => {
                void props.onToggleFeature?.(id, value);
              }}
              running={running}
              probeNote={probe.note}
              // Drawn only when there is a button to draw: `probe.buttonKey` is absent for an agent the
              // daemon cannot be asked about, and an enabled-looking control that goes nowhere is the bug
              // this row keeps refusing.
              probeAction={
                probe.buttonKey === undefined
                  ? undefined
                  : { key: probe.buttonKey, enabled: probe.enabled }
              }
              onProbeAgent={
                props.onProbeAgent === undefined ? undefined : () => void askAgent(probe.force)
              }
            />
            <div className="composer__toolbar-actions">
            {/* **The Queue/Steer picker is gone.** Two words in a select, explained by a tooltip nobody opened:
                the owner asked what they meant, which is the answer. A message sent while a turn is running
                **queues** — the daemon finishes what it is doing and reads it next — and the button underneath
                says so in its tooltip. `steer` (interrupt the turn and send this instead) is still on the wire;
                a *setting* for which one is the default is where that choice belongs (§8.3).
                The keyboard contract went with it, off the row and onto the field's own tooltip. */}
            {/* **An icon, and only while there is something to send.**
                The owner: *"can we use the same send button style, no text, no send button, when inputting, the icon
                button displayed."* That is the reference product's rule exactly
                (`composer/input/input.tsx`, `resolvePrimaryActionKind`): with something in the field the send action
                is drawn — as a glyph, not as a word — and with an empty field there is no primary action at all
                (Paseo draws its cancel control there; ours is the header's Stop). A worded button at the end of
                every row is a label the user has read a thousand times, and the glyph is the one meaning every
                message box on every platform already teaches.

                The name a screen reader reads is still a sentence — `visually-hidden`, so it is announced and not
                drawn — and the tooltip stays: it is where "this queues behind the turn in flight" is said
                (§7.33). */}
            {canSend(text, attachments) ? (
              <button
                type="button"
                className="button button--primary button--icon composer__send has-hint"
                onClick={submit}
                disabled={approvalOpen}
                data-hint={
                  approvalOpen
                    ? t("task.composer.submit.blocked")
                    : running
                      ? t("task.composer.send.queued")
                      : t("task.composer.start")
                }
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 12h13" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
                <span className="visually-hidden">{running ? t("task.composer.send") : t("task.composer.start")}</span>
              </button>
            ) : null}
            </div>
          </div>
        </div>
      </footer>
      )}
    </section>
  );
}

/* ────────────────────────────── rows ────────────────────────────── */

function TranscriptRow(props: {
  entry: TranscriptEntry;
  streaming?: boolean;
  onAnswer: (requestId: string, choice: string | readonly string[] | { text: string }) => void | Promise<void>;
}): JSX.Element | null {
  const t = useT();
  const { entry } = props;

  switch (entry.kind) {
    case "user":
      return (
        <li className="row row--user">
          <p className="row__text">{entry.text}</p>
          <p className="row__meta">
            {t("task.you")} ·{" "}
            {entry.delivered === "steered" ? t("task.delivered.steered") : t("task.delivered.queued")}
          </p>
        </li>
      );

    case "assistant":
      // Markdown for the answer (GFM + fenced code + Mermaid). Streaming uses paced
      // reveal and block-split re-parse so finished paragraphs stay put.
      return (
        <li className="row row--assistant">
          <div className="row__markdown">
            <MessageMarkdown
              text={entry.text}
              phase={props.streaming ? "streaming" : "complete"}
            />
          </div>
        </li>
      );

    case "thought":
      // Collapsed by default: reasoning is usually long and often irrelevant, and hiding it behind a
      // summary is what keeps the answer readable (`docs/envoydev-ui.md` §7). Kept as plain text —
      // Paseo does the same; partial markdown in a streaming thought flickers more than it helps.
      return (
        <li className="row row--thought">
          <details>
            <summary>{t("task.thought.summary")}</summary>
            <p className="row__text">{entry.text}</p>
          </details>
        </li>
      );

    case "tool":
      return (
        <li className={`row row--tool row--tool-${entry.status}`}>
          <p className="row__tool-head">
            <span className={`dot dot--${entry.status === "running" ? "live" : entry.status === "failed" ? "danger" : "quiet"}`} aria-hidden />
            {entry.name}
          </p>
          {entry.input !== undefined ? (
            <pre className="row__code">{summarize(entry.input)}</pre>
          ) : null}
          {entry.output !== undefined ? <pre className="row__code">{summarize(entry.output)}</pre> : null}
        </li>
      );

    case "approval":
      return (
        <li className="row row--approval">
          <ApprovalCard entry={entry} onAnswer={props.onAnswer} />
        </li>
      );

    case "note":
      return (
        <li className={`row row--note row--note-${entry.tone}`}>
          <p className="row__meta">{localize(t, entry.notice)}</p>
        </li>
      );
  }
}

/**
 * An approval, inline.
 *
 * The wording rule is the family's: headline first, in the user's language; detail second; developer
 * fields last and small. The headline comes from the daemon, which is the only place that knows what
 * the agent is about to do — this component renders it and does not reword it, because two surfaces
 * describing one decision differently is how a user comes to distrust both.
 *
 * "In the user's language" is why the daemon's sentence is rendered through `localizeText`: it sends
 * a key with it (`approval.question.tool`), so the headline is German for a German user and the
 * English sentence is what an untranslated language reads. The option labels are *not* translated —
 * they are the agent's own words for its own choices, and rewording them would be putting a second
 * vocabulary on one decision.
 */
function ApprovalCard(props: {
  entry: Extract<TranscriptEntry, { kind: "approval" }>;
  onAnswer: (requestId: string, choice: string | readonly string[] | { text: string }) => void | Promise<void>;
}): JSX.Element {
  const t = useT();
  const { entry } = props;
  const answered = entry.resolvedWith !== undefined;
  const stacked = entry.selection === "many" || entry.selection === "text";

  return (
    <div
      className={`approval${answered ? " approval--answered" : ""}${stacked ? " approval--stack" : ""}`}
      role={answered ? "status" : "alertdialog"}
      aria-label={answered ? t("task.approval.answered") : t("task.approval.aria")}
    >
      <div className="approval__body">
        <p className="approval__question">{localizeText(t, entry.question)}</p>
        {entry.detail ? <p className="approval__detail">{localizeText(t, entry.detail)}</p> : null}
      </div>
      <div className="approval__actions">
        <ApprovalChoices entry={entry} onAnswer={props.onAnswer} />
      </div>
    </div>
  );
}

/* ────────────────────────────── formatting ────────────────────────────── */

/**
 * A tool's input or output, as a few readable lines.
 *
 * Bounded on purpose: an agent that cats a 4000-line file must not paste it into the transcript. The
 * full value is still in the run's transcript on disk, which is where "show me everything" belongs.
 */
function summarize(value: unknown, limit = 400): string {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}

function dotClassFor(status: Task["status"]): string {
  switch (status) {
    case "running":
      return "dot--running";
    case "needs-attention":
      return "dot--warn";
    case "failed":
      return "dot--danger";
    case "done":
      return "dot--ok";
    case "queued":
      return "dot--queued";
    case "idle":
    case "cancelled":
      return "dot--quiet";
  }
}

function basename(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? value;
}
