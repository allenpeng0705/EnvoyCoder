/**
 * File-level +/− for the composer diff pill.
 *
 * Line-level numstat stays in DiffView; the pill only needs a compact signal that
 * something changed and roughly how much.
 */

export interface DiffStat {
  additions: number;
  deletions: number;
}

export function diffStatFromChanges(
  changes: readonly { kind: string }[],
): DiffStat | undefined {
  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    switch (change.kind) {
      case "added":
      case "untracked":
        additions += 1;
        break;
      case "deleted":
        deletions += 1;
        break;
      case "modified":
      case "renamed":
      case "conflict":
        additions += 1;
        deletions += 1;
        break;
      default:
        break;
    }
  }
  if (additions === 0 && deletions === 0) return undefined;
  return { additions, deletions };
}
