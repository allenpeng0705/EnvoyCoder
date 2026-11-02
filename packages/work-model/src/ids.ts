/** Stable short ids for Tickets and Assignments. */

export function ticketIdFor(at = new Date()): string {
  const stamp = at.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `T-${stamp}-${rand}`;
}

export function shortNameFor(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug || "work";
}

export function assignmentIdFor(ticketId: string, at = new Date()): string {
  const stamp = at.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${ticketId}-a-${stamp}`;
}

export function effectIdFor(at = new Date()): string {
  const stamp = at.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `E-${stamp}-${rand}`;
}

export function candidateIdFor(at = new Date()): string {
  const stamp = at.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `C-${stamp}-${rand}`;
}
