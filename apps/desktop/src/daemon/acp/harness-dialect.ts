/**
 * The built-in Envoy Harness's ACP notification dialect, translated into the updates a run folds.
 *
 * ## Why a translation exists at all
 *
 * The family says one ACP client drives both native harnesses (`docs/envoydev-harness.md` §2), and
 * that is true of the **session lifecycle** — both answer `initialize`, `session/new`,
 * `session/set_mode`, `session/set_policy` and `session/prompt`. It is **not** true of the
 * notifications: the two harnesses publish their content in different envelopes.
 *
 * `deepseek-harness` sends the specification's `session/update` with a discriminated
 * `update.sessionUpdate` (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, …), which
 * `runs.ts` already normalizes. The built-in harness sends its own:
 *
 *   * `session/token`   `{sessionId, token: {role: "assistant", delta}}` — one streaming delta;
 *   * `session/update`  `{sessionId, message: {role, text, partial?}}` — one committed transcript row
 *     (**not** the spec's `update` envelope; the two are disjoint, which is what lets this be
 *     shape-sniffed without asking the catalogue which agent is running);
 *   * `session/activity` `{sessionId, activity: {kind, summary, toolName?, toolArgs?, isError?}}` —
 *     the live trace stream, whose `tool_call` / `tool_result` events are the only place a tool call
 *     is named.
 *
 * That dialect is the harness's own, not a mistake: its WebUI reads exactly these envelopes
 * (`../envoy-harness/packages/envoy-harness-web/src/client/acp/acp-notifications.ts:1-6`, fixed to
 * match them in that repo's commit `460b9ef`). Until this module existed, `AcpClient` forwarded only
 * `params.update`, so **every word the built-in harness said was dropped on the floor** and a run
 * ended `done` with an empty transcript.
 *
 * ## The one hard decision: a turn's assistant text is streamed *or* committed, never both
 *
 * The harness sends the same assistant text twice — once as `session/token` deltas while the model is
 * talking, then once as a committed `session/update` row (and, on a live turn, a second committed copy
 * from the result messages). EnvoyDev's transcript folds `run.output` chunks by **concatenation**
 * (`state/transcript.ts` rule 1), so translating both would print the answer twice.
 *
 * So streaming wins: deltas are translated as they arrive, and the committed assistant copy is kept
 * only as a **fallback for a turn that streamed nothing** — the harness's hermetic demo backend, a
 * slash command, or a provider that does not stream. That is also why the committed copy is *replaced*
 * rather than appended: the harness's own committed rows include an in-flight one superseded by the
 * final one, and only the last one is the answer.
 *
 * ## Thinking is separated, because the harness separates it
 *
 * The built-in harness wraps reasoning in `<think>`/`<thinking>`/`<redacted_thinking>` and strips it
 * before committing an assistant row (`../envoy-harness/packages/envoy-harness/src/util/
 * strip-thinking.ts:11-25`). The deltas carry those tags **raw**, and a tag can be split across two
 * deltas, so the parser holds back a trailing partial tag rather than emitting it as visible text.
 * Inside a block becomes `agent_thought_chunk` (the transcript's own reasoning row) instead of being
 * discarded, which is strictly more than the harness's own WebUI shows.
 */

import type { AcpUpdate } from "./protocol.js";

/**
 * The tag names the harness strips, **longest first** so that `<thinking>` is never matched as
 * `<think` + `ing>`, and `</thinking>` is never matched as `</think` + `ing>`.
 */
const THINKING_TAGS = ["redacted_thinking", "thinking", "think"] as const;
const OPEN_TAGS = THINKING_TAGS.map((tag) => `<${tag}>`);
const CLOSE_TAGS = THINKING_TAGS.map((tag) => `</${tag}>`);

/** The committed-message envelope the harness publishes on `session/update`. */
interface HarnessMessage {
  role?: unknown;
  text?: unknown;
}

/** The earliest of `candidates` in `text`, or `undefined`. Used for the three tag names as a set. */
function earliest(text: string, candidates: readonly string[]): { at: number; tag: string } | undefined {
  let best: { at: number; tag: string } | undefined;
  for (const tag of candidates) {
    const at = text.indexOf(tag);
    if (at >= 0 && (best === undefined || at < best.at)) best = { at, tag };
  }
  return best;
}

/**
 * How many trailing characters must **not** be emitted yet, because they could still be the start of
 * one of `candidates` completed by the next delta.
 *
 * `"hi <thi"` holds back `"<thi"`; `"hi <x"` holds back nothing. Without this, a tag split across two
 * deltas would leak as literal text and the reasoning would never be recognized.
 */
function partialTagLength(text: string, candidates: readonly string[]): number {
  const longest = Math.max(...candidates.map((tag) => tag.length)) - 1;
  for (let length = Math.min(text.length, longest); length > 0; length -= 1) {
    const tail = text.slice(text.length - length);
    if (candidates.some((tag) => tag.startsWith(tail))) return length;
  }
  return 0;
}

/** `agent_message_chunk` / `agent_thought_chunk` — the shapes `RunManager.onUpdate` already folds. */
function chunk(kind: "agent_message_chunk" | "agent_thought_chunk", text: string): AcpUpdate {
  return { sessionUpdate: kind, content: { type: "text", text } };
}

/**
 * Remove closed and trailing unclosed thinking blocks — the fallback path's counterpart to the
 * streaming splitter, mirroring the harness's own `stripThinking` (`strip-thinking.ts:19-25`).
 * Kept local because it is a rendering concern here, not an import of the peer's internals.
 */
export function stripThinking(text: string): string {
  const tag = "(?:redacted_thinking|thinking|think)";
  return text
    .replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "gi"), "")
    .replace(new RegExp(`<${tag}>[\\s\\S]*$`, "gi"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * One client's view of one harness session.
 *
 * Stateful because a delta can split a tag and because "did this turn stream?" is only knowable across
 * a turn. `AcpClient` owns exactly one of these, which matches its one-session-per-process model.
 */
export class HarnessDialect {
  private inThinking = false;
  /** Text seen but not yet classifiable — the tail that may be half a tag. */
  private pending = "";
  private streamed = false;
  private committed = "";
  private committedSeen = false;
  private toolCount = 0;
  private runningToolId: string | undefined;

  /** Reset for a new prompt. Called by `AcpClient.prompt`; nothing from the last turn carries over. */
  beginTurn(): void {
    this.inThinking = false;
    this.pending = "";
    this.streamed = false;
    this.committed = "";
    this.committedSeen = false;
    this.runningToolId = undefined;
  }

  /**
   * Translate one notification. Anything this dialect does not own returns no updates, so the caller
   * can route every notification here without checking first.
   */
  accept(method: string, params: unknown): AcpUpdate[] {
    if (method === "session/token") return this.onToken(params);
    if (method === "session/activity") return this.onActivity(params);
    if (method === "session/update") return this.onCommitted(params);
    return [];
  }

  /** Whatever is still buffered when the turn ends, plus the committed fallback. See the header. */
  endTurn(): AcpUpdate[] {
    const out: AcpUpdate[] = [];
    if (this.pending !== "") {
      out.push(chunk(this.inThinking ? "agent_thought_chunk" : "agent_message_chunk", this.pending));
      this.pending = "";
    }
    // **Only when nothing streamed.** A turn that streamed has already rendered this text, and the
    // transcript appends chunks, so translating the committed copy as well would print it twice.
    if (!this.streamed && this.committedSeen && this.committed !== "") {
      out.push(chunk("agent_message_chunk", this.committed));
    }
    this.beginTurn();
    return out;
  }

  private onToken(params: unknown): AcpUpdate[] {
    const token = (params as { token?: { role?: unknown; delta?: unknown } } | undefined)?.token;
    if (token?.role !== "assistant" || typeof token.delta !== "string" || token.delta === "") return [];
    this.streamed = true;
    return this.pushText(token.delta);
  }

  /** One delta, split into visible answer text and reasoning, with tag boundaries handled. */
  private pushText(delta: string): AcpUpdate[] {
    const out: AcpUpdate[] = [];
    this.pending += delta;
    for (;;) {
      const candidates = this.inThinking ? CLOSE_TAGS : OPEN_TAGS;
      const found = earliest(this.pending, candidates);
      if (found !== undefined) {
        if (found.at > 0) {
          out.push(chunk(this.inThinking ? "agent_thought_chunk" : "agent_message_chunk", this.pending.slice(0, found.at)));
        }
        this.pending = this.pending.slice(found.at + found.tag.length);
        this.inThinking = !this.inThinking;
        continue;
      }
      const held = partialTagLength(this.pending, candidates);
      const text = held === 0 ? this.pending : this.pending.slice(0, this.pending.length - held);
      if (text !== "") out.push(chunk(this.inThinking ? "agent_thought_chunk" : "agent_message_chunk", text));
      this.pending = held === 0 ? "" : this.pending.slice(this.pending.length - held);
      return out;
    }
  }

  /**
   * A committed `session/update` row from the harness.
   *
   * Only the assistant row is ours. `user` is the prompt the host already recorded, `system` is the
   * agent's own prompt, and `tool` is published again — with status — as a `session/activity`
   * `tool_result`, so translating it here would be a second tool row.
   */
  private onCommitted(params: unknown): AcpUpdate[] {
    const message = (params as { message?: HarnessMessage } | undefined)?.message;
    if (message === undefined || typeof message.text !== "string" || message.text === "") return [];
    const role = typeof message.role === "string" ? message.role : "assistant";
    if (role !== "assistant") return [];
    // Replace rather than append: a live turn commits an in-flight row and then the final one, and
    // only the last is the answer. Held, not emitted — see `endTurn`.
    this.committed = stripThinking(message.text);
    this.committedSeen = true;
    return [];
  }

  /**
   * The harness's trace stream. Only the tool pair is translated: `tool_call` names the call, and
   * `tool_result` closes it.
   *
   * The ids are **ours** because the harness's `tool_call` activity carries no `toolCallId`
   * (only `tool_result` does, and it is a provider id the earlier event never named). Tool calls in
   * this harness's loop are sequential, so an increasing id paired at result time is what makes the
   * start and the finish one row instead of a row stuck `running` plus a second terminal one.
   */
  private onActivity(params: unknown): AcpUpdate[] {
    const activity = (params as { activity?: Record<string, unknown> } | undefined)?.activity;
    if (activity === undefined) return [];
    if (activity.kind === "tool_call") {
      this.toolCount += 1;
      const toolCallId = `harness-tool-${this.toolCount}`;
      this.runningToolId = toolCallId;
      return [
        {
          sessionUpdate: "tool_call",
          toolCallId,
          title: typeof activity.toolName === "string" && activity.toolName !== "" ? activity.toolName : "tool",
          ...(activity.toolArgs !== undefined ? { rawInput: activity.toolArgs } : {}),
        },
      ];
    }
    if (activity.kind === "tool_result") {
      const toolCallId = this.runningToolId ?? `harness-tool-${(this.toolCount += 1)}`;
      this.runningToolId = undefined;
      const preview = typeof activity.resultPreview === "string" ? activity.resultPreview : "";
      return [
        {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: activity.isError === true ? "failed" : "completed",
          ...(preview !== "" ? { content: preview } : {}),
        },
      ];
    }
    return [];
  }
}
