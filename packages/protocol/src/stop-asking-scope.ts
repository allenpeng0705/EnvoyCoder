/**
 * Codex-inspired stop-asking scopes (Wave 4).
 *
 * - `session` — auto-allow further permissions on this live run only.
 * - `machine` — Settings → Ask before risky steps Off (durable) + live push.
 *
 * Per-prefix / per-file scopes are deferred.
 */

export const STOP_ASKING_SCOPES = ["session", "machine"] as const;
export type StopAskingScope = (typeof STOP_ASKING_SCOPES)[number];

export function isStopAskingScope(value: unknown): value is StopAskingScope {
  return value === "session" || value === "machine";
}
