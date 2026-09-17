/**
 * The daemon's own settings writes — the half a control cannot be trusted to get right.
 *
 * ## Why this file exists next to `settings-scope.test.tsx`
 *
 * That test proves the *controls*: which scope a button opens, and that a write carries the values it
 * is not changing. This one proves the **daemon** rules those controls depend on, and each of them is
 * a rule a UI cannot enforce on its own:
 *
 *   1. **`""` means "clear it", and it never reaches the disk.** A JSON patch cannot carry an absent
 *      key — `{model: undefined}` disappears in `JSON.stringify` — so the wire's only way to un-choose
 *      a value is the empty string, and the store has to turn that back into *absence*. Otherwise a
 *      user who clears the default model stores `""`, which `ProjectDefaultsSchema` refuses
 *      (`min(1)`), and the write fails as a schema error for something entirely legal.
 *   2. **A project's defaults *replace*; the app's *merge*.** The asymmetry is deliberate and the two
 *      directions fail differently: a merged project default would leave the agent undefined when the
 *      user only changed the model, and a replaced app default would wipe a model chosen in another
 *      window. Both are asserted, because a comment cannot hold a rule that a spread operator obeys.
 *   3. **A key this build does not have does not cost the user their settings file.** The read is
 *      tolerant by construction: an unknown or retired key is dropped and noted, every other setting is
 *      kept, and quarantine is left for the two cases that really are unreadable — bytes that are not a
 *      settings document, and a known key holding a value we refuse. The old rule here was the opposite
 *      (one unknown key quarantined the whole file) and it needed a maintainer to remember a list before
 *      deleting a field; the tests below pin both halves of that correction, and assert that the list is
 *      no longer load-bearing at all.
 *   4. **The app defaults actually reach a created task.** This is the wiring the pane's controls
 *      promise, asserted where it happens — `createTask` → `resolveTaskDefaults` — rather than where
 *      it is rendered.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CODER_SETTINGS } from "@envoydev/protocol";
import { coderPaths, type CoderPaths } from "@envoydev/host-bridge";

import { CoderStore } from "../src/daemon/store.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A store over a throwaway home, with one project registered in it. */
async function bench(): Promise<{
  store: CoderStore;
  paths: CoderPaths;
  projectId: string;
  settingsFile: () => Promise<string>;
  projectsFile: () => Promise<string>;
}> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-settings-"));
  const paths = coderPaths(home);
  cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const store = await CoderStore.open({ paths });
  const project = await store.addProject({ path: join(home, "repo") });
  return {
    store,
    paths,
    projectId: project.project.id,
    settingsFile: () => readFile(paths.settingsFile, "utf8"),
    projectsFile: () => readFile(paths.projectsFile, "utf8"),
  };
}

describe("the settings patch, as the daemon reads it", () => {
  it("merges the new-task defaults, so a window that changes one does not clear the other", async () => {
    const b = await bench();
    await b.store.updateSettings({ defaults: { harness: "deepseek-harness" } });
    await b.store.updateSettings({ defaults: { model: "deepseek/deepseek-chat" } });

    // Both, not just the last: a client that sends `{model}` must not silently drop the agent another
    // window chose. The two keys arrived in two calls, which is exactly the real sequence.
    expect(b.store.settings().defaults).toEqual({
      harness: "deepseek-harness",
      model: "deepseek/deepseek-chat",
    });
  });

  it("turns an empty string into absence rather than storing a value no schema accepts", async () => {
    const b = await bench();
    await b.store.updateSettings({ defaults: { model: "deepseek/deepseek-chat", extraArgs: "--verbose" } });
    await b.store.updateSettings({ defaults: { model: "" } });

    // The model is *gone*, and the sibling is untouched — clearing one thing is not clearing the row.
    expect(b.store.settings().defaults).toEqual({ harness: "envoy-harness", extraArgs: "--verbose" });
    // And the sentinel is not on the disk. This is the assertion that would fail if the store spread the
    // patch in naively: `""` would be written, and the *next* read would quarantine the whole file
    // because `ProjectDefaultsSchema` requires `min(1)`.
    const stored = JSON.parse(await b.settingsFile()) as { defaults: Record<string, unknown> };
    expect(stored.defaults.model).toBeUndefined();
    expect(await b.settingsFile()).not.toContain('""');
  });

  it("clears the nominated folder with the same empty string, and keeps the rest of the file", async () => {
    const b = await bench();
    await b.store.updateSettings({ defaultProjectPath: "/Users/you/work" });
    expect(b.store.settings().defaultProjectPath).toBe("/Users/you/work");

    await b.store.updateSettings({ defaultProjectPath: "" });
    // Absent, not `""`: `CoderSettingsSchema` says `defaultProjectPath: z.string().min(1).optional()`,
    // so an empty string would be a settings file this build cannot read back.
    expect(b.store.settings().defaultProjectPath).toBeUndefined();
    expect(b.store.notes().quarantined).toEqual([]);

    // A second open reads what was written, which is the property that matters: the file on disk is
    // still a settings file, twice over.
    const reopened = await CoderStore.open({ paths: b.paths });
    expect(reopened.settings().defaultProjectPath).toBeUndefined();
    expect(reopened.settings().defaults.harness).toBe(DEFAULT_CODER_SETTINGS.defaults.harness);
  });
});

describe("where a new task's defaults come from", () => {
  it("takes the app's model and extra arguments when the project says nothing", async () => {
    const b = await bench();
    await b.store.updateSettings({
      defaults: { harness: "deepseek-harness", model: "deepseek/deepseek-chat", extraArgs: "--verbose" },
    });

    const task = await b.store.createTask({ projectId: b.projectId, title: "a task" });
    // **The two fields whose controls slice 1 added.** Read here rather than in the pane, because a
    // rendered select proves the control exists and this proves the value arrives.
    expect(task?.harness).toBe("deepseek-harness");
    expect(task?.model).toBe("deepseek/deepseek-chat");
    expect(task?.extraArgs).toBe("--verbose");
  });

  it("lets a project's defaults win, which is the whole reason the project scope is a screen", async () => {
    const b = await bench();
    await b.store.updateSettings({
      defaults: { harness: "envoy-harness", model: "deepseek/deepseek-chat" },
    });
    await b.store.updateProject(b.projectId, { defaults: { harness: "claudecode" } });

    const task = await b.store.createTask({ projectId: b.projectId, title: "a task" });
    // The project's agent, the app's model — per key, not per scope, and the resolver is where that
    // order lives (`packages/task-model/src/index.ts:92-105`).
    expect(task?.harness).toBe("claudecode");
    expect(task?.model).toBe("deepseek/deepseek-chat");
  });

  it("replaces a project's defaults rather than merging them, which is what the pane compensates for", async () => {
    const b = await bench();
    await b.store.updateProject(b.projectId, { defaults: { model: "deepseek/deepseek-chat" } });
    await b.store.updateProject(b.projectId, { defaults: { harness: "deepseek-harness" } });

    // **The rule `settings-scope.test.tsx` is written against.** A project's defaults are a complete
    // statement — "this one runs on DeepSeek" — so a write replaces them, and a model that is not in the
    // patch is not in the project any more. That is why the pane sends the values it is not changing,
    // and it is the reason the shell holds the project's id rather than the object it was handed.
    expect(b.store.findProject(b.projectId)?.defaults).toEqual({ harness: "deepseek-harness" });

    const task = await b.store.createTask({ projectId: b.projectId, title: "a task" });
    expect(task?.model).toBeUndefined();
  });

  it("drops a cleared project value the same way, so `\"\"` never reaches the projects file", async () => {
    const b = await bench();
    await b.store.updateProject(b.projectId, {
      defaults: { model: "deepseek/deepseek-chat", extraArgs: "--verbose" },
    });
    // The whole intended object, with the cleared key spelled `""` — which is what the pane sends,
    // because a project's defaults replace. Sending only `{extraArgs: ""}` would clear the model too,
    // and that is the replace rule above rather than a bug in the sentinel.
    await b.store.updateProject(b.projectId, {
      defaults: { model: "deepseek/deepseek-chat", extraArgs: "" },
    });

    expect(b.store.findProject(b.projectId)?.defaults).toEqual({ model: "deepseek/deepseek-chat" });
    expect(await b.projectsFile()).not.toContain('""');
    expect(b.store.notes().quarantined).toEqual([]);
  });
});

describe("a settings file this build does not fully recognise", () => {
  /**
   * Open a store over a throwaway home whose `settings.json` is exactly `document` — as **bytes**, so a
   * test can hand it something that is not JSON at all as easily as it can hand it a document.
   *
   * The file is written through `writeFile` rather than through the store on purpose: the defect these
   * tests are about is what a *previous* build left on disk, and a store that wrote the file would write
   * the shape it currently understands, which is the one thing the test must not supply.
   */
  async function reopened(document: string): Promise<{
    store: CoderStore;
    settingsFile: () => Promise<string>;
  }> {
    const home = await mkdtemp(join(tmpdir(), "envoydev-tolerant-"));
    const paths = coderPaths(home);
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    await CoderStore.open({ paths });
    await writeFile(paths.settingsFile, document, "utf8");
    const store = await CoderStore.open({ paths });
    return { store, settingsFile: () => readFile(paths.settingsFile, "utf8") };
  }

  /** A file with every setting this build honours set to a non-default value, so "kept" is provable. */
  const KNOWN_AND_SET = {
    defaultProjectPath: "/Users/you/work",
    defaults: { harness: "deepseek-harness" },
    requireApprovalForDestructive: false,
    keepTranscripts: false,
    language: "ko",
  } as const;

  /** What a user must still have after a key we do not know is dropped. Asserted in four places. */
  const KEPT: readonly [string, (store: CoderStore) => unknown, unknown][] = [
    ["language", (store) => store.settings().language, "ko"],
    ["defaultProjectPath", (store) => store.settings().defaultProjectPath, "/Users/you/work"],
    ["defaults.harness", (store) => store.settings().defaults.harness, "deepseek-harness"],
    [
      "requireApprovalForDestructive",
      (store) => store.settings().requireApprovalForDestructive,
      false,
    ],
    ["keepTranscripts", (store) => store.settings().keepTranscripts, false],
  ];

  it("keeps every setting it knows and notes the key it dropped", async () => {
    // **The defect, in the words of the report that found it:** *"`hiddenAgents` had to go into
    // `RETIRED_SETTINGS_KEYS`, or the strict schema would have quarantined an upgrading user's entire
    // settings file (language, folder, default agent) over a list nothing reads."*
    //
    // **The mutation this fails on:** putting `.strict()` back in the read path without the prune — i.e.
    // `CoderSettingsSchema.safeParse(raw)` instead of `readCoderSettingsDocument(raw)`. The file below is
    // then rejected whole, `quarantined` is non-empty, and every one of the five assertions goes red. The
    // second mutation it fails on is a prune that reports the drop but does not *keep* the rest, which is
    // the same catastrophe with a nicer note.
    const { store } = await reopened(JSON.stringify({ ...KNOWN_AND_SET, zzNotAField: 1 }));

    expect(store.notes().quarantined).toEqual([]);
    for (const [what, read, expected] of KEPT) {
      expect(read(store), `${what} was lost to one unknown key`).toEqual(expected);
    }
    // The dropped key is not resurrected anywhere the window could render it — and it is *named*, so the
    // user can see which line of their file is doing nothing.
    expect(Object.keys(store.settings())).not.toContain("zzNotAField");
    expect(store.notes().droppedKeys).toEqual([
      { file: "settings.json", keys: [{ path: "zzNotAField", retired: false }] },
    ]);
  });

  it("keeps every setting it knows and notes a key this build retired as a deletion", async () => {
    // A retired key and a key we have never heard of are dropped by the *same* mechanism — that is the
    // whole point of the change, and the only thing `RETIRED_SETTINGS_KEYS` adds is the sentence. So the
    // assertions here are deliberately the same set as above, with one difference at the end.
    const { store } = await reopened(
      JSON.stringify({ ...KNOWN_AND_SET, allowRemoteRuns: false, hiddenAgents: ["codex"] }),
    );

    expect(store.notes().quarantined).toEqual([]);
    for (const [what, read, expected] of KEPT) {
      expect(read(store), `${what} was lost to two retired keys`).toEqual(expected);
    }
    expect(store.notes().droppedKeys).toEqual([
      {
        file: "settings.json",
        keys: [
          { path: "allowRemoteRuns", retired: true },
          { path: "hiddenAgents", retired: true },
        ],
      },
    ]);
  });

  it("drops an unknown key **inside** a nested object too, rather than refusing the document", async () => {
    // **The mutation this fails on:** pruning only the top level of the document — a `for` loop over
    // `Object.keys(raw)` with a hard-coded settings-key list, which is the obvious wrong implementation.
    // `defaults` has a `.strict()` schema of its own, so a single unknown key inside it refuses the whole
    // file in exactly the way a top-level one did. A fix that moves the catastrophe one object deeper is
    // not a fix.
    const { store } = await reopened(
      JSON.stringify({
        ...KNOWN_AND_SET,
        defaults: { harness: "deepseek-harness", zzNotAField: "x" },
      }),
    );

    expect(store.notes().quarantined).toEqual([]);
    expect(store.settings().defaults).toEqual({ harness: "deepseek-harness" });
    expect(store.settings().language).toBe("ko");
    expect(store.notes().droppedKeys).toEqual([
      { file: "settings.json", keys: [{ path: "defaults.zzNotAField", retired: false }] },
    ]);
  });

  it("leaves the dropped key on disk, because a newer build is likelier than garbage", async () => {
    // **The mutation this fails on:** copying `readCollection`'s rewrite-after-skip. The list reader
    // rewrites so a warning is not repeated every launch, and copying that here would delete a setting a
    // *newer* EnvoyDev reads — a user who runs a newer build in another window, or who downgrades and
    // upgrades again, would find the value gone. So the note repeats, and the bytes stay.
    const document = JSON.stringify({ ...KNOWN_AND_SET, zzNotAField: 1 });
    const { store, settingsFile } = await reopened(document);

    expect(store.notes().droppedKeys).toHaveLength(1);
    expect(await settingsFile()).toBe(document);
  });

  it("is still quarantined when the bytes are not JSON at all", async () => {
    // **Unreadable is a different event from unrecognised, and it keeps the old treatment.** There is no
    // document here to keep anything *from*, so the bytes are moved aside — not overwritten — and the
    // daemon carries on with the defaults and says so.
    //
    // **The mutation this fails on:** making the tolerant read swallow a parse failure and return the
    // defaults, which would silently discard a file a user could otherwise recover by hand.
    const { store } = await reopened("{ this is not JSON");
    const [note] = store.notes().quarantined;

    expect(note?.file).toContain("settings.json");
    expect(note?.movedTo).not.toBe("");
    expect(store.settings()).toEqual(DEFAULT_CODER_SETTINGS);
  });

  it("is still quarantined when the JSON is not one object of settings", async () => {
    // A list of settings is not a settings document. Dropping keys out of an array would be "tolerance"
    // that invents a reading nobody wrote, so this is the second unreadable case rather than a third kind
    // of tolerance.
    const { store } = await reopened(JSON.stringify([KNOWN_AND_SET]));

    expect(store.notes().quarantined).toHaveLength(1);
    expect(store.notes().droppedKeys).toEqual([]);
    expect(store.settings()).toEqual(DEFAULT_CODER_SETTINGS);
  });

  it("is still quarantined when a key it knows holds a value it cannot read", async () => {
    // **The rule the tolerance must not weaken, and the line it is drawn on: prune keys, refuse values.**
    // `keepTranscripts` is a key this build has; `"yes"` is not a boolean and there is no honest reading
    // of it. Guessing at a control plane's own configuration is worse than the defaults plus a sentence.
    //
    // **The mutation this fails on:** making the prune also coerce or strip *invalid* known keys — e.g.
    // deleting every key whose schema validation fails, or `z.coerce.boolean()`. Either would take this
    // file's four good settings, keep them, and silently reinterpret the fifth.
    const { store } = await reopened(JSON.stringify({ ...KNOWN_AND_SET, keepTranscripts: "yes" }));
    const [note] = store.notes().quarantined;

    expect(note?.file).toContain("settings.json");
    expect(store.settings()).toEqual(DEFAULT_CODER_SETTINGS);
  });

  it("is still quarantined when a required key is missing entirely", async () => {
    // The other half of "wrong-shaped": the document is not a settings document because the things every
    // settings document has are not in it. There is nothing to fall back to field by field, and inventing
    // a value for `defaults` would be the pane's own defect (`docs/settings-parity.md` §7.1) in a new
    // place. The mutation this fails on is defaulting missing object fields instead of refusing them.
    const { store } = await reopened(
      JSON.stringify({ requireApprovalForDestructive: true, keepTranscripts: true }),
    );

    expect(store.notes().quarantined).toHaveLength(1);
    expect(store.settings()).toEqual(DEFAULT_CODER_SETTINGS);
  });

  it("is not rescued by adding a key to `RETIRED_SETTINGS_KEYS`, because nothing depends on the list", async () => {
    // **The property the report asked for, asserted directly:** the list must stop being load-bearing. A
    // key that is *not* on it is dropped and everything else kept, in exactly the same way a listed key
    // is. The only difference is the sentence, and that difference is asserted by name in
    // `settings-notes.test.ts` — so if a future slice deletes the constant entirely, every line of this
    // test still passes and only the wording changes.
    //
    // **The mutation this fails on:** restoring any dependence on membership — a `if (!RETIRED.has(key))
    // return refuse()` guard, or a prune that only removes keys the list names. Both leave
    // `zzNeverShippedByUs` in the document and, with the schema still `.strict()`, quarantine the file.
    const { store } = await reopened(JSON.stringify({ ...KNOWN_AND_SET, zzNeverShippedByUs: [1] }));

    expect(store.notes().quarantined).toEqual([]);
    expect(store.settings().language).toBe("ko");
    expect(store.notes().droppedKeys[0]?.keys).toEqual([
      { path: "zzNeverShippedByUs", retired: false },
    ]);
  });
});
