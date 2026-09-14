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
 *   3. **A retired key does not cost the user their settings file.** `CoderSettingsSchema` is
 *      `.strict()` and an unreadable file is quarantined, so removing a field without a read-side
 *      strip would take an upgrading user's language, agent and nominated folder with it.
 *   4. **The app defaults actually reach a created task.** This is the wiring the pane's controls
 *      promise, asserted where it happens — `createTask` → `resolveTaskDefaults` — rather than where
 *      it is rendered.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CODER_SETTINGS } from "@envoycoder/protocol";
import { coderPaths, type CoderPaths } from "@envoycoder/host-bridge";

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
  const home = await mkdtemp(join(tmpdir(), "envoycoder-settings-"));
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

describe("a settings file written by an older build", () => {
  it("is read, not quarantined, when the only thing wrong with it is a key we retired", async () => {
    // `allowRemoteRuns` was removed by settings slice 1 because nothing read it. The file it left behind
    // is one this build understands *perfectly* apart from that key, so `withoutRetiredSettingsKeys`
    // strips it before the strict schema sees it. Without that, the quarantine path would take the
    // user's language, their default agent and their nominated folder to discard one dead value.
    const home = await mkdtemp(join(tmpdir(), "envoycoder-retired-"));
    const paths = coderPaths(home);
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    await CoderStore.open({ paths });
    await writeFile(
      paths.settingsFile,
      JSON.stringify({
        defaultProjectPath: "/Users/you/work",
        defaults: { harness: "deepseek-harness" },
        requireApprovalForDestructive: false,
        allowRemoteRuns: false,
        keepTranscripts: true,
        language: "ko",
      }),
      "utf8",
    );

    const store = await CoderStore.open({ paths });
    expect(store.notes().quarantined).toEqual([]);
    expect(store.settings().language).toBe("ko");
    expect(store.settings().defaultProjectPath).toBe("/Users/you/work");
    expect(store.settings().defaults.harness).toBe("deepseek-harness");
    expect(store.settings().requireApprovalForDestructive).toBe(false);
    // And the key itself is not resurrected anywhere the window could render it.
    expect(Object.keys(store.settings())).not.toContain("allowRemoteRuns");
  });

  it("is still quarantined when it holds something this build genuinely cannot read", async () => {
    // The rule the strip must not weaken: a key we know about is dropped, and a key we do not is still
    // the reason to move the bytes aside rather than overwrite them.
    const home = await mkdtemp(join(tmpdir(), "envoycoder-unknown-"));
    const paths = coderPaths(home);
    cleanups.push(async () => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    await CoderStore.open({ paths });
    await writeFile(
      paths.settingsFile,
      JSON.stringify({ ...DEFAULT_CODER_SETTINGS, somethingNobodyDefined: true }),
      "utf8",
    );

    const store = await CoderStore.open({ paths });
    const [note] = store.notes().quarantined;
    expect(note?.file).toContain("settings.json");
    expect(store.settings().language).toBe(DEFAULT_CODER_SETTINGS.language);
  });
});
