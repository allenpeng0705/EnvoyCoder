/**
 * **Pairing** — the three routes a phone takes to this machine, each said on its own.
 *
 * ## Why pairing is a section of its own, and why the three routes are three blocks
 *
 * Pairing used to be one row on *This machine* beside the build number and the state folder, which put the
 * product's most sensitive control in the middle of a read-out. The owner asked for it separately, and the
 * reason holds on its own: *This machine* **reports** (`coder.hello`); pairing **acts**, mints a bearer
 * secret, and is the one thing on these pages a phone can be handed.
 *
 * Inside the section the three routes are three blocks rather than one paragraph because they are three
 * different mechanisms, not three phrasings of one:
 *
 *   1. **QR code** — the primary route. The phone scans the whole payload: address, token and owner identity
 *      in one image. `PairPhone.tsx` owns the mint and the drawing; this module owns the presentation, so
 *      the palette and the rail's button reach the same code by the same call.
 *   2. **Host and port** — the same payload, typed. A phone that cannot scan needs the address and the token
 *      as two values, and they are read **out of the code that was minted** rather than assembled here:
 *      there is one token format (`envoy://pair`, `@envoymesh/api`'s builder) and this is a reader of it.
 *   3. **SSH** — a hop, and the one route the desktop cannot hand over. The phone opens the tunnel by hand
 *      (`apps/mobile/lib/services/add_host.dart`), and the pairing code carries no SSH fields, so this block
 *      says what the phone will ask for instead of pretending to mint it. Claiming an SSH route in the code
 *      would be exactly the overstatement `AGENTS.md` §4 forbids.
 *
 * ## Why the manual route is empty until a code exists
 *
 * `wsUrl` and `token` are chosen **at mint time** — the daemon picks the first non-loopback address, and the
 * token is minted with the record. The window's own connection is loopback (`127.0.0.1`), which is not an
 * address a phone can dial, so filling these fields from `state.connection` would print a true value for the
 * wrong route. Until a code exists the block says where the two values come from; after one exists it shows
 * them, copyable and with the secret stated.
 */

import type { JSX } from "react";

import { useEffect, useState } from "react";

import { useI18n } from "../../i18n/context.js";
import { canCopyText, copyText } from "./clipboard.js";
import { mintPairingCode, PairPhonePanel, type PairPhoneOutcome } from "./PairPhone.js";
import type { SettingsSectionProps } from "./SectionProps.js";

/** What the manual route shows, read from a minted `envoy://pair` URI. Any field may be absent. */
export interface PairingLink {
  /** `host:port` from `wsUrl` — the field the phone's Add host form takes. */
  readonly address: string | undefined;
  /** `host:port` from `lanWsUrl`, when the daemon offered a local-network address as well. */
  readonly lanAddress: string | undefined;
  /** The owner-minted token. A secret: see `settings.pairing.secret`. */
  readonly token: string | undefined;
}

/**
 * `host:port` out of a `ws://…`/`wss://…` URL, or `undefined` when there is no authority to name.
 *
 * The authority is read as written rather than through `URL.host`/`.port`, and that is the point: a URL
 * normalises a default port away (`wss://relay.example:443/ws` parses with `port === ""`), while the
 * phone's Add host field is `host:port` and its parser refuses a bare host
 * (`apps/mobile/lib/services/add_host.dart`'s `parseEndpoint`). Echoing the daemon's own string keeps the
 * one value a user types identical to the one the code carries.
 */
function hostPortOf(url: string | null): string | undefined {
  const text = url?.trim();
  if (text === undefined || text === "") return undefined;
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(text)?.[1];
  return authority === undefined || authority === "" ? undefined : authority;
}

/**
 * Read the values the manual route needs out of a pairing URI.
 *
 * **A reader, not a second format.** `host.pairingUri` builds the URI with `@envoymesh/api`'s one builder,
 * which writes `wsUrl` / `lanWsUrl` / `token` as query parameters; this reads exactly those keys. It does not
 * encode, decode or re-package the token — the secret is copied through untouched, so there is still one
 * token format and one place that defines it. (The family's own parser is not importable here: it lives in
 * `@envoymesh/api`'s product-bound barrel, which the window bundle deliberately does not reach —
 * `packages/host-bridge/src/index.ts` records why.)
 */
export function readPairingLink(uri: string): PairingLink {
  let params: URLSearchParams;
  try {
    params = new URL(uri).searchParams;
  } catch {
    params = new URLSearchParams();
  }
  const token = params.get("token")?.trim();
  return {
    address: hostPortOf(params.get("wsUrl")),
    lanAddress: hostPortOf(params.get("lanWsUrl")),
    token: token === undefined || token === "" ? undefined : token,
  };
}

/**
 * The section, as the pane renders it.
 *
 * Rendered from the real `SectionProps` and the real `mintPairingCode`, so this page cannot mint by a route
 * of its own. The keyboard/QR surface arrives as `PairPhonePanel`, which both this section and the palette
 * use — the shared module is the only place the mint call exists.
 */
export function PairingSection(
  props: SettingsSectionProps & {
    /**
     * A code the **palette or the rail** already minted, arriving with the page it opened.
     *
     * The press happens in the shell before this page exists (see `CoderApp.openPairing`), so the answer can
     * land either side of the render that first shows this section; the effect below is the later case.
     */
    mintedPairing?: PairPhoneOutcome | undefined;
  },
): JSX.Element {
  const { t } = useI18n();
  /** `undefined` is "no code yet": neither press has produced one on this visit. */
  const [pairing, setPairing] = useState<PairPhoneOutcome | undefined>(props.mintedPairing);

  // The palette mints while it is still on screen, so a code (or a refusal) can arrive after this section
  // mounted. A state write is idempotent and safe under `<StrictMode>`'s doubled effect — unlike an effect
  // that *minted*, which is why the mint itself lives in `PairPhone.tsx` and only ever runs from a press.
  useEffect(() => {
    if (props.mintedPairing === undefined) return;
    setPairing(props.mintedPairing);
  }, [props.mintedPairing]);

  const mint = (): void => {
    void mintPairingCode(props.agents).then(setPairing);
  };

  const link = pairing?.ok === true ? readPairingLink(pairing.uri) : undefined;
  // **The LAN row appears only when it says something the first one does not.** For a machine with one
  // non-loopback address the daemon mints `lanWsUrl` equal to `wsUrl` (`daemon/pairing.ts`), and printing
  // the same `host:port` twice under two labels would read as two routes when there is one. It differs
  // when the reach address is a tunnel or relay and the phone may prefer the local one — which is the case
  // the row exists for.
  const lanAddress =
    link?.lanAddress !== undefined && link.lanAddress !== link.address ? link.lanAddress : undefined;
  const hasDetails =
    link !== undefined && (link.address !== undefined || lanAddress !== undefined || link.token !== undefined);
  /** The port this daemon listens on, for the SSH block's "as seen from that machine" address. */
  const port = props.state.connection.state === "connected" ? props.state.connection.endpoint.port : undefined;

  return (
    <>
      <p className="settings__note">{t("settings.pairing.note")}</p>

      {/* ── route 1: the QR code, and the section's primary action ── */}
      <section className="settings__pairing-route" data-route="qr" aria-labelledby="settings-pairing-qr">
        <div className="settings__pairing-route-head">
          <h2 className="settings__heading" id="settings-pairing-qr">
            {t("settings.pairing.qr.title")}
          </h2>
          {/* The primary route is marked as such on the heading, not only by being first: a user who reads
              the three headings while scrolling should be told which one the product recommends. */}
          <span className="chip chip--quiet">{t("settings.pairing.qr.primary")}</span>
        </div>
        <p className="settings__note">{t("settings.pairing.qr.detail")}</p>
        <button type="button" className="button button--primary" onClick={mint}>
          {t("settings.pairing.qr.action")}
        </button>
        {pairing ? <PairPhonePanel outcome={pairing} onClose={() => setPairing(undefined)} /> : null}
      </section>

      {/* ── route 2: the same payload, typed by hand ── */}
      <section className="settings__pairing-route" data-route="manual" aria-labelledby="settings-pairing-manual">
        <h2 className="settings__heading" id="settings-pairing-manual">
          {t("settings.pairing.manual.title")}
        </h2>
        <p className="settings__note">{t("settings.pairing.manual.detail")}</p>
        {hasDetails && link !== undefined ? (
          <div className="settings__pairing-fields">
            {link.address !== undefined ? (
              <CopyField
                label={t("settings.pairing.manual.address")}
                detail={t("settings.pairing.manual.address.detail")}
                value={link.address}
              />
            ) : null}
            {lanAddress !== undefined ? (
              <CopyField
                label={t("settings.pairing.manual.lanAddress")}
                detail={t("settings.pairing.manual.lanAddress.detail")}
                value={lanAddress}
              />
            ) : null}
            {link.token !== undefined ? (
              <CopyField
                label={t("settings.pairing.manual.token")}
                detail={t("settings.pairing.manual.token.detail")}
                value={link.token}
              />
            ) : null}
            <p className="settings__note">{t("settings.pairing.secret")}</p>
          </div>
        ) : pairing?.ok === true ? (
          // A code came back that we could not read: say so and leave the link above as the way through,
          // rather than printing a half-parsed address the phone would fail to dial.
          <p className="settings__note">{t("settings.pairing.manual.unreadable")}</p>
        ) : (
          <p className="settings__note">{t("settings.pairing.manual.waiting")}</p>
        )}
      </section>

      {/* ── route 3: the hop, which is the phone's form and not our code ── */}
      <section className="settings__pairing-route" data-route="ssh" aria-labelledby="settings-pairing-ssh">
        <h2 className="settings__heading" id="settings-pairing-ssh">
          {t("settings.pairing.ssh.title")}
        </h2>
        <p className="settings__note">{t("settings.pairing.ssh.detail")}</p>
        {/* A **definition list, not a form**: these are the fields the phone's own Add host → SSH dialog
            asks for, and the desktop is telling the user what to expect rather than collecting values it
            has nowhere to send. A form here would be the overstatement this file's header refuses. */}
        <dl className="settings__pairing-fields">
          <PairingFact label={t("settings.pairing.ssh.host")} value={t("settings.pairing.ssh.host.detail")} />
          <PairingFact label={t("settings.pairing.ssh.port")} value={t("settings.pairing.ssh.port.detail")} />
          <PairingFact label={t("settings.pairing.ssh.user")} value={t("settings.pairing.ssh.user.detail")} />
          <PairingFact
            label={t("settings.pairing.ssh.daemon")}
            value={
              port === undefined
                ? t("settings.pairing.ssh.daemon.unknown")
                : t("settings.pairing.ssh.daemon.detail", { address: `127.0.0.1:${port}` })
            }
          />
          <PairingFact label={t("settings.pairing.ssh.token")} value={t("settings.pairing.ssh.token.detail")} />
        </dl>
        <p className="settings__note">{t("settings.pairing.ssh.notInCode")}</p>
      </section>

      {/* **Where the record of what this page minted lives.** Minting moved here and the list of issued
          codes stayed on *This machine*, because that page is the daemon's own report; saying so is what
          keeps the move from becoming a place a user cannot find the revoke control. */}
      <p className="settings__note">{t("settings.pairing.manage")}</p>
    </>
  );
}

/** One line of the SSH block: what the phone asks for, and the answer to give it. */
function PairingFact(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="settings__pairing-fact">
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

/**
 * **One value from the code, and the control that makes it usable.**
 *
 * The token is a bearer secret, so it is shown exactly as the QR panel shows the whole URI: selectable, in a
 * mono face, with the sentence that says what it is. Hiding it behind dots would make the one field a user
 * cannot retype visible only to the eye that already had it on screen — and the phone needs it typed.
 *
 * Copy follows `CopyCommand.tsx`'s rule in the same folder: offered only where `canCopyText()` says a write
 * can work, and the failure is reported instead of a tick over a value that never reached the clipboard.
 */
function CopyField(props: { label: string; detail: string; value: string }): JSX.Element {
  const { t } = useI18n();
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");

  const press = (): void => {
    void copyText(props.value).then((ok) => setResult(ok ? "copied" : "failed"));
  };

  const label =
    result === "copied"
      ? t("settings.pairing.copied")
      : result === "failed"
        ? t("settings.pairing.copyFailed")
        : // **One word, because this button copies one field.** The QR panel's button says "Copy pairing
          // link" and copies the whole URI; a field's button that said the same would name the wrong thing
          // next to `192.168.1.20:4770`. The accessible name still names the field (`….copy.aria`), which
          // is what distinguishes three buttons that all read *Copy*.
          t("settings.pairing.field.copy");

  return (
    <div className="settings__pairing-field">
      <span className="setting__title">{props.label}</span>
      <code className="settings__pairing-value">{props.value}</code>
      <span className="settings__pairing-field-detail">{props.detail}</span>
      {canCopyText() ? (
        <button
          type="button"
          className="button button--secondary button--small"
          // The accessible name begins with the printed word and then names the field, so three buttons all
          // reading *Copy* are still three distinguishable controls to a voice or screen-reader user.
          aria-label={t("settings.pairing.copy.aria", { field: props.label })}
          onClick={press}
        >
          {label}
        </button>
      ) : null}
      <span className="visually-hidden" role="status">
        {result === "copied"
          ? t("settings.pairing.copied")
          : result === "failed"
            ? t("settings.pairing.copyFailed")
            : ""}
      </span>
    </div>
  );
}
