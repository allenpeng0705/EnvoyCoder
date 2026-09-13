/**
 * The work area for one workspace: header, transcript, composer.
 *
 * Three deliberate choices, each inherited from something that works rather than invented here:
 *
 *   1. **The header states the machine.** A distributed control plane that does not say *where*
 *      the agent is running invites the user to assume "here" — and then to wonder why a test
 *      that passes on their laptop fails in the transcript. Host, cwd and branch are always
 *      visible, never truncated without a tooltip.
 *   2. **The composer distinguishes Queue from Steer.** Sending while an agent is working either
 *      waits for the turn (queue) or joins it (steer); one control that silently picks for the
 *      user is how people conclude the agent "ignored" their message.
 *   3. **Approvals are a first-class block in the transcript, not a modal.** A modal blocks the
 *      window and hides the context the user needs to decide; the request belongs inline, next to
 *      the tool call that raised it.
 */

import type { JSX } from "react";

import type { HarnessId, Project, Workspace } from "@envoycoder/protocol";
import { statusLabel } from "@envoycoder/workspace-model";

export interface WorkspacePaneProps {
  workspace: Workspace;
  project: Project | undefined;
}

export function WorkspacePane(props: WorkspacePaneProps): JSX.Element {
  const { workspace, project } = props;
  const running = workspace.status === "running" || workspace.status === "queued";

  return (
    <section className="pane" aria-label={`Task ${workspace.title}`}>
      <header className="pane__header">
        <div className="pane__title-group">
          <h1 className="pane__title">{workspace.title}</h1>
          <div className="pane__meta">
            <span className={`chip ${chipFor(workspace.status)}`}>{statusLabel(workspace.status)}</span>
            <span className="chip chip--quiet" title="The agent running this task">
              {labelForHarness(workspace.harness)}
            </span>
            {workspace.model ? <span className="chip chip--quiet">{workspace.model}</span> : null}
            <span
              className="chip chip--quiet"
              title={`Working directory: ${workspace.cwd}`}
            >
              {project?.label ?? basename(workspace.cwd)}
            </span>
            {workspace.worktree ? (
              <span className="chip chip--quiet" title={workspace.worktree.path}>
                {workspace.worktree.branch}
              </span>
            ) : null}
            {/* Where it runs. "Local" is a statement, not an omission. */}
            <span className="chip chip--quiet" title="Machine running this task">
              {workspace.hostId && workspace.hostId !== "local" ? workspace.hostId : "This machine"}
            </span>
          </div>
        </div>
        <div className="pane__actions">
          {running ? (
            <button type="button" className="button button--secondary" title="Ask it to stop">
              Stop
            </button>
          ) : (
            <button type="button" className="button button--primary" title="Run the next turn">
              Continue
            </button>
          )}
        </div>
      </header>

      <div className="transcript" data-testid="transcript">
        <div className="transcript__empty">
          <p className="transcript__empty-title">Nothing yet</p>
          <p className="transcript__empty-body">
            Ask for something and the agent works in <code>{workspace.cwd}</code>. Tool calls,
            approvals and diffs will appear here as they happen.
          </p>
        </div>
      </div>

      <ApprovalCard
        visible={workspace.status === "needs-attention"}
        question="Run the test suite and update the snapshot files it writes?"
        detail="The agent wants to modify 3 files under __snapshots__. This cannot be undone by the agent."
      />

      <footer className="composer">
        <textarea
          className="composer__input"
          rows={3}
          placeholder={
            running
              ? "Add a follow-up — Queue waits for this turn, Steer joins it"
              : "Describe the task"
          }
          aria-label="Message the agent"
        />
        <div className="composer__toolbar">
          <button type="button" className="button button--ghost button--small" title="Attach files">
            Attach
          </button>
          <button type="button" className="button button--ghost button--small" title="Choose the agent">
            {labelForHarness(workspace.harness)}
          </button>
          <span className="composer__spacer" />
          <label className="composer__mode" title="Queue waits for the current turn; Steer joins it">
            <select className="select" defaultValue="queue" aria-label="How to deliver the message">
              <option value="queue">Queue</option>
              <option value="steer">Steer</option>
            </select>
          </label>
          <button type="button" className="button button--primary" disabled={!running}>
            {running ? "Send" : "Start"}
          </button>
        </div>
      </footer>
    </section>
  );
}

/**
 * An approval, inline.
 *
 * The wording rule is the family's: headline first, in the user's language; the detail second;
 * developer fields last and small. "3 files will change" is a headline; a tool name is not.
 */
function ApprovalCard(input: {
  visible: boolean;
  question: string;
  detail: string;
}): JSX.Element | null {
  if (!input.visible) return null;
  return (
    <div className="approval" role="alertdialog" aria-label="The agent needs your answer">
      <div className="approval__body">
        <p className="approval__question">{input.question}</p>
        <p className="approval__detail">{input.detail}</p>
      </div>
      <div className="approval__actions">
        <button type="button" className="button button--danger" title="Deny and stop">
          Deny
        </button>
        <button type="button" className="button button--primary" title="Allow this once">
          Allow once
        </button>
      </div>
    </div>
  );
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
  }
}

function chipFor(status: Workspace["status"]): string {
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
