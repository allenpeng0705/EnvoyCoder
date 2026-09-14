/**
 * What a harness is *called*, when the daemon has not told us.
 *
 * Every surface that names an agent prefers `HarnessSummary.label`, which is the daemon's answer and the
 * one a user should read. This is the fallback for the two cases where there is no summary yet — the
 * first paint, before `coder.listHarnesses` has answered, and a window that is not connected at all —
 * and it exists so those two do not render an id (`deepseek-harness`) at somebody who has never heard
 * the word.
 *
 * It is a `switch` with no `default` clause on purpose: `HarnessId` is a closed union, so adding an
 * entry to the catalogue fails this function at compile time rather than quietly shipping a harness
 * whose name on screen is its id in lower case.
 */

import type { HarnessId } from "@envoycoder/protocol";

export function harnessLabel(harness: HarnessId): string {
  switch (harness) {
    case "envoy-harness":
      return "Envoy Harness";
    case "deepseek-harness":
      return "DeepSeek Harness";
    case "claudecode":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "copilot":
      return "Copilot";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor";
    case "pi":
      return "Pi";
    case "omp":
      return "OMP (Oh My Pi)";
  }
}
