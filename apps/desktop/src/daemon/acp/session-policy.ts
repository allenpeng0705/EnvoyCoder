/**
 * Build the JSON-RPC params for one or more `session/set_policy` calls.
 *
 * envoy-harness applies `preset` and returns immediately — sandbox / autoRun in the *same*
 * request are ignored. When both a domain preset and an autoRun override are needed, this
 * returns two payloads: preset first, then autoRun-only.
 */

import type { AcpSessionPolicy } from "./protocol.js";

export function setPolicyCallParams(
  sessionId: string,
  policy: AcpSessionPolicy,
): Array<Record<string, unknown>> {
  if (policy.preset !== undefined) {
    const calls: Array<Record<string, unknown>> = [{ sessionId, preset: policy.preset }];
    if (policy.autoRun !== undefined) {
      calls.push({ sessionId, autoRun: policy.autoRun });
    }
    return calls;
  }
  const body: Record<string, unknown> = { sessionId };
  if (policy.sandbox !== undefined) body.sandbox = policy.sandbox;
  if (policy.approval !== undefined) body.approval = policy.approval;
  if (policy.autoRun !== undefined) body.autoRun = policy.autoRun;
  return [body];
}
