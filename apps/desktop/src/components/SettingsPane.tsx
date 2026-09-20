/**
 * Settings: **four scopes in one pane**, and a bar that lists the sections of the first of them.
 *
 * ## What this pane is for, and the rule that shapes every row
 *
 * Every control here either does what it says or says why it cannot. That sounds like a low bar and it
 * is the bar this pane failed: it shipped with five controls of which **two stored a preference nothing
 * read** — `requireApprovalForDestructive` (the approvals were unconditional) and `allowRemoteRuns`
 * (there is no remote path to gate) — beside three more fields the app read with no control writing
 * them (`defaults.model`, `defaults.extraArgs`, `defaultProjectPath`). `docs/settings-parity.md` §7.1 is
 * the inventory of that, §8.1 is the work, and `apps/desktop/test/settings-coverage.test.ts` is the gate
 * that keeps it from coming back.
 *
 * So the three honest answers to "can we honour this?" each have a shape here:
 *
 *   * **wired** — schema → store → effect → control. The default agent, the default model, the extra
 *     arguments and the folder "Add project…" starts in are all read at a named site, and each is
 *     asserted where its *effect* happens rather than where it is rendered: `test/settings-store.test.ts`
 *     for the app defaults reaching a created task, `test/settings-scope.test.tsx` for a project's,
 *     `test/palette-flow.test.tsx` for the seeded folder, and four cases in `test/runs.test.ts` for the
 *     approvals policy reaching the agent. That list is the reason this bullet can be believed, so it is
 *     kept exhaustive rather than illustrative.
 *   * **disabled with the reason** — "Ask before anything destructive" is delivered through the agent's
 *     own `session/set_policy`, which `envoy-harness` implements and `deepseek-harness` does not. When
 *     the default agent is one that cannot be told, the row is **disabled and says so**, naming it. A
 *     live switch there would be a preference the user believes is in force and no agent ever hears.
 *   * **removed** — `allowRemoteRuns` is gone, control and field together. Its effect could not exist
 *     (there is no remote-run path, and `coder.offerRemoteRun` had no handler), and a disabled row would
 *     have been a promise to build one on this pane's terms rather than the mesh's.
 *
 * ## The bar, and the sections it lists
 *
 * `state/settings-sections.ts` is the registry: the sections this product can actually fill, each naming
 * the source that backs it. The bar renders it, the root page renders the same registry as rows, and
 * `test/settings-nav.test.tsx` refuses a section whose citation is stale and a section that renders
 * nothing. **A section with nothing in it cannot be added to the bar without failing that test**, which
 * is the property the owner's brief asks for: *"an eleven-item bar of empty pages is the failure mode,
 * not the goal."* The sections we do **not** have — the reference product's terminals, plugins, account
 * providers and the rest — are absent rather than empty, and §7.6 of `docs/settings-parity.md` records
 * each one with the audit's verdict and the reason. **Device pairing is not on that list any more**: it
 * is `PairingSection`, reached from the bar's *Pairing* item, the rail's QR button and the palette.
 *
 * ## Three scopes below the sections, and what separates them
 *
 * | level | page | reached from | back control |
 * |---|---|---|---|
 * | 0 | *Settings* — the list of sections | the rail's footer button or `⌘,` on a narrow window | none: it is the root |
 * | 1 | one section | a bar item (wide), or a row of the list (narrow) | *← All settings*, the list |
 * | 2 | *Projects* — the list of projects | the **Projects** item | *← All settings*, the list |
 * | 3 | *Project settings for api* | a row of the projects list, or the rail's project `…` menu | *← Projects* |
 *
 * **Each back control names its destination**, and the two labels differ because the destinations do:
 * *All settings* is the list of every section, and *Projects* is the page a project's scope came from. A
 * single control labelled "All settings" that landed on a project's parent would be a lie of exactly the
 * kind this pane was rebuilt to remove.
 *
 * ## How the levels are wired together, which is one model and not two
 *
 * `settings-scope.ts` owns the state, and `CoderApp` holds one value of it: `SettingsScope | undefined`,
 * where `undefined` is "the pane is closed". This pane takes the scope as a prop together with **one**
 * callback (`onNavigate`) instead of a callback per destination — the bar's items use that same callback,
 * naming a section's scope exactly as a project row names a project's. There is no `activeSection` state
 * beside the scope: `scopeSection` derives the marked item from the scope, so the bar and the page cannot
 * disagree about where the user is.
 *
 * That leaves exactly two routes into a project's settings, the rail's project `…` menu (*"Project
 * settings"*) and a row of the projects page, both of which are the **same** function (`CoderApp`'s
 * `openProjectSettings`): the only arrangement in which they cannot come to mean different things.
 * `onNavigate` is a **required** prop: an optional one would allow a caller to render rows that press
 * into nothing, and this pane's entire history is a list of controls that did not do what they said.
 *
 * ## What happens when the project is gone, and why it is the projects page
 *
 * The pane resolves the scope against `state.projects` on **every render**, so a project removed while
 * its settings are open — in another window, or from its own `…` menu in this one — cannot leave the
 * pane showing rows that write to something that is not there. It lands on the **projects page**: the
 * level the project scope's own back control returns to, so the rule is the one sentence a user already
 * knows ("when the thing you are looking at disappears, the pane does what the back control would have
 * done"). `settings-scope.ts`'s module doc is the full argument.
 *
 * ## The window's shape, and why the pane is told rather than sniffing
 *
 * `layout` arrives as a prop from the shell (`useSettingsLayout`, one `matchMedia` query there and
 * nowhere else). A pane that measured itself would be a second answer to "is there room for a bar", and
 * two answers is one too many — the shell needs the same value to decide where *opening* settings lands
 * (`entryScope`). On a narrow window the pane simply renders no bar: the list of sections **is** the
 * page, which is the hierarchy this pane already had one level down.
 */

import type { JSX, ReactNode } from "react";

import type { CoderSettings, Project, TaskDefaults } from "@envoydev/protocol";

import type { AgentActions } from "../state/agent-actions.js";

import { useI18n } from "../i18n/context.js";
import type { WriteFailure } from "../i18n/notice.js";
import type { KeyBinding } from "../input/shortcuts.js";
import type { CoderState } from "../state/coderStore.js";
import {
  SECTIONS_SCOPE,
  PROJECTS_SCOPE,
  appScope,
  resolveScope,
  scopeProject,
  scopeSection,
  type SettingsLayout,
  type SettingsScope,
} from "../state/settings-scope.js";
import { sectionById, DEFAULT_SECTION_ID, type SettingsSectionId } from "../state/settings-sections.js";
import { SettingsNav, SettingsSectionRows } from "./SettingsNav.js";
import { SettingsShell, StoreNotes } from "./SettingsShell.js";
import { AboutSection, MachineSection, ShortcutsSection } from "./settings/SectionsFacts.js";
import { AgentsSection } from "./settings/SectionsAgents.js";
import { GeneralSection, SafetySection, TasksSection } from "./settings/SectionsControls.js";
import { PairingSection } from "./settings/PairingSection.js";
import { ServiceSection } from "./settings/SectionsService.js";
import { LlmSection } from "./settings/EnvoyLlmPanel.js";
import { ProjectSection, ProjectsSection } from "./settings/SectionsProjects.js";
import type { PairPhoneOutcome } from "./settings/PairPhone.js";

export interface SettingsPaneProps {
  state: CoderState;
  onClose: () => void;
  /** The app-scope patch. Ignored while the pane is open for a project. */
  onUpdate: (patch: Partial<CoderSettings>) => Promise<WriteFailure>;
  /**
   * Which scope the pane is showing — the sections list, one section, the projects page, or one
   * project's settings.
   *
   * Held by the shell (`CoderApp`) and resolved **here**, against `state.projects`, on every render. The
   * id in a `project` scope is what makes a second edit carry the first (`settings-scope.ts`), and
   * resolving it here rather than in the shell means there is one place that decides what an absent
   * project shows. A `Project` object in this position could do neither.
   */
  scope: SettingsScope;
  /** The shape of the window, resolved once by the shell — see the module doc. */
  layout: SettingsLayout;
  /**
   * The keyboard bindings the shell has **mounted an action for** (`wiredBindings`).
   *
   * Required rather than optional, on the same reasoning as `onNavigate`: a Shortcuts page with no
   * bindings would render as an empty list or, worse, as the whole table including three combos that do
   * nothing. The shell is the only thing that knows which actions exist, so it must say.
   */
  shortcuts: readonly KeyBinding[];
  /**
   * Go to another scope of this pane, by naming it.
   *
   * One callback rather than one per destination: a row or a bar item that goes somewhere says *where*,
   * as data, and this is what stores it. **Required, and not merely present** — an optional callback
   * would let a caller render the bar, or the list of sections, without a destination, which is the
   * defect this pane was rebuilt to remove.
   */
  onNavigate: (scope: SettingsScope) => void;
  /**
   * The daemon calls a **settings surface** is allowed to make — the agents page's, the pairing page's, the
   * LLM panel's and the service page's. See `AgentActions` for why this is an interface rather than the store,
   * and for why its historical name still carries the service calls.
   *
   * Required, on the same reasoning as `onNavigate`: the agents page is the screen this product is built
   * around, and a caller that could render it with no way to act would render four controls that do nothing
   * — which is the defect this whole pane was rebuilt to remove.
   */
  agents: AgentActions;
  /**
   * Write a project's defaults. Sent **whole** rather than as a patch, because a project's defaults
   * replace: a patch carrying only a model would leave the agent for that project undefined.
   */
  onUpdateProject?: ((defaults: TaskDefaults) => Promise<WriteFailure>) | undefined;
  /**
   * Why `state.projects` is empty for a reason other than "nobody has added one" — the shell's own
   * sentence, already in the user's language, or `undefined` when the list really is empty (or is still
   * arriving).
   *
   * **Optional, because it is data rather than a destination.** An absent destination is a control that
   * presses into nothing, which is why `onNavigate` is required; an absent reason simply means there is
   * no reason to give.
   */
  projectsUnavailable?: string | undefined;
  /**
   * A pairing code the shell has **already minted**, from the command palette's *Pair a phone* row or the
   * rail's QR button.
   *
   * Data rather than a destination, on the same rule as `projectsUnavailable`: absent means no code is
   * waiting, which is the state of every ordinary visit to these settings. `PairingSection` renders it and
   * says why the mint could not happen instead — the press is the request (`PairPhone.tsx`), so by the time
   * this pane is drawn the answer may already exist.
   */
  mintedPairing?: PairPhoneOutcome | undefined;
}

/**
 * The four scopes, chosen by the scope value.
 *
 * The `switch` is exhaustive on purpose: a fifth scope would not compile until it was answered here,
 * which is the property a boolean could not have.
 */
export function SettingsPane(props: SettingsPaneProps): JSX.Element {
  const resolved = resolveScope(props.scope, props.state.projects);
  switch (resolved.kind) {
    case "sections":
      // Wide windows keep the section bar as the permanent index — never the list-as-page (that would
      // duplicate the bar). Land on the default section instead; narrow still uses the list.
      if (props.layout === "wide") {
        return <SectionPage {...props} section={DEFAULT_SECTION_ID} />;
      }
      return <SectionsPage {...props} />;
    case "app":
      return <SectionPage {...props} section={resolved.section} />;
    case "projects":
      return <ProjectsPage {...props} />;
    case "project": {
      const project = scopeProject(resolved, props.state.projects);
      // `resolveScope` answers `project` only for an id the live list holds, so this fallback is
      // unreachable — and it falls back the *same way* rather than asserting, so a list that changed
      // between the two reads cannot crash a window.
      return project !== undefined ? (
        <ProjectPage {...props} project={project} />
      ) : (
        <ProjectsPage {...props} />
      );
    }
  }
}

/**
 * Is the section bar rendered beside this page?
 *
 * On a **wide** window the bar is always there: it is the permanent index of sections, and the body
 * shows whichever section (or projects drill-down) is selected. On a **narrow** window there is no
 * room for a column, so the list of sections *is* the page and the bar stays hidden.
 */
function showsBar(layout: SettingsLayout, _scope: SettingsScope): boolean {
  return layout === "wide";
}

/**
 * Every page renders through this: the frame, the bar when there is room for it and something to put in
 * it, and the daemon's own notes at the bottom.
 *
 * **The bar's marked item is derived here, from the scope** — never passed in as a choice. A caller that
 * could mark an item the scope does not name would be able to draw a bar that disagrees with the page
 * beside it, which is the failure mode of every settings pane that keeps a selection of its own.
 *
 * **The notes are in the frame rather than on a page.** They are facts about the file this daemon read,
 * not about the scope being shown — a quarantined `projects.json` is worth knowing while reading the
 * Projects page — so every page renders them identically, at the bottom, and no page offers a switch
 * that pretends to fix what they describe.
 */
function Page(
  props: SettingsPaneProps & {
    title: string;
    back?: { label: string; title: string; onClick: () => void };
  } & { children: ReactNode },
): JSX.Element {
  const { t } = useI18n();
  return (
    <SettingsShell
      title={props.title}
      // The pane's accessible name is the same words as its title: one place, one name.
      ariaLabel={props.title}
      state={props.state}
      onClose={props.onClose}
      {...(props.back !== undefined ? { back: props.back } : {})}
      {...(showsBar(props.layout, props.scope)
        ? {
            nav: (
              <SettingsNav
                // When a wide window somehow lands on `sections` (redirected to General above), still
                // mark the default section so the bar and the body agree.
                current={scopeSection(props.scope) ?? DEFAULT_SECTION_ID}
                onNavigate={props.onNavigate}
                projects={props.state.projects}
                {...(props.projectsUnavailable !== undefined
                  ? { projectsUnavailable: props.projectsUnavailable }
                  : {})}
              />
            ),
          }
        : {})}
    >
      {props.children}
      <StoreNotes notes={props.state.notes} />
    </SettingsShell>
  );
}

/* ────────────────────────── level 0: the list of sections ────────────────────────── */

/**
 * The root: the list of sections, as a page. What a narrow window opens on, and where every back control
 * below a section lands.
 *
 * It is the bar's own registry rendered as content rather than a second list: one row per section, the
 * same two bands, and each row opens a page whose back control returns here. There is no bar beside it —
 * see `showsBar` — because on this page the list *is* the index, and the same eight rows twice in one
 * view is not a layout, it is a duplicate. That is also why the pane's layout does not change what a row
 * does: the same scope, the same rows, the same destinations, whether the window has room for a column
 * or not.
 */
function SectionsPage(props: SettingsPaneProps): JSX.Element {
  const { t } = useI18n();
  return (
    <Page {...props} title={t("settings.title")}>
      <p className="settings__note">{t("settings.sections.note")}</p>
      <SettingsSectionRows
        onNavigate={props.onNavigate}
        projects={props.state.projects}
        {...(props.projectsUnavailable !== undefined
          ? { projectsUnavailable: props.projectsUnavailable }
          : {})}
      />
    </Page>
  );
}

/* ────────────────────────── level 1: one section ────────────────────────── */

/**
 * One section of this machine's settings.
 *
 * The `switch` below is the compile-time half of the registry's gate: adding a section id to
 * `SettingsSectionId` does not typecheck until it is answered here, so a section cannot exist in the bar
 * without a page. The runtime half is `test/settings-nav.test.tsx`, which renders each one and refuses a
 * body with no row in it.
 */
function SectionPage(props: SettingsPaneProps & { section: SettingsSectionId }): JSX.Element {
  const { t } = useI18n();
  const section = sectionById(props.section);
  const wide = showsBar(props.layout, props.scope);
  return (
    <Page
      {...props}
      title={t(section.titleKey)}
      // Wide: leave settings entirely (the bar already lists every section). Narrow: back to the
      // sections list, which is the only index that window has.
      back={
        wide
          ? {
              label: t("settings.exit"),
              title: t("settings.exit.title"),
              onClick: () => props.onClose(),
            }
          : {
              label: t("settings.back"),
              title: t("settings.back.title"),
              onClick: () => props.onNavigate(SECTIONS_SCOPE),
            }
      }
    >
      {/* **The section's own sentence, printed once.** It is the bar item's second band when there is a
          bar, and the page's first line when there is not — one sentence for one place, rendered in the
          one place that can show it. Printing it in both would be the same sentence twice in the same
          view, which is noise rather than information, and a page that started with its own caption
          beside a bar that already says it is exactly what a reader skips.
          A section whose band is data rather than a sentence (Projects) renders nothing here at all:
          its scope is the projects page, and that page carries its own note. */}
      {!wide && section.band.kind === "sentence" ? (
        <p className="settings__note">{t(section.band.key)}</p>
      ) : null}
      {sectionBody(props)}
    </Page>
  );
}

/** The pages, one arm each. Exhaustive: a new section id is a compile error until it is here. */
function sectionBody(props: SettingsPaneProps & { section: SettingsSectionId }): ReactNode {
  switch (props.section) {
    case "general":
      return <GeneralSection state={props.state} onUpdate={props.onUpdate} agents={props.agents} />;
    case "tasks":
      return <TasksSection state={props.state} onUpdate={props.onUpdate} agents={props.agents} />;
    case "safety":
      return <SafetySection state={props.state} onUpdate={props.onUpdate} agents={props.agents} />;
    case "agents":
      return (
        <AgentsSection
          state={props.state}
          onUpdate={props.onUpdate}
          agents={props.agents}
          onOpenLlm={() => props.onNavigate(appScope("llm"))}
        />
      );
    case "llm":
      return <LlmSection agents={props.agents} />;
    case "shortcuts":
      return (
        <ShortcutsSection
          state={props.state}
          onUpdate={props.onUpdate}
          agents={props.agents}
          shortcuts={props.shortcuts}
        />
      );
    case "machine":
      return <MachineSection state={props.state} onUpdate={props.onUpdate} agents={props.agents} />;
    case "pairing":
      return (
        <PairingSection
          state={props.state}
          onUpdate={props.onUpdate}
          agents={props.agents}
          {...(props.mintedPairing !== undefined ? { mintedPairing: props.mintedPairing } : {})}
        />
      );
    case "service":
      // The one page whose value lives in the operating system rather than in a settings file: the row reads
      // the supervisor's own answer and can only offer the presses that answer allows. See `SectionsService`.
      return <ServiceSection state={props.state} onUpdate={props.onUpdate} agents={props.agents} />;
    case "about":
      return <AboutSection state={props.state} onUpdate={props.onUpdate} agents={props.agents} />;
    // The Projects section is not a page of rows at level 1: its page *is* the list of projects, one
    // level down, and the bar item opens that instead. The arm exists so the switch stays total, and it
    // renders what the bar item promises rather than a second, emptier Projects page.
    case "projects":
      return <ProjectsSection {...props} projects={props.state.projects} />;
  }
}

/* ────────────────────────── level 2: the projects page ────────────────────────── */

/**
 * The list of registered projects — the page the **Projects** item opens.
 *
 * It is navigation and only navigation: a project's own controls live at level 3, because a control that
 * edits a project while the pane is titled *Projects* is a control labelled with a scope it does not
 * have.
 */
function ProjectsPage(props: SettingsPaneProps): JSX.Element {
  const { t } = useI18n();
  const wide = showsBar(props.layout, props.scope);
  return (
    <Page
      {...props}
      title={t("settings.projects.title")}
      back={
        wide
          ? {
              label: t("settings.exit"),
              title: t("settings.exit.title"),
              onClick: () => props.onClose(),
            }
          : {
              label: t("settings.back"),
              title: t("settings.back.title"),
              onClick: () => props.onNavigate(SECTIONS_SCOPE),
            }
      }
    >
      <ProjectsSection {...props} projects={props.state.projects} />
    </Page>
  );
}

/* ────────────────────────── level 3: one project ────────────────────────── */

function ProjectPage(props: SettingsPaneProps & { project: Project }): JSX.Element {
  const { t } = useI18n();
  return (
    <Page
      {...props}
      title={t("settings.project.title", { project: props.project.label })}
      // The way back, and the reason it is in the header rather than at the end of the rows: the scope
      // was entered *from* the list of projects (the row that named this project, or the rail's project
      // menu), so leaving it belongs where the pane says where you are. It names its destination —
      // **"Projects"**, the level-2 page's own title, not "All settings" and not "Back" — because
      // "All settings" here would be a lie: it lands on the list, not on the root. Reusing the page's
      // title as the label is the same rule the project rows follow for their accessible names.
      back={{
        label: t("settings.projects.title"),
        title: t("settings.project.back.title"),
        onClick: () => props.onNavigate(PROJECTS_SCOPE),
      }}
    >
      <ProjectSection {...props} projects={props.state.projects} project={props.project} />
    </Page>
  );
}
