import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createHomeFsEntry, readHomeFsFile } from "../src/home-fs-file.js";

describe("home-fs files", () => {
  it("reads text, a picture, and a file that is not text", () => {
    const root = mkdtempSync(join(tmpdir(), "envoydev-fs-file-"));
    writeFileSync(join(root, "note.txt"), "hello");
    writeFileSync(join(root, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(root, "data.bin"), Buffer.from([0x00, 0x01, 0xff]));

    expect(readHomeFsFile(join(root, "note.txt"))).toMatchObject({ kind: "text", content: "hello" });
    expect(readHomeFsFile(join(root, "pic.png")).kind).toBe("image");
    expect(readHomeFsFile(join(root, "data.bin"))).toMatchObject({ kind: "binary" });
    expect(readHomeFsFile(join(root, "data.bin")).content).toBeUndefined();
  });

  it("creates an empty file and a folder, and refuses a name with a slash", () => {
    const root = mkdtempSync(join(tmpdir(), "envoydev-fs-create-"));
    const file = createHomeFsEntry(root, "new.ts", "file");
    expect(readHomeFsFile(file.path)).toMatchObject({ kind: "text", content: "" });

    const dir = createHomeFsEntry(root, "src", "dir");
    expect(dir.kind).toBe("dir");
    mkdirSync(dir.path, { recursive: true });
    expect(() => createHomeFsEntry(root, "a/b", "file")).toThrow(/slash/);
    expect(() => createHomeFsEntry(root, "new.ts", "file")).toThrow(/already there/);
  });
});
