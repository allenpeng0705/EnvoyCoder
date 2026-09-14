/**
 * What the daemon says to a user, and the key that lets the window say it in their language.
 *
 * ## The rule this file exists to enforce
 *
 * Every user-facing refusal in this daemon is **an English sentence plus a catalogue key**. The
 * sentence is what a log line, a script and an older client read; the key is what a German user
 * reads, because the window resolves it against the language the *user* chose. The daemon cannot
 * resolve it itself: two windows on one daemon may be in different languages, and the daemon has no
 * business knowing which user is looking.
 *
 * So the two travel together (`withMessageRef` in `@envoycoder/protocol` puts the key inside the
 * message, which is the only field the family's transport preserves).
 *
 * ## Why the key is typed
 *
 * `coderError`'s reference is `{ key: string }` — it has to be, because the *wire* cannot know our
 * catalogue. This wrapper is where the producer is checked: `MessageKey` is derived from the English
 * catalogue, so a typo here is a `tsc` error rather than a German user staring at an English
 * sentence. That failure is invisible to every test — the fallback is *supposed* to be English — so
 * the compiler is the only place it can be caught.
 *
 * Importing the catalogue *type* (never its value) keeps six catalogues out of the daemon's bundle:
 * the daemon sends keys, and the window is what knows what they say.
 */

import { withMessageRef, type CoderMessageRef } from "@envoycoder/protocol";

import type { MessageKey } from "../i18n/messages/en.js";

/**
 * A key, and the values its template needs.
 *
 * Values are strings and numbers only — a `{path}` or a `{count}`, never a nested object, because a
 * template can only interpolate something a user can read.
 */
export function ref(key: MessageKey, values?: Record<string, string | number>): CoderMessageRef {
  return { key, ...(values ? { values } : {}) };
}

/**
 * A sentence with its key attached — for the prose the daemon puts in an *event* rather than in an
 * error: an approval question, a startup note. The window renders these through the same lookup, so
 * there is exactly one way daemon text becomes user text.
 */
export function keyed(
  key: MessageKey,
  sentence: string,
  values?: Record<string, string | number>,
): string {
  return withMessageRef(sentence, ref(key, values));
}
