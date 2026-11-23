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
 *
 * UX rule for the host:
 *   * Trailing leak after real assistant text → strip only; finish as success (common Cursor case).
 *   * Leak with no usable assistant text this turn → bounded same-session retry with backoff.
 *   * Thrown errors whose message matches → same retry path as a text leak with no content.
 */

/** Whole chunk that is only the leak (optional leading whitespace / newlines). */
const LEAK_ONLY =
  /^\s*(?:Error:\s*(?:RetriableError|ConnectError)\b[^\n]*|Something went wrong communicating with the server\b[^\n]*)\s*$/i

/**
 * Trailing leak after a real answer. Cursor often appends `\n\nError: …`; some builds use a
 * single newline.
 */
const LEAK_TAIL =
  /\n\n?(?:Error:\s*(?:RetriableError|ConnectError)\b[^\n]*|Something went wrong communicating with the server\b[^\n]*)\s*$/i

const THROWN_LEAK =
  /(?:RetriableError|ConnectError|WritableIterable is closed|Something went wrong communicating with the server)/i

/** True when the chunk is nothing but a known Cursor ACP stream-failure leak. */
export function isAcpRetriableLeakText(text: string): boolean {
  return text !== "" && LEAK_ONLY.test(text)
}

/** True when a thrown / stderr failure is the same Cursor ACP stream class. */
export function isAcpRetriableLeakError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return THROWN_LEAK.test(message)
}

/**
 * Drop a Cursor ACP retriable-leak chunk (or its trailing tail). `kept` is what may
 * still be shown as assistant text; empty means the whole chunk was the leak.
 */
export function stripAcpRetriableLeak(text: string): { kept: string; leaked: boolean } {
  if (text === "") return { kept: "", leaked: false }
  if (isAcpRetriableLeakText(text)) return { kept: "", leaked: true }

  const tail = text.match(LEAK_TAIL)
  if (tail && tail.index !== undefined) {
    return { kept: text.slice(0, tail.index), leaked: true }
  }
  return { kept: text, leaked: false }
}

/** Brief pause before a same-session re-prompt so Cursor’s stream can settle. */
export const RETRIABLE_LEAK_RETRY_DELAY_MS = 400
