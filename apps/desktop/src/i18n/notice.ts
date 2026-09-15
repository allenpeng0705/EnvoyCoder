/**
 * A sentence the user is shown, kept in the form that lets it be re-translated.
 *
 * ## The problem this solves
 *
 * Two kinds of text reach the screen in this app:
 *
 *   * **our own**, which is in the catalogue and rendered with `t("some.key")` — the language is
 *     resolved at render time, so switching language re-renders it;
 *   * **the daemon's**, which arrives over the wire as a *finished English sentence*. A German user
 *     whose window is German and whose refusal is English is exactly the failure this module exists
 *     to prevent: the daemon cannot know which language the window is in (two windows may differ),
 *     but it *can* say which catalogue key its sentence corresponds to — `messageKey` /
 *     `messageValues` on the wire (`@envoycoder/protocol`'s `CoderRpcError`).
 *
 * So daemon prose is carried as a `Notice`: the English sentence *and* the key. The sentence is what
 * a user sees when the key is not one this build knows (**never** the raw key), and the key is what
 * a German user sees when it is. Both travel together through the store, so a language change
 * re-renders a refusal that arrived minutes ago — which a string translated at arrival could not.
 *
 * ## What is deliberately not here
 *
 * No catalogue of its own and no fallback text: the English sentence always comes from the wire (or
 * from the catalogue, for the few strings this app authors itself — `localNotice`). One source for
 * each sentence, so the two ends cannot drift into saying different things in English.
 */

import type { TaskStatus } from "@envoycoder/protocol";

import { parseCoderError, type CoderMessageRef } from "@envoycoder/protocol";

import { en, isMessageKey, type MessageKey } from "./messages/en.js";
import type { Translator } from "./translate.js";

export interface Notice {
  /** The English sentence. The fallback, and what a log line shows. */
  message: string;
  /**
   * The catalogue key, when there is one this build knows.
   *
   * Absent — rather than present and unresolvable — for a key we do not ship: the decision is made
   * once, where the wire text is parsed, so nothing downstream can render `error.some.typo` at a user.
   */
  key?: MessageKey;
  values?: Record<string, string | number>;
}

/** A notice for a string **this app** authors, whose key is therefore known by construction. */
export function localNotice(key: MessageKey, values?: Record<string, string | number>): Notice {
  return { message: en[key], key, ...(values ? { values } : {}) };
}

/**
 * The wire form of a key: what a daemon — or the client, for a sentence it authors itself — attaches
 * to an English sentence so the window can render it in the user's language.
 *
 * Typed as `MessageKey`, deliberately: the reference is `{ key: string }` because the *wire* cannot
 * know our catalogue, but the code that *produces* one can, and a typo there would surface as "an
 * English sentence in a German window" — the exact failure this work exists to prevent, and one no
 * test can see if the key is merely a string.
 */
export function messageRef(key: MessageKey, values?: Record<string, string | number>): CoderMessageRef {
  return { key, ...(values ? { values } : {}) };
}

/**
 * A notice for a string that came over the wire — a refusal, a note, a connection reason.
 *
 * The code prefix is stripped (`envoycoder.path-missing: …` never reaches a user), and the key is
 * kept only when this build actually has it.
 */
export function noticeOf(text: string | undefined): Notice | undefined {
  if (text === undefined || text === "") return undefined;
  const parsed = parseCoderError(text);
  const key = parsed.ref && isMessageKey(parsed.ref.key) ? parsed.ref.key : undefined;
  return {
    message: parsed.message,
    ...(key ? { key } : {}),
    ...(key && parsed.ref?.values ? { values: parsed.ref.values } : {}),
  };
}

/**
 * A call for a method the daemon does not have.
 *
 * This is not a bug in the method name — it is **two builds of one product talking to each other**.
 * The shell spawns a daemon bundle, a dev server can keep an older one alive, and an upgrade leaves
 * whichever got the port first still answering. The family's transport says
 * `Method not found: coder.listTasks`, which is accurate and useless to the person reading it: the
 * window cannot render a fix from it, and the rail looks empty rather than broken.
 *
 * So it becomes a notice with a key and the method in it — translated, and telling the user to
 * restart so the two halves are the same build.
 */
const UNKNOWN_METHOD = /Method not found:\s*([A-Za-z0-9_.:-]+)/;

/** A notice for a thrown or rejected value. Never returns undefined: an error always has *some* text. */
export function noticeFromError(error: unknown): Notice {
  const text = error instanceof Error ? error.message : String(error);
  const unknown = UNKNOWN_METHOD.exec(text);
  if (unknown) {
    return {
      message: text,
      key: "error.daemonTooOld",
      values: { method: unknown[1] ?? "" },
    };
  }
  return noticeOf(text) ?? { message: text };
}

/** A notice for a typed action result, which is already a `Notice` plus a discriminant. */
export type Refusal = { ok: false } & Notice;

/**
 * **What a write answers the UI: `undefined` when it landed, the refusal when it did not.**
 *
 * The one shape every write in this window comes back as, and the reason it is a type of its own rather than
 * `Notice | undefined` spelled out: the *decision* it encodes is where a refusal is read. The store raises
 * nothing (`CoderStore.mutate` states the rule), so a caller that performs a write owes the user a place to
 * read the answer — the row it came from, the composer, the palette — and a function whose parameter is
 * `WriteFailure` says so at the call site. `undefined` for success rather than `{ ok: true }` because there is
 * nothing to render when a write lands: the value arriving in the row *is* the confirmation.
 */
export type WriteFailure = Notice | undefined;

/**
 * The one adapter between the store's two answers and the shape the UI renders.
 *
 * Every write answers `{ ok: true, … } | Refusal`, and every sink takes a `WriteFailure` — so this is where the
 * discriminator is spent, in one place rather than in a conditional at each of the twenty call sites (each of
 * which would be a chance to forget the `ok` check, which is the same as a failure nobody sees).
 */
export function asFailure(answer: { ok: true } | Refusal): WriteFailure {
  return answer.ok ? undefined : answer;
}

/**
 * The text a user sees.
 *
 * `t` falls back to English for a key a language has not translated yet, so this is German for a
 * translated key, English for an untranslated one, and English for a key that does not exist — the
 * three cases in that order, and never a key on screen.
 */
export function localize(t: Translator["t"], notice: Notice | undefined): string | undefined {
  if (!notice) return undefined;
  return notice.key ? t(notice.key, notice.values) : notice.message;
}

/**
 * The text for a string that arrived from outside — an approval question, a run note, a connection
 * reason. Translated when it carries a key this build knows, English otherwise, and `undefined` when
 * there was nothing to say.
 */
export function localizeText(t: Translator["t"], text: string | undefined): string | undefined {
  return localize(t, noticeOf(text));
}

/**
 * The catalogue key for a task status.
 *
 * The wording lives in the catalogue rather than in `@envoycoder/task-model`'s `statusLabel` because
 * it is *language*: the rail, the pane and the phone all show the same bucket, and each renders it
 * in its own user's language. `statusLabel` stays the English source (`"Needs your answer"`), which
 * is what the English catalogue entry repeats word for word — asserted by a test, so the two cannot
 * drift into saying different things in English.
 */
export function statusKey(status: TaskStatus): MessageKey {
  switch (status) {
    case "queued":
      return "status.queued";
    case "running":
      return "status.running";
    case "needs-attention":
      return "status.needsAttention";
    case "idle":
      return "status.idle";
    case "done":
      return "status.done";
    case "failed":
      return "status.failed";
    case "cancelled":
      return "status.cancelled";
  }
}
