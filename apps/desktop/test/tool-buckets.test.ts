/**
 * Tool-bucket classification and path extraction — the seed for grouped tool
 * summaries and for `run.diff`.
 */

import { describe, expect, it } from "vitest";

import {
  countToolBuckets,
  isFileMutatingTool,
  pathFromToolInput,
  toolBucket,
} from "../src/state/tool-buckets.js";

describe("toolBucket", () => {
  it("prefers ACP kind over the tool name", () => {
    expect(toolBucket("mysterious", "edit")).toBe("edited");
    expect(toolBucket("Write", "execute")).toBe("ran");
  });

  it("classifies common names when kind is absent", () => {
    expect(toolBucket("Write")).toBe("edited");
    expect(toolBucket("apply_patch")).toBe("edited");
    expect(toolBucket("bash")).toBe("ran");
    expect(toolBucket("Grep")).toBe("searched");
    expect(toolBucket("read_file")).toBe("searched");
    expect(toolBucket("TodoWrite")).toBe("edited"); // name contains "write"
    expect(toolBucket("AskUserQuestion")).toBe("other");
  });
});

describe("pathFromToolInput", () => {
  it("reads the path fields agents actually send", () => {
    expect(pathFromToolInput({ path: "a.ts" })).toBe("a.ts");
    expect(pathFromToolInput({ file_path: "b.ts" })).toBe("b.ts");
    expect(pathFromToolInput({ target_file: "c.ts" })).toBe("c.ts");
    expect(pathFromToolInput({ command: "ls" })).toBeUndefined();
    expect(pathFromToolInput(null)).toBeUndefined();
  });
});

describe("isFileMutatingTool", () => {
  it("is true only for the edited bucket", () => {
    expect(isFileMutatingTool("Write", "edit")).toBe(true);
    expect(isFileMutatingTool("bash")).toBe(false);
    expect(isFileMutatingTool("read_file")).toBe(false);
  });
});

describe("countToolBuckets", () => {
  it("tallies each bucket", () => {
    expect(
      countToolBuckets([
        { name: "Write" },
        { name: "Edit" },
        { name: "bash" },
        { name: "Grep" },
      ]),
    ).toEqual({ edited: 2, ran: 1, searched: 1, other: 0 });
  });
});
