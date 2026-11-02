/**
 * Source port (Phase 4) — adapters translate external events into Triggers.
 * Engine must not import GitHub types; adapters live at the edge.
 */

import type { WorkTrigger } from "./types.js";

export interface SourceContext {
  now: () => string;
  /** Persist / fan-out handled by host. */
  receive: (trigger: WorkTrigger) => Promise<"stored" | "duplicate" | "filtered">;
}

export interface WorkSource {
  readonly kind: string;
  start(ctx: SourceContext): Promise<void>;
  stop(): Promise<void>;
  /** Optional outbound Channel. */
  reply?(input: {
    threadKey: string;
    body: string;
    purpose: "acknowledgement" | "answer" | "result" | "attention";
  }): Promise<void>;
}

/** Parse `gh api` notification / issue comment payloads into a Trigger shape. */
export function triggerFromGithubComment(input: {
  repo: string;
  number: number;
  commentId: string;
  body: string;
  actor?: string;
  at?: string;
}): WorkTrigger {
  const threadKey = `github:${input.repo}#${input.number}`;
  return {
    id: `gh-comment-${input.commentId}`,
    sourceKind: "github",
    externalId: String(input.commentId),
    text: input.body,
    ...(input.actor !== undefined ? { actor: input.actor } : {}),
    threadKey,
    createdAt: input.at ?? new Date().toISOString(),
  };
}

/**
 * True only for an @mention of one of the names — not a bare substring, and not a
 * longer handle that merely starts with the name (`@envoy-bot` ≠ `@envoy`).
 */
export function looksLikeAgentMention(text: string, names: readonly string[]): boolean {
  return names.some((name) => {
    const n = name.trim();
    if (n.length === 0) return false;
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Stop at word chars *or* hyphen so `@envoy` does not match `@envoy-bot`.
    return new RegExp(`(?:^|\\W)@${escaped}(?![\\w-])`, "i").test(text);
  });
}
