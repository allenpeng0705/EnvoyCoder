/**
 * Mermaid source denylist — ported from Paseo's `fence/mermaid/source-policy.ts`.
 *
 * Mermaid can fetch external resources while rendering (image shapes, CSS url/@import),
 * so prompt-injected diagrams could exfiltrate data. Reject those constructs and fall
 * back to a highlighted source block.
 */

const UNSAFE_MERMAID_SOURCE =
  /@\s*\{|url\s*\(|@import\b|themeCSS|&#|<(?!\/?(?:br|i)\s*\/?>)[a-z!/]/i;

function normalizeMermaidSource(code: string): string | null {
  try {
    return code
      .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, hex: string) =>
        decodeCodePointEscape(Number.parseInt(hex, 16)),
      )
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/["'`\\]/g, "");
  } catch {
    return null;
  }
}

function decodeCodePointEscape(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) {
    throw new RangeError("Invalid Unicode code point");
  }
  return String.fromCodePoint(value);
}

export function containsUnsafeMermaidSource(code: string): boolean {
  if (UNSAFE_MERMAID_SOURCE.test(code)) return true;
  const normalized = normalizeMermaidSource(code);
  if (normalized === null) return true;
  return UNSAFE_MERMAID_SOURCE.test(normalized);
}
