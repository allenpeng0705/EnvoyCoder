/**
 * The language setting, and the sections bar, as a user meets them.
 *
 * ## What this proves that `i18n.test.ts` cannot
 *
 * That file proves the catalogues and the lookup. This one proves the **rows**: that the setting the
 * daemon stores is the one on screen, that the options are the family's seven in their own language,
 * and that picking one asks the daemon to store it (`onUpdate`). It also renders the whole pane inside a
 * German provider, which is the cheapest available proof that the context actually reaches a component
 * that is not the app shell — a provider mounted around `CoderApp` is invisible to a component rendered
 * on its own, and "the pane is English while the rail is German" is exactly the half-translated window
 * this milestone exists to prevent. And since the sections bar landed, it is the proof that the bar's
 * own names are translated: eight section names are rendered here in German, one per bar item, so a
 * section that ships with an English title fails a test rather than a user's screen.
 *
 * ## What moved when the pane became sections, and what did not
 *
 * The pane used to be one scrolling column with four headings, so this file could assert *all* of it in
 * one render: the language row, the agents list, the Projects group and the daemon's notes were on the
 * same page. A section is a page now, so each assertion moved to the page it is about — **none were
 * dropped**: the language rows are asserted on *General*, the Projects row and its count band on the bar
 * (where the row lives now) and on the *Projects* page, and the notes are asserted where they have
 * always been rendered but now from every page (they are facts about the file the daemon read, not about
 * the scope being shown).
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings } from "@envoydev/protocol";

import { CoderSidebar } from "../src/components/CoderSidebar.js";
import { describeStoreNotes } from "../src/daemon/service.js";
import { SettingsPane } from "../src/components/SettingsPane.js";
import type { AgentActions } from "../src/state/agent-actions.js";
import { I18nProvider } from "../src/i18n/context.js";
import { wiredBindings, type ShortcutActions } from "../src/input/shortcuts.js";
import type { CoderState } from "../src/state/coderStore.js";
import {
  PROJECTS_SCOPE,
  SECTIONS_SCOPE,
  appScope,
  projectScope,
  type SettingsScope,
} from "../src/state/settings-scope.js";
import { SETTINGS_SECTIONS } from "../src/state/settings-sections.js";

afterEach(cleanup);

const settings: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "de",
};

/**
 * The keys the shell mounts actions for, which is what the Shortcuts page lists.
 *
 * The same five ids `CoderApp` wires (`shortcutActions` there); declared here as data so this file does
 * not have to render the shell to test the pane's own translation of them.
 */
const WIRED: ShortcutActions = {
  "commandCenter.open": () => {},
  "search.find": () => {},
  newTask: () => {},
  "settings.open": () => {},
  "sidebar.toggle": () => {},
};

function stateWith(over: Partial<CoderState> = {}): CoderState {
  return {
    connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
    resolved: undefined,
    hello: {
      product: "EnvoyDev",
      version: "0.1.0",
      instanceId: "test",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyDev",
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
    providers: [],
  catalog: [],
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
  scope: SettingsScope = appScope("general"),
) {
  const onUpdate = vi.fn();
  // Required by `SettingsPaneProps`: this file asserts that language changes reach every string, so its
  // bundle answers nothing — see the doc on `noAgentActions` in `settings-nav.test.tsx`.
  const noAgentActions: AgentActions = {
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
      signInAgent: vi.fn(),
  } as unknown as AgentActions;
  render(
    <I18nProvider preference={preference} reported={["en-US"]}>
      <SettingsPane
        state={stateWith(over)}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        // Which scope the pane is on: one section by default, and the parameter is what lets the
        // assertions below render the list of sections, the projects page or a project's own page.
        scope={scope}
        // The window's shape. **Wide**, because that is the layout with the bar in it, and the bar is
        // what most of the assertions below are about; a narrow window renders the same registry as the
        // page instead (`settings-nav.test.tsx` walks that one).
        layout="wide"
        // The bindings the shell mounted — see `WIRED`.
        shortcuts={wiredBindings(WIRED)}
        // The pane's own navigation, which is required rather than optional: a caller that renders a row
        // without a destination is a control that presses into nothing. This test is about wording, so
        // the destination is a stub — `settings-nav.test.tsx` and `settings-scope.test.tsx` are where the
        // navigation itself is asserted, through the shell that owns it.
        onNavigate={vi.fn()}
        agents={noAgentActions}
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

describe("the sections bar, in the same language", () => {
  /** The pane's German section names, in the order the registry puts them. */
  const GERMAN_SECTIONS = [
    "Allgemein",
    "Neue Aufgaben",
    "Sicherheit",
    "Agenten",
    "Projekte",
    "Tastenkürzel",
    "Dieser Computer",
    "Über",
  ];

  it("names every section in German, one bar item each", () => {
    // **One German name per section, asserted from the rendered bar** — the assertion a section with a
    // hardcoded English title cannot pass, and the reason `KeyBinding` and the registry carry catalogue
    // keys rather than sentences.
    renderPane();
    const nav = screen.getByRole("navigation", { name: "Bereiche der Einstellungen" });
    expect(within(nav).getAllByRole("button")).toHaveLength(GERMAN_SECTIONS.length);
    for (const label of GERMAN_SECTIONS) {
      expect(within(nav).getByRole("button", { name: label })).toBeTruthy();
    }
    // The registry itself is the list the bar renders, so the two orders agree or this fails.
    expect(SETTINGS_SECTIONS).toHaveLength(GERMAN_SECTIONS.length);
  });

  it("is German too — one window, one language", () => {
    renderPane();
    // The section's own name is the pane's title, and it is the same German word as the bar item above.
    expect(screen.getByRole("heading", { name: "Allgemein" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Schließen" })).toBeTruthy();
    // The section's sentence is in the bar on a wide window (its second band), and on the page itself on
    // a narrow one — printed once either way, which is asserted here and again in `settings-nav.test.tsx`.
    const nav = screen.getByRole("navigation", { name: "Bereiche der Einstellungen" });
    expect(
      within(nav).getByText("Die Sprache dieses Fensters und der Ordner, in dem ein neues Projekt startet."),
    ).toBeTruthy();
    // **Once.** The bar carries the sentence and the page does not repeat it; a `getAllByText` of two
    // would be the same sentence rendered twice in one view, which is the thing `showsBar` prevents.
    expect(
      screen.getAllByText("Die Sprache dieses Fensters und der Ordner, in dem ein neues Projekt startet."),
    ).toHaveLength(1);
    // The Projects item's second band is a count, and even that sentence is translated.
    expect(screen.getByRole("button", { name: "Projekte" }).getAttribute("title")).toBe("Keine Projekte");
  });

  it("translates the page an agent's facts are on", () => {
    // The agents list used to be a block on the one settings page; it is a page of its own now, and its
    // empty state is still a sentence rather than an empty box.
    renderPane({}, "de", appScope("agents"));
    expect(screen.getByRole("heading", { name: "Agenten" })).toBeTruthy();
    expect(screen.getByText("Die Agentenliste ist noch nicht angekommen.")).toBeTruthy();
  });

  it("translates the list of sections, which is what a narrow window opens on", () => {
    renderPane({}, "de", SECTIONS_SCOPE);
    expect(screen.getByRole("heading", { name: "Einstellungen" })).toBeTruthy();
    expect(screen.getByText(/Bereich für Bereich/)).toBeTruthy();
    // Every section is reachable as a row here as well as from the bar, and each row is named in German.
    for (const label of GERMAN_SECTIONS) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("is German on the projects page too, back control included", () => {
    // **The level the earlier restructure added, in the language this file exists for.** Two things are
    // worth more than the prose: the sentences that moved here from the app scope (the override note and
    // the empty state, both of them German), and the back control — which must name *its* destination,
    // so it says "Alle Einstellungen" here and something else at the level below.
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
    // Two buttons say "Projekte" on this page — the bar's own item, marked current, and the back
    // control — so the back control is asserted where it is: in the pane's header.
    const back = screen.getByRole("button", { name: "Projekte", current: false }) as HTMLButtonElement;
    expect(back.getAttribute("title")).toBe("Zurück zur Projektliste");
    expect(screen.getByRole("button", { name: "Projekte", current: "page" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Alle Einstellungen" })).toBeNull();
  });

  it("translates the keyboard page's own rows, which are the table's keys", () => {
    // The bindings' labels used to be English strings nothing rendered. A page that renders them is why
    // they are catalogue keys, and this is the assertion that says so.
    renderPane({}, "de", appScope("shortcuts"));
    expect(screen.getByRole("heading", { name: "Tastenkürzel" })).toBeTruthy();
    expect(screen.getByText("Neue Aufgabe")).toBeTruthy();
    expect(screen.getByText("Befehlspalette öffnen")).toBeTruthy();
    // The combos themselves are not translated — a key is a key.
    expect(screen.getByText("Ctrl+K")).toBeTruthy();
  });
});

describe("the rest of the pane, in the same language", () => {
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
    renderPane({ settings: { ...settings, language: "ja" } }, "ja", appScope("general"));
    expect(screen.getByRole("heading", { name: "一般" })).toBeTruthy();
    expect(screen.getByLabelText("言語")).toBeTruthy();
  });

  it("renders a daemon note through its key when it sent one", () => {
    // The startup notes are the daemon's sentences, and the ones it can key are rendered in the
    // user's language like everything else — the diagnostic reason stays as it came. They are rendered
    // from every page since the sections landed: a quarantined projects.json is worth reading while
    // looking at any of them.
    renderPane({
      notes: [
        'EnvoyDev could not read projects.json, so it moved it aside to /tmp/x and started that list empty. (bad json) [envoydev.key] {"key":"note.quarantined.moved","values":{"name":"projects.json","movedTo":"/tmp/x","reason":"bad json"}}',
      ],
    });
    expect(screen.getByText("Wissenswertes")).toBeTruthy();
    expect(screen.getByText(/projects\.json/)).toBeTruthy();
    expect(screen.getByText(/bad json/)).toBeTruthy();
    expect(screen.queryByText(/\[envoydev\.key\]/)).toBeNull();
  });

  it("says a dropped settings key in the user's language, not in the daemon's English", () => {
    // **The other kind of note, and the reason it is a *key* rather than a diagnostic line.** When the daemon
    // reads a settings file with a key this build does not have it drops the key and reports it — and that
    // report is the only thing standing between a user and a line in their own file that does nothing. So it
    // has to be readable, which the quarantine lines above deliberately are not (their reason is a schema
    // validator's message, and translating one would produce a German sentence wrapped around English
    // identifiers).
    //
    // **The note is built by the daemon's own function**, not written out here. That is the whole point of
    // this case: a hand-written note string tests `localizeText`, which the case above it already covers, and
    // it would stay green if `describeStoreNotes` stopped attaching a key — which is the failure being guarded
    // against. Verified by mutation: replacing the `keyed(...)` wrapper with a bare string leaves this case
    // green when the note is written by hand, and takes it red when the note comes from `describeStoreNotes`.
    const [note] = describeStoreNotes({
      quarantined: [],
      skipped: [],
      droppedKeys: [{ file: "settings.json", keys: [{ path: "hiddenAgents", retired: true }] }],
    });
    renderPane({ notes: note === undefined ? [] : [note] });
    expect(screen.getByText("Wissenswertes")).toBeTruthy();
    // German, named, and saying the half that matters: nothing else was lost.
    expect(screen.getByText(/diese Einstellung gibt es in diesem Build nicht mehr/)).toBeTruthy();
    expect(screen.getByText(/jede andere Einstellung behalten/)).toBeTruthy();
    expect(screen.queryByText(/no longer has/)).toBeNull();
    expect(screen.queryByText(/\[envoydev\.key\]/)).toBeNull();
  });
});
