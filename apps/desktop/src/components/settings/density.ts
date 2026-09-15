/**
 * **How much a row may say** — three numbers, and the test that keeps them.
 *
 * ## Why a number at all
 *
 * The owner's brief for this pane was, in their words: *"each page has too many texts and the section is not
 * so clear, feel crowded and don't want to read so many texts."* A judgement like that is easy to agree with
 * and impossible to keep: the next slice adds one clarifying sentence to one row, and no reviewer notices
 * because a sentence is small. The page was measured before this file existed and it held **15,139 visible
 * characters over 12.97 screens** on the Agents page alone, of which one row carried **575**.
 *
 * So the rule is written as a budget rather than as advice, and `apps/desktop/test/settings-density.test.tsx`
 * renders every settings page and fails when any of the three is exceeded. The numbers were chosen to be
 * *comfortably* passable by a good row and impossible to pass by a paragraph — which is the only property a
 * budget needs: it must not decide taste, and it must not be renegotiable at the moment it is inconvenient.
 *
 * ## The three numbers
 *
 * | constant | what it caps | why this value |
 * |---|---|---|
 * | `AGENT_ROW_LINE_BUDGET` | the **one actionable line** on an agent row | 80 characters is one line of prose at this pane's measure. A real install command fits (`npm install -g @deepseek-ai/dsh` is 32); a sentence does not (the catalogue's own `install Node.js so that npx is on PATH — …` is 127), and that is exactly the discrimination the rule is for: **a command is shown verbatim, a sentence moves to the disclosure** |
 * | `AGENT_ROW_BUDGET` | everything visible on a **closed** agent row | ~1.5× the line: a name, a state chip, one or two terse verdict chips, one action and the disclosure label. It sits far above any legitimate row (the longest closed row measured here is 89) and far below the 575-character row it replaces |
 * | `SETTING_DETAIL_BUDGET` | the `.setting__detail` band under a setting's title | 80, the same number as the row line and for the same reason: it is the one sentence a setting gets, and twelve of the strings this pane shipped were over it (the longest was 203) |
 *
 * ## What is deliberately **not** capped, and why that is not a loophole
 *
 *   * **A disclosure's contents.** The brief's rule is "explanations move to a `title`, to a disclosure, or to
 *     the docs" — a disclosure that also had to be short would have nowhere to put the explanation it exists
 *     for. What the budget forbids is the explanation being *on the page*.
 *   * **A `title` attribute.** Invisible until asked for, which is the definition of the third band.
 *   * **An empty state.** The law from the reference audit stands: an empty state teaches, and the one on
 *     *Your agents* is a sentence because there is nothing yet to scan.
 *   * **A page-level note.** `settings.shortcuts.note` and friends are about the *page*, not inside a row —
 *     they are capped by nothing, but the redesign took them from 149/164/157 characters down to under 80
 *     wherever they were restating what the rows already say.
 *
 * ## The one thing these numbers cannot do
 *
 * They cannot tell a short sentence from a good one. `Enforced by test` is the property this file has;
 * *worth reading* is not, and no count can check it. What the count does buy is that a bad sentence has to be
 * a *short* bad sentence, and that is measurably better than the alternative.
 */

/**
 * The one line an agent row may carry — see the table above.
 *
 * The component *branches* on it rather than truncating to it, and that difference is deliberate: a clamp
 * would make this budget unfalsifiable, and a budget no content can break is a comment with extra steps.
 * When a fix's own text is longer than this, the row shows the short phrase and the full text goes to the
 * `title` and the disclosure — which is a decision a test can see, because `settings-density.test.tsx`
 * asserts both branches on purpose-built rows.
 */
export const AGENT_ROW_LINE_BUDGET = 80;

/** Everything visible on a closed agent row: name, chips, the one line, and the controls' labels. */
export const AGENT_ROW_BUDGET = 140;

/**
 * The `.setting__detail` band — the one sentence under a setting's title.
 *
 * `SettingRow` renders it directly under the title, which is what makes it the *second* thing a reader
 * scans. Two sentences there is a paragraph in the position a reader is moving fastest through, and every
 * string over this number on this pane was one: the language row explained where a value is stored, the
 * extra-arguments row explained a sentinel in the agent's own argv, and the transport field explained why
 * it has no default. All true, none of it needed to make the control usable.
 */
export const SETTING_DETAIL_BUDGET = 80;

/**
 * The `.setting__note` band — **what is true right now**, and the one sentence a disabled control is allowed
 * to use to say why.
 *
 * Larger than the other two, and the difference is deliberate rather than a compromise. A note is not a row's
 * description; it is a *reason*, and the pane's oldest law is that a control which cannot be honoured says why
 * on screen, naming the thing that makes it impossible. The approval row is the case: when the default agent
 * is one `session/set_policy` cannot reach, the note has to name the agent, say what it does instead, and name
 * two actions — 169 characters with a real agent's name in it, which is the longest honest note this page has.
 *
 * 180 is that number plus a little. What it is for is the other thing a note becomes: a paragraph. The note on
 * *New tasks* explaining where the missing agents are was **140 characters of teaching** inside a row, which is
 * exactly the shape rule 4 of the redesign forbids — it is 30 now, and this is the line that keeps the next one
 * from being 400.
 */
export const SETTING_NOTE_BUDGET = 180;
