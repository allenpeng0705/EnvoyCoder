/**
 * Syntax highlighting for fenced code — highlight.js with a curated language set.
 *
 * Tokens are themed via CSS variables (`.hljs-*`), not a baked theme, so light/dark
 * follow EnvoyDev tokens. Oversized bodies fall back to plain text (Paseo's 100k cap).
 */

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const HIGHLIGHT_CHAR_CAP = 100_000;

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("zsh", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c++", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cs", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("dart", dart);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("golang", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("kt", kotlin);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rb", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("svg", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  golang: "go",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  markdown: "md",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
};

export function normalizeFenceLanguage(info: string | undefined): string | undefined {
  if (!info) return undefined;
  const first = info.trim().split(/\s+/)[0]?.toLowerCase().replace(/^\./, "");
  if (!first) return undefined;
  return LANGUAGE_ALIASES[first] ?? first;
}

export type HighlightResult =
  | { ok: true; html: string; language: string }
  | { ok: false; reason: "too-large" | "unknown" | "failed" };

export function highlightCode(code: string, language: string | undefined): HighlightResult {
  if (code.length > HIGHLIGHT_CHAR_CAP) return { ok: false, reason: "too-large" };
  const lang = normalizeFenceLanguage(language);
  if (!lang || !hljs.getLanguage(lang)) return { ok: false, reason: "unknown" };
  try {
    const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
    return { ok: true, html: result.value, language: lang };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
