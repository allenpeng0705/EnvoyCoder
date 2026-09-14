/**
 * The History view model: which section a run lands in, and what a search finds.
 *
 * `now` is a parameter everywhere a boundary is involved, so these pin the boundaries instead of hoping.
 * The distinction that matters is calendar days rather than 24-hour windows: a run at 23:50 yesterday is
 * *Yesterday* even if it was three hours ago, because that is how a person remembers it.
 */

import { describe, expect, it } from "vitest";

import { buildHistory, matchesHistoryQuery, sectionFor, type HistoryEntry } from "../src/index.js";

const now = new Date("2026-03-10T12:00:00");

function entry(over: Partial<HistoryEntry> & { id: string; startedAt: string }): HistoryEntry {
  return { title: `task ${over.id}`, ...over };
}

describe("which section a run belongs to", () => {
  it("calls the last four hours Recent", () => {
    expect(sectionFor("2026-03-10T11:00:00", now)).toBe("Recent");
    expect(sectionFor("2026-03-10T08:30:00", now)).toBe("Recent");
  });

  it("uses calendar days, not 24-hour windows", () => {
    // 23:50 yesterday is yesterday even though it is only 12h10m ago.
    expect(sectionFor("2026-03-09T23:50:00", now)).toBe("Yesterday");
    // 00:10 today is Today even though it is nearly 12h ago.
    expect(sectionFor("2026-03-10T00:10:00", now)).toBe("Today");
  });

  it("walks out through the week and the month", () => {
    expect(sectionFor("2026-03-06T09:00:00", now)).toBe("This week");
    expect(sectionFor("2026-03-01T09:00:00", now)).toBe("This month");
    expect(sectionFor("2026-01-20T09:00:00", now)).toBe("Older");
  });

  it("puts an unparseable timestamp in Older rather than throwing", () => {
    expect(sectionFor("not a date", now)).toBe("Older");
  });
});

describe("search", () => {
  const run = entry({
    id: "r1",
    startedAt: "2026-03-10T10:00:00",
    title: "Fix the parser",
    taskName: "feature-auth",
    keywords: ["coredump", "src/parse.ts"],
  });

  it("matches every term, across title, task and keywords", () => {
    expect(matchesHistoryQuery(run, "parser")).toBe(true);
    expect(matchesHistoryQuery(run, "auth")).toBe(true);
    expect(matchesHistoryQuery(run, "PARSER")).toBe(true);
    expect(matchesHistoryQuery(run, "parser auth")).toBe(true);
    expect(matchesHistoryQuery(run, "parser coredump")).toBe(true);
  });

  it("requires all terms, so a second word narrows rather than widens", () => {
    expect(matchesHistoryQuery(run, "parser nothing-like-this")).toBe(false);
  });

  it("matches everything on an empty query — a search box that hides everything looks broken", () => {
    expect(matchesHistoryQuery(run, "")).toBe(true);
    expect(matchesHistoryQuery(run, "   ")).toBe(true);
  });
});

describe("the whole view", () => {
  const runs: HistoryEntry[] = [
    entry({ id: "old", startedAt: "2026-02-01T09:00:00" }),
    entry({ id: "newest", startedAt: "2026-03-10T11:59:00" }),
    entry({ id: "week", startedAt: "2026-03-05T09:00:00" }),
    entry({ id: "yesterday", startedAt: "2026-03-09T22:00:00" }),
  ];

  it("sorts newest first and groups in the canonical section order", () => {
    const groups = buildHistory(runs, { now });
    expect(groups.map((group) => group.section)).toEqual(["Recent", "Yesterday", "This week", "Older"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["newest"]);
  });

  it("omits empty sections rather than rendering six headings with five empty", () => {
    const groups = buildHistory([entry({ id: "only", startedAt: "2026-03-10T11:00:00" })], { now });
    expect(groups).toHaveLength(1);
    expect(groups[0].section).toBe("Recent");
  });

  it("applies the query before the limit, so Load more never hides a match", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      entry({ id: `r${index}`, startedAt: `2026-03-10T0${index}:00:00`, title: index === 4 ? "needle" : "hay" }),
    );
    const groups = buildHistory(many, { now, query: "needle", limit: 2 });
    expect(groups.flatMap((group) => group.entries).map((e) => e.id)).toEqual(["r4"]);
  });
});
