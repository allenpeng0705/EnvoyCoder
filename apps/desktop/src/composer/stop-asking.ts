/**
 * Whether the permission card may offer “Allow and don't ask again”.
 *
 * Agents with a deliverable asking wire (`policy` or `unattended-mode`): the daemon flips Settings
 * Off and pushes `autoRun: off` or the published unattended mode. Custom providers without a
 * catalogue YOLO mode have no path — do not offer the button from a live `approvalPolicy` flag
 * alone (that used to settle Allow while leaving Settings on).
 *
 * Shipped ids read the catalogue, not only `state.harnesses`, so an empty/stale harness list cannot
 * hide Envoy Harness stop-asking.
 */

import { isHarnessId } from "@envoydev/protocol";
import { askingControl } from "@envoydev/agent-catalog/asking";
import { cataloguedUnattendedModeId } from "@envoydev/agent-catalog/catalog";

export function canStopAskingApprovals(input: {
  harnessId: string | undefined;
  requireApproval: boolean;
  /** Catalogue entry id when the task runs a user/provider agent (Gemini, Qwen, …). */
  catalogEntryId?: string;
}): boolean {
  if (input.requireApproval !== true) return false;
  if (input.harnessId === undefined) return false;
  if (isHarnessId(input.harnessId)) {
    return askingControl(input.harnessId) !== "none";
  }
  return cataloguedUnattendedModeId(input.catalogEntryId ?? input.harnessId) !== undefined;
}
