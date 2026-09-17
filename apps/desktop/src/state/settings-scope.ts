/**
 * Which settings the pane is showing — **as data**, and with the one rule that decides where a scope
 * lands when the thing it names is no longer there.
 *
 * ## The four scopes
 *
 * | scope | what it is | reached from | back control |
 * |---|---|---|---|
 * | `sections` | the list of sections — the root of this navigation | the rail's footer button on a narrow window | none: it is the root |
 * | `app` + a section id | one section of this machine's settings | a bar item, a row of the sections list, or the rail's footer button on a wide window | *All settings*, the list |
 * | `projects` | the list of registered projects | the **Projects** item in the bar | *All settings*, the list |
 * | `project` + an id | one project's defaults | a row of the projects page, or the rail's project `…` menu | *Projects*, the list |
 *
 * ## Why the scope is a value rather than a project plus a flag
 *
 * The third level was reached by a `project?: Project` prop, and the difference between "this machine's
 * settings" and "this project's" was the *presence* of that prop — a boolean with a payload welded to
 * it. Two things follow, and both were bugs rather than style:
 *
 *   * **A level is not expressible.** `project === undefined` could mean "the app scope" or "the
 *     projects page", and a type that cannot tell them apart makes the second one silently render the
 *     first. The union below makes every level a case a `switch` has to answer — which is how the
 *     fourth and fifth scopes were added without touching any of the three that were already there.
 *   * **A `Project` object is a snapshot, and this pane writes.** A project's `defaults` **replace**
 *     rather than merge (`daemon/store.ts`), so a pane holding the object it was handed at click time
 *     writes the values it is not changing back from that snapshot — change the model, then the agent,
 *     and the model is gone. The scope therefore holds the project's **id**, and every render resolves
 *     it against the live list. `settings-scope.test.tsx` fails on the snapshot.
 *
 * ## The bar is this model, not a second one beside it
 *
 * A section is a scope, so a bar item is a row that names where it goes and the shell stores it — the
 * same `onNavigate(scope)` callback every other row in this pane already uses. There is no
 * `activeSection` state beside the scope, and no separate "open a section" path: `scopeSection` answers
 * which item is current by *reading* the scope, so the bar and the page cannot disagree about where the
 * user is.
 *
 * ## One rule, and it is the back control's own answer
 *
 * A project can go away while its settings are open — removed in another window, or removed from its
 * own `…` menu in this one. The pane must land somewhere, and it lands on the **projects page**: the
 * level the project scope's own back control returns to. So the rule is one sentence, and it is the
 * sentence a user already knows — *when the thing you are looking at disappears, the pane does what
 * the back control would have done.*
 *
 * The alternative, falling back to this machine's settings, was rejected because it **loses the
 * user's place**: the project scope is about a *project*, and the page that is about projects is the
 * projects page. Going to the app scope instead skips a whole level — the user ends up reading this
 * machine's defaults, two levels from where they were, with no list in front of them to pick the
 * project they meant. (And the projects page is where they most likely came from.)
 *
 * Falling back **uniformly**, rather than by remembering which route the user took, is deliberate for
 * the same reason the two routes into a project's settings are one function: an answer that depends on
 * where the user came from is a second piece of state, and a second piece of state is a second thing
 * that can disagree with the screen.
 *
 * ## What this file is not
 *
 * No history, no breadcrumb stack, no deep link. Four levels in one pane do not need a stack: the only
 * way down is one row, the only way up is one back control, and where each goes is a constant here
 * rather than something a component computes.
 */

import type { Project } from "@envoydev/protocol";

import { DEFAULT_SECTION_ID, type SettingsSectionId } from "./settings-sections.js";

/**
 * The shape of the window the pane is being rendered into.
 *
 * It decides exactly one thing — which scope *opening* settings lands on — and nothing else. A narrow
 * window has no room for a bar beside the content, so the bar's own list is the page it lands on; a
 * wide one has the bar already, so landing on the list would be a page of links to the bar beside it.
 * That is a fact about the window, not about what the user was doing, which is why it is not the
 * "remember where they came from" state the module doc above refuses.
 */
export type SettingsLayout = "wide" | "narrow";

/** Which level the pane is on. */
export type SettingsScope =
  /** The list of sections — the root, and the page a narrow window opens on. */
  | { readonly kind: "sections" }
  /** One section of this machine's settings, by id. */
  | { readonly kind: "app"; readonly section: SettingsSectionId }
  /** The list of projects — the level between this machine's settings and one project's. */
  | { readonly kind: "projects" }
  /** One project's defaults, held by **id** so the live list is what the pane reads. */
  | { readonly kind: "project"; readonly id: string };

/** The root: the list of sections. Shared because it carries nothing. */
export const SECTIONS_SCOPE: SettingsScope = { kind: "sections" };

/** The projects page. Shared for the same reason, and it is the fallback below. */
export const PROJECTS_SCOPE: SettingsScope = { kind: "projects" };

/** One section of this machine's settings. */
export function appScope(section: SettingsSectionId): SettingsScope {
  return { kind: "app", section };
}

/** One project's settings, by id. */
export function projectScope(id: string): SettingsScope {
  return { kind: "project", id };
}

/**
 * Where opening settings lands, given the window it will be rendered into.
 *
 * On a wide window the bar is beside the content, so opening settings shows the **first section** —
 * the list of sections is already on screen, in the bar, and a page with one row per bar item beside
 * the bar is a page of links to the thing next to it. On a narrow one there is no bar, so the list
 * *is* the page and the first section is one press away.
 */
export function entryScope(layout: SettingsLayout): SettingsScope {
  return layout === "wide" ? appScope(DEFAULT_SECTION_ID) : SECTIONS_SCOPE;
}

/**
 * The scope a section's own row goes to — the inverse of `scopeSection`, and the one place that
 * mapping lives.
 *
 * Every section is a scope, but one of them is not an *app* scope: **Projects** is the list of
 * registered projects, which is a page of its own with a back control of its own, reached from the bar
 * exactly like the others. Keeping the two directions of the mapping in one file is what stops the bar
 * and `scopeSection` from disagreeing about which item a project's scope belongs to.
 */
export function scopeForSection(section: SettingsSectionId): SettingsScope {
  return section === "projects" ? PROJECTS_SCOPE : appScope(section);
}

/**
 * Which bar item is current for a scope, or `undefined` when the pane is on the sections list.
 *
 * The bar reads this rather than holding a selection of its own. One value decides both the marked
 * item and the rendered page, so they cannot come apart — and a project's scope marks **Projects**,
 * because that is the page it came from and the page its back control returns to.
 */
export function scopeSection(scope: SettingsScope): SettingsSectionId | undefined {
  switch (scope.kind) {
    case "app":
      return scope.section;
    case "projects":
    case "project":
      return "projects";
    case "sections":
      return undefined;
  }
}

/**
 * Where a scope actually lands, given the projects that exist **right now**.
 *
 * The only scope that can fail to resolve is the one that names a project, and it resolves to the
 * projects page — the back control's destination. Every other scope is returned unchanged, as the same
 * object, so a caller may compare them by identity.
 */
export function resolveScope(scope: SettingsScope, projects: readonly Project[]): SettingsScope {
  if (scope.kind !== "project") return scope;
  return projects.some((project) => project.id === scope.id) ? scope : PROJECTS_SCOPE;
}

/**
 * The id a write from this scope belongs to, or `undefined` when the scope is not about a project
 * that exists.
 *
 * The shell uses this to address `coder.updateProject`. It is deliberately *not* "the id the scope
 * holds": a scope that named a project which has since gone must not write to it, and a write to a
 * removed project fails for a control the user never pressed.
 */
export function scopeProjectId(
  scope: SettingsScope,
  projects: readonly Project[],
): string | undefined {
  const resolved = resolveScope(scope, projects);
  return resolved.kind === "project" ? resolved.id : undefined;
}

/** The live project a scope names, or `undefined`. The pane renders from this, never from a snapshot. */
export function scopeProject(
  scope: SettingsScope,
  projects: readonly Project[],
): Project | undefined {
  return scope.kind === "project"
    ? projects.find((project) => project.id === scope.id)
    : undefined;
}
