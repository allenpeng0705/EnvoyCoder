/**
 * Read one file for the explorer, or create an empty file or folder beside it.
 *
 * The listing already names every entry. This is what a click does with one of them: text comes
 * back as text, a picture or a PDF comes back as bytes the window can draw, and anything else
 * comes back as a size — the tab still opens, it just has nothing to render. A file larger than
 * the cap is the same answer. The window is not an editor, and it is not a place to stream a
 * disk image.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { resolveHomeFsDirectory } from "./home-fs.js";

/** Two megabytes. Past this the tab says the file is too large and does not move the bytes. */
const MAX_BYTES = 2_000_000;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);

export type HomeFsFileKind = "text" | "image" | "pdf" | "binary" | "tooLarge";

export interface HomeFsFile {
  path: string;
  name: string;
  kind: HomeFsFileKind;
  size: number;
  modifiedAt: string;
  mimeType?: string;
  /** UTF-8 for text. Base64 for an image or a PDF. Absent for binary and too-large files. */
  content?: string;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

function mimeOf(ext: string, kind: HomeFsFileKind): string | undefined {
  if (kind === "pdf") return "application/pdf";
  if (kind === "image") {
    if (ext === "svg") return "image/svg+xml";
    if (ext === "jpg") return "image/jpeg";
    if (ext === "ico") return "image/x-icon";
    return `image/${ext}`;
  }
  return undefined;
}

function resolveFile(filePath: string): { abs: string; name: string; size: number; modifiedAt: string } {
  const raw = filePath.trim();
  if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) {
    throw new Error("Pick a file in this folder.");
  }
  const abs = path.resolve(raw);
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(abs);
  } catch {
    throw new Error("That file is not there anymore.");
  }
  if (!st.isFile()) throw new Error("That is a folder, not a file.");
  return { abs, name: path.basename(abs), size: st.size, modifiedAt: st.mtime.toISOString() };
}

/** One file, classified so the window knows what to draw. */
export function readHomeFsFile(filePath: string): HomeFsFile {
  const file = resolveFile(filePath);
  const base = {
    path: file.abs,
    name: file.name,
    size: file.size,
    modifiedAt: file.modifiedAt,
  };
  if (file.size > MAX_BYTES) return { ...base, kind: "tooLarge" };

  const ext = extensionOf(file.name);
  const bytes = readFileSync(file.abs);
  if (ext === "pdf") {
    return { ...base, kind: "pdf", mimeType: "application/pdf", content: bytes.toString("base64") };
  }
  if (IMAGE_EXT.has(ext)) {
    const mimeType = mimeOf(ext, "image");
    return {
      ...base,
      kind: "image",
      ...(mimeType ? { mimeType } : {}),
      content: bytes.toString("base64"),
    };
  }
  if (bytes.includes(0)) return { ...base, kind: "binary" };
  return { ...base, kind: "text", content: bytes.toString("utf8") };
}

function singleName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed === "" ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0")
  ) {
    throw new Error("Use a name with no slashes.");
  }
  return trimmed;
}

/** An empty file, or a folder, in a directory that already exists. */
export function createHomeFsEntry(
  directory: string,
  name: string,
  kind: "file" | "dir",
): { path: string; kind: "file" | "dir" } {
  const parent = resolveHomeFsDirectory(directory);
  if (!parent) throw new Error("That folder is not there anymore.");
  const entryName = singleName(name);
  const target = path.resolve(parent, entryName);
  if (path.dirname(target) !== parent) throw new Error("Use a name with no slashes.");
  try {
    statSync(target);
    throw new Error("Something with that name is already there.");
  } catch (error) {
    if (error instanceof Error && error.message === "Something with that name is already there.") throw error;
  }
  if (kind === "dir") mkdirSync(target);
  else writeFileSync(target, "");
  return { path: target, kind };
}
