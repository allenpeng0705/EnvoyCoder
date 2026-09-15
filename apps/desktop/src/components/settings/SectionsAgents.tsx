/**
 * **Agents** — every agent this machine can run, what each one actually is, and the two ways to get one
 * that is not there yet.
 *
 * ## What this page is for
 *
 * The product's claim is that EnvoyCoder is the control plane for coding agents, and this is the screen
 * that has to make that true: the nine agents we ship, the ones a user declared, and the 38 recipes in the
 * catalogue — **in one place, searchable**, each row carrying a **verdict** that was measured rather than a
 * state a list implies. Before this page the catalogue existed in `@envoycoder/agent-catalog` and no
 * surface read it, so a user with Gemini CLI installed had a product that supported it and no way to find
 * out.
 *
 * **Every row resolves itself.** There is no button on this page whose purpose is to find out a state: the
 * daemon resolves what this machine can do with each of the 48 rows before it serves them (`availability`
 * on `HarnessSummary`, `AgentProviderSummary` and `CatalogEntry`), and `rowVerdict` turns that into one of
 * two words. What a user has to *do* — sign in, add, remove, install — is offered as an action; what a user
 * would have to *press to learn* is gone, and `docs/settings-parity.md` §7.17 records the report that
 * removed it.
 *
 * ## It has to be *scanned*, not read — which is a measurement, not an opinion
 *
 * The page as it shipped was measured in a real window before this slice (`scripts/measure-settings.mjs`;
 * the numbers are in `docs/settings-parity.md` §7.14): **15,139 visible characters**, **8,391px of body**,
 * **12.97 screens**, four rows above the fold, and one row of **575** characters. The owner's brief was
 * *"too many texts … don't want to read so many texts"*, and the measurement says where: **10,817 of those
 * characters — 71% — were the catalogue**, which rendered all 38 rows expanded inside a page that also had
 * to hold the nine agents we ship.
 *
 * Three changes come out of that, and each is a rule rather than an edit:
 *
 *   1. **A row is a name, a state, and at most one short line.** The line is the *actionable* fact. What the
 *      agent is, what it published about itself, where its recipe came from and what the whole of a fix
 *      sentence says all move to a `title` or to the row's disclosure — never to the page. The budget is
 *      `AGENT_ROW_LINE_BUDGET`, and `apps/desktop/test/settings-density.test.tsx` fails when a row exceeds it.
 *   2. **The groups carry their counts** (`On this machine · 9`), because a group header's job is to be
 *      countable at a glance. A user who cannot see that there are thirty-eight recipes below cannot decide
 *      whether to look.
 *   3. **The catalogue opens on demand**, and *nothing becomes invisible*: the count is in the heading and
 *      the entry point is a button on screen, always. This repository deleted a *hide* feature for exactly
 *      that reason (`docs/settings-parity.md` §5.8) and the distinction is worth keeping straight — a filter
 *      that can remove an agent from a list is not the same act as a disclosure that one press unfolds.
 *
 * ## The three groups, and why they are three and not one
 *
 * | group | what it is | where its state comes from |
 * |---|---|---|
 * | **On this machine** | the nine agents we ship | `coder.listHarnesses` — measured, with the capabilities we verified |
 * | **Your agents** | the ones a user declared | `coder.listProviders` — measured by the same prober |
 * | **Catalogue** | the 38 recipes | `coder.listCatalog` — measured on the read, per row, nothing started |
 *
 * The third group is the one that could lie, and the whole design of it is about not doing so. A catalogue
 * entry is a *recipe*: a command line and a link, and whether this machine can run it is a fact somebody has
 * to measure. The measurement is cheap — a program that resolves, a connector that resolves, an `npx` shape,
 * and the variables the launch needs: filesystem and environment reads, no process and no package — so it is
 * taken for all 38 rows when the list is served, and a row is a verdict before a user has touched anything.
 * What is **not** cheap is anything learned by *starting* an agent, which for 14 of these recipes means
 * downloading a package; none of it is a verdict, and `agent-verdict.ts` carries where it goes instead.
 *
 * ## This page lists everything, and there is no control on it that can shorten it
 *
 * **There used to be one, and it was the wrong shape.** A *Hide from my lists* switch wrote a stored
 * preference that filtered the pickers, and the row carried a *Hidden* chip beside its state. It is gone —
 * control, chip, copy and field — because a list filter is the one control that can make an agent **this
 * product ships disappear from the product's own lists**, which is the exact thing this product exists not
 * to do: its brief is that a user could not see the agents we support. The audit's first ruling (that the
 * reference product's "Enable {provider}" row was not applicable here) was closer to right than the
 * correction that replaced it, and `docs/settings-parity.md` §5.8 now records why.
 *
 * What a picker offers is instead **derived** from what a probe measured (`composer/agent-for.ts`'s
 * `offeredAgents`), so nothing a user stores can shorten a list — and this page is the other half of that
 * bargain: **every agent we ship, every agent the user declared and all 38 catalogue entries are here**, with
 * the state each was measured in. A picker may drop an agent we established is absent; the page never does.
 *
 * ## The one action that does remove a row, and why it is not the same thing
 *
 * A **Remove** button forgets a provider the *user declared*. That is an undo of the user's own action —
 * they added it, they can un-add it — rather than a statement about an agent we shipped, which is the whole
 * difference between remove and hide. There is no remove control on a shipped agent, because there is
 * nothing of the user's to undo: the nine are what the product is.
 *
 * ## What the disclosed facts are, and why they are disclosed rather than shown
 *
 * The **declared facts** — modes, models, thinking levels, where the agent comes from — are the agent's own
 * answers from its last handshake, and there is nothing here to change about them. They are what a user needs
 * when something is *wrong*, and nine rows of four facts each is 36 lines nobody reads on the way to the one
 * row that matters. So they are behind `Details`, in a definition list rather than rows of controls: a block
 * whose whole value is "this is what the agent said about itself" must not look like it could be edited.
 */

import type { JSX } from "react";

import { useCallback, useState } from "react";

import type { HarnessAvailability, HarnessSummary } from "@envoycoder/protocol";

import type { MessageKey } from "../../i18n/messages/en.js";

import { availabilityOf } from "../../composer/agent-for.js";
import { useI18n } from "../../i18n/context.js";
import { localizeText } from "../../i18n/notice.js";
import type { SettingsSectionProps } from "./SectionProps.js";
import { AgentRow } from "./AgentRow.js";
import { FactsBlock, GuideBlock } from "./RowGuide.js";
import { rowVerdict, verdictFacts } from "./agent-verdict.js";
import { AGENT_ROW_LINE_BUDGET } from "./density.js";
import { CatalogList } from "./CatalogRows.js";

/**
 * The section, as the pane renders it.
 *
 * One component holding three groups is deliberate rather than lazy: the sign-in result and the "signing in"
 * flag are shared state between the shipped list and the catalogue's own actions, and a component split for
 * its own sake would have been two `useState`s lifted into a third place. What *is* split is the rendering:
 * a row is `AgentRow.tsx`, the catalogue and the manual form are `CatalogRows.tsx`, and the decisions that
 * can silently lie are pure functions in `agent-catalog.ts`.
 */
export function AgentsSection(props: SettingsSectionProps): JSX.Element {
  const { t } = useI18n();
  const { state, agents } = props;

  /**
   * Which methods **this** daemon actually serves.
   *
   * The window and its daemon are two artifacts and the shell *attaches* to whichever one owns the port
   * (family rule D2), so after an upgrade the new window can be talking to the previous build. Every method
   * this page needs was added in this slice or the one before it, and asking an older daemon for one earns
   * "Method not found" — which is a sentence, not a crash, but four sentences on one page is a wall. So the
   * page asks `hello`'s own method list once and renders the surface that exists.
   *
   * **A sentence, never an exception.** The previous slice lost a whole pane to a required field an older
   * daemon did not send; the same class of defect here would be a page that unmounts the window.
   */
  const can = {
    catalog: state.hello?.methods.includes("coder.listCatalog") === true,
    providers: state.hello?.methods.includes("coder.listProviders") === true,
    signIn: state.hello?.methods.includes("coder.signInAgent") === true,
  };

  /**
   * The outcome of the last sign-in attempt, as the daemon's own keyed sentence.
   *
   * A string rather than `{agent, text}`: the sentence the daemon sends already names the agent, so a second
   * field carrying its label would be a field nothing reads — and this pane has a rule about those.
   */
  const [signInResult, setSignInResult] = useState<string | undefined>();
  const [signingIn, setSigningIn] = useState<string | undefined>();

  const onSignIn = useCallback(
    async (harness: HarnessSummary): Promise<void> => {
      setSigningIn(harness.id);
      setSignInResult(undefined);
      const result = await agents.signInAgent(harness.id);
      setSigningIn((current) => (current === harness.id ? undefined : current));
      // A `Refusal` is not an outcome: nothing was attempted. Its own sentence says why, and it is the same
      // one the notice strip shows — repeated here because the button the user pressed is on this page, and
      // an answer that appears somewhere else is an answer nobody sees.
      setSignInResult(result.ok ? result.detail : result.message);
    },
    [agents],
  );

  if (state.hello === undefined) {
    // No daemon at all is not the same as a daemon that is a build behind, and the page says which.
    return <p className="settings__note">{t("settings.noDaemon")}</p>;
  }

  return (
    <>
      {/* **The heading carries the count, and the count is the point.** Three groups with their sizes on them
          are three facts; three groups with names only are three invitations to scroll and find out. */}
      <h2 className="settings__heading">
        {t("settings.agents.shipped.heading")}
        {" · "}
        <span className="settings__agent-count">{state.harnesses.length}</span>
      </h2>
      <ul className="settings__agents">
        {state.harnesses.map((harness) => (
          <ShippedAgent
            key={harness.id}
            harness={harness}
            canSignIn={can.signIn}
            signingIn={signingIn === harness.id}
            onSignIn={onSignIn}
          />
        ))}
        {state.harnesses.length === 0 ? (
          // An empty state teaches, and this one is the daemon saying it has not answered yet rather than a
          // claim that we ship no agents — which is the distinction the sentence is written for.
          <li className="settings__agent settings__agent--empty">
            <p className="settings__note">{t("settings.agents.empty")}</p>
          </li>
        ) : null}
      </ul>

      {signInResult !== undefined ? (
        <p className="settings__note" role="status">
          {localizeText(t, signInResult) ?? signInResult}
        </p>
      ) : null}

      <h2 className="settings__heading">
        {t("settings.agents.mine.heading")}
        {" · "}
        <span className="settings__agent-count">{state.providers.length}</span>
      </h2>
      {can.providers ? (
        <ul className="settings__agents">
          {state.providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              commandLabel="settings.agents.mine.command"
              onRemove={() => void agents.removeProvider(provider.id)}
            />
          ))}
          {state.providers.length === 0 ? (
            // The empty state, and it is the one place on this page allowed to be a paragraph: with nothing to
            // scan there is nothing to scan *past*, so the sentence that says where agents come from is the
            // most useful thing that can be on a row here.
            <li className="settings__agent settings__agent--empty">
              <p className="settings__note">{t("settings.agents.mine.empty")}</p>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="settings__note">{t("settings.agents.olderDaemon")}</p>
      )}

      {can.catalog ? (
        <CatalogList state={state} agents={agents} />
      ) : (
        // **The sentence, not a throw.** `coder.listCatalog` does not exist on this daemon, so there is no
        // catalogue to render — and rendering an *empty* one would say "there are no agents", which is a
        // claim about the product rather than about the build.
        <p className="settings__note">{t("settings.agents.olderDaemon")}</p>
      )}
    </>
  );
}

/**
 * One of the nine agents we ship: its **verdict**, the one line behind it, and its own facts as properties.
 *
 * ## The two things this row no longer does
 *
 * It no longer renders a state vocabulary — five chips with five words, one of which (`Ready`) meant "the
 * program resolves" and another (`Not downloaded yet`) meant "we looked at `npx` and not at the agent". It
 * renders `rowVerdict`'s single verdict and, when that verdict is *not ready*, the way out of it, and the
 * mapping from the daemon's five measured states to those two words lives in exactly one file.
 *
 * And it no longer carries **caveat chips**. `No approvals`, `Cannot be cancelled`, `Temporary copy` and
 * `Needs a sign-in` were chips beside the state, which is how nine rows carried eighteen chips and how the
 * one word a user needs had to be picked out of them. They are properties now (`verdictFacts`), rendered
 * inside the disclosure with the rest — including the time EnvoyCoder last looked, which is the half of the
 * deep facts that makes them observations rather than promises.
 *
 * ## The one control, and why this row has exactly one
 *
 * `Sign in`, and it is the only row action because it is the only thing a user must *do*: the program is
 * installed and drivable, and the agent will not open a session until its own login has been through once.
 * That is why a sign-in requirement is a **fact and not the verdict** — the verdict answers "can this machine
 * run this agent", and the answer is yes.
 */
function ShippedAgent(props: {
  harness: HarnessSummary;
  canSignIn: boolean;
  signingIn: boolean;
  onSignIn: (harness: HarnessSummary) => Promise<void>;
}): JSX.Element {
  const { t, locale } = useI18n();
  const { harness } = props;
  // The wire generation is decided **once per row**, here, and not inside the verdict: an older daemon sends
  // a boolean and no `availability`, and the same fact has to reach the chip, the line and the sentence that
  // explains the daemon is a build behind. `availabilityOf` maps a legacy answer to a state *without inventing
  // one*; `undefined` is passed through so the row can say "the daemon is behind" rather than "we could not
  // look", which are different sentences about different halves of this product.
  const availability = availabilityOf(harness);
  const legacyDaemon = harness.availability === undefined;
  /**
   * A daemon that cannot report what an agent publishes is **still a daemon whose verdict is usable**: the
   * program is installed and drivable, so the row's chip says Ready. What must not be lost is the *action* —
   * which is why the line says so in four words, and why this is decided here rather than inside the verdict:
   * a build skew is not a reason to tell a user their agent is not ready.
   */
  const undeclared = harness.models === undefined || harness.thinking === undefined;

  const verdict = rowVerdict(
    {
      label: harness.label,
      availability: legacyDaemon ? undefined : availability,
      // What the row says when there is nothing to fix. The tier is the honest answer for an agent that is
      // simply working: there is no action, and "Ships with EnvoyCoder" is a fact rather than a filler — and
      // for a daemon that could not answer, it is the action instead, in four words.
      readyLine: undeclared
        ? t("settings.agents.row.restart")
        : t(harness.tier === "built-in" ? "settings.agent.tier.builtIn" : "settings.agent.tier.catalogued"),
    },
    t,
    AGENT_ROW_LINE_BUDGET,
  );

  const facts = verdictFacts({ availability, harness, locale, now: Date.now() }, t);

  return (
    <AgentRow
      verdictLabel={t(verdict.chipKey)}
      verdictChip={verdict.chipClass}
      verdictAction={verdict.verdict === "not-ready"}
      name={harness.label}
      about={harness.summary}
      line={verdict.line}
      {...(verdict.command !== undefined ? { command: verdict.command } : {})}
      lineIsCommand={verdict.lineIsCommand}
      {...(verdict.lineTitle !== undefined ? { lineTitle: verdict.lineTitle } : {})}
      actions={
        props.canSignIn && harness.auth?.state === "needs-signin" ? (
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={props.signingIn}
            title={t("settings.agents.signIn.title", { agent: harness.label })}
            onClick={() => void props.onSignIn(harness)}
          >
            {props.signingIn ? t("settings.agents.signIn.working") : t("settings.agents.signIn")}
          </button>
        ) : null
      }
      details={
        <>
          {/* **The way out first, then the facts.** The order is the mandate's: a row that is not ready says
              what to do before it says what it is, and `GuideBlock` renders no list at all when there is
              nothing to do — the layout half of "our gap is not your missing install". */}
          {verdict.guide !== undefined ? <GuideBlock guide={verdict.guide} /> : null}
          <FactsBlock facts={facts} />
        </>
      }
    />
  );
}

/**
 * One provider the **user** declared: its verdict, the command it runs, and its environment names as facts.
 *
 * ## The case this row exists to get right, and did not
 *
 * A provider names environment variables, and the old row reported two *separate* things: `availability` from
 * the prober (which looks only for the program) and, inside the disclosure, which of those names the daemon
 * has. So a program that resolved beside a variable that was never set read **Ready** with a footnote — two
 * facts a user had to join themselves, in the one situation where pressing Run produces a credential failure
 * that looks like a bug in the app. `rowVerdict` takes the unset names as an argument and makes it *Not ready*,
 * naming the variable on the row's own line, because that is what a user has to act on.
 *
 * A recipe's own constants can never do this: `AgentProviderEnvState.from === "catalogue"` means EnvoyCoder
 * supplies the value, so such a name is excluded from the missing list and rendered as a plain fact.
 */
function ProviderRow(props: {
  provider: SettingsSectionProps["state"]["providers"][number];
  /**
   * The label for the provider's command line, passed in as a **key** rather than as a string.
   *
   * `MessageKey` and not `string`, because this row renders it in two places — the line's `title` and the
   * disclosure's own fact — and a caller that handed it pre-translated text would be able to pass anything.
   * Typing it as the catalogue's own key type is what makes a typo a compile error rather than a French window
   * with an English fragment in it.
   */
  commandLabel: MessageKey;
  onRemove: () => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const { provider } = props;
  const command = [provider.command, ...provider.args].join(" ");
  // A name the daemon does not have, and that the recipe does not supply. The two exclusions are the whole
  // difference between a fix and a false alarm: `set` is whether the daemon's environment has it, and
  // `from === "catalogue"` means our own recipe sets it for the user.
  const missingEnv = provider.env
    .filter((variable) => !variable.set && variable.from !== "catalogue")
    .map((variable) => variable.name);

  const verdict = rowVerdict(
    {
      label: provider.label,
      availability: provider.availability,
      missingEnv,
      // The command line is what a user would run by hand to see what the daemon sees, so it is the row's own
      // next step when there is nothing wrong — the same place `Runs as:` has in the disclosure.
      readyLine: command,
      readyLineIsCommand: true,
    },
    t,
    AGENT_ROW_LINE_BUDGET,
  );

  const facts = verdictFacts(
    {
      availability: provider.availability,
      env: provider.env,
      commandLine: command,
      locale,
      now: Date.now(),
    },
    t,
  );

  return (
    <AgentRow
      verdictLabel={t(verdict.chipKey)}
      verdictChip={verdict.chipClass}
      verdictAction={verdict.verdict === "not-ready"}
      name={provider.label}
      about={provider.detail}
      line={verdict.line}
      {...(verdict.command !== undefined ? { command: verdict.command } : {})}
      lineIsCommand={verdict.lineIsCommand}
      lineTitle={verdict.lineTitle ?? t(props.commandLabel, { command })}
      actions={
        /* **Remove, and it is not a hide.** This forgets a provider the *user declared* — an undo of their own
           action, which is why it exists only on this list and on no shipped agent — and its title says what it
           does and does not touch. Nothing is uninstalled. */
        <button
          type="button"
          className="button button--ghost button--small"
          title={t("settings.agents.mine.remove.title", { agent: provider.label })}
          onClick={props.onRemove}
        >
          {t("settings.agents.mine.remove")}
        </button>
      }
      details={
        <>
          {verdict.guide !== undefined ? <GuideBlock guide={verdict.guide} /> : null}
          <FactsBlock facts={facts} />
        </>
      }
    />
  );
}
