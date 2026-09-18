/**
 * The settings sections — **as data**, because the bar, the list and the gate all have to agree.
 *
 * ## Why this is a registry and not eight `<li>`s
 *
 * The pane used to be one scrolling column with four headings. Adding a bar to it makes the same
 * question arrive from three directions at once: the bar renders the sections, the sections-list page
 * renders the same sections as rows, and a test has to be able to say *"every section in the bar has
 * something behind it"*. Three renderings and one list is a registry; three renderings and three lists
 * is a set of three things that drift.
 *
 * ## There is no `live: false`, on purpose
 *
 * The owner's brief for this work names eleven sections from the reference product and warns about the
 * failure mode in the same sentence: *"an eleven-item bar of empty pages is the failure mode, not the
 * goal."* A section you can add to the bar **and** mark "not live" is that failure wearing a flag — the
 * bar would list it, and the flag would be the thing everyone forgets to read.
 *
 * So a section exists here only by naming **what is in it**: `content` is required and non-empty, and
 * each entry is a `{ file, needle }` citation in the shape `test/settings-coverage.test.ts` already
 * uses for "this setting reaches something". `test/settings-nav.test.tsx` re-reads every citation
 * against the file, **and** renders every section and refuses one whose body has no row in it. Adding a
 * section with nothing behind it therefore fails in two independent ways, and neither of them is a
 * reviewer's memory.
 *
 * ## What a section's keys are, and the one-name rule
 *
 * `titleKey` is the name of **one place**: it is the bar item's label, the page's own title, the
 * section row's label on the sections-list page and the label of the back control on any page below
 * it — the same rule the projects page already follows (`settings.projects.title` is one string used
 * three times). `detailKey` is the second band: what a user finds inside, one sentence, shown in the
 * bar and in the list so a user does not have to open a section to know whether it is the one they
 * want.
 *
 * **`titleKey` is a catalogue key, not a string.** A section whose name is hardcoded English is a
 * German window with one English word in it, and `i18n.test.ts` can only see keys.
 *
 * @see docs/settings-parity.md §7.6 — the sections we ship, and the reference product's sections we
 * deliberately do not, each with the audit's verdict for it.
 */

import type { MessageKey } from "../i18n/messages/en.js";

/** The sections this pane has. Adding one is a change to this union, the page switch and this file. */
export type SettingsSectionId =
  | "general"
  | "tasks"
  | "safety"
  | "agents"
  | "llm"
  | "projects"
  | "shortcuts"
  | "machine"
  | "pairing"
  | "about";

/**
 * One thing that backs a section — the source a reader can open to check that it is not empty.
 *
 * Deliberately the same shape as `test/settings-coverage.test.ts`'s `ReadSite`: a repo-relative path
 * and the text that must still be in it. Two gates in this repo already ask "is this citation still
 * true", and a third one asking it the same way is a habit rather than an invention.
 */
export interface SettingsSectionContent {
  /** Repository-relative, forward-slashed. */
  readonly file: string;
  /** The source text that must still be there. */
  readonly needle: string;
  /** What the reader should expect to find, so a stale citation can be judged rather than guessed. */
  readonly because: string;
}

/**
 * What a row's **second band** says about a section.
 *
 * A discriminated union rather than a `detailKey` string, because one section's second band is not a
 * sentence at all: **Projects** shows *how many are registered*, which is four catalogue keys of its own
 * (and a number nobody can hardcode into a template in seven languages). A plain `detailKey` would have
 * to be either absent — making every reader handle a missing field for one section — or a key whose
 * value the bar ignores, which is a field that lies about being read.
 */
export type SettingsSectionBand =
  /** A sentence from the catalogue: what is inside, written once. */
  | { readonly kind: "sentence"; readonly key: MessageKey }
  /** How many projects are registered — `projectsCount` in `SettingsNav.tsx` renders it. */
  | { readonly kind: "projects" };

export interface SettingsSection {
  readonly id: SettingsSectionId;
  /** This place's name, in the catalogue — see the module doc. */
  readonly titleKey: MessageKey;
  /** The second band: what is inside. */
  readonly band: SettingsSectionBand;
  /** What is in it. Required and non-empty: see the module doc. */
  readonly content: readonly SettingsSectionContent[];
}

/**
 * The sections, in the order the bar shows them.
 *
 * The order is the question a user arrives with, most-settled-first: what this app does by default,
 * what a new task starts with, what an agent may do without asking, what the agents on this machine
 * can actually do, how a phone reaches it, which folders this machine works in, what the keyboard
 * does, what this window is attached to, and which build it is. Mobile pairing sits above Projects
 * because pairing is how another device reaches this machine — a setup step, not a project default.
 * The reference product's order is not copied: its host sections are a per-machine fleet surface we
 * do not have (§5 of `docs/settings-parity.md`).
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "general",
    titleKey: "settings.section.general.title",
    band: { kind: "sentence", key: "settings.section.general.detail" },
    content: [
      {
        file: "apps/desktop/src/components/settings/SectionsControls.tsx",
        needle: 't("settings.language.title")',
        because: "the language select is the first row of this section",
      },
      {
        file: "apps/desktop/src/components/settings/SectionsControls.tsx",
        needle: 't("settings.defaultPath.title")',
        because: "and the folder `Add project` starts in is the second",
      },
    ],
  },
  {
    id: "tasks",
    titleKey: "settings.section.tasks.title",
    band: { kind: "sentence", key: "settings.section.tasks.detail" },
    content: [
      {
        file: "apps/desktop/src/components/settings/SectionsControls.tsx",
        needle: 't("settings.defaultHarness.title")',
        because: "the agent a new task starts with",
      },
      {
        file: "apps/desktop/src/components/settings/SectionsControls.tsx",
        needle: 't("settings.defaultModel.title")',
        because: "the model, and the agent's extra argv beside it — three controls, one question",
      },
    ],
  },
  {
    id: "safety",
    titleKey: "settings.section.safety.title",
    band: { kind: "sentence", key: "settings.section.safety.detail" },
    content: [
      {
        file: "apps/desktop/src/components/settings/SectionsControls.tsx",
        needle: "settings.requireApprovalForDestructive",
        because: "the approval row, wired to the stored value — the row the first settings slice exists for",
      },
      {
        file: "apps/desktop/src/components/settings/SettingsRowParts.tsx",
        needle: 't("settings.approvals.title")',
        because: "and the row itself, which is disabled-with-reason for an agent that cannot be told",
      },
      {
        file: "apps/desktop/src/components/settings/SectionsControls.tsx",
        needle: 't("settings.transcripts.title")',
        because: "and what is kept on disk after a task ends",
      },
    ],
  },
  {
    id: "agents",
    titleKey: "settings.section.agents.title",
    band: { kind: "sentence", key: "settings.section.agents.detail" },
    content: [
      {
        file: "apps/desktop/src/components/settings/SectionsAgents.tsx",
        needle: "rowVerdict(",
        because:
          "each agent's row carries one verdict — Ready or Not ready — projected from the measurement the " +
          "daemon had already taken, so a user learns a state without pressing anything. The five measured " +
          "states stay on the wire as evidence and are turned into words in exactly one place " +
          "(`agent-verdict.ts`), which is what keeps a row from growing a status vocabulary again",
      },
      {
        file: "apps/desktop/src/components/settings/SectionsAgents.tsx",
        needle: "<FactsBlock facts={facts} />",
        because:
          "and everything that is a *property* rather than a verdict — its capabilities, the modes, models " +
          "and thinking levels it published, and when EnvoyDev last verified them — lives in the " +
          "disclosure as plain facts, with a time, instead of as a chip on the row's face",
      },
      {
        file: "apps/desktop/src/components/settings/CatalogRows.tsx",
        needle: "availability: entry.availability",
        because:
          "the catalogue's rows take their verdict from the daemon's own measurement — resolved for every " +
          "row when the list is served, with nothing started and nothing downloaded, which is why there is " +
          "no *Check* button on this page and no 'not checked yet' state for a row to be in",
      },
      {
        file: "apps/desktop/src/components/settings/CatalogRows.tsx",
        needle: "agents.addProvider(addInputFor(entry))",
        because:
          "and adding one sends the entry's own command, arguments, environment names, dialect and the " +
          "catalogue reference, so no screen invents a dialect `coder.addProvider` would then store and no " +
          "screen sends a *value* — the reference is what the daemon resolves the recipe's constants from",
      },
    ],
  },
  {
    id: "llm",
    titleKey: "settings.section.llm.title",
    band: { kind: "sentence", key: "settings.section.llm.detail" },
    content: [
      {
        file: "apps/desktop/src/components/settings/EnvoyLlmPanel.tsx",
        needle: 't("settings.agents.envoyLlm.baseUrl")',
        because: "the base URL is the first of the three fields on this page",
      },
      {
        file: "apps/desktop/src/components/settings/EnvoyLlmPanel.tsx",
        needle: 't("settings.agents.envoyLlm.model")',
        because: "the model string is the second",
      },
      {
        file: "apps/desktop/src/components/settings/EnvoyLlmPanel.tsx",
        needle: 't("settings.agents.envoyLlm.apiKey")',
        because: "and the write-only API key is the third",
      },
    ],
  },
  {
    id: "pairing",
    titleKey: "settings.section.pairing.title",
    band: { kind: "sentence", key: "settings.section.pairing.detail" },
    content: [
      {
        file: "apps/desktop/src/components/settings/PairingSection.tsx",
        needle: "mintPairingCode(props.agents,",
        because:
          "QR and host:port both mint through `PairPhone.tsx`'s shared call site, so the palette, the rail's " +
          "QR button and this page cannot produce three codes by three routes",
      },
      {
        file: "apps/desktop/src/components/settings/PairingSection.tsx",
        needle: "data-manual-result",
        because:
          "the host:port route shows its own short token after a form mint, never the QR's long secret",
      },
      {
        file: "apps/desktop/src/components/settings/PairPhone.tsx",
        needle: "coder.mintPairing",
        because: "the shared module itself, which the section reuses rather than reimplements",
      },
    ],
  },
  {
    id: "projects",
    titleKey: "settings.projects.title",
    // Not a sentence: the band says **how many** projects are registered (`projectsCount`).
    band: { kind: "projects" },
    content: [
      {
        file: "apps/desktop/src/components/settings/SectionsProjects.tsx",
        needle: "<SettingNavRow",
        because: "one row per registered project, each opening that project's own settings",
      },
      {
        file: "apps/desktop/src/components/settings/SectionsProjects.tsx",
        needle: 't("settings.projects.empty"',
        because: "and the teaching empty state for a machine with no projects yet",
      },
    ],
  },
  {
    id: "shortcuts",
    titleKey: "settings.section.shortcuts.title",
    band: { kind: "sentence", key: "settings.section.shortcuts.detail" },
    content: [
      {
        file: "apps/desktop/src/components/settings/SectionsFacts.tsx",
        needle: "registry.display(binding.id)",
        because: "every row is a binding the keyboard layer is actually listening for",
      },
      {
        file: "apps/desktop/src/components/settings/SectionsFacts.tsx",
        needle: "binding.labelKey",
        because: "named through the catalogue rather than through the table's English",
      },
    ],
  },
  {
    id: "machine",
    titleKey: "settings.section.machine.title",
    band: { kind: "sentence", key: "settings.section.machine.detail" },
    content: [
      {
        file: "apps/desktop/src/components/settings/SectionsFacts.tsx",
        needle: "hello.stateDir",
        because: "the state folder, read from the daemon's own hello answer",
      },
      {
        file: "apps/desktop/src/components/settings/SectionsFacts.tsx",
        needle: "hello.windowCount",
        because: "and how many windows are attached to it, which is a number no chip can hold",
      },
    ],
  },
  {
    id: "about",
    titleKey: "settings.section.about.title",
    band: { kind: "sentence", key: "settings.section.about.detail" },
    content: [
      {
        file: "apps/desktop/src/components/settings/SectionsFacts.tsx",
        needle: "APP_VERSION",
        because: "the build this window's own files came from",
      },
      {
        file: "apps/desktop/src/components/settings/SectionsFacts.tsx",
        needle: "hello.version",
        because: "compared with the daemon's, which is the row that needs a control plane at all",
      },
    ],
  },
];

/**
 * The section the window opens on, when the layout shows a page rather than the list.
 *
 * It is the first entry of the registry rather than a string of its own: a second place naming a
 * section is a second place that can name one that is not there.
 */
export const DEFAULT_SECTION_ID: SettingsSectionId = SETTINGS_SECTIONS[0]!.id;

/** The registry entry for an id. Total, because the ids come from the union. */
export function sectionById(id: SettingsSectionId): SettingsSection {
  const found = SETTINGS_SECTIONS.find((section) => section.id === id);
  // Unreachable through the type, and a `throw` rather than a fallback: a section that renders some
  // *other* section's page is the defect this pane is being rebuilt to remove.
  if (found === undefined) throw new Error(`no settings section named ${id}`);
  return found;
}

/** Is this string a section id? For the one place an id arrives as a string at runtime. */
export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}
