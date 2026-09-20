/**
 * Reading a service definition back the way the supervisor will see it: the bytes on disk, and the native linter's
 * answer.
 *
 * `service.ts` generates the text; this module is what `scripts/check-service-units.mjs` uses to ask whether the
 * text a supervisor actually receives is acceptable, in the two ways JavaScript alone cannot answer:
 *
 *   * **the bytes.** An `<?xml ... encoding="UTF-16"?>` declaration in a file written as UTF-8 makes a conforming
 *     parser trust the declaration and refuse the file — expat says `encoding specified in XML declaration is
 *     incorrect` and .NET says there is no Unicode byte order mark — while the decoded JavaScript string looks
 *     perfect. Comparing the declaration with the bytes is the only place that disagreement exists, and reading the
 *     file through `Get-Content -Raw` (a .NET *string*) never applies the declaration at all.
 *   * **the linter's words.** `plutil` and the PowerShell XML load say "wrong" with a non-zero exit, and the exit
 *     code is enough there. `systemd-analyze verify` is not: versions that print `Unknown key name ... ignoring` or
 *     `... not executable` still exit `0`, so a gate reading only the exit code passes over exactly the defects it
 *     exists to catch. The verdict therefore also comes from the linter's own lines.
 *
 * Both live here, beside the definitions they judge, so whichever OS runs the suite can test the branch for the
 * other OS — the rule the whole package exists for.
 */

import type { ServiceKind } from "./service.js";

export interface ServiceUnitBytesCheck {
  /** True when the declaration matches the bytes, false when it does not. */
  ok: boolean;
  /** False when the file declares nothing this check can verify, so there was no fact to compare. */
  checked: boolean;
  /** One sentence for the gate's log: what was compared, or why it was not. */
  detail: string;
}

/** How the bytes are encoded, from the byte order mark, or the writer's UTF-8 contract when there is none. */
function actualEncoding(bytes: Uint8Array): "utf-16le" | "utf-16be" | "utf-8" {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return "utf-8";
}

/** The first bytes decoded for scanning only: the declaration is ASCII, but a UTF-16 file needs its own decoder. */
function declarationHead(bytes: Uint8Array, encoding: "utf-16le" | "utf-16be" | "utf-8"): string {
  const decoder = encoding === "utf-8" ? new TextDecoder("utf-8") : new TextDecoder(encoding);
  // The decoder strips a byte order mark for UTF-8 but not always where it is part of the first character, so the
  // leading mark is removed explicitly before the declaration is anchored at the start.
  return decoder.decode(bytes.subarray(0, 256)).replace(/^\uFEFF/, "");
}

/** The encoding the XML declaration names, lower-cased; `undefined` when there is no declaration. */
function declaredEncoding(head: string): string | undefined {
  return /^<\?xml\b[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1]?.toLowerCase();
}

/** The two families a declaration can name and this check can compare, or `undefined` for a name it cannot. */
function encodingFamily(name: string): "utf-8" | "utf-16" | undefined {
  const normalized = name.replace(/[\s_]/g, "-");
  if (normalized === "utf-8" || normalized === "utf8" || normalized === "us-ascii" || normalized === "ascii") {
    return "utf-8";
  }
  if (normalized === "utf16" || normalized === "ucs-2" || normalized.startsWith("utf-16")) return "utf-16";
  return undefined;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the encoding a file *declares* matches the encoding it *is*.
 *
 * The writer is UTF-8 (`realServiceIo.writeFile` and this repository's fixtures), so a declaration of UTF-16 with
 * no UTF-16 byte order mark is the trap this exists for: text a decoded string sees as fine and `schtasks /Create
 * /XML`, expat and .NET refuse. `checked` is false rather than a false "OK" when the declaration names an encoding
 * this check cannot compare, because "could not check" and "is right" are different answers.
 */
export function checkServiceUnitBytes(bytes: Uint8Array): ServiceUnitBytesCheck {
  const actual = actualEncoding(bytes);
  const bytesAre =
    actual === "utf-8" ? "UTF-8 (no byte order mark, the writer's encoding)" : `${actual} by byte order mark`;
  const declared = declaredEncoding(declarationHead(bytes, actual));

  if (declared === undefined) {
    if (!isValidUtf8(bytes)) {
      return { ok: false, checked: true, detail: "no encoding is declared and the bytes are not valid UTF-8" };
    }
    return { ok: true, checked: true, detail: `no declaration; the bytes are valid ${bytesAre}` };
  }

  const declaredFamily = encodingFamily(declared);
  if (declaredFamily === undefined) {
    return { ok: true, checked: false, detail: `the declaration names "${declared}", which this check cannot verify` };
  }
  const actualFamily = actual === "utf-8" ? "utf-8" : "utf-16";
  if (declaredFamily !== actualFamily) {
    return { ok: false, checked: true, detail: `the XML declaration says ${declared} but the bytes are ${bytesAre}` };
  }
  if (actualFamily === "utf-8" && !isValidUtf8(bytes)) {
    return { ok: false, checked: true, detail: `the XML declaration says ${declared} but the bytes are not valid UTF-8` };
  }
  return { ok: true, checked: true, detail: `the declaration says ${declared} and the bytes are ${bytesAre}` };
}

/**
 * The lines `systemd-analyze verify` prints for a unit it cannot use.
 *
 * Deliberately narrow: a warning systemd exits `0` on is a warning, and treating every line as a failure would make
 * the gate red on a machine whose unit is fine. These are the shapes it uses for a defect, including the two the
 * review named — an unknown directive, and a program it cannot execute.
 */
const SYSTEMD_UNIT_PROBLEMS: readonly RegExp[] = [
  /\bUnknown\b[^\n]*\b(?:section|key|key name|directive|lvalue|setting)\b/i,
  /\bnot executable\b/i,
  /\bFailed to\b/i,
  /\bbad unit file setting\b/i,
];

/**
 * What is wrong with a definition, from the linter's exit code *and* its own output.
 *
 * The exit code is the first answer and enough for `plutil` and the PowerShell XML load. It is not enough for
 * `systemd-analyze verify`, so its lines are read too; an empty result means this check found nothing wrong, not
 * that the linter is infallible.
 */
export function serviceUnitLintProblems(kind: ServiceKind, code: number, output: string): string[] {
  const problems: string[] = [];
  if (code !== 0) problems.push(`the linter exited ${code}`);
  if (kind === "systemd") {
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed !== "" && SYSTEMD_UNIT_PROBLEMS.some((pattern) => pattern.test(trimmed))) {
        problems.push(trimmed);
      }
    }
  }
  return problems;
}
