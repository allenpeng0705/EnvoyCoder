/**
 * What the composer can attach, and how that becomes a turn the agent can read.
 *
 * Pictures travel as image blocks (the agent protocol has a place for them). Text files are written
 * into the prompt under their name. Anything else is refused here, with a reason the pane translates,
 * rather than sent as a path the window does not have: a file chosen in the page has bytes, not a
 * location on disk.
 */

import type { PromptImage } from "@envoydev/protocol";

export type { PromptImage };

export const MAX_ATTACHMENTS = 8;
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const TEXT_MAX_BYTES = 256 * 1024;

export interface ComposerAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "text";
  /** Images only. */
  data?: string;
  /** Text files only. */
  text?: string;
}

export type ReadFailure = "too-big" | "binary" | "unreadable" | "empty";
export type IngestNotice = ReadFailure | "limit";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "txt", "css", "scss", "html", "htm",
  "xml", "yml", "yaml", "toml", "rs", "py", "go", "java", "kt", "swift", "c", "h", "cpp", "hpp",
  "cs", "rb", "php", "sh", "bash", "zsh", "sql", "csv", "vue", "svelte", "graphql", "proto", "lua",
  "dart", "zig", "ini", "env", "lock",
]);

const TEXT_NAMES = new Set(["dockerfile", "makefile", "license", "readme", "gemfile", "rakefile"]);

function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

function imageMime(file: { type: string; name: string }): string | undefined {
  const type = file.type.toLowerCase();
  if (type === "image/jpg") return "image/jpeg";
  if (Object.values(IMAGE_MIME).includes(type)) return type;
  return IMAGE_MIME[extensionOf(file.name)];
}

export function isImageFile(file: { type: string; name: string }): boolean {
  return imageMime(file) !== undefined;
}

export function isTextFile(file: { type: string; name: string }): boolean {
  const type = file.type.toLowerCase();
  if (type.startsWith("text/")) return true;
  if (
    type === "application/json" ||
    type === "application/javascript" ||
    type === "application/xml" ||
    type === "application/yaml" ||
    type === "application/x-yaml" ||
    type === "application/toml"
  ) {
    return true;
  }
  const base = (file.name.split(/[/\\]/).pop() ?? file.name).toLowerCase();
  if (base.startsWith(".") || TEXT_NAMES.has(base)) return true;
  return TEXT_EXTENSIONS.has(extensionOf(file.name));
}

function readBytes(file: Blob): Promise<Uint8Array> {
  // A current browser has `Blob.arrayBuffer`. The test DOM does not, and `FileReader` is the
  // method that one does implement — the same bytes either way.
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result));
      else reject(new Error("unreadable"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    reader.readAsArrayBuffer(file);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const slice = bytes.subarray(offset, offset + chunk);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

export async function readComposerFile(file: File): Promise<
  { ok: true; attachment: ComposerAttachment } | { ok: false; reason: ReadFailure }
> {
  try {
    if (file.size === 0) return { ok: false, reason: "empty" };
    const mime = imageMime(file);
    if (mime !== undefined) {
      if (file.size > IMAGE_MAX_BYTES) return { ok: false, reason: "too-big" };
      const data = bytesToBase64(await readBytes(file));
      return {
        ok: true,
        attachment: {
          id: crypto.randomUUID(),
          name: file.name || "image",
          mimeType: mime,
          kind: "image",
          data,
        },
      };
    }
    if (!isTextFile(file)) return { ok: false, reason: "binary" };
    if (file.size > TEXT_MAX_BYTES) return { ok: false, reason: "too-big" };
    const text = new TextDecoder().decode(await readBytes(file));
    if (text.includes("\0")) return { ok: false, reason: "binary" };
    return {
      ok: true,
      attachment: {
        id: crypto.randomUUID(),
        name: file.name || "file",
        mimeType: file.type || "text/plain",
        kind: "text",
        text,
      },
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/**
 * Fold new files into the list the field is already holding.
 *
 * The last refusal is the one shown: a batch that is mostly fine should still say why the one file
 * was left out, and a batch that hits the cap stops rather than reading the rest.
 */
export async function ingestFiles(
  current: readonly ComposerAttachment[],
  incoming: readonly File[],
): Promise<{ attachments: ComposerAttachment[]; reason?: IngestNotice }> {
  const next = [...current];
  let reason: IngestNotice | undefined;
  for (const file of incoming) {
    if (next.length >= MAX_ATTACHMENTS) {
      reason = "limit";
      break;
    }
    const read = await readComposerFile(file);
    if (!read.ok) {
      reason = read.reason;
      continue;
    }
    next.push(read.attachment);
  }
  return reason === undefined ? { attachments: next } : { attachments: next, reason };
}

export function canSend(text: string, attachments: readonly ComposerAttachment[]): boolean {
  return text.trim() !== "" || attachments.length > 0;
}

/**
 * The words the agent receives, plus any pictures beside them.
 *
 * The first line stays the user's own sentence when they typed one, because that line is also the
 * task's name. File bodies come after it. A turn that is only pictures still has a sentence, so the
 * prompt is never empty.
 */
export function composeTurn(
  text: string,
  attachments: readonly ComposerAttachment[],
  copy: { imageOnly: string; imagesOnly: string; named: string },
): { prompt: string; images: PromptImage[] } {
  const images: PromptImage[] = [];
  const files: ComposerAttachment[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === "image" && attachment.data) {
      images.push({ mimeType: attachment.mimeType, data: attachment.data });
    } else if (attachment.kind === "text" && attachment.text !== undefined) {
      files.push(attachment);
    }
  }
  const trimmed = text.trim();
  const lead =
    trimmed !== ""
      ? trimmed
      : files.length === 0 && images.length === 1
        ? copy.imageOnly
        : files.length === 0 && images.length > 1
          ? copy.imagesOnly
          : attachments.length > 0
            ? copy.named
            : "";
  const notes = attachments
    .filter((attachment) => attachment.kind === "image")
    .map((attachment) => `[Image: ${attachment.name}]`);
  const bodies = files.map((file) => `--- ${file.name} ---\n${file.text ?? ""}`);
  const prompt = [lead, ...notes, ...bodies].filter((part) => part !== "").join("\n\n");
  return { prompt, images };
}

/** Images on a paste. A paste that is only words is left to the field. */
export function pastedImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const file of data.files) {
    if (isImageFile(file)) files.push(file);
  }
  if (files.length > 0) return files;
  if (!data.items) return [];
  for (const item of data.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file && isImageFile(file)) files.push(file);
  }
  return files;
}
