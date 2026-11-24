/**
 * Cursor ACP sometimes leaks an internal stream failure as assistant text and still
 * answers `session/prompt` with `stopReason: "end_turn"`. The text is not the model’s
 * reply — Cursor’s guidance is to strip the trailer and, when there was no real answer,
 * retry the same prompt in-session.
 *
 * Patterns observed in the wild (forum / ACP clients):
 *   - `Error: RetriableError: WritableIterable is closed`
 *   - `Error: ConnectError: [unavailable] …` / `[aborted] aborted`
 *   - `Something went wrong communicating with the server. Please try again.`
 *   - `Service temporarily unavailable` (tool runner / backend blip)
 *
 * UX rule for the host:
 *   * Trailing leak after real assistant text → strip only; finish as success (common Cursor case).
 *   * Leak with no usable assistant text this turn → bounded same-session retry with backoff
 *     (unless tools already settled — then strip only so Shell is not re-run).
 *   * Thrown errors whose message matches → same retry path as a text leak with no content.
 */

/** One line that is only a known Cursor ACP / tool-runner failure blurb. */
const LEAK_LINE =
  "(?:Error:\\s*(?:RetriableError|ConnectError)\\b[^\\n]*|" +
  "Something went wrong communicating with the server\\b[^\\n]*|" +
  "Service temporarily unavailable\\b[^\\n]*)";

/** Whole chunk that is only the leak (optional leading whitespace / newlines). */
const LEAK_ONLY = new RegExp(`^\\s*${LEAK_LINE}\\s*$`, "i");

/**
 * Trailing leak after a real answer. Cursor often appends `\n\nError: …`; some builds use a
 * single newline.
 */
const LEAK_TAIL = new RegExp(`\\n\\n?${LEAK_LINE}\\s*$`, "i");

const THROWN_LEAK =
  /(?:RetriableError|ConnectError|WritableIterable is closed|Something went wrong communicating with the server|Service temporarily unavailable)/i;

/** True when the chunk is nothing but a known Cursor ACP stream-failure leak. */
export function isAcpRetriableLeakText(text: string): boolean {
  return text !== "" && LEAK_ONLY.test(text);
}

/** True when a thrown / stderr failure is the same Cursor ACP stream class. */
export function isAcpRetriableLeakError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return THROWN_LEAK.test(message);
}

/**
 * Drop a Cursor ACP retriable-leak chunk (or its trailing tail). `kept` is what may
 * still be shown as assistant text; empty means the whole chunk was the leak.
 */
export function stripAcpRetriableLeak(text: string): { kept: string; leaked: boolean } {
  if (text === "") return { kept: "", leaked: false };
  if (isAcpRetriableLeakText(text)) return { kept: "", leaked: true };

  const tail = text.match(LEAK_TAIL);
  if (tail && tail.index !== undefined) {
    return { kept: text.slice(0, tail.index), leaked: true };
  }
  return { kept: text, leaked: false };
}

/** Pause before a same-session re-prompt so Cursor’s stream / tool runner can settle. */
export const RETRIABLE_LEAK_RETRY_DELAY_MS = 1_000;

/**
 * Flatten ACP tool `content` / Cursor `rawOutput` into plain text for display and classification.
 *
 * Accepts a string, `{ type: "text", text }`, nested `{ type: "content", content }`, arrays of
 * those, or Cursor’s agent-specific `rawOutput` shapes (`stdout`/`stderr`/`exitCode`, `content`,
 * `error`, match counts). Image/audio blocks contribute nothing.
 */
export function textFromAcpToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => textFromAcpToolContent(part)).join("");
  }
  if (typeof content !== "object" || content === null) return "";
  const block = content as {
    type?: unknown;
    text?: unknown;
    content?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
    error?: unknown;
    totalMatches?: unknown;
    truncated?: unknown;
    resultCount?: unknown;
  };
  if (block.type === "text" && typeof block.text === "string") return block.text;
  // tool_call_update often wraps text as `{ type: "content", content: { type: "text", text } }`.
  if (block.type === "content") {
    return textFromAcpToolContent(block.content);
  }
  // Cursor ACP: Shell/Read results live on rawOutput, not content (agent-shell PR #702).
  if (typeof block.error === "string" && block.error !== "") return block.error;
  if (typeof block.content === "string") return block.content;
  if (
    typeof block.stdout === "string" ||
    typeof block.stderr === "string" ||
    typeof block.exitCode === "number"
  ) {
    const parts: string[] = [];
    if (typeof block.exitCode === "number") parts.push(`Exit code: ${block.exitCode}`);
    if (typeof block.stdout === "string" && block.stdout !== "") parts.push(block.stdout);
    if (typeof block.stderr === "string" && block.stderr !== "") parts.push(block.stderr);
    return parts.join("\n\n");
  }
  if (typeof block.totalMatches === "number") {
    return `${block.totalMatches} matches${block.truncated === true ? " (truncated)" : ""}`;
  }
  if (typeof block.resultCount === "number") return `${block.resultCount} results`;
  if (block.content !== undefined) return textFromAcpToolContent(block.content);
  if (typeof block.text === "string") return block.text;
  return "";
}

/**
 * Pick the tool payload to store: prefer non-empty ACP `content`, else Cursor `rawOutput`.
 * Cursor completes Shell/Read with empty `content` and puts stdout in `rawOutput` — that is
 * allowed by ACP (`content` and `rawOutput` are both optional).
 */
export function toolPayloadFromAcpUpdate(update: {
  content?: unknown;
  rawOutput?: unknown;
}): unknown | undefined {
  const content = update.content;
  if (content !== undefined && content !== null) {
    if (Array.isArray(content) && content.length === 0) {
      // empty content array → fall through to rawOutput
    } else if (textFromAcpToolContent(content).trim() !== "" || !isPlainEmpty(content)) {
      return content;
    }
  }
  if (update.rawOutput !== undefined && update.rawOutput !== null) {
    return update.rawOutput;
  }
  if (content !== undefined) return content;
  return undefined;
}

function isPlainEmpty(value: unknown): boolean {
  if (value === "" || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * True when a tool result’s text is a Cursor tool-runner / backend blip — not real stdout.
 * Bare empty output is **not** a failure (quiet commands, or a peer that truly sent nothing).
 * Match **whole-chunk** leaks only — substring matching would false-positive on ordinary logs.
 */
export function isAcpToolRunnerFailure(content: unknown): boolean {
  const text = textFromAcpToolContent(content).trim();
  if (text === "") return false;
  const { kept, leaked } = stripAcpRetriableLeak(text);
  return leaked && kept.trim() === "";
}
