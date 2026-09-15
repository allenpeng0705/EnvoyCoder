/**
 * **Agents** — every agent this machine can run, what each one actually is, and the two ways to get one
 * that is not there yet.
 *
 * ## What this page is for
 *
 * The product's claim is that EnvoyCoder is the control plane for coding agents, and this is the screen
 * that has to make that true: the nine agents we ship, the ones a user declared, and the 38 recipes in the
 * catalogue — **in one place, searchable**, each row carrying the state a probe measured rather than a
 * state a list implies. Before this page the catalogue existed in `@envoycoder/agent-catalog` and no
 * surface read it, so a user with Gemini CLI installed had a product that supported it and no way to find
 * out.
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
 * | **On this machine** | the nine agents we ship | `coder.listHarnesses` — probed, with the capabilities we verified |
 * | **Your agents** | the ones a user declared | `coder.listProviders` — probed by the same prober |
 * | **Catalogue** | the 38 recipes | **nothing, until the user asks about a row** |
 *
 * The third group is the one that could lie, and the whole design of it is about not doing so. A catalogue
 * entry is a *recipe*: a command line and a link. Whether this machine can run it is a fact somebody has to
 * measure, so the row starts as **"Not checked yet"** and offers the action that finds out — one row, on the
 * user's press, because 14 of the 38 are `npx` recipes and a screen that probed them all while opening would
 * be a screen that downloads fourteen npm packages because somebody clicked *Settings*.
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
import { modeLabel, optionLabel } from "../../composer/controls.js";
import type { SettingsSectionProps } from "./SectionProps.js";
import { ROW_STATE_CHIP, ROW_STATE_LABEL, authChipKeys } from "./agent-catalog.js";
import { AgentRow, fixOrPhrase } from "./AgentRow.js";
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
          <li className="settings__agent">
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
            <li className="settings__agent">
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
 * One of the nine agents we ship: its state, the one line that says what to do, and its own declared facts
 * behind `Details`.
 *
 * The one control a user has on it is an **action on the agent** — trigger its own sign-in, offered only for
 * the state the daemon measured a sign-in requirement in. There is deliberately **no** control here that takes
 * the agent out of a list: a shipped agent is what this product is, and the pickers' contents are derived from
 * the state chip beside it rather than from anything the user can set (see the module doc).
 */
function ShippedAgent(props: {
  harness: HarnessSummary;
  canSignIn: boolean;
  signingIn: boolean;
  onSignIn: (harness: HarnessSummary) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const { harness } = props;
  const availability = availabilityOf(props.harness);
  // The wire generation is decided **once per row**, here, and not inside the chip: an older daemon sends a
  // boolean and no `availability`, and the same fact has to reach the chip, the fix and the sentence that
  // explains the daemon is a build behind.
  const legacyDaemon = harness.availability === undefined;
  const auth = authChipKeys(harness.auth);

  /**
   * **The one line.** Four sources, in the order a user would act on them.
   *
   * The fix first, because a row whose program is missing is the one row with something to do. Then the two
   * daemon-skew cases, whose action is the same and is named in four words rather than a sentence. Then the
   * tier, which is the honest answer for an agent that is simply working: there is no action, and "Ships with
   * EnvoyCoder" is a fact rather than a filler.
   */
  const fix = availability.fix ?? [];
  const line = fixOrPhrase(
    fix,
    legacyDaemon || harness.models === undefined || harness.thinking === undefined
      ? t("settings.agents.row.restart")
      : t(harness.tier === "built-in" ? "settings.agent.tier.builtIn" : "settings.agent.tier.catalogued"),
    AGENT_ROW_LINE_BUDGET,
  );

  return (
    <AgentRow
      stateLabel={t(ROW_STATE_LABEL[availability.state])}
      stateChip={ROW_STATE_CHIP[availability.state]}
      name={harness.label}
      about={harness.summary}
      line={line.line}
      lineIsCommand={line.isCommand}
      {...(line.title !== undefined ? { lineTitle: line.title } : {})}
      chips={
        <>
          {auth !== undefined ? (
            <span className={`chip ${auth.chip}`} title={t("settings.agents.auth.title")}>
              {t(auth.key)}
            </span>
          ) : null}
          {harness.capabilities.approvals ? null : (
            <span className="chip chip--warn" title={t("settings.agent.noApprovals.title")}>
              {t("settings.agent.noApprovals")}
            </span>
          )}
          {harness.capabilities.cancel ? null : (
            <span className="chip chip--warn" title={t("settings.agent.noCancel.title")}>
              {t("settings.agent.noCancel")}
            </span>
          )}
          {/* **The provenance of a program found in somebody else's cache.** `dsh` can resolve out of
              `~/.npm/_npx/<hash>/node_modules/.bin` — it is a real program and it really runs, so calling it
              absent would be false, but it disappears with `npm cache clean`, so saying nothing would be the
              other half of the same lie. One warn chip, and one sentence per cache naming what removes it. */}
          {availability.provisional !== undefined ? (
            <span
              className="chip chip--warn"
              title={t(`settings.agent.provisional.${availability.provisional}`)}
            >
              {t("settings.agent.provisional")}
            </span>
          ) : null}
        </>
      }
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
      details={<DeclaredFacts harness={harness} />}
    />
  );
}

/**
 * One provider the **user** declared: its state, the command it runs, and its environment names.
 *
 * The declared facts block is darker here than on a shipped agent, and not for symmetry: the row's own state
 * rests on an environment this daemon may not have, so the environment *names* are the first thing a user
 * needs when the row says `not-installed` — see `settings.agents.mine.env.*`.
 */
function ProviderRow(props: {
  provider: SettingsSectionProps["state"]["providers"][number];
  /**
   * The label for the provider's command line, passed in as a **key** rather than as a string.
   *
   * `MessageKey` and not `string`, because this row renders it in two places — the line's `title` and the
   * disclosure's first entry — and a caller that handed it pre-translated text would be able to pass anything.
   * Typing it as the catalogue's own key type is what makes a typo a compile error rather than a French window
   * with an English fragment in it.
   */
  commandLabel: MessageKey;
  onRemove: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { provider } = props;
  const fix = provider.availability.fix ?? [];
  const command = [provider.command, ...provider.args].join(" ");
  // The fix first, for the same reason as a shipped agent's row; and the command line second, because for a
  // provider that is *working* the command is the actionable fact — it is what the user would run by hand to
  // see what the daemon sees. The label goes to the `title` when the two are the same text twice.
  const line = fixOrPhrase(fix, command, AGENT_ROW_LINE_BUDGET);

  return (
    <AgentRow
      stateLabel={t(ROW_STATE_LABEL[provider.availability.state])}
      stateChip={ROW_STATE_CHIP[provider.availability.state]}
      name={provider.label}
      about={provider.detail}
      line={line.line}
      lineIsCommand={line.isCommand || fix.length === 0}
      lineTitle={line.title ?? t(props.commandLabel, { command })}
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
        <ul className="settings__agent-more">
          <li>{t(props.commandLabel, { command })}</li>
          {provider.env.map((variable) => (
            // **Three states, and the third is why this exists.** `set` alone could not say where a value came
            // from, and for a variable a catalogue recipe supplies, "is set" would send a user to export
            // something EnvoyCoder is already providing. `from` distinguishes the two sources, and the third is
            // the daemon's own environment — which is where every credential still comes from and the only place
            // one ever does.
            <li
              key={variable.name}
              className={`settings__env${
                variable.set
                  ? variable.from === "catalogue"
                    ? " settings__env--recipe"
                    : ""
                  : " settings__env--unset"
              }`}
              title={
                variable.from === "catalogue"
                  ? t("settings.agents.mine.env.recipe.title", { name: variable.name })
                  : t("settings.agents.mine.env.title", { name: variable.name })
              }
            >
              {variable.from === "catalogue"
                ? t("settings.agents.mine.env.recipe", { name: variable.name })
                : variable.set
                  ? t("settings.agents.mine.env.set", { name: variable.name })
                  : t("settings.agents.mine.env.unset", { name: variable.name })}
            </li>
          ))}
        </ul>
      }
    />
  );
}

/**
 * What one agent published about itself — the four facts a user needs to understand the controls it appears
 * beside.
 *
 * **Two rules, and both are about not lying.** First, a value that is *ours* is translated and a value that
 * is the *agent's* is shown as the agent wrote it: a mode we labelled (`ModeKind`) carries a catalogue key and
 * goes through `modeLabel`, a model label has no key in the protocol at all and is the agent's own word.
 * Second, the three states of `AgentThinking` are kept apart — `listed` (here are the levels), `session` (the
 * agent only publishes them inside a session, and we have not seen one) and `none` (it offers none) — because
 * collapsing the middle one into "none" is the exact sentence the protocol's own doc says must never be told
 * to a user.
 *
 * **Only ever rendered inside a disclosure**, which is what makes it a definition list rather than a band: 36
 * lines of an agent's own answers is what a user looks at when something is wrong, and it is not what the nine
 * rows are for.
 */
function DeclaredFacts(props: { harness: HarnessSummary }): JSX.Element {
  const { t } = useI18n();
  const { harness } = props;

  /**
   * **A daemon that did not answer is not a crash, and this was found by driving the window.**
   *
   * `models` and `thinking` are required by `HarnessSummary` — a daemon that follows this protocol always
   * sends them — but a daemon from an **older build** does not, and the window accepts its answer. A settings
   * page must not take the application down because the daemon is a build behind, which is a state this
   * document already records on the wire (§7.2). So the disclosure says what happened instead: one sentence,
   * in the user's language, naming the cause and the one action that fixes it — and the row's own line says
   * the same action in four words, so a user who never opens `Details` still knows what to do.
   */
  if (harness.models === undefined || harness.thinking === undefined) {
    return <p className="settings__agent-fact">{t("settings.agent.notDeclared", { agent: harness.label })}</p>;
  }

  // The one non-negotiable rule of the labels: translate what we wrote, show what the agent wrote.
  const modes = harness.modes.map((mode) => modeLabel(mode, t));
  const levels = harness.thinking.options.map((option) => optionLabel(option, t));
  // A model label carries no key in the protocol (`AgentModel`), so every one of these is the agent's own word
  // for itself and is shown exactly as it arrived.
  const models = harness.models.options.map((option) => option.label);

  return (
    <dl className="settings__agent-declared">
      <div>
        <dt>{t("settings.agent.tier.title")}</dt>
        <dd>
          {harness.tier === "built-in"
            ? t("settings.agent.tier.builtIn")
            : t("settings.agent.tier.catalogued")}
        </dd>
      </div>
      <div>
        <dt>{t("settings.agent.modes.title")}</dt>
        <dd>{modes.length === 0 ? t("settings.agent.noneDeclared") : modes.join(", ")}</dd>
      </div>
      <div>
        <dt>{t("settings.agent.models.title")}</dt>
        <dd>
          {/* Three states, kept apart — the protocol makes `models` required for exactly this reason:
              "free text" is not "none", and reading one as the other would tell a user their agent has no
              models when it takes any they type. */}
          {harness.models.kind === "free-text"
            ? t("settings.agent.modelsFreeText")
            : models.length === 0
              ? t("settings.agent.noneDeclared")
              : models.join(", ")}
        </dd>
      </div>
      <div>
        <dt>{t("settings.agent.thinking.title")}</dt>
        <dd>
          {harness.thinking.kind === "session"
            ? t("settings.agent.thinkingSession")
            : levels.length === 0
              ? t("settings.agent.noneDeclared")
              : levels.join(", ")}
        </dd>
      </div>
    </dl>
  );
}
