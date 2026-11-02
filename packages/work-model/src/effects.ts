/**
 * Effect queue helpers (Phase 2) — pure coalescing / receipt keys.
 */

import type { EffectKind, WorkEffect } from "./types.js";

export function effectReceiptKey(
  kind: EffectKind,
  ticketId: string,
  detail: string,
): string {
  return `${kind}:${ticketId}:${detail}`;
}

/** Drop duplicate pending effects that share a receipt key. */
export function coalescePending(effects: readonly WorkEffect[]): WorkEffect[] {
  const seen = new Set<string>();
  const out: WorkEffect[] = [];
  for (const effect of effects) {
    if (effect.status !== "pending") {
      out.push(effect);
      continue;
    }
    const key = effect.receiptKey ?? effect.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(effect);
  }
  return out;
}

/** Human-wake effects jump ahead of new launches. */
export function sortEffectsForDispatch(effects: readonly WorkEffect[]): WorkEffect[] {
  const pending = effects.filter((effect) => effect.status === "pending");
  const human = pending.filter(
    (effect) => effect.kind === "deliver" || effect.kind === "notify",
  );
  const rest = pending.filter(
    (effect) => effect.kind !== "deliver" && effect.kind !== "notify",
  );
  return [...human, ...rest];
}

/** Extra concurrency slot reserved for human follow-up (design §6.5). */
export function canTakeWorkerSlot(input: {
  runningCount: number;
  limit: number;
  isHumanWake: boolean;
}): boolean {
  if (input.runningCount < input.limit) return true;
  if (input.isHumanWake && input.runningCount < input.limit + 1) return true;
  return false;
}
