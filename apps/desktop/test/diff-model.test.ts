import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/components/diff-model.js";

describe("parseUnifiedDiff", () => {
  it("counts added and removed lines and keeps both line numbers on context", () => {
    const parsed = parseUnifiedDiff(
      [
        "diff --git a/src/main.ts b/src/main.ts",
        "--- a/src/main.ts",
        "+++ b/src/main.ts",
        "@@ -1,3 +1,3 @@",
        " keep",
        "-old",
        "+new",
        " tail",
        "",
      ].join("\n"),
    );
    expect(parsed.additions).toBe(1);
    expect(parsed.deletions).toBe(1);
    expect(parsed.rows.map((row) => [row.kind, row.text, row.oldLine, row.newLine])).toEqual([
      ["hunk", "@@ -1,3 +1,3 @@", undefined, undefined],
      ["context", "keep", 1, 1],
      ["remove", "old", 2, undefined],
      ["add", "new", undefined, 2],
      ["context", "tail", 3, 3],
    ]);
  });
});
