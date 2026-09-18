/**
 * Render agent (assistant) text as markdown.
 *
 * Policy from Paseo, adapted for the web stack:
 *   * GFM via `remark-gfm`
 *   * Paced reveal while streaming (`useRevealedText`)
 *   * Block-split + memoized re-parse (only the live tail re-parses)
 *   * Unclosed fences closed for display on the streaming tail
 *   * Syntax-highlighted fences; Mermaid when safe and complete
 *   * No smart typographer; unsafe / file: links dropped
 */

import type { JSX } from "react";
import { memo, useMemo, createContext, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeFence } from "./CodeFence.js";
import { MermaidFence } from "./MermaidFence.js";
import { prepareMarkdown } from "./prepareMarkdown.js";
import { splitMarkdownBlocks } from "./splitMarkdownBlocks.js";
import type { MarkdownPhase } from "./types.js";
import { useRevealedText } from "./useRevealedText.js";

const remarkPlugins = [remarkGfm];

const BlockPhaseContext = createContext<MarkdownPhase>("complete");

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) return undefined;
  if (lower.startsWith("file:")) return undefined;
  return trimmed;
}

function isMermaidLanguage(language: string | undefined): boolean {
  return (language ?? "").toLowerCase() === "mermaid";
}

function MarkdownComponents(): Components {
  // Built once per module; phase is read from context so MermaidFence sees streaming.
  return {
    a({ href, children }) {
      const safe = safeHref(href);
      if (!safe) return <span>{children}</span>;
      return (
        <a href={safe} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    code({ className, children }) {
      const text = String(children);
      const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
      const looksBlock = Boolean(language) || text.includes("\n");
      if (!looksBlock) {
        return <code className="md__inline-code">{children}</code>;
      }
      if (isMermaidLanguage(language)) {
        return <MermaidFenceWithPhase code={text} />;
      }
      return <CodeFence code={text} language={language} />;
    },
    table({ children }) {
      return (
        <div className="md__table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  };
}

const markdownComponents = MarkdownComponents();

function MermaidFenceWithPhase(props: { code: string }): JSX.Element {
  const phase = useContext(BlockPhaseContext);
  return <MermaidFence code={props.code} phase={phase} />;
}

const MemoizedMarkdownBlock = memo(function MemoizedMarkdownBlock(props: {
  text: string;
  phase: MarkdownPhase;
}): JSX.Element {
  const source = useMemo(() => {
    // Only the live streaming tail soft-closes an open fence; finished blocks are already closed.
    return props.phase === "streaming" ? prepareMarkdown(props.text) : props.text;
  }, [props.text, props.phase]);

  return (
    <BlockPhaseContext.Provider value={props.phase}>
      <div className="md__block">
        <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
          {source}
        </ReactMarkdown>
      </div>
    </BlockPhaseContext.Provider>
  );
});

function MessageMarkdownInner(props: {
  text: string;
  /** When omitted, treated as complete (history rows). */
  phase?: MarkdownPhase;
}): JSX.Element {
  const phase = props.phase ?? "complete";
  const revealed = useRevealedText(props.text, phase);
  const blocks = useMemo(() => splitMarkdownBlocks(revealed), [revealed]);

  return (
    <div className="md">
      {blocks.map((block, index) => {
        const blockPhase: MarkdownPhase =
          phase === "streaming" && index === blocks.length - 1 ? "streaming" : "complete";
        return (
          <MemoizedMarkdownBlock
            key={index}
            text={block}
            phase={blockPhase}
          />
        );
      })}
    </div>
  );
}

export const MessageMarkdown = memo(MessageMarkdownInner);
