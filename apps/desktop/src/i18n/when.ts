/**
 * A timestamp from the daemon, written the way the user's language writes one.
 *
 * ## Why this is `Intl` and not a format string
 *
 * The window now shows *when* something was observed — "these are the models EnvoyDev saw this agent
 * publish, on 14 September 2026 at 13:23" — and that sentence has to be readable in all seven
 * languages this product speaks. `14.09.2026` and `September 14, 2026` are the same fact written for two
 * readers, and a hand-rolled `YYYY-MM-DD HH:mm` would be wrong for six of the seven: it is not merely
 * unfamiliar, it is the shape a *developer* reads, and this product's rule is that every user-facing
 * string is end-user-readable.
 *
 * So the calendar and the clock are the platform's, which is also what every other date in a user's
 * life on this machine looks like.
 *
 * ## The failure mode, which is the reason this is a module with a test
 *
 * A timestamp is data from the daemon, and a daemon one version ahead — or a hand-edited state file —
 * can send something that is not a date. `new Date("nonsense")` does **not** throw: it produces an
 * Invalid Date, and `Intl.DateTimeFormat.format` on one throws `RangeError`. A component that threw
 * there would take the whole composer down for a cosmetic line, so the rule is:
 *
 *   * a value that is not a parseable date is shown **as the daemon sent it**, verbatim. An ISO string
 *     is ugly and true; a blank or a crash is neither.
 *   * a locale `Intl` cannot make a formatter for falls back to the same thing, and to the raw string
 *     as the *last* resort — because the sentence around it still says what the timestamp means.
 */

import type { Locale } from "./locales.js";

/**
 * One timestamp, in the user's language.
 *
 * `dateStyle: "medium"` + `timeStyle: "short"` deliberately: a date and a clock are both needed (an
 * observation from this morning and one from last week differ in what they promise), and the "medium"
 * date is the one that names the month rather than a number whose order differs by country.
 *
 * No time zone is passed, so the formatter uses the machine's — which is the same clock the *user* is
 * reading the window against. Converting to UTC would be more "portable" and less useful: "observed at
 * 05:23" for something the user watched happen at lunchtime is a worse answer than a local one.
 */
export function formatWhen(at: string, locale: Locale): string {
  const date = new Date(at);
  // `Number.isNaN(date.getTime())` rather than `date.toString() === "Invalid Date"`: the same test the
  // platform intends, and one that a future Date implementation cannot reword.
  if (Number.isNaN(date.getTime())) return at;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    // A locale or an ICU build this runtime cannot format — the same fallback, for the same reason.
    return at;
  }
}

/** The staircase `formatAgo` walks, from the smallest unit to the largest it will name. */
const AGO_STEPS = [
  { unit: "second", ms: 1000 },
  { unit: "minute", ms: 60_000 },
  { unit: "hour", ms: 3_600_000 },
  { unit: "day", ms: 86_400_000 },
] as const;

/** Beyond this, "N days ago" stops being a useful reading and a date is the better answer. */
const AGO_MAX_DAYS = 7;

/**
 * **How long ago something was observed** — `4 minutes ago`, in the user's own language.
 *
 * ## Why this is `Intl.RelativeTimeFormat` and not a translated template
 *
 * The agent pane now says *"Verified 4 minutes ago"* on a row, which is the sentence the mandate asks for:
 * a deep fact that arrives as a property **with its time**, so the user learns when EnvoyDev last looked
 * without having to press something. Seven languages times a unit times a plural is exactly the kind of
 * template a hand-written catalogue gets wrong — `1 minutes ago` reads as a bug in every one of them — and
 * the platform already owns the pluralisation and the wording in all seven (`mins ago`, `vor 4 Minuten`,
 * `4分钟前`). So the only thing this module decides is **which unit**, and that is a ladder:
 *
 *   * under a minute → `second`, rounded down, so "just now" is `0 seconds ago` and is never a claim that
 *     something was measured in the future;
 *   * then minutes, hours, and days, each rounded to nearest;
 *   * past `AGO_MAX_DAYS` → `formatWhen`'s date **and** clock, because "9 days ago" is a worse answer than the
 *     date, and this pane already has one tested formatter for that.
 *
 * ## The two fallbacks, and why they are the same rule as `formatWhen`'s
 *
 * A timestamp that is not a date is returned **verbatim**, and a runtime without `Intl.RelativeTimeFormat` —
 * or one that throws for a locale — gets `formatWhen`, which has its own fallback to the same verbatim
 * string. A property reading `2026-09-14T13:23:00.000Z` is ugly and true; a blank or a crash is neither.
 *
 * `now` is a parameter rather than a `Date.now()` read for the reason every clock in this repo is injected:
 * a test that has to wait five minutes to watch the sentence change is a test nobody runs.
 */
export function formatAgo(at: string, locale: Locale, now: number): string {
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return at;
  const elapsed = now - then;
  // A clock that went backwards (a laptop waking, an NTP correction) is not evidence that something was
  // observed in the future, and `-3 minutes ago` is not a sentence. It reads as the smallest unit instead.
  const forward = Math.max(0, elapsed);
  if (forward >= AGO_MAX_DAYS * 86_400_000) return formatWhen(at, locale);
  // The largest unit that fits, which is the one a reader wants: 90 minutes is "2 hours ago", not "90
  // minutes ago", and the ladder is walked from the top rather than from the bottom for that reason.
  const step = [...AGO_STEPS].reverse().find((candidate) => forward >= candidate.ms) ?? AGO_STEPS[0];
  const value = -Math.round(forward / step.ms);
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, step.unit);
  } catch {
    return formatWhen(at, locale);
  }
}
