/**
 * **Add an agent** — the catalogue's rows, and the form for one that is not in it.
 *
 * ## The rule this file exists to keep: a row's state is measured, never implied
 *
 * A catalogue entry is a *recipe*: a command line, a version, and a link to where the tool comes from.
 * "It is in the catalogue" says nothing about this machine, so a row starts in a state of its own —
 * **`unchecked`** — and offers the button that finds out. `ROW_STATE_LABEL` carries that word (`Not checked
 * yet`), and `rowStateOf` is the only function that turns a measurement into a chip, so there is no path by
 * which a row could read `ready` without one.
 *
 * ## What a Check costs, said on the row
 *
 * The button is not free and the row says so, in the user's language, before they press it: one search of
 * this machine's program directories, **one row at a time**, with no process started and nothing downloaded.
 * (The download is real, and it is the other sentence on the row: an `npx -y …` recipe fetches its package
 * from npm on the first *run*, once, which is why such a row needs no install at all.) A screen that probed
 * all 38 while opening would be a screen that spends the user's machine on rows nobody looked at, which is
 * the defect this per-row design exists to prevent.
 *
 * ## The manual form, and the one thing it must not accept
 *
 * The daemon takes an agent nobody catalogued (`coder.addProvider`), so this form exists for it: a name, a
 * program, arguments, the **names** of any environment variables, and — required, with no default — a
 * statement of how the program is spoken to. The dialect has no default because a default would be us
 * choosing on the user's behalf for a program we cannot see, and both answers are wrong in a way nobody can
 * detect. The form says the same thing about the environment field that the schema enforces: **names, never
 * values**, because the value is read from the environment EnvoyCoder's daemon runs in and a credential must
 * never be written down.
 */

import type { JSX } from "react";

import { useCallback, useMemo, useState } from "react";

import type { CatalogEntry, CatalogProbe } from "@envoycoder/protocol";

import { useI18n } from "../../i18n/context.js";
import { localize, type Notice } from "../../i18n/notice.js";
import { formatWhen } from "../../i18n/when.js";
import type { AgentActions } from "../../state/agent-actions.js";
import type { CoderState } from "../../state/coderStore.js";
import {
  ROW_STATE_CHIP,
  ROW_STATE_LABEL,
  addInputFor,
  addedProviderIds,
  catalogRows,
  checkForces,
  commandLineOf,
  parseEnvNames,
  providerIdFrom,
  rowBlocker,
  rowStateOf,
  splitArgs,
  type CatalogRowProbe,
} from "./agent-catalog.js";

/** What the catalogue half needs: the window's state, and the actions it may take. */
export interface CatalogListProps {
  state: CoderState;
  agents: AgentActions;
}

/**
 * The search box, the rows, and the form for an agent nobody catalogued.
 *
 * The probe results live here rather than in the store because they belong to the **row the user pressed**:
 * the daemon keeps the cache (it is globally true, and a second window must not make it search again), and
 * this holds what this window has been told about the rows on screen.
 */
export function CatalogList(props: CatalogListProps): JSX.Element {
  const { t } = useI18n();
  const { state, agents } = props;
  const [query, setQuery] = useState("");
  const [probes, setProbes] = useState<Record<string, CatalogRowProbe>>({});
  const [adding, setAdding] = useState<string | undefined>();
  /** What the last add, remove or probe said, when it said anything the row itself cannot show. */
  const [notice, setNotice] = useState<Notice | undefined>();

  const addedIds = useMemo(() => addedProviderIds(state.providers), [state.providers]);
  const rows = useMemo(() => catalogRows(state.catalog, query), [state.catalog, query]);

  const onCheck = useCallback(
    async (entry: CatalogEntry): Promise<void> => {
      setProbes((current) => ({ ...current, [entry.id]: { state: "checking" } }));
      setNotice(undefined);
      const result = await agents.probeCatalogAgent(entry.id, {
        // The first press asks the daemon what it knows; a press after an answer means *measure it now*,
        // which is what a user who has just installed something is asking for. See `checkForces`.
        force: checkForces(probes[entry.id]),
      });
      setProbes((current) => ({
        ...current,
        [entry.id]: result.ok
          ? measured(result.probe)
          : { state: "refused", notice: { message: result.message, key: result.key, ...(result.values ? { values: result.values } : {}) } },
      }));
    },
    [agents, probes],
  );

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

  return (
    <>
      <p className="settings__note">{t("settings.agents.add.note")}</p>

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

      {notice !== undefined ? (
        <p className="settings__note settings__note--refused" role="status">
          {localize(t, notice)}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="settings__note">{t("settings.agents.add.noMatches", { query })}</p>
      ) : (
        <ul className="settings__catalog">
          {rows.map((entry) => (
            <CatalogRow
              key={entry.id}
              entry={entry}
              probe={probes[entry.id]}
              blocker={rowBlocker(entry, addedIds)}
              busy={adding === entry.id}
              onCheck={onCheck}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}

      <ManualAgentForm agents={agents} />
    </>
  );
}

/** A probe's answer, as the row's own state. Kept here so the row has one shape to branch on. */
function measured(probe: CatalogProbe): CatalogRowProbe {
  return {
    state: "measured",
    availability: probe.availability,
    observedAt: probe.observedAt,
    costMs: probe.costMs,
    cached: probe.cached,
  };
}

/**
 * One catalogued agent: what it is, how it is obtained, what this machine says about it, and the two things
 * a user can do with it.
 *
 * ## The install guidance is the **entry's**, and it is shown whether or not anything was measured
 *
 * That order is deliberate. A user who has to install Goose needs the link and the command *now*, and making
 * them press *Check* first to be told "not installed, here is where to get it" is a step that exists only
 * because the screen was built around the probe. The two facts are different in kind — the recipe is data
 * (`npx`-fetched or not, and where the tool lives) and the state is a measurement — so they are rendered in
 * different places and neither waits for the other. The link is always shown; the *state* is never assumed.
 */
function CatalogRow(props: {
  entry: CatalogEntry;
  probe: CatalogRowProbe | undefined;
  blocker: "built-in" | "already-added" | undefined;
  busy: boolean;
  onCheck: (entry: CatalogEntry) => Promise<void>;
  onAdd: (entry: CatalogEntry) => Promise<void>;
  onRemove: (entry: CatalogEntry) => Promise<void>;
}): JSX.Element {
  const { t, locale } = useI18n();
  const { entry, probe } = props;
  // The entry travels with the probe, because the word a user reads is derived from two facts: what was
  // measured, and how the program is obtained. For an `npx -y …` recipe "the program resolves" means `npx`
  // resolved, and the chip says so rather than claiming a verification nobody performed. See `rowStateOf`.
  const state = rowStateOf(entry, probe);
  // The fix is only ever present on a measurement that asserts an absence, which is the schema's rule rather
  // than this component's: `HarnessAvailability.fix` cannot exist on `ready`.
  const fix = probe?.state === "measured" ? (probe.availability.fix ?? []) : [];

  return (
    <li className="settings__catalog-row">
      <div className="settings__agent-head">
        <span className={`chip ${ROW_STATE_CHIP[state]}`}>{t(ROW_STATE_LABEL[state])}</span>
        <strong>{entry.title}</strong>
        <span className="settings__catalog-version">
          {t("settings.agents.row.version", { version: entry.version })}
        </span>
      </div>
      {/* **One line, because a list of thirty-eight is read by scanning.** The description is third-party
          wording and some entries run to two hundred characters; at full length one row measures 220px and
          the list becomes eighteen screens. So it is clamped to a single line with the whole sentence in the
          `title` — *nothing is hidden*, it is one hover away, and a screen reader reads all of it because the
          text is still in the document. Measured before and after this change: see §7.13. */}
      <p className="settings__agent-summary" title={entry.description}>
        {entry.description}
      </p>
      {/* **The command and the install guidance on one line, which is the pair a user acts on.** The command
          is monospaced and selectable because it is what they would paste into a terminal; the sentence
          beside it is the one that differs by shape, and it matters which one they read. An `npx` recipe
          installs itself on the first run — there is nothing to fetch by hand, and a row that said "install
          it" would send somebody to a download page for a program that has no installer. The other shape
          names the tool and links to where its own documentation says to get it. */}
      <p className="settings__catalog-facts">
        <code className="settings__agent-command">{commandLineOf(entry)}</code>
        <span className="settings__hint">
          {entry.install.kind === "npx"
            ? t("settings.agents.row.needsNoInstall", {
                package: entry.install.package,
                agent: entry.title,
              })
            : t("settings.agents.row.install", {
                agent: entry.title,
                command: commandLineOf(entry),
              })}
        </span>
        {entry.installLink !== "" ? (
          <a
            className="settings__link"
            href={entry.installLink}
            target="_blank"
            rel="noreferrer noopener"
            title={t("settings.agents.row.installLink.title", { agent: entry.title })}
          >
            {t("settings.agents.row.installLink")}
          </a>
        ) : null}
      </p>
      {entry.env.length > 0 ? (
        // **The recipe's own constants, and the sentence says they are supplied rather than owed.**
        // This used to read "set these in the environment EnvoyCoder runs in", because a provider config
        // could carry names only and the value was dropped on the way across. It cannot say that any more:
        // the entry's constants travel with the reference, so what a user needs to know is which variables
        // the recipe sets for them — and that exporting one is how they change it. The *values* are
        // deliberately not printed: they are ours, they are in the catalogue, and a row is not the place to
        // read a constant that no user action depends on.
        <p className="settings__hint">
          {t("settings.agents.row.recipeEnv", {
            names: entry.env.map((constant) => constant.name).join(", "),
          })}
        </p>
      ) : null}
      {fix.map((step) => (
        <p key={step.command} className="settings__hint" title={step.url}>
          {step.command}
        </p>
      ))}
      {probe?.state === "measured" ? (
        <p className="settings__hint">
          {probe.cached
            ? t("settings.agents.row.checked.cached", { when: formatWhen(probe.observedAt, locale) })
            : t("settings.agents.row.checked", {
                when: formatWhen(probe.observedAt, locale),
                ms: probe.costMs,
              })}
        </p>
      ) : null}
      {probe?.state === "refused" ? (
        <p className="settings__note settings__note--refused" role="status">
          {localize(t, probe.notice)}
        </p>
      ) : null}
      <div className="settings__agent-facts">
        <button
          type="button"
          className="button button--secondary button--small"
          disabled={probe?.state === "checking"}
          title={t("settings.agents.row.check.title")}
          onClick={() => void props.onCheck(entry)}
        >
          {probe?.state === "checking"
            ? t("settings.agent.checking")
            : probe === undefined
              ? t("settings.agents.row.check")
              : t("settings.agents.row.checkAgain")}
        </button>
        {props.blocker === "built-in" ? (
          // Shown rather than hidden: a user looking for Cursor must find it. What it loses is the button,
          // because `resolveAgentEntry`'s rule is that a built-in wins — two rows answering to one id is the
          // ambiguity that rule removes.
          <span className="settings__hint">{t("settings.agents.row.builtIn")}</span>
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
          <button
            type="button"
            className="button button--primary button--small"
            disabled={props.busy}
            title={t("settings.agents.row.add.title", { agent: entry.title })}
            onClick={() => void props.onAdd(entry)}
          >
            {props.busy ? t("settings.agents.row.adding") : t("settings.agents.row.add")}
          </button>
        )}
      </div>
    </li>
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
      <p className="settings__note">{t("settings.agents.manual.note")}</p>

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
