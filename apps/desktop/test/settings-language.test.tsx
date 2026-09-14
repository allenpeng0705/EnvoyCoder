/**
 * The language setting, as a user meets it.
 *
 * ## What this proves that `i18n.test.ts` cannot
 *
 * That file proves the catalogues and the lookup. This one proves the **row**: that the setting the
 * daemon stores is the one on screen, that the options are the family's seven in their own language,
 * and that picking one asks the daemon to store it (`onUpdate`). It also renders the whole pane
 * inside a German provider, which is the cheapest available proof that the context actually reaches
 * a component that is not the app shell — a provider mounted around `CoderApp` is invisible to a
 * component rendered on its own, and "the pane is English while the rail is German" is exactly the
 * half-translated window this milestone exists to prevent.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings } from "@envoycoder/protocol";

import { CoderSidebar } from "../src/components/CoderSidebar.js";
import { SettingsPane } from "../src/components/SettingsPane.js";
import { I18nProvider } from "../src/i18n/context.js";
import type { CoderState } from "../src/state/coderStore.js";
import {
  APP_SCOPE,
  PROJECTS_SCOPE,
  projectScope,
  type SettingsScope,
} from "../src/state/settings-scope.js";

afterEach(cleanup);

const settings: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "de",
};

function stateWith(over: Partial<CoderState> = {}): CoderState {
  return {
    connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
    resolved: undefined,
    hello: {
      product: "EnvoyCoder",
      version: "0.1.0",
      instanceId: "test",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyCoder",
      startedAt: "2026-09-14T00:00:00.000Z",
      windowCount: 1,
      methods: [],
      mesh: { kind: "no-node" },
      notes: [],
    },
    projects: [],
    tasks: [],
    // A window that finished loading: the task list came from the daemon, so the rail may say a
    // project has none. See `CoderState.tasksKnown`.
    tasksKnown: true,
    settings,
    harnesses: [],
    mesh: { kind: "no-node", reason: "" },
    runs: {},
    loaded: true,
    error: undefined,
    notes: [],
    ...over,
  };
}

function renderPane(
  over: Partial<CoderState> = {},
  preference: "system" | "de" | "ja" = "de",
  scope: SettingsScope = APP_SCOPE,
) {
  const onUpdate = vi.fn();
  render(
    <I18nProvider preference={preference} reported={["en-US"]}>
      <SettingsPane
        state={stateWith(over)}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        // Which level of the pane: this machine's settings by default, and the parameter is what lets the
        // level-2 assertions below render the page the row opens.
        scope={scope}
        // The pane's own navigation, which is required rather than optional: a caller that renders the
        // Projects row without a destination is a control that presses into nothing. This test is about
        // the language, so the destination is a stub — `settings-scope.test.tsx` is where the levels are
        // asserted through the shell that owns them.
        onNavigate={vi.fn()}
      />
    </I18nProvider>,
  );
  return { onUpdate };
}

describe("the language row", () => {
  it("shows the language the daemon stored, not a default of its own", () => {
    renderPane();
    const select = screen.getByLabelText("Sprache") as HTMLSelectElement;
    expect(select.value).toBe("de");
    // Endonyms: a German user looking for German reads "Deutsch", not "German".
    const options = [...select.options].map((option) => option.textContent);
    expect(options).toContain("Deutsch");
    expect(options).toContain("日本語");
    // …and the family's seven, plus the "follow the machine" preference.
    expect(options).toHaveLength(8);
  });

  it("asks the daemon to store the choice, because the daemon is what sends the refusals", () => {
    const { onUpdate } = renderPane();
    fireEvent.change(screen.getByLabelText("Sprache"), { target: { value: "ja" } });
    expect(onUpdate).toHaveBeenCalledWith({ language: "ja" });
  });

  it("falls back to `system` when the daemon has stored nothing yet", () => {
    // An older settings file, or a daemon that answered before the migration. `system` is what the
    // daemon will apply, so it is what the row must show.
    const { language, ...withoutLanguage } = settings;
    void language;
    renderPane({ settings: withoutLanguage });
    expect((screen.getByLabelText("Sprache") as HTMLSelectElement).value).toBe("system");
  });
});

describe("the rest of the pane, in the same language", () => {
  it("is German too — one window, one language", () => {
    renderPane();
    expect(screen.getByText("Einstellungen")).toBeTruthy();
    expect(screen.getByText("Agenten auf diesem Computer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Schließen" })).toBeTruthy();
    // The harness list is empty in this fixture, and even that sentence is translated.
    expect(screen.getByText("Die Agentenliste ist noch nicht angekommen.")).toBeTruthy();
    // …including the Projects group, whose two sentences *moved one level down* in this restructure: the
    // section is a single row here now (its second band is the count, and this fixture has no projects),
    // and the sentence that says how a project gets here is on the page the row opens. The heading and the
    // row are asserted where they are; the sentences that moved are asserted on level 2 below, which is
    // where they now live — nothing was dropped, and nothing stayed asserting a block that is gone.
    expect(screen.getByRole("heading", { name: "Projekte" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Projekte" })).toBeTruthy();
    expect(screen.getByText("Keine Projekte")).toBeTruthy();
  });

  it("is German on the projects page too, back control included", () => {
    // **The level the restructure added, in the language this file exists for.** Two things are worth more
    // than the prose: the sentences that moved here from level 1 (the override note and the empty state,
    // both of them German), and the back control — which must name *its* destination, so it says
    // "Alle Einstellungen" here and something else at the level below.
    renderPane({ projects: [] }, "de", PROJECTS_SCOPE);
    expect(screen.getByRole("heading", { name: "Projekte" })).toBeTruthy();
    expect(
      screen.getByText("Jedes Projekt kann die Einstellungen dieses Computers überschreiben. Wenn du eines auswählst, öffnest du seine eigenen."),
    ).toBeTruthy();
    expect(screen.getByText(/Noch keine Projekte\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Alle Einstellungen" })).toBeTruthy();
    // The rail's own Add-project label is interpolated, translated, so the sentence points at a German word
    // that is actually on screen.
    expect(screen.getByText(/unten in der Projektleiste hinzu/)).toBeTruthy();

    cleanup();

    // And level 3, whose back control must **not** say the same thing: it returns to the list, so it is
    // labelled with the list's own German title, and its hover sentence is German as well.
    renderPane(
      { projects: [{ id: "local::/work/api", path: "/work/api", label: "api", hostId: "local", addedAt: "2026-09-01T09:00:00.000Z" }] },
      "de",
      projectScope("local::/work/api"),
    );
    expect(screen.getByRole("heading", { name: "Projekteinstellungen für api" })).toBeTruthy();
    const back = screen.getByRole("button", { name: "Projekte" });
    expect(back.getAttribute("title")).toBe("Zurück zur Projektliste");
    expect(screen.queryByRole("button", { name: "Alle Einstellungen" })).toBeNull();
  });

  it("leaves no English in the rail or the pane either", () => {
    // The owner's criterion, taken literally: *"we cannot give a German UI with English errors"* —
    // and the same applies to the rail and the pane, which are read far more often than an error.
    // Two surfaces rendered through the same provider is what makes this a test of the wiring rather
    // than of one component.
    render(
      <I18nProvider preference="de" reported={["en-US"]}>
        <CoderSidebar
          projects={[
            {
              id: "local::/Users/dev/work/envoymesh",
              path: "/Users/dev/work/envoymesh",
              label: "envoymesh",
              hostId: "local",
              addedAt: "2026-09-01T09:00:00.000Z",
              defaults: { harness: "envoy-harness" },
            },
          ]}
          tasks={[
            {
              id: "w1",
              projectId: "local::/Users/dev/work/envoymesh",
              cwd: "/Users/dev/work/envoymesh",
              title: "Wire product attach into the new node service",
              harness: "envoy-harness",
              status: "needs-attention",
              createdAt: "2026-09-13T10:00:00.000Z",
              updatedAt: "2026-09-13T10:42:00.000Z",
            },
          ]}
          onSelect={vi.fn()}
          onNewTask={vi.fn()}
          onAddProject={vi.fn()}
          onOpenProjectSettings={vi.fn()}
          onRemoveProject={vi.fn()}
          onRenameTask={vi.fn()}
          onRemoveTask={vi.fn()}
          onOpenCommandCenter={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </I18nProvider>,
    );

    // German where a label is ours…
    expect(screen.getByText("Aufgaben")).toBeTruthy();
    expect(screen.getByText("Braucht deine Antwort")).toBeTruthy();
    expect(screen.getByText("1 Aufgabe braucht dich")).toBeTruthy();
    // …and no English left over. These are the sentences that were hard-coded before this work.
    expect(screen.queryByText("Tasks")).toBeNull();
    expect(screen.queryByText("Needs your answer")).toBeNull();
    expect(screen.queryByText("1 task needs you")).toBeNull();
    expect(screen.queryByText("No projects yet")).toBeNull();
    // The agent's own name is not ours to translate, and it is still there — on the project header
    // and again on the row, hence "all".
    expect(screen.getAllByText("Envoy Harness").length).toBeGreaterThan(0);
  });

  it("takes the language from the provider, not from a module-level default", () => {
    renderPane({ settings: { ...settings, language: "ja" } }, "ja");
    expect(screen.getByText("設定")).toBeTruthy();
    expect(screen.getByLabelText("言語")).toBeTruthy();
  });

  it("renders a daemon note through its key when it sent one", () => {
    // The startup notes are the daemon's sentences, and the ones it can key are rendered in the
    // user's language like everything else — the diagnostic reason stays as it came.
    renderPane({
      notes: [
        'EnvoyCoder could not read projects.json, so it moved it aside to /tmp/x and started that list empty. (bad json) [envoycoder.key] {"key":"note.quarantined.moved","values":{"name":"projects.json","movedTo":"/tmp/x","reason":"bad json"}}',
      ],
    });
    expect(screen.getByText("Wissenswertes")).toBeTruthy();
    expect(screen.getByText(/projects\.json/)).toBeTruthy();
    expect(screen.getByText(/bad json/)).toBeTruthy();
    expect(screen.queryByText(/\[envoycoder\.key\]/)).toBeNull();
  });
});
