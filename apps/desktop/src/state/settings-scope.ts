/**
 * Which settings the pane is showing — **as data**, and with the one rule that decides where a scope
 * lands when the thing it names is no longer there.
 *
 * ## Why the scope is a value rather than a project plus a flag
 *
 * The pane has three levels now: this machine's settings, the list of projects, and one project's
 * defaults. The first version of the third level was reached by a `project?: Project` prop, and the
 * difference between "this machine's settings" and "this project's" was the *presence* of that prop —
 * which is a boolean with a payload welded to it. Two things follow, and both were bugs rather than
 * style:
 *
 *   * **A third level is not expressible.** `project === undefined` can mean "the app scope" or "the
 *     projects page", and a type that cannot tell them apart makes the second one silently render the
 *     first. The union below makes every level a case a `switch` has to answer.
 *   * **A `Project` object is a snapshot, and this pane writes.** A project's `defaults` **replace**
 *     rather than merge (`daemon/store.ts`), so a pane holding the object it was handed at click time
 *     writes the values it is not changing back from that snapshot — change the model, then the agent,
 *     and the model is gone. The scope therefore holds the project's **id**, and every render resolves
 *     it against the live list. `settings-scope.test.tsx` fails on the snapshot.
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
 * project they meant. (And the projects page is where they most likely came from: the only other
 * route in is the rail's project menu, so the fallback is either "one level up" or "the level above
 * the one you are on" — both of which are places that list projects, which is the thing the vanishing
 * project belonged to.)
 *
 * Falling back **uniformly**, rather than by remembering which route the user took, is deliberate for
 * the same reason the two routes into a project's settings are one function: an answer that depends on
 * where the user came from is a second piece of state, and a second piece of state is a second thing
 * that can disagree with the screen.
 *
 * ## What this file is not
 *
 * No history, no breadcrumb stack, no deep link. Three levels in one pane do not need a stack: the
 * only way down is one row, the only way up is one back control, and where each goes is a constant
 * here rather than something a component computes.
 */

import type { Project } from "@envoycoder/protocol";

/**
 * Which level the pane is on.
 *
 * `kind` rather than three optional fields for the reason in the module doc: a union that a `switch`
 * has to exhaust is a union no level can be forgotten in, and `{ kind: "projects" }` — a page with no
 * project and no app scope — cannot be confused with "no project, so show the app's".
 */
export type SettingsScope =
  /** This machine's settings: the root of this navigation, with nothing above it. */
  | { readonly kind: "app" }
  /** The list of projects — the level between this machine's settings and one project's. */
  | { readonly kind: "projects" }
  /** One project's defaults, held by **id** so the live list is what the pane reads. */
  | { readonly kind: "project"; readonly id: string };

/** The root. A constant rather than a factory: it carries nothing, so every caller can share it. */
export const APP_SCOPE: SettingsScope = { kind: "app" };

/** The projects page. Shared for the same reason, and it is the fallback below. */
export const PROJECTS_SCOPE: SettingsScope = { kind: "projects" };

/** One project's settings, by id. */
export function projectScope(id: string): SettingsScope {
  return { kind: "project", id };
}

/**
 * Where a scope actually lands, given the projects that exist **right now**.
 *
 * The only scope that can fail to resolve is the one that names a project, and it resolves to the
 * projects page — the back control's destination. `app` and `projects` are returned unchanged, as the
 * same object, so a caller may compare them by identity.
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
