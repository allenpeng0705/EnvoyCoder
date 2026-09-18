/**
 * Split assistant markdown into stable blocks for memoized re-parse.
 *
 * Blank lines separate blocks, except blanks *inside* an open fence — those stay
 * with the fence until it closes (Paseo's rule). Finished blocks keep React keys
 * and only the live tail re-parses while streaming.
 */

export function splitMarkdownBlocks(text: string): string[] {
  if (text.length === 0) return [];

  const blocks: string[] = [];
  let currentLines: string[] = [];
  let sawBlockSeparator = false;
  let fenceOpen: string | null = null;

  for (const line of text.split("\n")) {
    const fence = /^(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1]!;
      if (fenceOpen === null) {
        fenceOpen = marker;
      } else if (marker[0] === fenceOpen[0] && marker.length >= fenceOpen.length) {
        fenceOpen = null;
      }
    }

    const isBlankLine = line.trim().length === 0;
    if (isBlankLine && fenceOpen !== null) {
      currentLines.push(line);
      continue;
    }

    if (isBlankLine) {
      if (currentLines.length > 0) sawBlockSeparator = true;
      continue;
    }

    if (sawBlockSeparator) {
      blocks.push(currentLines.join("\n"));
      currentLines = [];
      sawBlockSeparator = false;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) blocks.push(currentLines.join("\n"));
  return blocks.filter((block) => block.length > 0);
}
