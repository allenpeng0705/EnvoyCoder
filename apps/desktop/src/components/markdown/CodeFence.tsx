/**
 * A fenced code block in agent markdown — chrome + highlighted body.
 */

import type { JSX } from "react";
import { useMemo, useState } from "react";

import { useT } from "../../i18n/context.js";
import { highlightCode, normalizeFenceLanguage } from "./highlight.js";

export function CodeFence(props: {
  code: string;
  language?: string | undefined;
}): JSX.Element {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const language =
    normalizeFenceLanguage(props.language) ??
    (props.language?.trim() ? props.language.trim() : undefined);
  const code = props.code.replace(/\n+$/, "");

  const highlighted = useMemo(() => highlightCode(code, language), [code, language]);

  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be denied; the button is a convenience, not a requirement.
    }
  }

  return (
    <div className="md__fence">
      <div className="md__fence-bar">
        <span className="md__fence-lang">{language ?? t("task.code.plain")}</span>
        <button
          type="button"
          className="md__fence-copy"
          onClick={() => void onCopy()}
          title={copied ? t("task.code.copied") : t("task.code.copy")}
        >
          {copied ? t("task.code.copied") : t("task.code.copy")}
        </button>
      </div>
      <pre className="md__fence-pre">
        {highlighted.ok ? (
          <code
            className={`hljs language-${highlighted.language}`}
            dangerouslySetInnerHTML={{ __html: highlighted.html }}
          />
        ) : (
          <code className={language ? `language-${language}` : undefined}>{code}</code>
        )}
      </pre>
    </div>
  );
}
