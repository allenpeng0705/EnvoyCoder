/**
 * The settings bar: the list of sections, and the same list rendered as a page when there is no room
 * for a column beside the content.
 *
 * ## One registry, two renderings — and neither of them is a second navigation
 *
 * `state/settings-sections.ts` owns the sections. The bar renders one `<button>` per section, the
 * sections-list page renders one `SettingNavRow` per section, and both take their labels from the
 * registry's own catalogue keys. There is no `activeSection` state anywhere: the marked item comes from
 * **the scope the pane is on** (`scopeSection`), and pressing an item hands a scope to the shell
 * (`scopeForSection`) — the same `onNavigate(scope)` callback every other row in this pane already uses.
 * A second, parallel navigation would be a second thing that can say the user is somewhere they are not.
 *
 * ## The breakpoint, and why it is 1100 rather than a rounder number
 *
 * The bar is a 216px column. The content beside it is the window minus the rail (300px at its default),
 * and a settings row is a sentence beside a control: as the content narrows, the *sentence* wraps into
 * more lines while the control keeps its width, which is what "squeezed" means on this surface. That is
 * measurable, so it was measured — `npm run ui:audit --click Settings --size WxH` probes this surface now,
 * and the widest row measured 71px at 1440, 88 at 1280 and 1200, 105 at 1140 and 1100, 123 at 1090 and
 * 1060, 140 at 1024 and 192 at 960. The crossing between a three-line sentence (105px) and four lines or
 * more sits at **1100**, so that is the query. The same table is in `docs/settings-parity.md` §7.5.
 *
 * Below it the bar is not squeezed into a sliver: **the list becomes the page**, which is the hierarchy
 * this pane already had one level down — a page of rows, each opening a page with a back control that
 * names where it goes. Nothing is hidden and nothing is unreadable; the same registry rendered as
 * content instead of beside it, and measured there every row is 54px at the full width of the pane.
 *
 * The query is on the **viewport** rather than on the pane's own box, and the trade is deliberate: a
 * container query would know about the rail, but the rail is togglable and this query is a statement
 * about the *narrow* case ("is there room for two readable columns at all"). Being one size conservative
 * costs a user nothing — with the rail hidden there is more room than the query assumed, and the bar is
 * still rendered.
 */

import type { JSX } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Project } from "@envoycoder/protocol";

import { useI18n } from "../i18n/context.js";
import type { Translator } from "../i18n/translate.js";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
  type SettingsSectionId,
} from "../state/settings-sections.js";
import type { SettingsLayout, SettingsScope } from "../state/settings-scope.js";
import { scopeForSection } from "../state/settings-scope.js";
import { SettingNavRow } from "./SettingsRows.js";

/**
 * The viewport query the layout is decided by — **the number is measured, not chosen** (see the module
 * doc). Exported so a test can assert the pane honours it, and so the measurement and the code cannot
 * drift apart.
 */
export const WIDE_LAYOUT_QUERY = "(min-width: 1100px)";

/**
 * Is there room for the bar beside the content?
 *
 * **Wide when nothing can answer.** jsdom has no `matchMedia`, and neither does any other non-browser
 * renderer; the bar is the *addition* to the layout this pane already had, so the fallback is the
 * richer layout rather than a degraded one — a test that wants the narrow layout says so by stubbing
 * the query (or, through the pane, by passing the layout the shell resolved).
 */
export function useSettingsLayout(): SettingsLayout {
  const read = (): SettingsLayout => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "wide";
    return window.matchMedia(WIDE_LAYOUT_QUERY).matches ? "wide" : "narrow";
  };
  const [layout, setLayout] = useState<SettingsLayout>(read);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_LAYOUT_QUERY);
    const onChange = (): void => setLayout(query.matches ? "wide" : "narrow");
    // The value can have changed between the first render and this effect.
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return layout;
}

/**
 * How many projects, in words — the second band of the Projects item, wherever it is rendered.
 *
 * Three keys rather than one interpolated `{count} projects`, because "1 projects" and "0 projects" are
 * the two forms every language gets wrong and neither is fixable by a formatter the catalogue does not
 * have: a translator needs "1 project" and "No projects" as sentences of their own, and Japanese and
 * Korean do not pluralise at all. The zero form is a sentence rather than a number with a noun after it
 * for the same reason the empty state is: "No projects" is what a person says.
 */
export function projectsCount(
  t: Translator["t"],
  count: number,
  unavailable?: string | undefined,
): string {
  // The list could not be read: a number is a claim this window cannot make, and the honest band is the
  // one that says so. (`unavailable` is the shell's own sentence about the same list — this band needs a
  // short form of it, and the full sentence plus the reason are on the Projects page.)
  if (count === 0 && unavailable !== undefined) return t("settings.projects.count.unknown");
  if (count === 0) return t("settings.projects.count.none");
  if (count === 1) return t("settings.projects.count.one");
  return t("settings.projects.count", { count });
}

/** The bands of a section's row: the name of the place, and what is inside it. */
function bands(
  t: Translator["t"],
  section: SettingsSection,
  projects: readonly Project[],
  unavailable?: string | undefined,
): { title: string; detail: string } {
  return {
    title: t(section.titleKey),
    detail:
      section.band.kind === "projects"
        ? // A count is a claim about the list, so the band is four strings rather than one template:
          // see `projectsCount`.
          projectsCount(t, projects.length, unavailable)
        : t(section.band.key),
  };
}

export interface SettingsNavProps {
  /** Which item is current — read from the scope, never held here. `undefined` on the sections list. */
  current: SettingsSectionId | undefined;
  onNavigate: (scope: SettingsScope) => void;
  projects: readonly Project[];
  projectsUnavailable?: string | undefined;
}

/**
 * The bar.
 *
 * ## Keyboard behaviour, which is the part that is easy to fake
 *
 * Every item is a real `<button>`: Enter and Space activate it because the browser does that for a
 * button, not because this component listens for a key. What this component *does* add is **one tab
 * stop for the whole bar** (roving `tabIndex`: the current item is `0`, the rest are `-1`) plus the four
 * arrow keys, Home and End moving focus inside it. A tab stop per section would put eight stops between
 * the rail and the page a user asked for; a bar with no arrow keys would make them tab through eight
 * items to reach the last one.
 *
 * The roving index follows the current section, and it is *state* here rather than a prop because it is
 * about focus rather than about navigation: moving focus with an arrow key must not open a section,
 * which is the behaviour a user expects from a list of links.
 */
export function SettingsNav(props: SettingsNavProps): JSX.Element {
  const { t } = useI18n();
  const items = SETTINGS_SECTIONS;
  const currentIndex = items.findIndex((section) => section.id === props.current);
  const [focused, setFocused] = useState(currentIndex >= 0 ? currentIndex : 0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // The tab stop follows the section the pane is on — after a back control, or after a press on a
  // different item — so the bar is where a keyboard user left it.
  useEffect(() => {
    if (currentIndex >= 0) setFocused(currentIndex);
  }, [currentIndex]);

  const move = useCallback((next: number): void => {
    setFocused(next);
    buttons.current[next]?.focus();
  }, []);

  const onKeyDown = (event: { key: string; preventDefault: () => void }, index: number): void => {
    const last = items.length - 1;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        move(index === last ? 0 : index + 1);
        return;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        move(index === 0 ? last : index - 1);
        return;
      case "Home":
        event.preventDefault();
        move(0);
        return;
      case "End":
        event.preventDefault();
        move(last);
        return;
      default:
        return;
    }
  };

  return (
    <nav className="settings-nav" aria-label={t("settings.nav.aria")}>
      <ul className="settings-nav__list">
        {items.map((section, index) => {
          const { title, detail } = bands(t, section, props.projects, props.projectsUnavailable);
          const isCurrent = section.id === props.current;
          return (
            <li key={section.id}>
              <button
                type="button"
                // The link, not the whole row: `aria-current="page"` is what says "you are here", and it
                // is a value the platform announces rather than a word we would have to translate.
                {...(isCurrent ? { "aria-current": "page" as const } : {})}
                className={`settings-nav__item${isCurrent ? " settings-nav__item--current" : ""}`}
                // The name is the place, exactly as `SettingNavRow` names its rows: a screen-reader user
                // navigating a list of places wants the places, and the second band is a caption. It is
                // still visible text, and the hover title carries it for a pointer.
                aria-label={title}
                title={detail}
                tabIndex={index === focused ? 0 : -1}
                ref={(node) => {
                  buttons.current[index] = node;
                }}
                onFocus={() => setFocused(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
                onClick={() => props.onNavigate(scopeForSection(section.id))}
              >
                <span className="settings-nav__label">{title}</span>
                <span className="settings-nav__detail">{detail}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The same registry as rows on a page — what a narrow window opens on, and what the back control from a
 * section returns to.
 *
 * A `SettingNavRow` rather than a bar item, because this *is* a page of rows: the bands are the pane's
 * own (`setting__title` over `setting__detail`), the whole row is the control, and the accessible name
 * is the destination's own title — the shape the projects page already uses for its rows.
 */
export function SettingsSectionRows(props: Omit<SettingsNavProps, "current">): JSX.Element {
  const { t } = useI18n();
  return (
    <ul className="settings__sections">
      {SETTINGS_SECTIONS.map((section) => {
        const { title, detail } = bands(t, section, props.projects, props.projectsUnavailable);
        return (
          <li key={section.id}>
            <SettingNavRow
              title={title}
              detail={detail}
              // The developer fact: the section's own id, which is the string the scope, the registry and
              // a bug report all use for this place.
              developerNote={section.id}
              // The destination's own title, so the row announces where it goes rather than only what it
              // shows — one name for one place, the rule the project rows already follow.
              actionLabel={title}
              onSelect={() => props.onNavigate(scopeForSection(section.id))}
            />
          </li>
        );
      })}
    </ul>
  );
}
