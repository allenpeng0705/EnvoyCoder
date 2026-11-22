import { describe, expect, it } from "vitest";

import { imagesFromToolOutput, textFromToolOutput } from "../src/components/tools/tool-output.js";

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
});
