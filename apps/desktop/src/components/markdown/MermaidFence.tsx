/**
 * Mermaid fence: render a diagram when the source is complete and safe; otherwise
 * show the highlighted source (streaming / rejected / failed).
 *
 * Simpler than Paseo's sandboxed iframe runtime: denylist + `securityLevel: "strict"`
 * in-process. Toggle source ↔ diagram once rendered.
 */

import type { JSX } from "react";
import { useEffect, useId, useState } from "react";

import { useT } from "../../i18n/context.js";
import { CodeFence } from "./CodeFence.js";
import { containsUnsafeMermaidSource } from "./mermaid-source-policy.js";
import type { MarkdownPhase } from "./types.js";

export function MermaidFence(props: {
  code: string;
  phase: MarkdownPhase;
}): JSX.Element {
  const t = useT();
  const reactId = useId().replace(/:/g, "");
  const code = props.code.replace(/\n+$/, "");
  const rejected = containsUnsafeMermaidSource(code);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showSource, setShowSource] = useState(false);

  const canRender = props.phase === "complete" && !rejected && code.trim().length > 0;

  useEffect(() => {
    if (!canRender) {
      setSvg(null);
      setFailed(false);
      return;
    }

    let cancelled = false;
    const renderId = `mermaid-${reactId}-${Date.now()}`;

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark =
          typeof document !== "undefined" &&
          document.documentElement.getAttribute("data-theme") === "dark";
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
          fontFamily: "inherit",
        });
        const { svg: next } = await mermaid.render(renderId, code);
        if (!cancelled) {
          setSvg(next);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canRender, code, reactId]);

  if (!canRender || failed || showSource || svg === null) {
    return (
      <div className="md__mermaid">
        <CodeFence code={code} language="mermaid" />
        {svg !== null && !failed ? (
          <button
            type="button"
            className="md__mermaid-toggle"
            onClick={() => setShowSource(false)}
          >
            {t("task.diagram.view")}
          </button>
        ) : null}
        {props.phase === "streaming" ? (
          <p className="md__mermaid-hint">{t("task.diagram.streaming")}</p>
        ) : null}
        {rejected ? <p className="md__mermaid-hint">{t("task.diagram.blocked")}</p> : null}
        {failed ? <p className="md__mermaid-hint">{t("task.diagram.failed")}</p> : null}
      </div>
    );
  }

  return (
    <div className="md__mermaid md__mermaid--rendered">
      <div className="md__mermaid-bar">
        <span className="md__fence-lang">mermaid</span>
        <button
          type="button"
          className="md__fence-copy"
          onClick={() => setShowSource(true)}
          title={t("task.diagram.source")}
        >
          {t("task.diagram.source")}
        </button>
      </div>
      <div
        className="md__mermaid-svg"
        role="img"
        aria-label={t("task.diagram.aria")}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
