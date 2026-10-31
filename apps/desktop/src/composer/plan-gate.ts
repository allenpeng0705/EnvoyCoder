/**
 * When to auto-enter Cursor-style “plan carefully” before a large send.
 *
 * Conservative on purpose: ordinary short asks start working normally. Only
 * prompts that *feel* like a large change (strong wording, very long text, or
 * length plus weaker cues / many attachments) turn on Plan and frame the prompt
 * — no interstitial ask. The user is asked later, when the plan is ready to implement.
 */

/** Prefix for plan-first sends — design only until the user approves. */
export const PLAN_FIRST_PREFIX =
  "[Plan carefully — design only, no code edits yet. Investigate as needed, " +
  "then produce a complete markdown plan starting with a # heading and call " +
  "`exit_plan_mode` so I can approve before any implementation.]\n\n";

// Whole-system / whole-repo cues only — bare "architecture" or "end-to-end" alone must not fire.
const STRONG =
  /\b(refactor|migrate|redesign|overhaul|rewrite)\b.{0,40}\b(system|architecture|codebase|repo|entire|whole|all)\b|\b(analyze|investigate|audit)\b.{0,40}\b(whole|entire|full)\b.{0,20}\b(repo|codebase|project)\b|\binvestigate (this )?repo\b|\b(end[\s.-]?to[\s.-]?end).{0,40}\b(refactor|migrate|redesign|overhaul|rewrite|audit|investigate)\b|\b(refactor|migrate|redesign|overhaul|rewrite|audit|investigate).{0,40}\b(end[\s.-]?to[\s.-]?end)\b|\bacross (all|every)\b.{0,20}\b(package|module|service)/i;

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

/** True when this send should start in plan-first (not a user-facing chooser). */
export function shouldAutoPlanFirst(input: {
  prompt: string;
  attachmentCount: number;
  planMode: boolean;
  planCapable: boolean;
  running: boolean;
}): boolean {
  if (input.running) return false;
  if (!input.planCapable) return false;
  if (input.planMode) return false;
  return looksLikeBigTask(input.prompt, input.attachmentCount);
}

export function withPlanFirstFraming(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  if (trimmed.startsWith("[Plan carefully")) return userPrompt;
  return PLAN_FIRST_PREFIX + userPrompt;
}

/** Transcript / echo text — never show the internal plan-first bracket to the user. */
export function stripPlanFirstFraming(text: string): string {
  if (text.startsWith(PLAN_FIRST_PREFIX)) return text.slice(PLAN_FIRST_PREFIX.length);
  if (text.startsWith("[Plan carefully")) {
    const end = text.indexOf("]\n\n");
    if (end >= 0) return text.slice(end + 3);
  }
  return text;
}

/** True when an ask_user card is a plan-approval (markdown doc + implement?). */
export function isPlanReviewAsk(question: string, detail?: string): boolean {
  const head = question.toLowerCase();
  if (head.includes("approve this plan") || head.includes("leave plan mode")) return true;
  if (head.includes("plan review")) return true;
  if (head.includes("implement this plan")) return true;
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

/** Map harness plan-review option labels; prefer wording, fall back to order. */
export function planReviewOptionLabel(
  label: string,
  index: number,
  labels: { implement: string; revise: string },
): string {
  const lower = label.toLowerCase();
  if (/\b(reject|revise|keep planning|deny|no)\b/.test(lower)) return labels.revise;
  if (/\b(approve|implement|continue|accept|yes)\b/.test(lower)) return labels.implement;
  if (index === 0) return labels.implement;
  if (index === 1) return labels.revise;
  return label;
}

/** True when this choice is the “implement / leave plan mode” option. */
export function isPlanReviewApproveChoice(
  choice: string,
  options: readonly { id: string; label: string }[],
): boolean {
  const hit = options.find((option) => option.id === choice);
  if (hit === undefined) return false;
  const lower = hit.label.toLowerCase();
  if (/\b(reject|revise|keep planning|deny|no)\b/.test(lower)) return false;
  if (/\b(approve|implement|continue|accept|yes)\b/.test(lower)) return true;
  return options[0]?.id === choice;
}
