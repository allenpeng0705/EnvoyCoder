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

import type { CoderSettings } from "@envoydev/protocol";

import type { WriteFailure } from "../../i18n/notice.js";
import type { AgentActions } from "../../state/agent-actions.js";
import type { CoderState } from "../../state/coderStore.js";

export interface SettingsSectionProps {
  /** Everything the window knows: settings, agents, projects, the daemon's own answer. */
  state: CoderState;
  /**
   * The app-scope patch. Every section page writes through this and nothing else.
   *
   * **It answers with the write's outcome** rather than swallowing it. A refusal has to be read where the press
   * was, and the only place a settings write is pressed is a row — so the page hands this promise to that row's
   * `write` and the row renders the answer under its own control. Nothing about a failure is raised app-wide
   * (`CoderStore.mutate` states the rule), so a row that dropped this answer would be a control that silently
   * does nothing, which is the one thing this pane is built not to ship.
   */
  onUpdate: (patch: Partial<CoderSettings>) => Promise<WriteFailure>;
  /**
   * The daemon calls every settings surface may make, as one bundle.
   *
   * Required rather than optional, for the rule this whole pane is built on: a control that presses into
   * nothing is worse than no control at all. An optional bundle would let a caller render the agents page
   * with no way to add, measure or sign in an agent — and every button on it would look like it worked.
   *
   * It used to carry a fifth, `setAgentHidden`, and the count is the point of the sentence: the page has no
   * way to take an agent out of a list, so it cannot be handed one. See `AgentActions` for what is left —
   * pairing, the LLM panel and the daemon service are rows of this same pane and live in the same bundle.
   */
  agents: AgentActions;
}
