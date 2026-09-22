/**
 * **Catalogue** — the 38 recipes, behind one press, and the form for a program that is not in it.
 *
 * Built-in harnesses and Added providers already share one Agents list on the page above. This block is
 * *browse*: recipes that are not yet on that list. **Add** materialises a recipe as a provider so a task
 * can name it; without that step the daemon has no command line to launch.
 */

import type { JSX } from "react";

import { useCallback, useMemo, useState } from "react";

import type { CatalogEntry } from "@envoydev/protocol";

import { useI18n } from "../../i18n/context.js";
import { localize, type Notice } from "../../i18n/notice.js";
import type { AgentActions } from "../../state/agent-actions.js";
import type { CoderState } from "../../state/coderStore.js";
import { AgentRow } from "./AgentRow.js";
import { FactsBlock, GuideBlock } from "./RowGuide.js";
import type { FixRunAnswer } from "./FixRunner.js";
import { rowVerdict, verdictFacts } from "./agent-verdict.js";
import { AGENT_ROW_LINE_BUDGET } from "./density.js";
import {
  addInputFor,
  addedProviderIds,
  catalogRows,
  commandLineOf,
  parseEnvNames,
  providerIdFrom,
  rowBlocker,
  splitArgs,
} from "./agent-catalog.js";

/** What the catalogue half needs: the window's state, and the actions it may take. */
export interface CatalogListProps {
  state: CoderState;
  agents: AgentActions;
}

/**
 * The heading, the two entry points, and — when one of them has been pressed — the list or the form.
 *
 * The probe results live here rather than in the store because they belong to the **row the user pressed**:
 * the daemon keeps the cache (it is globally true, and a second window must not make it search again), and
 * this holds what this window has been told about the rows on screen.
 *
 * **Which of the two panels is open is one value, not two booleans**, so "search and the form at the same
 * time" is not a state this page can be in. The heading, both buttons and the count are outside the panel,
 * which is what makes "nothing becomes invisible" a structural property rather than a promise.
 */
export function CatalogList(props: CatalogListProps): JSX.Element {
  const { t } = useI18n();
  const { state, agents } = props;
  /**
   * Does this daemon serve the press that runs a fix?
   *
   * The same build-skew rule the rest of the page follows: a control whose press would come back "Method not
   * found" is not drawn at all. Read from `hello`'s own method list rather than through a new field, because
   * that list *is* the daemon's method catalogue.
   */
  const runFixSupported = state.hello?.methods.includes("coder.runFix") === true;
  /** `undefined` — nothing open; `"browse"` — the list; `"manual"` — the form for a program of your own. */
  const [panel, setPanel] = useState<"browse" | "manual" | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string | undefined>();
  /** What the last add or remove said, when it said anything the row itself cannot show. */
  const [notice, setNotice] = useState<Notice | undefined>();

  const addedIds = useMemo(() => addedProviderIds(state.providers), [state.providers]);
  const rows = useMemo(() => catalogRows(state.catalog, query), [state.catalog, query]);

  const onAdd = useCallback(
    async (entry: CatalogEntry): Promise<void> => {
      setAdding(entry.id);
      setNotice(undefined);
      // **Every field is the row's own**, including the dialect — see `addInputFor`. Nothing is decided here.
      const result = await agents.addProvider(addInputFor(entry));
      setAdding((current) => (current === entry.id ? undefined : current));
      if (!result.ok) setNotice({ message: result.message, key: result.key });
    },
    [agents],
  );

  const onRemove = useCallback(
    async (entry: CatalogEntry): Promise<void> => {
      setAdding(entry.id);
      setNotice(undefined);
      const result = await agents.removeProvider(entry.id);
      setAdding((current) => (current === entry.id ? undefined : current));
      if (!result.ok) setNotice({ message: result.message, key: result.key });
    },
    [agents],
  );

  const toggle = (which: "browse" | "manual"): void =>
    setPanel((current) => (current === which ? undefined : which));

  return (
    <>
      <h2 className="settings__heading">
        {t("settings.agents.catalog.heading")}
        {" · "}
        <span className="settings__agent-count">{state.catalog.length}</span>
      </h2>

      {/* **The two ways in, always on screen.** They are the entry points the count above them makes worth
          pressing, and they stay rendered whether a panel is open or not — a control that disappears when its
          panel opens is a page with no way back that is not a scroll. */}
      <div className="settings__agent-entry">
        <button
          type="button"
          className="button button--secondary button--small"
          aria-expanded={panel === "browse"}
          title={t("settings.agents.catalog.browse.title")}
          onClick={() => toggle("browse")}
        >
          {panel === "browse" ? t("settings.agents.catalog.hide") : t("settings.agents.catalog.browse")}
        </button>
        <button
          type="button"
          className="button button--ghost button--small"
          aria-expanded={panel === "manual"}
          title={t("settings.agents.manual.open.title")}
          onClick={() => toggle("manual")}
        >
          {t("settings.agents.manual.open")}
        </button>
      </div>

      {notice !== undefined ? (
        <p className="settings__note settings__note--refused" role="status">
          {localize(t, notice)}
        </p>
      ) : null}

      {panel === "browse" ? (
        <>
          <div className="settings__catalog-search">
            {/* **The label wraps the control, and only the label's own words are its accessible name.** The
                alternative — a wrapping `<label>` around a title *and* a detail sentence — gives an input a name
                like "Environment variable names Names only, separated by commas…", which is what a screen reader
                would read out. So the detail sits outside the label, and `getByLabelText` finds one exact string. */}
            <label className="settings__field">
              <span className="setting__title">{t("settings.agents.search.label")}</span>
              <input
                type="search"
                className="input"
                value={query}
                placeholder={t("settings.agents.search.placeholder")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>

          {rows.length === 0 ? (
            <p className="settings__note">{t("settings.agents.add.noMatches", { query })}</p>
          ) : (
            <ul className="settings__catalog">
              {rows.map((entry) => (
                <CatalogRow
                  key={entry.id}
                  entry={entry}
                  blocker={rowBlocker(entry, addedIds)}
                  busy={adding === entry.id}
                  onAdd={onAdd}
                  onRemove={onRemove}
                  {...(runFixSupported ? { onRunFix: () => agents.runFix({ kind: "catalog", id: entry.id }) } : {})}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}

      {panel === "manual" ? <ManualAgentForm agents={agents} /> : null}
    </>
  );
}

/**
 * One catalogued agent: its **verdict**, the one line behind it, and the facts a user needs to decide.
 *
 * ## The row that used to begin as a chore
 *
 * This row started as *"Not checked yet"* with a *Check* button, because whether this machine can run a
 * recipe is a fact somebody has to measure and the measurement was believed to be expensive. It is not: the
 * daemon resolves it for all 38 rows before serving the list, so the row arrives with a verdict, and the two
 * things a user can *do* with it — **Add** it, or forget a provider they already declared — are the only
 * buttons on it. The `Check this machine` / `Check again` pair is gone, and so is the probe cache, the
 * `checking` state, the `refused` state and the "Not checked yet" word itself.
 *
 * ## Why the verdict is different on an `npx` row, in the row's own words
 *
 * Fourteen of these recipes are `npx -y <pkg> …`, and the probe looks for **`npx`** rather than the package —
 * looking for the package would report all fourteen as missing, which is what "nothing is downloaded yet"
 * honestly is. On the wire that is `ready`, and the old design narrowed it to a separate "Not downloaded yet"
 * state so the word would not claim a verification nobody performed.
 *
 * The mandate overrules the *word* and keeps the honesty, in the right place: *"an `npx` recipe → it is not a
 * problem: the program is fetched on first run, and say so."* So the verdict is **Ready** — because it is true
 * that a user can run this agent here, and false that a package they must go and fetch is missing — and the
 * row **says so as a property**: `Obtained: Fetched from npm on the first run (pkg)`. Nothing is claimed
 * about the agent's own protocol surface, because that cannot be known without starting it, and that half is
 * the disclosure's `Verified` fact.
 */
function CatalogRow(props: {
  entry: CatalogEntry;
  blocker: "built-in" | "already-added" | undefined;
  busy: boolean;
  onAdd: (entry: CatalogEntry) => Promise<void>;
  onRemove: (entry: CatalogEntry) => Promise<void>;
  /** The press that runs this recipe's fix — see `ShippedAgent`'s prop for why it is a closure. */
  onRunFix?: () => Promise<FixRunAnswer>;
}): JSX.Element {
  const { t, locale } = useI18n();
  const { entry } = props;

  const install =
    entry.install.kind === "npx"
      ? ({ kind: "npx", package: entry.install.package } as const)
      : ({ kind: "binary", binary: entry.install.binary } as const);

  const verdict = rowVerdict(
    {
      label: entry.title,
      // `undefined` for a daemon from an older build, which does not send the field at all: the row then says
      // the daemon is behind rather than inventing a verdict about somebody's machine.
      availability: entry.availability,
      install,
      installLink: entry.installLink === "" ? undefined : entry.installLink,
      // What the row says when there is nothing to fix. For an `npx` recipe that is *Nothing to install* —
      // which is the mandate's "and say so", said on the face of the row rather than only in the disclosure.
      readyLine:
        entry.install.kind === "npx"
          ? t("settings.agents.row.nothingToInstall")
          : t("settings.agents.row.readyCatalogued"),
    },
    t,
    AGENT_ROW_LINE_BUDGET,
  );

  const facts = verdictFacts(
    {
      availability: entry.availability,
      install,
      recipeEnv: entry.env.map((constant) => constant.name),
      locale,
      now: Date.now(),
    },
    t,
  );

  return (
    <AgentRow
      className="settings__catalog-row"
      verdictLabel={t(verdict.chipKey)}
      verdictChip={verdict.chipClass}
      verdictAction={verdict.verdict === "not-ready"}
      name={entry.title}
      about={entry.description}
      line={verdict.line}
      {...(verdict.command !== undefined ? { command: verdict.command } : {})}
      lineIsCommand={verdict.lineIsCommand}
      {...(verdict.lineTitle !== undefined ? { lineTitle: verdict.lineTitle } : {})}
      actions={
        <>
          {props.blocker === "built-in" ? (
            // Shown rather than hidden: a user looking for Cursor must find it. What it loses is the button,
            // because `resolveAgentEntry`'s rule is that a built-in wins — two rows answering to one id is the
            // ambiguity that rule removes.
            <span className="settings__agent-note" title={t("settings.agents.row.builtIn")}>
              {t("settings.agents.row.builtIn.short")}
            </span>
          ) : props.blocker === "already-added" ? (
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={props.busy}
              title={t("settings.agents.mine.remove.title", { agent: entry.title })}
              onClick={() => void props.onRemove(entry)}
            >
              {t("settings.agents.mine.remove")}
            </button>
          ) : (
            <span className="settings__agent-note" title={t("settings.agents.row.pick.title", { agent: entry.title })}>
              {t("settings.agents.row.pick.short")}
            </span>
          )}
        </>
      }
      details={
        <>
          {/* The way out first, then the facts — the same order as every other row on the page. */}
          {verdict.guide !== undefined ? (
            <GuideBlock guide={verdict.guide} {...(props.onRunFix !== undefined ? { run: props.onRunFix } : {})} />
          ) : null}
          {/* The description is third-party wording and some entries run to two hundred characters, which is
              why it is here rather than on the row: it is what a user reads when they have decided this recipe
              might be the one, and it is noise to a user scanning thirty-eight. */}
          <p className="settings__agent-fact">{entry.description}</p>
          {/* The command, monospaced and selectable because it is what they would paste into a terminal. */}
          <p className="settings__agent-fact">
            <code className="settings__agent-command">{commandLineOf(entry)}</code>
            <span className="settings__agent-note">
              {t("settings.agents.row.version", { version: entry.version })}
            </span>
          </p>
          <FactsBlock facts={facts} />
        </>
      }
    />
  );
}

/**
 * An agent that is **not in the catalogue at all** — the form `coder.addProvider` was built for.
 *
 * ## The one field with no default
 *
 * *How it speaks* is a required choice with neither option preselected, and that is the point of the field
 * rather than an oversight in the form. A default would be us choosing a dialect for a program we cannot
 * see: `"acp"` sends an `initialize` to a one-shot CLI that will never answer it, and `"cli"` tells a user
 * their ACP agent is unsupported. `AgentProviderConfig` requires the field for exactly this reason, and a
 * form that supplied one would move the guess from the schema into the UI.
 *
 * ## The environment field is names, and the label says so
 *
 * The schema has no place for a value, and the daemon refuses an entry that is not a variable name — with a
 * sentence that deliberately does not quote back what was typed, because what people paste into a field
 * labelled "environment" is very often the credential itself. The form shows the same rule before the press
 * rather than after it.
 */
function ManualAgentForm(props: { agents: AgentActions }): JSX.Element {
  const { t } = useI18n();
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [transport, setTransport] = useState<"acp" | "cli" | "">("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>();

  const ready = label.trim() !== "" && command.trim() !== "" && transport !== "";

  const onSubmit = useCallback(
    async (event: { preventDefault: () => void }): Promise<void> => {
      event.preventDefault();
      if (!ready) return;
      setBusy(true);
      setNotice(undefined);
      const result = await props.agents.addProvider({
        // The id is derived from the name the user typed, by the daemon's own rule: the form does not ask
        // for a second identifier for one agent.
        id: providerIdFrom(label),
        label: label.trim(),
        command: command.trim(),
        args: splitArgs(args),
        env: parseEnvNames(env),
        // Narrowed by `ready`: the button cannot be pressed without an answer here.
        transport: transport === "cli" ? "cli" : "acp",
      });
      setBusy(false);
      if (!result.ok) {
        setNotice({ message: result.message, key: result.key });
        return;
      }
      setLabel("");
      setCommand("");
      setArgs("");
      setEnv("");
      setTransport("");
    },
    [args, command, env, label, props.agents, ready, transport],
  );

  return (
    <form className="settings__manual" onSubmit={(event) => void onSubmit(event)}>
      <h3 className="settings__heading">{t("settings.agents.manual.heading")}</h3>

      <label className="settings__field">
        <span className="setting__title">{t("settings.agents.manual.label")}</span>
        <input
          type="text"
          className="input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>

      <label className="settings__field">
        <span className="setting__title">{t("settings.agents.manual.command")}</span>
        <input
          type="text"
          className="input"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
        />
      </label>

      <label className="settings__field">
        <span className="setting__title">{t("settings.agents.manual.args")}</span>
        <input
          type="text"
          className="input"
          value={args}
          onChange={(event) => setArgs(event.target.value)}
        />
      </label>

      <div className="settings__field">
        <label className="settings__field-label">
          <span className="setting__title">{t("settings.agents.manual.env")}</span>
          <input
            type="text"
            className="input"
            value={env}
            onChange={(event) => setEnv(event.target.value)}
          />
        </label>
        <span className="setting__detail">{t("settings.agents.manual.env.detail")}</span>
      </div>

      <fieldset className="settings__field">
        <legend className="setting__title">{t("settings.agents.manual.transport")}</legend>
        <span className="setting__detail">{t("settings.agents.manual.transport.detail")}</span>
        <label className="settings__radio">
          <input
            type="radio"
            name="agent-transport"
            value="acp"
            checked={transport === "acp"}
            onChange={() => setTransport("acp")}
          />
          <span>{t("settings.agents.manual.transport.acp")}</span>
        </label>
        <label className="settings__radio">
          <input
            type="radio"
            name="agent-transport"
            value="cli"
            checked={transport === "cli"}
            onChange={() => setTransport("cli")}
          />
          <span>{t("settings.agents.manual.transport.cli")}</span>
        </label>
      </fieldset>

      {notice !== undefined ? (
        <p className="settings__note settings__note--refused" role="status">
          {localize(t, notice)}
        </p>
      ) : null}

      <button type="submit" className="button button--primary" disabled={!ready || busy}>
        {busy ? t("settings.agents.row.adding") : t("settings.agents.manual.submit")}
      </button>
    </form>
  );
}
