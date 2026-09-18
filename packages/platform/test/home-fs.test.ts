/**
 * Home-node folder listing for remote pickers.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getHomeFsInfo, listHomeFsEntries } from "../src/home-fs.js";

describe("home-fs", () => {
  it("getHomeFsInfo returns platform, homeDir, and roots", () => {
    const info = getHomeFsInfo();
    expect(["darwin", "linux", "win32", "other"]).toContain(info.platform);
    expect(info.homeDir.length).toBeGreaterThan(0);
    expect(info.roots.length).toBeGreaterThan(0);
    expect(info.pathSep).toMatch(/[/\\]/);
  });

  it("listHomeFsEntries lists dirs and files with dirsOnly filter", () => {
    const root = mkdtempSync(join(tmpdir(), "envoydev-home-fs-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "README.md"), "hi");

    const all = listHomeFsEntries({ path: root });
    expect(all.entries.map((e) => e.name).sort()).toEqual(["README.md", "src"]);

    const dirsOnly = listHomeFsEntries({ path: root, dirsOnly: true });
    expect(dirsOnly.entries.map((e) => e.name)).toEqual(["src"]);
    expect(dirsOnly.entries.every((e) => e.kind === "dir")).toBe(true);
  });

  it("listHomeFsEntries returns parent so clients can navigate up", () => {
    const root = mkdtempSync(join(tmpdir(), "envoydev-home-fs-"));
    const child = join(root, "child");
    mkdirSync(child);

    const listed = listHomeFsEntries({ path: child, dirsOnly: true });
    expect(listed.parent).toBe(root);

    const up = listHomeFsEntries({ path: listed.parent, dirsOnly: true });
    expect(up.entries.some((e) => e.name === "child")).toBe(true);
  });

  it("refuses a path that is not a directory", () => {
    const root = mkdtempSync(join(tmpdir(), "envoydev-home-fs-"));
    const file = join(root, "file.txt");
    writeFileSync(file, "x");
    expect(() => listHomeFsEntries({ path: file })).toThrow(/not a directory/);
  });
});
