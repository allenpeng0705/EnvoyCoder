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
  /** Cursor-style plan doc approval (`exit_plan_mode`), not a normal permission. */
  kind?: "plan-review";
};

const HEADLINE_MAX = 160;
const LONG_PROMPT = 280;

function withPlanKind(split: SplitAskPrompt, raw: string): SplitAskPrompt {
  if (isPlanReviewPrompt(raw, split.question, split.body)) {
    return { ...split, kind: "plan-review" };
  }
  return split;
}

/** Detect harness `exit_plan_mode` / plan-doc approval prompts. */
export function isPlanReviewPrompt(
  raw: string,
  question?: string,
  body?: string,
): boolean {
  // Keep in step with `isPlanReviewAsk` (composer) — same cues, applied to raw and/or split parts.
  const lower = raw.toLowerCase();
  if (
    lower.includes("approve this plan") ||
    lower.includes("leave plan mode") ||
    lower.includes("plan review") ||
    lower.includes("implement this plan")
  ) {
    return true;
  }
  const head = (question ?? "").toLowerCase();
  if (
    head.includes("approve this plan") ||
    head.includes("leave plan mode") ||
    head.includes("plan review") ||
    head.includes("implement this plan")
  ) {
    return true;
  }
  if (
    body !== undefined &&
    body.trim() !== "" &&
    /^#{1,6}\s/m.test(body) &&
    /\bplan\b/i.test((question ?? "") + "\n" + body.slice(0, 240))
  ) {
    return true;
  }
  return false;
}

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
      return withPlanKind({ question: head, body }, trimmed);
    }
  }

  // First paragraph when a blank line follows a short lead-in.
  const blank = /\n\s*\n/.exec(trimmed);
  if (blank && blank.index !== undefined && blank.index > 0 && blank.index <= HEADLINE_MAX) {
    const head = trimmed.slice(0, blank.index).trim();
    const body = trimmed.slice(blank.index).trim();
    if (head.length > 0 && body.length > 0) {
      return withPlanKind({ question: head, body }, trimmed);
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
      return withPlanKind({ question: head, body }, trimmed);
    }
  }

  // One huge blob with no clean split — keep the body intact; caller supplies a generic headline.
  if (
    trimmed.length > LONG_PROMPT ||
    /^#{1,6}\s/m.test(trimmed) ||
    /^\|/.test(trimmed) ||
    trimmed.includes("\n|")
  ) {
    return withPlanKind({ question: "", body: trimmed }, trimmed);
  }

  return withPlanKind({ question: trimmed }, trimmed);
}
