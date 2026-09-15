/**
 * **What the daemon says when it drops a settings key** — the sentence, in both directions.
 *
 * ## Why this is its own file
 *
 * `settings-store.test.ts` proves what the *store* does with a settings file it does not fully
 * recognise: which fields survive, which are quarantined, and which are merely dropped. This proves the
 * thing the user actually meets — the note — and it is a separate file because it is a separate
 * subject with a separate failure mode. A store that keeps every setting and a note nobody can read is
 * half a fix: the user is left with a line in their settings file that does nothing and no way to find
 * out why.
 *
 * ## The three properties, and why each is a test rather than a comment
 *
 *   1. **A dropped key is named.** Not "some settings were ignored" — the *key*, because the whole
 *      point of the note is that a user can go and look at the line it names.
 *   2. **`retired` and `never shipped` are different sentences.** They are different facts about the
 *      world, and only one of them is a fact about EnvoyCoder. A single sentence for both would be
 *      wrong for whichever half it was not written for.
 *   3. **The sentence travels with a key this build knows**, so the German window renders it in German.
 *      That is the daemon/window contract every other note follows (`daemon/messages.ts`), and it is the
 *      property that makes this note translatable at all — the *reason* on a quarantine line is a schema
 *      validator's message and stays English on purpose, and this note deliberately is not that.
 *
 * ## The mutation each case fails on
 *
 *   * "names the key" fails on a note that only counts drops (`2 settings were dropped`), and on a note
 *     that names the *file* and stops.
 *   * "retired is its own sentence" fails on collapsing the two branches into one, which is the natural
 *     simplification when a reader sees two nearly identical `keyed` calls.
 *   * "it is keyed" fails on a bare English `lines.push(...)`, which is what a fourth note added in a
 *     hurry would be.
 */

import { describe, expect, it } from "vitest";

import { describeStoreNotes } from "../src/daemon/service.js";

/** The notes shape the store produces, with only the dropped-key channel filled in. */
function notesFor(keys: readonly { path: string; retired: boolean }[]): {
  quarantined: readonly { file: string; movedTo: string; reason: string }[];
  skipped: readonly { file: string; reason: string }[];
  droppedKeys: readonly { file: string; keys: readonly { path: string; retired: boolean }[] }[];
} {
  return { quarantined: [], skipped: [], droppedKeys: [{ file: "settings.json", keys }] };
}

describe("the note the daemon writes when it drops a settings key", () => {
  it("names the key it dropped, in the file the user would open", () => {
    // The mutation this fails on: reporting a count instead of a name — `1 setting was dropped` — which
    // is unactionable, because the user cannot find the line that is doing nothing.
    const [line] = describeStoreNotes(notesFor([{ path: "hiddenAgents", retired: true }]));

    expect(line).toContain("settings.json");
    expect(line).toContain("hiddenAgents");
  });

  it("keeps a retired key and a key we never shipped as two different sentences", () => {
    // The mutation this fails on: one branch instead of two. Both strings are nearly identical, so the
    // simplification is tempting and it makes the note lie in one of the two directions — either telling
    // a user we removed a key that is a typo in their file, or failing to tell them we removed a key they
    // are still setting.
    const [retired] = describeStoreNotes(notesFor([{ path: "hiddenAgents", retired: true }]));
    const [unknown] = describeStoreNotes(notesFor([{ path: "zzNotAField", retired: false }]));

    expect(retired).toContain("no longer has");
    expect(unknown).toContain("does not recognise");
    expect(retired).not.toBe(unknown);
    // **And the two carry different catalogue keys**, which is the assertion that matters in a translated
    // window: the fallback English sentence is only what a reader sees when the key is one this build does not
    // know, so two lines that differed in their English text and shared a key would render *identically* in
    // German. Found by mutation: a one-line change to the `keyed` call (`retired ? … : …` → always `unknown`)
    // leaves both English sentences different and takes this assertion red.
    expect(retired).toContain('"key":"note.settings.retired"');
    expect(unknown).toContain('"key":"note.settings.unknown"');
    expect(retired).not.toContain('"key":"note.settings.unknown"');
    // And both say the half the user needs: nothing else was lost. This is the sentence that answers the
    // defect the change exists for, so it is asserted in both.
    expect(retired).toContain("kept every other setting");
    expect(unknown).toContain("kept every other setting");
  });

  it("carries a catalogue key, so the window says it in the user's language", () => {
    // The mutation this fails on: pushing a bare English string. It would read on screen and be invisible
    // to every other test here, which is exactly why the key is asserted rather than the sentence.
    const [retired] = describeStoreNotes(notesFor([{ path: "hiddenAgents", retired: true }]));
    const [unknown] = describeStoreNotes(notesFor([{ path: "zzNotAField", retired: false }]));

    expect(retired).toContain('"key":"note.settings.retired"');
    expect(retired).toContain('"key":"hiddenAgents"');
    expect(unknown).toContain('"key":"note.settings.unknown"');
    expect(unknown).toContain('"key":"zzNotAField"');
  });

  it("says one line per dropped key, so no sentence has to choose between 'it' and 'them'", () => {
    // The mutation this fails on: joining the paths into one `{keys}` template value. Every language
    // that inflects for number would then need the daemon to tell it which form to use, which is a fact
    // the daemon does not have and the catalogue cannot express.
    const lines = describeStoreNotes(
      notesFor([
        { path: "allowRemoteRuns", retired: true },
        { path: "hiddenAgents", retired: true },
      ]),
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("allowRemoteRuns");
    expect(lines[0]).not.toContain("hiddenAgents");
    expect(lines[1]).toContain("hiddenAgents");
  });

  it("says nothing at all when nothing was dropped", () => {
    // The absence that matters: an ordinary settings file must not produce a startup note. A note shown
    // on every launch is a note nobody reads, and it would also make the *presence* of one worthless as a
    // signal that something in the file is doing nothing.
    expect(describeStoreNotes({ quarantined: [], skipped: [], droppedKeys: [] })).toEqual([]);
    expect(
      describeStoreNotes({ quarantined: [], skipped: [], droppedKeys: [{ file: "settings.json", keys: [] }] }),
    ).toEqual([]);
  });
});
