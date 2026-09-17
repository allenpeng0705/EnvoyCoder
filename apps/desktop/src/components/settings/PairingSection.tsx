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
 *   1. **QR code** — the primary route. The phone scans the whole payload (including a long random token
 *      the user never types). `PairPhone.tsx` owns the mint and the drawing.
 *   2. **Host and port** — typed. The user enters a reachable address (public IP/domain, or LAN on the
 *      same Wi-Fi) and chooses a short 8–10 character token. That mint is independent of the QR — the
 *      manual route must not echo the QR's long secret.
 *   3. **SSH** — a hop, and the one route the desktop cannot hand over. Guidance only: public IP/domain
 *      for the SSH host; daemon as seen from that machine; token optional.
 */

import type { JSX } from "react";

import { useEffect, useState } from "react";

import {
  USER_PAIRING_TOKEN_MAX_LEN,
  normalizeUserPairingToken,
} from "../../pairing-token.js";
import { useI18n } from "../../i18n/context.js";
import { canCopyText, copyText } from "./clipboard.js";
import { mintPairingCode, PairPhonePanel, type PairPhoneOutcome } from "./PairPhone.js";
import type { SettingsSectionProps } from "./SectionProps.js";

/** What the manual route shows after a successful typed mint. */
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
 * which writes `wsUrl` / `lanWsUrl` / `token` as query parameters; this reads exactly those keys.
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
 * use — the shared module is the only place the mint call exists for QR.
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
  /** QR outcome only — never reused as the manual route's values. */
  const [pairing, setPairing] = useState<PairPhoneOutcome | undefined>(props.mintedPairing);
  const [manualAddress, setManualAddress] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | undefined>();
  const [manualLink, setManualLink] = useState<PairingLink | undefined>();

  useEffect(() => {
    if (props.mintedPairing === undefined) return;
    setPairing(props.mintedPairing);
  }, [props.mintedPairing]);

  const mintQr = (): void => {
    void mintPairingCode(props.agents).then(setPairing);
  };

  /** The port this daemon listens on, for address hints and the SSH block. */
  const port = props.state.connection.state === "connected" ? props.state.connection.endpoint.port : undefined;
  const meshHosting = props.state.mesh.kind === "hosting";
  // Quiet example only when we know the daemon port — address.detail already teaches public vs LAN.
  const lanHintAddress = port !== undefined ? `192.168.x.x:${port}` : undefined;

  const mintManual = (): void => {
    setManualError(undefined);
    const address = manualAddress.trim();
    if (address === "") {
      setManualError(t("settings.pairing.manual.address.missing"));
      return;
    }
    const normalized = normalizeUserPairingToken(manualToken);
    if (!normalized.ok) {
      setManualError(
        normalized.reason === "length"
          ? t("settings.pairing.manual.token.length")
          : t("settings.pairing.manual.token.charset"),
      );
      return;
    }
    setManualBusy(true);
    void mintPairingCode(props.agents, { host: address, token: normalized.token, deviceLabel: "Phone" }).then(
      (outcome) => {
        setManualBusy(false);
        if (!outcome.ok) {
          setManualError(outcome.message);
          setManualLink(undefined);
          return;
        }
        setManualLink(readPairingLink(outcome.uri));
      },
    );
  };

  return (
    <>
      <p className="settings__note">{t("settings.pairing.note")}</p>

      {/* ── route 1: the QR code, and the section's primary action ── */}
      <section className="settings__pairing-route" data-route="qr" aria-labelledby="settings-pairing-qr">
        <div className="settings__pairing-route-head">
          <h2 className="settings__heading" id="settings-pairing-qr">
            {t("settings.pairing.qr.title")}
          </h2>
          <span className="chip chip--quiet">{t("settings.pairing.qr.primary")}</span>
        </div>
        <p className="settings__note">{t("settings.pairing.qr.detail")}</p>
        <p className="settings__note" data-mesh-route={meshHosting ? "ready" : "unavailable"}>
          {t(meshHosting ? "settings.pairing.qr.meshHosting" : "settings.pairing.qr.meshUnavailable")}
        </p>
        <button type="button" className="button button--primary" onClick={mintQr}>
          {t("settings.pairing.qr.action")}
        </button>
        {pairing ? <PairPhonePanel outcome={pairing} onClose={() => setPairing(undefined)} /> : null}
      </section>

      {/* ── route 2: typed host:port + short user token ── */}
      <section className="settings__pairing-route" data-route="manual" aria-labelledby="settings-pairing-manual">
        <h2 className="settings__heading" id="settings-pairing-manual">
          {t("settings.pairing.manual.title")}
        </h2>
        <p className="settings__note">{t("settings.pairing.manual.detail")}</p>
        <div className="settings__pairing-form">
          <label className="settings__pairing-field">
            <span className="setting__title">{t("settings.pairing.manual.address")}</span>
            <input
              type="text"
              className="settings__pairing-input"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("settings.pairing.manual.address.placeholder")}
              value={manualAddress}
              onChange={(event) => setManualAddress(event.target.value)}
              aria-describedby="settings-pairing-manual-address-detail"
            />
            <span className="settings__pairing-field-detail" id="settings-pairing-manual-address-detail">
              {t("settings.pairing.manual.address.detail")}
            </span>
            {lanHintAddress !== undefined ? (
              <span className="settings__note">{t("settings.pairing.manual.lanHint", { address: lanHintAddress })}</span>
            ) : null}
          </label>
          <label className="settings__pairing-field">
            <span className="setting__title">{t("settings.pairing.manual.token")}</span>
            <input
              type="text"
              className="settings__pairing-input"
              autoComplete="off"
              spellCheck={false}
              maxLength={USER_PAIRING_TOKEN_MAX_LEN}
              placeholder={t("settings.pairing.manual.token.placeholder")}
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              aria-describedby="settings-pairing-manual-token-detail"
            />
            <span className="settings__pairing-field-detail" id="settings-pairing-manual-token-detail">
              {t("settings.pairing.manual.token.detail")}
            </span>
          </label>
          <button
            type="button"
            className="button button--primary"
            disabled={manualBusy}
            onClick={mintManual}
          >
            {manualBusy ? t("settings.pairing.manual.busy") : t("settings.pairing.manual.action")}
          </button>
          {manualError !== undefined ? (
            <p className="settings__note" role="alert" data-manual-error="">
              {manualError}
            </p>
          ) : null}
        </div>
        {manualLink !== undefined &&
        (manualLink.address !== undefined || manualLink.token !== undefined) ? (
          <div className="settings__pairing-fields" data-manual-result="">
            {manualLink.address !== undefined ? (
              <CopyField
                label={t("settings.pairing.manual.address")}
                detail={t("settings.pairing.manual.address.detail")}
                value={manualLink.address}
              />
            ) : null}
            {manualLink.token !== undefined ? (
              <CopyField
                label={t("settings.pairing.manual.token")}
                detail={t("settings.pairing.manual.token.detail")}
                value={manualLink.token}
              />
            ) : null}
            <p className="settings__note">{t("settings.pairing.secret")}</p>
          </div>
        ) : null}
      </section>

      {/* ── route 3: the hop, which is the phone's form and not our code ── */}
      <section className="settings__pairing-route" data-route="ssh" aria-labelledby="settings-pairing-ssh">
        <h2 className="settings__heading" id="settings-pairing-ssh">
          {t("settings.pairing.ssh.title")}
        </h2>
        <p className="settings__note">{t("settings.pairing.ssh.detail")}</p>
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
        : t("settings.pairing.field.copy");

  return (
    <div className="settings__pairing-field">
      <span className="setting__title">{props.label}</span>
      <code className="settings__pairing-value">{props.value}</code>
      <span className="settings__pairing-field-detail">{props.detail}</span>
      {canCopyText() ? (
        <button
          type="button"
          className="button button--secondary button--small"
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

// Re-export token bounds for tests that assert the form's maxLength without importing the daemon.
export { USER_PAIRING_TOKEN_MAX_LEN } from "../../pairing-token.js";
