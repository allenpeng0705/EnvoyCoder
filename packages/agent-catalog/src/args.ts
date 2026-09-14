/**
 * How the argv a **user typed** becomes argv.
 *
 * ## Why this is a module and not a helper beside its first caller
 *
 * It used to live in `index.ts`, where the catalogue entries are, because they were the only thing that
 * took user-typed arguments. A **user-declared provider** takes them too — its `args` are the user's own,
 * and its extra arguments are appended the same way — and the whole point of that slice is that a
 * provider travels the *same* launch path as a catalogue entry. Two splitters would be two answers to
 * "what did the user mean by this string", and the divergence would show up as an argument the agent
 * never received.
 *
 * Quotes are honoured because users paste paths with spaces, and a path split in half is a bug report
 * about "the agent said it could not find my project" rather than about argument parsing. Not a shell: we
 * never expand variables or globs here, so `$HOME` stays the four characters it is.
 */

export function splitArgs(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}
