/**
 * What every section page is handed — the shape the pane's switch gives all of them.
 *
 * One interface for eight pages, because they are one thing seen eight ways: each is a page of this
 * machine's settings, rendered by the same shell, writing through the same patch. A page that needed
 * something else would be a page that is not a settings section, and the type is where that shows up.
 *
 * It lives below both `SettingsPane` and the section modules so that the pane can import the pages
 * without any of them importing the pane — a cycle in a set of files is how the *destination* of a
 * navigation becomes unanswerable at runtime, which is the class of defect this whole restructure is
 * about.
 */

import type { CoderSettings } from "@envoycoder/protocol";

import type { CoderState } from "../../state/coderStore.js";

export interface SettingsSectionProps {
  /** Everything the window knows: settings, agents, projects, the daemon's own answer. */
  state: CoderState;
  /** The app-scope patch. Every section page writes through this and nothing else. */
  onUpdate: (patch: Partial<CoderSettings>) => void;
}
