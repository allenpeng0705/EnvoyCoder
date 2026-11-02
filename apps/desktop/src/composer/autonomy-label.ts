/**
 * Quiet composer label for asking posture — Settings + selected mode, no second policy.
 */

export type AutonomyLabelKind = "asking-on" | "asking-off" | "full-access";

/**
 * Derive the autonomy chip kind from Settings and the selected agent mode.
 *
 * `modeUnattended` is true when the catalogue marks the selected mode `unattended`
 * (Full access / YOLO / Bypass permissions).
 */
export function autonomyLabelKind(input: {
  requireApproval: boolean;
  modeUnattended: boolean;
}): AutonomyLabelKind {
  if (input.modeUnattended) return "full-access";
  if (!input.requireApproval) return "asking-off";
  return "asking-on";
}
