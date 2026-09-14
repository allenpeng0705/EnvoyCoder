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
 */

import type { JSX } from "react";

import { useEffect, useRef, useState } from "react";
import type { HarnessId, HarnessSummary, Project, RunEvent, Task } from "@envoycoder/protocol";

import { hasShellPicker, pickFolder } from "../client/folder-picker.js";
import { composerControls, modeOffReason } from "../composer/controls.js";
import { useT } from "../i18n/context.js";
import { localize, localizeText, statusKey } from "../i18n/notice.js";
import { buildTranscript, type TranscriptEntry } from "../state/transcript.js";
import { ComposerControls } from "./ComposerControls.js";

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
   * `agentModeId` arrives **only when there is one to send** — when the agent can be put into a mode
   * and one is chosen. The daemon reads the task's stored mode when this is absent, so the two say the
   * same thing; carrying it here as well is what keeps the picker's *displayed* value and the value the
   * run is started with identical even if the `updateTask` that saved the choice is still in flight.
   */
  onStart: (prompt: string, agentModeId?: string) => void | Promise<void>;
  /** Remember the agent's mode for this task, so the next run starts the way the user left it. */
  onChangeMode?: (agentModeId: string) => void | Promise<void>;
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
  const [mode, setMode] = useState<"queue" | "steer">("queue");
  /** A mode the user has just chosen, before the task's saved copy comes back. */
  const [pickedMode, setPickedMode] = useState<string | undefined>(undefined);
  /** Why the folder chooser would not open, after a click that tried. */
  const [pickerProblem, setPickerProblem] = useState<string | undefined>(undefined);
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
    setPickerProblem(undefined);
  }, [task.id]);

  /* ── the two controls above the field: what they offer is decided in `composer/controls.ts` ── */
  const summary = props.harnesses?.find((harness) => harness.id === task.harness);
  const agent = agentFor(task.harness, summary);
  const controls = composerControls(agent, { running, approvalPending: approvalOpen });
  // What the picker shows: the user's just-made choice, else what the task remembers, else the agent's
  // own default. In that order, so a click is never overwritten by a request still in flight.
  const selectedModeId = pickedMode ?? task.agentModeId ?? controls.mode.selected ?? undefined;
  const modeEnabled = controls.mode.enabled;
  const modeOff = modeOffReason(controls.mode, { known: summary !== undefined, agent: agent.label });

  // `hasShellPicker()` is synchronous on purpose (see `folder-picker.ts`): a control that decides after
  // an `await` looks like a dead click, and a disabled one can say why in the same tick as the render.
  const canChooseFolder = props.onChangeFolder !== undefined && hasShellPicker();

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
    if (running) void props.onSend(value, mode);
    // The mode travels only when the picker is on and something is chosen. Passing it always would
    // mean inventing an "undefined mode" for the agents that have none, and the daemon already reads
    // the task's stored mode when the argument is absent.
    else if (modeEnabled && selectedModeId !== undefined) void props.onStart(value, selectedModeId);
    else void props.onStart(value);
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
              {labelForHarness(task.harness)}
            </span>
            {task.model ? <span className="chip chip--quiet">{task.model}</span> : null}
            <span className="chip chip--quiet" title={t("task.meta.cwd", { path: task.cwd })}>
              {project?.label ?? basename(task.cwd)}
            </span>
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
          {/* **Two controls above the field, and both say what they will do.** Each applies to the
              *next run* — the agent is launched with `task.cwd` and put into its mode right after
              `session/new` — so neither pretends to move or re-mode a run that is already going. */}
          <ComposerControls
            cwd={task.cwd}
            projectPath={project?.path}
            canChooseFolder={canChooseFolder}
            folderProblem={pickerProblem}
            onChooseFolder={() => void chooseFolder()}
            modes={controls.mode.options}
            selectedModeId={selectedModeId}
            modeOff={modeOff}
            onChooseMode={(chosen) => {
              setPickedMode(chosen);
              void props.onChangeMode?.(chosen);
            }}
            running={running}
          />

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
          />
          {props.notice ? <p className="composer__notice">{props.notice}</p> : null}
          <div className="composer__toolbar">
            {/* The mode only exists while there is a turn to join: showing it on a finished task would
                offer a choice that does nothing. */}
            {running ? (
              <label className="composer__mode" title={t("task.composer.mode.title")}>
                <select
                  className="select"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as "queue" | "steer")}
                  aria-label={t("task.composer.mode.aria")}
                >
                  <option value="queue">{t("task.composer.queue")}</option>
                  <option value="steer">{t("task.composer.steer")}</option>
                </select>
              </label>
            ) : null}
            {/* The keyboard contract, on screen. It was only in a comment. */}
            <span className="composer__hint">{t("task.composer.hint")}</span>
            <button
              type="button"
              className="button button--primary"
              onClick={submit}
              disabled={text.trim() === "" || approvalOpen}
              title={
                approvalOpen
                  ? t("task.composer.submit.blocked")
                  : running
                    ? t("task.composer.send")
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

/**
 * The facts about the agent this task runs on, straight from the wire.
 *
 * `modes` and `available` default to "we were not told", which the control treats as *unknown* rather
 * than as "none" — the distinction `composer/controls.ts` exists to preserve.
 */
function agentFor(
  harness: HarnessId,
  summary: HarnessSummary | undefined,
): Parameters<typeof composerControls>[0] {
  return {
    id: harness,
    label: summary?.label ?? labelForHarness(harness),
    modes: summary?.modes ?? [],
    capabilities: {
      resume: summary?.capabilities.resume ?? false,
      cancel: summary?.capabilities.cancel ?? false,
      approvals: summary?.capabilities.approvals ?? false,
      structuredTools: summary?.capabilities.structuredTools ?? false,
      streaming: summary?.capabilities.streaming ?? false,
      images: summary?.capabilities.images ?? false,
    },
    available: summary?.available ?? "unknown",
    // **The wire is the only thing that may turn the picker on.** No summary, or a summary that says the
    // daemon cannot set this agent's mode, both leave it off with the reason shown.
    modesApplicable: summary?.capabilities.agentMode === true,
  };
}

function labelForHarness(harness: HarnessId): string {
  switch (harness) {
    case "envoy-harness":
      return "Envoy Harness";
    case "deepseek-harness":
      return "DeepSeek Harness";
    case "claudecode":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "copilot":
      return "Copilot";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor";
    case "pi":
      return "Pi";
    case "omp":
      return "OMP (Oh My Pi)";
  }
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
