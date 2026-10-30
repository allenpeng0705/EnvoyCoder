/**
 * Whether the permission card may offer “Allow and don't ask again”.
 *
 * Only agents whose catalogue wire is `askingControl === "policy"` (Envoy Harness today): the
 * daemon's `stopAskingApprovals` flips Settings and pushes `autoRun: off`. Unattended-mode agents
 * use Settings Off → mode instead; custom providers have no daemon path — do not offer the button
 * from a live `approvalPolicy` flag alone (that used to settle Allow while leaving Settings on).
 *
 * Shipped ids read the catalogue, not only `state.harnesses`, so an empty/stale harness list cannot
 * hide Envoy Harness stop-asking.
 */

import { isHarnessId } from "@envoydev/protocol";
import { askingControl } from "@envoydev/agent-catalog/asking";

export function canStopAskingApprovals(input: {
  harnessId: string | undefined;
  requireApproval: boolean;
}): boolean {
  if (input.requireApproval !== true) return false;
  if (input.harnessId === undefined || !isHarnessId(input.harnessId)) return false;
  return askingControl(input.harnessId) === "policy";
}
