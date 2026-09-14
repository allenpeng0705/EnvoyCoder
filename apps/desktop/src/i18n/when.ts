/**
 * A timestamp from the daemon, written the way the user's language writes one.
 *
 * ## Why this is `Intl` and not a format string
 *
 * The window now shows *when* something was observed — "these are the models EnvoyCoder saw this agent
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
