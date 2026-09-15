/**
 * The agents screen's decisions, as pure functions — **so the part that can silently lie is testable
 * without a DOM.**
 *
 * ## Why this is a module and not `if`s in the component
 *
 * Three claims on this screen could be wrong in a way nobody notices, and each of them has a wrong answer
 * that looks like a right one:
 *
 *   1. **Which rows may be offered as something to add?** The catalogue overlaps the shipped list
 *      (`cursor` is both), and a row that is already declared must not be added twice. Both are rules with
 *      a name behind them (`resolveAgentEntry`, `coder.addProvider`'s replace semantics), so neither is
 *      decided inline in JSX.
 *   2. **What does adding a row send?** Every field comes off the row — including `transport`, which is
 *      the entry's own statement and the one field that produces *silent* wrongness when guessed.
 *   3. **What does the row say about installing?** An `npx` recipe needs no install at all, and a binary
 *      that is missing does; a screen that blurred them would send a user to a download page for something
 *      that installs itself, or leave them with a row that never becomes ready.
 *
 * All three are `tsc`-checked here and asserted in `test/settings-agents-catalog.test.tsx`, and the
 * components are left with the things a test cannot check: layout, wording and focus.
 *
 * ## What used to be the first claim here, and is now nobody's
 *
 * *"What does a row that nobody has measured say?"* was question one, and the answer was a ninth state of
 * its own — `unchecked`, rendered as **"Not checked yet"** on all 38 rows, with a *Check* button on each and
 * a `checkForces` rule for whether a press meant "tell me what you know" or "measure it now". That whole
 * apparatus is deleted, because the state it existed to render is not a state a user should ever meet: the
 * daemon now resolves every row's cheap facts before it serves the list (`CatalogEntry.availability`), so
 * there is nothing to press and nothing to guess. The verdict itself is `agent-verdict.ts`'s
 * `rowVerdict` — one function over those facts, in one place, for all three lists.
 */

import type {
  CatalogEntry,
  HarnessSummary,
  AgentProviderSummary,
} from "@envoycoder/protocol";

import type { AddProviderInput } from "../../state/coderStore.js";
import type { MessageKey } from "../../i18n/messages/en.js";




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




