/**
 * Pull text and vision images out of a tool card's `output` payload.
 *
 * Legacy harness updates stored a plain string preview. Multimodal tool results
 * (device_screenshot / browser_screenshot) arrive as `{ text?, images: [{ mimeType, data }] }`.
 */

export type ToolOutputImage = { mimeType: string; data: string };

export function textFromToolOutput(output: unknown, limit = 240): string | undefined {
  if (output === undefined) return undefined;
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
