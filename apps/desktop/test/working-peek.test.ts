import { describe, expect, it } from "vitest";

import {
  latestSummaryLine,
  workingPeekParts,
  workingPeekTail,
} from "../src/composer/working-peek.js";

describe("working peek", () => {
  it("uses the most recent usable line as the summary (Codex)", () => {
    expect(
      latestSummaryLine("Earlier.\n\n## Wiring presets\n\nMore detail about the chip."),
    ).toBe("More detail about the chip.");
  });

  it("strips heading markers and leading bold from the latest line", () => {
    expect(latestSummaryLine("## Wiring presets")).toBe("Wiring presets");
    expect(latestSummaryLine("**Checking the parser** next")).toBe("Checking the parser next");
  });

  it("returns a muted tail truncated from the end", () => {
    const long = `${"a".repeat(200)}\nlast line`;
    const tail = workingPeekTail(long, 40);
    expect(tail.startsWith("…")).toBe(true);
    expect(tail.endsWith("last line")).toBe(true);
  });

  it("drops a tail that only repeats the summary", () => {
    const parts = workingPeekParts("thinking about the parser");
    expect(parts.summary).toBe("thinking about the parser");
    expect(parts.tail).toBe("");
  });
});
