/**
 * Turning a stream of run events into a transcript.
 *
 * ## Why this is a pure function in its own file
 *
 * A transcript is a *projection*, and the folding rules are where the bugs live: chunks that must
 * join into one message, a tool call whose start and finish arrive as two events, an approval that
 * is only resolved if the resolution arrived. Put those rules in a component and they become
 * untestable and unreviewable at the same time. Here they are a function from events to rows, so
 * "why does this bubble say that?" has one answer, in one place, with tests.
 *
 * Same principle as the rail: `@envoycoder/task-model` owns "which row, in what order"; this
 * owns "which line, joined how". Components render.
 *
 * ## The four folding rules, each of which is a visible bug when it is wrong
 *
 *   1. **Chunks join by `messageId`.** Streaming arrives as fragments; a client that renders each
 *      fragment as its own bubble posts a wall of one-word rows. Events without a `messageId` are
 *      joined into the *previous* bubble of the same kind, which is what an agent that does not
 *      send the field needs.
 *   2. **A tool call is one row with two events.** `run.tool` arrives as `running` and later as
 *      `completed`/`failed` with the same `callId`; the row is updated in place, and a call that
 *      never completes stays visible as `running` rather than disappearing.
 *   3. **An approval belongs to the call that raised it.** It is rendered *in place*, at the point
 *      in the transcript where the agent paused — never as a modal, which would hide the context a
 *      user needs to decide (`docs/envoycoder-ui.md` §6).
 *   4. **Gaps are reported, not hidden.** `seq` is monotonic per run, so a missing sequence number
 *      means this client dropped a frame. Saying so is the honest alternative to rendering a
 *      transcript that silently skips the sentence explaining the change.
 */

import type { RunEvent, TaskStatus } from "@envoycoder/protocol";

import { localNotice, type Notice } from "../i18n/notice.js";

export type TranscriptEntry =
  | { kind: "user"; id: string; text: string; mode: "queue" | "steer"; delivered: "queued" | "steered" }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "thought"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      callId: string;
      name: string;
      status: "running" | "completed" | "failed";
      input?: unknown;
      output?: unknown;
    }
  | {
      kind: "approval";
      id: string;
      requestId: string;
      question: string;
      detail?: string;
      options: readonly { id: string; label: string; destructive?: boolean }[];
      /** Set once somebody answered it, so an answered card stops looking like a question. */
      resolvedWith?: string;
    }
  /**
   * A line this module folds out of an event — "3 files changed.", "Context 45% full.".
   *
   * A **notice**, not a string: the sentence and the catalogue key that re-renders it. This module
   * stays pure (it never sees a translator, and its tests assert structure rather than prose), while
   * the pane renders the key in whatever language the *user* chose — including when that choice
   * changes while the transcript is on screen.
   */
  | { kind: "note"; id: string; notice: Notice; tone: "quiet" | "warn" | "error" };

export interface Transcript {
  entries: TranscriptEntry[];
  /** True when a sequence number is missing, so the transcript is known to be incomplete. */
  hasGap: boolean;
  /** The highest `seq` seen — what a client asks from when it reconnects. */
  lastSeq: number;
  /** Set while the run is waiting on a human, and cleared once it is answered. */
  pendingApprovalId: string | undefined;
}

/**
 * Build the transcript.
 *
 * Events are expected in `seq` order, which is how the daemon emits them; a client that applies them
 * out of order gets a transcript in the order it applied them, and the gap flag tells it that
 * something is wrong rather than quietly rendering a plausible-looking lie.
 */
export function buildTranscript(events: readonly RunEvent[]): Transcript {
  const entries: TranscriptEntry[] = [];
  /** Index by identity, so a later event can update a row it already created. */
  const indexByMessage = new Map<string, number>();
  const indexByCall = new Map<string, number>();
  const indexByRequest = new Map<string, number>();

  let lastSeq = 0;
  let hasGap = false;
  let pendingApprovalId: string | undefined;
  /**
   * The fallback bucket for chunks that carry no `messageId`.
   *
   * Cleared whenever a row of *another* kind is pushed, so consecutive fragments still join into one
   * bubble while a turn boundary — a tool call, another user message — starts a new one. A single
   * bucket for the whole run would merge two sequential replies into one; a fresh bucket per chunk
   * would render a wall of one-word rows. This is the middle, and it is only ever reached by an agent
   * that omits the field.
   */
  let anonymousKey = "";
  let anonymousCount = 0;
  const breakAnonymousRun = (): void => {
    anonymousKey = "";
  };
  const nextAnonymousKey = (prefix: string): string => {
    if (anonymousKey === "") {
      anonymousCount += 1;
      anonymousKey = `${prefix}anon-${anonymousCount}`;
    }
    return anonymousKey;
  };

  for (const event of events) {
    if (event.seq > lastSeq + 1 && lastSeq !== 0) hasGap = true;
    lastSeq = Math.max(lastSeq, event.seq);

    switch (event.kind) {
      case "run.message": {
        breakAnonymousRun();
        entries.push({
          kind: "user",
          id: `u${event.seq}`,
          text: event.text,
          mode: event.mode,
          delivered: event.delivered,
        });
        break;
      }

      case "run.output": {
        const key = event.messageId ?? nextAnonymousKey("");
        const at = indexByMessage.get(key);
        const current = at !== undefined ? entries[at] : undefined;
        if (at !== undefined && current?.kind === "assistant") {
          // Rule 1: the same message, continued. Replacing the entry rather than mutating it keeps
          // the array a value, which is what makes React re-render it.
          entries[at] = { ...current, text: current.text + event.text };
        } else {
          indexByMessage.set(key, entries.length);
          entries.push({ kind: "assistant", id: key, text: event.text });
        }
        break;
      }

      case "run.thought": {
        const key = event.messageId ? `thought-${event.messageId}` : nextAnonymousKey("thought-");
        const at = indexByMessage.get(key);
        const current = at !== undefined ? entries[at] : undefined;
        if (at !== undefined && current?.kind === "thought") {
          entries[at] = { ...current, text: current.text + event.text };
        } else {
          indexByMessage.set(key, entries.length);
          entries.push({ kind: "thought", id: key, text: event.text });
        }
        break;
      }

      case "run.tool": {
        breakAnonymousRun();
        const at = indexByCall.get(event.callId);
        const current = at !== undefined ? entries[at] : undefined;
        if (at !== undefined && current?.kind === "tool") {
          // Rule 2: the start and the finish are two events and one row. A terminal status never
          // arrives without a start in practice, but if it did, adding a row is better than
          // dropping the result on the floor.
          entries[at] = {
            ...current,
            status: event.status,
            // A `tool_call_update` carries no title, so an empty name must not erase the one the
            // start already gave us.
            name: event.name !== "" ? event.name : current.name,
            ...(event.input !== undefined ? { input: event.input } : {}),
            ...(event.output !== undefined ? { output: event.output } : {}),
          };
        } else {
          indexByCall.set(event.callId, entries.length);
          entries.push({
            kind: "tool",
            id: event.callId,
            callId: event.callId,
            name: event.name !== "" ? event.name : "tool",
            status: event.status,
            ...(event.input !== undefined ? { input: event.input } : {}),
            ...(event.output !== undefined ? { output: event.output } : {}),
          });
        }
        break;
      }

      case "run.approval-requested": {
        breakAnonymousRun();
        indexByRequest.set(event.requestId, entries.length);
        pendingApprovalId = event.requestId;
        entries.push({
          kind: "approval",
          id: event.requestId,
          requestId: event.requestId,
          question: event.question,
          ...(event.detail !== undefined ? { detail: event.detail } : {}),
          options: event.options,
        });
        break;
      }

      case "run.approval-resolved": {
        const at = indexByRequest.get(event.requestId);
        const current = at !== undefined ? entries[at] : undefined;
        if (at !== undefined && current?.kind === "approval") {
          entries[at] = { ...current, resolvedWith: event.optionId };
        }
        if (pendingApprovalId === event.requestId) pendingApprovalId = undefined;
        break;
      }

      case "run.status": {
        breakAnonymousRun();
        if (event.note) {
          // The agent's own words (or the daemon's failure summary), carried as-is: nothing here can
          // translate a sentence an agent wrote, and inventing one would be worse than showing it.
          entries.push({
            kind: "note",
            id: `s${event.seq}`,
            notice: { message: event.note },
            tone: "quiet",
          });
        }
        if (event.status !== "needs-attention" && pendingApprovalId !== undefined) {
          // A status that is no longer "waiting on a human" means whatever was open is closed —
          // including the case where the run was cancelled while the card was on screen.
          pendingApprovalId = undefined;
        }
        break;
      }

      case "run.ended": {
        breakAnonymousRun();
        entries.push({
          kind: "note",
          id: `e${event.seq}`,
          notice: endNote(event.status),
          tone: event.status === "failed" ? "error" : event.status === "cancelled" ? "warn" : "quiet",
        });
        pendingApprovalId = undefined;
        break;
      }

      case "run.diff": {
        breakAnonymousRun();
        const files = event.files.length;
        entries.push({
          kind: "note",
          id: `d${event.seq}`,
          // A diff is a headline about files, not a list of paths: "3 files changed" is what a user
          // reads; the paths belong in the expanded view.
          notice:
            files === 1
              ? localNotice("run.diff.one")
              : localNotice("run.diff.many", { count: files }),
          tone: "quiet",
        });
        break;
      }

      case "run.usage": {
        breakAnonymousRun();
        if (event.contextUsed !== undefined && event.contextSize) {
          const percent = Math.round((event.contextUsed / event.contextSize) * 100);
          entries.push({
            kind: "note",
            id: `h${event.seq}`,
            notice: localNotice("run.context", { percent }),
            tone: percent >= 90 ? "warn" : "quiet",
          });
        }
        break;
      }

      // `run.started` and `run.session` are facts about the run, not lines in it: the header shows
      // them, and a transcript that opened with "the run started" would be narrating the furniture.
      case "run.started":
      case "run.session":
        break;
    }
  }

  return { entries, hasGap, lastSeq, pendingApprovalId };
}

/**
 * The last line of a transcript, in the user's words rather than the status bucket's.
 *
 * Note what is *not* here: a count of how many rows need the user. The rail already computes that
 * from task statuses (`attentionSummary` in `@envoycoder/task-model`), and a second
 * computation over run events would be a second number — the specific way a control plane teaches
 * users to trust neither (`docs/envoycoder-ui.md` §4). What the transcript owns is the *card*, and
 * `pendingApprovalId` is what tells the pane to keep it on screen.
 */
function endNote(status: TaskStatus): Notice {
  switch (status) {
    case "done":
      return localNotice("run.end.done");
    case "cancelled":
      return localNotice("run.end.cancelled");
    case "failed":
      return localNotice("run.end.failed");
    default:
      return localNotice("run.end.other");
  }
}
