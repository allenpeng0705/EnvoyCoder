/**
 * Window-safe peek at a pasted team invite (role catalog for Join checkboxes).
 * Full validation stays in the daemon (`team-invite.ts`).
 */

import type { RoleDef } from "@envoydev/protocol";

const PREFIX = "envoydev.team.v1.";

function b64urlToUtf8(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

/** Best-effort role catalog from a pasted invite; undefined if bare token or unreadable. */
export function peekInviteRoleCatalog(raw: string): readonly RoleDef[] | undefined {
  const text = raw.trim();
  if (!text.startsWith(PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(b64urlToUtf8(text.slice(PREFIX.length))) as {
      roleCatalog?: unknown;
    };
    if (!Array.isArray(parsed.roleCatalog)) return undefined;
    const out: RoleDef[] = [];
    for (const item of parsed.roleCatalog) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as { id?: unknown; label?: unknown; writer?: unknown };
      if (typeof row.id !== "string" || !/^[a-z][a-z0-9_-]{0,39}$/.test(row.id)) continue;
      out.push({
        id: row.id,
        writer: row.writer === true,
        ...(typeof row.label === "string" && row.label.trim() ? { label: row.label.trim() } : {}),
      });
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}
