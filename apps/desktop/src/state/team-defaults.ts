/**
 * Default team / host labels — project name + number; host as Orchestrator · project.
 *
 * Shared by Settings → Teams and the Team job sheet; the daemon also uses
 * `uniqueTeamLabel` so a colliding create still lands uniquely on disk.
 */

export function uniqueTeamLabel(desired: string, existing: readonly string[]): string {
  const base = desired.trim() || "Team";
  const taken = new Set(existing.map((l) => l.trim().toLowerCase()).filter(Boolean));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : String(Date.now());
  return `${base} ${suffix}`;
}

/** Team name base: the project label, or "Team" when none is open. */
export function defaultTeamBase(projectLabel: string | undefined): string {
  const trimmed = projectLabel?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Team";
}

/**
 * Local machine label on create — role name plus project, e.g. "Orchestrator · api".
 */
export function hostMemberLabel(orchestratorLabel: string, projectLabel: string | undefined): string {
  const role = orchestratorLabel.trim() || "Orchestrator";
  const project = projectLabel?.trim();
  return project && project.length > 0 ? `${role} · ${project}` : role;
}
