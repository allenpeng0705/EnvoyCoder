/**
 * Split an `ask_user` prompt into a short headline and an optional body.
 *
 * Agents often dump a multi-page plan into one string. The family's headline-first rule wants a
 * short question on the card and the plan as scrollable detail — not one unbounded `<p>`.
 */

export type SplitAskPrompt = {
  /** Empty means the caller should use the generic "agent asked a question" headline. */
  question: string;
  body?: string;
};

const HEADLINE_MAX = 160;
const LONG_PROMPT = 280;

/**
 * Prefer a short lead-in as the question when the rest looks like a plan body.
 */
export function splitAskPrompt(prompt: string): SplitAskPrompt {
  const trimmed = prompt.trim();
  if (trimmed === "") return { question: "" };

  // "Approve this plan? # Title …" or "…plan. ## Phase 0"
  const afterSentence = /^(.*?[.?!])\s+(#{1,6}\s[\s\S]+)$/s.exec(trimmed);
  if (afterSentence) {
    const head = afterSentence[1]!.trim();
    const body = afterSentence[2]!.trim();
    if (head.length > 0 && head.length <= HEADLINE_MAX && body.length > 0) {
      return { question: head, body };
    }
  }

  // First paragraph when a blank line follows a short lead-in.
  const blank = /\n\s*\n/.exec(trimmed);
  if (blank && blank.index !== undefined && blank.index > 0 && blank.index <= HEADLINE_MAX) {
    const head = trimmed.slice(0, blank.index).trim();
    const body = trimmed.slice(blank.index).trim();
    if (head.length > 0 && body.length > 0) {
      return { question: head, body };
    }
  }

  // First line short, remainder long (or markdown-looking).
  const nl = trimmed.indexOf("\n");
  if (nl > 0 && nl <= HEADLINE_MAX) {
    const head = trimmed.slice(0, nl).trim();
    const body = trimmed.slice(nl + 1).trim();
    if (
      head.length > 0 &&
      body.length > 0 &&
      (body.length > 80 || /^#{1,6}\s/m.test(body) || body.includes("|"))
    ) {
      return { question: head, body };
    }
  }

  // One huge blob with no clean split — keep the body intact; caller supplies a generic headline.
  if (
    trimmed.length > LONG_PROMPT ||
    /^#{1,6}\s/m.test(trimmed) ||
    /^\|/.test(trimmed) ||
    trimmed.includes("\n|")
  ) {
    return { question: "", body: trimmed };
  }

  return { question: trimmed };
}
