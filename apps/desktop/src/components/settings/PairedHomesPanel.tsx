/**
 * Join / manage paired EnvoyDev homes on this laptop (thin-client side).
 *
 * Three join methods, matching the phone: pairing link, host:port + token, and SSH. One paste
 * surface on the link tab accepts either an `envoy://pair` URI or a phone **Share connection**
 * payload (no second pairing-link field — that was the same job twice).
 */

import { useState, type JSX } from "react";

import { useI18n } from "../../i18n/context.js";
import type { HomeRegistry } from "../../state/home-registry.js";
import { parsePhoneShare } from "../../state/home-join.js";

type JoinMethod = "link" | "direct" | "ssh";

export function PairedHomesPanel(props: { homes: HomeRegistry }): JSX.Element {
  const { t } = useI18n();
  const [method, setMethod] = useState<JoinMethod>("link");
  /** Pairing URI, or a multi-line phone share — only on the link tab. */
  const [connectionPaste, setConnectionPaste] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [daemonEndpoint, setDaemonEndpoint] = useState("127.0.0.1:4770");
  const [label, setLabel] = useState("");
  const [sshHop, setSshHop] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const list = props.homes.pairedHomeStore().list();

  const clearForm = (): void => {
    setConnectionPaste("");
    setEndpoint("");
    setToken("");
    setSshHost("");
    setSshUser("");
    setSshPort("22");
    setDaemonEndpoint("127.0.0.1:4770");
    setLabel("");
    setSshHop("");
  };

  const canJoin =
    method === "link"
      ? connectionPaste.trim().length > 0
      : method === "direct"
        ? endpoint.trim().length > 0 && token.trim().length > 0
        : sshHost.trim().length > 0 && daemonEndpoint.trim().length > 0 && token.trim().length > 0;

  const join = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);

    if (method === "link") {
      const parsed = parsePhoneShare(connectionPaste);
      if ("error" in parsed) {
        // Still try as a raw URI — parsePhoneShare refuses unknown shapes; joinFromUri words the refusal.
        const result = await props.homes.joinFromUri(
          connectionPaste,
          label || undefined,
          sshHop || undefined,
        );
        setBusy(false);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        clearForm();
        setNotice(t("homes.joined", { label: result.label }));
        return;
      }
      if (parsed.method === "link") {
        const result = await props.homes.joinFromUri(
          parsed.uri,
          label || undefined,
          sshHop || undefined,
        );
        setBusy(false);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        clearForm();
        setNotice(t("homes.joined", { label: result.label }));
        return;
      }
      if (parsed.method === "direct") {
        const result = await props.homes.joinFromDirect(
          parsed.endpoint,
          parsed.token,
          label || undefined,
        );
        setBusy(false);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        clearForm();
        setMethod("direct");
        setNotice(t("homes.joined", { label: result.label }));
        return;
      }
      const result = await props.homes.joinFromSsh({
        sshHost: parsed.sshHost,
        sshPort: parsed.sshPort,
        sshUser: parsed.sshUser,
        daemonEndpoint: parsed.daemonEndpoint,
        token: parsed.token,
        label: label || undefined,
      });
      setBusy(false);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      clearForm();
      setMethod("ssh");
      setNotice(t("homes.joined", { label: result.label }));
      return;
    }

    const result =
      method === "direct"
        ? await props.homes.joinFromDirect(endpoint, token, label || undefined)
        : await props.homes.joinFromSsh({
            sshHost,
            sshPort,
            sshUser: sshUser || undefined,
            daemonEndpoint,
            token,
            label: label || undefined,
          });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    clearForm();
    setNotice(t("homes.joined", { label: result.label }));
  };

  return (
    <div className="settings__paired-homes" data-testid="paired-homes-panel">
      <label className="setting">
        <span className="setting__title">{t("homes.rename")}</span>
        <input
          className="input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t("homes.label.placeholder")}
          aria-label={t("homes.rename")}
        />
      </label>

      <div className="settings__teams-mode settings__homes-method" role="tablist" aria-label={t("homes.method.aria")}>
        <button
          type="button"
          role="tab"
          aria-selected={method === "link"}
          className={`settings__teams-mode-btn${method === "link" ? " settings__teams-mode-btn--active" : ""}`}
          data-testid="homes-method-link"
          onClick={() => setMethod("link")}
        >
          {t("homes.method.link")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "direct"}
          className={`settings__teams-mode-btn${method === "direct" ? " settings__teams-mode-btn--active" : ""}`}
          data-testid="homes-method-direct"
          onClick={() => setMethod("direct")}
        >
          {t("homes.method.direct")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "ssh"}
          className={`settings__teams-mode-btn${method === "ssh" ? " settings__teams-mode-btn--active" : ""}`}
          data-testid="homes-method-ssh"
          onClick={() => setMethod("ssh")}
        >
          {t("homes.method.ssh")}
        </button>
      </div>

      {method === "link" ? (
        <>
          <label className="setting">
            <span className="setting__title">{t("homes.pasteUri")}</span>
            <textarea
              className="input input--multiline"
              rows={8}
              value={connectionPaste}
              onChange={(event) => setConnectionPaste(event.target.value)}
              placeholder={t("homes.pasteUri.placeholder")}
              aria-label={t("homes.pasteUri")}
              spellCheck={false}
              autoComplete="off"
              data-testid="homes-paste-uri"
            />
            <span className="setting__detail">{t("homes.pasteUri.detail")}</span>
          </label>
          <label className="setting">
            <span className="setting__title">{t("homes.sshHop")}</span>
            <input
              className="input"
              value={sshHop}
              onChange={(event) => setSshHop(event.target.value)}
              placeholder="user@host:22"
              aria-label={t("homes.sshHop")}
            />
            <span className="setting__detail">{t("homes.sshHop.detail")}</span>
          </label>
        </>
      ) : null}

      {method === "direct" ? (
        <>
          <label className="setting">
            <span className="setting__title">{t("homes.direct.endpoint")}</span>
            <input
              className="input"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="10.0.0.5:4770"
              aria-label={t("homes.direct.endpoint")}
              autoComplete="off"
            />
            <span className="setting__detail">{t("homes.direct.endpoint.detail")}</span>
          </label>
          <label className="setting">
            <span className="setting__title">{t("homes.direct.token")}</span>
            <input
              className="input"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={t("homes.direct.token.placeholder")}
              aria-label={t("homes.direct.token")}
              autoComplete="off"
            />
            <span className="setting__detail">{t("homes.direct.token.detail")}</span>
          </label>
        </>
      ) : null}

      {method === "ssh" ? (
        <>
          <label className="setting">
            <span className="setting__title">{t("homes.ssh.host")}</span>
            <input
              className="input"
              value={sshHost}
              onChange={(event) => setSshHost(event.target.value)}
              placeholder="bastion.example.com"
              aria-label={t("homes.ssh.host")}
              autoComplete="off"
            />
          </label>
          <label className="setting">
            <span className="setting__title">{t("homes.ssh.user")}</span>
            <input
              className="input"
              value={sshUser}
              onChange={(event) => setSshUser(event.target.value)}
              placeholder="me"
              aria-label={t("homes.ssh.user")}
              autoComplete="username"
            />
          </label>
          <label className="setting">
            <span className="setting__title">{t("homes.ssh.port")}</span>
            <input
              className="input"
              value={sshPort}
              onChange={(event) => setSshPort(event.target.value)}
              placeholder="22"
              aria-label={t("homes.ssh.port")}
              inputMode="numeric"
            />
          </label>
          <label className="setting">
            <span className="setting__title">{t("homes.ssh.daemon")}</span>
            <input
              className="input"
              value={daemonEndpoint}
              onChange={(event) => setDaemonEndpoint(event.target.value)}
              placeholder="127.0.0.1:4770"
              aria-label={t("homes.ssh.daemon")}
              autoComplete="off"
            />
            <span className="setting__detail">{t("homes.ssh.daemon.detail")}</span>
          </label>
          <label className="setting">
            <span className="setting__title">{t("homes.direct.token")}</span>
            <input
              className="input"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={t("homes.direct.token.placeholder")}
              aria-label={t("homes.direct.token")}
              autoComplete="off"
            />
            <span className="setting__detail">{t("homes.ssh.token.detail")}</span>
          </label>
        </>
      ) : null}

      <div className="setting__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !canJoin}
          onClick={() => void join()}
        >
          {busy ? t("homes.joining") : t("homes.join")}
        </button>
      </div>
      {error ? <p className="settings__note settings__note--refused">{error}</p> : null}
      {notice ? <p className="settings__note">{notice}</p> : null}

      {list.length > 0 ? (
        <ul className="settings__paired-homes-list">
          {list.map((home) => (
            <li key={home.id} className="setting">
              <div className="setting__body">
                <span className="setting__title">{home.label}</span>
                <span className="setting__detail">
                  {home.host}:{home.port}
                  {home.path}
                  {home.sshHop ? ` · ssh ${home.sshHop}` : ""}
                </span>
              </div>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void props.homes.forgetHome(home.id)}
              >
                {t("homes.forget")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
