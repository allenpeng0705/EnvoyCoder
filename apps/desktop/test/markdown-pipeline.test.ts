import { describe, expect, it } from "vitest";

import { advanceTextReveal, beginTextReveal, computeRevealStep, visibleRevealedText } from "../src/components/markdown/text-reveal.js";
import { highlightCode } from "../src/components/markdown/highlight.js";
import { containsUnsafeMermaidSource } from "../src/components/markdown/mermaid-source-policy.js";
import { splitMarkdownBlocks } from "../src/components/markdown/splitMarkdownBlocks.js";

describe("splitMarkdownBlocks", () => {
  it("splits on blank lines outside fences", () => {
    expect(splitMarkdownBlocks("One\n\nTwo\n\nThree")).toEqual(["One", "Two", "Three"]);
  });

  it("keeps an open fence as one block, including blank lines inside", () => {
    const text = "Intro\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nOutro";
    expect(splitMarkdownBlocks(text)).toEqual([
      "Intro",
      "```ts\nconst a = 1\n\nconst b = 2\n```",
      "Outro",
    ]);
  });

  it("does not split while a fence is still open", () => {
    expect(splitMarkdownBlocks("```js\nfoo\n\nbar")).toEqual(["```js\nfoo\n\nbar"]);
  });
});

describe("text-reveal", () => {
  it("drains backlog proportionally to elapsed time", () => {
    expect(computeRevealStep({ backlog: 100, elapsedMs: 75, horizonMs: 150 })).toBe(50);
    expect(computeRevealStep({ backlog: 3, elapsedMs: 1, horizonMs: 150 })).toBe(1);
  });

  it("reveals growth only — first paint is complete", () => {
    const state = beginTextReveal("hello");
    expect(visibleRevealedText(state)).toBe("hello");
    const grown = { target: "hello world", revealed: 5 };
    const next = advanceTextReveal(grown, 150);
    expect(visibleRevealedText(next)).toBe("hello world");
  });
});

describe("highlightCode", () => {
  it("highlights a known language", () => {
    const result = highlightCode("const x = 1", "ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("hljs-");
      expect(result.language).toBe("ts");
    }
  });

  it("falls back when the language is unknown", () => {
    expect(highlightCode("x", "not-a-lang").ok).toBe(false);
  });
});

describe("mermaid source policy", () => {
  it("allows ordinary diagrams", () => {
    expect(containsUnsafeMermaidSource("flowchart TD\n  A-->B")).toBe(false);
  });

  it("rejects image-shape and url constructs", () => {
    expect(containsUnsafeMermaidSource('A@{"img":"https://evil.example/x"}')).toBe(true);
    expect(containsUnsafeMermaidSource("style A fill:url(https://evil.example)")).toBe(true);
  });
});
