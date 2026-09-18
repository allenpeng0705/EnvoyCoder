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

import type { HarnessId } from "@envoydev/protocol";

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

/**
 * Compact name for tight chrome (rail badge, task-header chip).
 *
 * Drops the redundant "Harness" suffix — in a row next to a model id that word is noise, and it made
 * the agent chip read much longer than its neighbour. Full `harnessLabel` stays for settings and
 * sentences that name the product.
 */
export function harnessBadge(harness: HarnessId): string {
  switch (harness) {
    case "envoy-harness":
      return "Envoy";
    case "deepseek-harness":
      return "DeepSeek";
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
      return "Oh My Pi";
  }
}

/**
 * Whether this agent's model values are bare ACP ids (`haiku`, not `provider/haiku`).
 *
 * **Browser-safe copy of `@envoydev/agent-catalog`'s `modelAcceptsBareId`.** The window must not import
 * that package: its barrel pulls `node:child_process` / `node:fs` and Vite then white-screens (dev) or
 * fails the production build. Keep this list in sync with `HARNESS_MODEL_DELIVERY` entries whose
 * `valueShape` is `"bare-id"` (Claude / Codex / Cursor).
 */
export function modelAcceptsBareId(harness: HarnessId): boolean {
  switch (harness) {
    case "claudecode":
    case "codex":
    case "cursor":
      return true;
    case "envoy-harness":
    case "deepseek-harness":
    case "copilot":
    case "opencode":
    case "pi":
    case "omp":
      return false;
  }
}
