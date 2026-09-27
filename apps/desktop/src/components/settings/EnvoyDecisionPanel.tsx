/**
 * Settings → Safety — optional System One decision gate for Envoy Harness.
 * Off by default. API keys stay in host env, not this form.
 */

import type { JSX, FormEvent } from "react";
import { useEffect, useState } from "react";

import { useI18n } from "../../i18n/context.js";
import { localize } from "../../i18n/notice.js";
import type { AgentActions } from "../../state/agent-actions.js";

export function EnvoyDecisionPanel(props: { agents: AgentActions }): JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<"off" | "shadow" | "enforce">("off");
  const [backend, setBackend] = useState<"null" | "laya-http" | "jev" | "onnx">(
    "null",
  );
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void props.agents.getEnvoyDecision().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setNotice(localize(t, result) ?? result.message);
        return;
      }
      setMode(result.mode);
      setBackend(result.backend);
      setEndpoint(result.endpoint ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [props.agents, t]);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    const result = await props.agents.setEnvoyDecision({
      mode,
      backend,
      endpoint,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(localize(t, result) ?? result.message);
      return;
    }
    setMode(result.mode);
    setBackend(result.backend);
    setEndpoint(result.endpoint ?? "");
    setNotice(t("settings.agents.envoyDecision.saved"));
  };

  return (
    <form className="settings__block" onSubmit={(e) => void onSubmit(e)}>
      <h3 className="settings__heading">{t("settings.agents.envoyDecision.heading")}</h3>
      <p className="settings__note">{t("settings.agents.envoyDecision.note")}</p>

      <label className="setting">
        <span className="setting__title">{t("settings.agents.envoyDecision.mode")}</span>
        <select
          value={mode}
          onChange={(e) =>
            setMode(e.target.value as "off" | "shadow" | "enforce")
          }
          aria-label={t("settings.agents.envoyDecision.mode")}
        >
          <option value="off">{t("settings.agents.envoyDecision.modeOff")}</option>
          <option value="shadow">{t("settings.agents.envoyDecision.modeShadow")}</option>
          <option value="enforce">{t("settings.agents.envoyDecision.modeEnforce")}</option>
        </select>
      </label>

      <label className="setting">
        <span className="setting__title">{t("settings.agents.envoyDecision.backend")}</span>
        <select
          value={backend}
          disabled={mode === "off"}
          onChange={(e) =>
            setBackend(
              e.target.value as "null" | "laya-http" | "jev" | "onnx",
            )
          }
          aria-label={t("settings.agents.envoyDecision.backend")}
        >
          <option value="null">null</option>
          <option value="laya-http">laya-http</option>
          <option value="jev">jev</option>
          <option value="onnx">onnx</option>
        </select>
      </label>

      <label className="setting">
        <span className="setting__title">{t("settings.agents.envoyDecision.endpoint")}</span>
        <input
          type="text"
          value={endpoint}
          disabled={mode === "off"}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder={t("settings.agents.envoyDecision.endpoint.placeholder")}
        />
        <span className="setting__detail">
          {t("settings.agents.envoyDecision.endpoint.detail")}
        </span>
      </label>

      {notice !== undefined ? <p className="settings__note">{notice}</p> : null}

      <button type="submit" className="button button--primary" disabled={busy}>
        {busy
          ? t("settings.agents.envoyDecision.saving")
          : t("settings.agents.envoyDecision.save")}
      </button>
    </form>
  );
}
