/**
 * Prepare agent text for markdown display.
 *
 * Agents stream fences one token at a time. An unclosed ``` mid-stream makes most parsers
 * treat the rest of the message as code (or hide it). Closing the fence for *display only*
 * keeps prose and a partial block readable — same idea as Paseo's streaming fence handling,
 * without their markdown-it plugin layer.
 */
export function prepareMarkdown(text: string): string {
  if (!text) return "";
  return closeOpenFence(text);
}

function closeOpenFence(text: string): string {
  let openMarker: string | null = null;
  for (const line of text.split("\n")) {
    const match = /^(`{3,}|~{3,})\s*/.exec(line);
    if (!match) continue;
    const marker = match[1]!;
    if (openMarker === null) {
      openMarker = marker;
    } else if (marker[0] === openMarker[0] && marker.length >= openMarker.length) {
      openMarker = null;
    }
  }
  return openMarker ? `${text}\n${openMarker}` : text;
}
