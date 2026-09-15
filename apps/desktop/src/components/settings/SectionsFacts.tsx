/**
 * The three sections that **report rather than change**: Keyboard shortcuts, This machine, About.
 *
 * ## Why a settings pane has read-only pages, and why these three
 *
 * The pane's rule — *a control either does what it says or says why it cannot* — does not only forbid
 * dead switches. It also decides what a page may **claim**. These three pages claim nothing a user
 * cannot check against the thing itself:
 *
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
 *
 * **Agents is no longer one of these pages, and its absence from this file is that change.** It started here
 * because it was a report; it is now the screen where an agent is added, hidden, measured and signed in —
 * `SectionsAgents.tsx` and `CatalogRows.tsx`, with the decisions in `agent-catalog.ts`. What moved with the
 * rows is the *declared facts* block, because a page that now carries controls has to keep "here is what the
 * agent published about itself" visually apart from them.
 */

import type { JSX } from "react";

import { APP_VERSION } from "../../app-version.js";
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
