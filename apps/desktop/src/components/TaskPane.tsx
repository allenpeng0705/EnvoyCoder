/**
 * The pane: header, transcript, composer.
 *
 * Four deliberate choices, each inherited from something that works rather than invented here:
 *
 *   1. **The header states the machine.** A distributed control plane that does not say *where* the
 *      agent runs invites the user to assume "here", and then to wonder why a test that passes on
 *      their laptop fails in the transcript. Host, cwd and branch are always visible.
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
 *
 * The trade-off, stated rather than hidden: with the rail hidden (the titlebar's toggle, `⌘B`) there is
 * no removal control on screen, because the rail *is* the task list. Unhiding it is one keystroke, and
 * the alternative — a second removal control in the pane — is the thing this comment argues against.
 */

import type { JSX } from "react";

import { useEffect, useRef, useState } from "react";
import type { HarnessId, HarnessSummary, ProbeOutcome, Project, RunEvent, Task } from "@envoycoder/protocol";

import { hasShellPicker, pickFolder } from "../client/folder-picker.js";
import { agentFor } from "../composer/agent-for.js";
import {
  composerControls,
  modeOffReason,
  modelOffReason,
  taskLocationLabel,
  thinkingOffReason,
} from "../composer/controls.js";
import { harnessLabel } from "../composer/harness-label.js";
import { probeAsk, publishesOnlyInSession, type ProbeState } from "../composer/probe.js";
import { useT } from "../i18n/context.js";
import { localize, localizeText, noticeOf, type Refusal, statusKey } from "../i18n/notice.js";
import { buildTranscript, type TranscriptEntry } from "../state/transcript.js";
import { ComposerControls } from "./ComposerControls.js";
import { FolderIcon } from "./icons.js";

export interface TaskPaneProps {
  task: Task;
  project: Project | undefined;
  /** The events of the run this pane is showing, oldest first. */
  events: readonly RunEvent[];
  /** The run's own status, which the header shows and the composer branches on. */
  runLive: boolean;
  onSend: (text: string, mode: "queue" | "steer") => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onAnswer: (requestId: string, optionId: string) => void | Promise<void>;
  /**
   * Start this task's run with the first message.
   *
   * `agentModeId` and `model` arrive **only when there is one to send** — when the agent can be put
   * into a mode or onto a model and one is chosen. The daemon reads the task's stored values when an
   * argument is absent, so the two say the same thing; carrying them here as well is what keeps the
   * control's *displayed* value and the value the run is started with identical even if the
   * `updateTask` that saved the choice is still in flight.
   */
  onStart: (prompt: string, agentModeId?: string, model?: string, thinkingLevel?: string) => void | Promise<void>;
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
  /** Shown under the composer when a send was refused, in the daemon's words. */
  notice?: string | undefined;
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
  const [text, setText] = useState("");
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
  /** The task the transcript was last scrolled for — a new task always starts at its end. */
  const scrolledFor = useRef<string | undefined>(undefined);

  const transcript = buildTranscript(events);
  const approvalOpen = transcript.pendingApprovalId !== undefined;

  // A different task in the same pane is a different agent with different modes, so a choice made for
  // the previous one must not appear to be in force here.
  useEffect(() => {
    setPickedMode(undefined);
    setPickedModel(undefined);
    setPickedThinking(undefined);
    setPickerProblem(undefined);
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
  const selectedModeId = pickedMode ?? task.agentModeId ?? controls.mode.selected ?? undefined;
  const modeEnabled = controls.mode.enabled;
  const modeOff = modeOffReason(controls.mode, { known: summary !== undefined, agent: agent.label });
  // The model's half of the same rule, and it reads the *logic's* answer rather than the task again:
  // `task.model` is handed to `composerControls` above, so "what the control shows" is decided in one
  // place instead of being recomputed here where the two could drift. `undefined` — nothing stored and
  // nothing picked — is the agent's own default, which is a state rather than a missing value.
  const selectedModelId = pickedModel ?? controls.model.selected ?? undefined;
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

  // **Follow the newest row, but do not steal the scrollbar.** An agent writes while the user reads:
  // jumping to the bottom on every event makes the history unreachable, and never moving means the
  // answer to what you just sent arrives off screen. So it follows only when the reader is already at
  // the end — and a task opened for the first time jumps there once, because that is where the
  // conversation is.
  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    const first = scrolledFor.current !== task.id;
    scrolledFor.current = task.id;
    const atEnd = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
    if (first || atEnd) node.scrollTop = node.scrollHeight;
  }, [task.id, transcript.entries.length]);

  const submit = (): void => {
    const value = text.trim();
    if (value === "") return;
    // **`queue`, always.** A message sent while the agent is working waits for the turn in flight and is
    // delivered as the next prompt — the daemon's own default, and the one behaviour the window has a control
    // for no longer. `steer` remains on the wire (`coder.sendToRun {mode}`) for a client that offers it.
    if (running) void props.onSend(value, "queue");
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
      void props.onStart(value, modeEnabled ? selectedModeId : undefined, chosenModel, chosenThinking);
    }
    setText("");
  };

  return (
    <section className="pane" aria-label={t("task.aria", { title: task.title || t("task.untitled") })}>
      <header className="pane__header">
        <div className="pane__title-group">
          <h1 className="pane__title">{task.title || t("task.untitled")}</h1>
          <div className="pane__meta">
            <span className={`chip ${chipFor(task.status)}`}>{t(statusKey(task.status))}</span>
            <span className="chip chip--quiet" title={t("task.meta.agent")}>
              {harnessLabel(task.harness)}
            </span>
            {task.model ? <span className="chip chip--quiet">{task.model}</span> : null}
            {/* **Where the task runs, and the control that moves it.**
                It used to be a passive chip here *and* a pill with the path in it in the composer — the one
                place a path is least worth reading, since it is long, truncated, and competing with the
                message being typed (the owner: *"we needn't to show the folder path on the inputting field"*).
                The composer row is a toolbar of agent settings now, and the location lives here: a glyph and
                the project's name, the whole path in the title, and a press opens the folder chooser.

                A window with no chooser keeps the chip and takes the reason — attached, as §7.30's rule has
                it — and a chooser that *fails* says so on the line below, because §7.27's rule is that a
                refusal is read where the press was. */}
            <button
              type="button"
              className="chip chip--quiet pane__cwd"
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
              <span className="chip chip--quiet" title={task.worktree.path}>
                {task.worktree.branch}
              </span>
            ) : null}
            {/* Where it runs. "This machine" is a statement, not an omission. */}
            <span className="chip chip--quiet" title={t("task.meta.host")}>
              {task.hostId && task.hostId !== "local" ? task.hostId : t("app.thisMachine")}
            </span>
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

      <div className="transcript" data-testid="transcript" ref={transcriptRef}>
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
            {transcript.entries.map((entry) => (
              <TranscriptRow
                key={`${entry.kind}-${entry.id}`}
                entry={entry}
                onAnswer={props.onAnswer}
              />
            ))}
          </ol>
        )}
      </div>

      <footer className="composer">
        <div className="composer__card">
          <textarea
            ref={inputRef}
            className="composer__input"
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
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
          {props.notice ? <p className="composer__notice">{props.notice}</p> : null}
          {/* **The row under the field: agent settings on the left, the action on the right.**
              Paseo's composer is a field with one button row beneath it — the attach button and the agent's
              controls at the left, send at the right (`composer/input/input.tsx`, the `buttonRow`) — and this is
              that shape now. It used to draw a second row *above* the field holding three labelled form controls,
              which is what the owner read as *"too ugly and nosing"*. */}
          <div className="composer__toolbar">
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
            <button
              type="button"
              className="button button--primary"
              onClick={submit}
              disabled={text.trim() === "" || approvalOpen}
              title={
                approvalOpen
                  ? t("task.composer.submit.blocked")
                  : running
                    ? // **What pressing it will do**, since the picker that used to say it is gone: the message
                      // waits for the turn in flight and is read next.
                      t("task.composer.send.queued")
                    : t("task.composer.start")
              }
            >
              <svg
                width="14"
                height="14"
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
              {running ? t("task.composer.send") : t("task.composer.start")}
            </button>
            </div>
          </div>
        </div>
      </footer>
    </section>
  );
}

/* ────────────────────────────── rows ────────────────────────────── */

function TranscriptRow(props: {
  entry: TranscriptEntry;
  onAnswer: (requestId: string, optionId: string) => void | Promise<void>;
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
      return (
        <li className="row row--assistant">
          <p className="row__text">{entry.text}</p>
        </li>
      );

    case "thought":
      // Collapsed by default: reasoning is usually long and often irrelevant, and hiding it behind a
      // summary is what keeps the answer readable (`docs/envoycoder-ui.md` §7).
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
  onAnswer: (requestId: string, optionId: string) => void | Promise<void>;
}): JSX.Element {
  const t = useT();
  const { entry } = props;
  const answered = entry.resolvedWith !== undefined;

  return (
    <div
      className={`approval${answered ? " approval--answered" : ""}`}
      role={answered ? "status" : "alertdialog"}
      aria-label={answered ? t("task.approval.answered") : t("task.approval.aria")}
    >
      <div className="approval__body">
        <p className="approval__question">{localizeText(t, entry.question)}</p>
        {entry.detail ? <p className="approval__detail">{localizeText(t, entry.detail)}</p> : null}
      </div>
      <div className="approval__actions">
        {answered ? (
          <span className="approval__resolved">
            {t("task.approval.answeredWith", {
              option:
                entry.options.find((option) => option.id === entry.resolvedWith)?.label ??
                entry.resolvedWith ??
                "",
            })}
          </span>
        ) : (
          entry.options.map((option) => (
            <button
              key={option.id}
              type="button"
              // The one primary action per view is the *permissive* one; a destructive colour appears
              // only here, inside a decision, never on a row (`docs/envoycoder-ui.md` §7).
              className={`button ${option.destructive ? "button--danger" : "button--primary"}`}
              onClick={() => void props.onAnswer(entry.requestId, option.id)}
            >
              {option.label}
            </button>
          ))
        )}
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

function chipFor(status: Task["status"]): string {
  switch (status) {
    case "needs-attention":
      return "chip--warn";
    case "failed":
      return "chip--danger";
    case "running":
    case "queued":
      return "chip--live";
    default:
      return "chip--quiet";
  }
}

function basename(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? value;
}
