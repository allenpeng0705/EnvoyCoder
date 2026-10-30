/**
 * When to offer Cursor-style “plan carefully” before a large send.
 *
 * Conservative on purpose: ordinary short asks must not open the gate. Only
 * prompts that *feel* like a large change (strong wording, very long text, or
 * length plus weaker cues / many attachments) ask the user.
 */

/** Prefix when the user chooses Plan carefully — design only until they approve. */
export const PLAN_FIRST_PREFIX =
  "[Plan carefully — design only, no code edits yet. Investigate as needed, " +
  "then produce a complete markdown plan starting with a # heading and call " +
  "`exit_plan_mode` so I can approve before any implementation.]\n\n";

const STRONG =
  /\b(refactor|migrate|redesign|overhaul|rewrite)\b.{0,40}\b(system|architecture|codebase|repo|entire|whole|all)\b|\b(architecture|end[\s.-]?to[\s.-]?end)\b|\b(analyze|investigate|audit)\b.{0,40}\b(whole|entire|full)\b.{0,20}\b(repo|codebase|project)\b|\binvestigate (this )?repo\b|\bacross (all|every)\b.{0,20}\b(package|module|service)/i;

const WEAK =
  /\b(refactor|migrate|redesign|architecture|overhaul|rewrite|multi[\s-]?step|phased|roadmap)\b/i;

export function looksLikeBigTask(prompt: string, attachmentCount: number): boolean {
  const text = prompt.trim();
  if (text.length === 0) return false;
  if (STRONG.test(text)) return true;
  if (attachmentCount >= 3) return true;
  if (text.length >= 800) return true;
  if (text.length >= 400 && (WEAK.test(text) || attachmentCount >= 2)) return true;
  return false;
}

export function shouldOfferPlanGate(input: {
  prompt: string;
  attachmentCount: number;
  planMode: boolean;
  skipPlanGate: boolean;
  planCapable: boolean;
  running: boolean;
}): boolean {
  if (input.running) return false;
  if (!input.planCapable) return false;
  if (input.planMode) return false;
  if (input.skipPlanGate) return false;
  return looksLikeBigTask(input.prompt, input.attachmentCount);
}

export function withPlanFirstFraming(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  if (trimmed.startsWith("[Plan carefully")) return userPrompt;
  return PLAN_FIRST_PREFIX + userPrompt;
}

/** True when an ask_user card is a plan-approval (markdown doc + implement?). */
export function isPlanReviewAsk(question: string, detail?: string): boolean {
  const head = question.toLowerCase();
  if (head.includes("approve this plan") || head.includes("leave plan mode")) return true;
  if (head.includes("plan review")) return true;
  if (
    detail !== undefined &&
    detail.trim() !== "" &&
    /^#{1,6}\s/m.test(detail) &&
    /\bplan\b/i.test(question + "\n" + detail.slice(0, 240))
  ) {
    return true;
  }
  return false;
}
