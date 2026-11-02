import { describe, expect, it } from "vitest";

import { gitWorktreeAddArgs, safeWorktreeDirName } from "@envoydev/platform";

describe("safeWorktreeDirName", () => {
  it("sanitizes branch paths without colliding slash vs hyphen", () => {
    expect(safeWorktreeDirName("feature/my change")).toBe("feature--my-change");
    expect(safeWorktreeDirName("feature-foo")).toBe("feature-foo");
    expect(safeWorktreeDirName("feature/foo")).toBe("feature--foo");
    expect(safeWorktreeDirName("feature/foo")).not.toBe(safeWorktreeDirName("feature-foo"));
    expect(safeWorktreeDirName("")).toBe("worktree");
  });
});

describe("gitWorktreeAddArgs", () => {
  it("builds worktree add -b argv", () => {
    expect(gitWorktreeAddArgs("/tmp/wt", "feature/x")).toEqual([
      "worktree",
      "add",
      "-b",
      "feature/x",
      "/tmp/wt",
    ]);
  });
});
