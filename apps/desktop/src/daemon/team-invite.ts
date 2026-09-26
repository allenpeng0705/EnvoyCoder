/**
 * Team invite — token + origin WebSocket URL in one copy/paste string.
 *
 * A bare high-entropy token still works for same-daemon join (tests / local).
 * Cross-daemon join needs the origin endpoint so the peer can present the token
 * to the orchestrator (`docs/envoydev-collaboration.md` §4.1).
 */

export const TEAM_INVITE_PREFIX = "envoydev.team.v1.";

export interface TeamInvitePayload {
  /** High-entropy team token (origin secret). */
  token: string;
  /** Origin daemon WebSocket URL, e.g. `ws://192.168.1.10:4770/ws`. */
  originWs: string;
  /** Optional display label for the invite card. */
  label?: string;
}

export function encodeTeamInvite(payload: TeamInvitePayload): string {
  const json = JSON.stringify({
    token: payload.token,
    originWs: payload.originWs,
    ...(payload.label ? { label: payload.label } : {}),
  });
  return `${TEAM_INVITE_PREFIX}${Buffer.from(json, "utf8").toString("base64url")}`;
}

/**
 * Parse a pasted invite or bare token.
 *
 * Bare tokens have no `originWs` — join stays local (origin loopback / unit tests).
 */
export function parseTeamInvite(raw: string): TeamInvitePayload {
  const text = raw.trim();
  if (text.startsWith(TEAM_INVITE_PREFIX)) {
    const encoded = text.slice(TEAM_INVITE_PREFIX.length);
    try {
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
        token?: unknown;
        originWs?: unknown;
        label?: unknown;
      };
      if (typeof parsed.token !== "string" || parsed.token.length < 16) {
        throw new Error("bad invite token");
      }
      if (typeof parsed.originWs !== "string" || !/^wss?:\/\//.test(parsed.originWs)) {
        throw new Error("bad invite origin");
      }
      return {
        token: parsed.token,
        originWs: parsed.originWs,
        ...(typeof parsed.label === "string" ? { label: parsed.label } : {}),
      };
    } catch {
      throw new Error("That team invite is not valid.");
    }
  }
  if (text.length < 16) {
    throw new Error("That team token is not valid.");
  }
  return { token: text, originWs: "" };
}

/** True when the invite names a remote origin this daemon must dial. */
export function inviteNeedsRemoteJoin(invite: TeamInvitePayload, selfWsUrls: readonly string[]): boolean {
  if (!invite.originWs) return false;
  const normalized = normalizeWsUrl(invite.originWs);
  return !selfWsUrls.some((u) => normalizeWsUrl(u) === normalized);
}

export function normalizeWsUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname;
    const path = u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname;
    return `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}${path || "/ws"}`;
  } catch {
    return url.trim();
  }
}

/** Build `ws://host:port/path` for invites and member hostHints. */
export function daemonWsUrl(host: string, port: number, path = "/ws"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `ws://${host}:${port}${p}`;
}
