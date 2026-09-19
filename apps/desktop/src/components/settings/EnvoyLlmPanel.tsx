/**
 * Settings → LLM — base URL, model string, write-only API key.
 *
 * Envoy Harness reads these at launch. The key stays on this machine (`secretsDir`); the window
 * never reloads it — only `apiKeySet`. The provider is not a field: the daemon derives it from the
 * model string.
 */

import type { JSX, FormEvent } from "react";

import { useEffect, useState } from "react";

import { useI18n } from "../../i18n/context.js";
import { localize } from "../../i18n/notice.js";
import type { AgentActions } from "../../state/agent-actions.js";

/** OpenAI is the default provider, so a bare model id is not prefixed. */
function modelField(provider: string | undefined, model: string | undefined): string {
  if (model === undefined || model === "") return "";
  if (provider === undefined || provider === "" || provider === "openai") return model;
  return `${provider}/${model}`;
}

export function LlmSection(props: { agents: AgentActions }): JSX.Element {
  return <EnvoyLlmPanel agents={props.agents} />;
}

export function EnvoyLlmPanel(props: { agents: AgentActions }): JSX.Element {
  const { t } = useI18n();
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void props.agents.getEnvoyLlm().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setNotice(localize(t, result) ?? result.message);
        return;
      }
      setModel(modelField(result.provider, result.model));
      setBaseUrl(result.baseUrl ?? "");
      setApiKeySet(result.apiKeySet);
      setApiKey("");
      setClearKey(false);
    });
    return () => {
      cancelled = true;
    };
  }, [props.agents, t]);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    const result = await props.agents.setEnvoyLlm({
      // The daemon re-derives the provider from `model`. This satisfies the wire, which still names one.
      provider: "openai",
      model,
      baseUrl,
      ...(clearKey && apiKey.length === 0 ? { clearApiKey: true } : apiKey.length > 0 ? { apiKey } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(localize(t, result) ?? result.message);
      return;
    }
    setModel(modelField(result.provider, result.model));
    setBaseUrl(result.baseUrl ?? "");
    setApiKeySet(result.apiKeySet);
    setApiKey("");
    setClearKey(false);
    setNotice(t("settings.agents.envoyLlm.saved"));
  };

  return (
    <form className="settings__envoy-llm" onSubmit={(event) => void onSubmit(event)}>
      <p className="settings__note">{t("settings.agents.envoyLlm.note")}</p>

      <label className="settings__field">
        <span className="setting__title">{t("settings.agents.envoyLlm.baseUrl")}</span>
        <input
          type="text"
          className="input"
          value={baseUrl}
          placeholder={t("settings.agents.envoyLlm.baseUrl.placeholder")}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <span className="setting__detail">{t("settings.agents.envoyLlm.baseUrl.detail")}</span>
      </label>

      <label className="settings__field">
        <span className="setting__title">{t("settings.agents.envoyLlm.model")}</span>
        <input
          type="text"
          className="input"
          value={model}
          placeholder={t("settings.agents.envoyLlm.model.placeholder")}
          onChange={(event) => setModel(event.target.value)}
        />
        <span className="setting__detail">{t("settings.agents.envoyLlm.model.detail")}</span>
      </label>

      <label className="settings__field">
        <span className="setting__title">{t("settings.agents.envoyLlm.apiKey")}</span>
        {apiKeySet && !clearKey ? (
          <p className="settings__note" role="status">
            {t("settings.agents.envoyLlm.apiKey.saved")}{" "}
            <button
              type="button"
              className="settings__link"
              onClick={() => {
                setClearKey(true);
                setApiKey("");
              }}
            >
              {t("settings.agents.envoyLlm.apiKey.clear")}
            </button>
          </p>
        ) : (
          <input
            type="password"
            className="input"
            value={apiKey}
            autoComplete="off"
            placeholder={t("settings.agents.envoyLlm.apiKey.placeholder")}
            onChange={(event) => setApiKey(event.target.value)}
          />
        )}
        <span className="setting__detail">{t("settings.agents.envoyLlm.apiKey.detail")}</span>
      </label>

      {notice !== undefined ? (
        <p className="settings__note" role="status">
          {notice}
        </p>
      ) : null}

      <button type="submit" className="button button--secondary button--small" disabled={busy || model.trim() === ""}>
        {busy ? t("settings.agents.envoyLlm.saving") : t("settings.agents.envoyLlm.save")}
      </button>
    </form>
  );
}
