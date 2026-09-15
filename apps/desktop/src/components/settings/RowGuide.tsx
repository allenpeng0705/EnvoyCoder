/**
 * **What a row's disclosure shows, in the order it must be read: the way out, then the facts.**
 *
 * Two components and one rule between them, and the rule is the mandate's: *"Distinguish 'there is a fix'
 * from 'there is nothing you can do', in the words and in the layout."*
 *
 * ## The layout carries it, and that is why these are two components rather than one paragraph
 *
 * `AgentRow`'s panel renders them in this order — `GuideBlock` first, `FactsBlock` second — and `GuideBlock`
 * renders a **list only when there is a list to render**. So a row that is not ready because of something
 * the user can install leads with the exact commands; a row that is not ready because *we* cannot drive it
 * leads with one sentence and then nothing at all. The difference is not a tone of voice, it is the presence
 * or absence of an `<ol>`, and `test/settings-agent-verdict.test.tsx` asserts exactly that: the "our gap"
 * case offers no install step and no link, in the DOM.
 *
 * ## Facts, and never chips
 *
 * The owner's vocabulary: caveats (`no approvals`, `cannot be cancelled`, `temporary copy`) are *properties*.
 * So a caveat is a `RowFact` with `caveat: true` — which draws it in the warning colour **inside the
 * definition list**, where it reads as "a thing about this row" rather than as a second verdict next to the
 * row's own. `AgentRow` has no prop through which a chip could reach a row's face, which is what makes "at
 * most one chip, and it is one of two verdicts" structural rather than a convention.
 *
 * ## The one thing a fact is allowed to carry that a chip never could
 *
 * A **time**. *"verified 4 minutes ago"* is half of what makes the deep facts honest — a fact with no date is
 * a promise, and this product's whole rule about the things learned by starting an agent is that they are
 * observations rather than promises. `verdictFacts` builds them (with `formatAgo`), and this component
 * prints them; nothing here reads a clock.
 */

import type { JSX } from "react";

import { useI18n } from "../../i18n/context.js";
import type { RowFact, VerdictGuide } from "./agent-verdict.js";

/**
 * The way out of a Not-ready row — or the plain statement that there is nothing to do about it.
 *
 * A `<ul>` of commands rather than a paragraph, because the whole point of the count is that a user can
 * count: a bridged agent's fix is two commands, and a running sentence is how the second one gets missed.
 * `environment` is the same list shape for the same reason, holding variable **names** — which is all
 * EnvoyCoder is ever allowed to know about a credential.
 */
export function GuideBlock(props: { guide: VerdictGuide }): JSX.Element {
  const { t } = useI18n();
  const { guide } = props;
  return (
    <div className="settings__agent-guide">
      <p className="settings__agent-fact settings__agent-fact--lead">{guide.lead}</p>
      {guide.kind === "steps" ? (
        <ol className="settings__agent-steps">
          {guide.steps.map((step) => (
            <li key={step.command}>
              <code className="settings__agent-command">{step.command}</code>
            </li>
          ))}
        </ol>
      ) : null}
      {guide.kind === "environment" ? (
        <ul className="settings__agent-steps">
          {guide.names.map((name) => (
            <li key={name}>
              <code className="settings__agent-command">{name}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {/* An instruction that is not a command line — *Restart EnvoyCoder*. Prose rather than a `<code>`,
          because a button cannot be pressed from inside a disclosure and a monospaced "command" the user
          cannot type would be worse than the sentence. */}
      {guide.action !== undefined ? <p className="settings__agent-fact">{guide.action}</p> : null}
      {guide.href !== undefined ? (
        <p className="settings__agent-fact">
          <a
            className="settings__link"
            href={guide.href}
            target="_blank"
            rel="noreferrer noopener"
            title={t("settings.agents.row.installLink.title", { agent: guide.lead })}
          >
            {t("settings.agents.row.installLink")}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The row's properties: a definition list, and the only place a caveat can appear.
 *
 * A `<dl>` rather than a band of text, for the reason the disclosed facts were already a `<dl>`: every entry
 * is a *label and a value*, and a screen reader reading "Asks before acting, no" is reading the same thing a
 * sighted user reads. The `caveat` flag is a colour and nothing else — deliberately, because a value that
 * needs to be noticed is a value, and turning it into a chip is the change this whole slice undid.
 */
export function FactsBlock(props: { facts: readonly RowFact[] }): JSX.Element {
  return (
    <dl className="settings__agent-declared">
      {props.facts.map((fact) => (
        <div key={fact.label} className={fact.caveat === true ? "settings__fact--caveat" : undefined}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
