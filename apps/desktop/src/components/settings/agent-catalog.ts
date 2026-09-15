/**
 * The agents screen's decisions, as pure functions — **so the part that can silently lie is testable
 * without a DOM.**
 *
 * ## Why this is a module and not `if`s in the component
 *
 * The catalogue makes exactly one claim that could be wrong in a way nobody notices: *what state is this
 * row in?* Everything else on the screen is either data off the wire or a press. That claim is spread
 * across four questions, and each of them has a wrong answer that looks like a right one:
 *
 *   1. **What does a row that nobody has measured say?** If an entry reads `ready` because it exists in a
 *      list, the product has made a claim it did not measure — the whole reason `coder.probeCatalogAgent`
 *      is a separate call. So "not checked yet" is a state of its own here (`rowStateOf`), and it is not
 *      the same value as any of the five the daemon can send.
 *   2. **Which rows may be offered as something to add?** The catalogue overlaps the shipped list
 *      (`cursor` is both), and a row that is already declared must not be added twice. Both are rules with
 *      a name behind them (`resolveAgentEntry`, `coder.addProvider`'s replace semantics), so neither is
 *      decided inline in JSX.
 *   3. **What does adding a row send?** Every field comes off the row — including `transport`, which is
 *      the entry's own statement and the one field that produces *silent* wrongness when guessed.
 *   4. **What does the row say about installing?** An `npx` recipe needs no install at all, and a binary
 *      that is missing does; a screen that blurred them would send a user to a download page for something
 *      that installs itself, or leave them with a row that never becomes ready.
 *
 * All four are `tsc`-checked here and asserted in `test/settings-agents-catalog.test.tsx`, and the
 * component below is left with the things a test cannot check: layout, wording and focus.
 */

import type {
  CatalogEntry,
  HarnessAvailability,
  HarnessState,
  HarnessSummary,
  AgentProviderSummary,
} from "@envoycoder/protocol";

import type { AddProviderInput } from "../../state/coderStore.js";
import type { MessageKey } from "../../i18n/messages/en.js";
import type { Notice } from "../../i18n/notice.js";

/**
 * What one catalogue row's *Check* has produced so far.
 *
 * `unchecked` is the state a row is in when the screen opens, and it is deliberately not a `HarnessState`:
 * the five the daemon can send are all answers, and a screen that started a row in one of them would be
 * answering a question nobody asked. `refused` is the fourth member for the same reason one step on — the
 * call failed, so we have no answer either, and the daemon's own sentence is what the row shows.
 */
export type CatalogRowProbe =
  | { readonly state: "unchecked" }
  | { readonly state: "checking" }
  | {
      readonly state: "measured";
      readonly availability: HarnessAvailability;
      readonly observedAt: string;
      /** What the measurement cost the daemon, in milliseconds. Shown so the row says what it did. */
      readonly costMs: number;
      readonly cached: boolean;
    }
  | { readonly state: "refused"; readonly notice: Notice };

/**
 * The state a row displays: the five measured ones, plus the three that are not measurements, plus the one
 * that is a measurement of *less* than it first appears.
 *
 * `ready-npx` is the sixth, and it exists for a specific dishonesty rather than for symmetry. The daemon's
 * `ready` for an `npx -y <pkg> …` recipe means **`npx` resolved** — the probe looks for `npx` rather than
 * the package, deliberately, because looking for the package would report all 14 of those rows as missing.
 * So `ready` there is a fact about Node's presence and says nothing about the agent, and 14 rows reading
 * "Ready" claimed a verification nobody performed. The word a user reads is therefore derived from two
 * facts — the measurement *and* how the program is obtained — which is why `rowStateOf` takes the entry.
 */
export type AgentRowState =
  | HarnessState
  | "ready-npx"
  | "unchecked"
  | "checking"
  | "refused";

/**
 * The state of a row, from the entry it belongs to and whatever has happened to it — the one function the
 * row branches on.
 *
 * The `entry` parameter is not optional, and that is the point: a caller that forgot it would get the
 * over-claiming `ready` back on exactly the rows this state exists for, silently. Requiring it makes the
 * omission a compile error instead.
 */
export function rowStateOf(
  entry: Pick<CatalogEntry, "install">,
  probe: CatalogRowProbe | undefined,
): AgentRowState {
  if (probe === undefined) return "unchecked";
  switch (probe.state) {
    case "unchecked":
      return "unchecked";
    case "checking":
      return "checking";
    case "refused":
      return "refused";
    case "measured":
      // **The only place a measured state is read.** `availability.state` comes from the daemon's own
      // prober under `HarnessAvailabilitySchema`, so there is no path here by which a row could be `ready`
      // without one: the only producer of `ready` is this branch, and it requires a measurement.
      //
      // …and for an `npx` recipe it is narrowed, because "the program resolves" there means `npx` resolves.
      // Nothing has been downloaded, so nothing about the agent has been established — see `AgentRowState`.
      return probe.availability.state === "ready" && entry.install.kind === "npx"
        ? "ready-npx"
        : probe.availability.state;
  }
}

/**
 * The chip's word, per row state — **one table for both lists.**
 *
 * The shipped agents' five states and the catalogue rows' nine come from the same list, which is the point:
 * `settings.agent.ready` must mean the same thing on a row we ship and on a row we catalogued, and a second
 * table is how the two come to disagree about a word a user is going to act on. The extra states are the
 * ones that exist because a catalogue row starts unmeasured, and because an `npx` row is measured about
 * less than it looks.
 */
export const ROW_STATE_LABEL = {
  ready: "settings.agent.ready",
  "ready-npx": "settings.agents.row.readyNpx",
  unsupported: "settings.agent.unsupported",
  "needs-bridge": "settings.agent.needsBridge",
  "not-installed": "settings.agent.notInstalled",
  unknown: "settings.agent.unknown",
  unchecked: "settings.agent.unchecked",
  checking: "settings.agent.checking",
  refused: "settings.agent.refused",
} as const satisfies Record<AgentRowState, MessageKey>;

/**
 * The chip's colour, per state — one table each, so a state can never get one and not the other.
 *
 * The colours carry the same distinction the words do: `not-installed` is the only `danger`, because it is
 * the only state that asserts a program the user was told to install is not there. `needs-bridge` and
 * `unsupported` are warnings — something is wrong and it is not the user's mistake. `unknown` is quiet,
 * deliberately: a state that asserts nothing must not look like an alarm. `unchecked` is quiet for the same
 * reason at its strongest — it asserts *less* than `unknown`, which at least knows a search did not happen.
 * `ready-npx` is quiet for exactly that reason too: nothing is wrong and nothing is verified, so it is
 * neither a green light nor a warning.
 */
export const ROW_STATE_CHIP = {
  ready: "chip--live",
  "ready-npx": "chip--quiet",
  unsupported: "chip--warn",
  "needs-bridge": "chip--warn",
  "not-installed": "chip--danger",
  unknown: "chip--quiet",
  unchecked: "chip--quiet",
  checking: "chip--quiet",
  refused: "chip--warn",
} as const satisfies Record<AgentRowState, string>;

/**
 * Does this catalogue row match what the user typed?
 *
 * Title, id and description, the same three fields the reference product searches and for the same reason:
 * a user looking for the agent they have installed knows one of those three and not the other two. Case-
 * insensitive and trimmed, and an empty query matches everything — which is what makes the search box
 * removable rather than a mode.
 */
export function matchesCatalogQuery(entry: CatalogEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [entry.title, entry.id, entry.description].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

/** Why a catalogue row may not be added, when it may not be — and `undefined` when it may. */
export type RowBlocker = "built-in" | "already-added";

/**
 * Whether this row can be added, and if not, which of the two reasons it is.
 *
 * Two, and they are genuinely different facts:
 *
 *   * **`built-in`** — the id also names an agent we ship (`cursor` is the one today). The rule that a
 *     built-in wins is `resolveAgentEntry`'s, and the reason is that a built-in is the entry we ship
 *     driving logic for and have evidence about. So the row is shown — a user looking for Cursor must find
 *     it — and it is *not* offered as a second thing to add, because two rows answering to one id is
 *     exactly the ambiguity the rule removes.
 *   * **`already-added`** — the user has already declared this provider. Adding it again would **replace**
 *     it (`coder.addProvider` is a complete statement of how to start a program), which is not what a
 *     button labelled *Add* should do silently; the row offers *Remove* instead.
 */
export function rowBlocker(
  entry: CatalogEntry,
  addedIds: ReadonlySet<string>,
): RowBlocker | undefined {
  if (entry.builtIn) return "built-in";
  if (addedIds.has(entry.id)) return "already-added";
  return undefined;
}

/** The ids a user has already declared, as the set the catalogue rows are filtered against. */
export function addedProviderIds(providers: readonly AgentProviderSummary[]): ReadonlySet<string> {
  return new Set(providers.map((provider) => provider.id));
}

/**
 * The rows the *Add an agent* list shows, in catalogue order.
 *
 * Every entry is included — including the two kinds a user cannot add — because this list's job is to answer
 * "is the agent I have installed supported?", and hiding `cursor` would answer that question wrongly for the
 * agent most likely to be asked about. What the blocked rows lose is the button, not the row.
 */
export function catalogRows(
  entries: readonly CatalogEntry[],
  query: string,
): readonly CatalogEntry[] {
  return entries.filter((entry) => matchesCatalogQuery(entry, query));
}

/**
 * The parameters `coder.addProvider` takes for a catalogue entry — **every one of them off the row**.
 *
 * The one that matters is `transport`: it is the entry's own statement of its dialect, passed through
 * untouched. Nothing here, and nothing in the screen, decides a dialect; a default would be us choosing
 * `"acp"` on behalf of a program we cannot see, and the failure mode of getting it wrong is that a peer
 * ignores a field it does not recognise and reports success.
 *
 * `modeParam` and `authMethodId` are absent because the row has no such field — see `CatalogEntry`.
 *
 * ## `catalogEntryId`, and the one thing this function still does not send
 *
 * `env` is the entry's variable **names**, and `catalogEntryId` is the reference that lets the daemon
 * resolve the entry's own constants without a value ever crossing this wire. The row *does* carry those
 * constants (`CatalogEntry.env` is name-and-value, §7.10's correction), and this function deliberately
 * drops the values: a provider config has no field for one, and the alternative — sending them so the
 * daemon could store them — is the design this reference exists *instead of*. A test asserts the negative
 * by putting a real-looking key in the row.
 */
export function addInputFor(entry: CatalogEntry): AddProviderInput {
  return {
    id: entry.id,
    label: entry.title,
    command: entry.command,
    args: [...entry.args],
    env: entry.env.map((constant) => constant.name),
    transport: entry.transport,
    catalogEntryId: entry.id,
  };
}

/**
 * The command line a row shows, for reading — one string, from the two fields that are the truth.
 *
 * Built here rather than stored on the wire a second time: two spellings of one command is how a row comes
 * to show something the launch would not run.
 */
export function commandLineOf(entry: Pick<CatalogEntry, "command" | "args">): string {
  return [entry.command, ...entry.args].join(" ");
}

/**
 * Splitting a user's typed arguments — quoted spans kept whole, because a user who types quotes means them.
 *
 * ## Why this is a mirror, and how the mirror is held in step
 *
 * The authority is `@envoycoder/agent-catalog`'s `splitArgs`, which is what the **launch** uses to turn a
 * provider's stored `args` into argv. This copy exists for one reason: that package's entry point reaches
 * `@envoycoder/platform`, which imports `node:fs`, so the window's bundle cannot import it at all — the same
 * constraint that put the catalogue on the wire in the first place.
 *
 * A second answer to "what did the user mean by this string" is exactly the drift this repository keeps
 * paying for, so it is not left to care: `test/settings-agents-catalog.test.tsx` parses one table of inputs
 * with **both** functions and fails if they disagree. The behaviour is theirs, character for character —
 * including that an empty `""` span contributes no argument at all.
 *
 * Not a shell: variables and globs are never expanded, so `$HOME` stays the four characters it is, and the
 * argv reaches `spawn` element by element.
 */
export function splitArgs(raw: string): string[] {
  if (raw.trim() === "") return [];
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

/**
 * The environment variable **names** a user typed, one per line or separated by commas.
 *
 * Names only, and the daemon refuses anything that is not one — with a sentence in the user's language that
 * deliberately does not quote the offending entry back, because the thing a user pastes into a field labelled
 * "environment" is very often the credential itself. This function does not validate; it splits, and the
 * daemon is the one that decides.
 */
export function parseEnvNames(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((name) => name.trim())
        .filter((name) => name !== ""),
    ),
  ];
}

/** The id a label produces when the user did not type one — the daemon's own rule, applied for the preview. */
export function providerIdFrom(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Whether the *Check* button should ask the daemon to measure again rather than accept its cache.
 *
 * **True after the first answer**, and that is the user's own act being honoured: the daemon refuses to
 * cache a `not-installed` answer precisely because a user is about to change it, and a user who presses a
 * button labelled *Check again* after installing something means "measure it now". The first press of a row
 * says the other thing — "tell me what you know" — and a second window that asked a minute ago is an answer.
 */
export function checkForces(probe: CatalogRowProbe | undefined): boolean {
  return probe !== undefined && probe.state !== "unchecked";
}

/**
 * A `HarnessSummary`'s auth, as the three words a chip can carry — beside the state, never inside it.
 *
 * `needs-signin` is a fact about *whether the agent will talk to us*, which is a different question from
 * whether its program is installed: `cursor-agent` on a fresh install is `ready` and `needs-signin` at the
 * same time, and collapsing the two would either hide an installed agent or promise a session that will not
 * open. `unknown` means nothing has looked, which is why it gets its own phrasing rather than silence.
 *
 * ## `undefined` is `unknown`, and that is not defensiveness
 *
 * `HarnessSummary.auth` is required by the schema, but the window attaches to whichever daemon owns the port
 * and a daemon from an **older build** does not send it at all — the same asymmetry that has already cost
 * this pane one crash (`models`/`thinking`, §7.2 of `docs/settings-parity.md`). So absence is read the way
 * `authOf` reads a missing record: *nothing has measured this*, which is exactly what `unknown` means. It is
 * emphatically **not** "no sign-in is needed", and the chip for it is silence rather than a claim.
 */
export function authChipKeys(
  auth: HarnessSummary["auth"] | undefined,
): { key: MessageKey; chip: string } | undefined {
  switch (auth?.state) {
    case "needs-signin":
      return { key: "settings.agents.auth.needsSignin", chip: "chip--warn" };
    case "ready":
      return { key: "settings.agents.auth.ready", chip: "chip--quiet" };
    default:
      // Nothing has measured it, and a chip saying "we have not looked" on every row of a nine-row list is
      // noise rather than information — the sign-in button is what a user reaches for, and it is shown for
      // the one state that has an action. Absence here is not "signed in".
      return undefined;
  }
}
