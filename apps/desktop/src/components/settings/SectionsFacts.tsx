/**
 * The four sections that **report rather than change**: Agents, Keyboard shortcuts, This machine, About.
 *
 * ## Why a settings pane has read-only pages, and why these four
 *
 * The pane's rule — *a control either does what it says or says why it cannot* — does not only forbid
 * dead switches. It also decides what a page may **claim**. These four pages claim nothing a user
 * cannot check against the thing itself:
 *
 *   * **Agents** reports what each agent published about itself in its own handshake (its tier, whether
 *     its binary is there, the modes, models and thinking levels it declared) and the capabilities that
 *     decide which warnings it carries. Every value comes from `HarnessSummary`, which is the daemon's
 *     answer, not our opinion — and the page is why a user can see that "this agent cannot be told to
 *     ask before acting" is a fact about the agent rather than a broken switch on the Safety page.
 *   * **Keyboard shortcuts** lists the bindings the window is **listening for** — the table filtered by
 *     the actions the shell actually mounted (`wiredBindings`) — drawn from the same registry the key
 *     handler reads, so it cannot drift from the behaviour. A key that is not on this page does nothing
 *     in this build, and the page says so in those words.
 *   * **This machine** is the daemon's own `hello` answer: which build it is, where it keeps its files,
 *     when it started, and how many windows are attached to it.
 *   * **About** is the one comparison a control plane needs: **this window's build against the
 *     daemon's**. Both halves of EnvoyCoder are built together, so a mismatch means one of them is a
 *     build behind — and a daemon a build behind can refuse settings this window writes (the wire
 *     asymmetry `docs/settings-parity.md` §7.2 records). That is a fact worth one row, and the row is
 *     the reason this page exists rather than being folded into a chip.
 *
 * ## What is deliberately *not* here
 *
 * No switches. Not one row on these pages can be changed, and none of them pretends otherwise: they are
 * reports, so there is nothing to disable and nothing to explain away. The audit's verdict for each
 * reference-product section that would have been a switch is in `docs/settings-parity.md` §7.6, and the
 * reference product's own `providers` page — credential management with the keys stored unredacted —
 * is the page the audit says in as many words that we should not copy.
 */

import type { JSX } from "react";

import type { HarnessAvailability, HarnessState, HarnessSummary } from "@envoycoder/protocol";

import { APP_VERSION } from "../../app-version.js";
import { availabilityOf } from "../../composer/agent-for.js";
import { modeLabel, optionLabel } from "../../composer/controls.js";
import { useI18n } from "../../i18n/context.js";
import { formatWhen } from "../../i18n/when.js";
import { currentPlatform } from "../../input/useShortcuts.js";
import {
  createShortcutRegistry,
  platformOf,
  type KeyBinding,
} from "../../input/shortcuts.js";
import type { MessageKey } from "../../i18n/messages/en.js";
import { SettingRow } from "../SettingsRows.js";
import { shortPath } from "../SettingsShell.js";
import type { SettingsSectionProps } from "./SectionProps.js";

/**
 * **Agents** — what is on this machine, and what each one says it can do.
 *
 * The page's whole value is that a user can answer *"why is that control off?"* by reading it: the
 * availability chip is the daemon's probe of the binary, the warnings are the agent's own capability
 * flags, and the declared list is what the agent published. Nothing here is inferred.
 */
export function AgentsSection(props: SettingsSectionProps): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <p className="settings__note">{t("settings.agents.note")}</p>
      <ul className="settings__agents">
        {props.state.harnesses.map((harness) => {
          // The wire generation is decided **once per row**, here, and not inside the chip: an older daemon
          // sends a boolean and no `availability`, and the same fact has to reach the chip, the install
          // steps and the sentence that explains the daemon is a build behind.
          const availability = availabilityOf(harness);
          const legacyDaemon = harness.availability === undefined;
          return (
            <li key={harness.id} className="settings__agent">
              <div className="settings__agent-head">
                <strong>{harness.label}</strong>
                <span className="settings__agent-summary">{harness.summary}</span>
                <RowFacts availability={availability} harness={harness} legacyDaemon={legacyDaemon} />
              </div>
              <DeclaredFacts harness={harness} />
            </li>
          );
        })}
        {props.state.harnesses.length === 0 ? (
          <li className="settings__agent">{t("settings.agents.empty")}</li>
        ) : null}
      </ul>
    </>
  );
}

/**
 * The chip and the commands for one agent, as a component of its own.
 *
 * Split out because the row's head is now long enough that the mapping tables below belong next to their
 * use rather than folded into the list, and because the three inputs are exactly the three facts the chip
 * needs: the availability, the agent (for the capability chips) and whether the daemon is a build behind.
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
      {/* **The row's whole job, and the bug it was getting wrong.**
          This chip used to be `available === false ? "Not installed" : …`, and a user who had installed
          Claude Code, Codex and DeepSeek Harness read "Not installed" for all three: the agents were there
          and what was missing was the ACP *bridge* we drive them through, plus a daemon that could not see
          `~/.local/bin` because a GUI launch hands it no `PATH`. Five states now, each naming the thing that
          is actually absent — and `unknown` never renders as "not installed", which is the one rule the
          state exists for. */}
      <span className={`chip ${AVAILABILITY_CHIP[availability.state]}`}>
        {t(AVAILABILITY_LABEL[availability.state])}
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
        <span
          className="chip chip--warn"
          title={t(`settings.agent.provisional.${availability.provisional}`)}
        >
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
      {/* A daemon **older than this field** sent a boolean, and `availabilityOf` turned it into a state
          rather than inventing one. What it cannot do is say which of the two things was absent — so the row
          says that, and names the action that actually fixes it, rather than lending its authority to a
          claim the old daemon never made. */}
      {legacyDaemon ? (
        <span className="settings__hint">{t("settings.agent.olderDaemon")}</span>
      ) : null}
    </div>
  );
}

/**
 * The chip's colour and its word, per state — one table each, so a state can never get one and not the other.
 *
 * The colours carry the same distinction the words do: `not-installed` is the only `danger`, because it is
 * the only state that asserts a program the user was told to install is not there. `needs-bridge` and
 * `unsupported` are warnings — something is wrong and it is not the user's mistake — and `unknown` is
 * quiet, deliberately: a state that asserts nothing must not look like an alarm.
 */
const AVAILABILITY_CHIP: Record<HarnessState, string> = {
  ready: "chip--live",
  unsupported: "chip--warn",
  "needs-bridge": "chip--warn",
  "not-installed": "chip--danger",
  unknown: "chip--quiet",
};

const AVAILABILITY_LABEL = {
  ready: "settings.agent.ready",
  unsupported: "settings.agent.unsupported",
  "needs-bridge": "settings.agent.needsBridge",
  "not-installed": "settings.agent.notInstalled",
  unknown: "settings.agent.unknown",
} as const satisfies Record<HarnessState, MessageKey>;

/**
 * What one agent published about itself — the four facts a user needs to understand the controls it
 * appears beside.
 *
 * **Two rules, and both are about not lying.** First, a value that is *ours* is translated and a value
 * that is the *agent's* is shown as the agent wrote it: a mode we labelled (`ModeKind`) carries a
 * catalogue key and goes through `modeLabel`, a model label has no key in the protocol at all and is
 * the agent's own word. Second, the three states of `AgentThinking` are kept apart — `listed` (here are
 * the levels), `session` (the agent only publishes them inside a session, and we have not seen one) and
 * `none` (it offers none) — because collapsing the middle one into "none" is the exact sentence the
 * protocol's own doc says must never be told to a user.
 */
function DeclaredFacts(props: { harness: HarnessSummary }): JSX.Element {
  const { t } = useI18n();
  const { harness } = props;

  /**
   * **A daemon that did not answer is not a crash, and this was found by driving the window.**
   *
   * `models` and `thinking` are required by `HarnessSummary` — a daemon that follows this protocol always
   * sends them — but a daemon from an **older build** does not, and the window accepts its answer. Measured
   * against the daemon that was already running on this machine while this page was being built: its
   * summaries carried `modes` and no `models`/`thinking`, and this component threw, which unmounted the
   * whole window (React has no boundary above the shell here) and left an empty page. A settings page must
   * not take the application down because the daemon is a build behind, which is a state this document
   * already records on the wire (§7.2).
   *
   * So the page says what happened instead: one sentence, in the user's language, naming the cause and the
   * one action that fixes it. It is the same shape as the `About` mismatch row, for the same reason.
   */
  if (harness.models === undefined || harness.thinking === undefined) {
    return <p className="settings__note">{t("settings.agent.notDeclared", { agent: harness.label })}</p>;
  }

  // The one non-negotiable rule of the labels: translate what we wrote, show what the agent wrote.
  const modes = harness.modes.map((mode) => modeLabel(mode, t));
  const levels = harness.thinking.options.map((option) => optionLabel(option, t));
  // A model label carries no key in the protocol (`AgentModel`), so every one of these is the agent's
  // own word for itself and is shown exactly as it arrived.
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
              "free text" is not "none", and reading one as the other would tell a user their agent has
              no models when it takes any they type. */}
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

/**
 * **Keyboard shortcuts** — the keys this window is listening for, and nothing else.
 *
 * The list is `wiredBindings`, not `SHELL_BINDINGS`: three of the eight bindings in the table have no
 * action mounted in this build, and printing one of their combos would advertise a key that does
 * nothing — in the pane whose whole reason for existing is that a control must not do that. The empty
 * state is a sentence rather than an empty list for the same reason.
 */
export function ShortcutsSection(props: SettingsSectionProps & {
  shortcuts: readonly KeyBinding[];
}): JSX.Element {
  const { t } = useI18n();
  // The platform decides what `Mod` reads as, exactly as the mounted key handler decides what it fires
  // on — one registry, one spelling, from the same two functions (`shortcuts.ts`).
  const registry = createShortcutRegistry(props.shortcuts, { platform: platformOf(currentPlatform()) });

  // Grouped in the table's own order, so the page and the help sheet cannot list the same keys in two
  // orders. A group is rendered where its first binding appears, which keeps this a projection of the
  // table rather than a second table.
  const groups: { key: MessageKey | undefined; bindings: KeyBinding[] }[] = [];
  for (const binding of props.shortcuts) {
    const key = binding.groupKey;
    const last = groups[groups.length - 1];
    if (last === undefined || last.key !== key) groups.push({ key, bindings: [binding] });
    else last.bindings.push(binding);
  }

  if (props.shortcuts.length === 0) {
    return <p className="settings__note">{t("settings.shortcuts.empty")}</p>;
  }

  return (
    <>
      <p className="settings__note">{t("settings.shortcuts.note")}</p>
      {groups.map((group, index) => (
        // A group without a key is a binding we forgot to classify: it renders as its own unlabelled
        // group rather than under whatever heading happened to precede it, which is the failure a
        // `Map` keyed by `undefined` would produce.
        <section key={group.key ?? `ungrouped-${index}`} className="settings__shortcut-group">
          {group.key !== undefined ? (
            <h3 className="settings__heading">{t(group.key)}</h3>
          ) : null}
          <ul className="settings__bindings">
            {group.bindings.map((binding) => (
              <li key={binding.id} className="settings__binding" title={binding.id}>
                <span className="setting__title">{t(binding.labelKey)}</span>
                {/* `<kbd>` rather than a `<span>`: this is a key a user presses, and the element is what
                    says so to a screen reader and to a stylesheet. */}
                <kbd className="kbd">{registry.display(binding.id)}</kbd>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/**
 * **This machine** — the daemon this window is attached to, as it described itself.
 *
 * Everything here is `coder.hello`'s answer, and the page is the long form of two chips that are already
 * in the pane's header on every page (the state folder and the build). The overlap is deliberate and
 * stated: a chip answers *"which daemon am I talking to"* at a glance while a user is reading a
 * different page, and this page is where the facts that do not fit in a chip live — the home folder, the
 * start time, and how many windows are attached to it.
 */
export function MachineSection(props: SettingsSectionProps): JSX.Element {
  const { t, locale } = useI18n();
  const { hello } = props.state;

  if (hello === undefined) {
    // Not an empty box: with no daemon there is nothing to report, and that is the sentence.
    return <p className="settings__note">{t("settings.machine.noDaemon")}</p>;
  }

  return (
    <>
      <p className="settings__note">{t("settings.machine.note")}</p>

      <SettingRow
        title={t("settings.machine.version.title")}
        detail={t("settings.machine.version.detail")}
        developerNote="hello.version"
      >
        <span className="chip chip--quiet">{hello.version}</span>
      </SettingRow>

      <SettingRow
        title={t("settings.machine.stateDir.title")}
        detail={t("settings.machine.stateDir.detail")}
        developerNote="hello.stateDir"
      >
        <span className="chip chip--quiet" title={hello.stateDir}>
          {shortPath(hello.stateDir)}
        </span>
      </SettingRow>

      <SettingRow
        title={t("settings.machine.home.title")}
        detail={t("settings.machine.home.detail")}
        developerNote="hello.home"
      >
        <span className="chip chip--quiet" title={hello.home}>
          {shortPath(hello.home)}
        </span>
      </SettingRow>

      <SettingRow
        title={t("settings.machine.started.title")}
        detail={t("settings.machine.started.detail")}
        developerNote="hello.startedAt"
      >
        <span className="chip chip--quiet">{formatWhen(hello.startedAt, locale)}</span>
      </SettingRow>

      <SettingRow
        title={t("settings.machine.windows.title")}
        detail={t("settings.machine.windows.detail")}
        developerNote="hello.windowCount"
      >
        {/* Two forms rather than a `{count} windows` template: "1 windows" is the form every language
            gets wrong, and a translator needs the singular as a sentence of its own. */}
        <span className="chip chip--quiet">
          {hello.windowCount === 1
            ? t("settings.machine.windows.one")
            : t("settings.machine.windows.many", { count: hello.windowCount })}
        </span>
      </SettingRow>
    </>
  );
}

/**
 * **About** — this window's build against the daemon's.
 *
 * The comparison is the whole page, and it is a real control-plane need rather than a decoration: both
 * halves ship together, so a difference means one of them is a build behind, and a daemon one build
 * behind can refuse settings this window writes (`docs/settings-parity.md` §7.2 records that asymmetry
 * on the wire, verified against `coder.getSettings`'s strict result schema).
 *
 * **When the window has no version of its own, it says so** rather than printing a placeholder that
 * looks like a number: this build's bundle is rendered by Vite without the define (`app-version.ts`),
 * and "there is nothing to compare" is the honest sentence. Comparing a guess would be worse than not
 * comparing at all.
 */
export function AboutSection(props: SettingsSectionProps): JSX.Element {
  const { t } = useI18n();
  const daemon = props.state.hello?.version;
  const window_ = APP_VERSION;

  const note =
    window_ === undefined || daemon === undefined
      ? t("settings.about.unknown")
      : window_ === daemon
        ? t("settings.about.match")
        : t("settings.about.mismatch", { window: window_, daemon });

  return (
    <>
      <p className="settings__note">{t("settings.about.note")}</p>

      <SettingRow
        title={t("settings.about.window.title")}
        detail={t("settings.about.window.detail")}
        developerNote="__ENVOYCODER_VERSION__"
      >
        <span className="chip chip--quiet">
          {window_ ?? t("settings.about.noVersion")}
        </span>
      </SettingRow>

      <SettingRow
        title={t("settings.about.daemon.title")}
        detail={t("settings.about.daemon.detail")}
        developerNote="hello.version"
      >
        <span className="chip chip--quiet">
          {daemon ?? t("settings.about.noVersion")}
        </span>
      </SettingRow>

      <p className="settings__note">{note}</p>
    </>
  );
}
