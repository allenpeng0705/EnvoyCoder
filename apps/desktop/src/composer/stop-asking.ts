/**
 * Whether the permission card may offer “Allow and don't ask again”.
 *
 * Any deliverable asking wire (`policy`, `unattended-mode`, `launch-force`, `session-auto`,
 * `launch-approval`): the daemon flips Settings Off and applies the live path (policy / mode /
 * host session-auto / next-spawn yolo). Custom providers without a catalogue YOLO mode have no
 * path — do not offer the button from a live `approvalPolicy` flag alone.
 *
 * Shipped ids read the catalogue, not only `state.harnesses`, so an empty/stale harness list cannot
 * hide Envoy Harness stop-asking.
 */

import { isHarnessId } from "@envoydev/protocol";
import { askingControl } from "@envoydev/agent-catalog/asking";
import { cataloguedUnattendedModeId } from "@envoydev/agent-catalog/catalog";

/** True when Settings Asking Off / Full access can actually reach this agent. */
export function askingIsDeliverable(input: {
  harnessId: string | undefined;
  /** Catalogue entry id when the task runs a user/provider agent (Gemini, Qwen, …). */
  catalogEntryId?: string;
}): boolean {
  if (input.harnessId === undefined) return false;
  if (isHarnessId(input.harnessId)) {
    return askingControl(input.harnessId) !== "none";
  }
  return cataloguedUnattendedModeId(input.catalogEntryId ?? input.harnessId) !== undefined;
}

export function canStopAskingApprovals(input: {
  harnessId: string | undefined;
  requireApproval: boolean;
  /** Catalogue entry id when the task runs a user/provider agent (Gemini, Qwen, …). */
  catalogEntryId?: string;
}): boolean {
  if (input.requireApproval !== true) return false;
  return askingIsDeliverable(input);
}
