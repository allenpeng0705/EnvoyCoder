import { describe, expect, it } from "vitest";

import {
  flattenToolOutputText,
  imagesFromToolOutput,
  textFromToolOutput,
} from "../src/components/tools/tool-output.js";

describe("tool-output", () => {
  it("reads a plain string preview", () => {
    expect(textFromToolOutput("hello")).toBe("hello");
    expect(imagesFromToolOutput("hello")).toEqual([]);
  });

  it("reads multimodal screenshot payloads", () => {
    const output = {
      text: "captured",
      images: [{ mimeType: "image/png", data: "abc" }],
    };
    expect(textFromToolOutput(output)).toBe("captured");
    expect(imagesFromToolOutput(output)).toEqual([{ mimeType: "image/png", data: "abc" }]);
  });

  it("flattens Cursor ACP content and diff blocks", () => {
    expect(
      flattenToolOutputText([
        { type: "content", content: { type: "text", text: "file-a\n" } },
      ]),
    ).toBe("file-a\n");
    expect(
      textFromToolOutput([
        { type: "diff", path: "/tmp/a.ts", oldText: "a", newText: "b" },
      ]),
    ).toContain("diff /tmp/a.ts");
  });

  it("flattens Cursor rawOutput shell shapes", () => {
    expect(
      flattenToolOutputText({ stdout: "hello\n", stderr: "", exitCode: 0 }),
    ).toContain("hello");
    expect(flattenToolOutputText({ content: "file body" })).toBe("file body");
    expect(flattenToolOutputText({ error: "Service temporarily unavailable" })).toBe(
      "Service temporarily unavailable",
    );
  });
});
