import { describe, expect, it } from "vitest";

import { prepareMarkdown } from "../src/components/markdown/prepareMarkdown.js";

describe("prepareMarkdown", () => {
  it("leaves complete fences alone", () => {
    const text = "Before\n```ts\nconst x = 1\n```\nAfter";
    expect(prepareMarkdown(text)).toBe(text);
  });

  it("closes an unclosed fence so streaming mid-block still shows as code", () => {
    expect(prepareMarkdown("Intro\n```js\nconsole.log(1)")).toBe(
      "Intro\n```js\nconsole.log(1)\n```",
    );
  });

  it("treats ~~~ fences the same way", () => {
    expect(prepareMarkdown("~~~\npartial")).toBe("~~~\npartial\n~~~");
  });
});
