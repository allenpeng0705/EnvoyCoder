/**
 * Attachments become a turn: pictures stay pictures, text files become a named block, and a zip does not.
 */

import { describe, expect, it } from "vitest";

import { composeTurn, ingestFiles, readComposerFile } from "../src/composer/attachments.js";

const copy = {
  imageOnly: "Look at the attached image.",
  imagesOnly: "Look at the attached images.",
  named: "Attached: note.txt",
};

describe("composer attachments", () => {
  it("keeps the user's sentence as the first line and puts the file after it", async () => {
    const read = await readComposerFile(new File(["export const n = 1;\n"], "lib.ts", { type: "text/plain" }));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const turn = composeTurn("review this", [read.attachment], copy);
    expect(turn.prompt.startsWith("review this")).toBe(true);
    expect(turn.prompt).toContain("--- lib.ts ---");
    expect(turn.prompt).toContain("export const n = 1;");
    expect(turn.images).toEqual([]);
  });

  it("sends a picture as an image block, with a sentence when the field is empty", async () => {
    const file = new File([Uint8Array.from([1, 2, 3, 4])], "shot.png", { type: "image/png" });
    const read = await readComposerFile(file);
    expect(read.ok).toBe(true);
    if (!read.ok || read.attachment.kind !== "image") return;
    const turn = composeTurn("", [read.attachment], copy);
    expect(turn.prompt.startsWith("Look at the attached image.")).toBe(true);
    expect(turn.prompt).toContain("[Image: shot.png]");
    expect(turn.images).toEqual([{ mimeType: "image/png", data: read.attachment.data }]);
  });

  it("refuses a file that is neither an image nor text", async () => {
    const read = await readComposerFile(new File([Uint8Array.from([0, 1, 2])], "archive.zip", { type: "application/zip" }));
    expect(read).toEqual({ ok: false, reason: "binary" });
    const ingested = await ingestFiles([], [new File([Uint8Array.from([0])], "archive.zip", { type: "application/zip" })]);
    expect(ingested.attachments).toEqual([]);
    expect(ingested.reason).toBe("binary");
  });
});
