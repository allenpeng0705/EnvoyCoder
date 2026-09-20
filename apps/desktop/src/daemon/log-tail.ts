/**
 * The end of a log file, bounded twice and reported honestly.
 *
 * ## Why a tail and not the file
 *
 * A daemon that has run for a week has a log measured in megabytes, and the only part of it anybody reads is the
 * end. So this reads the **last** `maxBytes` of the file — one `read` at an offset, not the whole thing — and then
 * keeps the last `lines` of that. Both numbers exist because both failures are real: reading the file would make
 * the window allocate whatever the log has grown to, and returning everything would make it render a megabyte of
 * text to show the three lines that matter.
 *
 * ## The two honesty rules
 *
 * **A read that starts mid-file starts mid-line.** The first line of such a read is a fragment, and presenting half
 * a line as a whole one is worse than dropping it, so it is dropped.
 *
 * **Truncation is reported, never implied.** `truncated: true` means "there is more than this", because a tail that
 * looks like a complete log is a lie somebody will debug from.
 */

import { open, stat } from "node:fs/promises";

/** Enough lines to see a failure and what led to it, few enough to render. */
export const LOG_TAIL_LINES = 200;

/** Larger than any single error worth reading, small enough to be safe to allocate on every request. */
export const LOG_TAIL_MAX_BYTES = 64 * 1024;

export interface LogTail {
  /** The file that was read — or the one that was wanted first, when there is none yet. */
  path: string;
  lines: string[];
  truncated: boolean;
}

/**
 * Read the tail of the first of `candidates` that exists.
 *
 * Candidates are tried in order because a daemon has two possible logs and which one is live depends on who started
 * it: a supervisor's stdout (`service.log`) when it runs as a service, the shell's redirected output (`daemon.log`)
 * when the app started it.
 */
export async function readLogTail(options: {
  candidates: readonly string[];
  lines?: number;
  maxBytes?: number;
}): Promise<LogTail> {
  const lineLimit = options.lines ?? LOG_TAIL_LINES;
  const byteLimit = options.maxBytes ?? LOG_TAIL_MAX_BYTES;

  let chosen: string | undefined;
  for (const candidate of options.candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        chosen = candidate;
        break;
      }
    } catch {
      // Not there is not an error: the next candidate may be, and a missing log is answered empty.
    }
  }
  if (chosen === undefined) return { path: options.candidates[0] ?? "", lines: [], truncated: false };

  const handle = await open(chosen, "r");
  try {
    const size = (await handle.stat()).size;
    const start = Math.max(0, size - byteLimit);
    const buffer = Buffer.alloc(size - start);
    if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, start);
    const split = buffer.toString("utf8").split("\n");
    // A partial first line is not a line (see the doc above); a trailing newline is not an empty last line.
    const withoutPartial = start > 0 ? split.slice(1) : split;
    const complete = withoutPartial.filter(
      (line, index) => index < withoutPartial.length - 1 || line !== "",
    );
    const lines = complete.slice(-lineLimit);
    return { path: chosen, lines, truncated: start > 0 || complete.length > lines.length };
  } finally {
    await handle.close();
  }
}
