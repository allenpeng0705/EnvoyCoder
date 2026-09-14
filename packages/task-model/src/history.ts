/**
 * History: every task you have run, newest first, sectioned by when.
 *
 * The data half of the sidebar's `History` view (Paseo's second nav row). Kept here, in the model
 * package, because it is a pure transformation of runs — the component that renders it stays a
 * component, and this file is what the tests can pin.
 *
 * Deliberately **decoupled from the wire types**: it takes a minimal entry shape, so a caller maps
 * `AgentRun` into it rather than this module tracking every field of a run. That also means the
 * sections and the search can be tested without a store, a daemon or a clock.
 *
 * Paseo's sections, adopted verbatim (`sessions` namespace): `Recent`, `Today`, `Yesterday`,
 * `This week`, `This month`, `Older` — plus a search box and `Load more`.
 */

/** What the view needs to know about one run. The caller builds it from whatever it has. */
export interface HistoryEntry {
  id: string;
  /** ISO timestamp of when the run started. */
  startedAt: string;
  /** One line of what it was asked to do. Already truncated by the caller if it is long. */
  title: string;
  /** The task it belongs to, for the second line of a row. */
  taskName?: string;
  /** `needs-attention` and `failed` float to their own section's top; the caller decides the string. */
  status?: string;
  /** Anything else worth matching a search against (project name, branch, path). */
  keywords?: readonly string[];
}

export const HISTORY_SECTIONS = ["Recent", "Today", "Yesterday", "This week", "This month", "Older"] as const;
export type HistorySection = (typeof HISTORY_SECTIONS)[number];

/** Runs from the last four hours read as "Recent" — close enough to now to still be in your head. */
const RECENT_MS = 4 * 60 * 60 * 1000;

/**
 * Which section a timestamp belongs to, given "now".
 *
 * Calendar-day arithmetic, not "24 hours ago": a run at 23:50 yesterday is yesterday even if it was
 * five hours ago, because that is how a person remembers it. `now` is a parameter so a test can pin the
 * boundaries instead of hoping.
 */
export function sectionFor(startedAt: string | Date, now: Date): HistorySection {
  const started = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(started.getTime())) return "Older";

  const ageMs = now.getTime() - started.getTime();
  if (ageMs < RECENT_MS) return "Recent";

  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(started)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 31) return "This month";
  return "Older";
}

/**
 * Search across the fields a user would type: the title, the task, and the caller's keywords.
 *
 * Case-insensitive and whitespace-tolerant; an empty query matches everything, because a search box
 * that hides the list until you type is a search box people think is broken.
 */
export function matchesHistoryQuery(entry: HistoryEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystack = [entry.title, entry.taskName ?? "", ...(entry.keywords ?? [])]
    .join("\n")
    .toLowerCase();
  return needle.split(/\s+/).every((term) => haystack.includes(term));
}

export interface HistoryGroups {
  section: HistorySection;
  entries: HistoryEntry[];
}

/**
 * The whole view model: filter, sort newest-first, then group into sections in Paseo's order.
 *
 * Sections with nothing in them are omitted rather than rendered empty — an accordion of six headings
 * with five of them empty is noise. Sections keep their canonical order regardless of where the matches
 * fall.
 */
export function buildHistory(
  entries: readonly HistoryEntry[],
  options: { query?: string; now?: Date; limit?: number } = {},
): HistoryGroups[] {
  const now = options.now ?? new Date();
  const matched = entries
    .filter((entry) => matchesHistoryQuery(entry, options.query ?? ""))
    .slice()
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const limited = options.limit === undefined ? matched : matched.slice(0, options.limit);

  const bySection = new Map<HistorySection, HistoryEntry[]>();
  for (const entry of limited) {
    const section = sectionFor(entry.startedAt, now);
    bySection.set(section, [...(bySection.get(section) ?? []), entry]);
  }

  return HISTORY_SECTIONS.filter((section) => (bySection.get(section)?.length ?? 0) > 0).map((section) => ({
    section,
    entries: bySection.get(section) ?? [],
  }));
}
