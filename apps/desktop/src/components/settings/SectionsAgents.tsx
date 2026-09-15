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
 * ## The three groups, and why they are three and not one
 *
 * | group | what it is | where its state comes from |
 * |---|---|---|
 * | **On this machine** | the nine agents we ship | `coder.listHarnesses` — probed, with the capabilities we verified |
 * | **Your agents** | the ones a user declared | `coder.listProviders` — probed by the same prober |
 * | **Add an agent** | the catalogue's recipes | **nothing, until the user asks about a row** |
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
 * the state each was measured in and the command that fixes it. A picker may drop an agent we established is
 * absent; the page never does, and its note under *New tasks* says so.
 *
 * ## The one action that does remove a row, and why it is not the same thing
 *
 * A **Remove** button forgets a provider the *user declared*. That is an undo of the user's own action —
 * they added it, they can un-add it — rather than a statement about an agent we shipped, which is the whole
 * difference between remove and hide. There is no remove control on a shipped agent, because there is
 * nothing of the user's to undo: the nine are what the product is.
 *
 * ## What is deliberately still read-only
 *
 * The **declared facts** — modes, models, thinking levels, and the capability warnings — are the agent's own
 * answers from its last handshake, and there is nothing here to change about them. That is why they are a
 * definition list rather than rows of controls: a page whose whole value is "this is what the agent said
 * about itself" must not look like it could be edited.
 */

import type { JSX } from "react";

import { useCallback, useState } from "react";

import type { HarnessAvailability, HarnessSummary } from "@envoycoder/protocol";

import { availabilityOf } from "../../composer/agent-for.js";
import { useI18n } from "../../i18n/context.js";
import { localizeText } from "../../i18n/notice.js";
import type { Translator } from "../../i18n/translate.js";
import { modeLabel, optionLabel } from "../../composer/controls.js";
import type { SettingsSectionProps } from "./SectionProps.js";
import { ROW_STATE_CHIP, ROW_STATE_LABEL, authChipKeys } from "./agent-catalog.js";
import { CatalogList } from "./CatalogRows.js";

/**
 * The section, as the pane renders it.
 *
 * One component holding four groups is deliberate rather than lazy: the search box, the probe results and
 * the "adding…" flags are shared state between the catalogue list and the manual form, and a component split
 * for its own sake would have been three `useState`s lifted into a fourth place. What *is* split is the
 * rendering: the shipped and provider rows are here, the catalogue rows and the manual form are in
 * `CatalogRows.tsx`.
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
      <p className="settings__note">{t("settings.agents.note")}</p>

      <h2 className="settings__heading">{t("settings.agents.shipped.heading")}</h2>
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
          <li className="settings__agent">
            <span className="settings__agent-summary">{t("settings.agents.empty")}</span>
          </li>
        ) : null}
      </ul>

      {signInResult !== undefined ? (
        <p className="settings__note" role="status">
          {localizeText(t, signInResult) ?? signInResult}
        </p>
      ) : null}

      <h2 className="settings__heading">{t("settings.agents.mine.heading")}</h2>
      {can.providers ? (
        <ul className="settings__agents">
          {state.providers.map((provider) => (
            <li key={provider.id} className="settings__agent">
              <div className="settings__agent-head">
                <strong>{provider.label}</strong>
                <span className="settings__agent-summary">{provider.detail}</span>
                <span className={`chip ${ROW_STATE_CHIP[provider.availability.state]}`}>
                  {t(ROW_STATE_LABEL[provider.availability.state])}
                </span>
                {(provider.availability.fix ?? []).map((step) => (
                  <span key={step.command} className="settings__hint" title={step.url}>
                    {step.command}
                  </span>
                ))}
              </div>
              <p className="settings__agent-command">{commandText(t, provider.command, provider.args)}</p>
              {provider.env.length > 0 ? (
                <ul className="settings__agent-env">
                  {provider.env.map((variable) => (
                    // **Three states, and the third is why this slice exists.** `set` alone could not say
                    // where a value came from, and for a variable a catalogue recipe supplies, "is set"
                    // would send a user to export something EnvoyCoder is already providing. `from`
                    // distinguishes the two sources, and `undefined` is the daemon's own environment —
                    // which is where every credential still comes from and the only place one ever does.
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
              ) : null}
              <div className="settings__agent-facts">
                {/* **Remove, and it is not a hide.** This forgets a provider the *user declared* — an undo
                    of their own action, which is why it exists only on this list and on no shipped agent —
                    and its title says what it does and does not touch. Nothing is uninstalled. */}
                <button
                  type="button"
                  className="button button--ghost button--small"
                  title={t("settings.agents.mine.remove.title", { agent: provider.label })}
                  onClick={() => void agents.removeProvider(provider.id)}
                >
                  {t("settings.agents.mine.remove")}
                </button>
              </div>
            </li>
          ))}
          {state.providers.length === 0 ? (
            <li className="settings__agent">
              <span className="settings__agent-summary">{t("settings.agents.mine.empty")}</span>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="settings__note">{t("settings.agents.olderDaemon")}</p>
      )}

      <h2 className="settings__heading">{t("settings.agents.add.heading")}</h2>
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

/** The command line of a provider, as one readable string. `settings.agents.mine.command` labels it. */
function commandText(t: Translator["t"], command: string, args: readonly string[]): string {
  return t("settings.agents.mine.command", { command: [command, ...args].join(" ") });
}

/**
 * One of the nine agents we ship: its state, its own declared facts, and the one control a user has on it.
 *
 * That control is an **action on the agent** — trigger its own sign-in, offered only for the state the daemon
 * measured a sign-in requirement in. There is deliberately **no** control here that takes the agent out of a
 * list: a shipped agent is what this product is, and the pickers' contents are derived from the state chip
 * beside it rather than from anything the user can set (see the module doc).
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
  // boolean and no `availability`, and the same fact has to reach the chip, the install steps and the
  // sentence that explains the daemon is a build behind.
  const legacyDaemon = harness.availability === undefined;
  const auth = authChipKeys(harness.auth);

  return (
    <li className="settings__agent">
      <div className="settings__agent-head">
        <strong>{harness.label}</strong>
        <span className="settings__agent-summary">{harness.summary}</span>
        <RowFacts availability={availability} harness={harness} legacyDaemon={legacyDaemon} />
        {auth !== undefined ? (
          <span className={`chip ${auth.chip}`} title={t("settings.agents.auth.title")}>
            {t(auth.key)}
          </span>
        ) : null}
      </div>
      <DeclaredFacts harness={harness} />
      {props.canSignIn && harness.auth.state === "needs-signin" ? (
        <div className="settings__agent-facts">
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={props.signingIn}
            title={t("settings.agents.signIn.title", { agent: harness.label })}
            onClick={() => void props.onSignIn(harness)}
          >
            {props.signingIn
              ? t("settings.agents.signIn.working")
              : t("settings.agents.signIn")}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The chip and the commands for one agent.
 *
 * **The row's whole job, and the bug it was getting wrong.** This chip used to be
 * `available === false ? "Not installed" : …`, and a user who had installed Claude Code, Codex and DeepSeek
 * Harness read "Not installed" for all three: the agents were there and what was missing was the ACP *bridge*
 * we drive them through, plus a daemon that could not see `~/.local/bin` because a GUI launch hands it no
 * `PATH`. Five states now, each naming the thing that is actually absent — and `unknown` never renders as
 * "not installed", which is the one rule the state exists for.
 */
function RowFacts(props: {
  availability: HarnessAvailability;
  harness: HarnessSummary;
  legacyDaemon: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const { availability, harness, legacyDaemon } = props;
  return (
    <div className="settings__agent-facts">
      <span className={`chip ${ROW_STATE_CHIP[availability.state]}`}>
        {t(ROW_STATE_LABEL[availability.state])}
      </span>
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
      {availability.provisional ? (
        <span className="chip chip--warn" title={t(`settings.agent.provisional.${availability.provisional}`)}>
          {t("settings.agent.provisional")}
        </span>
      ) : null}
      {/* **The commands that fix it, in the entry's own words.** Deliberately not translated: a translated
          `npm install -g …` is a command that does not run. Shown only for the two states that assert
          something is missing, because `availability.fix` is present exactly then — a state that does not
          claim an absence must not offer an install command, and the schema rejects one that does.
          Every step, not only the first: for an agent driven through a bridge, the agent and the bridge are
          two installs, and naming one lands the user at the other a minute later. */}
      {(availability.fix ?? []).map((step) => (
        <span key={step.command} className="settings__hint" title={step.url}>
          {step.command}
        </span>
      ))}
      {/* A daemon **older than this field** sent a boolean, and `agentsAvailabilityOf` turned it into a state
          rather than inventing one. What it cannot do is say which of the two things was absent — so the row
          says that, and names the action that actually fixes it, rather than lending its authority to a claim
          the old daemon never made. */}
      {legacyDaemon ? (
        <span className="settings__hint">{t("settings.agent.olderDaemon")}</span>
      ) : null}
    </div>
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
   * document already records on the wire (§7.2). So the page says what happened instead: one sentence, in the
   * user's language, naming the cause and the one action that fixes it.
   */
  if (harness.models === undefined || harness.thinking === undefined) {
    return <p className="settings__note">{t("settings.agent.notDeclared", { agent: harness.label })}</p>;
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
