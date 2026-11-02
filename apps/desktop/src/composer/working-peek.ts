/**
 * Working peek helpers — Codex-inspired status header + muted body.
 *
 * `latestSummaryLine` mirrors `codex-rs/tui/src/chatwidget/streaming.rs`:
 * most recent usable line, strip `#` / leading `**…**`, skip HTML comments.
 */

/** Latest status-header line from a live stream (Codex `latest_summary_line`). */
export function latestSummaryLine(streamText: string): string | undefined {
  const lines = streamText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let line = lines[i]!.trim();
    if (line === "" || line.startsWith("<!--")) continue;
    // Strip markdown heading markers, then unwrap a leading bold span.
    line = line.replace(/^#+\s*/, "").trim();
    if (line.startsWith("**")) {
      const close = line.indexOf("**", 2);
      if (close > 2) {
        line = `${line.slice(2, close)}${line.slice(close + 2)}`.trim();
      }
    }
    if (line === "") continue;
    return line.length > 96 ? `${line.slice(0, 93)}…` : line;
  }
  return undefined;
}

/** Muted tail of the live stream for the peek body. */
export function workingPeekTail(streamText: string, maxChars = 280): string {
  const full = streamText.trim();
  if (full === "") return "";
  if (full.length <= maxChars) return full;
  const slice = full.slice(full.length - maxChars);
  const cut = slice.indexOf("\n");
  const trimmed = cut >= 0 && cut < 40 ? slice.slice(cut + 1) : slice;
  return `…${trimmed.trimStart()}`;
}

/**
 * Status header + optional muted body. Drops the body when it only repeats the summary
 * (Codex puts the summary in the status row; the stream dump is secondary).
 */
export function workingPeekParts(
  streamText: string,
  maxChars = 280,
): { summary: string | undefined; tail: string } {
  const summary = latestSummaryLine(streamText);
  const tail = workingPeekTail(streamText, maxChars);
  if (tail === "") return { summary, tail: "" };
  if (summary === undefined) return { summary, tail };
  const normalized = tail.replace(/^\u2026/, "").trim();
  if (normalized === summary || tail === summary) return { summary, tail: "" };
  // Tail whose first line is the summary — keep only what follows.
  const firstNl = normalized.indexOf("\n");
  if (firstNl > 0 && normalized.slice(0, firstNl).trim() === summary) {
    const rest = normalized.slice(firstNl + 1).trim();
    return { summary, tail: rest === "" ? "" : rest };
  }
  return { summary, tail };
}
