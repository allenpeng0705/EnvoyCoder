/**
 * Pull text and vision images out of a tool card's `output` payload.
 *
 * Legacy harness updates stored a plain string preview. Multimodal tool results
 * (device_screenshot / browser_screenshot) arrive as `{ text?, images: [{ mimeType, data }] }`.
 * Cursor ACP often wraps text as `[{ type: "content", content: { type: "text", text } }]` or
 * edit diffs as `[{ type: "diff", path, oldText, newText }]`.
 */

export type ToolOutputImage = { mimeType: string; data: string };

/**
 * Flatten ACP-shaped tool content into plain text (same rules as the daemon classifier).
 * Diff blocks become a short path summary so Details is not a wall of JSON.
 */
export function flattenToolOutputText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => flattenToolOutputText(part)).join("");
  }
  if (typeof content !== "object" || content === null) return "";
  const block = content as {
    type?: unknown;
    text?: unknown;
    content?: unknown;
    path?: unknown;
    oldText?: unknown;
    newText?: unknown;
  };
  if (block.type === "text" && typeof block.text === "string") return block.text;
  if (block.type === "diff") {
    const path = typeof block.path === "string" ? block.path : "file";
    return `diff ${path}\n`;
  }
  if (block.type === "content") {
    return flattenToolOutputText(block.content);
  }
  // Cursor rawOutput shapes (stored as run.tool.output when content was empty).
  const raw = block as {
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
    error?: unknown;
    content?: unknown;
    totalMatches?: unknown;
    truncated?: unknown;
    resultCount?: unknown;
  };
  if (typeof raw.error === "string" && raw.error !== "") return raw.error;
  if (typeof raw.content === "string") return raw.content;
  if (
    typeof raw.stdout === "string" ||
    typeof raw.stderr === "string" ||
    typeof raw.exitCode === "number"
  ) {
    const parts: string[] = [];
    if (typeof raw.exitCode === "number") parts.push(`Exit code: ${raw.exitCode}`);
    if (typeof raw.stdout === "string" && raw.stdout !== "") parts.push(raw.stdout);
    if (typeof raw.stderr === "string" && raw.stderr !== "") parts.push(raw.stderr);
    return parts.join("\n\n");
  }
  if (typeof raw.totalMatches === "number") {
    return `${raw.totalMatches} matches${raw.truncated === true ? " (truncated)" : ""}`;
  }
  if (typeof raw.resultCount === "number") return `${raw.resultCount} results`;
  if (block.content !== undefined) return flattenToolOutputText(block.content);
  if (typeof block.text === "string") return block.text;
  return "";
}

export function textFromToolOutput(output: unknown, limit = 240): string | undefined {
  if (output === undefined) return undefined;
  const flat = flattenToolOutputText(output).trim();
  if (flat !== "") {
    return flat.length > limit ? `${flat.slice(0, limit)}\n…` : flat;
  }
  if (typeof output === "string") {
    return output.length > limit ? `${output.slice(0, limit)}\n…` : output;
  }
  if (output !== null && typeof output === "object") {
    const rec = output as { text?: unknown };
    if (typeof rec.text === "string" && rec.text !== "") {
      return rec.text.length > limit ? `${rec.text.slice(0, limit)}\n…` : rec.text;
    }
  }
  try {
    const text = JSON.stringify(output, null, 2) ?? String(output);
    return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
  } catch {
    return String(output);
  }
}

export function imagesFromToolOutput(output: unknown): ToolOutputImage[] {
  if (output === null || typeof output !== "object") return [];
  if (Array.isArray(output)) {
    const out: ToolOutputImage[] = [];
    for (const entry of output) {
      if (entry === null || typeof entry !== "object") continue;
      const rec = entry as { type?: unknown; mimeType?: unknown; data?: unknown };
      if (rec.type !== undefined && rec.type !== "image") continue;
      if (typeof rec.mimeType !== "string" || !rec.mimeType.startsWith("image/")) continue;
      if (typeof rec.data !== "string" || rec.data.length === 0) continue;
      out.push({ mimeType: rec.mimeType, data: rec.data });
    }
    return out;
  }
  const images = (output as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  const out: ToolOutputImage[] = [];
  for (const entry of images) {
    if (entry === null || typeof entry !== "object") continue;
    const rec = entry as { mimeType?: unknown; data?: unknown };
    if (typeof rec.mimeType !== "string" || !rec.mimeType.startsWith("image/")) continue;
    if (typeof rec.data !== "string" || rec.data.length === 0) continue;
    out.push({ mimeType: rec.mimeType, data: rec.data });
  }
  return out;
}
