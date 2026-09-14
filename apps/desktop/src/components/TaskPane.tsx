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

import { useState } from "react";
import type { HarnessId, Project, RunEvent, Task } from "@envoycoder/protocol";
import { statusLabel } from "@envoycoder/task-model";

import { buildTranscript, type TranscriptEntry } from "../state/transcript.js";

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
  onStart: (prompt: string) => void | Promise<void>;
  /** Shown under the composer when a send was refused, in the daemon's words. */
  notice?: string | undefined;
}

export function TaskPane(props: TaskPaneProps): JSX.Element {
  const { task, project, events } = props;
  const running = props.runLive;
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"queue" | "steer">("queue");

  const transcript = buildTranscript(events);
  const approvalOpen = transcript.pendingApprovalId !== undefined;

  const submit = (): void => {
    const value = text.trim();
    if (value === "") return;
    if (running) void props.onSend(value, mode);
    else void props.onStart(value);
    setText("");
  };

  return (
    <section className="pane" aria-label={`Task ${task.title}`}>
      <header className="pane__header">
        <div className="pane__title-group">
          <h1 className="pane__title">{task.title}</h1>
          <div className="pane__meta">
            <span className={`chip ${chipFor(task.status)}`}>{statusLabel(task.status)}</span>
            <span className="chip chip--quiet" title="The agent running this task">
              {labelForHarness(task.harness)}
            </span>
            {task.model ? <span className="chip chip--quiet">{task.model}</span> : null}
            <span className="chip chip--quiet" title={`Working directory: ${task.cwd}`}>
              {project?.label ?? basename(task.cwd)}
            </span>
            {task.worktree ? (
              <span className="chip chip--quiet" title={task.worktree.path}>
                {task.worktree.branch}
              </span>
            ) : null}
            {/* Where it runs. "This machine" is a statement, not an omission. */}
            <span className="chip chip--quiet" title="Machine running this task">
              {task.hostId && task.hostId !== "local" ? task.hostId : "This machine"}
            </span>
          </div>
        </div>
        <div className="pane__actions">
          {running ? (
            <button
              type="button"
              className="button button--secondary"
              title="Ask the agent to stop"
              onClick={() => void props.onCancel()}
            >
              Stop
            </button>
          ) : null}
        </div>
      </header>

      <div className="transcript" data-testid="transcript">
        {transcript.hasGap ? (
          <p className="transcript__gap" role="status">
            Some of this task&rsquo;s history did not arrive. What is here is in order; reload to ask
            again.
          </p>
        ) : null}

        {transcript.entries.length === 0 ? (
          <div className="transcript__empty">
            <p className="transcript__empty-title">Nothing yet</p>
            <p className="transcript__empty-body">
              Ask for something and the agent works in <code>{task.cwd}</code>. Tool calls,
              approvals and diffs appear here as they happen.
            </p>
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
        <textarea
          className="composer__input"
          rows={3}
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
              ? "Answer the request above before sending anything"
              : running
                ? "Add a follow-up — Queue waits for this turn, Steer joins it"
                : "Describe the task"
          }
          aria-label="Message the agent"
        />
        {props.notice ? <p className="composer__notice">{props.notice}</p> : null}
        <div className="composer__toolbar">
          <span className="composer__spacer" />
          {/* The mode only exists while there is a turn to join: showing it on a finished task would
              offer a choice that does nothing. */}
          {running ? (
            <label className="composer__mode" title="Queue waits for the current turn; Steer joins it">
              <select
                className="select"
                value={mode}
                onChange={(event) => setMode(event.target.value as "queue" | "steer")}
                aria-label="How to deliver the message"
              >
                <option value="queue">Queue</option>
                <option value="steer">Steer</option>
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="button button--primary"
            onClick={submit}
            disabled={text.trim() === "" || approvalOpen}
            title={approvalOpen ? "Answer the request above first" : running ? "Send" : "Start"}
          >
            {running ? "Send" : "Start"}
          </button>
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
  const { entry } = props;

  switch (entry.kind) {
    case "user":
      return (
        <li className="row row--user">
          <p className="row__text">{entry.text}</p>
          <p className="row__meta">
            You · {entry.delivered === "steered" ? "joined the turn" : "waited for the turn"}
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
            <summary>How it thought about this</summary>
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
          <p className="row__meta">{entry.text}</p>
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
 */
function ApprovalCard(props: {
  entry: Extract<TranscriptEntry, { kind: "approval" }>;
  onAnswer: (requestId: string, optionId: string) => void | Promise<void>;
}): JSX.Element {
  const { entry } = props;
  const answered = entry.resolvedWith !== undefined;

  return (
    <div
      className={`approval${answered ? " approval--answered" : ""}`}
      role={answered ? "status" : "alertdialog"}
      aria-label={answered ? "Answered" : "The agent needs your answer"}
    >
      <div className="approval__body">
        <p className="approval__question">{entry.question}</p>
        {entry.detail ? <p className="approval__detail">{entry.detail}</p> : null}
      </div>
      <div className="approval__actions">
        {answered ? (
          <span className="approval__resolved">
            Answered: {entry.options.find((option) => option.id === entry.resolvedWith)?.label ?? entry.resolvedWith}
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
