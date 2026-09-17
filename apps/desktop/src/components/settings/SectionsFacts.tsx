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
 *     daemon's**. Both halves of EnvoyDev are built together, so a mismatch means one of them is a
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

import { useCallback, useEffect, useState } from "react";

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
import { mintPairingCode, PairPhonePanel, type PairPhoneOutcome } from "./PairPhone.js";
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
 * in the pane's header on every page (the state folder and the build). **Pair a phone** lives here too:
 * minting a pairing QR is a fact about *this* daemon (who may reach it), not a preference — and the code
 * it produces — the QR, the URI and the copy control — is `PairPhone.tsx`'s, shared with the command
 * palette's row so the two routes cannot present one code two ways.
 */
export function MachineSection(
  props: SettingsSectionProps & {
    /**
     * A code the **palette** already minted, arriving with the page it opened.
     *
     * The palette's press is the mint request (see `PairPhone.tsx` for why minting is an event and not an
     * effect), so by the time this page renders there may be a code — or a refusal — to show. The shell
     * clears it on every navigation, so leaving this page and coming back cannot resurrect a code the
     * user has already moved past.
     */
    mintedPairing?: PairPhoneOutcome | undefined;
  },
): JSX.Element {
  const { t, locale } = useI18n();
  const { hello } = props.state;
  /** `undefined` is "no panel": neither the row's button nor the palette has produced a code yet. */
  const [pairing, setPairing] = useState<PairPhoneOutcome | undefined>(props.mintedPairing);
  const [devices, setDevices] = useState<
    | readonly {
        id: string;
        deviceLabel: string;
        createdAt: string;
        expiresAt: string;
        revokedAt?: string;
        lastSeenAt?: string;
      }[]
    | null
  >(null);

  const refreshDevices = useCallback(async () => {
    const result = await props.agents.listPairedDevices();
    if (result.ok) setDevices(result.devices);
  }, [props.agents]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  // **The palette's code, when it lands after this page has mounted.** The shell mints while the palette is
  // still on screen, so the answer can arrive either side of the render that opens this page; this is the
  // later case. The state write is idempotent, which is what makes it safe under `<StrictMode>`'s doubled
  // effect — unlike an effect that *minted*, which would leave a second device record on the daemon.
  useEffect(() => {
    if (props.mintedPairing === undefined) return;
    setPairing(props.mintedPairing);
    if (props.mintedPairing.ok) void refreshDevices();
  }, [props.mintedPairing, refreshDevices]);

  if (hello === undefined) {
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
        <span className="chip chip--quiet">
          {hello.windowCount === 1
            ? t("settings.machine.windows.one")
            : t("settings.machine.windows.many", { count: hello.windowCount })}
        </span>
      </SettingRow>

      <SettingRow
        title={t("settings.machine.pair.title")}
        detail={t("settings.machine.pair.detail")}
        developerNote="coder.mintPairing"
      >
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            // The press is the request, and the answer — code or refusal — is what the panel below shows.
            void mintPairingCode(props.agents).then((outcome) => {
              setPairing(outcome);
              if (outcome.ok) void refreshDevices();
            });
          }}
        >
          {t("settings.machine.pair.action")}
        </button>
      </SettingRow>

      {pairing ? <PairPhonePanel outcome={pairing} onClose={() => setPairing(undefined)} /> : null}

      <SettingRow
        title={t("settings.machine.paired.title")}
        detail={t("settings.machine.paired.detail")}
        developerNote="coder.listPairedDevices"
      >
        <span className="chip chip--quiet">{devices === null ? "…" : String(devices.length)}</span>
      </SettingRow>

      {devices !== null && devices.length === 0 ? (
        <p className="settings__note">{t("settings.machine.paired.empty")}</p>
      ) : null}

      {devices !== null && devices.length > 0 ? (
        <ul className="settings__paired-list">
          {devices.map((device) => (
            <li key={device.id} className="settings__paired-row">
              <div>
                <strong>{device.deviceLabel}</strong>
                <div className="settings__note">
                  {device.revokedAt
                    ? t("settings.machine.paired.revoked")
                    : t("settings.machine.paired.expires", { when: formatWhen(device.expiresAt, locale) })}
                </div>
              </div>
              {device.revokedAt ? null : (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => {
                    void props.agents.revokePairedDevice(device.id).then((result) => {
                      if (result.ok) void refreshDevices();
                    });
                  }}
                >
                  {t("settings.machine.paired.revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
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
        developerNote="__ENVOYDEV_VERSION__"
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
