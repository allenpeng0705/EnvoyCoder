/**
 * Codex-inspired autonomy presets — UI-agnostic Read only / Default / Full access.
 *
 * Mirrors `codex-rs/utils/approval-presets`: one vocabulary that pairs Asking (Settings) with
 * the catalogue mode this build can deliver. Does not invent Agent/Ask/Auto.
 */

export type AutonomyPresetId = "read-only" | "default" | "full-access";

export interface AutonomyPreset {
  id: AutonomyPresetId;
  /** Stable English label — windows localize via message keys. */
  label: string;
  description: string;
  /** Settings → Ask before risky steps. */
  requireApproval: boolean;
}

export const AUTONOMY_PRESETS: readonly AutonomyPreset[] = [
  {
    id: "read-only",
    label: "Read only",
    description:
      "Keep asking before risky steps. Prefer a plan or ask mode when the agent has one — not a filesystem sandbox.",
    requireApproval: true,
  },
  {
    id: "default",
    label: "Default",
    description: "Keep asking before risky steps. Run in the agent’s normal mode.",
    requireApproval: true,
  },
  {
    id: "full-access",
    label: "Full access",
    description:
      "Stop asking on this machine and use the agent’s unattended / YOLO mode when it has one. Exercise caution.",
    requireApproval: false,
  },
] as const;

/**
 * Derive the active preset from Settings + whether the selected mode is unattended
 * and whether a read-only / plan mode is selected.
 */
export function activeAutonomyPreset(input: {
  requireApproval: boolean;
  modeUnattended: boolean;
  modeReadOnly: boolean;
}): AutonomyPresetId {
  if (input.modeUnattended || !input.requireApproval) return "full-access";
  if (input.modeReadOnly) return "read-only";
  return "default";
}

/** Mode looks like plan / read-only / ask (attended, restrictive). */
export function modeLooksReadOnly(modeId: string | undefined): boolean {
  if (modeId === undefined || modeId === "") return false;
  const id = modeId.toLowerCase().replace(/_/g, "-");
  return (
    id === "plan" ||
    id === "read-only" ||
    id === "readonly" ||
    id === "ask" ||
    id === "review" ||
    id.includes("read-only")
  );
}

/** Prefer catalogue mode id for a preset, from the agent’s published modes. */
export function modeIdForPreset(
  preset: AutonomyPresetId,
  modes: readonly { id: string; unattended?: boolean }[],
  unattendedFallback?: string,
): string | undefined {
  if (modes.length === 0) {
    if (preset === "full-access") return unattendedFallback;
    return undefined;
  }
  if (preset === "full-access") {
    const marked = modes.find((mode) => mode.unattended === true)?.id;
    return marked ?? unattendedFallback;
  }
  if (preset === "read-only") {
    const preferred = ["plan", "read-only", "ask", "review"] as const;
    for (const id of preferred) {
      const hit = modes.find((mode) => mode.id.toLowerCase().replace(/_/g, "-") === id);
      if (hit) return hit.id;
    }
    const soft = modes.find((mode) => modeLooksReadOnly(mode.id) && mode.unattended !== true);
    return soft?.id;
  }
  // default — first non-unattended, non-read-only; else first non-unattended
  const normal = modes.find(
    (mode) => mode.unattended !== true && !modeLooksReadOnly(mode.id),
  );
  if (normal) return normal.id;
  return modes.find((mode) => mode.unattended !== true)?.id;
}

/** Re-export label kind for chips that still speak Asking on / off. */
export { autonomyLabelKind, type AutonomyLabelKind } from "./autonomy-label.js";
