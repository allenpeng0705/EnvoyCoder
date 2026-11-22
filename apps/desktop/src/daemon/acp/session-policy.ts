/**
 * Build the JSON-RPC params for `session/set_policy`.
 *
 * As of envoy-harness b9eed3a+, a named `preset` no longer returns early: co-sent
 * `sandbox` / `approval` / `autoRun` apply on top of the preset in the same request
 * (`agent-backend.ts` setPolicy). One payload is enough — including domain unlock
 * (`mobile` / `webdev`) plus Settings Asking Off as `autoRun: "off"`.
 */

import type { AcpSessionPolicy } from "./protocol.js";

export function setPolicyCallParams(
  sessionId: string,
  policy: AcpSessionPolicy,
): Array<Record<string, unknown>> {
  const body: Record<string, unknown> = { sessionId };
  if (policy.preset !== undefined) body.preset = policy.preset;
  if (policy.sandbox !== undefined) body.sandbox = policy.sandbox;
  if (policy.approval !== undefined) body.approval = policy.approval;
  if (policy.autoRun !== undefined) body.autoRun = policy.autoRun;
  return [body];
}
