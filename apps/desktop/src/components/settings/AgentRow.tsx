/**
 * **One agent, as a row** — the shape every list on the Agents page is built from.
 *
 * ## The anatomy, and the budget behind each band
 *
 * ```
 *   [state chip]  Name                                   [action]  [Details ▸]
 *   the one actionable line
 *   ── disclosed: everything the row is not allowed to print ──
 * ```
 *
 * | band | what belongs in it |
 * |---|---|
 * | **the name** | the agent's own name, and nothing else. What it *is* goes in the name's `title` |
 * | **the state chips** | the state a probe measured, plus the terse verdicts (`No approvals`, `Temporary copy`). One or two words each, because a chip is a word |
 * | **the one line** | the actionable fact — the command to run, or the short phrase naming what to do. ≤ `AGENT_ROW_LINE_BUDGET` |
 * | **the action** | the one thing a user can do to this row |
 * | **the disclosure** | the agent's own published facts, the recipe's command line, the whole of a fix sentence, the install link. `Details` is the label; there is no cap inside, because that is where explanations are *supposed* to live |
 *
 * ## Why one component and not three similar lists
 *
 * The page has three lists — the nine agents we ship, the ones a user declared, and the thirty-eight recipes
 * — and before this file each rendered its own `<li>` with its own arrangement of chips, summary lines and
 * hints. They had already drifted: the catalogue's head was one line and the shipped agents' was a stack, so
 * the same three facts measured 58px on one list and 155px on another. One component is what makes "a row is
 * a name, a state and one line" a property of the *page* rather than of whichever list was written last.
 *
 * ## The disclosure is a `<button>` and not a `<details>`
 *
 * `aria-expanded` on a button is the same contract with one difference that matters here: the label stays put
 * and reads the same in both states, so a row does not reflow when it opens and the label a screen reader
 * announced is still the label on screen. The panel is rendered only when open, so nothing below the fold
 * pays for a closed row's contents.
 */

import type { JSX, ReactNode } from "react";

import { useState } from "react";

import { useI18n } from "../../i18n/context.js";

export interface AgentRowProps {
  /** The word in the state chip, already translated. */
  stateLabel: string;
  /** The chip's colour class — `ROW_STATE_CHIP[state]`, passed in rather than re-derived. */
  stateChip: string;
  /** The agent's name. */
  name: string;
  /**
   * What the agent *is*, in the name's `title` — the agent's own summary sentence, or the tier.
   *
   * The first of the three places an explanation is allowed to go. Deliberately a `title` rather than a
   * second visible band: a reader scanning nine rows does not need to be told nine times what each one does,
   * and the one who does need it is the one who hovers.
   */
  about?: string;
  /** The one actionable line. Plain text, ≤ `AGENT_ROW_LINE_BUDGET` characters. */
  line: string;
  /** Monospaced — set for a command the user would copy into a terminal. */
  lineIsCommand?: boolean;
  /** The whole of what `line` abbreviates, when it abbreviates anything. */
  lineTitle?: string;
  /** Extra chips after the state: terse verdicts, each a word or two. */
  chips?: ReactNode;
  /** The row's own action, at the end of the head line. */
  actions?: ReactNode;
  /** What `Details` reveals. Absent means the row has no disclosure and no button. */
  details?: ReactNode;
  /**
   * One extra class, for the list the row belongs to.
   *
   * The anatomy is shared and the **list's own dividers are not**: the shipped and provider lists are
   * `.settings__agents` children and take their separators from that rule, while the catalogue is a
   * `.settings__catalog` whose rows carry `.settings__catalog-row`. Passing the class in is what keeps one
   * component able to render into both without either list's styling being re-derived from the other's.
   */
  className?: string;
}

export function AgentRow(props: AgentRowProps): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <li className={`settings__agent${props.className !== undefined ? ` ${props.className}` : ""}`}>
      <div className="settings__agent-head">
        <span className={`chip ${props.stateChip}`}>{props.stateLabel}</span>
        <strong className="settings__agent-name" {...(props.about !== undefined ? { title: props.about } : {})}>
          {props.name}
        </strong>
        {props.chips}
        {/* The actions and the disclosure are pushed to the end of the head line by
            `margin-left: auto` on this spacer rather than by `justify-content` on the head, so that a
            narrow window wraps the *controls* under the name instead of squeezing the name. */}
        <span className="settings__agent-spacer" />
        {props.actions}
        {props.details !== undefined ? (
          <button
            type="button"
            className="button button--ghost button--small"
            aria-expanded={open}
            // The accessible name says which row it belongs to — eight buttons all called *Details* is a list a
            // screen-reader user cannot navigate — **and it still begins with the visible label**, which WCAG
            // 2.5.3 (Label in Name) requires: a voice-control user says "Details" and the name has to contain
            // it. The first draft of this label was "What Cursor reports about itself", which reads well and
            // makes the button unreachable by the word printed on it.
            aria-label={t("settings.agents.row.details.aria", { agent: props.name })}
            onClick={() => setOpen((current) => !current)}
          >
            {t("settings.agents.row.details")}
          </button>
        ) : null}
      </div>
      <p
        className={`settings__agent-line${props.lineIsCommand === true ? " settings__agent-line--command" : ""}`}
        {...(props.lineTitle !== undefined ? { title: props.lineTitle } : {})}
      >
        {props.line}
      </p>
      {open && props.details !== undefined ? (
        <div className="settings__agent-details">{props.details}</div>
      ) : null}
    </li>
  );
}

/**
 * **The one line, chosen.** A command is shown verbatim; a sentence is not shown at all.
 *
 * ## The rule this function is
 *
 * `AvailabilityFix.command` is documented as being shown verbatim, and it is — *when it is a command*. It is
 * not always one. Two of the catalogue's own hints are 127 and 136 characters of English prose
 * (`install Node.js so that \`npx\` is on PATH — Factory Droid itself needs no install, it is fetched from npm
 * on the first run`), which is the wall-of-text defect living inside a field named `command`. Renaming the
 * field or rewriting the catalogue is not this page's business, and dropping the text would be worse than
 * either — so the row **branches**:
 *
 *   * fits the budget → it is rendered verbatim, monospaced, and copyable, which is what a command is for;
 *   * does not fit → the row shows the short authored phrase and the full text goes to the `title` and the
 *     disclosure, where a sentence belongs.
 *
 * ## Why a branch and not a clamp
 *
 * A clamp would enforce the budget by construction, which sounds better and is worse: the budget would then
 * be unfalsifiable — no content could ever break it — and the test that exists to keep a paragraph off the
 * page would pass no matter what anyone wrote. A branch is a decision a test can see from both sides, and
 * `settings-density.test.tsx` asserts both of them.
 */
export function fixOrPhrase(
  fixes: readonly { command: string }[],
  phrase: string,
  budget: number,
): { line: string; title?: string; isCommand: boolean } {
  const first = fixes[0];
  if (first === undefined) return { line: phrase, isCommand: false };
  // Every step, not only the first: for an agent driven through a bridge the agent and the adapter are two
  // installs, and naming one lands the user at the other a minute later. The extra steps are the `title`'s
  // job — the visible line is the first thing to do.
  const all = fixes.map((step) => step.command).join("\n");
  // A `title` identical to the visible text is a tooltip that repeats the row, so it is omitted — **but only
  // when the line *is* that text**. When the line is the short phrase it abbreviates the fix, and the hover is
  // the only place the whole of it is reachable without opening the disclosure.
  const fits = first.command.length <= budget;
  const title = fits && all === first.command ? undefined : all;
  return fits
    ? { line: first.command, isCommand: true, ...(title !== undefined ? { title } : {}) }
    : { line: phrase, isCommand: false, ...(title !== undefined ? { title } : {}) };
}
