/**
 * **One agent, as a row** — the shape every list on the Agents page is built from.
 *
 * ## The anatomy, and why it is three columns
 *
 * ```
 *   ┌──────────────────────────────────────────────┬───────────────┬────────────┐
 *   │ Name                                  (title) │   [Ready]     │  [action]  │
 *   │ the one line — what is missing, and the fix   │  [Not ready]  │  [Details] │
 *   └──────────────────────────────────────────────┴───────────────┴────────────┘
 *   ── disclosed: the guide, then the properties, each with its time ──
 * ```
 *
 * | column | what belongs in it |
 * |---|---|
 * | **the name** | the agent's own name, and nothing else. What it *is* goes in the name's `title` |
 * | **the line** | the one actionable fact — ≤ `AGENT_ROW_LINE_BUDGET`. It shares the name's left edge, so the two read as one block |
 * | **the verdict** | **one** chip, `Ready` or `Not ready`, right-aligned in a column |
 * | **the controls** | the row's own action and its `Details` button, right-aligned in a column |
 *
 * **The name leads, and that is a measurement rather than a preference.** The page before this one set the
 * name at 13px/500 in a `[chip] Name … [actions]` line where the state chip came *first*: the owner's report
 * was *"can we give more space to each agent and emphasize the Agent name, the status or actions are just
 * properties"*, and the row measured 60px with the name at the same weight as every other label on the page.
 * So the name is now 15px/600 (`--font-size-content` / `--font-weight-semibold`) — one full step above the
 * 13px body text and one weight step above the 500 that ordinary UI labels use — and everything else in the
 * row is subordinate: the line is 12px muted, the chip is 12px on a tint, the controls are 24px buttons.
 *
 * **The columns are fixed so the chips line up.** A chip that is right-aligned *inside its own row* does not
 * line up down a page: it lines up only if every row's right-hand column is the same width, because the chips'
 * right edge is `row right − controls − gap`. The controls column is therefore a fixed track
 * (`--settings-agent-actions`), and `scripts/measure-settings.mjs` reports the per-column edge variance so
 * that "the chips line up" is a number rather than a claim.
 *
 * **One chip, and it is the verdict.** Caveats used to hang inward from the state chip (`No approvals`,
 * `Temporary copy`, `Needs a sign-in`, `Cannot be cancelled`), which is how nine rows carried thirty chips and
 * how the one word a user needs had to be picked out from among them. The owner's vocabulary is that caveats
 * are *properties*: they are in `verdictFacts` and they render inside `details`, and this component has no
 * prop through which one could reach the face of a row.
 *
 * **The command on the line is the one thing set apart from the prose, and that is not a chip.** When a row's
 * fix is a command line, the sentence and the command share the line — and the command carries a tint and a
 * radius (`settings__agent-cmd--fix`) so a reader scanning the left edge sees *which rows have something to
 * run* before reading a word. It stays one line, one `<p>`, one left edge; what changed is that the half a
 * user acts on is no longer dressed as the half they only read.
 *
 * ## Why one component and not three similar lists
 *
 * The page has three lists — the nine agents we ship, the ones a user declared, and the 38 recipes — and
 * before this file each rendered its own `<li>` with its own arrangement of chips, summary lines and hints.
 * They had already drifted: the catalogue's head was one line and the shipped agents' was a stack, so the same
 * three facts measured 58px on one list and 155px on another. One component is what makes "a row is a name, a
 * verdict and one line" a property of the *page* rather than of whichever list was written last.
 *
 * ## The disclosure is a `<button>` and not a `<details>`
 *
 * `aria-expanded` on a button is the same contract with one difference that matters here: the label stays put
 * and reads the same in both states, so a row does not reflow when it opens and the label a screen reader
 * announced is still the label on screen. The panel is rendered only when open, so nothing below the fold
 * pays for a closed row's contents.
 *
 * **The Not-ready chip is the second control for that same panel**, which is the mandate's own instruction —
 * *"clicking Not ready reveals how to resolve it"*. Both controls carry `aria-expanded` and `aria-controls`
 * pointing at one panel, so a screen-reader user has one region and two ways into it; the Ready chip is a
 * plain `<span>` because it has nothing to reveal.
 */

import type { JSX, ReactNode } from "react";

import { useState } from "react";

import { useI18n } from "../../i18n/context.js";

export interface AgentRowProps {
  /**
   * **The verdict, in the row's one and only chip** — `Ready` or `Not ready`, already translated.
   *
   * There is no separate `chips` prop, and its absence is the design rather than an omission: caveats used to
   * arrive here as extra chips (`No approvals`, `Temporary copy`, `Needs a sign-in`, `Cannot be cancelled`),
   * which is how a nine-row list came to carry thirty of them and how the one word a user needs had to be
   * picked out from among them. A caveat is a **property** now (`verdictFacts` in `agent-verdict.ts`), and the
   * only way to render one on a row is through `details`, which is behind the row's own disclosure. A caller
   * that wants a caveat on the face of a row has nowhere to put it. `test/settings-agent-verdict.test.tsx`
   * asserts the count on every row of every list.
   */
  verdictLabel: string;
  /** The chip's colour class — `VERDICT_CHIP[verdict].className`, passed in rather than re-derived. */
  verdictChip: string;
  /**
   * **Is this row one a user can act on?** A Not-ready chip is a real `<button>` that opens the row's own
   * disclosure — "clicking Not ready reveals how to resolve it", in the owner's words — so the guide is one
   * press away from the word that says there is a problem.
   *
   * A Ready chip is a plain `<span>`: it has nothing to reveal, and a button that does nothing is worse than
   * the absence of one. `aria-expanded` therefore appears only on the control that actually expands
   * something.
   */
  verdictAction?: boolean;
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
  /**
   * A command that belongs on the **same** line, after the prose — and a `<code>`, so the two are readable as
   * two things without a second band.
   *
   * The reason this exists rather than "make the whole line monospaced": the line for an agent that is
   * installed but not yet drivable reads *`Installed — its connector is missing npm install -g …`*, which is a
   * sentence followed by a command. Setting the sentence in a monospaced face to buy the command its face is
   * the wrong half of the trade — a reader scanning the left edge of nine rows meets a column of code.
   * `line` plus `command` is one line, one `<p>`, one left edge, and two faces.
   */
  command?: string;
  /** Monospaced — set for a line that *is* a command the user would copy into a terminal. */
  lineIsCommand?: boolean;
  /** The whole of what `line` abbreviates, when it abbreviates anything. */
  lineTitle?: string;
  /** The row's own action, at the start of the controls column. */
  actions?: ReactNode;
  /** What the row's disclosure reveals: the guide, then the properties. Absent means no button at all. */
  details?: ReactNode;
  /**
   * Content under the row that is **not** gated by Details — e.g. the Envoy Harness LLM panel.
   *
   * Kept separate from `details` so a Configure control in the actions column can open a panel without
   * also forcing the disclosure open.
   */
  below?: ReactNode;
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
  /** One disclosure, two controls. `verdictAction` decides whether the second one exists. */
  const toggle = (): void => setOpen((current) => !current);
  /** The disclosure's own id, so `aria-controls` names the panel both controls expand. */
  const panelId = `agent-details-${props.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
  const expandable = props.details !== undefined;

  return (
    <li className={`settings__agent${props.className !== undefined ? ` ${props.className}` : ""}`}>
      <div className="settings__agent-head">
        {/* The name and its line: one block, one left edge. A wrapper rather than two grid items, because
            the two must stay a *column* — a line that starts at a different x than its name is not one. */}
        <div className="settings__agent-id">
          <strong className="settings__agent-name" {...(props.about !== undefined ? { title: props.about } : {})}>
            {props.name}
          </strong>
          <p
            className={`settings__agent-line${
              props.lineIsCommand === true ? " settings__agent-line--command" : ""
            }`}
            {...(props.lineTitle !== undefined ? { title: props.lineTitle } : {})}
          >
            {/* **A line that *is* a command gets the same tinted face as a command that follows prose.** It is
                the same fact — *this is the thing to run* — and a page where one row's command is set apart and
                the next row's is not would look like an oversight rather than a distinction. The tint is an
                inline box, so the row keeps the height it had (the anatomy test asserts one height for every
                row, and vertical padding on a block element is exactly how that assertion breaks). */}
            {props.lineIsCommand === true ? (
              <code className="settings__agent-cmd settings__agent-cmd--fix">{props.line}</code>
            ) : (
              <>
                {props.line}
                {props.command !== undefined ? (
                  <>
                    {" "}
                    <code className="settings__agent-cmd settings__agent-cmd--fix">{props.command}</code>
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
        {/* **The verdict column**, and the row's only chip. Right-aligned inside a fixed track so the chips
            line up down the page. A Not-ready chip is the second control for the row's disclosure, which is
            what makes "the problem, and the way out of it" one press rather than a hunt for a link. */}
        <div className="settings__agent-props">
          {props.verdictAction === true && expandable ? (
            <button
              type="button"
              className={`chip ${props.verdictChip} settings__agent-state settings__agent-state--button`}
              aria-expanded={open}
              aria-controls={panelId}
              // The accessible name leads with the visible label (`Not ready`) and then names the row, which
              // is what WCAG 2.5.3 (Label in Name) requires of a control whose label is a single word repeated
              // down a list — a voice-control user says "Not ready" and has to reach *this* row's.
              aria-label={t("settings.agent.verdict.notReady.aria", { agent: props.name })}
              onClick={toggle}
            >
              {props.verdictLabel}
            </button>
          ) : (
            <span className={`chip ${props.verdictChip} settings__agent-state`}>{props.verdictLabel}</span>
          )}
        </div>
        {/* **The controls column**, fixed width (`--settings-agent-actions`) and right-aligned for the same
            reason. Wrapping rather than overflowing: a narrow window puts the second button under the first
            instead of pushing the chip column left. */}
        <div className="settings__agent-actions">
          {props.actions}
          {expandable ? (
            <button
              type="button"
              className="button button--ghost button--small"
              aria-expanded={open}
              aria-controls={panelId}
              // The accessible name says which row it belongs to — eight buttons all called *Details* is a list a
              // screen-reader user cannot navigate — **and it still begins with the visible label**, which WCAG
              // 2.5.3 (Label in Name) requires: a voice-control user says "Details" and the name has to contain
              // it. The first draft of this label was "What Cursor reports about itself", which reads well and
              // makes the button unreachable by the word printed on it.
              aria-label={t("settings.agents.row.details.aria", { agent: props.name })}
              onClick={toggle}
            >
              {t("settings.agents.row.details")}
            </button>
          ) : null}
        </div>
      </div>
      {open && props.details !== undefined ? (
        <div className="settings__agent-details" id={panelId}>
          {props.details}
        </div>
      ) : null}
      {props.below !== undefined ? <div className="settings__agent-below">{props.below}</div> : null}
    </li>
  );
}
